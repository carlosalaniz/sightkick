import { assertNever } from '../../../../../shared/assertNever';
import { EaseOff, PassVerdict, StarResult, TARGET } from './machine';

/** How a pass outcome is shown: green for moving on, amber for a setback. */
export type OutcomeTone = 'ok' | 'warn';

export interface OutcomeNames {
  /** Lesson names, by lesson index. */
  lessons: string[];
  /** The current lesson's step names, by step index. */
  steps: string[];
}

const pctOf = (fraction: number) => `${Math.round(fraction * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/**
 * The tone of each outcome. A Record rather than a switch so that a new
 * outcome doesn't compile until it has one.
 */
const TONE: Record<PassVerdict['kind'], OutcomeTone> = {
  listened: 'ok',
  skipped: 'ok',
  advanced: 'ok',
  readUnaided: 'ok',
  faded: 'ok',
  finished: 'ok',
  roughWarn: 'warn',
  easedOff: 'warn',
  close: 'warn',
};
/** Whether the pass was scored (and so whether wait mode's count applies). */
const SCORED: Record<PassVerdict['kind'], boolean> = {
  listened: false,
  skipped: false,
  advanced: true,
  readUnaided: true,
  faded: true,
  finished: true,
  roughWarn: true,
  easedOff: true,
  close: true,
};
const STAR_MARK: Record<StarResult, string> = {
  earned: '★ ',
  tooSlow: '',
  waited: '',
  full: '',
};

export function outcomeTone(outcome: PassVerdict): OutcomeTone {
  return TONE[outcome.kind];
}

function easeOffText(ease: EaseOff): string {
  switch (ease.kind) {
    case 'fullColors':
      return 'Back to full colors for a pass.';

    case 'lessonBars':
      return 'Back to the lesson bars with a little help.';

    case 'slower':
      return `Slowing down to ${pctOf(ease.speed)} speed.`;

    case 'slowest':
      return `Rough pass (${ease.pct}%). Staying at ${pctOf(ease.speed)}.`;

    default:
      return assertNever(ease, 'ease-off');
  }
}

function verdictText(outcome: PassVerdict, names: OutcomeNames): string {
  const step = (i: number) => names.steps[i] ?? '';

  switch (outcome.kind) {
    case 'listened':
      return `Next: ${step(outcome.nextStep)}`;

    case 'skipped':
      return `Nothing to play here. Next: ${step(outcome.nextStep)}`;

    case 'advanced':
      return `Clean. Next: ${step(outcome.nextStep)}.`;

    case 'readUnaided':
      return 'You read it with no help. Now the mix-up.';

    case 'faded':
      return outcome.readGuide > 0
        ? 'Clean. The colors are fading.'
        : 'Clean. The next pass is plain notation.';

    case 'finished':
      return `${STAR_MARK[outcome.star]}${
        names.lessons[outcome.lesson]
      } read at ${pctOf(outcome.speed)} speed. Next: ${
        names.lessons[outcome.nextLesson]
      } at ${pctOf(outcome.nextSpeed)}.`;

    case 'roughWarn':
      return `Rough pass (${outcome.pct}%). One more like it and the lesson eases off.`;

    case 'easedOff':
      return easeOffText(outcome.ease);

    case 'close':
      return `Close: ${outcome.pct}%, ${
        outcome.missed
      } missed. You need ${pctOf(TARGET)} with at most ${
        outcome.allowed
      } missed.`;

    default:
      return assertNever(outcome, 'pass outcome');
  }
}

/**
 * What wait mode adds to a scored pass's message: how often the song waited,
 * and when that cost the lesson its star, that it did. Unscored passes
 * (listen, count, nothing to play) get nothing.
 */
function waitNote(outcome: PassVerdict, waits: number): string {
  if (!SCORED[outcome.kind]) {
    return '';
  }

  const waited = waits > 0 ? plural(waits, 'wait') : 'no waits';

  return outcome.kind === 'finished' && outcome.star === 'waited'
    ? ` (${waited}: no star)`
    : ` · ${waited}`;
}

/**
 * The message for a pass outcome. `waits` is how often the song waited for
 * the player this pass, in wait mode; leave it out when wait mode is off.
 */
export function describeOutcome(
  outcome: PassVerdict,
  names: OutcomeNames,
  waits?: number,
): string {
  const text = verdictText(outcome, names);

  return waits === undefined ? text : `${text}${waitNote(outcome, waits)}`;
}
