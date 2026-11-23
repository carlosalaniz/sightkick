import { TimelineNote } from '../../../../kit';

/**
 * Wait mode holds playback a little before its hold point, so the freeze
 * (which lands a frame or two late) still stops on time.
 */
export const WAIT_LEAD_SECONDS = 0.02;

/** Grace choices for wait mode, in ms; the default is the middle one. */
export const WAIT_GRACE_OPTIONS_MS = [30, 60, 90] as const;

/** Grace actually used: never so late that a held note can't be judged. */
export function effectiveGrace(graceMs: number, toleranceSeconds: number) {
  return Math.max(0, Math.min(graceMs / 1000, toleranceSeconds - 0.03));
}

/**
 * The notes wait mode is holding for at `now`: the earliest unhit notes (all
 * voices at that tick) that are more than `grace` late. Hitting within the
 * grace never stops the song, so it plays on naturally. Notes further back
 * than the hit window were missed before wait mode could catch them (e.g.
 * it was just switched on) and are skipped.
 */
export function dueNotes(
  notes: TimelineNote[],
  hit: (note: TimelineNote) => boolean,
  now: number,
  tolerance: number,
  grace = 0,
  lead = WAIT_LEAD_SECONDS,
): TimelineNote[] {
  let tick: number | undefined;
  const due: TimelineNote[] = [];

  for (const note of notes) {
    if (
      note.time + grace - lead > now ||
      note.time < now - tolerance ||
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
