import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createRendererCspPlugin } from './build/renderer-csp';

export default defineConfig(({ command }) => {
  const rendererMode = command === 'serve' ? 'development' : 'production';

  return {
    main: {},
    preload: {
      build: {
        // Sandboxed preload scripts run in Electron's restricted preload environment, not in the
        // normal Node ESM loader. Keep the preload bundle CommonJS even though the app package is
        // ESM, and bundle non-Electron dependencies if any are added later.
        externalizeDeps: false,
        rollupOptions: {
          external: ['electron'],
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
            chunkFileNames: '[name]-[hash].cjs',
          },
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
        },
      },
      plugins: [createRendererCspPlugin(rendererMode), react(), tailwindcss()],
    },
  };
});
