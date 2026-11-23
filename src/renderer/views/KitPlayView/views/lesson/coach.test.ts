import { describe, expect, it } from 'vitest';
import { coachTip, HISTORY, recordOffset, TimingHistory } from './coach';

const pass = (missed: number, missedByBar = [0, 0, 0, 0], allowed = 1) => ({
  missed,
  allowed,
  missedByBar,
});

function history(entries: Record<string, number[]>): TimingHistory {
  const h: TimingHistory = new Map();

  for (const [voice, list] of Object.entries(entries)) {
    for (const ms of list) {
      recordOffset(h, voice as never, ms);
    }
  }

  return h;
}

describe('coachTip', () => {
  it('points at the bar with the most misses when there are too many', () => {
    expect(coachTip(pass(4, [0, 1, 3, 0]), new Map())).toEqual({
      kind: 'bar',
      bar: 2,
    });
  });

  it('names the pad with the strongest steady early / late habit', () => {
    const h = history({
      snare: Array(10).fill(-30),
      kick: Array(10).fill(25),
    });

    expect(coachTip(pass(0), h)).toEqual({
      kind: 'timing',
      voice: 'snare',
      ms: 30,
      early: true,
    });
  });

  it('ignores habits with too few hits or under 20 ms', () => {
    expect(coachTip(pass(0), history({ snare: Array(5).fill(-60) }))).toEqual({
      kind: 'steady',
    });
    expect(coachTip(pass(1), history({ kick: Array(12).fill(15) }))).toEqual({
      kind: 'steady',
    });
  });

  it('keeps only the last hits per pad', () => {
    const h = history({
      hihat: [...Array(HISTORY).fill(80), ...Array(HISTORY).fill(0)],
    });

    expect(h.get('hihat')).toHaveLength(HISTORY);
    expect(coachTip(pass(0), h)).toEqual({ kind: 'steady' });
  });
});
