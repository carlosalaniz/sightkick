import { describe, expect, it } from 'vitest';
import { JudgmentLog } from './log';
import { buildResults } from './results';
import {
  applyHit,
  applyMiss,
  ARCADE_RULES,
  displayMultiplier,
  feverLevel,
  formatOffset,
  hitLabel,
  HitContext,
  INITIAL_SCORE,
  Judgment,
  PLAY_RULES,
  replay,
  ScoreState,
  SPIRIT_START,
  starsFor,
  summarize,
  tierIndex,
  timingLean,
  updateFever,
} from './scoring';

const ctx = (over: Partial<HitContext> = {}): HitContext => ({
  time: 1,
  isCrash: false,
  hasCrash: true,
  feverSeconds: 4,
  ...over,
});
const hits = (
  state: ScoreState,
  n: number,
  tier = 0,
  rules = ARCADE_RULES,
): ScoreState => {
  let s = state;

  for (let i = 0; i < n; i += 1) {
    s = applyHit(s, rules, tier, ctx({ time: i * 0.25 }));
  }

  return s;
};
const judgment = (over: Partial<Judgment>): Judgment => ({
  ...ctx(),
  noteId: 'n',
  voice: 'snare',
  pieceId: 'sn',
  tier: 0,
  offsetMs: 0,
  ...over,
});

describe('tierIndex', () => {
  it('grades by absolute offset in ms', () => {
    expect(tierIndex(ARCADE_RULES, 0.01)).toBe(0);
    expect(tierIndex(ARCADE_RULES, -0.025)).toBe(0);
    expect(tierIndex(ARCADE_RULES, 0.04)).toBe(1);
    expect(tierIndex(ARCADE_RULES, -0.09)).toBe(2);
    expect(tierIndex(ARCADE_RULES, 0.2)).toBe(2);
  });

  it('uses the 35 ms Perfect window on Play', () => {
    expect(tierIndex(PLAY_RULES, 0.034)).toBe(0);
    expect(tierIndex(PLAY_RULES, 0.036)).toBe(1);
  });
});

describe('hitLabel', () => {
  it('pops Early / Late for the loosest tier', () => {
    expect(hitLabel(ARCADE_RULES.tiers[0], 0.01)).toBe('Perfect');
    expect(hitLabel(ARCADE_RULES.tiers[1], -0.04)).toBe('Great');
    expect(hitLabel(ARCADE_RULES.tiers[2], -0.08)).toBe('Early');
    expect(hitLabel(ARCADE_RULES.tiers[2], 0.08)).toBe('Late');
  });
});

describe('arcade scoring', () => {
  it('scores tiers 100 / 70 / 40 at ×1', () => {
    expect(applyHit(INITIAL_SCORE, ARCADE_RULES, 0, ctx()).score).toBe(100);
    expect(applyHit(INITIAL_SCORE, ARCADE_RULES, 1, ctx()).score).toBe(70);
    expect(applyHit(INITIAL_SCORE, ARCADE_RULES, 2, ctx()).score).toBe(40);
  });

  it('steps the multiplier every 10 in a row, up to ×4', () => {
    expect(hits(INITIAL_SCORE, 9).mult).toBe(1);
    expect(hits(INITIAL_SCORE, 10).mult).toBe(2);
    expect(hits(INITIAL_SCORE, 30).mult).toBe(4);
    expect(hits(INITIAL_SCORE, 60).mult).toBe(4);
    // The 10th hit already scores at ×2.
    expect(hits(INITIAL_SCORE, 10, 2).score).toBe(9 * 40 + 80);
  });

  it('halves the multiplier and resets the streak on a miss', () => {
    const s = applyMiss(hits(INITIAL_SCORE, 30), ARCADE_RULES, 10);

    expect(s.streak).toBe(0);
    expect(s.maxStreak).toBe(30);
    expect(s.mult).toBe(2);
    expect(applyMiss(s, ARCADE_RULES, 10).mult).toBe(1);
    expect(applyMiss(INITIAL_SCORE, ARCADE_RULES, 0).mult).toBe(1);
  });

  it('moves Spirit up on hits and down on misses, within 0–1', () => {
    const up = applyHit(INITIAL_SCORE, ARCADE_RULES, 0, ctx());

    expect(up.spirit).toBeCloseTo(SPIRIT_START + 0.02);
    expect(applyMiss(INITIAL_SCORE, ARCADE_RULES, 0).spirit).toBeCloseTo(
      SPIRIT_START - 0.08,
    );
    expect(hits(INITIAL_SCORE, 100).spirit).toBe(1);

    let s = INITIAL_SCORE;

    for (let i = 0; i < 20; i += 1) {
      s = applyMiss(s, ARCADE_RULES, i);
    }

    expect(s.spirit).toBe(0);
  });
});

describe('Fever', () => {
  const full: ScoreState = { ...INITIAL_SCORE, meter: 1 };

  it('fills the meter per tier and drains it on a miss', () => {
    expect(applyHit(INITIAL_SCORE, ARCADE_RULES, 0, ctx()).meter).toBeCloseTo(
      0.024,
    );
    expect(
      applyMiss({ ...INITIAL_SCORE, meter: 0.5 }, ARCADE_RULES, 0).meter,
    ).toBeCloseTo(0.46);
  });

  it('waits at full for a crash when the kit has one', () => {
    const snare = applyHit(full, ARCADE_RULES, 0, ctx());

    expect(snare.fever).toBe(false);
    expect(snare.meter).toBe(1);

    const crash = applyHit(full, ARCADE_RULES, 0, ctx({ isCrash: true }));

    expect(crash.fever).toBe(true);
    expect(crash.feverEnd).toBe(5);
  });

  it('starts on any hit when the kit has no crash', () => {
    expect(
      applyHit(full, ARCADE_RULES, 2, ctx({ hasCrash: false })).fever,
    ).toBe(true);
  });

  it('doubles points and the shown multiplier, then runs out', () => {
    const on = applyHit(full, ARCADE_RULES, 0, ctx({ isCrash: true }));
    const next = applyHit(on, ARCADE_RULES, 0, ctx({ time: 2 }));

    expect(next.score - on.score).toBe(200);
    expect(displayMultiplier(next)).toBe(2);
    expect(feverLevel(next, 3)).toBeCloseTo(0.5);
    expect(updateFever(next, 4.9).fever).toBe(true);

    const off = updateFever(next, 5);

    expect(off.fever).toBe(false);
    expect(off.meter).toBe(0);
    // A hit after the end scores normally again.
    expect(applyHit(next, ARCADE_RULES, 0, ctx({ time: 6 })).score).toBe(
      next.score + 100,
    );
  });

  it('is off in Play', () => {
    const s = hits(INITIAL_SCORE, 200, 0, PLAY_RULES);

    expect(s.meter).toBe(0);
    expect(s.fever).toBe(false);
  });
});

describe('Play scoring', () => {
  it('scores 100 / 50 times 1 + streak / 10, reset by a miss', () => {
    expect(applyHit(INITIAL_SCORE, PLAY_RULES, 1, ctx()).score).toBe(50);

    const s = hits(INITIAL_SCORE, 10, 0, PLAY_RULES);

    expect(s.mult).toBe(2);
    expect(s.score).toBe(9 * 100 + 200);
    expect(hits(INITIAL_SCORE, 45, 0, PLAY_RULES).mult).toBe(4);
    expect(applyMiss(s, PLAY_RULES, 0).mult).toBe(1);
  });
});

describe('summarize', () => {
  it('weights accuracy by tier and keeps timing stats over hits only', () => {
    const s = summarize(
      [
        judgment({ tier: 0, offsetMs: 10 }),
        judgment({ tier: 1, offsetMs: -30 }),
        judgment({ tier: 2, offsetMs: 80 }),
        judgment({ tier: -1 }),
      ],
      ARCADE_RULES,
    );

    expect(s.judged).toBe(4);
    expect(s.counts).toEqual([1, 1, 1, 1]);
    expect(s.hits).toBe(3);
    expect(s.misses).toBe(1);
    expect(s.accuracy).toBeCloseTo((1 + 0.8 + 0.5) / 4);
    expect(s.avgMs).toBeCloseTo(20);
    expect(s.spreadMs).toBeCloseTo(Math.sqrt((100 + 2500 + 3600) / 3));
  });

  it('handles nothing judged', () => {
    const s = summarize([], PLAY_RULES);

    expect(s).toMatchObject({ judged: 0, accuracy: 0, avgMs: 0, spreadMs: 0 });
    expect(s.counts).toEqual([0, 0, 0]);
  });
});

describe('replay', () => {
  it('rebuilds the same state as applying judgments live', () => {
    const list = [
      judgment({ noteId: 'a', tier: 0, time: 1 }),
      judgment({ noteId: 'b', tier: 2, time: 1.5 }),
      judgment({ noteId: 'c', tier: -1, time: 2 }),
      judgment({ noteId: 'd', tier: 1, time: 2.5 }),
    ];
    let live = INITIAL_SCORE;

    for (const j of list) {
      live =
        j.tier < 0
          ? applyMiss(live, ARCADE_RULES, j.time)
          : applyHit(live, ARCADE_RULES, j.tier, j);
    }

    expect(replay(list, ARCADE_RULES)).toEqual(live);
  });

  it('drops a rewound tail through the log', () => {
    const log = new JudgmentLog(ARCADE_RULES);
    let calls = 0;

    log.subscribe(() => {
      calls += 1;
    });
    log.add(judgment({ noteId: 'a', time: 1 }));
    log.add(judgment({ noteId: 'b', time: 2 }));
    log.add(judgment({ noteId: 'c', time: 3, tier: -1 }));

    expect(log.summary().judged).toBe(3);

    log.dropFrom(2);

    expect(log.values().map((j) => j.noteId)).toEqual(['a']);
    expect(log.summary().judged).toBe(1);
    expect(replay(log.values(), ARCADE_RULES).score).toBe(100);
    expect(calls).toBe(4);

    log.dropFrom(10);
    log.clear();
    log.clear();

    expect(calls).toBe(5);
    expect(log.size).toBe(0);
  });
});

describe('results helpers', () => {
  it('rates stars by accuracy', () => {
    expect(starsFor(1)).toBe(5);
    expect(starsFor(0.92)).toBe(4);
    expect(starsFor(0.8)).toBe(3);
    expect(starsFor(0.7)).toBe(2);
    expect(starsFor(0.5)).toBe(1);
    expect(starsFor(0.2)).toBe(0);
  });

  it('formats offsets with a sign', () => {
    expect(formatOffset(12.4)).toBe('+12 ms');
    expect(formatOffset(-8)).toBe('−8 ms');
    expect(formatOffset(0.3)).toBe('0 ms');
  });

  it('describes the timing lean', () => {
    const base = summarize([], ARCADE_RULES);

    expect(timingLean({ ...base, avgMs: -22 })).toBe(
      'You lean 22 ms early overall.',
    );
    expect(timingLean({ ...base, avgMs: 3, spreadMs: 40 })).toMatch(/spread/);
    expect(timingLean({ ...base, avgMs: 3, spreadMs: 10 })).toBe(
      'Centered and steady.',
    );
  });

  it('breaks results down by pad and section and finds the weakest section', () => {
    const sn = {
      id: 'sn',
      type: 'snare' as const,
      name: 'Snare',
      size: 13,
      x: 36,
      y: 60,
      voices: ['snare' as const],
      color: '#5b7fd1',
    };
    const kk = { ...sn, id: 'kk', type: 'kick' as const, name: 'Kick' };
    const sections = [
      { name: 'Intro', startTick: 0, endTick: 100, start: 0, end: 10 },
      { name: 'Verse', startTick: 100, endTick: 200, start: 10, end: 20 },
    ];
    const r = buildResults(
      [
        judgment({ noteId: 'a', time: 1, pieceId: 'sn', tier: 0 }),
        judgment({ noteId: 'b', time: 11, pieceId: 'kk', tier: -1 }),
        judgment({ noteId: 'c', time: 12, pieceId: 'sn', tier: 0 }),
      ],
      ARCADE_RULES,
      INITIAL_SCORE,
      0.85,
      [sn, kk],
      sections,
    );

    expect(r.pads.map((p) => [p.piece.id, p.summary.judged])).toEqual([
      ['sn', 2],
      ['kk', 1],
    ]);
    expect(r.sections.map((s) => [s.name, s.summary.accuracy])).toEqual([
      ['Intro', 1],
      ['Verse', 0.5],
    ]);
    expect(r.weakestSection).toBe(1);
    expect(r.speed).toBe(0.85);
  });
});
