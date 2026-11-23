import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  // Served from a sub-path of mouro.ai, so every emitted asset URL needs this
  // prefix: leading AND trailing slash. React Router's `basename` uses the
  // opposite convention (no trailing slash); src/app.tsx derives it from this
  // value so the two cannot drift. infra/Caddyfile must agree with it.
  base: '/tabby-eights/',
  plugins: [react()],
  resolve: {
    // TS `paths` alone does not resolve at build time — the bundler needs this
    // alias to agree with tsconfig.app.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Only the pure layers (engine + computer players) are tested; the UI is
    // untested by design, so tests run in plain Node with no DOM environment.
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      include: ['src/engine/**/*.ts', 'src/ai/**/*.ts'],
    },
  },
});
