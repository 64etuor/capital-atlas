import { defineConfig } from 'vitest/config'

// Pure-logic tests (fetch discipline, parsing, client cache) — node env,
// no DOM, no plugins from vite.config.ts needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
