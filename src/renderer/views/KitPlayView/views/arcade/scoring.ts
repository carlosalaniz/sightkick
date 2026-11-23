import { ARCADE_STAR_ACCURACY, starsFromAccuracy } from '../shared/judging';
import {
  multiplierAfterHit,
  multiplierAfterMiss,
  MultiplierRule,
} from '../shared/multiplier';
import { clamp } from '../shared/stats';
import { assertNever } from '../../../../../shared/assertNever';
import { Voice } from '../../../../kit';

export type ArcadeTierId = 'perfect' | 'great' | 'good';

/** One grade of a hit, by how far it landed from the note. */
export interface Tier {
  id: ArcadeTierId;
  label: string;
  /** Upper bound of |offset| for this tier, in ms. The last tier takes the rest of the hit window. */
  maxMs: number;
  points: number;
  /** Accuracy credit, 0–1. */
  weight: number;
  /** Spirit and Fever gained per hit. */
  spirit: number;
  meter: number;
  /** Color on the dark highway. */
  color: string;
  /** Color of the mark on the paper sheet strip. */
  sheetColor: string;
  /** Pop "Early" / "Late" instead of the label. */
  directional: boolean;
}

export interface ScoringRules {
  tiers: Tier[];
  /** `steps` in the arcade views, `streak` in Play. */
  multiplier: MultiplierRule;
  fever: boolean;
}

export const MISS_COLOR = '#ff7a66';

export const MISS_SHEET_COLOR = '#c62828';

export const ARCADE_RULES: ScoringRules = {
  multiplier: 'steps',
  fever: true,
  tiers: [
    {
      id: 'perfect',
      label: 'Perfect',
      maxMs: 25,
      points: 100,
      weight: 1,
      spirit: 0.02,
      meter: 0.024,
      color: '#ffe9a8',
      sheetColor: '#2c8c52',
      directional: false,
    },
    {
      id: 'great',
      label: 'Great',
      maxMs: 50,
      points: 70,
      weight: 0.8,
      spirit: 0.014,
      meter: 0.016,
      color: '#9ff0b8',
      sheetColor: '#6a9a2e',
      directional: false,
    },
    {
      id: 'good',
      label: 'Good',
      maxMs: Infinity,
      points: 40,
      weight: 0.5,
      spirit: 0.006,
      meter: 0.006,
      color: '#f0c46c',
      sheetColor: '#c99a2a',
      directional: true,
    },
  ],
};

export const PLAY_RULES: ScoringRules = {
  multiplier: 'streak',
  fever: false,
  tiers: [
    {
      id: 'perfect',
      label: 'Perfect',
      maxMs: 35,
      points: 100,
      weight: 1,
      spirit: 0.02,
      meter: 0,
      color: '#9ff0b8',
      sheetColor: '#2c8c52',
      directional: false,
    },
    {
      id: 'good',
      label: 'Good',
      maxMs: Infinity,
      points: 50,
      weight: 0.5,
      spirit: 0.006,
      meter: 0,
      color: '#f0c46c',
      sheetColor: '#c99a2a',
      directional: true,
    },
  ],
};

export const SPIRIT_START = 0.6;

/** Spirit at or above this clears the song (the line on the v12 Spirit bar). */
export const SPIRIT_PASS = 0.7;

const SPIRIT_MISS = 0.08;
const METER_MISS = 0.04;

/**
 * The tier of a hit `offsetSeconds` from its note. Every rules table ends in
 * a tier with no upper bound, so nothing a judge reports falls through; an
 * offset that does (NaN) is a bug, not a grade.
 */
export function gradeHit(rules: ScoringRules, offsetSeconds: number): Tier {
  const ms = Math.abs(offsetSeconds * 1000);
  const tier = rules.tiers.find((t) => ms <= t.maxMs);

  if (!tier) {
    throw new Error(`No tier for a hit ${offsetSeconds} s off`);
  }

  return tier;
}

/** The tier `id` of these rules; a judgment from other rules is a bug. */
export function tierById(rules: ScoringRules, id: ArcadeTierId): Tier {
  const tier = rules.tiers.find((t) => t.id === id);

  if (!tier) {
    throw new Error(`These scoring rules have no ${id} tier`);
  }

  return tier;
}

/** The judgment pop for a hit: the tier label, or Early / Late. */
export function hitLabel(tier: Tier, offsetSeconds: number): string {
  if (!tier.directional) {
    return tier.label;
  }

  return offsetSeconds < 0 ? 'Early' : 'Late';
}

/**
 * The ring a hit draws on its lane: big and in the tier's color for a
 * perfect hit, small and in the pad's color otherwise.
 */
export function hitRing(
  tier: Tier,
  padColor: string,
): { color: string; big: boolean } {
  switch (tier.id) {
    case 'perfect':
      return { color: tier.color, big: true };

    case 'great':
      return { color: padColor, big: false };

    case 'good':
      return { color: padColor, big: false };

    default:
      return assertNever(tier.id, 'arcade tier');
  }
}

export interface ScoreState {
  score: number;
  streak: number;
  maxStreak: number;
  mult: number;
  /** Fever meter, 0–1. Full means "hit a crash". */
  meter: number;
  fever: boolean;
  feverStart: number;
  feverEnd: number;
  /** Spirit (rock meter), 0–1. */
  spirit: number;
}

export const INITIAL_SCORE: ScoreState = {
  score: 0,
  streak: 0,
  maxStreak: 0,
  mult: 1,
  meter: 0,
  fever: false,
  feverStart: 0,
  feverEnd: 0,
  spirit: SPIRIT_START,
};

export interface HitContext {
  /** Note time, audio seconds. */
  time: number;
  /** The note is a crash (Fever triggers on one). */
  isCrash: boolean;
  /** The kit has a crash lane; without one any hit triggers a full meter. */
  hasCrash: boolean;
  /** How long Fever lasts if this hit starts it (8 beats). */
  feverSeconds: number;
}

/** Ends Fever once its time is up. */
export function updateFever(state: ScoreState, now: number): ScoreState {
  if (!state.fever || now < state.feverEnd) {
    return state;
  }

  return { ...state, fever: false, meter: 0 };
}

export function applyHit(
  state: ScoreState,
  rules: ScoringRules,
  tier: Tier,
  ctx: HitContext,
): ScoreState {
  const s = updateFever(state, ctx.time);
  const streak = s.streak + 1;
  const mult = multiplierAfterHit(rules.multiplier, s.mult, streak);
  const next: ScoreState = {
    ...s,
    streak,
    maxStreak: Math.max(s.maxStreak, streak),
    mult,
    score: s.score + tier.points * mult * (s.fever ? 2 : 1),
    spirit: Math.min(1, s.spirit + tier.spirit),
  };

  if (rules.fever && !s.fever) {
    next.meter = Math.min(1, s.meter + tier.meter);

    if (next.meter >= 1 && (ctx.isCrash || !ctx.hasCrash)) {
      next.fever = true;
      next.feverStart = ctx.time;
      next.feverEnd = ctx.time + ctx.feverSeconds;
    }
  }

  return next;
}

export function applyMiss(
  state: ScoreState,
  rules: ScoringRules,
  time: number,
): ScoreState {
  const s = updateFever(state, time);

  return {
    ...s,
    streak: 0,
    mult: multiplierAfterMiss(rules.multiplier, s.mult),
    spirit: Math.max(0, s.spirit - SPIRIT_MISS),
    meter:
      rules.fever && !s.fever ? Math.max(0, s.meter - METER_MISS) : s.meter,
  };
}

/** The Fever bar: fill while charging, time left while active. */
export function feverLevel(state: ScoreState, now: number): number {
  if (!state.fever) {
    return clamp(state.meter);
  }

  const span = state.feverEnd - state.feverStart;

  return span > 0 ? clamp((state.feverEnd - now) / span) : 0;
}

export function displayMultiplier(state: ScoreState): number {
  return state.mult * (state.fever ? 2 : 1);
}

/** What became of one note: hit in a tier (`offsetMs` < 0 is early) or missed. */
export type ArcadeGrade =
  | { kind: 'hit'; tier: ArcadeTierId; offsetMs: number }
  | { kind: 'miss' };

/** One judged note. */
export interface Judgment extends HitContext {
  noteId: string;
  voice: Voice;
  pieceId: string;
  grade: ArcadeGrade;
}

/** How a view draws a note's gem: not judged yet, hit (gone) or missed (faded). */
export type GemState = 'open' | 'hit' | 'missed';

export function gemState(j: Judgment | undefined): GemState {
  if (!j) {
    return 'open';
  }

  switch (j.grade.kind) {
    case 'hit':
      return 'hit';

    case 'miss':
      return 'missed';

    default:
      return assertNever(j.grade, 'arcade grade');
  }
}

function applyJudgment(
  s: ScoreState,
  rules: ScoringRules,
  j: Judgment,
): ScoreState {
  switch (j.grade.kind) {
    case 'hit':
      return applyHit(s, rules, tierById(rules, j.grade.tier), j);

    case 'miss':
      return applyMiss(s, rules, j.time);

    default:
      return assertNever(j.grade, 'arcade grade');
  }
}

/** Rebuilds the score from judgments in the order they happened. */
export function replay(
  judgments: Iterable<Judgment>,
  rules: ScoringRules,
): ScoreState {
  let s = INITIAL_SCORE;

  for (const j of judgments) {
    s = applyJudgment(s, rules, j);
  }

  return s;
}

export interface Summary {
  judged: number;
  /** 0–1. */
  accuracy: number;
  /** Per tier, then misses last. */
  counts: number[];
  hits: number;
  misses: number;
  avgMs: number;
  spreadMs: number;
}

export function summarize(
  judgments: Iterable<Judgment>,
  rules: ScoringRules,
): Summary {
  const counts = new Array(rules.tiers.length + 1).fill(0) as number[];
  let judged = 0;
  let credit = 0;
  let hits = 0;
  let sum = 0;
  let sumSq = 0;

  for (const j of judgments) {
    judged += 1;

    const { grade } = j;

    switch (grade.kind) {
      case 'hit': {
        const tier = tierById(rules, grade.tier);

        counts[rules.tiers.indexOf(tier)] += 1;
        credit += tier.weight;
        hits += 1;
        sum += grade.offsetMs;
        sumSq += grade.offsetMs * grade.offsetMs;

        break;
      }

      case 'miss':
        counts[rules.tiers.length] += 1;

        break;

      default:
        assertNever(grade, 'arcade grade');
    }
  }

  const avgMs = hits ? sum / hits : 0;

  return {
    judged,
    accuracy: judged ? credit / judged : 0,
    counts,
    hits,
    misses: judged - hits,
    avgMs,
    spreadMs: hits ? Math.sqrt(Math.max(0, sumSq / hits - avgMs * avgMs)) : 0,
  };
}

/** Stars (0–5) on the results card. */
export function starsFor(accuracy: number): number {
  return starsFromAccuracy(accuracy, ARCADE_STAR_ACCURACY);
}

/** `+12 ms`, `−8 ms` (true minus sign), `0 ms`. */
export function formatOffset(ms: number): string {
  const r = Math.round(ms);

  if (r === 0) {
    return '0 ms';
  }

  return `${r > 0 ? '+' : '−'}${Math.abs(r)} ms`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** One sentence about the player's timing lean, for the results card. */
export function timingLean(summary: Summary): string {
  if (Math.abs(summary.avgMs) > 15) {
    return `You lean ${Math.round(Math.abs(summary.avgMs))} ms ${
      summary.avgMs < 0 ? 'early' : 'late'
    } overall.`;
  }

  if (summary.spreadMs > 25) {
    return 'Your average is centered but the spread is wide. Aim for steadier hits.';
  }

  return 'Centered and steady.';
}

export interface GroupSummary<K> {
  key: K;
  summary: Summary;
}

/** Summaries per group (pad, section), in `order`, skipping empty groups. */
export function summarizeBy<K>(
  judgments: Judgment[],
  rules: ScoringRules,
  keyOf: (j: Judgment) => K,
  order: K[],
): GroupSummary<K>[] {
  const groups = new Map<K, Judgment[]>();

  for (const j of judgments) {
    const k = keyOf(j);
    const list = groups.get(k);

    if (list) {
      list.push(j);
    } else {
      groups.set(k, [j]);
    }
  }

  return order
    .filter((k) => groups.has(k))
    .map((k) => ({ key: k, summary: summarize(groups.get(k) ?? [], rules) }));
}

/** The group with the lowest accuracy, or undefined if there are none. */
export function weakest<K>(
  groups: GroupSummary<K>[],
): GroupSummary<K> | undefined {
  return groups.reduce<GroupSummary<K> | undefined>(
    (m, g) => (!m || g.summary.accuracy < m.summary.accuracy ? g : m),
    undefined,
  );
}
