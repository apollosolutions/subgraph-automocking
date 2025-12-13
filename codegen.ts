import type { CodegenConfig } from '@graphql-codegen/cli';
const packageJson = require('./package.json');

const config: CodegenConfig = {
  schema: {
    'https://api.apollographql.com/api/graphql': {
      headers: {
        // Note: The actual API key will be provided via environment variable
        // when running codegen. Set your API key in the APOLLO_KEY environment variable.
        'x-api-key': process.env.APOLLO_KEY || '',
        'apollo-client-version': packageJson.version,
        'apollo-client-name': packageJson.name,
      },
    },
  },
  documents: ['src/graphql/**/*.graphql', 'src/**/*.ts'],
  ignoreNoDocuments: true,
  generates: {
    './src/generated/graphql.ts': {
      plugins: [
        'typescript',
        'typescript-operations',
        'typed-document-node',
      ],
      config: {
        // Add useful type features
        skipTypename: false,
        useTypeImports: true,
        dedupeFragments: true,
        // Make all fields optional by default (matches GraphQL nullability)
        maybeValue: 'T | null | undefined',
        // Strict typing
        strictScalars: true,
        scalars: {
          ID: 'string',
          String: 'string',
          Boolean: 'boolean',
          Int: 'number',
          Float: 'number',
          DateTime: 'string',
          FederationVersion: 'string',
          GraphQLDocument: 'string',
          Long: 'BigInt',
          NaiveDateTime: 'string',
          SHA256: 'string',
          Timestamp: 'string',
          Void: 'void',
        },
      },
    },
  },
  hooks: {
    beforeDone: ['node scripts/fix-codegen-imports.js'],
  },
};

export default config;
