import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Browser-only build: the renderer plus src/web, which stands in for the
// Electron main process. Output is a static site in out/web.
export default defineConfig({
  root: path.resolve(__dirname, 'src/web'),
  // Relative asset URLs so the site works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [tailwindcss(), react()],
  define: {
    __SK_WEB__: 'true',
    // Default stem server address; the Docker image sets /stem-api.
    __SK_STEM_SERVER_URL__: JSON.stringify(
      process.env.SK_STEM_SERVER_URL ?? '',
    ),
  },
  build: {
    outDir: path.resolve(__dirname, 'out/web'),
    emptyOutDir: true,
  },
  server: {
    watch: {
      ignored: ['**/*.test.*', '**/*.stories.*'],
    },
  },
});
