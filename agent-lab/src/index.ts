import Anthropic from "@anthropic-ai/sdk";
import { readFileTool } from "./tools.js";

// Step 2 of the harness: one request with a tool offered. The model may answer
// with a tool_use block asking us to run read_file, but nothing runs it yet:
// the loop that executes tools and sends results back comes next.
//
// Credentials come from the environment: ANTHROPIC_API_KEY (e.g. from .env),
// or an `ant auth login` profile.
const client = new Anthropic();

const TASK = "Read README.md and summarize it in two sentences.";

try {
  const response = await client.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    // If a safety classifier declines the request, the API re-runs it on a
    // fallback model it picks, inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools: [readFileTool],
    messages: [{ role: "user", content: TASK }],
  });

  // content is a list of typed blocks: text, and tool_use when the model wants
  // a tool run (its input already matches the tool's schema).
  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    } else if (block.type === "tool_use") {
      console.log(`[tool_use ${block.name} ${JSON.stringify(block.input)}]`);
    }
  }

  console.log(`\nstop_reason: ${response.stop_reason}`);
  if (response.stop_reason === "refusal") {
    console.error("Declined:", response.stop_details?.explanation ?? "(no explanation)");
    process.exitCode = 1;
  }

  const { input_tokens, output_tokens } = response.usage;
  console.error(`[${response.model} · tokens in ${input_tokens} / out ${output_tokens}]`);
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
