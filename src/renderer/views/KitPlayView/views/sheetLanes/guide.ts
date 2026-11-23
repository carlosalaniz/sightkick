import { clamp, mean, TierId } from './scoring';

/**
 * How much guidance is left per bar, 0 (plain notation) to 1 (wide colored
 * lanes, labels, gems and kit hints). Adaptive mode fades a bar as it is
 * played accurately and brings it back on misses.
 */
export type GuideMode = 'adaptive' | 'full' | 'fading' | 'sheet';

export const GUIDE_MODES: { value: GuideMode; label: string }[] = [
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'full', label: 'Full' },
  { value: 'fading', label: 'Fading' },
  { value: 'sheet', label: 'Sheet only' },
];

export function isGuideMode(v: unknown): v is GuideMode {
  return GUIDE_MODES.some((m) => m.value === v);
}

/** The fixed level of a non-adaptive mode. */
export function presetLevel(mode: GuideMode): number | undefined {
  return { adaptive: undefined, full: 1, fading: 0.5, sheet: 0 }[mode];
}

/** Levels for a fresh loop of `bars` bars; adaptive starts at full guidance. */
export function initialLevels(mode: GuideMode, bars: number): number[] {
  return Array.from({ length: bars }, () => presetLevel(mode) ?? 1);
}

const HIT_FADE: Record<TierId, number> = {
  perfect: 0.035,
  great: 0.03,
  good: 0.01,
  ok: -0.02,
};

export const MISS_RESTORE = 0.08;

export function fadeAfterHit(level: number, tier: TierId): number {
  return clamp(level - HIT_FADE[tier]);
}

export function fadeAfterMiss(level: number): number {
  return clamp(level + MISS_RESTORE);
}

/** Lane height (staff half-space) in SVG units: 10 (plain staff) to 18. */
export function laneSpacing(levels: number[]): number {
  return 10 + 2 * Math.round(4 * clamp((mean(levels) - 0.4) / 0.6));
}

/** Gems fade out first, over the upper half of the guide. */
export const gemLevel = (g: number): number => clamp((g - 0.5) / 0.5);

/** Note-head color mix, in steps of 5%. */
export const colorLevel = (g: number): number =>
  Math.round(clamp((g - 0.2) / 0.3) * 20) / 20;

/** Beat shading and the 1 e & a count, which go last. */
export const countLevel = (g: number): number => clamp(g / 0.2);

/** Opacity of the colored lane bands. */
export const laneLevel = (g: number): number => 0.26 * clamp((g - 0.5) / 0.5);

/** Pad labels beside the staff (the clef shows as they fade). */
export const labelLevel = (levels: number[]): number =>
  clamp((mean(levels) - 0.25) / 0.45);

/** Closing rings on the kit before each hit. */
export const kitGlowLevel = (levels: number[]): number =>
  clamp(mean(levels) / 0.5);

/**
 * Visibility of a gem `dt` real seconds before its note (negative after),
 * with gems appearing `ahead` seconds early. Hit gems vanish, missed ones
 * stay faint.
 */
export function gemFade(
  dt: number,
  ahead: number,
  status: 'hit' | 'miss' | undefined,
): number {
  if (status === 'miss') {
    return 0.3;
  }

  if (status === 'hit') {
    return 0;
  }

  if (dt > ahead) {
    return 0;
  }

  if (dt > ahead * 0.75) {
    return (ahead - dt) / (ahead * 0.25);
  }

  return dt < -0.12 ? clamp(1 + (dt + 0.12) / 0.2) : 1;
}
