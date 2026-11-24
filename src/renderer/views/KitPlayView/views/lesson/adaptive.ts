import { assertNever } from '../../../../../shared/assertNever';
import { fadeAfterHit, fadeAfterMiss } from '../sheetLanes/guide';
import { gradeHit } from '../sheetLanes/scoring';
import { StepKind } from './steps';

/**
 * Per-bar guidance for the coach view (v14), taken from sheet lanes (v6):
 * once you play the whole beat, each bar's colors, lanes and counting fade
 * as you play that bar accurately and come back when you miss in it, so the
 * help sits exactly where you still need it rather than fading for the
 * whole window at once.
 */
export interface BarGuide {
  /** Which window and step the levels belong to; anything else starts over. */
  key: string;
  levels: number[];
}

/** Steps whose help adapts bar by bar; the rest keep the step's fixed level. */
export function adaptsPerBar(kind: StepKind): boolean {
  switch (kind) {
    case 'listen':
    case 'count':
    case 'limb':
      return false;

    case 'all':
    case 'read':
    case 'mix':
      return true;

    default:
      return assertNever(kind, 'step kind');
  }
}

/** The levels for this window and step: the stored ones, or `start` in every bar. */
export function barLevels(
  stored: BarGuide | undefined,
  key: string,
  bars: number,
  start: number,
): number[] {
  return stored?.key === key && stored.levels.length === bars
    ? stored.levels
    : Array.from({ length: bars }, () => start);
}

/**
 * A hit in `bar`, `realMs` off the note in real (wall-clock) time: the closer
 * it is, the more that bar's help fades.
 */
export function afterBarHit(
  levels: number[],
  bar: number,
  realMs: number,
): number[] {
  if (bar < 0 || bar >= levels.length || !Number.isFinite(realMs)) {
    return levels;
  }

  return levels.map((l, i) =>
    i === bar ? fadeAfterHit(l, gradeHit(realMs)) : l,
  );
}

/** A miss in `bar`: some of that bar's help comes back. */
export function afterBarMiss(levels: number[], bar: number): number[] {
  if (bar < 0 || bar >= levels.length) {
    return levels;
  }

  return levels.map((l, i) => (i === bar ? fadeAfterMiss(l) : l));
}

/** The window's overall help, for things drawn once (lane bands, kit hints). */
export function meanLevel(levels: number[]): number {
  return levels.length === 0
    ? 0
    : levels.reduce((a, b) => a + b, 0) / levels.length;
}
