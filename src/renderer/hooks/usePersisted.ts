import { useEffect, useState } from 'react';
import { log } from '../../shared/log';

/**
 * Checks a stored value. Returns the value as `T`, or undefined when it can't
 * be used (wrong shape, out of range); the hook then falls back.
 */
export type PersistedParser<T> = (raw: unknown) => T | undefined;

function load<T>(key: string, fallback: T, parse?: PersistedParser<T>): T {
  let raw: string | null;
  let json: unknown;

  try {
    raw = localStorage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    json = JSON.parse(raw);
  } catch (err) {
    log.warn('persisted.unreadable', { key, error: String(err) });

    return fallback;
  }

  if (!parse) {
    // Keys without a parser still trust their stored shape; give them one.
    return json as T;
  }

  const value = parse(json);

  if (value === undefined) {
    log.warn('persisted.invalid', { key });

    return fallback;
  }

  return value;
}

/**
 * State kept in localStorage under `key`. Stored data outlives the code that
 * wrote it, so pass `parse` to check it on load: a value it rejects is
 * replaced by `fallback` (and logged) instead of reaching the app.
 */
export function usePersisted<T>(
  key: string,
  fallback: T,
  parse?: PersistedParser<T>,
) {
  const [value, setValue] = useState<T>(() => load(key, fallback, parse));

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}
