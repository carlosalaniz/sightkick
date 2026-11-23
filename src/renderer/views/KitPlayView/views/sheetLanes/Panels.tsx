import { ReactNode } from 'react';
import { cn } from '../../../../cn';
import { Stars } from '../../../../components/Stars';
import { CoachReport, coachStatus, coachTip } from './coach';
import { GuideMode } from './guide';
import { BarRange, rangeLabel } from './region';
import {
  LadderState,
  MISS_COLOR,
  PassStats,
  RUNGS,
  TIERS,
  tierRange,
} from './scoring';

export const OK_COLOR = '#3fae6a';

export const WARN_COLOR = '#d9a03a';

export interface PassReport extends PassStats {
  /** Practice pass number; undefined for an unseen-bars pass. */
  pass: number | undefined;
  range: BarRange;
  tempo: number;
  score: number;
  bonus: number;
  verdict: string;
  good: boolean;
}

export interface ProbeEntry {
  at: number;
  start: number;
  end: number;
  accuracy: number;
  sdMs: number;
  tempo: number;
}

export interface SongProgress {
  /** Best practice pass at 100% tempo, 0–1. */
  best100?: number;
  /** Furthest bar (exclusive) played through. */
  seenTo?: number;
  /** Newest first. */
  probes: ProbeEntry[];
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-3 min-w-0',
        className,
      )}
    >
      {title && <h3 className={H3}>{title}</h3>}
      {children}
    </section>
  );
}

const H3 =
  'm-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted';
const NOTE = 'm-0 text-[12px] text-text-muted';

function Stat({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-text-muted text-[12px]">{k}</span>
      <span className="text-text tabular-nums text-[13px]">{children}</span>
    </div>
  );
}

const signed = (ms: number) => `${ms >= 0 ? '+' : ''}${Math.round(ms)} ms`;

export function GuideBars({
  count,
  mode,
  barRef,
}: {
  count: number;
  mode: GuideMode;
  /** Receives each bar's fill element; widths are set every frame. */
  barRef: (index: number, el: HTMLElement | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-[12px] text-text-muted">
        <span>Guide left per bar</span>
        <span>{mode === 'adaptive' ? 'adaptive' : 'fixed'}</span>
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-[3px] text-[11px] text-text-muted"
          >
            Bar {i + 1}
            <span className="block h-1.5 rounded-[3px] bg-surface-sunken overflow-hidden">
              <i
                ref={(el) => barRef(i, el)}
                className="block h-full bg-accent-bright"
              />
            </span>
          </div>
        ))}
      </div>
      <p className={NOTE}>
        Lanes and gems fade first, then note colors and pad labels, then the
        count and beat shading.
      </p>
    </div>
  );
}

export function SummaryPanel({
  report,
  windowMs,
  guide,
}: {
  report: PassReport | undefined;
  /** The hit window in real ms (the OK tier's edge). */
  windowMs: number;
  guide: ReactNode;
}) {
  if (!report) {
    return (
      <Panel title="After each pass">
        <p className={NOTE}>
          Accuracy, timing spread, score and stars show up here after every pass
          of the loop. They stay off the staff so your eyes stay on the music.
        </p>
        {guide}
      </Panel>
    );
  }

  const probe = report.pass === undefined;

  return (
    <Panel
      title={
        probe
          ? `Unseen bars · ${rangeLabel(report.range)} · sheet only`
          : `Pass ${report.pass} · ${Math.round(report.tempo * 100)}% tempo`
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[40px] leading-none text-text tabular-nums">
          {Math.round(report.accuracy * 100)}%
        </span>
        <Stars rating={report.stars} count={3} size="lg" />
      </div>
      <div className="grid grid-cols-5 gap-1">
        {TIERS.map((t) => (
          <TierCell
            key={t.id}
            n={report.counts[t.id]}
            label={`${t.label} ${tierRange(t, windowMs)}`}
            color={t.color}
          />
        ))}
        <TierCell n={report.counts.miss} label="Miss" color={MISS_COLOR} />
      </div>
      <Stat k="Consistency (spread)">
        ±{Math.round(report.sdMs)} ms · UR {Math.round(report.sdMs * 10)}
      </Stat>
      <Stat k="Average offset">{signed(report.meanMs)}</Stat>
      {!probe && (
        <Stat k={`Score · reading bonus ×${report.bonus.toFixed(1)}`}>
          {report.score.toLocaleString()}
        </Stat>
      )}
      <p
        className="m-0 font-semibold text-[13px] px-2.5 py-[7px] rounded-lg bg-surface-sunken"
        style={{ color: report.good ? OK_COLOR : WARN_COLOR }}
      >
        {report.verdict}
      </p>
      {!probe && guide}
    </Panel>
  );
}

function TierCell({
  n,
  label,
  color,
}: {
  n: number;
  label: string;
  color: string;
}) {
  return (
    <div className="bg-surface-sunken rounded-md px-1 py-1.5 text-center text-[11px] text-text-muted">
      <b className="block font-display font-medium text-[18px] leading-[1.1] text-text tabular-nums">
        {n}
      </b>
      {label}
      <i
        className="block h-[3px] rounded-sm mt-1"
        style={{ background: color }}
      />
    </div>
  );
}

export interface CoachPiece {
  name: string;
  color: string;
}

export function CoachPanel({
  report,
  pieceOf,
}: {
  report: CoachReport<string> | undefined;
  pieceOf: (id: string) => CoachPiece | undefined;
}) {
  const title = 'Coach · after each pass';

  if (!report || report.rows.length === 0) {
    return (
      <Panel title={title}>
        <p className={NOTE}>
          Stays quiet unless something is audible: an average offset outside
          ±10–25 ms (depends on tempo) over at least 8 hits on a pad. A small
          early lean is normal and ignored. Spread is reported on its own.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={title}>
      <div className="flex flex-col gap-1.5">
        {report.rows.map((r) => {
          const p = pieceOf(r.key);

          return (
            <div
              key={r.key}
              className="grid grid-cols-[10px_minmax(0,1fr)_auto_56px] gap-[7px] items-center text-[12px]"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: p?.color ?? '#999' }}
              />
              <span className="truncate text-text-body">
                {p?.name ?? r.key}
              </span>
              <span
                className="tabular-nums"
                style={{
                  color: r.flag ? WARN_COLOR : 'var(--color-text-muted)',
                }}
              >
                {coachStatus(r)}
              </span>
              <span className="text-right text-text-muted tabular-nums">
                ±{Math.round(r.sdMs)} ms
              </span>
            </div>
          );
        })}
      </div>
      <Stat k="Overall spread">
        ±{Math.round(report.overallSdMs)} ms · UR{' '}
        {Math.round(report.overallSdMs * 10)}
      </Stat>
      <p className="m-0 text-[12.5px] bg-surface-sunken rounded-lg px-2.5 py-2 text-text-body">
        {coachTip(report, (id) => pieceOf(id)?.name ?? id)}
      </p>
    </Panel>
  );
}

export function TempoLadder({
  ladder,
  bpm,
  speed,
  onPick,
}: {
  ladder: LadderState;
  /** Loop tempo at 100%. */
  bpm: number;
  speed: number;
  onPick: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-[12px] text-text-muted">
        <span>Tempo ladder · {Math.round(bpm * speed)} BPM</span>
        <span className="tabular-nums">clean {ladder.clean}/2</span>
      </span>
      <div className="grid grid-cols-[repeat(9,minmax(26px,1fr))] gap-[3px]">
        {RUNGS.map((r, i) => {
          const cur = i === ladder.index;

          return (
            <button
              key={r}
              type="button"
              title={`Practice at ${Math.round(r * 100)}%`}
              onClick={() => onPick(i)}
              className={cn(
                'text-[10px] text-center py-[3px] rounded tabular-nums border cursor-pointer',
                r > 1 ? 'border-dashed border-text-dim' : 'border-transparent',
                cur
                  ? 'bg-accent text-white font-bold'
                  : i < ladder.index
                  ? 'bg-[color-mix(in_srgb,#3fae6a_22%,transparent)] text-[#3fae6a]'
                  : 'bg-surface-sunken text-text-dim',
              )}
            >
              {Math.round(r * 100)}
            </button>
          );
        })}
      </div>
      <p className={NOTE}>
        Two clean passes move up; two clearly rough passes (under 60%) move
        down; anything else stays. Dashed rungs are over-speed.
      </p>
    </div>
  );
}

export function ReadingProgress({
  progress,
}: {
  progress: SongProgress | undefined;
}) {
  const best =
    progress?.best100 === undefined
      ? '–'
      : `${Math.round(progress.best100 * 100)}%`;
  const probes = progress?.probes ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <Stat k="Best practice pass at 100%">{best}</Stat>
      {probes.length > 0 ? (
        probes.map((p, i) => (
          <div
            key={p.at}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px_52px] gap-1.5 items-center text-[12px] tabular-nums"
            title={`${Math.round(p.tempo * 100)}% tempo`}
          >
            <span className="text-text-dim truncate">
              #{probes.length - i} · {rangeLabel(p)}
            </span>
            <span className="h-1.5 rounded-[3px] bg-surface-sunken overflow-hidden">
              <i
                className="block h-full"
                style={{
                  width: `${Math.round(p.accuracy * 100)}%`,
                  background: OK_COLOR,
                }}
              />
            </span>
            <span className="text-text-body">
              {Math.round(p.accuracy * 100)}%
            </span>
            <span className="text-text-muted">±{Math.round(p.sdMs)} ms</span>
          </div>
        ))
      ) : (
        <p className={NOTE}>
          Nothing logged yet. &ldquo;Next unseen bars&rdquo; moves the loop to
          bars you haven&rsquo;t played, sheet only, at 100%, and logs that
          first pass here. It&rsquo;s the honest measure of reading.
        </p>
      )}
    </div>
  );
}
