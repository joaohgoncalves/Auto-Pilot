import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@autopilotops/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
    }
  },
  test: {
    setupFiles: ['./src/tests/setup-env.ts'],
    exclude: ['**/node_modules/**', '**/dist/**']
  }
});
