import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // Zimny import serwera (Better Auth, Kysely) potrafi przekroczyć domyślne 10 s.
    hookTimeout: 30_000,
  },
});
