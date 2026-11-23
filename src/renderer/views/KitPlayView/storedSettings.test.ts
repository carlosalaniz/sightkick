import { describe, expect, it } from 'vitest';
import {
  parseGemsAheadMs,
  parseKitPlayLayout,
  parseSheetLanesProgressMap,
} from './storedSettings';

describe('parseKitPlayLayout', () => {
  it('keeps a known layout', () => {
    expect(parseKitPlayLayout('kit')).toBe('kit');
    expect(parseKitPlayLayout('lanes')).toBe('lanes');
  });

  it('rejects anything else', () => {
    expect(parseKitPlayLayout('rails')).toBeUndefined();
    expect(parseKitPlayLayout(null)).toBeUndefined();
    expect(parseKitPlayLayout(3)).toBeUndefined();
  });
});

describe('parseGemsAheadMs', () => {
  it('keeps one of the menu options only', () => {
    expect(parseGemsAheadMs(800)).toBe(800);
    expect(parseGemsAheadMs(801)).toBeUndefined();
    expect(parseGemsAheadMs('800')).toBeUndefined();
  });
});

describe('parseSheetLanesProgressMap', () => {
  const probe = {
    at: 1,
    start: 4,
    end: 8,
    accuracy: 0.9,
    sdMs: 12,
    tempo: 1,
  };

  it('keeps valid progress as it was', () => {
    const stored = { song: { best100: 0.8, seenTo: 8, probes: [probe] } };

    expect(parseSheetLanesProgressMap(stored)).toEqual(stored);
  });

  it('repairs an entry with no probes instead of dropping it', () => {
    expect(parseSheetLanesProgressMap({ song: { seenTo: 12 } })).toEqual({
      song: { seenTo: 12, probes: [] },
    });
  });

  it('drops broken probes, fields and entries', () => {
    expect(
      parseSheetLanesProgressMap({
        song: { best100: 'high', probes: [probe, { at: 2 }] },
        other: 3,
      }),
    ).toEqual({ song: { probes: [probe] } });
  });

  it('rejects a value that is not a map', () => {
    expect(parseSheetLanesProgressMap(null)).toBeUndefined();
    expect(parseSheetLanesProgressMap([])).toBeUndefined();
  });
});
