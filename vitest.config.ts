import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/**/*.test.{ts,tsx}'], testTimeout: 60000 } });
