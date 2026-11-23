/**
 * Pass scoring for the sheet-lanes view: timing tiers inside the user's hit
 * window, the per-pass summary, the tempo ladder and the streak multiplier.
 * All times are real (wall-clock) milliseconds, i.e. already divided by the
 * playback speed. Pass and star limits are in `../shared/judging`.
 */

import {
  SHEET_LANES_CLEAN_ACCURACY,
  SHEET_LANES_CLEAN_MAX_MISSES,
  SHEET_LANES_ROUGH_ACCURACY,
  SHEET_LANES_STAR_ACCURACY,
  starsFromAccuracy,
} from '../shared/judging';
import { multiplierAfterHit, multiplierAfterMiss } from '../shared/multiplier';

export type TierId = 'perfect' | 'great' | 'good' | 'ok';

export type NoteResult =
  | { tier: TierId; offsetMs: number }
  | { tier: 'miss'; offsetMs?: undefined };

export interface Tier {
  id: TierId;
  /** Upper bound of |offset| for this tier; `ok` takes the rest of the window. */
  limitMs: number;
  /** Accuracy credit, 0–1. */
  weight: number;
  points: number;
  color: string;
  label: string;
}

export const TIERS: Tier[] = [
  {
    id: 'perfect',
    limitMs: 20,
    weight: 1,
    points: 100,
    color: '#2c8c52',
    label: 'Perfect',
  },
  {
    id: 'great',
    limitMs: 40,
    weight: 0.9,
    points: 80,
    color: '#6a9a2e',
    label: 'Great',
  },
  {
    id: 'good',
    limitMs: 70,
    weight: 0.7,
    points: 50,
    color: '#b08a14',
    label: 'Good',
  },
  {
    id: 'ok',
    limitMs: Infinity,
    weight: 0.4,
    points: 20,
    color: '#c46a2a',
    label: 'OK',
  },
];

export const TIER_BY_ID = Object.fromEntries(
  TIERS.map((t) => [t.id, t]),
) as Record<TierId, Tier>;

export const MISS_COLOR = '#c62828';

/** Every judged hit is inside the window, so anything past ±70 ms is `ok`. */
export function gradeHit(offsetMs: number): TierId {
  const abs = Math.abs(offsetMs);

  return (TIERS.find((t) => abs <= t.limitMs) ?? TIERS[TIERS.length - 1]).id;
}

/** Range label for a tier, e.g. `±40`; `ok` shows the hit window. */
export function tierRange(tier: Tier, windowMs: number): string {
  return `±${Math.round(
    Number.isFinite(tier.limitMs) ? tier.limitMs : windowMs,
  )}`;
}

export const mean = (a: number[]): number =>
  a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** Population standard deviation. */
export const sd = (a: number[]): number => {
  const m = mean(a);

  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export const clamp = (x: number, lo = 0, hi = 1): number =>
  Math.max(lo, Math.min(hi, x));

export interface PassStats {
  total: number;
  /** Mean tier weight, misses count as 0. */
  accuracy: number;
  misses: number;
  counts: Record<TierId | 'miss', number>;
  /** Mean signed offset of the hits; negative is early. */
  meanMs: number;
  /** Spread (SD) of the hit offsets. */
  sdMs: number;
  /** 0–3, from `SHEET_LANES_STAR_ACCURACY`. */
  stars: number;
}

export function evaluatePass(results: NoteResult[]): PassStats {
  const counts: PassStats['counts'] = {
    perfect: 0,
    great: 0,
    good: 0,
    ok: 0,
    miss: 0,
  };
  const offsets: number[] = [];
  let credit = 0;

  for (const r of results) {
    counts[r.tier] += 1;

    if (r.tier !== 'miss') {
      credit += TIER_BY_ID[r.tier].weight;
      offsets.push(r.offsetMs);
    }
  }

  const accuracy = results.length > 0 ? credit / results.length : 0;

  return {
    total: results.length,
    accuracy,
    misses: counts.miss,
    counts,
    meanMs: mean(offsets),
    sdMs: sd(offsets),
    stars: starsFromAccuracy(accuracy, SHEET_LANES_STAR_ACCURACY),
  };
}

export type PassOutcome = 'clean' | 'fail' | 'close';

/** Clean: few enough misses and accurate enough. Clear fail: under the rough limit. */
export function passOutcome(
  stats: Pick<PassStats, 'accuracy' | 'misses'>,
): PassOutcome {
  if (
    stats.misses <= SHEET_LANES_CLEAN_MAX_MISSES &&
    stats.accuracy >= SHEET_LANES_CLEAN_ACCURACY
  ) {
    return 'clean';
  }

  return stats.accuracy < SHEET_LANES_ROUGH_ACCURACY ? 'fail' : 'close';
}

/** Tempo ladder rungs as playback speeds; the last two are over-speed. */
export const RUNGS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1];

export const START_RUNG = 2;

export interface LadderState {
  index: number;
  /** Clean passes in a row at this rung. */
  clean: number;
  /** Clear fails in a row at this rung. */
  fails: number;
}

export interface LadderStep {
  state: LadderState;
  verdict: string;
  good: boolean;
}

const pct = (i: number) => `${Math.round(RUNGS[i] * 100)}%`;

/** Two clean passes go up a rung, two clear fails go down, anything else stays. */
export function ladderStep(
  state: LadderState,
  outcome: PassOutcome,
): LadderStep {
  const top = RUNGS.length - 1;

  if (outcome === 'clean') {
    if (state.clean + 1 >= 2) {
      if (state.index < top) {
        const index = state.index + 1;

        return {
          state: { index, clean: 0, fails: 0 },
          verdict: `Two clean passes. Tempo up to ${pct(index)}.`,
          good: true,
        };
      }

      return {
        state: { index: state.index, clean: 0, fails: 0 },
        verdict: 'Clean at the top over-speed rung.',
        good: true,
      };
    }

    return {
      state: { index: state.index, clean: state.clean + 1, fails: 0 },
      verdict: `Clean pass. One more moves you to ${pct(
        Math.min(state.index + 1, top),
      )}.`,
      good: true,
    };
  }

  if (outcome === 'fail') {
    if (state.fails + 1 >= 2 && state.index > 0) {
      const index = state.index - 1;

      return {
        state: { index, clean: 0, fails: 0 },
        verdict: `Two rough passes. Tempo down to ${pct(index)}.`,
        good: false,
      };
    }

    return {
      state: { index: state.index, clean: 0, fails: state.fails + 1 },
      verdict:
        state.index > 0
          ? 'Rough pass. Another one drops the tempo.'
          : 'Rough pass. This is already the slowest rung.',
      good: false,
    };
  }

  return {
    state: { index: state.index, clean: 0, fails: 0 },
    verdict: `Close. Staying at ${pct(state.index)}.`,
    good: false,
  };
}

export interface StreakState {
  streak: number;
  /** 1–4, by the `steps` multiplier rule. */
  mult: number;
}

export function streakAfterHit(s: StreakState): StreakState {
  const streak = s.streak + 1;

  return { streak, mult: multiplierAfterHit('steps', s.mult, streak) };
}

export function streakAfterMiss(s: StreakState): StreakState {
  return { streak: 0, mult: multiplierAfterMiss('steps', s.mult) };
}

/** Points for a hit: tier points × multiplier × reading bonus for that bar. */
export function hitPoints(tier: TierId, mult: number, guide: number): number {
  return Math.round(TIER_BY_ID[tier].points * mult * readingBonus(guide));
}

/** 1 with full guidance, up to 2 with plain notation. */
export function readingBonus(guide: number): number {
  return 1 + (1 - clamp(guide));
}
