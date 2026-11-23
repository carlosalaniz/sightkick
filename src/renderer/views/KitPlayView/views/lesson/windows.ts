import { TimelineBar, TimelineNote } from '../../../../kit';

/** Bars per lesson window: the staff (staff.ts) is laid out for 4 bars. */
export const LESSON_BARS = 4;

/** One lesson: a window of bars of the real song, looped while you learn it. */
export interface LessonWindow {
  /** Stable id for progress: `b${startBar}`. */
  key: string;
  name: string;
  /** First bar (index into `session.bars`). */
  startBar: number;
  /** One past the last bar. */
  endBar: number;
}

export interface ChartSection {
  tick: number;
  name: string;
}

/** Turns raw chart section names (`prc_verse_1a`, `chorus_2`) into labels. */
export function sectionLabel(raw: string): string {
  const text = raw
    .replace(/^(prc|section)[_ ]/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

export function barRangeLabel(win: Pick<LessonWindow, 'startBar' | 'endBar'>) {
  return win.endBar - win.startBar > 1
    ? `Bars ${win.startBar + 1}–${win.endBar}`
    : `Bar ${win.startBar + 1}`;
}

/** How many notes start in each bar. */
export function notesPerBar(bars: TimelineBar[], notes: TimelineNote[]) {
  const counts = bars.map(() => 0);

  for (const n of notes) {
    if (n.measureIdx >= 0 && n.measureIdx < counts.length) {
      counts[n.measureIdx] += 1;
    }
  }

  return counts;
}

function hasNotes(counts: number[], start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (counts[i] > 0) {
      return true;
    }
  }

  return false;
}

function barAtTick(bars: TimelineBar[], tick: number): number {
  return bars.findIndex((b) => tick >= b.startTick && tick < b.endTick);
}

/**
 * The lesson path: one window per chart section (its first 4 bars with
 * notes), or every 4-bar chunk with notes when the chart has no sections.
 */
export function buildLessons(
  bars: TimelineBar[],
  notes: TimelineNote[],
  sections: ChartSection[],
): LessonWindow[] {
  const counts = notesPerBar(bars, notes);
  const lessons: LessonWindow[] = [];
  const used = new Set<number>();
  const sorted = [...sections].sort((a, b) => a.tick - b.tick);
  const sectionBars = sorted.map((s) => barAtTick(bars, s.tick));

  sorted.forEach((section, i) => {
    const from = sectionBars[i];

    if (from < 0) {
      return;
    }

    const next = sectionBars.slice(i + 1).find((b) => b > from);
    const limit = next ?? bars.length;
    let start = from;

    while (start < limit && counts[start] === 0) {
      start += 1;
    }

    if (start >= limit || used.has(start)) {
      return;
    }

    used.add(start);

    const endBar = Math.min(start + LESSON_BARS, bars.length);

    lessons.push({
      key: `b${start}`,
      name:
        sectionLabel(section.name) ||
        barRangeLabel({ startBar: start, endBar }),
      startBar: start,
      endBar,
    });
  });

  if (lessons.length > 0) {
    return lessons;
  }

  const first = counts.findIndex((c) => c > 0);

  if (first < 0) {
    return [];
  }

  for (let start = first; start < bars.length; start += LESSON_BARS) {
    const endBar = Math.min(start + LESSON_BARS, bars.length);

    if (hasNotes(counts, start, endBar)) {
      lessons.push({
        key: `b${start}`,
        name: barRangeLabel({ startBar: start, endBar }),
        startBar: start,
        endBar,
      });
    }
  }

  return lessons;
}

/**
 * The mix-up window for a lesson: the next 4 bars with notes after it (music
 * you have not practised), else the 4 bars before it. Undefined if neither.
 */
export function mixWindow(
  lesson: LessonWindow,
  bars: TimelineBar[],
  notes: TimelineNote[],
): LessonWindow | undefined {
  const counts = notesPerBar(bars, notes);
  const make = (startBar: number, endBar: number): LessonWindow => ({
    key: `mix${startBar}`,
    name: barRangeLabel({ startBar, endBar }),
    startBar,
    endBar,
  });

  for (let start = lesson.endBar; start < bars.length; start += LESSON_BARS) {
    const end = Math.min(start + LESSON_BARS, bars.length);

    if (hasNotes(counts, start, end)) {
      return make(start, end);
    }
  }

  for (let end = lesson.startBar; end > 0; end -= LESSON_BARS) {
    const start = Math.max(0, end - LESSON_BARS);

    if (hasNotes(counts, start, end)) {
      return make(start, end);
    }
  }

  return undefined;
}

/** The notes inside a window. */
export function windowNotes(
  notes: TimelineNote[],
  win: Pick<LessonWindow, 'startBar' | 'endBar'>,
): TimelineNote[] {
  return notes.filter(
    (n) => n.measureIdx >= win.startBar && n.measureIdx < win.endBar,
  );
}

/** Tick and time span of a window. */
export function windowSpan(
  bars: TimelineBar[],
  win: Pick<LessonWindow, 'startBar' | 'endBar'>,
) {
  const first = bars[win.startBar];
  const last = bars[win.endBar - 1];

  return {
    startTick: first.startTick,
    endTick: last.endTick,
    start: first.start,
    end: last.end,
  };
}
