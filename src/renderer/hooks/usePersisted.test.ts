import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from './test-support';
import { usePersisted } from './usePersisted';

const asCount = (raw: unknown) =>
  typeof raw === 'number' && raw >= 0 ? raw : undefined;

describe('usePersisted', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installLocalStorage();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const load = (parse?: (raw: unknown) => number | undefined) =>
    renderHook(() => usePersisted('count', 7, parse)).result.current[0];

  it('uses the fallback when nothing is stored', () => {
    expect(load(asCount)).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads a stored value the parser accepts', () => {
    localStorage.setItem('count', '3');

    expect(load(asCount)).toBe(3);
  });

  it('falls back and logs the key when the parser rejects the stored value', () => {
    localStorage.setItem('count', '"three"');

    expect(load(asCount)).toBe(7);
    expect(warn).toHaveBeenCalledWith('persisted.invalid', { key: 'count' });
  });

  it('falls back and logs the key on stored text that is not JSON', () => {
    localStorage.setItem('count', '{oops');

    expect(load(asCount)).toBe(7);
    expect(warn).toHaveBeenCalledWith(
      'persisted.unreadable',
      expect.objectContaining({ key: 'count' }),
    );
  });

  it('still loads keys that have no parser as stored', () => {
    localStorage.setItem('count', '"three"');

    expect(load()).toBe('three');
  });

  it('writes the value back under its key', () => {
    renderHook(() => usePersisted('count', 7, asCount));

    expect(localStorage.getItem('count')).toBe('7');
  });
});
