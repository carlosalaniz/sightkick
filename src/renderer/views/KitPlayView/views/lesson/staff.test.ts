import { describe, expect, it } from 'vitest';
import { makeBars, makeNote, rockBar } from './fixtures';
import {
  BAR_W,
  barFracAt,
  countIndexAt,
  countSubdivision,
  layoutStaff,
  playheadX,
  staffX,
  STAFF_X0,
} from './staff';

const bars = makeBars(8).slice(4, 8);
const notes = [4, 5, 6, 7].flatMap(rockBar);

describe('layoutStaff', () => {
  it('places notes by their position in the bar and voice step', () => {
    const layout = layoutStaff(bars, notes, 1);
    const kick = layout.notes.find((n) => n.voice === 'kick');
    const crashY = layout.y(10);

    expect(layout.notes).toHaveLength(notes.length);
    expect(kick?.x).toBe(staffX(0, 0));
    expect(kick?.y).toBeGreaterThan(layout.y(5));
    expect(crashY).toBeLessThan(layout.y(9));
    expect(layout.barX).toEqual(
      [0, 1, 2, 3, 4].map((i) => STAFF_X0 + i * BAR_W),
    );
  });

  it('beams hands per beat and stems the kick down', () => {
    const layout = layoutStaff(bars, notes, 1);

    // 4 beats × 4 bars of two eighth hi-hats: one beam each; kicks on 1 and 3 are quarters.
    expect(layout.beams).toHaveLength(16);
    expect(layout.flags).toHaveLength(0);
    // Hand stems: 8 per bar; kick stems: 2 per bar.
    expect(layout.stems).toHaveLength(4 * (8 + 2));
    expect(layout.stems.filter((s) => s.y2 === layout.bot)).toHaveLength(8);
  });

  it('flags a lone off-beat note and double-beams sixteenths', () => {
    const off = layoutStaff(bars.slice(0, 1), [makeNote(4, 2.5, 'kick')], 1);

    expect(off.flags).toHaveLength(1);

    const sixteenths = layoutStaff(
      bars.slice(0, 1),
      [0, 0.25, 0.5, 0.75].map((b) => makeNote(4, b, 'snare')),
      1,
    );

    expect(sixteenths.beams).toHaveLength(2);
  });

  it('shrinks the staff as help fades', () => {
    expect(layoutStaff(bars, notes, 1).h).toBe(15);
    expect(layoutStaff(bars, notes, 0).h).toBe(9);
  });

  it('draws a ledger line for crash notes', () => {
    expect(
      layoutStaff(bars.slice(0, 1), [makeNote(4, 0, 'crash')], 1).ledgers,
    ).toHaveLength(1);
  });
});

describe('counts', () => {
  it('counts "1 &" for eighth grooves and "1 e & a" for sixteenths', () => {
    expect(countSubdivision(bars, notes)).toBe(2);
    expect(countSubdivision(bars, [makeNote(4, 0.25, 'snare')])).toBe(4);

    const layout = layoutStaff(
      bars.slice(0, 1),
      [makeNote(4, 0.25, 'snare')],
      1,
    );

    expect(layout.counts.slice(0, 5).map((c) => c.label)).toEqual([
      '1',
      'e',
      '&',
      'a',
      '2',
    ]);
    expect(layout.counts[2].time).toBeCloseTo(8.25);
  });

  it('finds the syllable sounding now', () => {
    const { counts } = layoutStaff(bars, notes, 1);

    expect(countIndexAt(counts, 7.9)).toBe(-1);
    expect(countIndexAt(counts, 8)).toBe(0);
    expect(countIndexAt(counts, 8.3)).toBe(1);
    expect(countIndexAt(counts, 15.99)).toBe(counts.length - 1);
  });
});

describe('playhead', () => {
  it('follows beat times through the window and hides outside it', () => {
    expect(barFracAt(bars[0], 8)).toBe(0);
    expect(barFracAt(bars[0], 9)).toBeCloseTo(0.5);
    expect(playheadX(bars, 9)).toBeCloseTo(staffX(0, 0.5));
    expect(playheadX(bars, 15)).toBeCloseTo(staffX(3, 0.5));
    expect(playheadX(bars, 7)).toBeUndefined();
    expect(playheadX(bars, 16)).toBeUndefined();
  });
});
