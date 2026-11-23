import { describe, expect, it } from 'vitest';
import { Measure, Note, ParsedChart } from '../../chart-parser/types';
import {
  buildBarTimeline,
  buildNoteTimeline,
  firstNoteAtOrAfter,
  lastIndexAtOrBefore,
} from './timeline';

const CHART = {
  resolution: 480,
  tempos: [{ tick: 0, beatsPerMinute: 120, msTime: 0 }],
} as unknown as Pick<ParsedChart, 'resolution' | 'tempos'>;

function note(keys: string[], tick: number, extra: Partial<Note> = {}): Note {
  return { notes: keys, tick, isRest: false, ...extra } as unknown as Note;
}

function measure(notes: Note[], startTick: number, endTick: number): Measure {
  return {
    notes,
    startTick,
    endTick,
    timeSig: [4, 4],
    isCompound: false,
  } as unknown as Measure;
}

describe('buildNoteTimeline', () => {
  it('splits chords into one entry per voice with audio times', () => {
    const measures = [
      measure(
        [
          note(['f/4', 'g/5/x2'], 0),
          note(['c/5'], 480, { accents: ['c/5'] }),
          note(['b/4'], 960, { isRest: true }),
        ],
        0,
        1920,
      ),
    ];
    const notes = buildNoteTimeline(measures, CHART, 1.5);

    expect(notes.map((n) => [n.voice, n.time])).toEqual([
      ['kick', 1.5],
      ['hihat', 1.5],
      ['snare', 2],
    ]);
    expect(notes[2]).toMatchObject({
      id: '480:c/5',
      prefix: 'c/5',
      accent: true,
      ghost: false,
      measureIdx: 0,
    });
  });

  it('counts both kick keys once per note', () => {
    const notes = buildNoteTimeline(
      [measure([note(['f/4', 'e/4'], 0)], 0, 1920)],
      CHART,
      0,
    );

    expect(notes.filter((n) => n.voice === 'kick')).toHaveLength(2);
    expect(new Set(notes.map((n) => n.prefix))).toEqual(
      new Set(['f/4', 'e/4']),
    );
  });
});

describe('buildBarTimeline', () => {
  it('gives each bar its start, end and beat times', () => {
    const [bar] = buildBarTimeline([measure([], 0, 1920)], CHART, 0);

    expect(bar.start).toBe(0);
    expect(bar.end).toBeCloseTo(2, 9);
    bar.beats.forEach((t, i) => expect(t).toBeCloseTo(i * 0.5, 9));
    expect(bar.beats).toHaveLength(4);
  });
});

describe('firstNoteAtOrAfter', () => {
  it('binary-searches by time', () => {
    const notes = buildNoteTimeline(
      [
        measure(
          [note(['c/5'], 0), note(['c/5'], 480), note(['c/5'], 960)],
          0,
          1920,
        ),
      ],
      CHART,
      0,
    );

    expect(firstNoteAtOrAfter(notes, -1)).toBe(0);
    expect(firstNoteAtOrAfter(notes, 0.25)).toBe(1);
    expect(firstNoteAtOrAfter(notes, 0.5)).toBe(1);
    expect(firstNoteAtOrAfter(notes, 9)).toBe(3);
  });
});

describe('lastIndexAtOrBefore', () => {
  const starts = [0, 2, 2, 5];
  const at = (t: number) => lastIndexAtOrBefore(starts, t, (x) => x);

  it('finds the last item starting at or before t', () => {
    expect(at(0)).toBe(0);
    expect(at(1.9)).toBe(0);
    expect(at(2)).toBe(2);
    expect(at(4)).toBe(2);
    expect(at(99)).toBe(3);
  });

  it('is -1 before the first item or for an empty list', () => {
    expect(at(-1)).toBe(-1);
    expect(lastIndexAtOrBefore([], 3, (x: number) => x)).toBe(-1);
  });
});
