# agent-lab

A learning project: building a minimal agent harness in TypeScript on top of the
Anthropic SDK (`@anthropic-ai/sdk`), to understand how the agent loop works —
send messages, handle tool calls, feed results back, repeat.

It is separate from the Jobsite Twin app: it has its own `package.json` and is
not part of the Angular build or the GraphQL server.

## Status

Step 3: `src/index.ts` runs an agent loop on Claude (`claude-sonnet-5-5`) for a
fixed task — "Read README.md and summarize it in two sentences." Each turn it
sends the conversation and the tools (`src/tools.ts`); when the model asks for
a tool, it runs it, appends the result, and loops; at `end_turn` it prints the
final answer. It stops after 10 turns, or on any other stop reason (such as a
refusal). Each tool call is printed with its turn number and input; a failing
tool is reported back to the model as an error result.

`read_file` reads only files inside the Jobsite Twin repo (paths relative to
the repo root, symlinks resolved) and refuses git-ignored files such as `.env`
and files over 100 KB.

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
