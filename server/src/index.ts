import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { createLoaders } from './loaders.js';
import { resolvers, type Context } from './resolvers.js';
import { typeDefs } from './schema.js';

const port = Number(process.env['PORT'] ?? 4000);

const server = new ApolloServer<Context>({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port },
  // Fresh loaders per request, so batching/caching never crosses requests.
  context: async () => ({ loaders: createLoaders() }),
});

console.log(`GraphQL server ready at ${url}`);
