import { describe, expect, it } from 'vitest';
import {
  evaluatePass,
  gradeHit,
  hitPoints,
  ladderStep,
  ladderVerdict,
  NoteResult,
  passOutcome,
  RUNGS,
  streakAfterHit,
  streakAfterMiss,
  tierRange,
  TIER_BY_ID,
} from './scoring';

const hit = (offsetMs: number): NoteResult => ({
  tier: gradeHit(offsetMs),
  offsetMs,
});
const miss: NoteResult = { tier: 'miss' };

describe('gradeHit', () => {
  it('grades ±20 / 40 / 70 and puts the rest of the window in OK', () => {
    expect(gradeHit(0)).toBe('perfect');
    expect(gradeHit(-20)).toBe('perfect');
    expect(gradeHit(21)).toBe('great');
    expect(gradeHit(-40)).toBe('great');
    expect(gradeHit(55)).toBe('good');
    expect(gradeHit(71)).toBe('ok');
    expect(gradeHit(-140)).toBe('ok');
  });

  it('labels the OK tier with the hit window', () => {
    expect(tierRange(TIER_BY_ID.good, 100)).toBe('±70');
    expect(tierRange(TIER_BY_ID.ok, 112.4)).toBe('±112');
  });
});

describe('evaluatePass', () => {
  it('weights tiers into accuracy and counts misses as zero', () => {
    const s = evaluatePass([hit(5), hit(30), hit(60), hit(90), miss]);

    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ perfect: 1, great: 1, good: 1, ok: 1, miss: 1 });
    expect(s.accuracy).toBeCloseTo((1 + 0.9 + 0.7 + 0.4) / 5);
    expect(s.misses).toBe(1);
  });

  it('reports the offset and the spread of hits only', () => {
    const s = evaluatePass([hit(10), hit(-10), hit(30), miss]);

    expect(s.meanMs).toBeCloseTo(10);
    expect(s.sdMs).toBeCloseTo(Math.sqrt((0 + 400 + 400) / 3));
  });

  it('gives stars at 70 / 85 / 95%', () => {
    expect(evaluatePass(Array(20).fill(hit(0))).stars).toBe(3);
    expect(evaluatePass([...Array(9).fill(hit(0)), miss]).stars).toBe(2);
    expect(evaluatePass([...Array(3).fill(hit(0)), miss]).stars).toBe(1);
    expect(evaluatePass([hit(0), miss]).stars).toBe(0);
    expect(evaluatePass([]).accuracy).toBe(0);
  });
});

describe('passOutcome', () => {
  it('is clean at 85%+ with at most one miss', () => {
    expect(passOutcome({ accuracy: 0.9, misses: 1 })).toBe('clean');
    expect(passOutcome({ accuracy: 0.9, misses: 2 })).toBe('close');
    expect(passOutcome({ accuracy: 0.84, misses: 0 })).toBe('close');
  });

  it('is a clear fail under 60%', () => {
    expect(passOutcome({ accuracy: 0.59, misses: 3 })).toBe('fail');
    expect(passOutcome({ accuracy: 0.6, misses: 3 })).toBe('close');
  });
});

describe('ladderStep', () => {
  const at = (index: number, clean = 0, fails = 0) => ({ index, clean, fails });

  it('goes up a rung after two clean passes', () => {
    const one = ladderStep(at(2), 'clean');

    expect(one.state).toEqual(at(2, 1, 0));
    expect(one.move).toEqual({ kind: 'oneClean', nextIndex: 3 });
    expect(ladderVerdict(one.move).text).toBe(
      'Clean pass. One more moves you to 85%.',
    );

    const two = ladderStep(one.state, 'clean');

    expect(two.state).toEqual(at(3));
    expect(ladderVerdict(two.move)).toEqual({
      text: 'Two clean passes. Tempo up to 85%.',
      good: true,
    });
  });

  it('goes down after two clear fails and never below the first rung', () => {
    const one = ladderStep(at(2), 'fail');

    expect(one.state).toEqual(at(2, 0, 1));
    expect(one.move.kind).toBe('oneRough');

    const two = ladderStep(one.state, 'fail');

    expect(two.state).toEqual(at(1));
    expect(two.move).toEqual({ kind: 'down', index: 1 });
    expect(ladderVerdict(two.move).good).toBe(false);

    const bottom = ladderStep(at(0, 0, 1), 'fail');

    expect(bottom.state.index).toBe(0);
    expect(bottom.move.kind).toBe('roughAtBottom');
    expect(ladderVerdict(bottom.move).text).toBe(
      'Rough pass. This is already the slowest rung.',
    );
  });

  it('stays on a close pass and resets both counters', () => {
    const s = ladderStep(at(4, 1, 0), 'close');

    expect(s.state).toEqual(at(4));
    expect(ladderVerdict(s.move)).toEqual({
      text: 'Close. Staying at 90%.',
      good: false,
    });
  });

  it('a fail between clean passes breaks the clean run', () => {
    const s = ladderStep(ladderStep(at(2, 1), 'fail').state, 'clean');

    expect(s.state).toEqual(at(2, 1, 0));
  });

  it('tops out at the last over-speed rung', () => {
    const top = RUNGS.length - 1;

    expect(RUNGS[top]).toBe(1.1);

    const s = ladderStep(at(top, 1), 'clean');

    expect(s.state.index).toBe(top);
    expect(s.move.kind).toBe('cleanAtTop');
  });
});

describe('streak multiplier', () => {
  it('goes up every 10 hits to at most ×4 and halves on a miss', () => {
    let s = { streak: 0, mult: 1 };

    for (let i = 0; i < 45; i += 1) {
      s = streakAfterHit(s);
    }

    expect(s).toEqual({ streak: 45, mult: 4 });
    expect(streakAfterMiss(s)).toEqual({ streak: 0, mult: 2 });
    expect(streakAfterMiss({ streak: 3, mult: 1 })).toEqual({
      streak: 0,
      mult: 1,
    });
  });

  it('pays a reading bonus for less guidance', () => {
    expect(hitPoints('perfect', 1, 1)).toBe(100);
    expect(hitPoints('perfect', 2, 0)).toBe(400);
    expect(hitPoints('good', 1, 0.5)).toBe(75);
  });
});
