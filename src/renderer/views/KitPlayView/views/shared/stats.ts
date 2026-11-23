/** Small numeric helpers shared by the play views' scoring and drawing. */

export const clamp = (x: number, lo = 0, hi = 1): number =>
  Math.max(lo, Math.min(hi, x));

/** Mean of `a`; 0 for an empty list. */
export const mean = (a: number[]): number =>
  a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** Population standard deviation; 0 for an empty list. */
export const sd = (a: number[]): number => {
  const m = mean(a);

  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
