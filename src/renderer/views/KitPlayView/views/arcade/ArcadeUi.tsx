import { ReactNode, useRef } from 'react';
import { Button, Checkbox, Select } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { useAnimationFrame } from '../../hooks';
import { setText } from './fx';
import {
  formatOffset,
  formatPercent,
  starsFor,
  Summary,
  timingLean,
} from './scoring';
import { Arcade, CLICK_ON, NOTE_SPEEDS, SONG_SPEEDS } from './useArcade';

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
      {label}
      {children}
    </label>
  );
}

/**
 * Restart, song speed, note speed, loop section, click and
 * demo autoplay. Play / pause lives in the host header.
 */
export function PlayOptions({
  arcade,
  vertical = false,
  children,
}: {
  arcade: Arcade;
  vertical?: boolean;
  children?: ReactNode;
}) {
  const { session, sections } = arcade;
  const speeds = SONG_SPEEDS.includes(session.playbackSpeed)
    ? SONG_SPEEDS
    : [...SONG_SPEEDS, session.playbackSpeed].sort((a, b) => b - a);
  const selectWidth = vertical ? '100%' : undefined;

  return (
    <div
      className={
        vertical
          ? 'flex flex-col gap-3'
          : 'flex flex-wrap items-center gap-x-4 gap-y-2'
      }
    >
      <div className="flex items-center gap-2">
        <Button
          icon={<FontAwesomeIcon icon={faRotateLeft} />}
          onClick={arcade.restart}
        >
          Restart
        </Button>
      </div>
      <Labeled label="Song speed">
        <Select
          size="small"
          style={{ width: selectWidth, minWidth: 80 }}
          value={session.playbackSpeed}
          onChange={session.setPlaybackSpeed}
          options={speeds.map((s) => ({
            value: s,
            label: `${Math.round(s * 100)}%`,
          }))}
        />
      </Labeled>
      <Labeled label="Note speed">
        <Select
          size="small"
          style={{ width: selectWidth, minWidth: 90 }}
          value={arcade.noteSpeed}
          onChange={arcade.setNoteSpeed}
          options={NOTE_SPEEDS.map((s) => ({ value: s.id, label: s.label }))}
        />
      </Labeled>
      <Labeled label="Play">
        <Select
          size="small"
          style={{ width: selectWidth, minWidth: 140 }}
          popupMatchSelectWidth={false}
          value={arcade.loopIdx ?? -1}
          onChange={(v: number) => arcade.selectLoop(v < 0 ? undefined : v)}
          options={[
            { value: -1, label: 'Whole song' },
            ...sections.map((s, i) => ({
              value: i,
              label: `Loop ${s.name}`,
            })),
          ]}
        />
      </Labeled>
      <Checkbox
        checked={session.clickVolume > 0}
        onChange={(e) =>
          session.setClickVolume(e.target.checked ? CLICK_ON : 0)
        }
      >
        Click
      </Checkbox>
      <Checkbox
        checked={arcade.demo}
        onChange={(e) => arcade.setDemo(e.target.checked)}
      >
        Demo autoplay
      </Checkbox>
      {children}
    </div>
  );
}

/** The pass / Fever toast at the top of a highway. */
export function PassToast({ arcade }: { arcade: Arcade }) {
  const { toast } = arcade;

  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-[1] max-w-[92%] truncate rounded-full border bg-surface px-3.5 py-1.5 text-[13px] font-semibold pointer-events-none transition-opacity duration-300"
      style={{
        opacity: toast ? 1 : 0,
        borderColor: toast?.ok ? '#3fae6a' : '#d9a03a',
        color: toast?.ok ? '#3fae6a' : '#d9a03a',
      }}
    >
      {toast?.message}
    </div>
  );
}

/** A small warning under the controls when the chart uses voices the kit lacks. */
export function SkipWarning({ arcade }: { arcade: Arcade }) {
  return arcade.warning ? (
    <p className="m-0 text-[12px] text-[#d9a03a]">{arcade.warning}</p>
  ) : null;
}

/** Tier counts, average timing, spread and best streak, refreshed a few times a second. */
export function LiveStats({ arcade }: { arcade: Arcade }) {
  const { session, log, rules, score } = arcade;
  const countsRef = useRef<HTMLSpanElement>(null);
  const avgRef = useRef<HTMLSpanElement>(null);
  const spreadRef = useRef<HTMLSpanElement>(null);
  const bestRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef(0);

  useAnimationFrame(session, () => {
    const t = performance.now();

    if (t - lastRef.current < 300) {
      return;
    }

    lastRef.current = t;

    const s = log.summary();

    setText(countsRef.current, s.counts.join(' · '));
    setText(avgRef.current, s.hits ? formatOffset(s.avgMs) : '–');
    setText(
      spreadRef.current,
      s.hits > 1 ? `±${Math.round(s.spreadMs)} ms` : '–',
    );
    setText(bestRef.current, String(score.current.maxStreak));
  });

  const stat = (k: string, ref: React.RefObject<HTMLSpanElement | null>) => (
    <div className="flex justify-between items-baseline">
      <span className="text-[12px] text-text-muted">{k}</span>
      <span ref={ref} className="font-mono text-[13px] text-text">
        –
      </span>
    </div>
  );

  return (
    <div className="grid gap-x-6 gap-y-1.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
      {stat(
        [...rules.tiers.map((t) => t.label), 'Miss'].join(' · '),
        countsRef,
      )}
      {stat('Average timing', avgRef)}
      {stat('Spread', spreadRef)}
      {stat('Best streak', bestRef)}
    </div>
  );
}

function Row({ k, v, dot }: { k: string; v: string; dot?: string }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-text-muted flex items-center gap-1.5 min-w-0 truncate">
        {dot && (
          <i
            className="inline-block w-2.5 h-2.5 rounded-full flex-none"
            style={{ background: dot, boxShadow: '0 0 0 2px rgba(0,0,0,.4)' }}
          />
        )}
        {k}
      </span>
      <b className="text-text font-semibold tabular-nums">{v}</b>
    </div>
  );
}

const ROWS =
  'grid gap-x-4 gap-y-1 text-[12.5px] grid-cols-[repeat(auto-fill,minmax(170px,1fr))]';
const H3 =
  'm-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted';

/** The end-of-song card over the highway. */
export function ResultsOverlay({ arcade }: { arcade: Arcade }) {
  const { results, rules, session, sections } = arcade;

  if (!results) {
    return null;
  }

  const s: Summary = results.summary;
  const stars = starsFor(s.accuracy);
  const windowMs = Math.round(session.engine.hitTolerance * 1000);
  const weak =
    results.weakestSection === undefined
      ? undefined
      : sections[results.weakestSection];

  return (
    <div
      className="absolute inset-0 z-[2] flex items-center justify-center p-4"
      style={{
        background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)',
      }}
    >
      <div className="bg-surface border border-border rounded-[14px] px-5 py-[18px] w-[min(580px,100%)] max-h-full overflow-auto flex flex-col gap-2.5">
        <h3 className={H3}>
          {s.misses === 0 ? 'Full combo' : 'Song complete'} ·{' '}
          {Math.round(results.speed * 100)}% speed
        </h3>
        <div className="flex justify-between items-baseline">
          <span className="font-display text-[40px] leading-none text-text tabular-nums">
            {results.score.score.toLocaleString()}
          </span>
          <span className="text-[26px] tracking-[4px] text-[#d9a03a]">
            {'★'.repeat(stars)}
            <span className="text-text-dim">{'★'.repeat(5 - stars)}</span>
          </span>
        </div>
        <div className={ROWS}>
          <Row k="Accuracy" v={formatPercent(s.accuracy)} />
          <Row k="Best streak" v={String(results.score.maxStreak)} />
          {rules.tiers.map((t, i) => (
            <Row
              key={t.id}
              k={`${t.label} ±${Number.isFinite(t.maxMs) ? t.maxMs : windowMs}`}
              v={String(s.counts[i])}
            />
          ))}
          <Row k="Missed" v={String(s.misses)} />
          <Row k="Average timing" v={formatOffset(s.avgMs)} />
          <Row k="Spread" v={`±${Math.round(s.spreadMs)} ms`} />
        </div>
        <p className="m-0 text-[12px] text-text-muted">{timingLean(s)}</p>
        {results.pads.length > 0 && (
          <>
            <h3 className={H3}>By pad</h3>
            <div className={ROWS}>
              {results.pads.map(({ piece, summary }) => (
                <Row
                  key={piece.id}
                  k={piece.name}
                  dot={piece.color}
                  v={`${formatPercent(summary.accuracy)} · ${formatOffset(
                    summary.avgMs,
                  )}`}
                />
              ))}
            </div>
          </>
        )}
        {results.sections.length > 1 && (
          <>
            <h3 className={H3}>By section</h3>
            <div className={ROWS}>
              {results.sections.map((x) => (
                <Row
                  key={x.index}
                  k={x.name}
                  v={formatPercent(x.summary.accuracy)}
                />
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <Button type="primary" onClick={arcade.restart}>
            Play again
          </Button>
          {weak && results.weakestSection !== undefined && (
            <Button
              onClick={() =>
                results.weakestSection !== undefined &&
                arcade.practice(results.weakestSection)
              }
            >
              Practice {weak.name} at 70%
            </Button>
          )}
          <Button type="text" onClick={arcade.closeResults}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
