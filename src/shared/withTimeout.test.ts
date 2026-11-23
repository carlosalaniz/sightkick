import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through work that finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(3), 100, 'work')).resolves.toBe(3);
  });

  it('rejects with a TimeoutError naming the work when it runs long', async () => {
    vi.useFakeTimers();

    const pending = withTimeout(new Promise(() => {}), 100, 'resume');
    const settled = expect(pending).rejects.toThrow(
      new TimeoutError('resume', 100),
    );

    await vi.advanceTimersByTimeAsync(100);
    await settled;
  });

  it('passes through the work failing on its own', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 100, 'work'),
    ).rejects.toThrow('boom');
  });
});
