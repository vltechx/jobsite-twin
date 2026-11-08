import Anthropic from "@anthropic-ai/sdk";
import { MODEL, runAgent } from "./agent.js";

// Command-line entry: run the agent once on a fixed task and print the result.
// The loop itself lives in agent.ts (shared with the eval runner in evals/).
const TASK =
  "A unit test in the Angular app is failing. Run the tests, find the bug in the application code and fix it. " +
  "Don't change any test files. Run the tests again to confirm the fix.";

try {
  const result = await runAgent(TASK);
  if (result.finalAnswer !== null) console.log(`\n${result.finalAnswer}`);
  console.error(
    `\n[${MODEL} · ${result.outcome} after ${result.turns} turns · ` +
      `tokens in ${result.inputTokens} / out ${result.outputTokens} · ${(result.durationMs / 1000).toFixed(1)} s]`,
  );
  process.exitCode = result.outcome === "answered" ? 0 : 1;
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Authentication failed: set ANTHROPIC_API_KEY (see .env.example).");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`API error ${error.status}: ${error.message}`);
  } else {
    throw error;
  }
  process.exitCode = 1;
}
