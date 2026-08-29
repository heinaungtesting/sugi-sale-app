import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    env: {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
    },
  },
});
