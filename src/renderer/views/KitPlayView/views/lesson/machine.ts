import { assertNever } from '../../../../../shared/assertNever';
import { isListening, LessonStep } from './steps';

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
/** Read help when two rough mix-ups send you back to the lesson's bars. */
const READ_GUIDE_AFTER_MIX = 0.3;
/** Rough passes in a row before the lesson eases off (one is just a warning). */
const ROUGH_PASSES_TO_EASE_OFF = 2;

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
 * Misses a clean pass may have. A fixed count would be strict on dense
 * charts and lax on sparse ones, so it scales: 1 per 50 notes, at least 1.
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

/** Jumping to a step by hand (the step bar): read help starts over, no rough streak. */
export function jumpToStep(state: LessonState, step: number): LessonState {
  return { ...state, step, readGuide: READ_GUIDE_START, rough: 0 };
}

/** How much help is on screen (colors, labels, kit rings), 0–1. */
export function guideLevel(
  step: Pick<LessonStep, 'kind'>,
  readGuide: number,
): number {
  switch (step.kind) {
    case 'listen':
      return 1;

    case 'count':
      return 1;

    case 'limb':
      return 1;

    case 'all':
      return 1;

    case 'read':
      return readGuide;

    case 'mix':
      return 0;

    default:
      return assertNever(step.kind, 'lesson step kind');
  }
}

/** Which lesson to go to after one is read: the first with the fewest stars. */
export function nextLesson(stars: number[], current: number): number {
  if (stars.length === 0) {
    return 0;
  }

  const min = Math.min(...stars);

  return min >= MAX_STARS ? (current + 1) % stars.length : stars.indexOf(min);
}

/** Whether a finished lesson earned its star, and if not, why. */
export type StarResult =
  | 'earned'
  /** Played below the speed this lesson's star is earned at. */
  | 'tooSlow'
  /** The song had to wait for the player in this pass (wait mode). */
  | 'waited'
  /** The lesson already has every star. */
  | 'full';

/** How two rough passes in a row ease the lesson off. */
export type EaseOff =
  /** From the read step back to all together, with full colors. */
  | { kind: 'fullColors' }
  /** From the mix-up back to the lesson's own bars, with a little help. */
  | { kind: 'lessonBars' }
  | { kind: 'slower'; speed: number }
  /** Already at MIN_SPEED: it stays there. */
  | { kind: 'slowest'; speed: number; pct: number };

/** What a pass led to. `nextStep` is a step index in the same lesson. */
export type PassVerdict =
  /** A listen or count pass: nothing to score, on to the next step. */
  | { kind: 'listened'; nextStep: number }
  /** A playing step with none of its voices in the window: moved on. */
  | { kind: 'skipped'; nextStep: number }
  /** Clean: on to the next step. */
  | { kind: 'advanced'; nextStep: number }
  /** Clean with no read help left: on to the mix-up. */
  | { kind: 'readUnaided'; nextStep: number }
  /** Clean on the read step: less help next pass (0 is plain notation). */
  | { kind: 'faded'; readGuide: number }
  /** The lesson was read; the state is now the next lesson's start. */
  | {
      kind: 'finished';
      lesson: number;
      speed: number;
      star: StarResult;
      nextLesson: number;
      nextSpeed: number;
    }
  /** A rough pass; one more in a row and the lesson eases off. */
  | { kind: 'roughWarn'; pct: number }
  | { kind: 'easedOff'; ease: EaseOff }
  /** Neither clean nor rough: the step repeats. */
  | { kind: 'close'; pct: number; missed: number; allowed: number };

export type PassOutcome = PassVerdict & { state: LessonState };

export interface PassContext {
  steps: Pick<LessonStep, 'kind'>[];
  /** Stars per lesson, before this pass. */
  stars: number[];
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

/** The lesson was read: count its star and start the lesson to work on next. */
function finishLesson(state: LessonState, ctx: PassContext): PassOutcome {
  const lesson = state.lesson;
  const stars = ctx.stars[lesson] ?? 0;
  let star: StarResult = 'earned';

  if (stars >= MAX_STARS) {
    star = 'full';
  } else if (state.speed < state.baseSpeed - 1e-6) {
    star = 'tooSlow';
  } else if (!ctx.starAllowed) {
    star = 'waited';
  }

  const after = ctx.stars.map((s, i) =>
    i === lesson && star === 'earned' ? s + 1 : s,
  );
  const nextIdx = nextLesson(after, lesson);
  const seen = ctx.seen.map((s, i) => s || i === lesson);
  const next = startLesson(
    nextIdx,
    after[nextIdx] ?? 0,
    seen[nextIdx] ?? false,
    ctx.stepsFor(nextIdx),
  );

  return {
    kind: 'finished',
    lesson,
    speed: state.speed,
    star,
    nextLesson: nextIdx,
    nextSpeed: next.speed,
    state: next,
  };
}

/**
 * The end of a 4-bar pass: decide what happens next. A clean pass moves the
 * lesson on (fading read help first), a rough one twice in a row eases it
 * off, and a close one repeats the step. `result` is undefined when nothing
 * was scored (listen, count, or no notes for the step's voices): that pass
 * just moves the lesson on.
 */
export function endPass(
  state: LessonState,
  result: PassResult | undefined,
  ctx: PassContext,
): PassOutcome {
  const { steps } = ctx;
  const kind = steps[state.step].kind;
  const nextStep = Math.min(state.step + 1, steps.length - 1);
  /** On to the next step, with full read help when that is the read step. */
  const advance = (s: LessonState): LessonState => ({
    ...s,
    step: nextStep,
    readGuide:
      steps[nextStep].kind === 'read' && kind !== 'read'
        ? READ_GUIDE_START
        : s.readGuide,
  });

  if (!result || result.total === 0) {
    return {
      kind: isListening(kind) ? 'listened' : 'skipped',
      nextStep,
      state: advance(state),
    };
  }

  if (result.clean) {
    const s = { ...state, rough: 0 };
    const advanced: PassOutcome = {
      kind: 'advanced',
      nextStep,
      state: advance(s),
    };

    // One case per kind (no grouped labels: the lint's blank line between
    // cases reads as a fall-through), so a new kind has to be placed here.
    switch (kind) {
      case 'listen':
        return advanced;

      case 'count':
        return advanced;

      case 'limb':
        return advanced;

      case 'all':
        return advanced;

      case 'read':
        return cleanRead(s, ctx);

      case 'mix':
        return finishLesson(s, ctx);

      default:
        return assertNever(kind, 'lesson step kind');
    }
  }

  if (result.rough) {
    return roughPass(state, result, ctx);
  }

  return {
    kind: 'close',
    pct: result.pct,
    missed: result.missed,
    allowed: result.allowed,
    state: { ...state, rough: 0 },
  };
}

/** A clean pass on the read step: less help, or on once there is none left. */
function cleanRead(s: LessonState, ctx: PassContext): PassOutcome {
  if (s.readGuide > 0) {
    const readGuide = Math.max(0, round1(s.readGuide - READ_GUIDE_FADE));

    return { kind: 'faded', readGuide, state: { ...s, readGuide } };
  }

  const mix = ctx.steps.findIndex((x) => x.kind === 'mix');

  return mix < 0
    ? finishLesson(s, ctx)
    : { kind: 'readUnaided', nextStep: mix, state: { ...s, step: mix } };
}

/** A rough pass: a warning, then the step's way of easing off. */
function roughPass(
  state: LessonState,
  result: PassResult,
  ctx: PassContext,
): PassOutcome {
  const { steps } = ctx;
  const kind = steps[state.step].kind;
  const rough = state.rough + 1;
  const readGuide =
    kind === 'read'
      ? Math.min(1, round1(state.readGuide + READ_GUIDE_BACK))
      : state.readGuide;

  if (rough < ROUGH_PASSES_TO_EASE_OFF) {
    return {
      kind: 'roughWarn',
      pct: result.pct,
      state: { ...state, rough, readGuide },
    };
  }

  const slowDown = (): PassOutcome => {
    const speed = Math.max(MIN_SPEED, round1(state.speed - SPEED_STEP));

    return {
      kind: 'easedOff',
      ease:
        speed < state.speed
          ? { kind: 'slower', speed }
          : { kind: 'slowest', speed, pct: result.pct },
      state: { ...state, rough: 0, speed },
    };
  };

  switch (kind) {
    case 'listen':
      return slowDown();

    case 'count':
      return slowDown();

    case 'limb':
      return slowDown();

    case 'all':
      return slowDown();

    case 'read': {
      const all = steps.findIndex((x) => x.kind === 'all');

      return {
        kind: 'easedOff',
        ease: { kind: 'fullColors' },
        state: { ...state, rough: 0, readGuide, step: all >= 0 ? all : 0 },
      };
    }

    case 'mix':
      return {
        kind: 'easedOff',
        ease: { kind: 'lessonBars' },
        state: {
          ...state,
          rough: 0,
          readGuide: READ_GUIDE_AFTER_MIX,
          step: steps.findIndex((x) => x.kind === 'read'),
        },
      };

    default:
      return assertNever(kind, 'lesson step kind');
  }
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
