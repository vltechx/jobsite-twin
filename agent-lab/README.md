# agent-lab

A learning project: building a minimal agent harness in TypeScript on top of the
Anthropic SDK (`@anthropic-ai/sdk`), to understand how the agent loop works —
send messages, handle tool calls, feed results back, repeat.

It is separate from the Jobsite Twin app: it has its own `package.json` and is
not part of the Angular build or the GraphQL server.

## Status

Step 4: `src/index.ts` runs an agent loop on Claude (`claude-sonnet-5-5`) for a
fixed task — "Find where describeApiError is defined and explain what it
does." Each turn it sends the conversation and the tools (`src/tools.ts`); when
the model asks for a tool, it runs it, appends the result, and loops; at
`end_turn` it prints the final answer. It stops after 10 turns, or on any other
stop reason (such as a refusal). Each tool call is printed with its turn number
and input; a failing tool is reported back to the model as an error result.

## Tools

| Tool | What it does |
| --- | --- |
| `read_file` | Returns a file's text (max 100 KB). |
| `search_code` | Exact-text, case-sensitive search via `git grep`; returns `path:line:text`, max 50 matches. |
| `edit_file` | Replaces one exact snippet with new text; fails if it's missing or appears more than once. Writes to the real file, with no confirmation step. |
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
