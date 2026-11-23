import { TimelineBar, TimelineNote, Voice, VOICE_INFO } from '../../../../kit';

/** Staff drawing space: a 1000 × 284 viewBox, 4 bars of 214. */
export const STAFF_W = 1000;

export const STAFF_H = 284;

export const STAFF_X0 = 132;

export const BAR_W = 214;

const CY = 128;
const EPS = 1e-3;

export interface StaffNote {
  id: string;
  /** Index into the window's notes; used for `data-n` lookups. */
  index: number;
  voice: Voice;
  x: number;
  y: number;
  cymbal: boolean;
  /** Bar within the window. */
  bar: number;
}

export interface StaffLine {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface StaffRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CountMark {
  x: number;
  label: string;
  /** On the beat (a number), not a subdivision. */
  beat: boolean;
  /** Audio time the syllable falls on. */
  time: number;
}

export interface StaffLayout {
  /** Height of one staff step (half a line space). */
  h: number;
  rx: number;
  ry: number;
  y: (step: number) => number;
  top: number;
  bot: number;
  countY: number;
  markY: number;
  barX: number[];
  notes: StaffNote[];
  stems: StaffLine[];
  beams: StaffRect[];
  flags: string[];
  ledgers: StaffLine[];
  counts: CountMark[];
  subdivision: 2 | 4;
}

/** x of a point `frac` (0–1) of the way through window bar `bar`. */
export function staffX(bar: number, frac: number): number {
  return STAFF_X0 + bar * BAR_W + 20 + frac * (BAR_W - 22);
}

function noteFrac(bar: TimelineBar, tick: number): number {
  const span = bar.endTick - bar.startTick;

  return span > 0 ? (tick - bar.startTick) / span : 0;
}

const offGrid = (x: number) => Math.abs(x - Math.round(x)) > EPS;

/** 4 ("1 e & a") if any note sits off the eighth-note grid, else 2 ("1 &"). */
export function countSubdivision(
  bars: TimelineBar[],
  notes: Pick<TimelineNote, 'tick' | 'measureIdx'>[],
): 2 | 4 {
  const first = bars[0]?.measureIdx ?? 0;

  for (const n of notes) {
    const bar = bars[n.measureIdx - first];

    if (bar && offGrid(noteFrac(bar, n.tick) * bar.beats.length * 2)) {
      return 4;
    }
  }

  return 2;
}

const SYLLABLES: Record<2 | 4, string[]> = {
  2: ['', '&'],
  4: ['', 'e', '&', 'a'],
};

/** Fraction of the way through a bar at time `t`, following its beat times. */
export function barFracAt(bar: TimelineBar, t: number): number {
  const n = bar.beats.length;

  if (n === 0 || t <= bar.start) {
    return 0;
  }

  if (t >= bar.end) {
    return 1;
  }

  for (let i = 0; i < n; i += 1) {
    const b0 = bar.beats[i];
    const b1 = i + 1 < n ? bar.beats[i + 1] : bar.end;

    if (t < b1) {
      return (i + (b1 > b0 ? (t - b0) / (b1 - b0) : 0)) / n;
    }
  }

  return 1;
}

/** Playhead x at time `t`, or undefined outside the window. */
export function playheadX(bars: TimelineBar[], t: number): number | undefined {
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];

    if (t >= bar.start && t < bar.end) {
      return staffX(i, barFracAt(bar, t));
    }
  }

  return undefined;
}

/** Index of the count syllable sounding at `t`, or -1. */
export function countIndexAt(counts: CountMark[], t: number): number {
  if (counts.length === 0 || t < counts[0].time) {
    return -1;
  }

  let lo = 0;
  let hi = counts.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;

    if (counts[mid].time <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}

/**
 * Geometry for the static staff of one window: noteheads, stems and beams
 * per beat (hands up, kick down), and count syllables. More `guide` (0–1)
 * spaces the lines wider and draws bigger noteheads; as the help fades the
 * staff shrinks to plain notation.
 */
export function layoutStaff(
  bars: TimelineBar[],
  notes: TimelineNote[],
  guide: number,
): StaffLayout {
  const h = 9 + 6 * guide;
  const y = (s: number) => CY - (s - 5) * h;
  const top = y(10) - 20;
  const bot = y(0) + 22;
  const countY = bot + 30;
  const rx = 7 + 3 * guide;
  const ry = 5 + 2 * guide;
  const first = bars[0]?.measureIdx ?? 0;
  const barX = bars.map((_, i) => STAFF_X0 + i * BAR_W);

  barX.push(STAFF_X0 + bars.length * BAR_W);

  const staffNotes: StaffNote[] = [];
  const groups = new Map<
    string,
    { beats: number; items: StaffNote[]; pos: number[] }
  >();

  notes.forEach((n, index) => {
    const barIdx = n.measureIdx - first;
    const bar = bars[barIdx];

    if (!bar) {
      return;
    }

    const frac = noteFrac(bar, n.tick);
    const info = VOICE_INFO[n.voice];
    const note: StaffNote = {
      id: n.id,
      index,
      voice: n.voice,
      x: staffX(barIdx, frac),
      y: y(info.step),
      cymbal: info.cymbal,
      bar: barIdx,
    };
    const beats = Math.max(1, bar.beats.length);
    const pos = frac * beats;
    const key = `${barIdx}:${Math.floor(pos + EPS)}`;
    const group = groups.get(key) ?? { beats, items: [], pos: [] };

    group.items.push(note);
    group.pos.push(pos);
    groups.set(key, group);
    staffNotes.push(note);
  });

  const stems: StaffLine[] = [];
  const beams: StaffRect[] = [];
  const flags: string[] = [];
  const ledgers: StaffLine[] = [];

  for (const note of staffNotes) {
    if (VOICE_INFO[note.voice].step >= 10) {
      ledgers.push({
        x1: note.x - rx - 4,
        x2: note.x + rx + 4,
        y1: y(10),
        y2: y(10),
      });
    }
  }

  for (const group of groups.values()) {
    for (const feet of [false, true]) {
      const items = group.items
        .map((n, i) => ({ n, pos: group.pos[i] }))
        .filter(({ n }) => (n.voice === 'kick') === feet);

      if (items.length === 0) {
        continue;
      }

      const xs = [
        ...new Set(items.map(({ n }) => Math.round(n.x * 10) / 10)),
      ].sort((a, b) => a - b);
      const sixteenth = items.some(({ pos }) => offGrid(pos * 2));
      const offBeat = items.every(({ pos }) => offGrid(pos));

      for (const x of xs) {
        const at = items.filter(({ n }) => Math.abs(n.x - x) < 0.2);

        if (feet) {
          const sx = x - rx + 1;

          stems.push({ x1: sx, x2: sx, y1: y(1), y2: bot });
        } else {
          const low = Math.max(...at.map(({ n }) => n.y));
          const sx = x + rx - 1;

          stems.push({ x1: sx, x2: sx, y1: low, y2: top });
        }
      }

      const x0 = feet ? xs[0] - rx + 1 : xs[0] + rx - 1;
      const x1 = feet ? xs[xs.length - 1] - rx + 1 : xs[xs.length - 1] + rx - 1;
      const by = feet ? bot - 4.5 : top;
      const dir = feet ? -1 : 1;

      if (xs.length > 1) {
        beams.push({ x: x0 - 0.8, y: by, w: x1 - x0 + 1.6, h: 4.5 });

        if (sixteenth) {
          beams.push({
            x: x0 - 0.8,
            y: by + dir * 7,
            w: x1 - x0 + 1.6,
            h: 4.5,
          });
        }
      } else if (offBeat) {
        const y0 = feet ? bot : top;

        flags.push(
          `M${x0.toFixed(1)} ${y0.toFixed(1)} q 7 ${dir * 4} 8 ${dir * 13}`,
        );

        if (sixteenth) {
          const y1 = y0 + dir * 7;

          flags.push(
            `M${x0.toFixed(1)} ${y1.toFixed(1)} q 7 ${dir * 4} 8 ${dir * 13}`,
          );
        }
      }
    }
  }

  const subdivision = countSubdivision(bars, notes);
  const counts: CountMark[] = [];

  bars.forEach((bar, barIdx) => {
    const n = bar.beats.length;

    for (let b = 0; b < n; b += 1) {
      const t0 = bar.beats[b];
      const t1 = b + 1 < n ? bar.beats[b + 1] : bar.end;

      for (let s = 0; s < subdivision; s += 1) {
        counts.push({
          x: staffX(barIdx, (b + s / subdivision) / n),
          label: s === 0 ? String(b + 1) : SYLLABLES[subdivision][s],
          beat: s === 0,
          time: t0 + ((t1 - t0) * s) / subdivision,
        });
      }
    }
  });

  return {
    h,
    rx,
    ry,
    y,
    top,
    bot,
    countY,
    markY: countY + 14,
    barX,
    notes: staffNotes,
    stems,
    beams,
    flags,
    ledgers,
    counts,
    subdivision,
  };
}
