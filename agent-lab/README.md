# agent-lab

A learning project: building a minimal agent harness in TypeScript on top of the
Anthropic SDK (`@anthropic-ai/sdk`), to understand how the agent loop works —
send messages, handle tool calls, feed results back, repeat.

It is separate from the Jobsite Twin app: it has its own `package.json` and is
not part of the Angular build or the GraphQL server.

## Status

Step 2: `src/index.ts` sends Claude (`claude-sonnet-5-5`) a fixed task — "Read
README.md and summarize it in two sentences." — with one tool offered,
`read_file` (`src/tools.ts`), and prints the reply blocks and the stop reason.
There is no agent loop yet, so a requested tool call is printed, not run.

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

The reply blocks and stop reason go to stdout; the model and token counts go
to stderr.
