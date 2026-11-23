import { ReactNode } from 'react';
import { KitPiece, Voice, VOICE_INFO } from '../../../../kit';
import { CoachTip } from './coach';
import { MAX_STARS, PassResult, TARGET } from './machine';
import { OutcomeTone } from './outcomeText';
import { LessonStep } from './steps';
import { barRangeLabel, LessonWindow } from './windows';

/** Status colors for ok / warn: the app theme has no tokens for them. */
export const OK = '#3fae6a';

export const WARN = '#d9a03a';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ');

export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-3 min-w-0">
      <h3 className="m-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function LessonPath({
  lessons,
  stars,
  current,
  onPick,
}: {
  lessons: LessonWindow[];
  stars: number[];
  current: number;
  onPick: (index: number) => void;
}) {
  return (
    // Wraps onto more rows instead of scrolling sideways, so every lesson
    // stays visible (real songs have 10–20 sections).
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {lessons.map((l, i) => {
        const s = stars[i] ?? 0;

        return (
          <button
            key={l.key}
            type="button"
            aria-current={i === current}
            title="One star each for reading it at 80%, 90% and 100% speed"
            onClick={() => onPick(i)}
            className={cx(
              'text-left rounded-[10px] px-3 py-1.5 cursor-pointer flex flex-col gap-0.5 min-w-0 border',
              i === current
                ? 'border-accent-bright bg-surface-raised'
                : 'border-border bg-surface hover:bg-surface-raised',
            )}
          >
            <b className="font-display font-medium text-[15px] leading-tight text-text truncate">
              {l.name}
            </b>
            <span className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span className="truncate">{barRangeLabel(l)}</span>
              <i
                className="not-italic text-[12px] tracking-[1px] shrink-0"
                style={{ color: WARN }}
                aria-label={`${s} of ${MAX_STARS} stars`}
              >
                {'★'.repeat(s)}
                <span className="text-text-dim">
                  {'★'.repeat(MAX_STARS - s)}
                </span>
              </i>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StepBar({
  steps,
  current,
  onPick,
}: {
  steps: LessonStep[];
  current: number;
  onPick: (index: number) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {steps.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(i)}
          aria-current={i === current ? 'step' : undefined}
          className={cx(
            'flex-[1_1_110px] border-0 cursor-pointer text-center text-xs px-1 py-[7px] rounded-md font-semibold truncate',
            i === current
              ? 'bg-accent text-white'
              : i >= current && 'bg-surface-sunken text-text-dim',
          )}
          style={
            i < current
              ? {
                  background: `color-mix(in srgb, ${OK} 22%, transparent)`,
                  color: OK,
                }
              : undefined
          }
        >
          {i + 1} · {s.name}
        </button>
      ))}
    </div>
  );
}

/** The color a pass message is shown in. */
export const TONE_COLOR: Record<OutcomeTone, string> = { ok: OK, warn: WARN };

export interface ShownResult extends PassResult {
  message: string;
  tone: OutcomeTone;
}

export function ResultPanel({ result }: { result: ShownResult | undefined }) {
  return (
    <Panel title="Last pass">
      {result ? (
        <>
          <div className="flex justify-between items-baseline">
            <span className="font-display font-medium text-[40px] leading-none text-text tabular-nums">
              {result.pct}%
            </span>
            <span className="text-xs text-text-muted">
              target {Math.round(TARGET * 100)}%
            </span>
          </div>
          <div className="relative h-2 rounded bg-surface-sunken">
            <i
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${Math.min(100, result.pct)}%`,
                background: result.accuracy >= TARGET ? OK : WARN,
              }}
            />
            <span
              className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-text"
              style={{ left: `${TARGET * 100}%` }}
            />
          </div>
          <p className="text-xs text-text-muted m-0">
            {result.tiers[0]} on time · {result.tiers[1]} close ·{' '}
            {result.tiers[2]} off · {result.missed} missed
          </p>
          <p
            className="font-semibold text-[13px] px-2.5 py-[7px] rounded-lg m-0 bg-surface-sunken"
            style={{ color: TONE_COLOR[result.tone] }}
          >
            {result.message}
          </p>
        </>
      ) : (
        <p className="text-xs text-text-muted m-0">
          Your result shows up here after each 4-bar pass. Nothing is scored on
          screen while you play, so your eyes stay on the music.
        </p>
      )}
    </Panel>
  );
}

function TipText({
  tip,
  pieceByVoice,
}: {
  tip: CoachTip | undefined;
  pieceByVoice: Map<Voice, KitPiece>;
}) {
  if (!tip) {
    return (
      <>
        One tip at most, after a pass, and only when a habit is steady across
        several hits.
      </>
    );
  }

  if (tip.kind === 'bar') {
    return (
      <>
        Most misses were in bar {tip.bar + 1}. Keep counting out loud through
        it.
      </>
    );
  }

  if (tip.kind === 'timing') {
    const name =
      pieceByVoice.get(tip.voice)?.name ?? VOICE_INFO[tip.voice].name;

    return (
      <>
        Your <b className="text-text">{name}</b> lands about {tip.ms} ms{' '}
        {tip.early ? 'early' : 'late'} on most hits.{' '}
        {tip.early
          ? 'Let the stick drop with the click, not ahead of it.'
          : 'Start the stroke a touch sooner.'}
      </>
    );
  }

  return (
    <>Timing is steady. Pushes under 20 ms are normal and not worth chasing.</>
  );
}

export function CoachPanel({
  guide,
  tip,
  pieceByVoice,
}: {
  guide: number;
  tip: CoachTip | undefined;
  pieceByVoice: Map<Voice, KitPiece>;
}) {
  return (
    <Panel title="Coach">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-text-muted">Help on screen</span>
        <span className="font-mono text-text-body">
          {Math.round(guide * 100)}%
        </span>
      </div>
      <p className="text-[12.5px] bg-surface-sunken rounded-lg px-2.5 py-2 m-0 text-text-body">
        <TipText tip={tip} pieceByVoice={pieceByVoice} />
      </p>
    </Panel>
  );
}

export function WhyPanel() {
  return (
    <Panel title="Why the lesson runs this way">
      <ul className="m-0 pl-[18px] text-[12.5px] text-text-muted flex flex-col gap-[5px] list-disc">
        <li>
          You hear the beat before you play it, and play it before you read it.
        </li>
        <li>You count out loud, the habit drum teachers push hardest.</li>
        <li>You add one limb at a time but always hear the whole beat.</li>
        <li>
          Help fades only when you pass 85%, and comes back when you struggle.
        </li>
        <li>
          Every Mix-up is four bars you have not practised, because reading only
          grows on music you have not memorised.
        </li>
      </ul>
      <p className="text-xs text-text-muted m-0">
        Play your kit, or click a pad to hit it.
      </p>
    </Panel>
  );
}
