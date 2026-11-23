/**
 * Pass scoring for the sheet-lanes view: timing tiers inside the user's hit
 * window, the per-pass summary, the tempo ladder and the streak multiplier.
 * All times are real (wall-clock) milliseconds, i.e. already divided by the
 * playback speed. Pass and star limits are in `../shared/judging`.
 */

import { assertNever } from '../../../../../shared/assertNever';
import {
  SHEET_LANES_CLEAN_ACCURACY,
  SHEET_LANES_CLEAN_MAX_MISSES,
  SHEET_LANES_ROUGH_ACCURACY,
  SHEET_LANES_STAR_ACCURACY,
  starsFromAccuracy,
} from '../shared/judging';
import { multiplierAfterHit, multiplierAfterMiss } from '../shared/multiplier';
import { clamp, mean, sd } from '../shared/stats';

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

/**
 * Every judged hit is inside the window, so anything past ±70 ms is `ok`
 * (its limit is unbounded). Only a NaN offset finds no tier: a bug.
 */
export function gradeHit(offsetMs: number): TierId {
  const abs = Math.abs(offsetMs);
  const tier = TIERS.find((t) => abs <= t.limitMs);

  if (!tier) {
    throw new Error(`No tier for a hit ${offsetMs} ms off`);
  }

  return tier.id;
}

/** Range label for a tier, e.g. `±40`; `ok` shows the hit window. */
export function tierRange(tier: Tier, windowMs: number): string {
  return `±${Math.round(
    Number.isFinite(tier.limitMs) ? tier.limitMs : windowMs,
  )}`;
}

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

/**
 * What kind of pass is looping. `practice` climbs the tempo ladder with the
 * adaptive guide; `unseenProbe` plays bars not seen before, sheet only at
 * 100%, outside the ladder, and logs that first pass in Reading progress.
 */
export type PassMode = 'practice' | 'unseenProbe';

/** Whether a pass of this mode hides every guide (lanes, colors, labels, kit hints). */
export const SHEET_ONLY: Record<PassMode, boolean> = {
  practice: false,
  unseenProbe: true,
};

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

/** Playback speed of a pass: the ladder's rung, or 100% for an unseen-bars probe. */
export function passSpeed(mode: PassMode, ladder: LadderState): number {
  switch (mode) {
    case 'practice':
      return RUNGS[ladder.index];

    case 'unseenProbe':
      return 1;

    default:
      return assertNever(mode, 'pass mode');
  }
}

export interface LadderState {
  index: number;
  /** Clean passes in a row at this rung. */
  clean: number;
  /** Clear fails in a row at this rung. */
  fails: number;
}

/** What one pass did to the ladder, for the verdict line. */
export type LadderMove =
  /** Second clean pass in a row: up a rung, to `index`. */
  | { kind: 'up'; index: number }
  /** Second clean pass in a row on the top rung: nowhere higher to go. */
  | { kind: 'cleanAtTop' }
  /** First clean pass: one more moves to `nextIndex`. */
  | { kind: 'oneClean'; nextIndex: number }
  /** Second clear fail in a row: down a rung, to `index`. */
  | { kind: 'down'; index: number }
  /** First clear fail: another one drops the tempo. */
  | { kind: 'oneRough' }
  /** A clear fail on the slowest rung: nowhere lower to go. */
  | { kind: 'roughAtBottom' }
  /** Neither clean nor a clear fail: stay at `index`. */
  | { kind: 'stay'; index: number };

export interface LadderStep {
  state: LadderState;
  move: LadderMove;
}

const pct = (i: number) => `${Math.round(RUNGS[i] * 100)}%`;

/** Clean or rough passes in a row that move the ladder. */
export const PASSES_TO_MOVE = 2;

/** Two clean passes go up a rung, two clear fails go down, anything else stays. */
export function ladderStep(
  state: LadderState,
  outcome: PassOutcome,
): LadderStep {
  const top = RUNGS.length - 1;

  switch (outcome) {
    case 'clean': {
      if (state.clean + 1 < PASSES_TO_MOVE) {
        return {
          state: { index: state.index, clean: state.clean + 1, fails: 0 },
          move: { kind: 'oneClean', nextIndex: Math.min(state.index + 1, top) },
        };
      }

      if (state.index < top) {
        const index = state.index + 1;

        return {
          state: { index, clean: 0, fails: 0 },
          move: { kind: 'up', index },
        };
      }

      return {
        state: { index: state.index, clean: 0, fails: 0 },
        move: { kind: 'cleanAtTop' },
      };
    }

    case 'fail': {
      if (state.fails + 1 >= PASSES_TO_MOVE && state.index > 0) {
        const index = state.index - 1;

        return {
          state: { index, clean: 0, fails: 0 },
          move: { kind: 'down', index },
        };
      }

      return {
        state: { index: state.index, clean: 0, fails: state.fails + 1 },
        move: { kind: state.index > 0 ? 'oneRough' : 'roughAtBottom' },
      };
    }

    case 'close':
      return {
        state: { index: state.index, clean: 0, fails: 0 },
        move: { kind: 'stay', index: state.index },
      };

    default:
      return assertNever(outcome, 'pass outcome');
  }
}

/** The verdict line for a ladder move; `good` colors it green. */
export function ladderVerdict(move: LadderMove): {
  text: string;
  good: boolean;
} {
  switch (move.kind) {
    case 'up':
      return {
        text: `Two clean passes. Tempo up to ${pct(move.index)}.`,
        good: true,
      };

    case 'cleanAtTop':
      return { text: 'Clean at the top over-speed rung.', good: true };

    case 'oneClean':
      return {
        text: `Clean pass. One more moves you to ${pct(move.nextIndex)}.`,
        good: true,
      };

    case 'down':
      return {
        text: `Two rough passes. Tempo down to ${pct(move.index)}.`,
        good: false,
      };

    case 'oneRough':
      return {
        text: 'Rough pass. Another one drops the tempo.',
        good: false,
      };

    case 'roughAtBottom':
      return {
        text: 'Rough pass. This is already the slowest rung.',
        good: false,
      };

    case 'stay':
      return { text: `Close. Staying at ${pct(move.index)}.`, good: false };

    default:
      return assertNever(move, 'ladder move');
  }
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
