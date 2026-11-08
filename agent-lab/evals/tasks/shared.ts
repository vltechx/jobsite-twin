import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { REPO_ROOT, runTestSuite } from "../../src/tools.js";
import type { CheckResult } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Runs the Angular unit tests. Passes only if they all pass (exit code 0) AND
 * every *.spec.ts file on disk ran, so a hidden spec that wasn't picked up, or
 * tests skipped some other way, can't produce a false pass.
 */
export async function checkAllTestsPass(): Promise<CheckResult> {
  const expectedFiles = await countSpecFiles();
  const { exitCode, timedOut, output } = await runTestSuite();
  // Vitest's summary lines, e.g. "Tests  15 passed (15)" or "Tests  1 failed | 14 passed (15)".
  const summaryLines = output.split("\n").filter((line) => /^\s*(Test Files|Tests)\s/.test(line));
  const summary = summaryLines.map((line) => line.trim().replace(/\s+/g, " ")).join("; ") || "no test summary";
  if (timedOut) return { passed: false, details: `tests timed out; ${summary}` };

  const ranFiles = Number(/Test Files\b[^;]*\((\d+)\)/.exec(summary)?.[1] ?? NaN);
  if (ranFiles !== expectedFiles) {
    return { passed: false, details: `${expectedFiles} spec files on disk but ${ranFiles || "no"} test files ran; ${summary}` };
  }
  return { passed: exitCode === 0, details: `exit code ${exitCode}; ${summary}` };
}

/** *.spec.ts files under src/, tracked or untracked (git-ignored ones excluded). */
async function countSpecFiles(): Promise<number> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/*.spec.ts"],
    { cwd: REPO_ROOT },
  );
  return stdout.split("\n").filter(Boolean).length;
}

/**
 * Writes a spec the agent never saw, runs `fn` (usually the test check), then
 * deletes the spec again, even if `fn` throws.
 */
export async function withHiddenSpec<T>(specPath: string, source: string, fn: () => Promise<T>): Promise<T> {
  const target = path.join(REPO_ROOT, specPath);
  await writeFile(target, source, "utf8");
  try {
    return await fn();
  } finally {
    await rm(target, { force: true });
  }
}

/** Restores tracked files with git checkout and deletes untracked ones (e.g. a leftover hidden spec). */
export async function restoreFiles(tracked: string[], untracked: string[] = []): Promise<void> {
  if (tracked.length > 0) {
    await execFileAsync("git", ["checkout", "--", ...tracked], { cwd: REPO_ROOT });
  }
  for (const file of untracked) {
    await rm(path.join(REPO_ROOT, file), { force: true });
  }
}

/** Replaces `correct` with `planted` in a repo file; throws unless `correct` appears exactly once. */
export async function plant(file: string, correct: string, planted: string): Promise<void> {
  const target = path.join(REPO_ROOT, file);
  const source = await readFile(target, "utf8");
  const count = source.split(correct).length - 1;
  if (count !== 1) {
    throw new Error(`setup: expected ${JSON.stringify(correct)} once in ${file}, found it ${count} times`);
  }
  await writeFile(target, source.replace(correct, planted), "utf8");
}
