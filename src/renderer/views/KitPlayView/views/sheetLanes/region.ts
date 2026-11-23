import { TimelineBar, TimelineNote } from '../../../../kit';

/** Bars per practice window (the mock's 4-bar groove). */
export const WINDOW_BARS = 4;

/** A bar range of the song, `end` exclusive (indices into `session.bars`). */
export interface BarRange {
  start: number;
  end: number;
}

export interface LoopNote {
  note: TimelineNote;
  /** Bar index inside the loop. */
  bar: number;
  /** Beat position inside its bar (0 = downbeat). */
  beat: number;
}

export interface LoopBar {
  bar: TimelineBar;
  /** Beats from the loop start to this bar's downbeat. */
  beatOffset: number;
  beatCount: number;
  notes: LoopNote[];
}

/** The practice loop: bars laid out on one beat axis. */
export interface LoopModel {
  range: BarRange;
  bars: LoopBar[];
  /** Every note in the loop, by time. */
  notes: LoopNote[];
  /** Total beats in one pass. */
  beats: number;
  /** Audio seconds of the loop start / end (song time). */
  start: number;
  end: number;
  span: number;
  startTick: number;
  endTick: number;
  /** Song seconds of one beat at the loop start. */
  beatSeconds: number;
}

export function firstBarWithNotes(notes: TimelineNote[]): number {
  return notes.length > 0 ? Math.min(...notes.map((n) => n.measureIdx)) : 0;
}

export function clampRange(range: BarRange, barCount: number): BarRange {
  const start = Math.max(0, Math.min(range.start, barCount - 1));
  const end = Math.max(start + 1, Math.min(range.end, barCount));

  return { start, end };
}

/** The first `size` bars starting at the first bar that has notes. */
export function defaultRange(
  bars: TimelineBar[],
  notes: TimelineNote[],
  size = WINDOW_BARS,
): BarRange {
  const start = firstBarWithNotes(notes);

  return clampRange({ start, end: start + size }, bars.length);
}

/** The previous / next `size`-bar window from `range.start`. */
export function shiftRange(
  range: BarRange,
  dir: -1 | 1,
  barCount: number,
  size = WINDOW_BARS,
): BarRange {
  const start =
    dir > 0
      ? Math.min(range.start + size, barCount - 1)
      : Math.max(0, range.start - size);

  return clampRange({ start, end: start + size }, barCount);
}

/** The first `size`-bar window at or after bar `from` that starts with notes. */
export function nextRangeWithNotes(
  notes: TimelineNote[],
  from: number,
  barCount: number,
  size = WINDOW_BARS,
): BarRange | undefined {
  let start = Infinity;

  for (const n of notes) {
    if (n.measureIdx >= from && n.measureIdx < start) {
      start = n.measureIdx;
    }
  }

  return Number.isFinite(start) && start < barCount
    ? clampRange({ start, end: start + size }, barCount)
    : undefined;
}

/** Index of the bar containing `tick` (the last bar if past the end). */
export function barAtTick(bars: TimelineBar[], tick: number): number {
  const i = bars.findIndex((b) => tick < b.endTick);

  return i < 0 ? bars.length - 1 : i;
}

export interface SectionRange extends BarRange {
  name: string;
}

/** Chart sections as bar ranges, each running to the next section. */
export function sectionRanges(
  sections: { tick: number; name: string }[],
  bars: TimelineBar[],
): SectionRange[] {
  if (bars.length === 0) {
    return [];
  }

  const sorted = [...sections].sort((a, b) => a.tick - b.tick);
  const out: SectionRange[] = [];

  sorted.forEach((s, i) => {
    const start = barAtTick(bars, s.tick);
    const next = sorted[i + 1];
    const end = next ? barAtTick(bars, next.tick) : bars.length;

    if (end > start) {
      out.push({ name: s.name.replace(/_/g, ' '), start, end });
    }
  });

  return out;
}

export function buildLoopModel(
  bars: TimelineBar[],
  notes: TimelineNote[],
  range: BarRange,
): LoopModel {
  const { start, end } = clampRange(range, bars.length);
  const loopBars: LoopBar[] = [];
  let beatOffset = 0;

  for (let i = start; i < end; i += 1) {
    const bar = bars[i];
    const beatCount = Math.max(1, bar.beats.length);

    loopBars.push({ bar, beatOffset, beatCount, notes: [] });
    beatOffset += beatCount;
  }

  const loopNotes: LoopNote[] = [];

  for (const note of notes) {
    if (note.measureIdx < start || note.measureIdx >= end) {
      continue;
    }

    const barIdx = note.measureIdx - start;
    const lb = loopBars[barIdx];
    const span = lb.bar.endTick - lb.bar.startTick;
    const beat =
      span > 0 ? ((note.tick - lb.bar.startTick) / span) * lb.beatCount : 0;
    const ln = { note, bar: barIdx, beat };

    lb.notes.push(ln);
    loopNotes.push(ln);
  }

  const first = loopBars[0]?.bar;
  const last = loopBars[loopBars.length - 1]?.bar;
  const loopStart = first?.start ?? 0;
  const loopEnd = last?.end ?? loopStart;

  return {
    range: { start, end },
    bars: loopBars,
    notes: loopNotes,
    beats: beatOffset,
    start: loopStart,
    end: loopEnd,
    span: loopEnd - loopStart,
    startTick: first?.startTick ?? 0,
    endTick: last?.endTick ?? 0,
    beatSeconds: first ? beatLength(first, 0) : 0.5,
  };
}

function beatLength(bar: TimelineBar, i: number): number {
  const next = bar.beats[i + 1] ?? bar.end;

  return Math.max(1e-3, next - (bar.beats[i] ?? bar.start));
}

/**
 * Beat position of audio time `t` on the loop's beat axis. Before the loop it
 * extrapolates at the first beat's length (negative), after it at the last.
 */
export function loopBeatAt(model: LoopModel, t: number): number {
  const { bars } = model;

  if (bars.length === 0) {
    return 0;
  }

  if (t < model.start) {
    return (t - model.start) / beatLength(bars[0].bar, 0);
  }

  if (t >= model.end) {
    const last = bars[bars.length - 1].bar;

    return (
      model.beats + (t - model.end) / beatLength(last, last.beats.length - 1)
    );
  }

  let lo = 0;
  let hi = bars.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;

    if (bars[mid].bar.start <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const lb = bars[lo];
  const { beats } = lb.bar;
  let i = 0;

  while (i + 1 < beats.length && beats[i + 1] <= t) {
    i += 1;
  }

  const from = beats[i] ?? lb.bar.start;

  return lb.beatOffset + i + (t - from) / beatLength(lb.bar, i);
}

/** The loop bar index at a beat position inside one pass. */
export function loopBarAtBeat(model: LoopModel, beat: number): number {
  let i = 0;

  while (i + 1 < model.bars.length && model.bars[i + 1].beatOffset <= beat) {
    i += 1;
  }

  return i;
}

/** `Bars 5–8` (1-based, inclusive). */
export function rangeLabel(range: BarRange): string {
  return range.end - range.start <= 1
    ? `Bar ${range.start + 1}`
    : `Bars ${range.start + 1}–${range.end}`;
}
