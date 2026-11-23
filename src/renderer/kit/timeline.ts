import { Measure, ParsedChart } from '../../chart-parser/types';
import { ticksToSeconds } from '../../chart-parser/timing';
import { beatCountFor } from '../services/beat-grid/beat-grid';
import { keyPrefix } from '../services/engine/helpers';
import { PREFIX_TO_VOICE } from './constants';
import { Voice } from './types';

type TimingChart = Pick<ParsedChart, 'resolution' | 'tempos'>;

/** One voice of one chart note, placed in time. */
export interface TimelineNote {
  /** Stable id: `${tick}:${prefix}`. */
  id: string;
  tick: number;
  /** Audio time in seconds (chart time + song delay), comparable to `engine.timeStore.get()`. */
  time: number;
  /** VexFlow key prefix, e.g. `c/5`; what `engine.isHit(tick, prefix)` takes. */
  prefix: string;
  voice: Voice;
  accent: boolean;
  ghost: boolean;
  measureIdx: number;
}

export interface TimelineBar {
  measureIdx: number;
  startTick: number;
  endTick: number;
  start: number;
  end: number;
  /** Audio times of each beat in the bar, starting with the downbeat. */
  beats: number[];
  timeSig: [number, number];
}

export function buildNoteTimeline(
  measures: Measure[],
  chart: TimingChart,
  delaySeconds: number,
): TimelineNote[] {
  const notes: TimelineNote[] = [];

  measures.forEach((measure, measureIdx) => {
    for (const note of measure.notes) {
      if (note.isRest) {
        continue;
      }

      const accents = new Set((note.accents ?? []).map(keyPrefix));
      const ghosts = new Set((note.ghosts ?? []).map(keyPrefix));
      const time =
        ticksToSeconds(note.tick, chart.resolution, chart.tempos) +
        delaySeconds;
      const seen = new Set<string>();

      for (const key of note.notes) {
        const prefix = keyPrefix(key);
        const voice = PREFIX_TO_VOICE[prefix];

        if (!voice || seen.has(prefix)) {
          continue;
        }

        seen.add(prefix);
        notes.push({
          id: `${note.tick}:${prefix}`,
          tick: note.tick,
          time,
          prefix,
          voice,
          accent: accents.has(prefix),
          ghost: ghosts.has(prefix),
          measureIdx,
        });
      }
    }
  });

  return notes.sort(
    (a, b) => a.time - b.time || a.prefix.localeCompare(b.prefix),
  );
}

export function buildBarTimeline(
  measures: Measure[],
  chart: TimingChart,
  delaySeconds: number,
): TimelineBar[] {
  const toTime = (tick: number) =>
    ticksToSeconds(tick, chart.resolution, chart.tempos) + delaySeconds;

  return measures.map((measure, measureIdx) => {
    const count = beatCountFor(measure);
    const span = measure.endTick - measure.startTick;
    const beats: number[] = [];

    for (let i = 0; i < count; i += 1) {
      beats.push(toTime(measure.startTick + (span * i) / count));
    }

    return {
      measureIdx,
      startTick: measure.startTick,
      endTick: measure.endTick,
      start: toTime(measure.startTick),
      end: toTime(measure.endTick),
      beats,
      timeSig: measure.timeSig,
    };
  });
}

/** Index of the first note with `time >= t` (binary search). */
export function firstNoteAtOrAfter(notes: TimelineNote[], t: number): number {
  let lo = 0;
  let hi = notes.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (notes[mid].time >= t) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}
