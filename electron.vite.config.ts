import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildInfo } from './scripts/build-info';

export default defineConfig({
  main: {
    build: { externalizeDeps: true, watch: {} },
  },
  preload: {
    build: { externalizeDeps: true },
  },
  renderer: {
    plugins: [tailwindcss(), react()],
    define: {
      __SK_WEB__: 'false',
      __SK_BUILD__: JSON.stringify(buildInfo()),
    },
    server: {
      watch: {
        ignored: ['**/*.test.*', '**/*.stories.*'],
      },
    },
  },
});
