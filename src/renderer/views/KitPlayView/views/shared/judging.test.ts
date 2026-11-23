import { describe, expect, it } from 'vitest';
import {
  ARCADE_STAR_ACCURACY,
  limitPercent,
  SHEET_LANES_STAR_ACCURACY,
  starsFromAccuracy,
} from './judging';

describe('starsFromAccuracy', () => {
  it('counts the limits reached, each one inclusive', () => {
    const stars = (a: number) => starsFromAccuracy(a, ARCADE_STAR_ACCURACY);

    expect(stars(0.49)).toBe(0);
    expect(stars(0.5)).toBe(1);
    expect(stars(0.65)).toBe(2);
    expect(stars(0.8)).toBe(3);
    expect(stars(0.9)).toBe(4);
    expect(stars(0.95)).toBe(5);
    expect(stars(1)).toBe(5);
  });

  it('gives sheet lanes three stars at most', () => {
    const stars = (a: number) =>
      starsFromAccuracy(a, SHEET_LANES_STAR_ACCURACY);

    expect(stars(0.69)).toBe(0);
    expect(stars(0.7)).toBe(1);
    expect(stars(0.85)).toBe(2);
    expect(stars(0.95)).toBe(3);
  });
});

describe('limitPercent', () => {
  it('rounds to a whole percent', () => {
    expect(limitPercent(0.6)).toBe('60%');
    expect(limitPercent(0.855)).toBe('86%');
  });
});
