import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  // The app is served from a sub-path of mouro.ai, so every emitted asset URL
  // needs this prefix. Leading AND trailing slash — and note React Router's
  // `basename` uses the opposite convention (leading slash, no trailing one).
  // Getting these out of step yields a blank page with assets that load fine.
  base: '/yahtzee/',
  plugins: [react()],
  resolve: {
    // TS `paths` alone does not resolve at build time — the bundler needs this
    // alias to agree with tsconfig.app.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The pure engine is the only thing worth covering; the UI is untested by
    // design, so tests run in plain Node with no DOM environment.
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      include: ['src/engine/**/*.ts'],
    },
  },
});
