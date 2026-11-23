import { describe, expect, it } from 'vitest';
import { LessonState, PassOutcome, PassVerdict } from './machine';
import { describeOutcome, outcomeTone } from './outcomeText';

const names = {
  lessons: ['Intro', 'Verse'],
  steps: ['Listen', 'Count out loud', 'Hi-hat + kick', 'All together'],
};
const state: LessonState = {
  lesson: 0,
  step: 0,
  readGuide: 0,
  rough: 0,
  speed: 0.8,
  baseSpeed: 0.8,
};
const finished = (
  star: Extract<PassVerdict, { kind: 'finished' }>['star'],
): PassOutcome => ({
  kind: 'finished',
  lesson: 0,
  speed: 0.8,
  star,
  nextLesson: 1,
  nextSpeed: 0.9,
  state,
});
/** One of every outcome, with its message and tone. */
const cases: [PassVerdict, string, 'ok' | 'warn'][] = [
  [{ kind: 'listened', nextStep: 1 }, 'Next: Count out loud', 'ok'],
  [
    { kind: 'skipped', nextStep: 3 },
    'Nothing to play here. Next: All together',
    'ok',
  ],
  [{ kind: 'advanced', nextStep: 3 }, 'Clean. Next: All together.', 'ok'],
  [
    { kind: 'readUnaided', nextStep: 5 },
    'You read it with no help. Now the mix-up.',
    'ok',
  ],
  [{ kind: 'faded', readGuide: 0.3 }, 'Clean. The colors are fading.', 'ok'],
  [
    { kind: 'faded', readGuide: 0 },
    'Clean. The next pass is plain notation.',
    'ok',
  ],
  [finished('earned'), '★ Intro read at 80% speed. Next: Verse at 90%.', 'ok'],
  [finished('tooSlow'), 'Intro read at 80% speed. Next: Verse at 90%.', 'ok'],
  [
    { kind: 'roughWarn', pct: 40 },
    'Rough pass (40%). One more like it and the lesson eases off.',
    'warn',
  ],
  [
    { kind: 'easedOff', ease: { kind: 'fullColors' } },
    'Back to full colors for a pass.',
    'warn',
  ],
  [
    { kind: 'easedOff', ease: { kind: 'lessonBars' } },
    'Back to the lesson bars with a little help.',
    'warn',
  ],
  [
    { kind: 'easedOff', ease: { kind: 'slower', speed: 0.7 } },
    'Slowing down to 70% speed.',
    'warn',
  ],
  [
    { kind: 'easedOff', ease: { kind: 'slowest', speed: 0.6, pct: 40 } },
    'Rough pass (40%). Staying at 60%.',
    'warn',
  ],
  [
    { kind: 'close', pct: 81, missed: 2, allowed: 1 },
    'Close: 81%, 2 missed. You need 85% with at most 1 missed.',
    'warn',
  ],
];

describe('describeOutcome', () => {
  it.each(cases)('describes %j', (outcome, message, tone) => {
    expect(describeOutcome(outcome, names)).toBe(message);
    expect(outcomeTone(outcome)).toBe(tone);
  });

  it('adds the wait count to scored passes in wait mode', () => {
    expect(describeOutcome({ kind: 'roughWarn', pct: 40 }, names, 0)).toBe(
      'Rough pass (40%). One more like it and the lesson eases off. · no waits',
    );
    expect(describeOutcome(finished('earned'), names, 0)).toBe(
      '★ Intro read at 80% speed. Next: Verse at 90%. · no waits',
    );
    expect(
      describeOutcome(
        { kind: 'close', pct: 81, missed: 0, allowed: 1 },
        names,
        1,
      ),
    ).toBe(
      'Close: 81%, 0 missed. You need 85% with at most 1 missed. · 1 wait',
    );
  });

  it('says when the waits cost the star', () => {
    expect(describeOutcome(finished('waited'), names, 2)).toBe(
      'Intro read at 80% speed. Next: Verse at 90%. (2 waits: no star)',
    );
  });

  it('adds nothing to an unscored pass', () => {
    expect(describeOutcome({ kind: 'listened', nextStep: 1 }, names, 3)).toBe(
      'Next: Count out loud',
    );
  });
});
