import Anthropic from "@anthropic-ai/sdk";
import { runTool, tools } from "./tools.js";

// The agent loop. Send the conversation and tools; when the model asks for
// tools, run them, append the results, and go again; stop at a final answer
// (end_turn), any other stop reason, or after maxTurns (default MAX_TURNS).
//
// Credentials come from the environment: ANTHROPIC_API_KEY (e.g. from .env),
// or an `ant auth login` profile.
const client = new Anthropic();

export const MODEL = "claude-sonnet-5-5";
export const MAX_TURNS = 10;

/** Optional system prompt (the eval runner's "guided" variant). */
export const GUIDED_SYSTEM_PROMPT =
  "Work efficiently. Start by running the tests. When you investigate, read the related code and its test " +
  "together in one turn, and batch independent tool calls. After a fix, run the tests once to confirm.";

export interface ToolCallRecord {
  turn: number;
  name: string;
  input: unknown;
  /** Length of the tool's output, when it succeeded. */
  resultChars?: number;
  /** The error sent back to the model, when it failed. */
  error?: string;
}

export interface AgentResult {
  /** "answered" = reached end_turn; anything else means no final answer. */
  outcome: "answered" | "refused" | "stopped" | "max_turns";
  finalAnswer: string | null;
  /** stop_reason of the last response. */
  stopReason: string | null;
  turns: number;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RunAgentOptions {
  /** Progress lines (one per tool call, etc.). Defaults to console.log. */
  log?: (line: string) => void;
  /** Stop after this many model calls without a final answer. Defaults to MAX_TURNS. */
  maxTurns?: number;
  /** System prompt; when omitted, the request has none. */
  system?: string;
}

/**
 * Runs the agent on `task` until it answers or stops. API errors (auth, rate
 * limits, network) are thrown; the caller decides whether to retry or abort.
 */
export async function runAgent(task: string, options: RunAgentOptions = {}): Promise<AgentResult> {
  const log = options.log ?? console.log;
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const started = performance.now();

  // The whole conversation, resent every turn (the API is stateless). Only ever
  // appended to, never edited.
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: task }];
  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const finish = (
    outcome: AgentResult["outcome"],
    turns: number,
    stopReason: string | null,
    finalAnswer: string | null = null,
  ): AgentResult => ({
    outcome,
    finalAnswer,
    stopReason,
    turns,
    toolCalls,
    inputTokens,
    outputTokens,
    durationMs: Math.round(performance.now() - started),
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // If a safety classifier declines the request, the API re-runs it on a
      // fallback model it picks, inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Only sent when set, so a run without one is the same request as before.
      ...(options.system ? { system: options.system } : {}),
      tools,
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    // Append the assistant turn exactly as returned (every block, not just the
    // text): tool_use blocks must be there for the tool_results that answer them.
    messages.push({ role: "assistant", content: response.content });

    switch (response.stop_reason) {
      case "tool_use": {
        // Run every requested tool, then send all results back in ONE user
        // message, each tied to its request by tool_use_id.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          log(`Turn ${turn}: ${block.name} ${JSON.stringify(block.input)}`);
          const record: ToolCallRecord = { turn, name: block.name, input: block.input };
          toolCalls.push(record);
          try {
            const output = await runTool(block.name, block.input);
            record.resultChars = output.length;
            log(`  -> ${output.length} chars`);
            results.push({ type: "tool_result", tool_use_id: block.id, content: output });
          } catch (error) {
            // A failed tool is reported to the model, which can try something else.
            const message = error instanceof Error ? error.message : String(error);
            record.error = message;
            log(`  -> error: ${message}`);
            results.push({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
        break;
      }

      case "end_turn": {
        const text = response.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        log(`Turn ${turn}: final answer`);
        return finish("answered", turn, response.stop_reason, text);
      }

      case "refusal": {
        log(`Turn ${turn}: declined: ${response.stop_details?.explanation ?? "(no explanation)"}`);
        return finish("refused", turn, response.stop_reason);
      }

      default: {
        // e.g. max_tokens: the reply was cut off; there is nothing sound to continue with.
        log(`Turn ${turn}: stopped with stop_reason ${response.stop_reason}`);
        return finish("stopped", turn, response.stop_reason);
      }
    }
  }

  log(`Stopped: no final answer after ${maxTurns} turns.`);
  return finish("max_turns", maxTurns, "tool_use");
}
