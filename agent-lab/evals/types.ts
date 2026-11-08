export interface CheckResult {
  passed: boolean;
  /** Short explanation stored with the result, e.g. the test summary line. */
  details: string;
}

/** One eval task: plant a problem, ask the agent to fix it, grade, clean up. */
export interface EvalTask {
  id: string;
  description: string;
  /** Changes the repo so the task has something to fix. Throws if it can't. */
  setup(): Promise<void>;
  /** What the agent is asked to do. */
  prompt: string;
  /** Grades the repo after the agent has finished. */
  check(): Promise<CheckResult>;
  /** Restores everything setup() changed. Must be safe to call more than once. */
  reset(): Promise<void>;
}
