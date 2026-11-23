import { describe, expect, it } from 'vitest';
import {
  coachBand,
  coachFlag,
  coachReport,
  coachStatus,
  coachTip,
  COACH_LOG_SIZE,
  pushOffset,
} from './coach';

describe('coachBand', () => {
  it('is 4% of a sixteenth, between 10 and 25 ms', () => {
    expect(coachBand(125)).toBe(10);
    expect(coachBand(400)).toBe(16);
    expect(coachBand(1000)).toBe(25);
  });
});

describe('coachFlag', () => {
  const n = (ms: number, count = 8) => Array(count).fill(ms);

  it('needs 8 hits before saying anything', () => {
    expect(coachFlag(n(60, 7), 12)).toBeUndefined();
    expect(coachFlag(n(60), 12)).toBe('late');
  });

  it('flags late outside the band', () => {
    expect(coachFlag(n(12), 12)).toBeUndefined();
    expect(coachFlag(n(13), 12)).toBe('late');
  });

  it('tolerates an early lean up to 20 ms even when the band is narrower', () => {
    expect(coachFlag(n(-18), 12)).toBeUndefined();
    expect(coachFlag(n(-21), 12)).toBe('early');
    expect(coachFlag(n(-24), 25)).toBeUndefined();
    expect(coachFlag(n(-26), 25)).toBe('early');
  });
});

describe('coachReport', () => {
  it('reports the spread apart from the offset', () => {
    const report = coachReport(
      [
        ['sn', [-30, 30, -30, 30, -30, 30, -30, 30]],
        ['kk', [40, 40, 40, 40, 40, 40, 40, 40]],
        ['hh', []],
      ],
      15,
    );

    expect(report.rows.map((r) => r.key)).toEqual(['sn', 'kk']);

    const [sn, kk] = report.rows;

    expect(sn.meanMs).toBe(0);
    expect(sn.sdMs).toBe(30);
    expect(sn.flag).toBeUndefined();
    expect(kk.flag).toBe('late');
    expect(kk.sdMs).toBe(0);
    expect(report.totalHits).toBe(16);
    expect(coachStatus(sn)).toBe('fine');
    expect(coachStatus(kk)).toBe('late 40 ms');
    expect(coachTip(report, (k) => k.toUpperCase())).toBe(
      'KK is dragging about 40 ms. Start the stroke a little earlier.',
    );
  });

  it('suggests steadiness when nothing is off but the spread is wide', () => {
    const report = coachReport([['sn', [-30, 30, -30, 30]]], 12);

    expect(coachStatus(report.rows[0])).toBe('4 hits…');
    expect(coachTip(report, String)).toBe(
      'Nothing audible to fix (quiet band ±12 ms). Work on steadiness: your spread is wider than your offset.',
    );
  });

  it('says an early lean is fine', () => {
    const report = coachReport([['sn', Array(8).fill(-10)]], 12);

    expect(coachStatus(report.rows[0])).toBe('fine (early lean)');
  });
});

describe('pushOffset', () => {
  it('keeps a rolling window', () => {
    let log: number[] = [];

    for (let i = 0; i < COACH_LOG_SIZE + 5; i += 1) {
      log = pushOffset(log, i);
    }

    expect(log).toHaveLength(COACH_LOG_SIZE);
    expect(log[0]).toBe(5);
  });
});
