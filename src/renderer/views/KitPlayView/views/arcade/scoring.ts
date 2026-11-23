import { ARCADE_STAR_ACCURACY, starsFromAccuracy } from '../shared/judging';
import { Voice } from '../../../../kit';

/** One grade of a hit, by how far it landed from the note. */
export interface Tier {
  id: 'perfect' | 'great' | 'good';
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
  /**
   * `steps`: +1 every 10 in a row, halved by a miss (arcade).
   * `streak`: 1 + streak / 10, back to 1 on a miss (Play).
   */
  multiplier: 'steps' | 'streak';
  fever: boolean;
}

export const MAX_MULTIPLIER = 4;

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

export function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Tier index for a hit `offsetSeconds` from its note. */
export function tierIndex(rules: ScoringRules, offsetSeconds: number): number {
  const ms = Math.abs(offsetSeconds * 1000);
  const i = rules.tiers.findIndex((t) => ms <= t.maxMs);

  return i === -1 ? rules.tiers.length - 1 : i;
}

/** The judgment pop for a hit: the tier label, or Early / Late. */
export function hitLabel(tier: Tier, offsetSeconds: number): string {
  if (!tier.directional) {
    return tier.label;
  }

  return offsetSeconds < 0 ? 'Early' : 'Late';
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
  tierIdx: number,
  ctx: HitContext,
): ScoreState {
  const tier = rules.tiers[tierIdx];
  const s = updateFever(state, ctx.time);
  const streak = s.streak + 1;
  let { mult } = s;

  if (rules.multiplier === 'streak') {
    mult = Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / 10));
  } else if (streak % 10 === 0) {
    mult = Math.min(MAX_MULTIPLIER, mult + 1);
  }

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
    mult: rules.multiplier === 'streak' ? 1 : Math.max(1, s.mult >> 1),
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

/** One judged note. `tier` is -1 for a miss. */
export interface Judgment extends HitContext {
  noteId: string;
  voice: Voice;
  pieceId: string;
  tier: number;
  offsetMs: number;
}

export const isMiss = (j: Pick<Judgment, 'tier'>) => j.tier < 0;

/** Rebuilds the score from judgments in the order they happened. */
export function replay(
  judgments: Iterable<Judgment>,
  rules: ScoringRules,
): ScoreState {
  let s = INITIAL_SCORE;

  for (const j of judgments) {
    s = isMiss(j) ? applyMiss(s, rules, j.time) : applyHit(s, rules, j.tier, j);
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

    if (isMiss(j)) {
      counts[rules.tiers.length] += 1;

      continue;
    }

    counts[j.tier] += 1;
    credit += rules.tiers[j.tier].weight;
    hits += 1;
    sum += j.offsetMs;
    sumSq += j.offsetMs * j.offsetMs;
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

/** One sentence about the player's timing lean, as on the mock's results card. */
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
