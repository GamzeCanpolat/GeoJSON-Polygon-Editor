import { defineConfig } from 'vitest/config';
// Browser cases launch Vite against the same checkout; serialize to avoid
// dependency optimizer reloads invalidating another case's browser context.
export default defineConfig({ test: { include: ['tests/integration/**/*.test.ts'], testTimeout: 60000, fileParallelism: false } });
