import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { REPO_ROOT, runTestSuite } from "../../src/tools.js";
import type { EvalTask } from "../types.js";

const execFileAsync = promisify(execFile);

// Repo-relative, so the same path works for git and for reading the file.
const FILE = "src/app/scenarios/scenario.service.ts";
const CORRECT = "route: draft.waypoints.map(({ lat, lon }) => ({ lat, lon })),";
const PLANTED = "route: draft.waypoints.map(({ lat, lon }) => ({ lat: lon, lon: lat })),";

/**
 * createScenario sends each drawn waypoint with lat and lon swapped. The
 * ScenarioService spec ("creates a scenario with trimmed names and waypoints in
 * drawn order") catches it by checking the mutation variables.
 */
export const latlonSwap: EvalTask = {
  id: "latlon-swap",
  description: "createScenario swaps lat and lon in the route it sends",

  async setup() {
    const target = path.join(REPO_ROOT, FILE);
    const source = await readFile(target, "utf8");
    const count = source.split(CORRECT).length - 1;
    if (count !== 1) {
      throw new Error(`setup: expected the route mapping once in ${FILE}, found it ${count} times`);
    }
    await writeFile(target, source.replace(CORRECT, PLANTED), "utf8");
  },

  prompt:
    "A unit test in the Angular app is failing. Run the tests, find the bug in the application code and fix it. " +
    "Don't change any test files. Run the tests again to confirm the fix.",

  async check() {
    const { exitCode, timedOut, output } = await runTestSuite();
    // Vitest's summary lines, e.g. "Tests  15 passed (15)" or "Tests  1 failed | 14 passed (15)".
    const summary = output
      .split("\n")
      .filter((line) => /^\s*(Test Files|Tests)\s/.test(line))
      .map((line) => line.trim().replace(/\s+/g, " "))
      .join("; ");
    if (timedOut) return { passed: false, details: `tests timed out; ${summary}` };
    return { passed: exitCode === 0, details: `exit code ${exitCode}; ${summary || "no test summary"}` };
  },

  async reset() {
    await execFileAsync("git", ["checkout", "--", FILE], { cwd: REPO_ROOT });
  },
};
