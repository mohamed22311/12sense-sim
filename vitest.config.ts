import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Decision modules are pure functions — no DOM needed, so the fast node env.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // The vendored mobile tests use Jest-style global describe/it/expect.
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/phone/**/*.ts', 'src/net/**/*.ts', 'src/runtime/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
