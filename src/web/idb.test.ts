import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A bare-bones indexedDB: open() fails or succeeds as told, and the store is
// a Map. Enough to see how idb.ts handles its connection.
interface FakeRequest {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
}

function fakeDb(data: Map<string, unknown>) {
  const db = {
    onversionchange: undefined as undefined | (() => void),
    onclose: undefined as undefined | (() => void),
    close: vi.fn(),
    createObjectStore: vi.fn(),
    transaction: () => {
      const tx = {
        oncomplete: undefined as undefined | (() => void),
        onerror: undefined as undefined | (() => void),
        onabort: undefined as undefined | (() => void),
        error: null,
        objectStore: () => ({
          get: (key: string) => {
            const req = { result: data.get(key) };

            setTimeout(() => tx.oncomplete?.(), 0);

            return req;
          },
          put: (value: unknown, key: string) => {
            data.set(key, value);
            setTimeout(() => tx.oncomplete?.(), 0);

            return { result: key };
          },
        }),
      };

      return tx;
    },
  };

  return db;
}

let outcomes: ('fail' | 'ok' | 'blocked-then-ok')[];
let opens: number;
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  vi.resetModules();
  opens = 0;
  db = fakeDb(new Map([['k', 'v']]));
  vi.stubGlobal('indexedDB', {
    open: () => {
      opens += 1;

      const req: FakeRequest = {};
      const outcome = outcomes.shift() ?? 'ok';

      setTimeout(() => {
        if (outcome === 'fail') {
          req.error = new DOMException('broken', 'UnknownError');
          req.onerror?.();

          return;
        }

        if (outcome === 'blocked-then-ok') {
          req.onblocked?.();
        }

        req.result = db;
        req.onsuccess?.();
      }, 0);

      return req;
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('idb connection', () => {
  it('opens again after a failed open instead of failing for good', async () => {
    outcomes = ['fail', 'ok'];

    const { idbGet } = await import('./idb');

    await expect(idbGet('k')).rejects.toThrow('broken');
    await expect(idbGet('k')).resolves.toBe('v');
    expect(opens).toBe(2);
  });

  it('keeps one connection while it works', async () => {
    outcomes = ['ok'];

    const { idbGet, idbSet } = await import('./idb');

    await idbSet('k', 'w');
    await expect(idbGet('k')).resolves.toBe('w');
    expect(opens).toBe(1);
  });

  it('logs a blocked open and still finishes it', async () => {
    outcomes = ['blocked-then-ok'];

    const { idbGet } = await import('./idb');

    await expect(idbGet('k')).resolves.toBe('v');
    expect(console.warn).toHaveBeenCalledWith(
      'idb.open_blocked',
      expect.objectContaining({ db: 'sightkick' }),
    );
  });

  it('closes and reopens when another tab upgrades the database', async () => {
    outcomes = ['ok', 'ok'];

    const { idbGet } = await import('./idb');

    await idbGet('k');
    db.onversionchange?.();
    await idbGet('k');

    expect(db.close).toHaveBeenCalled();
    expect(opens).toBe(2);
  });
});
