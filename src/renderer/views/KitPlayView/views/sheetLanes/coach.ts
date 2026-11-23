import { assertNever } from '../../../../../shared/assertNever';
import { mean, sd } from '../shared/stats';

/** A row needs this many hits before the coach says anything about it. */
export const COACH_MIN_HITS = 8;

/** Rolling window of offsets kept per pad. */
export const COACH_LOG_SIZE = 32;

/** An early lean up to this much is normal and not reported. */
export const EARLY_LEAN_MS = 20;

/**
 * Offsets inside ±band are inaudible: 4% of a sixteenth, at least 10 ms and
 * at most 25 ms.
 */
export function coachBand(sixteenthMs: number): number {
  return Math.min(25, Math.max(10, 0.04 * sixteenthMs));
}

export function pushOffset(log: number[] | undefined, ms: number): number[] {
  const next = [...(log ?? []), ms];

  return next.length > COACH_LOG_SIZE ? next.slice(-COACH_LOG_SIZE) : next;
}

export type CoachFlag = 'late' | 'early';

export interface CoachRow<K> {
  key: K;
  n: number;
  meanMs: number;
  /** Spread, reported apart from the offset. */
  sdMs: number;
  flag: CoachFlag | undefined;
}

export function coachFlag(
  offsets: number[],
  band: number,
): CoachFlag | undefined {
  if (offsets.length < COACH_MIN_HITS) {
    return undefined;
  }

  const m = mean(offsets);

  if (m > band) {
    return 'late';
  }

  return m < -Math.max(band, EARLY_LEAN_MS) ? 'early' : undefined;
}

export interface CoachReport<K> {
  band: number;
  rows: CoachRow<K>[];
  overallSdMs: number;
  totalHits: number;
}

export function coachReport<K>(
  logs: Iterable<[K, number[]]>,
  band: number,
): CoachReport<K> {
  const rows: CoachRow<K>[] = [];
  const all: number[] = [];

  for (const [key, offsets] of logs) {
    if (offsets.length === 0) {
      continue;
    }

    rows.push({
      key,
      n: offsets.length,
      meanMs: mean(offsets),
      sdMs: sd(offsets),
      flag: coachFlag(offsets, band),
    });
    all.push(...offsets);
  }

  return { band, rows, overallSdMs: sd(all), totalHits: all.length };
}

export function coachStatus(row: CoachRow<unknown>): string {
  if (row.n < COACH_MIN_HITS) {
    return `${row.n} hits…`;
  }

  if (row.flag) {
    return `${row.flag} ${Math.round(Math.abs(row.meanMs))} ms`;
  }

  return row.meanMs < 0 ? 'fine (early lean)' : 'fine';
}

export function coachTip<K>(
  report: CoachReport<K>,
  nameOf: (key: K) => string,
): string {
  const flagged = report.rows.filter(
    (r): r is CoachRow<K> & { flag: CoachFlag } => r.flag !== undefined,
  );

  if (flagged.length > 0) {
    return flagged
      .slice(0, 2)
      .map((r) => flagTip(r, nameOf(r.key)))
      .join(' ');
  }

  const steadiness =
    report.overallSdMs > 22
      ? ' Work on steadiness: your spread is wider than your offset.'
      : '';
  const band = Math.round(report.band);

  return `Nothing audible to fix (quiet band ±${band} ms).${steadiness}`;
}

function flagTip(
  row: { flag: CoachFlag; meanMs: number },
  name: string,
): string {
  const ms = Math.round(Math.abs(row.meanMs));

  switch (row.flag) {
    case 'late':
      return `${name} is dragging about ${ms} ms. Start the stroke a little earlier.`;

    case 'early':
      return `${name} is rushing about ${ms} ms. Let the stick fall with the click.`;

    default:
      return assertNever(row.flag, 'coach flag');
  }
}
