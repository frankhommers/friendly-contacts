import * as path from "node:path";

import { defineConfig } from 'vitest/config';

// End-to-end tests against a real Radicale server; run with `npm run test:e2e`, not part of `npm run test:run`.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/setup/emptyObsidianMock.ts'),
      src: path.resolve(__dirname, './src'),
      tests: path.resolve(__dirname, './tests'),
    },
  },
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
