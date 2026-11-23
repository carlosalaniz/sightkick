import { describe, expect, it } from 'vitest';
import {
  allowedMisses,
  baseSpeedFor,
  belongsToNextPass,
  endPass,
  guideLevel,
  isPassComplete,
  jumpToStep,
  LessonState,
  nextLesson,
  PassContext,
  PassOutcome,
  PassNote,
  scorePass,
  startLesson,
  tierOf,
} from './machine';
import { describeOutcome } from './outcomeText';
import { buildSteps } from './steps';

const steps = buildSteps(['hihat', 'snare', 'kick'], {
  hasMix: true,
  hasDrumStem: true,
});
const idx = (kind: string) => steps.findIndex((s) => s.kind === kind);
const text = (o: PassOutcome) =>
  describeOutcome(o, {
    lessons: ['Intro', 'Verse', 'Chorus'],
    steps: steps.map((s) => s.name),
  });

function ctx(over: Partial<PassContext> = {}): PassContext {
  return {
    steps,
    stars: [0, 0, 0],
    seen: [false, false, false],
    stepsFor: () => steps,
    starAllowed: true,
    ...over,
  };
}

const state = (over: Partial<LessonState> = {}): LessonState => ({
  lesson: 0,
  step: 0,
  readGuide: 0.6,
  rough: 0,
  speed: 0.8,
  baseSpeed: 0.8,
  ...over,
});
const notes = (n: number, offsetMs: number | undefined): PassNote[] =>
  Array.from({ length: n }, () => ({ bar: 0, offsetMs }));
const clean = scorePass(notes(40, 5), 4);
// (15 × 1 + 25 × 0.7) / 40 = 81%.
const close = scorePass([...notes(15, 5), ...notes(25, 50)], 4);
const rough = scorePass([...notes(10, 5), ...notes(30, undefined)], 4);

describe('scorePass', () => {
  it('weights hits by timing tier', () => {
    expect(tierOf(-35)).toBe(0);
    expect(tierOf(36)).toBe(1);
    expect(tierOf(-71)).toBe(2);

    const r = scorePass(
      [
        { bar: 0, offsetMs: 10 },
        { bar: 1, offsetMs: 60 },
        { bar: 2, offsetMs: -90 },
        { bar: 3 },
      ],
      4,
    );

    expect(r.tiers).toEqual([1, 1, 1]);
    expect(r.missed).toBe(1);
    expect(r.missedByBar).toEqual([0, 0, 0, 1]);
    expect(r.accuracy).toBeCloseTo((1 + 0.7 + 0.4) / 4);
    expect(r.pct).toBe(53);
    expect(r.rough).toBe(true);
    expect(r.clean).toBe(false);
  });

  it('needs 85% and few misses to be clean', () => {
    expect(clean.clean).toBe(true);
    expect(close.clean).toBe(false);
    expect(close.rough).toBe(false);
    expect(rough.rough).toBe(true);
    // 2 misses out of 40: 95% accurate but over the 1 allowed.
    expect(scorePass([...notes(38, 0), ...notes(2, undefined)], 4).clean).toBe(
      false,
    );
  });

  it('allows more misses on dense windows', () => {
    expect(allowedMisses(10)).toBe(1);
    expect(allowedMisses(50)).toBe(1);
    expect(allowedMisses(150)).toBe(3);
  });
});

describe('startLesson', () => {
  it('starts new lessons at listen with read help, known ones at read', () => {
    expect(startLesson(1, 0, false, steps)).toEqual({
      lesson: 1,
      step: 0,
      readGuide: 0.6,
      rough: 0,
      speed: 0.8,
      baseSpeed: 0.8,
    });
    expect(startLesson(1, 1, false, steps)).toMatchObject({
      step: idx('read'),
      readGuide: 0,
      speed: 0.9,
    });
    expect(startLesson(1, 0, true, steps).step).toBe(idx('read'));
  });

  it('earns stars at 80%, 90% and 100% speed', () => {
    expect([0, 1, 2, 3].map(baseSpeedFor)).toEqual([0.8, 0.9, 1, 1]);
  });
});

describe('nextLesson', () => {
  it('picks the first lesson with the fewest stars, else the next one', () => {
    expect(nextLesson([1, 0, 0], 0)).toBe(1);
    expect(nextLesson([1, 1, 0], 1)).toBe(2);
    expect(nextLesson([3, 3, 3], 2)).toBe(0);
    expect(nextLesson([], 0)).toBe(0);
  });
});

describe('guideLevel', () => {
  it('is full help except while reading (fading) and in the mix-up (none)', () => {
    expect(guideLevel({ kind: 'all' }, 0.3)).toBe(1);
    expect(guideLevel({ kind: 'read' }, 0.3)).toBe(0.3);
    expect(guideLevel({ kind: 'mix' }, 0.6)).toBe(0);
  });

  it('resets read help on a manual step jump', () => {
    expect(jumpToStep(state({ readGuide: 0, rough: 1 }), 3)).toMatchObject({
      step: 3,
      readGuide: 0.6,
      rough: 0,
    });
  });
});

describe('endPass', () => {
  it('moves on after an unscored listen or count pass', () => {
    const a = endPass(state({ step: idx('listen') }), undefined, ctx());

    expect(a.state.step).toBe(idx('count'));
    expect(a.kind).toBe('listened');

    const b = endPass(a.state, undefined, ctx());

    expect(b.state.step).toBe(2);
    expect(text(b)).toBe('Next: Hi-hat + kick');
  });

  it('skips a playing step with nothing in it to play', () => {
    const r = endPass(state({ step: 2 }), undefined, ctx());

    expect(r).toMatchObject({ kind: 'skipped', nextStep: 3 });
    expect(text(r)).toBe('Nothing to play here. Next: Hi-hat + snare');
  });

  it('gives no more stars to a lesson that has them all', () => {
    const r = endPass(
      state({ step: idx('mix'), readGuide: 0, speed: 1, baseSpeed: 1 }),
      clean,
      ctx({ stars: [3, 3, 3] }),
    );

    expect(r).toMatchObject({ kind: 'finished', star: 'full', nextLesson: 1 });
  });

  it('advances a step on a clean pass, and sets read help when reaching read', () => {
    const r = endPass(state({ step: 2 }), clean, ctx());

    expect(r.state.step).toBe(3);
    expect(text(r)).toBe('Clean. Next: Hi-hat + snare.');

    const toRead = endPass(
      state({ step: idx('all'), readGuide: 0 }),
      clean,
      ctx(),
    );

    expect(toRead.state).toMatchObject({ step: idx('read'), readGuide: 0.6 });
  });

  it('fades read help on clean passes, then goes to the mix-up', () => {
    let s = state({ step: idx('read'), readGuide: 0.6 });

    s = endPass(s, clean, ctx()).state;
    expect(s.readGuide).toBe(0.3);
    s = endPass(s, clean, ctx()).state;
    expect(s.readGuide).toBe(0);

    const r = endPass(s, clean, ctx());

    expect(r.state.step).toBe(idx('mix'));
    expect(text(r)).toBe('You read it with no help. Now the mix-up.');
  });

  it('finishes the lesson from read when there is no mix-up', () => {
    const noMix = steps.filter((s) => s.kind !== 'mix');
    const r = endPass(
      state({ step: noMix.length - 1, readGuide: 0 }),
      clean,
      ctx({ steps: noMix, stepsFor: () => noMix }),
    );

    expect(r).toMatchObject({ kind: 'finished', lesson: 0, star: 'earned' });
  });

  it('earns a star on a clean mix-up at the base speed and moves on', () => {
    const r = endPass(state({ step: idx('mix'), readGuide: 0 }), clean, ctx());

    expect(r).toMatchObject({ kind: 'finished', lesson: 0, star: 'earned' });
    expect(r.state).toMatchObject({ lesson: 1, step: 0, speed: 0.8 });
    expect(text(r)).toBe('★ Intro read at 80% speed. Next: Verse at 80%.');
  });

  it('gives no star when the lesson had slowed down', () => {
    const r = endPass(
      state({ step: idx('mix'), readGuide: 0, speed: 0.7 }),
      clean,
      ctx(),
    );

    expect(r).toMatchObject({ kind: 'finished', lesson: 0, star: 'tooSlow' });
    expect(text(r).startsWith('★')).toBe(false);
    // Still the lowest-star lesson, so it comes straight back, now at the read step.
    expect(r.state).toMatchObject({ lesson: 0, step: idx('read'), speed: 0.8 });
  });

  it('withholds the star when the pass may not earn one, and picks the next lesson from that', () => {
    // Stars [0, 0]: with the star, lesson 1 would have the fewest and be next.
    const r = endPass(
      state({ step: idx('mix'), readGuide: 0 }),
      clean,
      ctx({
        stars: [0, 0],
        seen: [false, false],
        starAllowed: false,
      }),
    );

    expect(r).toMatchObject({ kind: 'finished', lesson: 0, star: 'waited' });
    expect(text(r)).toBe('Intro read at 80% speed. Next: Intro at 80%.');
    expect(r.state).toMatchObject({ lesson: 0, step: idx('read'), speed: 0.8 });
  });

  it('returns to a seen lesson at the read step', () => {
    const r = endPass(
      state({ step: idx('mix'), readGuide: 0 }),
      clean,
      ctx({ stars: [0, 3, 3] }),
    );

    expect(r.state).toMatchObject({ lesson: 0, step: idx('read'), speed: 0.9 });
  });

  it('warns on the first rough pass and slows down on the second', () => {
    const first = endPass(state({ step: 2 }), rough, ctx());

    expect(first.state.rough).toBe(1);
    expect(text(first)).toContain('One more like it');

    const second = endPass(first.state, rough, ctx());

    expect(second).toMatchObject({
      kind: 'easedOff',
      ease: { kind: 'slower', speed: 0.7 },
    });
    expect(second.state).toMatchObject({ rough: 0, speed: 0.7, step: 2 });
    expect(text(second)).toBe('Slowing down to 70% speed.');
  });

  it('never slows below 60%', () => {
    const r = endPass(state({ step: 2, rough: 1, speed: 0.6 }), rough, ctx());

    expect(r.state.speed).toBe(0.6);
    expect(r).toMatchObject({ ease: { kind: 'slowest', speed: 0.6 } });
    expect(text(r)).toBe(`Rough pass (${rough.pct}%). Staying at 60%.`);
  });

  it('brings help back when reading goes rough', () => {
    const first = endPass(
      state({ step: idx('read'), readGuide: 0.3 }),
      rough,
      ctx(),
    );

    expect(first.state.readGuide).toBe(0.5);

    const second = endPass(first.state, rough, ctx());

    expect(second.state.step).toBe(idx('all'));
    expect(text(second)).toBe('Back to full colors for a pass.');
  });

  it('goes back to the lesson bars after two rough mix-ups', () => {
    const r = endPass(
      state({ step: idx('mix'), readGuide: 0, rough: 1 }),
      rough,
      ctx(),
    );

    expect(r).toMatchObject({ kind: 'easedOff', ease: { kind: 'lessonBars' } });
    expect(r.state).toMatchObject({ step: idx('read'), readGuide: 0.3 });
  });

  it('stays put on a close pass and clears the rough streak', () => {
    const r = endPass(state({ step: 2, rough: 1 }), close, ctx());

    expect(r.state).toMatchObject({ step: 2, rough: 0 });
    expect(text(r)).toBe(
      `Close: ${close.pct}%, 0 missed. You need 85% with at most 1 missed.`,
    );
  });
});

describe('pass boundaries', () => {
  const win = { start: 10, end: 18 };

  it('counts a wrap only after playing the whole window', () => {
    expect(isPassComplete(10.01, 17.99, win)).toBe(true);
    expect(isPassComplete(10.01, 14, win)).toBe(false);
    expect(isPassComplete(13, 17.99, win)).toBe(false);
    expect(isPassComplete(Infinity, -Infinity, win)).toBe(false);
  });

  it('gives early hits on the first notes to the next pass', () => {
    expect(belongsToNextPass(10, 17.95, win, 0.2)).toBe(true);
    expect(belongsToNextPass(10, 12, win, 0.2)).toBe(false);
    expect(belongsToNextPass(17.9, 17.95, win, 0.2)).toBe(false);
  });
});
