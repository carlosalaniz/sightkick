/// <reference types="vite/client" />
import { log } from '../shared/log';

/**
 * Registers the service worker (sw.js, built from service-worker.js) that
 * makes SightKick installable and lets it open offline. Production builds
 * only: in development it would cache files Vite serves fresh on every edit.
 */
export function registerServiceWorker(
  nav: Navigator = navigator,
  production: boolean = import.meta.env.PROD,
): void {
  if (!production || !('serviceWorker' in nav) || !window.isSecureContext) {
    return;
  }

  const register = () => {
    nav.serviceWorker.register('./sw.js').catch((error: unknown) => {
      log.warn('pwa.service_worker_registration_failed', {
        error: String(error),
      });
    });
  };

  // After load, so registering doesn't compete with the app's first paint.
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
