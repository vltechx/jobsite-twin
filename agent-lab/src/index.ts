import Anthropic from "@anthropic-ai/sdk";
import { runTool, tools } from "./tools.js";

// Step 3 of the harness: the agent loop. Send the conversation and tools; when
// the model asks for tools, run them, append the results, and go again; stop
// at a final answer (end_turn) or after MAX_TURNS.
//
// Credentials come from the environment: ANTHROPIC_API_KEY (e.g. from .env),
// or an `ant auth login` profile.
const client = new Anthropic();

const MODEL = "claude-sonnet-5-5";
const MAX_TURNS = 10;
const TASK =
  "A unit test in the Angular app is failing. Run the tests, find the bug in the application code and fix it. " +
  "Don't change any test files. Run the tests again to confirm the fix.";

// The whole conversation, resent every turn (the API is stateless). Only ever
// appended to, never edited.
const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: TASK }];

let inputTokens = 0;
let outputTokens = 0;

async function runAgent(): Promise<number> {
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // If a safety classifier declines the request, the API re-runs it on a
      // fallback model it picks, inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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
          console.log(`Turn ${turn}: ${block.name} ${JSON.stringify(block.input)}`);
          try {
            const output = await runTool(block.name, block.input);
            console.log(`  -> ${output.length} chars`);
            results.push({ type: "tool_result", tool_use_id: block.id, content: output });
          } catch (error) {
            // A failed tool is reported to the model, which can try something else.
            const message = error instanceof Error ? error.message : String(error);
            console.log(`  -> error: ${message}`);
            results.push({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
        break;
      }

      case "end_turn": {
        console.log(`Turn ${turn}: final answer\n`);
        for (const block of response.content) {
          if (block.type === "text") console.log(block.text);
        }
        return 0;
      }

      case "refusal": {
        console.error(`Turn ${turn}: declined: ${response.stop_details?.explanation ?? "(no explanation)"}`);
        return 1;
      }

      default: {
        // e.g. max_tokens: the reply was cut off; there is nothing sound to continue with.
        console.error(`Turn ${turn}: stopped with stop_reason ${response.stop_reason}`);
        return 1;
      }
    }
  }

  console.error(`Stopped: no final answer after ${MAX_TURNS} turns.`);
  return 1;
}

try {
  process.exitCode = await runAgent();
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Authentication failed: set ANTHROPIC_API_KEY (see .env.example).");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`API error ${error.status}: ${error.message}`);
  } else {
    throw error;
  }
  process.exitCode = 1;
} finally {
  console.error(`\n[${MODEL} · tokens in ${inputTokens} / out ${outputTokens}]`);
}
