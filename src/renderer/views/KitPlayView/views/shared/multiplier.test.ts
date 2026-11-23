import { describe, expect, it } from 'vitest';
import {
  MAX_MULTIPLIER,
  multiplierAfterHit,
  multiplierAfterMiss,
} from './multiplier';

describe('steps multiplier', () => {
  it('steps up every 10 hits in a row, up to the cap', () => {
    expect(multiplierAfterHit('steps', 1, 9)).toBe(1);
    expect(multiplierAfterHit('steps', 1, 10)).toBe(2);
    expect(multiplierAfterHit('steps', MAX_MULTIPLIER, 50)).toBe(
      MAX_MULTIPLIER,
    );
  });

  it('halves on a miss, never below 1', () => {
    expect(multiplierAfterMiss('steps', 4)).toBe(2);
    expect(multiplierAfterMiss('steps', 3)).toBe(1);
    expect(multiplierAfterMiss('steps', 1)).toBe(1);
  });
});

describe('streak multiplier', () => {
  it('follows the streak length, up to the cap', () => {
    expect(multiplierAfterHit('streak', 1, 9)).toBe(1);
    expect(multiplierAfterHit('streak', 1, 10)).toBe(2);
    expect(multiplierAfterHit('streak', 1, 29)).toBe(3);
    expect(multiplierAfterHit('streak', 1, 100)).toBe(MAX_MULTIPLIER);
  });

  it('drops back to 1 on a miss', () => {
    expect(multiplierAfterMiss('streak', 4)).toBe(1);
  });
});
