import { readFileSync } from 'node:fs';

// The schema lives in schema.graphql so the frontend's GraphQL Code Generator can read
// it directly (see codegen.ts at the repo root) without the server running.
export const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
