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
      // Completes once every request made on it has succeeded, like the real
      // one, so a request made from an onsuccess handler keeps it open.
      let pending = 0;
      const tx = {
        oncomplete: undefined as undefined | (() => void),
        onerror: undefined as undefined | (() => void),
        onabort: undefined as undefined | (() => void),
        error: null,
        aborted: false,
        abort: () => {
          tx.aborted = true;
          setTimeout(() => tx.onabort?.(), 0);
        },
        objectStore: () => ({
          get: (key: string) => request(() => data.get(key)),
          put: (value: unknown, key: string) =>
            request(() => {
              data.set(key, value);

              return key;
            }),
        }),
      };
      const request = (perform: () => unknown) => {
        const req = {
          result: undefined as unknown,
          onsuccess: undefined as undefined | (() => void),
        };

        pending += 1;
        setTimeout(() => {
          if (tx.aborted) {
            return;
          }

          req.result = perform();
          req.onsuccess?.();
          pending -= 1;

          if (pending === 0 && !tx.aborted) {
            tx.oncomplete?.();
          }
        }, 0);

        return req;
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

describe('idbUpdate', () => {
  it('reads and writes in one transaction and returns the new value', async () => {
    outcomes = ['ok'];

    const { idbGet, idbUpdate } = await import('./idb');

    await expect(idbUpdate('k', (current) => `${current}+`)).resolves.toBe(
      'v+',
    );
    await expect(idbGet('k')).resolves.toBe('v+');
  });

  it('aborts and rejects with the error the update threw', async () => {
    outcomes = ['ok'];

    const { idbGet, idbUpdate } = await import('./idb');

    await expect(
      idbUpdate('k', () => {
        throw new Error('not found');
      }),
    ).rejects.toThrow('not found');
    await expect(idbGet('k')).resolves.toBe('v');
  });
});
