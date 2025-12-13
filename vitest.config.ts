import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';
// forces the same CJS entrypoint for graphql
// without this, vitest had trouble resolving the graphql module
// in integration tests
const require = createRequire(import.meta.url);
const graphqlPath = require.resolve('graphql');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './coverage/junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/index.ts',
        'src/generated/**/*.ts',
        'node_modules',
        'dist',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
    setupFiles: ['./setupVitest.ts'],
    include: ['src/**/__tests__/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@app': '/src',
      graphql: graphqlPath,
    },
  },
});
