/** A bounded piece of work that didn't finish in time. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Bounds any promise. Prefer passing an AbortSignal (AbortSignal.timeout) to
 * calls that take one, such as fetch, so the work itself stops; use this for
 * the ones that don't, such as AudioContext.resume().
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
