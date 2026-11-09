import type { EvalTask } from "../types.js";
import { checkAllTestsPass, plant, restoreFiles } from "./shared.js";

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
    await plant(FILE, CORRECT, PLANTED);
  },

  prompt:
    "A unit test in the Angular app is failing. Run the tests, find the bug in the application code and fix it. " +
    "Don't change any test files. Run the tests again to confirm the fix.",

  check: () => checkAllTestsPass(),

  reset: () => restoreFiles([FILE]),
};
