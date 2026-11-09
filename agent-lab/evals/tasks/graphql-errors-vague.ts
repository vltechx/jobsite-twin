import type { EvalTask } from "../types.js";
import { checkAllTestsPass, plant, restoreFiles, withHiddenSpec } from "./shared.js";

const FILE = "src/app/scenarios/scenario.service.ts";
const CORRECT = ".join('; ')}`;";
const PLANTED = ".join(', ')}`;";

// The visible spec only covers a single GraphQL error, where the separator never
// shows, so it passes with or without the bug. This hidden spec (present only
// while check() runs) uses two errors so the check can tell fixed from unfixed.
const HIDDEN_SPEC = "src/app/scenarios/eval-hidden-graphql-errors.spec.ts";
const HIDDEN_SPEC_SOURCE = `import { CombinedGraphQLErrors } from '@apollo/client';

import { describeApiError } from './scenario.service';

describe('describeApiError (hidden eval spec)', () => {
  it('separates several GraphQL error messages with "; "', () => {
    const err = new CombinedGraphQLErrors({
      errors: [{ message: 'name must not be empty' }, { message: 'machines[0].speedMps must be > 0' }],
    });
    expect(describeApiError(err)).toBe(
      'The GraphQL API reported an error: name must not be empty; machines[0].speedMps must be > 0',
    );
  });
});
`;

/** Bug-fix task with a vague report: GraphQL error messages are joined with ", ". */
export const graphqlErrorsVague: EvalTask = {
  id: "graphql-errors-vague",
  description: "describeApiError joins GraphQL error messages with ', ' instead of '; '",

  async setup() {
    await plant(FILE, CORRECT, PLANTED);
  },

  prompt: "Users say some API error messages look wrong. Find and fix the problem. Don't change test files.",

  check: () => withHiddenSpec(HIDDEN_SPEC, HIDDEN_SPEC_SOURCE, checkAllTestsPass),

  reset: () => restoreFiles([FILE], [HIDDEN_SPEC]),
};
