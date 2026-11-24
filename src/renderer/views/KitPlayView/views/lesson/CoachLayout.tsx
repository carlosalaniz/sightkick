import { ReactNode, useEffect, useState } from 'react';
import { KitPiece, Voice, VOICE_INFO } from '../../../../kit';
import { LessonStep } from './steps';
import { ShownResult, TipText } from './LessonPanels';
import { CoachTip } from './coach';
import { OutcomeTone } from './outcomeText';
import { OffsetStats, WAIT_GRACE_OPTIONS_MS } from './pace';
import { WaitGraceMs } from './persisted';
import { WaitStats } from './wait';
import { MAX_STARS } from './machine';

/**
 * The coach view (v14): the lesson's learning path (v7) with sheet lanes'
 * per-bar fading help (v6), laid out phone first in the new app's look.
 * Music and kit get the screen; while playing you need only tempo, play and
 * wait, so everything else sits behind "More".
 */

const C = {
  bg: '#0B0D12',
  card: '#121622',
  surface: '#151924',
  line: '#2A3040',
  text: '#F2F4F8',
  muted: '#A3ABBD',
  accent: '#D4FF3A',
  warn: '#FFB547',
} as const;
const TONE: Record<OutcomeTone, string> = { ok: C.accent, warn: C.warn };
/** Below this width the staff shows two bars at a time and scrolls. */
const NARROW_QUERY = '(max-width: 899px)';

/** Whether the screen is phone-narrow; false where matchMedia is missing. */
export function useNarrowScreen(): boolean {
  const query = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(query);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const list = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(list.matches);

    list.addEventListener('change', onChange);

    return () => list.removeEventListener('change', onChange);
  }, []);

  return narrow;
}

/** Mean offsets inside this read as on time on the status line, ms. */
const ON_TIME_MS = 15;
/** Hits the status line needs before it says anything about timing. */
const TIMING_MIN_HITS = 3;

export interface CoachLayoutProps {
  lessons: { key: string; name: string }[];
  stars: number[];
  lessonIdx: number;
  onPickLesson: (index: number) => void;
  steps: LessonStep[];
  stepIdx: number;
  onPickStep: (index: number) => void;
  speed: number;
  /** Stars are only earned at this speed or faster. */
  starSpeed: number;
  onSpeed: (delta: 1 | -1) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  waitMode: boolean;
  onWaitMode: (on: boolean) => void;
  runUp: boolean;
  onRunUp: (on: boolean) => void;
  waitGraceMs: WaitGraceMs;
  onWaitGrace: (ms: WaitGraceMs) => void;
  clickOn: boolean;
  onClick: (on: boolean) => void;
  onRestartLessons: () => void;
  toast: { message: string; tone: OutcomeTone } | undefined;
  toastShown: boolean;
  waitingFor: readonly Voice[];
  runUpFor: readonly Voice[];
  timing: OffsetStats;
  waitStats: WaitStats;
  listening: boolean;
  result: ShownResult | undefined;
  tip: CoachTip | undefined;
  pieceByVoice: Map<Voice, KitPiece>;
  missingVoices: string[];
  staff: ReactNode;
  kit: ReactNode;
}

const voiceNames = (voices: readonly Voice[]) =>
  [...new Set(voices)].map((v) => VOICE_INFO[v].name.toLowerCase()).join(' + ');

function timingLine(t: OffsetStats): string {
  if (t.mean === undefined || t.offsets.length < TIMING_MIN_HITS) {
    return 'Play a few notes to see your timing';
  }

  const ms = Math.round(t.mean);

  if (Math.abs(ms) <= ON_TIME_MS) {
    return 'On time';
  }

  return `${Math.abs(ms)} ms ${ms > 0 ? 'late' : 'early'} on average`;
}

function Stars({ n }: { n: number }) {
  return (
    <span
      aria-label={`${n} of ${MAX_STARS} stars`}
      className="tracking-[0.08em]"
    >
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <span key={i} style={{ color: i < n ? C.accent : '#3A4258' }}>
          ★
        </span>
      ))}
    </span>
  );
}

function Toggle({
  label,
  on,
  onChange,
  testId,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className="h-11 px-4 rounded-full text-[14px] font-semibold border whitespace-nowrap shrink-0"
      style={{
        borderColor: on ? C.warn : C.line,
        background: on ? 'rgba(255,181,71,0.1)' : 'transparent',
        color: on ? C.warn : C.text,
      }}
    >
      {label}
    </button>
  );
}

export function CoachLayout(props: CoachLayoutProps) {
  const {
    lessons,
    stars,
    lessonIdx,
    steps,
    stepIdx,
    speed,
    starSpeed,
    waitMode,
    toast,
    toastShown,
    waitingFor,
    runUpFor,
  } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const step = steps[stepIdx];
  const pct = Math.round(speed * 100);
  const belowStar = speed < starSpeed - 1e-6;

  return (
    <div
      data-testid="coach-view"
      className="min-h-full flex flex-col"
      style={{ background: C.bg, color: C.text }}
    >
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-3 px-3 pt-3 pb-2 min-[700px]:px-6 min-[700px]:gap-4 flex-grow">
        <div className="flex items-center gap-3">
          <div className="flex flex-col min-w-0 flex-grow">
            <span className="text-[13px]" style={{ color: C.muted }}>
              {lessons[lessonIdx]?.name} · step {stepIdx + 1} of {steps.length}
            </span>
            <h2 className="m-0 font-display text-[22px] font-semibold leading-tight truncate">
              {step?.name}
            </h2>
          </div>
          <span className="text-[16px] font-semibold">
            <Stars n={stars[lessonIdx] ?? 0} />
          </span>
        </div>

        <nav aria-label="Steps" className="flex gap-1.5 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const current = i === stepIdx;
            const done = i < stepIdx;

            return (
              <button
                key={s.id}
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => props.onPickStep(i)}
                title={s.name}
                className="h-9 rounded-full text-[13px] font-semibold shrink-0 border"
                style={{
                  padding: current ? '0 14px' : '0',
                  width: current ? undefined : 36,
                  borderColor: current ? C.text : done ? 'transparent' : C.line,
                  background: current
                    ? C.text
                    : done
                    ? 'rgba(212,255,58,0.16)'
                    : 'transparent',
                  color: current ? C.bg : done ? C.accent : C.muted,
                }}
              >
                {current ? `${i + 1} · ${s.name}` : i + 1}
              </button>
            );
          })}
        </nav>

        {props.missingVoices.length > 0 && (
          <p className="m-0 text-[13px]" style={{ color: C.warn }}>
            No pad for {props.missingVoices.join(', ')}: those notes are greyed
            out and not scored.
          </p>
        )}

        {/* Wide screens: the kit on the left, where "now" is, and the music
            reading away from it to the right, as v12 and v7 do. Phones: the
            music on top, the kit under it. */}
        <div className="grid gap-3 grid-cols-1 min-[900px]:grid-cols-[340px_minmax(0,1fr)] min-[900px]:items-stretch">
          <div
            className="relative rounded-[22px] px-2 pt-8 pb-1 min-[900px]:order-2"
            style={{ background: C.card }}
          >
            <div
              role="status"
              className="absolute top-2.5 left-3 right-3 text-[13px] font-semibold truncate pointer-events-none transition-opacity duration-300"
              style={{
                opacity: toast && toastShown ? 1 : 0,
                color: toast ? TONE[toast.tone] : undefined,
              }}
            >
              {toast?.message}
            </div>
            {waitingFor.length > 0 && (
              <div
                data-testid="waiting-for"
                className="absolute top-2 right-3 rounded-full px-3 py-1 text-[13px] font-semibold pointer-events-none"
                style={{ background: C.warn, color: C.bg }}
              >
                Waiting for {voiceNames(waitingFor)}
              </div>
            )}
            {waitingFor.length === 0 && runUpFor.length > 0 && (
              <div
                data-testid="run-up-for"
                className="absolute top-2 right-3 rounded-full px-3 py-1 text-[13px] font-semibold pointer-events-none"
                style={{ background: C.accent, color: C.bg }}
              >
                Now in time: {voiceNames(runUpFor)}
              </div>
            )}
            {props.staff}
          </div>
          <div
            className="rounded-[22px] p-2 flex items-center justify-center [&_svg]:max-h-[230px] min-[900px]:[&_svg]:max-h-none min-[900px]:order-1"
            style={{ background: C.card }}
          >
            {props.kit}
          </div>
        </div>

        {!props.listening && (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14px]"
            style={{ color: C.muted }}
          >
            {waitMode ? (
              <span data-testid="wait-stats">
                Waits <b style={{ color: C.warn }}>{props.waitStats.waits}</b> ·
                streak{' '}
                <b style={{ color: C.accent }}>{props.waitStats.streak}</b> ·
                best {props.waitStats.best}
              </span>
            ) : (
              <span data-testid="timing-line">{timingLine(props.timing)}</span>
            )}
            {props.result && (
              <span>
                Last pass{' '}
                <b style={{ color: TONE[props.result.tone] }}>
                  {props.result.pct}%
                </b>
              </span>
            )}
          </div>
        )}

        {props.result && props.tip && (
          <p
            className="m-0 rounded-[16px] px-4 py-3 text-[14px] leading-snug"
            style={{ background: C.surface, color: C.text }}
          >
            <TipText tip={props.tip} pieceByVoice={props.pieceByVoice} />
          </p>
        )}
      </div>

      <div
        className="sticky bottom-0 w-full border-t"
        style={{ background: C.bg, borderColor: '#1E2330' }}
      >
        {moreOpen && (
          <div
            data-testid="coach-more"
            className="w-full max-w-[1200px] mx-auto flex flex-wrap items-center gap-2 px-3 pt-3 min-[700px]:px-6"
          >
            {waitMode && (
              <Toggle
                label="Run-up"
                on={props.runUp}
                onChange={props.onRunUp}
                testId="run-up"
              />
            )}
            {waitMode && (
              <label
                className="h-11 px-3 rounded-full border flex items-center gap-2 text-[14px]"
                style={{ borderColor: C.line }}
              >
                Grace
                <select
                  aria-label="Wait grace"
                  data-testid="wait-grace"
                  value={props.waitGraceMs}
                  onChange={(e) =>
                    props.onWaitGrace(Number(e.target.value) as WaitGraceMs)
                  }
                  className="bg-transparent outline-none"
                  style={{ color: C.text }}
                >
                  {WAIT_GRACE_OPTIONS_MS.map((ms) => (
                    <option key={ms} value={ms} style={{ color: '#000' }}>
                      {ms} ms
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Toggle label="Click" on={props.clickOn} onChange={props.onClick} />
            <button
              type="button"
              onClick={props.onRestartLessons}
              className="h-11 px-4 rounded-full text-[14px] border"
              style={{ borderColor: C.line, color: C.muted }}
            >
              Restart lessons
            </button>
            <div className="flex gap-1.5 overflow-x-auto w-full pt-1">
              {lessons.map((l, i) => (
                <button
                  key={l.key}
                  type="button"
                  aria-current={i === lessonIdx ? 'true' : undefined}
                  onClick={() => props.onPickLesson(i)}
                  className="h-10 px-3 rounded-[12px] text-[13px] shrink-0 border flex items-center gap-2"
                  style={{
                    borderColor: i === lessonIdx ? C.text : C.line,
                    color: C.text,
                  }}
                >
                  {l.name} <Stars n={stars[i] ?? 0} />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="w-full max-w-[1200px] mx-auto flex items-center gap-2 px-3 py-3 min-[700px]:px-6">
          <div
            className="flex items-center h-14 rounded-full px-1 shrink-0"
            style={{ background: C.surface }}
            title={
              belowStar
                ? `Stars are earned at ${Math.round(
                    starSpeed * 100,
                  )}% or faster`
                : undefined
            }
          >
            <button
              type="button"
              aria-label="Slower"
              data-testid="tempo-down"
              onClick={() => props.onSpeed(-1)}
              className="w-10 h-11 rounded-full text-[22px]"
              style={{ color: C.text }}
            >
              −
            </button>
            <span
              className="w-11 text-center text-[15px] font-semibold tabular-nums"
              style={{ color: belowStar ? C.warn : C.text }}
            >
              {pct}%
            </span>
            <button
              type="button"
              aria-label="Faster"
              data-testid="tempo-up"
              onClick={() => props.onSpeed(1)}
              className="w-10 h-11 rounded-full text-[22px]"
              style={{ color: C.text }}
            >
              +
            </button>
          </div>
          <button
            type="button"
            aria-label={props.isPlaying ? 'Pause' : 'Play'}
            onClick={props.onTogglePlay}
            className="w-16 h-16 rounded-full shrink-0 flex items-center justify-center"
            style={{ background: C.accent, color: C.bg }}
          >
            {props.isPlaying ? (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7 4.5v15l12-7.5z" />
              </svg>
            )}
          </button>
          <Toggle
            label="Wait for me"
            on={waitMode}
            onChange={props.onWaitMode}
            testId="wait-mode"
          />
          <button
            type="button"
            aria-label="More options"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className="w-11 h-11 rounded-full ml-auto shrink-0 border flex items-center justify-center"
            style={{ borderColor: C.line, color: C.text }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
