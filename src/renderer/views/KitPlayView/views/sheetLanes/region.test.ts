import { describe, expect, it } from 'vitest';
import { TimelineBar, TimelineNote, Voice } from '../../../../kit';
import {
  barAtTick,
  buildLoopModel,
  defaultRange,
  loopBarAtBeat,
  loopBeatAt,
  nextRangeWithNotes,
  rangeLabel,
  sectionRanges,
  shiftRange,
} from './region';

const TPB = 480;

/** 4/4 bars of 2 s (120 BPM), except where `beatsPerBar` says otherwise. */
function makeBars(count: number, beatsPerBar: number[] = []): TimelineBar[] {
  const out: TimelineBar[] = [];
  let tick = 0;
  let time = 0;

  for (let i = 0; i < count; i += 1) {
    const n = beatsPerBar[i] ?? 4;
    const beats = Array.from({ length: n }, (_, k) => time + k * 0.5);

    out.push({
      measureIdx: i,
      startTick: tick,
      endTick: tick + n * TPB,
      start: time,
      end: time + n * 0.5,
      beats,
      timeSig: [n, 4],
    });
    tick += n * TPB;
    time += n * 0.5;
  }

  return out;
}

function note(
  bars: TimelineBar[],
  bar: number,
  beat: number,
  voice: Voice = 'snare',
): TimelineNote {
  const b = bars[bar];
  const tick = b.startTick + beat * TPB;

  return {
    id: `${tick}:${voice}`,
    tick,
    time: b.start + beat * 0.5,
    prefix: voice,
    voice,
    accent: false,
    ghost: false,
    measureIdx: bar,
  };
}

describe('loop ranges', () => {
  const bars = makeBars(12);

  it('defaults to the first 4 bars that have notes', () => {
    expect(defaultRange(bars, [note(bars, 2, 0), note(bars, 5, 1)])).toEqual({
      start: 2,
      end: 6,
    });
    expect(defaultRange(bars, [])).toEqual({ start: 0, end: 4 });
    expect(defaultRange(bars, [note(bars, 10, 0)])).toEqual({
      start: 10,
      end: 12,
    });
  });

  it('steps through 4-bar windows inside the song', () => {
    expect(shiftRange({ start: 2, end: 6 }, 1, 12)).toEqual({
      start: 6,
      end: 10,
    });
    expect(shiftRange({ start: 9, end: 12 }, 1, 12)).toEqual({
      start: 11,
      end: 12,
    });
    expect(shiftRange({ start: 2, end: 9 }, -1, 12)).toEqual({
      start: 0,
      end: 4,
    });
  });

  it('finds the next window that starts with notes', () => {
    const notes = [note(bars, 1, 0), note(bars, 7, 2)];

    expect(nextRangeWithNotes(notes, 4, 12)).toEqual({ start: 7, end: 11 });
    expect(nextRangeWithNotes(notes, 8, 12)).toBeUndefined();
  });

  it('turns chart sections into bar ranges', () => {
    const sections = [
      { tick: 4 * 4 * TPB, name: 'chorus_1' },
      { tick: 0, name: 'Intro' },
      { tick: 4 * 4 * TPB, name: 'dup' },
      { tick: 9 * 4 * TPB + 10, name: 'Outro' },
    ];

    expect(sectionRanges(sections, bars)).toEqual([
      { name: 'Intro', start: 0, end: 4 },
      { name: 'dup', start: 4, end: 9 },
      { name: 'Outro', start: 9, end: 12 },
    ]);
    expect(barAtTick(bars, 1e9)).toBe(11);
  });

  it('labels ranges 1-based', () => {
    expect(rangeLabel({ start: 4, end: 8 })).toBe('Bars 5–8');
    expect(rangeLabel({ start: 0, end: 1 })).toBe('Bar 1');
  });
});

describe('buildLoopModel', () => {
  const bars = makeBars(6, [4, 3, 4, 4]);
  const notes = [
    note(bars, 0, 0, 'kick'),
    note(bars, 1, 0),
    note(bars, 1, 2.5, 'hihat'),
    note(bars, 2, 1),
    note(bars, 3, 3.75),
  ];
  const model = buildLoopModel(bars, notes, { start: 1, end: 3 });

  it('keeps only the loop bars and lays them on one beat axis', () => {
    expect(model.bars.map((b) => [b.beatOffset, b.beatCount])).toEqual([
      [0, 3],
      [3, 4],
    ]);
    expect(model.beats).toBe(7);
    expect(model.notes.map((n) => [n.bar, n.beat])).toEqual([
      [0, 0],
      [0, 2.5],
      [1, 1],
    ]);
    expect(model.start).toBe(2);
    expect(model.end).toBe(5.5);
    expect(model.span).toBeCloseTo(3.5);
    expect(model.startTick).toBe(4 * TPB);
    expect(model.endTick).toBe(11 * TPB);
    expect(model.beatSeconds).toBe(0.5);
  });

  it('maps audio time to the beat axis, extrapolating outside the loop', () => {
    expect(loopBeatAt(model, 2)).toBe(0);
    expect(loopBeatAt(model, 3.25)).toBeCloseTo(2.5);
    expect(loopBeatAt(model, 3.5)).toBeCloseTo(3);
    expect(loopBeatAt(model, 5.25)).toBeCloseTo(6.5);
    expect(loopBeatAt(model, 1)).toBeCloseTo(-2);
    expect(loopBeatAt(model, 6)).toBeCloseTo(8);
  });

  it('finds the bar at a beat', () => {
    expect(loopBarAtBeat(model, 0)).toBe(0);
    expect(loopBarAtBeat(model, 2.99)).toBe(0);
    expect(loopBarAtBeat(model, 3)).toBe(1);
  });
});
