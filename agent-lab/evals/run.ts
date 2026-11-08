import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, parseArgs } from "node:util";

import { MAX_TURNS, MODEL, runAgent, type AgentResult } from "../src/agent.js";
import { REPO_ROOT } from "../src/tools.js";
import { graphqlErrorsVague } from "./tasks/graphql-errors-vague.js";
import { latlonSwap } from "./tasks/latlon-swap.js";
import { timeoutMessage } from "./tasks/timeout-message.js";
import type { CheckResult, EvalTask } from "./types.js";

// Eval runner: for each task, N times: setup -> runAgent -> check -> reset.
// Usage: npm run eval [-- [task-id ...] [--trials N] [--max-turns N]]   (no task ids = all tasks)
const ALL_TASKS: EvalTask[] = [latlonSwap, timeoutMessage, graphqlErrorsVague];

const execFileAsync = promisify(execFile);
const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

interface TrialResult {
  trial: number;
  passed: boolean;
  check: CheckResult | null;
  agent: AgentResult | null;
  /** Set when setup, the agent or the check threw. */
  error?: string;
  /** Tracked files the agent changed besides the task's own file (restored after the trial). */
  strayEdits: string[];
}

const { values, positionals } = parseArgs({
  options: {
    trials: { type: "string", default: "3" },
    "max-turns": { type: "string", default: String(MAX_TURNS) },
  },
  allowPositionals: true,
});

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${flag} must be a positive integer (got ${raw})`);
    process.exit(1);
  }
  return n;
}
const trials = positiveInt("--trials", values.trials);
const maxTurns = positiveInt("--max-turns", values["max-turns"]);

const unknown = positionals.filter((id) => !ALL_TASKS.some((t) => t.id === id));
if (unknown.length > 0) {
  console.error(`Unknown task: ${unknown.join(", ")}. Tasks: ${ALL_TASKS.map((t) => t.id).join(", ")}`);
  process.exit(1);
}
const TASKS = positionals.length > 0 ? ALL_TASKS.filter((t) => positionals.includes(t.id)) : ALL_TASKS;

/** `git status --porcelain` lines for the whole repo (untracked files included, ignored ones not). */
async function gitStatus(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: REPO_ROOT });
  return stdout.split("\n").filter(Boolean);
}

// 1. Refuse to start on a dirty tree: reset uses git checkout, which would also
//    throw away uncommitted work in the files it restores.
const dirty = await gitStatus();
if (dirty.length > 0) {
  console.error("Refusing to run: the git working tree is not clean. Commit or stash these first:");
  for (const line of dirty) console.error(`  ${line}`);
  process.exit(1);
}

// Ctrl-C mid-trial: undo the planted change before exiting.
let activeTask: EvalTask | null = null;
process.once("SIGINT", async () => {
  console.error("\nInterrupted; resetting the current task…");
  await activeTask?.reset().catch((e) => console.error(`reset failed: ${e}`));
  process.exit(130);
});

const startedAt = new Date();
const results: { task: string; description: string; trials: TrialResult[] }[] = [];
let aborted: string | null = null;

for (const task of TASKS) {
  const taskResult = { task: task.id, description: task.description, trials: [] as TrialResult[] };
  results.push(taskResult);

  for (let trial = 1; trial <= trials && !aborted; trial++) {
    console.log(`\n=== ${task.id} · trial ${trial}/${trials} ===`);
    const result: TrialResult = { trial, passed: false, check: null, agent: null, strayEdits: [] };
    activeTask = task;
    try {
      await task.setup();
      result.agent = await runAgent(task.prompt, { maxTurns, log: (line) => console.log(`  ${line}`) });
      result.check = await task.check();
      result.passed = result.check.passed;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`  error: ${result.error}`);
      // A bad key won't fix itself on the next trial.
      if (error instanceof Anthropic.AuthenticationError) {
        aborted = "Authentication failed: set ANTHROPIC_API_KEY in agent-lab/.env";
      }
    } finally {
      await task.reset();
      activeTask = null;
    }

    // The tree was clean before setup, so anything still changed is from this
    // trial: restore tracked files; stop on new untracked files (can't tell what they are).
    const leftover = await gitStatus();
    const untracked = leftover.filter((line) => line.startsWith("??"));
    if (untracked.length > 0) {
      aborted = `the trial left untracked files: ${untracked.join(", ")}`;
    }
    const changed = leftover.filter((line) => !line.startsWith("??")).map((line) => line.slice(3));
    if (changed.length > 0) {
      result.strayEdits = changed;
      await execFileAsync("git", ["checkout", "--", ...changed], { cwd: REPO_ROOT });
      console.log(`  restored other files the agent changed: ${changed.join(", ")}`);
    }

    taskResult.trials.push(result);
    const a = result.agent;
    console.log(
      `  -> ${result.passed ? "PASS" : "FAIL"}` +
        (result.check ? ` (${result.check.details})` : "") +
        (a ? ` · ${a.outcome}, ${a.turns} turns, ${a.inputTokens + a.outputTokens} tokens, ${(a.durationMs / 1000).toFixed(1)} s` : ""),
    );
  }
  if (aborted) break;
}

// 2. Save everything, including each tool call, for later comparison.
await mkdir(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(
  file,
  JSON.stringify({ startedAt: startedAt.toISOString(), model: MODEL, maxTurns, trialsPerTask: trials, aborted, results }, null, 2) + "\n",
);

// 3. Summary table. Averages cover trials where the agent ran to completion.
const average = (xs: number[]) => (xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : NaN);
const rows = results.map(({ task, trials: ts }) => {
  const ran = ts.map((t) => t.agent).filter((a): a is AgentResult => a !== null);
  const passed = ts.filter((t) => t.passed).length;
  return [
    task,
    `${passed}/${ts.length} (${ts.length ? Math.round((100 * passed) / ts.length) : 0}%)`,
    average(ran.map((a) => a.turns)).toFixed(1),
    `${Math.round(average(ran.map((a) => a.inputTokens)))} / ${Math.round(average(ran.map((a) => a.outputTokens)))}`,
    `${(average(ran.map((a) => a.durationMs)) / 1000).toFixed(1)} s`,
  ];
});
const header = ["Task", "Pass rate", "Avg turns", "Avg tokens (in / out)", "Avg time"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ");
console.log(`\n${line(header)}\n${widths.map((w) => "-".repeat(w)).join("-|-")}`);
for (const row of rows) console.log(line(row));
console.log(`\nModel ${MODEL}, max ${maxTurns} turns, ${trials} trial(s) per task. Results: ${path.relative(process.cwd(), file)}`);

if (aborted) {
  console.error(`\nStopped early: ${aborted}`);
  process.exitCode = 1;
}
