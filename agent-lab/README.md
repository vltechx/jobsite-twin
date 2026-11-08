# agent-lab

A learning project: building a minimal agent harness in TypeScript on top of the
Anthropic SDK (`@anthropic-ai/sdk`), to understand how the agent loop works —
send messages, handle tool calls, feed results back, repeat.

It is separate from the Jobsite Twin app: it has its own `package.json` and is
not part of the Angular build or the GraphQL server.

## Status

Setup only: `package.json` declares the SDK and `tsx` (runs `.ts` files
directly). No harness code yet.

## Requirements

- Node 22+
- An Anthropic API key, provided via the environment (never committed;
  `.env` is git-ignored here)
