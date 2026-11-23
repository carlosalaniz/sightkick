import { log } from '../shared/log';

// Minimal promise wrapper around one IndexedDB object store used as a
// key/value map. Values must be structured-cloneable (directory handles are).

const DB_NAME = 'sightkick';
const DB_VERSION = 1;
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase> | undefined;

function forgetDb(): void {
  dbPromise = undefined;
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;

        // Another tab upgrading the database waits for this connection to
        // close; close it and reopen on the next call rather than block it.
        db.onversionchange = () => {
          db.close();
          forgetDb();
        };
        // The browser closed it (storage cleared, disk error): reopen next time.
        db.onclose = forgetDb;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      // Another tab still has an older version open. The open goes through
      // once that tab closes it, so keep waiting, but leave a trace.
      request.onblocked = () => {
        log.warn('idb.open_blocked', { db: DB_NAME, version: DB_VERSION });
      };
    });

    dbPromise = opening;
    // A failed open isn't cached: the next call tries again instead of every
    // read failing until the page reloads.
    opening.catch((error: unknown) => {
      log.error('idb.open_failed', { db: DB_NAME }, error);

      if (dbPromise === opening) {
        forgetDb();
      }
    });
  }

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = op(tx.objectStore(STORE));

        tx.oncomplete = () => resolve(request.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (store) => store.get(key));
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return run<void>('readwrite', (store) => store.put(value, key));
}

/**
 * Reads, changes and writes one key in a single readwrite transaction, so a
 * write from another handler can't land between the read and the write and
 * be lost. `update` must be synchronous: the transaction commits as soon as
 * it has no pending requests, so no awaiting (and no I/O) inside it. A throw
 * from `update` aborts the transaction and rejects with that error.
 */
export function idbUpdate<T>(
  key: string,
  update: (current: unknown) => T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const read = store.get(key);
        let next: { value: T } | undefined;
        let failure: { error: unknown } | undefined;

        read.onsuccess = () => {
          try {
            next = { value: update(read.result) };
            store.put(next.value, key);
          } catch (error) {
            failure = { error };
            tx.abort();
          }
        };
        tx.oncomplete = () => {
          if (next) {
            resolve(next.value);
          } else {
            reject(new Error(`idbUpdate("${key}") finished without a value`));
          }
        };
        tx.onerror = () => reject(failure ? failure.error : tx.error);
        tx.onabort = () => reject(failure ? failure.error : tx.error);
      }),
  );
}
