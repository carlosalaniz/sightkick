import { describe, expect, it } from 'vitest';
import {
  adaptsPerBar,
  afterBarHit,
  afterBarMiss,
  barLevels,
  meanLevel,
} from './adaptive';

describe('per-bar guidance', () => {
  it('adapts only once you play the whole beat', () => {
    expect(adaptsPerBar('listen')).toBe(false);
    expect(adaptsPerBar('count')).toBe(false);
    expect(adaptsPerBar('limb')).toBe(false);
    expect(adaptsPerBar('all')).toBe(true);
    expect(adaptsPerBar('read')).toBe(true);
    expect(adaptsPerBar('mix')).toBe(true);
  });

  it('starts every bar at the step level, and keeps stored levels for the same window and step', () => {
    expect(barLevels(undefined, 'a', 4, 0.6)).toEqual([0.6, 0.6, 0.6, 0.6]);
    expect(
      barLevels({ key: 'a', levels: [1, 0.5, 1, 1] }, 'a', 4, 0.6),
    ).toEqual([1, 0.5, 1, 1]);
    expect(
      barLevels({ key: 'b', levels: [1, 0.5, 1, 1] }, 'a', 4, 0.6),
    ).toEqual([0.6, 0.6, 0.6, 0.6]);
  });

  it('fades only the bar you hit in, more for a closer hit', () => {
    const start = [1, 1, 1, 1];
    const close = afterBarHit(start, 1, 5);
    const loose = afterBarHit(start, 1, 60);

    expect(close[0]).toBe(1);
    expect(close[2]).toBe(1);
    expect(close[1]).toBeLessThan(1);
    expect(close[1]).toBeLessThan(loose[1]);
  });

  it('brings help back in the bar you missed in, never past full', () => {
    expect(afterBarMiss([0.5, 0.5], 0)[0]).toBeGreaterThan(0.5);
    expect(afterBarMiss([1, 1], 0)[0]).toBe(1);
  });

  it('ignores bars outside the window and unreadable offsets', () => {
    const start = [1, 1];

    expect(afterBarHit(start, 5, 5)).toBe(start);
    expect(afterBarHit(start, 0, Number.NaN)).toBe(start);
    expect(afterBarMiss(start, -1)).toBe(start);
  });

  it('averages the levels for the parts drawn once', () => {
    expect(meanLevel([1, 0, 0.5, 0.5])).toBeCloseTo(0.5);
    expect(meanLevel([])).toBe(0);
  });
});
