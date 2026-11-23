// SightKick's service worker, emitted as sw.js by vite.web.config.ts, which
// stamps the cache name with the build, so every deploy installs a new worker
// and drops the old cache, and lists the build's hashed files in PRECACHE
// (see src/web/serviceWorkerBuild.ts).
//
// Network first: the app loads the newest build when the server answers,
// and the cached copy when it doesn't (offline at the kit) or takes longer
// than NETWORK_TIMEOUT_MS (a captive or dying connection that never fails).
// Cache first would keep serving an old build after a deploy. Only the app's
// own files are cached: never the stem server (/stem-api/), version.json or
// other sites. Songs live in the browser's own storage, not here.

const CACHE = 'sightkick-__SK_BUILD_ID__';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png'];
// The build's scripts, styles, fonts and images. Caching them at install is
// what lets the app open offline: the page alone is useless without them.
const PRECACHE = [
  /* __SK_PRECACHE__ */
];
// How long to wait for the network before serving the cached copy.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sightkick-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheable(request) {
  if (request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  return (
    url.origin === scope.origin &&
    url.pathname.startsWith(scope.pathname) &&
    !url.pathname.includes('/stem-api/') &&
    !url.pathname.endsWith('/version.json')
  );
}

async function fromCache(request) {
  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  // The app is one page; any navigation offline gets it.
  if (request.mode === 'navigate') {
    return caches.match('./');
  }

  return undefined;
}

async function networkFirst(request) {
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();

      caches
        .open(CACHE)
        .then((cache) => cache.put(request, copy))
        .catch((error) => {
          console.warn('sw.cache_put_failed', { url: request.url, error });
        });
    }

    return response;
  });
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), NETWORK_TIMEOUT_MS);
  });

  try {
    const first = await Promise.race([network, timedOut]);

    if (first !== 'timed-out') {
      return first;
    }

    const cached = await fromCache(request);

    if (cached) {
      // The network keeps going and refreshes the cache for next time.
      network.catch((error) => {
        console.warn('sw.network_failed', { url: request.url, error });
      });

      return cached;
    }

    // Nothing cached: the slow network is the only answer there is.
    return await network;
  } catch (error) {
    console.warn('sw.network_failed', { url: request.url, error });

    return (await fromCache(request)) ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!cacheable(request)) {
    return;
  }

  event.respondWith(networkFirst(request));
});
