import { describe, expect, it } from 'vitest';
import { makeBars, makeNote, rockBar, TICKS_PER_BAR } from './fixtures';
import {
  barRangeLabel,
  buildLessons,
  mixWindow,
  sectionLabel,
  windowNotes,
  windowSpan,
} from './windows';

const bars = makeBars(16);
// Bars 0–1 empty (intro), notes from bar 2 to bar 15.
const notes = Array.from({ length: 14 }, (_, i) => rockBar(i + 2)).flat();

describe('sectionLabel', () => {
  it('cleans raw chart section names', () => {
    expect(sectionLabel('prc_verse_1a')).toBe('Verse 1a');
    expect(sectionLabel('chorus_2')).toBe('Chorus 2');
    expect(sectionLabel('Bridge')).toBe('Bridge');
    expect(sectionLabel('  ')).toBe('');
  });
});

describe('buildLessons', () => {
  it('makes one 4-bar window per section, skipping empty leading bars', () => {
    const lessons = buildLessons(bars, notes, [
      { tick: 0, name: 'intro' },
      { tick: 6 * TICKS_PER_BAR, name: 'verse' },
      { tick: 12 * TICKS_PER_BAR, name: 'chorus' },
    ]);

    expect(lessons.map((l) => [l.name, l.startBar, l.endBar])).toEqual([
      ['Intro', 2, 6],
      ['Verse', 6, 10],
      ['Chorus', 12, 16],
    ]);
  });

  it('skips sections with no notes before the next one', () => {
    const lessons = buildLessons(bars, notes, [
      { tick: 0, name: 'silence' },
      { tick: TICKS_PER_BAR, name: 'more silence' },
      { tick: 2 * TICKS_PER_BAR, name: 'groove' },
    ]);

    expect(lessons.map((l) => [l.name, l.startBar])).toEqual([['Groove', 2]]);
  });

  it('keeps one lesson when two sections land on the same bar', () => {
    const lessons = buildLessons(bars, notes, [
      { tick: 0, name: 'a' },
      { tick: 100, name: 'b' },
    ]);

    expect(lessons.map((l) => [l.name, l.startBar])).toEqual([['A', 2]]);
  });

  it('falls back to 4-bar chunks with notes when there are no sections', () => {
    const lessons = buildLessons(bars, notes, []);

    expect(lessons.map((l) => l.startBar)).toEqual([2, 6, 10, 14]);
    expect(lessons[3].endBar).toBe(16);
    expect(lessons[0].name).toBe('Bars 3–6');
  });

  it('returns nothing for a chart without notes', () => {
    expect(buildLessons(bars, [], [])).toEqual([]);
  });
});

describe('mixWindow', () => {
  it('is the next 4 bars after the lesson', () => {
    const [first] = buildLessons(bars, notes, []);

    expect(mixWindow(first, bars, notes)).toMatchObject({
      startBar: 6,
      endBar: 10,
    });
  });

  it('skips empty chunks after the lesson', () => {
    const sparse = [...rockBar(0), ...rockBar(12)];
    const lesson = { key: 'b0', name: 'A', startBar: 0, endBar: 4 };

    expect(mixWindow(lesson, bars, sparse)).toMatchObject({
      startBar: 12,
      endBar: 16,
    });
  });

  it('uses the bars before the lesson when it is the last one', () => {
    const lesson = { key: 'b12', name: 'End', startBar: 12, endBar: 16 };

    expect(mixWindow(lesson, bars, notes)).toMatchObject({
      startBar: 8,
      endBar: 12,
    });
  });

  it('is undefined when no other bars have notes', () => {
    const only = rockBar(4);
    const lesson = { key: 'b4', name: 'Only', startBar: 4, endBar: 8 };

    expect(mixWindow(lesson, bars, only)).toBeUndefined();
  });
});

describe('window helpers', () => {
  it('selects notes and spans of a window', () => {
    const win = { startBar: 3, endBar: 5 };

    expect(
      windowNotes(notes, win).every(
        (n) => n.measureIdx >= 3 && n.measureIdx < 5,
      ),
    ).toBe(true);
    expect(windowNotes(notes, win)).toHaveLength(24);
    expect(windowSpan(bars, win)).toEqual({
      startTick: 3 * TICKS_PER_BAR,
      endTick: 5 * TICKS_PER_BAR,
      start: 6,
      end: 10,
    });
    expect(barRangeLabel({ startBar: 3, endBar: 4 })).toBe('Bar 4');
    expect(makeNote(0, 0, 'kick').id).toBe('0:f/4');
  });
});
