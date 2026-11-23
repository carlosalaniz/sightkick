/**
 * The user asked the OS for less motion. The kit drawings and play views
 * skip or shorten their animations when this is true. Safe to call where
 * there is no window or no matchMedia (tests, workers).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
