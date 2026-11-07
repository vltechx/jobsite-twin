import type { CodegenConfig } from '@graphql-codegen/cli';

// Generates typed GraphQL documents for the Angular app from the server schema.
// Run: npm run codegen
const config: CodegenConfig = {
  schema: 'server/src/schema.graphql',
  documents: ['src/app/**/*.graphql'],
  generates: {
    'src/app/graphql/generated/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        avoidOptionals: { field: true },
      },
    },
  },
};

export default config;
