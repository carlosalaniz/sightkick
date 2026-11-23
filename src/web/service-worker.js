// SightKick's service worker, emitted as sw.js by vite.web.config.ts, which
// stamps the cache name with the build, so every deploy installs a new worker
// and drops the old cache.
//
// Network first: the app always loads the newest build when the server is
// reachable, and the cached copy only when it isn't (offline at the kit).
// Cache first would keep serving an old build after a deploy. Only the app's
// own files are cached: never the stem server (/stem-api/), version.json or
// other sites. Songs live in the browser's own storage, not here.

const CACHE = 'sightkick-__SK_BUILD_ID__';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
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

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!cacheable(request)) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();

          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) {
          return cached;
        }

        // The app is one page; any navigation offline gets it.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./');

          if (shell) {
            return shell;
          }
        }

        return Response.error();
      }),
  );
});
