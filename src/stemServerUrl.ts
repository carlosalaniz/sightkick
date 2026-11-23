// Shared by the browser build's stem-server client and the settings UI.

/**
 * Where the web app looks for the stem server unless the user picks another
 * address. Set at build time with SK_STEM_SERVER_URL (vite.web.config.ts): the
 * Docker image uses "/stem-api", proxied by its nginx to the stem server.
 * Everything else (dev server, GitHub Pages, tests) uses a local server.
 */
export const DEFAULT_STEM_SERVER_URL =
  typeof __SK_STEM_SERVER_URL__ === 'string' && __SK_STEM_SERVER_URL__
    ? __SK_STEM_SERVER_URL__
    : 'http://localhost:8765';
