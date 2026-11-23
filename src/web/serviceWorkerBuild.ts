// Build-time stamping of the service worker (src/web/service-worker.js),
// used by vite.web.config.ts. Kept here, apart from the config, so it can be
// tested.

/** Replaced with the build's ID, which names the worker's cache. */
export const BUILD_ID_TOKEN = '__SK_BUILD_ID__';

/** Replaced with the build's hashed files, cached when the worker installs. */
export const PRECACHE_TOKEN = '/* __SK_PRECACHE__ */';

/**
 * The build's own files the worker caches at install, as URLs relative to
 * its scope. Without them an installed app only opened offline if every
 * file had happened to be fetched (and cached) online before. The page
 * itself is cached as './'; the worker, version.json and source maps never.
 */
export function precacheFiles(fileNames: string[]): string[] {
  return fileNames
    .filter(
      (name) =>
        name !== 'sw.js' &&
        name !== 'version.json' &&
        name !== 'index.html' &&
        !name.endsWith('.map'),
    )
    .sort()
    .map((name) => `./${name}`);
}

export function stampServiceWorker(
  source: string,
  buildId: string,
  fileNames: string[],
): string {
  if (!source.includes(BUILD_ID_TOKEN) || !source.includes(PRECACHE_TOKEN)) {
    throw new Error('service-worker.js lost its build placeholders');
  }

  return source.replaceAll(BUILD_ID_TOKEN, buildId).replace(
    PRECACHE_TOKEN,
    precacheFiles(fileNames)
      .map((url) => JSON.stringify(url))
      .join(', '),
  );
}
