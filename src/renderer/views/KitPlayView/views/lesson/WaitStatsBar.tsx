import { OK, WARN } from './LessonPanels';
import { WaitStats } from './wait';

function Stat({
  label,
  value,
  color,
  testId,
}: {
  label: string;
  value: string | number;
  color?: string;
  testId: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5 shrink-0">
      <span className="text-[11px] uppercase tracking-[.12em] font-semibold text-text-muted">
        {label}
      </span>
      <span
        className="font-display text-[20px] leading-none tabular-nums"
        style={{ color }}
        data-testid={testId}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Wait mode's scoreboard, in place of the tempo reading (the song keeps
 * stopping, so there is no tempo to read): how often it had to wait this
 * pass against the last, and the run of notes you've hit without it waiting.
 * A pass with no waits earns its star.
 */
export function WaitStatsBar({ stats }: { stats: WaitStats }) {
  const { waits, streak, best, lastWaits } = stats;
  let goal = 'Get through a pass without the song waiting to earn the star';

  if (lastWaits === 0) {
    goal = 'Last pass had no waits: try it with Wait for me off';
  } else if (lastWaits !== undefined) {
    goal = `Last pass: ${lastWaits} · beat it`;
  }

  return (
    <div
      className="flex flex-1 basis-[440px] flex-wrap items-center gap-x-5 gap-y-1 min-w-0"
      data-testid="wait-stats"
    >
      <Stat
        label="Waits"
        value={waits}
        color={waits === 0 ? OK : WARN}
        testId="wait-count"
      />
      <Stat
        label="Streak"
        value={streak}
        color={streak > 0 && streak >= best ? OK : undefined}
        testId="wait-streak"
      />
      <Stat label="Best" value={best} testId="wait-best" />
      <span className="text-[13px] text-text-muted" aria-live="polite">
        {goal}
      </span>
    </div>
  );
}
