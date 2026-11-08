import type { EvalTask } from "../types.js";
import { checkAllTestsPass, restoreFiles, withHiddenSpec } from "./shared.js";

const FILE = "src/app/scenarios/scenario.service.ts";
// Exists only while check() runs, so the agent can't see or edit it.
const HIDDEN_SPEC = "src/app/scenarios/eval-hidden-timeout-message.spec.ts";
const HIDDEN_SPEC_SOURCE = `import { HttpErrorResponse } from '@angular/common/http';

import { describeApiError } from './scenario.service';

describe('describeApiError (hidden eval spec)', () => {
  it('says the request timed out for HTTP 504', () => {
    const err = new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout' });
    expect(describeApiError(err)).toBe('The request timed out. Try again.');
  });
});
`;

/** Feature task: no planted bug; a hidden spec checks the new behavior. */
export const timeoutMessage: EvalTask = {
  id: "timeout-message",
  description: "Implement a 504 message in describeApiError (graded by a hidden spec)",

  async setup() {
    // Nothing to plant: the agent adds new behavior.
  },

  prompt:
    "describeApiError in the Angular app should return 'The request timed out. Try again.' for HTTP 504 responses. " +
    "Implement it.",

  check: () => withHiddenSpec(HIDDEN_SPEC, HIDDEN_SPEC_SOURCE, checkAllTestsPass),

  // Undo the agent's implementation, and the hidden spec if a crash left it behind.
  reset: () => restoreFiles([FILE], [HIDDEN_SPEC]),
};
