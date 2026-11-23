import { describe, expect, it } from 'vitest';
import {
  colorLevel,
  countLevel,
  fadeAfterHit,
  fadeAfterMiss,
  gemFade,
  gemLevel,
  initialLevels,
  kitGlowLevel,
  labelLevel,
  laneLevel,
  laneSpacing,
  presetLevel,
} from './guide';

describe('guide levels', () => {
  it('fixed modes use their preset, adaptive starts full', () => {
    expect(initialLevels('full', 4)).toEqual([1, 1, 1, 1]);
    expect(initialLevels('fading', 2)).toEqual([0.5, 0.5]);
    expect(initialLevels('sheet', 3)).toEqual([0, 0, 0]);
    expect(initialLevels('adaptive', 2)).toEqual([1, 1]);
    expect(presetLevel('adaptive')).toBeUndefined();
  });

  it('fades on accurate hits, comes back on sloppy hits and misses', () => {
    expect(fadeAfterHit(1, 'perfect')).toBeCloseTo(0.965);
    expect(fadeAfterHit(1, 'great')).toBeCloseTo(0.97);
    expect(fadeAfterHit(0.5, 'good')).toBeCloseTo(0.49);
    expect(fadeAfterHit(0.5, 'ok')).toBeCloseTo(0.52);
    expect(fadeAfterMiss(0.5)).toBeCloseTo(0.58);
    expect(fadeAfterHit(0.01, 'perfect')).toBe(0);
    expect(fadeAfterMiss(0.99)).toBe(1);
  });

  it('a clean bar of 16 perfect hits takes about half the guide off', () => {
    let g = 1;

    for (let i = 0; i < 16; i += 1) {
      g = fadeAfterHit(g, 'perfect');
    }

    expect(g).toBeCloseTo(0.44);
  });
});

describe('what each level shows', () => {
  it('narrows the lanes from 18 to the plain 10-unit staff', () => {
    expect(laneSpacing([1, 1])).toBe(18);
    expect(laneSpacing([0.7, 0.7])).toBe(14);
    expect(laneSpacing([0.4])).toBe(10);
    expect(laneSpacing([0])).toBe(10);
  });

  it('fades gems and lanes first, colors next, the count last', () => {
    const g = 0.45;

    expect(gemLevel(g)).toBe(0);
    expect(laneLevel(g)).toBe(0);
    expect(colorLevel(g)).toBeCloseTo(0.85);
    expect(countLevel(g)).toBe(1);
    expect(countLevel(0.1)).toBeCloseTo(0.5);
    expect(colorLevel(0.2)).toBe(0);
    expect(laneLevel(1)).toBeCloseTo(0.26);
  });

  it('fades labels and the kit hints by the mean level', () => {
    expect(labelLevel([1, 1])).toBe(1);
    expect(labelLevel([0.25])).toBe(0);
    expect(kitGlowLevel([0.5, 0.5])).toBe(1);
    expect(kitGlowLevel([0.25])).toBe(0.5);
  });
});

describe('gemFade', () => {
  it('fades gems in over the first quarter of the look-ahead', () => {
    expect(gemFade(1.3, 1.2, undefined)).toBe(0);
    expect(gemFade(1.05, 1.2, undefined)).toBeCloseTo(0.5);
    expect(gemFade(0.5, 1.2, undefined)).toBe(1);
  });

  it('fades out shortly after an unplayed note passes', () => {
    expect(gemFade(-0.1, 1.2, undefined)).toBe(1);
    expect(gemFade(-0.22, 1.2, undefined)).toBeCloseTo(0.5);
    expect(gemFade(-0.5, 1.2, undefined)).toBe(0);
  });

  it('hides hit gems and keeps missed ones faint', () => {
    expect(gemFade(0, 1.2, 'hit')).toBe(0);
    expect(gemFade(-1, 1.2, 'miss')).toBe(0.3);
  });
});
