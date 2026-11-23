import { TimelineBar, TimelineNote } from '../../../../kit';

/** Grace choices for wait mode, in ms; the default is the middle one. */
export const WAIT_GRACE_OPTIONS_MS = [30, 60, 90] as const;

/**
 * Grace actually used: never so late that the hold (which freezes the song a
 * frame or two after it starts) lands outside the note's hit window.
 */
export function effectiveGrace(graceMs: number, toleranceSeconds: number) {
  return Math.max(0, Math.min(graceMs / 1000, toleranceSeconds - 0.03));
}

/** How far back a note being held for still holds (past that, a seek). */
const HOLD_REACH = 0.5;

/**
 * The notes wait mode is holding for at `now`: the earliest unhit notes (all
 * voices at that tick) that are more than `grace` late. Hitting within the
 * grace never stops the song, so it plays on naturally. Notes further back
 * than the hit window were missed before wait mode could catch them (e.g.
 * it was just switched on) and are skipped, except the ones it is already
 * `holding` for: the song stopped for those, so it waits for them however
 * late the freeze landed.
 */
export function dueNotes(
  notes: TimelineNote[],
  hit: (note: TimelineNote) => boolean,
  now: number,
  tolerance: number,
  grace = 0,
  holding: ReadonlySet<string> = new Set(),
): TimelineNote[] {
  let tick: number | undefined;
  const due: TimelineNote[] = [];

  for (const note of notes) {
    if (
      note.time + grace > now ||
      note.time < now - (holding.has(note.id) ? HOLD_REACH : tolerance) ||
      hit(note)
    ) {
      continue;
    }

    if (tick === undefined || note.tick < tick) {
      tick = note.tick;
      due.length = 0;
    }

    if (note.tick === tick) {
      due.push(note);
    }
  }

  return due;
}

/**
 * Where a run-up to a held note starts: the last beat at least 3/4 of a beat
 * before it, so after finding the pad you play the note again, in time, with
 * a beat of the song leading into it. Never before `floor`.
 */
export function runUpStart(
  noteTime: number,
  bars: TimelineBar[],
  floor = -Infinity,
): number {
  const beats = bars.flatMap((b) => b.beats);
  const lastAtOrBefore = (time: number) => {
    let found = -1;

    beats.forEach((b, i) => {
      if (b <= time + 1e-6) {
        found = i;
      }
    });

    return found;
  };
  const at = lastAtOrBefore(noteTime);

  if (at < 0) {
    return Math.max(floor, noteTime);
  }

  const beat =
    (beats[at + 1] ?? bars.find((b) => b.end > beats[at])?.end ?? noteTime) -
    beats[at];
  const lead = noteTime - 0.75 * (beat > 0 ? beat : 0.5);
  const start = beats[Math.max(0, lastAtOrBefore(lead))];

  return Math.max(floor, Math.min(start, noteTime));
}

/** How many recent hits the live timing strip shows. */
export const OFFSET_LOG_SIZE = 16;

/** Recent hit offsets (ms, + late) with their mean and spread. */
export interface OffsetStats {
  offsets: number[];
  mean: number | undefined;
  /** Standard deviation, ms. */
  spread: number | undefined;
}

export function offsetStats(
  previous: number[],
  ms: number,
  size = OFFSET_LOG_SIZE,
): OffsetStats {
  const offsets = [...previous, ms].slice(-size);
  const n = offsets.length;

  if (n < 3) {
    return { offsets, mean: undefined, spread: undefined };
  }

  const mean = offsets.reduce((a, b) => a + b, 0) / n;
  const variance = offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);

  return { offsets, mean, spread: Math.sqrt(variance) };
}

/** Tempo readings are ignored for notes closer than this (flams, chords). */
const MIN_GAP_SECONDS = 0.08;
/** Gaps longer than this (rests, a pause) say nothing about tempo. */
const MAX_GAP_SECONDS = 2.5;
/** Weight of the newest reading in the running average. */
const SMOOTHING = 0.25;
/** Readings outside this ratio are treated as a stumble, not a tempo. */
const MAX_RATIO_ERROR = 0.35;

/**
 * Tracks the player's tempo against the selected one from the gaps between
 * their hits: chart gap / played gap, so 1 is spot on, above 1 rushing and
 * below 1 dragging. Gaps rather than offsets, so a constant latency or
 * sitting slightly behind the beat doesn't read as a tempo change.
 */
export class TempoMeter {
  private last: { tick: number; time: number; played: number } | undefined;
  private value: number | undefined;
  private readings = 0;

  /** Records a hit on `note` that landed `offsetSeconds` from it. */
  add(note: Pick<TimelineNote, 'tick' | 'time'>, offsetSeconds: number): void {
    const played = note.time + offsetSeconds;
    const last = this.last;

    if (last && note.tick === last.tick) {
      return;
    }

    this.last = { tick: note.tick, time: note.time, played };

    if (!last) {
      return;
    }

    const chartGap = note.time - last.time;
    const playedGap = played - last.played;

    if (chartGap < MIN_GAP_SECONDS || chartGap > MAX_GAP_SECONDS) {
      return;
    }

    if (playedGap <= 0) {
      return;
    }

    const ratio = chartGap / playedGap;

    if (Math.abs(ratio - 1) > MAX_RATIO_ERROR) {
      return;
    }

    this.value =
      this.value === undefined
        ? ratio
        : this.value + SMOOTHING * (ratio - this.value);
    this.readings += 1;
  }

  /** Forgets the previous hit (loop wrap, seek), keeping the average. */
  break(): void {
    this.last = undefined;
  }

  reset(): void {
    this.last = undefined;
    this.value = undefined;
    this.readings = 0;
  }

  /** Played tempo / selected tempo, once there are enough readings. */
  get ratio(): number | undefined {
    return this.readings >= 3 ? this.value : undefined;
  }
}
