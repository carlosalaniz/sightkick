import { describe, expect, it } from 'vitest';
import { barRangeLabel } from './sections';

describe('barRangeLabel', () => {
  it('labels bar ranges 1-based, singular for one bar', () => {
    expect(barRangeLabel(4, 8)).toBe('Bars 5–8');
    expect(barRangeLabel(0, 1)).toBe('Bar 1');
  });
});
