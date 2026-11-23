import { useMemo, useRef, useState } from 'react';
import { Segmented } from 'antd';
import { usePersisted } from '../../../hooks/usePersisted';
import {
  firstNoteAtOrAfter,
  isCymbal,
  KitPiece,
  pieceRadius,
} from '../../../kit';
import { useAnimationFrame } from '../hooks';
import { PlaySession } from '../session';
import {
  PassToast,
  PlayOptions,
  ResultsOverlay,
  SkipWarning,
} from './arcade/ArcadeUi';
import { floatText, GemPools, setAttr, setText } from './arcade/fx';
import { forEachBeat, poolSizes } from './arcade/helpers';
import {
  formatPercent,
  gemState,
  hitLabel,
  PLAY_RULES,
} from './arcade/scoring';
import { SheetStrip } from './arcade/SheetStrip';
import {
  GemPool,
  KeyBadge,
  KitLayer,
  TEXT_STYLE,
  useStrikeFlash,
} from './arcade/StageParts';
import { useArcade } from './arcade/useArcade';

type Layout = 'kit' | 'lanes';

/** Top of the highway (viewBox y) and the straight-lanes hit line. */
const TOP = -78;
const HIT_Y = 70;
/** Seconds from the top of the highway to the straight-lanes hit line at Normal. */
const BASE_LOOK = 3.7;
const BEAT_LINES = 64;
const HALO = '#0d0e10';

interface Target {
  x: number;
  y: number;
  r: number;
  kick: boolean;
  /** Kick bar width. */
  w: number;
  cym: boolean;
}

function targetsFor(
  layout: Layout,
  hands: KitPiece[],
  kick: KitPiece | undefined,
): { targets: Map<string, Target>; refY: number } {
  const targets = new Map<string, Target>();

  if (layout === 'kit') {
    for (const p of kick ? [...hands, kick] : hands) {
      const r = pieceRadius(p);

      targets.set(p.id, {
        x: p.x,
        y: p.y,
        r,
        kick: p === kick,
        w: r * 1.5,
        cym: isCymbal(p.type),
      });
    }

    const tops = [...targets.values()].map((t) => t.y - t.r - 1.5);

    return { targets, refY: Math.min(60, ...tops) };
  }

  const n = hands.length;

  hands.forEach((p, i) =>
    targets.set(p.id, {
      x: n > 1 ? 10 + (i * 80) / (n - 1) : 50,
      y: HIT_Y,
      r: 4.6,
      kick: false,
      w: 0,
      cym: isCymbal(p.type),
    }),
  );

  if (kick) {
    targets.set(kick.id, {
      x: 50,
      y: HIT_Y,
      r: 4,
      kick: true,
      w: 88,
      cym: false,
    });
  }

  return { targets, refY: HIT_Y };
}

/**
 * "Play": notes travel down to each pad's position on the top-down kit, or
 * down straight lanes. Perfect / Good / Miss scoring with a streak
 * multiplier, a pad legend that lights on strikes, and the sheet strip.
 */
export function KitHighwayView({ session }: { session: PlaySession }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGGElement>(null);
  const beatsRef = useRef<SVGGElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLSpanElement>(null);
  const multRef = useRef<HTMLSpanElement>(null);
  const accRef = useRef<HTMLSpanElement>(null);
  const countsRef = useRef<HTMLSpanElement>(null);
  const [pools] = useState(() => new GemPools());
  const [rings] = useState(() => new Map<string, SVGCircleElement>());
  const [legend] = useState(() => new Map<string, HTMLLIElement>());
  const [layout, setLayout] = usePersisted<Layout>(
    'settings.kitPlayLayout',
    'kit',
  );
  const { notes, bars, pieceByVoice, song } = session;
  const arcade = useArcade(session, PLAY_RULES, {
    onHit: (_note, piece, info, offset) => {
      const t = targets.get(piece.id);

      if (t) {
        floatText(
          fxRef.current,
          t.x,
          t.y - (t.kick ? 3 : t.r) - 2,
          hitLabel(info, offset),
          info.color,
          {
            'font-size': 3.4,
            'font-weight': 700,
            'text-anchor': 'middle',
            'paint-order': 'stroke',
            stroke: HALO,
            'stroke-width': 0.9,
            style: 'font-family:var(--font-ui);pointer-events:none',
          },
        );
      }
    },
  });
  const { lanes, log, score, keyLabels } = arcade;
  const { hands, kick } = lanes;
  const { targets, refY } = useMemo(
    () => targetsFor(layout, hands, kick),
    [layout, hands, kick],
  );
  const look = BASE_LOOK * arcade.lookFactor;
  const speed = (HIT_Y - TOP) / look;
  const trail = 0.4;
  const sizes = useMemo(
    () => poolSizes(notes, pieceByVoice, trail, look * 1.1),
    [notes, pieceByVoice, look],
  );
  const register = (id: string, el: Element | null) => pools.register(id, el);
  const legendPieces = kick ? [...hands, kick] : hands;

  useStrikeFlash(arcade, svgRef, (piece, owner) => {
    const li = legend.get((owner ?? piece).id);

    if (li) {
      li.style.transition = 'none';
      li.style.background = 'var(--color-fill-strong)';
      setTimeout(() => {
        li.style.transition = 'background .25s';
        li.style.background = '';
      }, 120);
    }
  });

  useAnimationFrame(session, (now) => {
    if (!svgRef.current) {
      return;
    }

    const nearest = new Map<string, number>();

    pools.begin();

    for (
      let i = firstNoteAtOrAfter(notes, now - trail);
      i < notes.length && notes[i].time <= now + look * 1.1;
      i += 1
    ) {
      const note = notes[i];
      const piece = pieceByVoice.get(note.voice);
      const t = piece && targets.get(piece.id);
      const gem = gemState(log.get(note.id));

      if (!piece || !t || gem === 'hit') {
        continue;
      }

      const dt = note.time - now;
      const y = t.y - dt * speed;

      if (y < TOP - 2) {
        continue;
      }

      let o = 1;

      if (gem === 'missed') {
        o = 0.25;
      } else if (y > t.y) {
        o = Math.max(0, 1 - (y - t.y) / 6);
      }

      pools.place(piece.id, `translate(${t.x.toFixed(2)} ${y.toFixed(2)})`, o);

      const prev = nearest.get(piece.id);

      if (dt > 0 && gem === 'open' && (prev === undefined || dt < prev)) {
        nearest.set(piece.id, dt);
      }
    }

    pools.end();

    for (const [id, ring] of rings) {
      const dt = nearest.get(id);
      const t = targets.get(id);

      if (dt === undefined || dt > 0.6 || !t || t.kick) {
        setAttr(ring, 'opacity', 0);

        continue;
      }

      setAttr(ring, 'r', (t.r + 1 + dt * 16).toFixed(2));
      setAttr(ring, 'opacity', (1 - dt / 0.6).toFixed(2));
    }

    const lines = beatsRef.current?.children;
    let k = 0;

    if (lines) {
      forEachBeat(bars, now, now + (refY - TOP) / speed, (bt, down) => {
        const el = lines[k];

        k += 1;

        if (!el) {
          return;
        }

        const y = (refY - (bt - now) * speed).toFixed(2);

        el.setAttribute('y1', y);
        el.setAttribute('y2', y);
        setAttr(el, 'stroke', down ? '#c46a2a' : 'rgba(213,75,48,.28)');
        setAttr(el, 'stroke-width', down ? 0.6 : 0.25);
        setAttr(el, 'display', 'inline');
      });

      for (; k < lines.length; k += 1) {
        setAttr(lines[k], 'display', 'none');
      }
    }

    const s = score.current;
    const summary = log.summary();

    setText(scoreRef.current, s.score.toLocaleString());
    setText(streakRef.current, String(s.streak));
    setText(multRef.current, `×${s.mult}`);
    setText(
      accRef.current,
      summary.judged ? formatPercent(summary.accuracy) : '–',
    );
    setText(countsRef.current, summary.counts.join(' · '));
  });

  const strike = (p: KitPiece) => () => session.strikePiece(p);
  const kickKey = kick ? keyLabels.get(kick.id) : '';

  return (
    <div className="p-4 grid gap-4 items-start grid-cols-[240px_minmax(0,1fr)_240px] max-[1100px]:grid-cols-[minmax(0,1fr)_220px] max-[760px]:grid-cols-[minmax(0,1fr)]">
      <aside className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-3 min-w-0 max-[1100px]:col-span-full max-[1100px]:order-3">
        <div>
          <div className="font-display text-[20px] leading-tight text-text truncate">
            {song.name}
          </div>
          <div className="text-[12px] text-text-muted truncate">
            {song.artist} · {session.bars.length} bars ·{' '}
            {session.notes.length.toLocaleString()} notes
          </div>
        </div>
        <PlayOptions arcade={arcade} vertical />
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-text-muted">Highway layout</span>
          <Segmented<Layout>
            size="small"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'kit', label: 'Your kit' },
              { value: 'lanes', label: 'Straight lanes' },
            ]}
          />
        </div>
        <p className="m-0 text-[12px] text-text-muted">
          Play your kit, use the keys shown on each pad, or click / tap the
          pads.
        </p>
        <SkipWarning arcade={arcade} />
      </aside>
      <div className="flex flex-col gap-4 min-w-0">
        <div
          className="relative rounded-[14px] border border-border overflow-hidden flex justify-center"
          style={{
            background:
              'radial-gradient(120% 70% at 50% 100%, #1d1b1a 0%, #111214 60%)',
          }}
        >
          <PassToast arcade={arcade} />
          <svg
            ref={svgRef}
            viewBox={`0 ${TOP} 100 182`}
            preserveAspectRatio="xMidYMax meet"
            className="block w-full max-w-full touch-none select-none h-[min(54vh,600px)] max-[760px]:h-[46vh]"
            aria-label="Note highway"
          >
            <g ref={beatsRef}>
              {Array.from({ length: BEAT_LINES }, (_, i) => (
                <line key={i} x1={2} x2={98} display="none" />
              ))}
            </g>
            <line
              x1={2}
              x2={98}
              y1={refY}
              y2={refY}
              stroke="var(--color-fill-strong)"
              strokeWidth={0.3}
              strokeDasharray="1 1"
            />
            {layout === 'kit' ? (
              <KitLayer arcade={arcade} dim={0.9} showKeys />
            ) : (
              <>
                {kick && (
                  <g
                    transform={`translate(50 ${HIT_Y})`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={strike(kick)}
                  >
                    <rect
                      x={-44}
                      y={-1}
                      width={88}
                      height={2}
                      rx={1}
                      fill={kick.color}
                      opacity={0.55}
                    />
                    <rect
                      data-flash={kick.id}
                      x={-44}
                      y={-1.4}
                      width={88}
                      height={2.8}
                      rx={1.4}
                      fill="#fff"
                      opacity={0}
                    />
                    <text
                      y={9}
                      fontSize={2.6}
                      fontWeight={600}
                      textAnchor="middle"
                      fill="var(--color-text)"
                      stroke={HALO}
                      strokeWidth={0.8}
                      paintOrder="stroke"
                      style={TEXT_STYLE}
                    >
                      {kickKey ? `${kick.name} · ${kickKey}` : kick.name}
                    </text>
                  </g>
                )}
                {hands.map((p) => {
                  const t = targets.get(p.id);

                  if (!t) {
                    return null;
                  }

                  return (
                    <g key={p.id}>
                      <rect
                        x={t.x - 5}
                        y={TOP}
                        width={10}
                        height={HIT_Y - TOP}
                        fill={p.color}
                        opacity={0.05}
                      />
                      <g
                        transform={`translate(${t.x} ${HIT_Y})`}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={strike(p)}
                      >
                        <circle
                          r={t.r}
                          fill="#17181a"
                          stroke={p.color}
                          strokeWidth={t.cym ? 0.7 : 1.3}
                          strokeDasharray={t.cym ? '1.2 .8' : undefined}
                        />
                        <circle
                          data-flash={p.id}
                          r={t.r}
                          fill="#fff"
                          opacity={0}
                        />
                        <KeyBadge
                          x={0}
                          y={0}
                          label={keyLabels.get(p.id) ?? ''}
                        />
                        <text
                          y={t.r + 4}
                          fontSize={2.6}
                          fontWeight={600}
                          textAnchor="middle"
                          fill="var(--color-text)"
                          stroke={HALO}
                          strokeWidth={0.8}
                          paintOrder="stroke"
                          style={TEXT_STYLE}
                        >
                          {p.name}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </>
            )}
            <g>
              {hands.map((p) => {
                const t = targets.get(p.id);

                return t ? (
                  <circle
                    key={p.id}
                    ref={(el) => {
                      if (el) {
                        rings.set(p.id, el);
                      } else {
                        rings.delete(p.id);
                      }
                    }}
                    cx={t.x}
                    cy={t.y}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={0.6}
                    opacity={0}
                    style={{ pointerEvents: 'none' }}
                  />
                ) : null;
              })}
            </g>
            <g style={{ pointerEvents: 'none' }}>
              {legendPieces.map((p) => {
                const t = targets.get(p.id);

                if (!t) {
                  return null;
                }

                if (t.kick) {
                  return (
                    <GemPool
                      key={`${layout}:${p.id}`}
                      id={p.id}
                      count={sizes.get(p.id) ?? 4}
                      register={register}
                    >
                      <rect
                        x={-t.w / 2}
                        y={-1.3}
                        width={t.w}
                        height={2.6}
                        rx={1.3}
                        fill={p.color}
                        stroke={HALO}
                        strokeWidth={0.4}
                      />
                    </GemPool>
                  );
                }

                const r =
                  layout === 'lanes'
                    ? 3.6
                    : Math.max(2.6, Math.min(4.2, t.r * 0.55));
                const a = r * 0.45;

                return (
                  <GemPool
                    key={`${layout}:${p.id}`}
                    id={p.id}
                    count={sizes.get(p.id) ?? 4}
                    register={register}
                  >
                    <circle
                      r={r}
                      fill={p.color}
                      stroke={HALO}
                      strokeWidth={0.5}
                    />
                    {t.cym ? (
                      <path
                        d={`M${-a} ${-a}L${a} ${a}M${a} ${-a}L${-a} ${a}`}
                        stroke={HALO}
                        strokeWidth={0.55}
                        strokeLinecap="round"
                      />
                    ) : (
                      <circle r={r * 0.38} fill={HALO} opacity={0.55} />
                    )}
                  </GemPool>
                );
              })}
            </g>
            <g ref={fxRef} />
          </svg>
          <ResultsOverlay arcade={arcade} />
        </div>
        <SheetStrip arcade={arcade} />
      </div>
      <aside className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-3 min-w-0">
        <div>
          <h3 className="m-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted">
            Score
          </h3>
          <div
            ref={scoreRef}
            className="font-display text-[40px] leading-none text-text tabular-nums mt-1"
          >
            0
          </div>
        </div>
        <Stat label="Streak" valueRef={streakRef} initial="0" />
        <Stat label="Multiplier" valueRef={multRef} initial="×1" />
        <Stat label="Accuracy" valueRef={accRef} initial="–" />
        <div className="flex justify-between items-baseline">
          <span className="text-[12px] text-text-muted">
            Perfect · Good · Miss
          </span>
          <span ref={countsRef} className="font-mono text-[13px] text-text">
            0 · 0 · 0
          </span>
        </div>
        <h3 className="m-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted">
          Pads
        </h3>
        <ul className="list-none m-0 p-0 flex flex-col gap-[3px]">
          {legendPieces.map((p) => {
            const key = keyLabels.get(p.id);

            return (
              <li
                key={p.id}
                ref={(el) => {
                  if (el) {
                    legend.set(p.id, el);
                  } else {
                    legend.delete(p.id);
                  }
                }}
                className="grid grid-cols-[12px_minmax(0,1fr)_auto] gap-2 items-center px-[7px] py-[5px] rounded-[7px] text-[12.5px] cursor-pointer"
                onPointerDown={strike(p)}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: p.color,
                    boxShadow: '0 0 0 2px rgba(0,0,0,.4)',
                  }}
                />
                <span className="truncate text-text-body">{p.name}</span>
                {key ? (
                  <kbd className="font-ui font-semibold text-[11px] bg-surface-raised border border-border border-b-2 rounded-[5px] px-1.5 py-px text-text">
                    {key}
                  </kbd>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

function Stat({
  label,
  valueRef,
  initial,
}: {
  label: string;
  valueRef: React.RefObject<HTMLSpanElement | null>;
  initial: string;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[12px] text-text-muted">{label}</span>
      <span
        ref={valueRef}
        className="font-display font-medium text-[22px] leading-none text-text tabular-nums"
      >
        {initial}
      </span>
    </div>
  );
}
