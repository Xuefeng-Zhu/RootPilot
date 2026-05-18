import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@rootpilot/shared': path.resolve(__dirname, './packages/shared/src'),
    },
  },
  test: {
    globals: true,
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
    setupFiles: ['./apps/web/src/test-setup.ts'],
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
    },
  },
});
