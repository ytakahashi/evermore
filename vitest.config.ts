import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    css: true,
    environment: 'jsdom',
    include: ['src/{main,renderer/src,shared}/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
