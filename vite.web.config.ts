import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
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
    {
      // The service worker that makes the app installable, stamped with the
      // build so each deploy replaces the previous worker and its cache.
      name: 'sightkick-service-worker',
      generateBundle() {
        const id = `${build.commit.slice(0, 12)}-${Date.now().toString(36)}`;

        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: readFileSync(
            path.resolve(__dirname, 'src/web/service-worker.js'),
            'utf8',
          ).replaceAll('__SK_BUILD_ID__', id),
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
