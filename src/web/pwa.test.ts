import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './pwa';

function fakeNavigator() {
  const register = vi.fn(() => Promise.resolve({}));

  return {
    nav: { serviceWorker: { register } } as unknown as Navigator,
    register,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerServiceWorker', () => {
  it('registers sw.js in a production build on a secure page', () => {
    vi.stubGlobal('isSecureContext', true);

    const { nav, register } = fakeNavigator();

    registerServiceWorker(nav, true);
    window.dispatchEvent(new Event('load'));

    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('stays out of development builds and insecure pages', () => {
    const { nav, register } = fakeNavigator();

    vi.stubGlobal('isSecureContext', true);
    registerServiceWorker(nav, false);
    vi.stubGlobal('isSecureContext', false);
    registerServiceWorker(nav, true);
    window.dispatchEvent(new Event('load'));

    expect(register).not.toHaveBeenCalled();
  });
});
