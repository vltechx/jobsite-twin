# agent-lab

A learning project: building a minimal agent harness in TypeScript on top of the
Anthropic SDK (`@anthropic-ai/sdk`), to understand how the agent loop works —
send messages, handle tool calls, feed results back, repeat.

It is separate from the Jobsite Twin app: it has its own `package.json` and is
not part of the Angular build or the GraphQL server.

## Status

Step 6: `src/agent.ts` exports `runAgent(task)`, an agent loop on Claude
(`claude-sonnet-5-5`). Each turn it sends the conversation and the tools
(`src/tools.ts`); when the model asks for a tool, it runs it, appends the
result, and loops; at `end_turn` it returns the final answer. It stops after 10
turns, or on any other stop reason (such as a refusal). Each tool call is logged
with its turn number and input; a failing tool is reported back to the model as
an error result. `runAgent` returns the final answer, outcome, turns, every tool
call, input and output tokens, and the time taken.

`npm start` (`src/index.ts`) runs it once on a fixed task — "A unit test in the
Angular app is failing. Run the tests, find the bug in the application code and
fix it. Don't change any test files. Run the tests again to confirm the fix." —
and `npm run eval` runs it as an eval (below).

## Evals

`npm run eval` runs every task 3 times: setup → `runAgent` → check → reset.
Name tasks to run only those, and set the trial count with `--trials`, e.g.
`npm run eval -- timeout-message --trials 1`.

- It refuses to start unless the whole repo's git working tree is clean, because
  reset uses `git checkout`.
- Reset runs even when a trial fails or throws, and on Ctrl-C. After each trial,
  any other tracked file the agent changed is restored and listed in the results
  (`strayEdits`); a new untracked file stops the run.
- Results, including every tool call, go to `evals/results/<timestamp>.json`
  (git-ignored). A summary table prints pass rate, average turns, average input /
  output tokens and average time per task.

| Task | Setup | Check |
| --- | --- | --- |
| `latlon-swap` | Swaps `lat` and `lon` in the route `createScenario` sends (`src/app/scenarios/scenario.service.ts`) | All tests pass |
| `timeout-message` | None; the agent is asked to make `describeApiError` return "The request timed out. Try again." for HTTP 504 | All tests pass, plus a hidden spec for the 504 message |
| `graphql-errors-vague` | Joins GraphQL error messages with `', '` instead of `'; '` in `describeApiError`; the prompt only says "some API error messages look wrong" | All tests pass, plus a hidden spec with two errors (the visible spec has only one, so it passes with the bug) |

"All tests pass" means `npx ng test --watch=false` exits 0 and every `*.spec.ts`
file under `src/` ran. A hidden spec is written just before the check runs and
deleted right after, so the agent never sees it; reset also deletes it if a
crash left it behind.

Each trial makes real API calls and runs the Angular tests several times.

## Tools

| Tool | What it does |
| --- | --- |
| `read_file` | Returns a file's text (max 100 KB). |
| `search_code` | Exact-text, case-sensitive search via `git grep`; returns `path:line:text`, max 50 matches. |
| `edit_file` | Replaces one exact snippet with new text; fails if it's missing or appears more than once. Refuses `*.spec.ts` files ("Editing test files is not allowed."). Writes to the real file, with no confirmation step. |
| `run_tests` | Runs `npx ng test --watch=false` from the repo root (3-minute timeout); returns the exit code and the last 50 lines of output. |

Limits shared by all tools: paths are relative to the Jobsite Twin repo root and
must stay inside it (symlinks are resolved before checking); `.env` and `.env.*`
files (including `.env.example`) are never read, searched or edited; git-ignored
files (such as `node_modules` and `src/environments/environment.ts`) are skipped.

## Requirements

- Node 22.9+
- An Anthropic API key, provided via the environment (never committed;
  `.env` is git-ignored here)

## Run

```sh
cd agent-lab
npm install
cp .env.example .env   # then put your key in .env
npm start
```

The turn log and final answer go to stdout; the model and total token counts
go to stderr.
