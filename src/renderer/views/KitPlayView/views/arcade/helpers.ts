import { ticksToSeconds } from '../../../../../chart-parser/timing';
import { ParsedChart } from '../../../../../chart-parser/types';
import { InputMapping } from '../../../../../types';
import { controlLabel, controlSource } from '../../../../input';
import {
  controlsForPiece,
  Kit,
  KitPiece,
  TimelineBar,
  TimelineNote,
  Voice,
  VOICE_INFO,
  VOICES,
} from '../../../../kit';
import { barRangeLabel, prettySectionName } from '../shared/sections';
import { clamp } from '../shared/stats';

/** A stretch of the song the player can loop. Ends where the next one starts. */
export interface SongSection {
  name: string;
  startTick: number;
  endTick: number;
  /** Audio seconds. */
  start: number;
  end: number;
}

/** Bars per chunk when a chart has no section markers. */
export const CHUNK_BARS = 8;

type SectionChart = Pick<ParsedChart, 'sections' | 'resolution' | 'tempos'>;

/**
 * The chart's sections as loopable ranges. A gap before the first marker
 * becomes "Start". Without markers the song is cut into 8-bar chunks.
 */
export function buildSections(
  chart: SectionChart,
  bars: TimelineBar[],
  delaySeconds: number,
): SongSection[] {
  if (bars.length === 0) {
    return [];
  }

  const first = bars[0].startTick;
  const last = bars[bars.length - 1].endTick;
  const toTime = (tick: number) =>
    ticksToSeconds(tick, chart.resolution, chart.tempos) + delaySeconds;
  const marks = [...(chart.sections ?? [])]
    .filter((s) => s.tick >= first && s.tick < last)
    .sort((a, b) => a.tick - b.tick)
    .filter((s, i, all) => i === 0 || s.tick !== all[i - 1].tick);

  if (marks.length === 0) {
    const out: SongSection[] = [];

    for (let i = 0; i < bars.length; i += CHUNK_BARS) {
      const a = bars[i];
      const b = bars[Math.min(bars.length, i + CHUNK_BARS) - 1];

      out.push({
        name: barRangeLabel(i, Math.min(bars.length, i + CHUNK_BARS)),
        startTick: a.startTick,
        endTick: b.endTick,
        start: a.start,
        end: b.end,
      });
    }

    return out;
  }

  const starts = [
    ...(marks[0].tick > first ? [{ tick: first, name: 'Start' }] : []),
    ...marks.map((m) => ({ tick: m.tick, name: prettySectionName(m.name) })),
  ];

  return starts.map((s, i) => {
    const endTick = i + 1 < starts.length ? starts[i + 1].tick : last;

    return {
      name: s.name,
      startTick: s.tick,
      endTick,
      start: toTime(s.tick),
      end: toTime(endTick),
    };
  });
}

/** Index of the section playing at `time` (clamped to the first / last). */
export function sectionIndexAt(sections: SongSection[], time: number): number {
  let lo = 0;
  let hi = sections.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;

    if (sections[mid].start <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return Math.max(0, lo);
}

/** Index of the bar playing at `time` (clamped). */
export function barIndexAt(bars: TimelineBar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;

    if (bars[mid].start <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return Math.max(0, lo);
}

/** Length of one beat at `time`, in seconds. */
export function beatSecondsAt(bars: TimelineBar[], time: number): number {
  const bar = bars[barIndexAt(bars, time)];

  if (!bar || bar.beats.length === 0) {
    return 0.5;
  }

  return (bar.end - bar.start) / bar.beats.length;
}

/** `KeyJ` → `J`, `Digit4` → `4`, `Semicolon` → `;`. */
export function keyLabel(code: string): string {
  const named: Record<string, string> = {
    Space: 'Space',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Enter: 'Enter',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };

  if (named[code]) {
    return named[code];
  }

  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);

  return m ? m[1] : code;
}

/** The keyboard key that plays a piece, for its pad label; '' if none. */
export function padKeyLabel(
  kit: Kit,
  piece: KitPiece,
  mapping: InputMapping,
): string {
  const key = controlsForPiece(kit, piece, mapping).find(
    (c) => controlSource(c) === 'keyboard',
  );

  return key ? keyLabel(controlLabel(key)) : '';
}

/**
 * Keeps the order of `xs` but pushes neighbors at least `minGap` apart, then
 * shifts the run back inside [lo, hi] (squeezing evenly if it can't fit).
 */
export function spreadPositions(
  xs: number[],
  minGap: number,
  lo: number,
  hi: number,
): number[] {
  const n = xs.length;

  if (n === 0) {
    return [];
  }

  if (n > 1 && (n - 1) * minGap > hi - lo) {
    return xs.map((_, i) => lo + (i * (hi - lo)) / (n - 1));
  }

  const out = [...xs];

  for (let i = 1; i < n; i += 1) {
    out[i] = Math.max(out[i], out[i - 1] + minGap);
  }

  // Center the spread run on the original run.
  const shift = (xs[0] + xs[n - 1] - (out[0] + out[n - 1])) / 2;

  for (let i = 0; i < n; i += 1) {
    out[i] += shift;
  }

  const under = lo - out[0];
  const over = out[n - 1] - hi;

  if (under > 0) {
    return out.map((x) => x + under);
  }

  if (over > 0) {
    return out.map((x) => x - over);
  }

  return out;
}

/** The most `times` (sorted) that fall inside any window [t - before, t + after]. */
export function maxNotesInWindow(
  times: number[],
  before: number,
  after: number,
): number {
  const span = before + after;
  let best = 0;
  let j = 0;

  for (let i = 0; i < times.length; i += 1) {
    while (times[i] - times[j] > span) {
      j += 1;
    }

    best = Math.max(best, i - j + 1);
  }

  return best;
}

export interface Lanes {
  /** Pieces that receive hand notes, in kit order left to right. */
  hands: KitPiece[];
  /** The piece that receives kick notes. */
  kick: KitPiece | undefined;
}

/** Which pieces get a lane: every piece the chart's notes land on. */
export function lanePieces(
  notes: TimelineNote[],
  pieceByVoice: Map<Voice, KitPiece>,
): Lanes {
  const used = new Set<Voice>(notes.map((n) => n.voice));
  const kick = used.has('kick') ? pieceByVoice.get('kick') : undefined;
  const hands = new Set<KitPiece>();

  for (const v of VOICES) {
    const p = pieceByVoice.get(v.id);

    if (p && p !== kick && used.has(v.id)) {
      hands.add(p);
    }
  }

  return { hands: [...hands].sort((a, b) => a.x - b.x), kick };
}

/** The highest staff step of any voice landing on this piece. */
export function staffStep(
  piece: KitPiece,
  pieceByVoice: Map<Voice, KitPiece>,
): number {
  return Math.max(
    -1,
    ...VOICES.filter((v) => pieceByVoice.get(v.id) === piece).map(
      (v) => v.step,
    ),
  );
}

/**
 * The lane a struck piece lights: itself, or the lane piece it shares a voice
 * with (a second crash lights the crash lane).
 */
export function laneOwner(piece: KitPiece, lanes: Lanes): KitPiece | undefined {
  const all = lanes.kick ? [...lanes.hands, lanes.kick] : lanes.hands;

  return (
    all.find((p) => p.id === piece.id) ??
    all.find((p) => p.voices.some((v) => piece.voices.includes(v)))
  );
}

/** Voices the chart uses that no piece on this kit plays. */
export function skippedVoices(
  notes: TimelineNote[],
  pieceByVoice: Map<Voice, KitPiece>,
): { names: string[]; count: number } {
  const counts = new Map<Voice, number>();

  for (const n of notes) {
    if (!pieceByVoice.has(n.voice)) {
      counts.set(n.voice, (counts.get(n.voice) ?? 0) + 1);
    }
  }

  return {
    names: VOICES.filter((v) => counts.has(v.id)).map((v) => v.name),
    count: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

export function skippedLine(skipped: { names: string[]; count: number }) {
  if (skipped.names.length === 0) {
    return '';
  }

  return `Not on this kit: ${skipped.names.join(', ')} (${skipped.count} ${
    skipped.count === 1 ? 'note' : 'notes'
  } skipped).`;
}

export const isCymbalVoice = (v: Voice) => VOICE_INFO[v].cymbal;

/**
 * Gems on the Lanes and Rails highways, in fractions of the look-ahead:
 * drawn out to 1.05 (a little past the far edge so they slide in), faded
 * in over the last 0.12 before that edge and out over 0.12 past the hit
 * line. A missed gem stays at 0.3 so the player sees what was missed.
 */
export const LANE_GEM_FAR = 1.05;

export const LANE_GEM_FADE = 0.12;

export const MISSED_LANE_GEM_OPACITY = 0.3;

/** Opacity of an unhit lane gem at `t` look-aheads before its note (negative after). */
export function laneGemOpacity(t: number, missed: boolean): number {
  const fadeIn = clamp((LANE_GEM_FAR - t) / LANE_GEM_FADE);
  const fadeOut = t < 0 ? clamp(1 + t / LANE_GEM_FADE) : 1;

  return fadeIn * fadeOut * (missed ? MISSED_LANE_GEM_OPACITY : 1);
}

/** Deterministic pseudo-random in [0, 1) per integer seed (demo autoplay jitter). */
export function hash01(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;

  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;

  return (x >>> 0) / 4294967296;
}

/**
 * How many gem elements each piece's pool needs so every note visible in a
 * window of [now - before, now + after] has one.
 */
export function poolSizes(
  notes: TimelineNote[],
  pieceByVoice: Map<Voice, KitPiece>,
  before: number,
  after: number,
  min = 4,
  max = 96,
): Map<string, number> {
  const times = new Map<string, number[]>();

  for (const n of notes) {
    const p = pieceByVoice.get(n.voice);

    if (p) {
      const list = times.get(p.id);

      if (list) {
        list.push(n.time);
      } else {
        times.set(p.id, [n.time]);
      }
    }
  }

  const out = new Map<string, number>();

  for (const [id, ts] of times) {
    out.set(
      id,
      Math.max(min, Math.min(max, maxNotesInWindow(ts, before, after) + 2)),
    );
  }

  return out;
}

/** Calls `fn(time, isDownbeat)` for every beat in [from, to]. */
export function forEachBeat(
  bars: TimelineBar[],
  from: number,
  to: number,
  fn: (time: number, isDownbeat: boolean) => void,
): void {
  if (bars.length === 0) {
    return;
  }

  for (let i = barIndexAt(bars, from); i < bars.length; i += 1) {
    const bar = bars[i];

    if (bar.start > to) {
      break;
    }

    bar.beats.forEach((t, b) => {
      if (t >= from && t <= to) {
        fn(t, b === 0);
      }
    });
  }
}

/** Song progress 0–1 at `time`, over the chart's bars. */
export function songProgress(bars: TimelineBar[], time: number): number {
  if (bars.length === 0) {
    return 0;
  }

  const a = bars[0].start;
  const b = bars[bars.length - 1].end;

  return b > a ? clamp((time - a) / (b - a)) : 0;
}
