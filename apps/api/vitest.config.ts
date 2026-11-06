import { defineConfig } from 'vitest/config';

// Vitest transforms TypeScript with oxc, which supports the legacy decorators
// Nest uses but does not emit decorator metadata. Providers are therefore
// injected with an explicit @Inject token rather than by type, so the same
// source works under Vitest and under the tsc build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: true,
    env: {
      APP_ENV: 'test',
      OBJECT_STORAGE_ENV: 'staging',
    },
  },
});
