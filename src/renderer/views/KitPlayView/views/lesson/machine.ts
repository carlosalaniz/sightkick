import { LessonStep } from './steps';

/** Accuracy a pass needs to count as clean (the mock's 85% target). */
export const TARGET = 0.85;

/** Below this a pass is rough; two in a row and the lesson eases off. */
export const ROUGH = 0.6;

/** Timing tiers in ms: on time, close, else off. Weights follow the mock. */
export const TIER_MS = [35, 70] as const;

export const TIER_WEIGHT = [1, 0.7, 0.4] as const;

export const MIN_SPEED = 0.6;

export const SPEED_STEP = 0.1;

/** Read help when the read step starts, and how much each clean pass removes. */
export const READ_GUIDE_START = 0.6;

const READ_GUIDE_FADE = 0.3;
const READ_GUIDE_BACK = 0.2;

export const MAX_STARS = 3;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Tier of a hit (0 on time, 1 close, 2 off) from its offset in ms. */
export function tierOf(offsetMs: number): 0 | 1 | 2 {
  const a = Math.abs(offsetMs);

  if (a <= TIER_MS[0]) {
    return 0;
  }

  return a <= TIER_MS[1] ? 1 : 2;
}

/**
 * Misses a clean pass may have. The mock allows 1 in ~50 notes; real charts
 * can be much denser, so it scales: 1 per 50 notes, at least 1.
 */
export function allowedMisses(total: number): number {
  return Math.max(1, Math.round(total / 50));
}

export interface PassNote {
  /** Bar within the window (0-based). */
  bar: number;
  /** Hit offset in ms (< 0 early), or undefined if missed. */
  offsetMs?: number;
}

export interface PassResult {
  total: number;
  /** Mean weight, 0–1. */
  accuracy: number;
  pct: number;
  /** On time, close, off. */
  tiers: [number, number, number];
  missed: number;
  missedByBar: number[];
  allowed: number;
  clean: boolean;
  rough: boolean;
}

export function scorePass(notes: PassNote[], barCount: number): PassResult {
  const tiers: [number, number, number] = [0, 0, 0];
  const missedByBar = Array.from({ length: barCount }, () => 0);
  let weight = 0;
  let missed = 0;

  for (const n of notes) {
    if (n.offsetMs === undefined) {
      missed += 1;

      if (n.bar >= 0 && n.bar < barCount) {
        missedByBar[n.bar] += 1;
      }

      continue;
    }

    const t = tierOf(n.offsetMs);

    tiers[t] += 1;
    weight += TIER_WEIGHT[t];
  }

  const total = notes.length;
  const accuracy = total > 0 ? weight / total : 0;
  const allowed = allowedMisses(total);

  return {
    total,
    accuracy,
    pct: Math.round(accuracy * 100),
    tiers,
    missed,
    missedByBar,
    allowed,
    clean: accuracy >= TARGET && missed <= allowed,
    rough: accuracy < ROUGH,
  };
}

export interface LessonState {
  lesson: number;
  step: number;
  /** Help left in the read step, 0–1. */
  readGuide: number;
  /** Rough passes in a row. */
  rough: number;
  speed: number;
  /** The speed this lesson's next star is earned at. */
  baseSpeed: number;
}

/** 80%, 90%, then 100% speed: one star for reading it at each. */
export function baseSpeedFor(stars: number): number {
  return round1(0.8 + 0.1 * Math.min(stars, MAX_STARS - 1));
}

export function startLesson(
  lesson: number,
  stars: number,
  seen: boolean,
  steps: Pick<LessonStep, 'kind'>[],
): LessonState {
  const back = seen || stars > 0;
  const read = steps.findIndex((s) => s.kind === 'read');
  const base = baseSpeedFor(stars);

  return {
    lesson,
    step: back && read >= 0 ? read : 0,
    readGuide: back ? 0 : READ_GUIDE_START,
    rough: 0,
    speed: base,
    baseSpeed: base,
  };
}

/** Jumping to a step by hand, as the mock's step buttons do. */
export function jumpToStep(state: LessonState, step: number): LessonState {
  return { ...state, step, readGuide: READ_GUIDE_START, rough: 0 };
}

/** How much help is on screen (colors, labels, kit rings), 0–1. */
export function guideLevel(
  step: Pick<LessonStep, 'kind'>,
  readGuide: number,
): number {
  if (step.kind === 'read') {
    return readGuide;
  }

  return step.kind === 'mix' ? 0 : 1;
}

/** Which lesson to go to after one is read: the first with the fewest stars. */
export function nextLesson(stars: number[], current: number): number {
  if (stars.length === 0) {
    return 0;
  }

  const min = Math.min(...stars);

  return min >= MAX_STARS ? (current + 1) % stars.length : stars.indexOf(min);
}

export interface PassOutcome {
  state: LessonState;
  message: string;
  ok: boolean;
  /**
   * Set when the lesson was read: the lesson index, whether a star was
   * earned, and whether one was withheld only because `starAllowed` was false.
   */
  finished?: { lesson: number; star: boolean; withheld: boolean };
}

export interface PassContext {
  steps: Pick<LessonStep, 'kind' | 'name'>[];
  /** Stars per lesson, before this pass. */
  stars: number[];
  /** Lesson names, for messages. */
  names: string[];
  /** Steps for the lesson after this one, if the lesson gets read now. */
  stepsFor: (lesson: number) => Pick<LessonStep, 'kind'>[];
  /** Lessons seen before (read at least once). */
  seen: boolean[];
  /**
   * Whether this pass may earn a star. False when the song had to wait for
   * the player: a pass it waited in says nothing about timing.
   */
  starAllowed: boolean;
}

const pctSpeed = (speed: number) => `${Math.round(speed * 100)}%`;

/**
 * The end of a 4-bar pass: decide what happens next, with the mock's rules.
 * `result` is undefined when nothing was scored (listen, count, or no notes
 * for the step's voices): that pass just moves the lesson on.
 */
export function endPass(
  state: LessonState,
  result: PassResult | undefined,
  ctx: PassContext,
): PassOutcome {
  const { steps } = ctx;
  const step = steps[state.step];
  const last = steps.length - 1;

  if (!result || result.total === 0) {
    const next = Math.min(state.step + 1, last);

    return {
      state: {
        ...state,
        step: next,
        readGuide:
          steps[next].kind === 'read' && steps[state.step].kind !== 'read'
            ? READ_GUIDE_START
            : state.readGuide,
      },
      message:
        step.kind === 'listen' || step.kind === 'count'
          ? `Next: ${steps[next].name}`
          : `Nothing to play here. Next: ${steps[next].name}`,
      ok: true,
    };
  }

  const finish = (): PassOutcome => {
    const lesson = state.lesson;
    const stars = ctx.stars[lesson] ?? 0;
    const earned = state.speed >= state.baseSpeed - 1e-6 && stars < MAX_STARS;
    const star = earned && ctx.starAllowed;
    const after = ctx.stars.map((s, i) => (i === lesson && star ? s + 1 : s));
    const nextIdx = nextLesson(after, lesson);
    const seen = ctx.seen.map((s, i) => s || i === lesson);
    const next = startLesson(
      nextIdx,
      after[nextIdx] ?? 0,
      seen[nextIdx] ?? false,
      ctx.stepsFor(nextIdx),
    );

    return {
      state: next,
      message: `${star ? '★ ' : ''}${ctx.names[lesson]} read at ${pctSpeed(
        state.speed,
      )} speed. Next: ${ctx.names[nextIdx]} at ${pctSpeed(next.speed)}.`,
      ok: true,
      finished: { lesson, star, withheld: earned && !star },
    };
  };

  if (result.clean) {
    const s = { ...state, rough: 0 };

    if (step.kind === 'read') {
      if (s.readGuide <= 0) {
        const mix = steps.findIndex((x) => x.kind === 'mix');

        if (mix < 0) {
          return finish();
        }

        return {
          state: { ...s, step: mix },
          message: 'You read it with no help. Now the mix-up.',
          ok: true,
        };
      }

      const readGuide = Math.max(0, round1(s.readGuide - READ_GUIDE_FADE));

      return {
        state: { ...s, readGuide },
        message:
          readGuide > 0
            ? 'Clean. The colors are fading.'
            : 'Clean. The next pass is plain notation.',
        ok: true,
      };
    }

    if (step.kind === 'mix') {
      return finish();
    }

    const next = Math.min(s.step + 1, last);

    return {
      state: {
        ...s,
        step: next,
        readGuide: steps[next].kind === 'read' ? READ_GUIDE_START : s.readGuide,
      },
      message: `Clean. Next: ${steps[next].name}.`,
      ok: true,
    };
  }

  if (result.rough) {
    const rough = state.rough + 1;
    const readGuide =
      step.kind === 'read'
        ? Math.min(1, round1(state.readGuide + READ_GUIDE_BACK))
        : state.readGuide;

    if (rough < 2) {
      return {
        state: { ...state, rough, readGuide },
        message: `Rough pass (${result.pct}%). One more like it and the lesson eases off.`,
        ok: false,
      };
    }

    if (step.kind === 'read') {
      const all = steps.findIndex((x) => x.kind === 'all');

      return {
        state: { ...state, rough: 0, readGuide, step: all >= 0 ? all : 0 },
        message: 'Back to full colors for a pass.',
        ok: false,
      };
    }

    if (step.kind === 'mix') {
      const read = steps.findIndex((x) => x.kind === 'read');

      return {
        state: { ...state, rough: 0, readGuide: 0.3, step: read },
        message: 'Back to the lesson bars with a little help.',
        ok: false,
      };
    }

    const speed = Math.max(MIN_SPEED, round1(state.speed - SPEED_STEP));

    return {
      state: { ...state, rough: 0, speed },
      message:
        speed < state.speed
          ? `Slowing down to ${pctSpeed(speed)} speed.`
          : `Rough pass (${result.pct}%). Staying at ${pctSpeed(speed)}.`,
      ok: false,
    };
  }

  return {
    state: { ...state, rough: 0 },
    message: `Close: ${result.pct}%, ${result.missed} missed. You need 85% with at most ${result.allowed} missed.`,
    ok: false,
  };
}

/**
 * Whether a loop wrap ended a full pass (rather than a restart or seek):
 * playback started near the window start and reached its end.
 */
export function isPassComplete(
  minTime: number,
  maxTime: number,
  window: { start: number; end: number },
  slack = 0.3,
): boolean {
  return minTime <= window.start + slack && maxTime >= window.end - slack;
}

/**
 * An early hit on the window's first notes can land just before the loop
 * wraps; it belongs to the pass that is about to start.
 */
export function belongsToNextPass(
  noteTime: number,
  now: number,
  window: { start: number; end: number },
  slack: number,
): boolean {
  return noteTime < window.start + slack && now > window.end - slack;
}
