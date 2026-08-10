import { defineConfig } from 'vitest/config';

// Routing/logic tests are pure functions — no DOM needed, so use the fast node env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/logic/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
