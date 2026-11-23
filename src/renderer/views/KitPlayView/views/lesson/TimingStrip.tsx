import { OffsetStats } from './pace';
import { OK, WARN } from './LessonPanels';

/** Spread (ms) at or under which timing reads as tight. */
export const TIGHT_SPREAD_MS = 25;

function describe(stats: OffsetStats): string {
  if (stats.mean === undefined || stats.spread === undefined) {
    return 'Play a few notes to see your timing';
  }

  const mean = Math.round(stats.mean);
  const where =
    Math.abs(mean) < 5
      ? 'on the beat'
      : `${Math.abs(mean)} ms ${mean > 0 ? 'late' : 'early'}`;

  return `Avg ${where} · spread ±${Math.round(stats.spread)} ms`;
}

/**
 * Live timing: the last hits as dots on an early ↔ late axis (newest
 * brightest), the average as a tick, and in wait mode the grace zone
 * after the beat in which the song keeps playing.
 */
export function TimingStrip({
  stats,
  windowMs,
  graceMs,
}: {
  stats: OffsetStats;
  /** Half-width of the axis: the hit window. */
  windowMs: number;
  /** Wait mode's grace, shaded after the beat. */
  graceMs?: number;
}) {
  const toPct = (ms: number) =>
    50 + (Math.max(-windowMs, Math.min(windowMs, ms)) / windowMs) * 50;
  const tight = stats.spread !== undefined && stats.spread <= TIGHT_SPREAD_MS;
  const n = stats.offsets.length;

  return (
    <div
      className="flex flex-1 basis-[440px] items-center gap-3 min-w-0"
      data-testid="timing-strip"
      title="Your last hits: left of the line is early, right is late. Spread is how much your hits vary (standard deviation)."
    >
      <span className="text-[11px] uppercase tracking-[.12em] font-semibold text-text-muted shrink-0">
        Timing
      </span>
      <span className="text-[11px] text-text-faint shrink-0">Early</span>
      <div
        className="relative h-4 grow min-w-[120px] rounded-full bg-surface overflow-hidden"
        aria-hidden="true"
      >
        {graceMs !== undefined && graceMs > 0 && (
          <div
            className="absolute inset-y-0"
            style={{
              left: '50%',
              width: `${toPct(graceMs) - 50}%`,
              background: WARN,
              opacity: 0.2,
            }}
          />
        )}
        <div className="absolute inset-y-0 left-1/2 w-px bg-text-faint" />
        {stats.offsets.map((ms, i) => (
          <div
            key={i}
            className="absolute top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full"
            style={{
              left: `${toPct(ms)}%`,
              background: tight ? OK : WARN,
              opacity: 0.25 + (0.75 * (i + 1)) / n,
            }}
          />
        ))}
        {stats.mean !== undefined && (
          <div
            className="absolute inset-y-0 w-0.5 -ml-px"
            style={{
              left: `${toPct(stats.mean)}%`,
              background: 'currentColor',
            }}
          />
        )}
      </div>
      <span className="text-[11px] text-text-faint shrink-0">Late</span>
      <span
        className="text-[13px] font-medium shrink-0"
        data-testid="timing-summary"
        style={{
          color: stats.spread === undefined ? undefined : tight ? OK : WARN,
        }}
      >
        {describe(stats)}
      </span>
    </div>
  );
}
