import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { buildInfo } from './scripts/build-info';

const build = buildInfo();

// Browser-only build: the renderer plus src/web, which stands in for the
// Electron main process. Output is a static site in out/web.
export default defineConfig({
  root: path.resolve(__dirname, 'src/web'),
  // Relative asset URLs so the site works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [
    tailwindcss(),
    react(),
    {
      // GET version.json to see which build a server runs.
      name: 'sightkick-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify(build, null, 2)}\n`,
        });
      },
    },
  ],
  define: {
    __SK_WEB__: 'true',
    __SK_BUILD__: JSON.stringify(build),
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
