import { useMemo, useRef, useState } from 'react';
import { firstNoteAtOrAfter, isCymbal, pieceRadius } from '../../../kit';
import { useAnimationFrame } from '../hooks';
import { PlaySession } from '../session';
import {
  LiveStats,
  PassToast,
  PlayOptions,
  ResultsOverlay,
  SkipWarning,
} from './arcade/ArcadeUi';
import {
  ErrorTicks,
  flashPiece,
  GemPools,
  popJudgment,
  ringAt,
  setAttr,
  setText,
} from './arcade/fx';
import {
  forEachBeat,
  poolSizes,
  sectionIndexAt,
  songProgress,
  spreadPositions,
} from './arcade/helpers';
import {
  ARCADE_RULES,
  clamp,
  displayMultiplier,
  feverLevel,
  formatPercent,
  hitLabel,
  MISS_COLOR,
} from './arcade/scoring';
import { SheetStrip } from './arcade/SheetStrip';
import {
  BIG_STYLE,
  ErrorMeter,
  GemPool,
  KeyBadge,
  KitLayer,
  LABEL_STYLE,
  useStrikeFlash,
} from './arcade/StageParts';
import { useArcade } from './arcade/useArcade';

const W = 210;
/** Hit line (y) and the top of the lanes. */
const YS = 74;
const YT = 3;
/** Kit drawing scale and left edge (centered on x 105). */
const KS = 0.8;
const KX = 105 - 50 * KS;
const LANE_GAP = 9;
const RT = 4;
const INK = '#0d0e10';
const TEXT = '#f2ede1';
const LBL = '#9c9484';
const GOLD = '#e9b949';
const METER_W = 52;
const BASE_LOOK = 1.4 * 1.5;
const BEAT_LINES = 48;
const STAGE_CSS = `
svg[data-stage="v13"] .fvb { transition: opacity .3s; }
svg[data-stage="v13"].fever .fvb { opacity: .12; }
svg[data-stage="v13"].fever .gm { stroke: #ffe9a8; }
`;

/**
 * v13: a lane standing over each pad of the kit, all hit on one line. Round
 * gems are cymbals, square gems drums, the wide bar the kick.
 */
export function LanesView({ session }: { session: PlaySession }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGGElement>(null);
  const judgeRef = useRef<SVGTextElement>(null);
  const ticksRef = useRef<SVGGElement>(null);
  const beatsRef = useRef<SVGGElement>(null);
  const scoreRef = useRef<SVGTextElement>(null);
  const multRef = useRef<SVGTextElement>(null);
  const streakRef = useRef<SVGTextElement>(null);
  const accRef = useRef<SVGTextElement>(null);
  const meterRef = useRef<SVGRectElement>(null);
  const hintRef = useRef<SVGTextElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const sectionRef = useRef<SVGTextElement>(null);
  const feverOn = useRef(false);
  const [pools] = useState(() => new GemPools());
  const [ticks] = useState(() => new ErrorTicks());
  const { notes, bars, pieceByVoice, kit, engine } = session;
  const windowMs = engine.hitTolerance * 1000;
  const arcade = useArcade(session, ARCADE_RULES, {
    onHit: (_note, piece, tier, offset) => {
      const t = ARCADE_RULES.tiers[tier];
      const x = laneX.get(piece.id);

      if (x !== undefined) {
        flashPiece(svgRef.current, piece.id, 0.5, 240, 'data-lane');
        flashPiece(svgRef.current, piece.id, 1, 320, 'data-curve');
        ringAt(fxRef.current, x, YS, RT, tier ? piece.color : t.color, !tier);
      }

      popJudgment(judgeRef.current, hitLabel(t, offset), t.color);
      ticks.push(ticksRef.current, offset * 1000, windowMs, t.color);
    },
    onMiss: () => popJudgment(judgeRef.current, 'Miss', MISS_COLOR),
    onReset: () => ticks.clear(ticksRef.current),
  });
  const { lanes, log, score, keyLabels, sections, hasCrash } = arcade;
  const { hands, kick } = lanes;
  const geo = useMemo(() => {
    const top = Math.min(
      20,
      ...kit.pieces.map((p) => p.y - pieceRadius(p) - 2),
    );
    const ky0 = YS + 6 - top * KS;
    const bottom = Math.max(
      60,
      ...kit.pieces.map((p) => {
        if (p.type === 'kick') {
          return p.y + pieceRadius(p) * 0.6 + 12.5;
        }

        return p.type === 'hhpedal' ? p.y + 6 : p.y + pieceRadius(p) + 2;
      }),
    );
    const xs = spreadPositions(
      hands.map((p) => KX + p.x * KS),
      LANE_GAP,
      62,
      148,
    );
    let gap = LANE_GAP;

    for (let i = 1; i < xs.length; i += 1) {
      gap = Math.min(gap, xs[i] - xs[i - 1]);
    }

    const n = xs.length;
    const kc = n ? (xs[0] + xs[n - 1]) / 2 : 105;
    const kw = n ? (xs[n - 1] - xs[0]) / 2 + LANE_GAP * 0.6 : 50;

    return {
      ky0,
      height: Math.max(70, ky0 + bottom * KS + 2),
      laneX: new Map(hands.map((p, i) => [p.id, xs[i]])),
      laneW: Math.min(LANE_GAP, gap) * 0.78,
      gs: 0.9 * Math.min(1, gap / LANE_GAP),
      kc,
      kw,
    };
  }, [kit.pieces, hands]);
  const { laneX, kc: KC, kw: KW, gs: GS, laneW } = geo;
  const kx = (x: number) => KX + x * KS;
  const ky = (y: number) => geo.ky0 + y * KS;
  const look = BASE_LOOK * arcade.lookFactor;
  const trail = 0.12 * look;
  const sizes = useMemo(
    () => poolSizes(notes, pieceByVoice, trail, look * 1.05),
    [notes, pieceByVoice, trail, look],
  );
  const register = (id: string, el: Element | null) => pools.register(id, el);

  useStrikeFlash(arcade, svgRef);

  useAnimationFrame(session, (now) => {
    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    pools.begin();

    for (
      let i = firstNoteAtOrAfter(notes, now - trail);
      i < notes.length && notes[i].time <= now + look * 1.05;
      i += 1
    ) {
      const note = notes[i];
      const piece = pieceByVoice.get(note.voice);
      const j = log.get(note.id);

      if (!piece || (j && j.tier >= 0)) {
        continue;
      }

      const t = (note.time - now) / look;
      const o =
        clamp((1.05 - t) / 0.12) *
        (t < 0 ? clamp(1 + t / 0.12) : 1) *
        (j ? 0.3 : 1);
      const y = (YS - (YS - YT) * t).toFixed(2);

      if (piece === kick) {
        pools.place(piece.id, `translate(${KC.toFixed(2)} ${y})`, o);
      } else {
        const x = laneX.get(piece.id);

        if (x !== undefined) {
          pools.place(
            piece.id,
            `translate(${x.toFixed(2)} ${y}) scale(${GS.toFixed(3)})`,
            o,
          );
        }
      }
    }

    pools.end();

    const lines = beatsRef.current?.children;
    let k = 0;

    if (lines) {
      forEachBeat(bars, now - trail, now + look, (bt, down) => {
        const el = lines[k];

        k += 1;

        if (!el) {
          return;
        }

        const y = (YS - ((YS - YT) * (bt - now)) / look).toFixed(2);

        el.setAttribute('y1', y);
        el.setAttribute('y2', y);
        setAttr(el, 'stroke', down ? '#e8e8ea' : 'rgba(232,232,234,.3)');
        setAttr(el, 'stroke-width', down ? 0.55 : 0.25);
        setAttr(el, 'display', 'inline');
      });

      for (; k < lines.length; k += 1) {
        setAttr(lines[k], 'display', 'none');
      }
    }

    const s = score.current;
    const summary = log.summary();

    setText(scoreRef.current, s.score.toLocaleString());
    setText(multRef.current, `×${displayMultiplier(s)}`);
    setText(streakRef.current, `${s.streak} STREAK`);
    setText(
      accRef.current,
      summary.judged ? formatPercent(summary.accuracy) : '–',
    );
    setAttr(
      meterRef.current,
      'width',
      (feverLevel(s, now) * METER_W).toFixed(1),
    );

    let hint = '';

    if (s.fever) {
      hint = 'FEVER ×2';
    } else if (s.meter >= 1) {
      hint = hasCrash ? 'Fever ready · hit a crash' : 'Fever ready';
    }

    setText(hintRef.current, hint);
    setAttr(
      dotRef.current,
      'cx',
      (152 + songProgress(bars, now) * 52).toFixed(1),
    );
    setText(
      sectionRef.current,
      sections.length
        ? sections[sectionIndexAt(sections, now)].name.toUpperCase()
        : '',
    );

    if (feverOn.current !== s.fever) {
      feverOn.current = s.fever;
      svg.classList.toggle('fever', s.fever);
    }
  });

  const songStart = bars[0]?.start ?? 0;
  const songEnd = bars[bars.length - 1]?.end ?? 1;
  const empty = hands.length === 0 && !kick;

  return (
    <div className="p-4 flex flex-col gap-3">
      <PlayOptions arcade={arcade} />
      <SkipWarning arcade={arcade} />
      <div
        className="relative rounded-[14px] border border-border overflow-hidden"
        style={{
          background:
            'radial-gradient(90% 60% at 50% 100%, #1f1c1a 0%, #0d0e10 70%)',
        }}
      >
        <PassToast arcade={arcade} />
        <svg
          ref={svgRef}
          data-stage="v13"
          viewBox={`0 0 ${W} ${geo.height.toFixed(2)}`}
          className="block w-full h-auto max-h-[78vh] touch-none select-none"
          aria-label="Note lanes standing over each pad of your kit, hit on one line"
        >
          <style>{STAGE_CSS}</style>
          <defs>
            <linearGradient id="v13Lane" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity={0.2} />
              <stop offset=".6" stopColor="#fff" stopOpacity={0.03} />
              <stop offset="1" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="v13Fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={INK} />
              <stop offset="1" stopColor={INK} stopOpacity={0} />
            </linearGradient>
          </defs>
          <g transform={`translate(${KX} ${geo.ky0.toFixed(2)}) scale(${KS})`}>
            <KitLayer arcade={arcade} showThrone={false} />
          </g>
          <g>
            {hands.map((p) => {
              const x = laneX.get(p.id) ?? 0;
              const r = pieceRadius(p);
              const px = kx(p.x);
              const pr = r * KS * 0.7;
              const pt = ky(p.y) - r * KS;
              const lane = {
                x: x - laneW / 2,
                y: YT,
                width: laneW,
                height: YS - YT,
                rx: 1.6,
              };
              const band = `${(x - laneW * 0.3).toFixed(2)},${YS + 1.6} ${(
                x +
                laneW * 0.3
              ).toFixed(2)},${YS + 1.6} ${(px + pr).toFixed(2)},${(
                pt + 1
              ).toFixed(2)} ${(px - pr).toFixed(2)},${(pt + 1).toFixed(2)}`;

              return (
                <g key={p.id}>
                  <rect {...lane} fill={p.color} opacity={0.1} />
                  <rect {...lane} fill="url(#v13Lane)" />
                  <rect {...lane} data-lane={p.id} fill={p.color} opacity={0} />
                  <polygon points={band} fill={p.color} opacity={0.18} />
                  <polygon
                    points={band}
                    data-curve={p.id}
                    fill={p.color}
                    opacity={0}
                  />
                </g>
              );
            })}
            <rect
              className="fvb"
              x={KC - KW - 3}
              y={YT}
              width={2 * KW + 6}
              height={YS - YT}
              rx={2}
              fill={GOLD}
              opacity={0}
            />
          </g>
          <g ref={beatsRef}>
            {Array.from({ length: BEAT_LINES }, (_, i) => (
              <line key={i} x1={KC - KW} x2={KC + KW} display="none" />
            ))}
          </g>
          {kick && (
            <GemPool
              id={kick.id}
              count={sizes.get(kick.id) ?? 4}
              register={register}
            >
              <rect
                className="gm"
                x={-KW}
                y={-1.2}
                width={2 * KW}
                height={2.4}
                rx={1.2}
                fill={kick.color}
                stroke={INK}
                strokeWidth={0.35}
              />
            </GemPool>
          )}
          <rect
            x={KC - KW - 4}
            y={YS - 1.6}
            width={2 * KW + 8}
            height={3.2}
            rx={1.6}
            fill={TEXT}
            opacity={0.07}
          />
          <rect
            x={KC - KW - 4}
            y={YS - 0.4}
            width={2 * KW + 8}
            height={0.8}
            rx={0.4}
            fill={TEXT}
            opacity={0.85}
          />
          {kick && (
            <g
              transform={`translate(${KC.toFixed(2)} ${YS + 2.2})`}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => session.strikePiece(kick)}
            >
              <rect
                x={-KW}
                y={-0.6}
                width={2 * KW}
                height={1.2}
                rx={0.6}
                fill={kick.color}
                opacity={0.7}
              />
              <rect
                data-flash={kick.id}
                x={-KW}
                y={-1}
                width={2 * KW}
                height={2}
                rx={1}
                fill="#fff"
                opacity={0}
              />
            </g>
          )}
          {hands.map((p) => {
            const cym = isCymbal(p.type);

            return (
              <g
                key={p.id}
                transform={`translate(${(laneX.get(p.id) ?? 0).toFixed(
                  2,
                )} ${YS})`}
                style={{ cursor: 'pointer' }}
                onPointerDown={() => session.strikePiece(p)}
              >
                <circle r={RT + 0.6} fill={INK} opacity={0.85} />
                <circle
                  r={RT}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={cym ? 0.8 : 1.3}
                  strokeDasharray={cym ? '1.3 .8' : undefined}
                />
                <circle data-flash={p.id} r={RT} fill="#fff" opacity={0} />
              </g>
            );
          })}
          {[...hands, ...(kick ? [kick] : [])].map((p) => (
            <KeyBadge
              key={p.id}
              x={kx(p.x)}
              y={ky(p.y)}
              label={keyLabels.get(p.id) ?? ''}
            />
          ))}
          {hands.map((p) => (
            <GemPool
              key={p.id}
              id={p.id}
              count={sizes.get(p.id) ?? 4}
              register={register}
            >
              {isCymbal(p.type) ? (
                <>
                  <circle
                    className="gm"
                    r={4.5}
                    fill={p.color}
                    stroke={INK}
                    strokeWidth={0.5}
                  />
                  <circle
                    r={2.7}
                    fill="none"
                    stroke="#fff"
                    strokeOpacity={0.5}
                    strokeWidth={0.5}
                  />
                  <circle r={0.9} fill={INK} />
                </>
              ) : (
                <>
                  <rect
                    className="gm"
                    x={-4.3}
                    y={-4.3}
                    width={8.6}
                    height={8.6}
                    rx={2}
                    fill={p.color}
                    stroke={INK}
                    strokeWidth={0.5}
                  />
                  <rect
                    x={-2.5}
                    y={-2.5}
                    width={5}
                    height={5}
                    rx={1.2}
                    fill="#fff"
                    fillOpacity={0.25}
                  />
                </>
              )}
            </GemPool>
          ))}
          <rect
            x={0}
            y={0}
            width={W}
            height={YT + 9}
            fill="url(#v13Fade)"
            style={{ pointerEvents: 'none' }}
          />
          <g ref={fxRef} />
          <text
            ref={judgeRef}
            x={KC}
            y={YS - 9}
            fontSize={3.6}
            fontWeight={700}
            textAnchor="middle"
            opacity={0}
            style={{
              ...LABEL_STYLE,
              transformBox: 'fill-box',
              transformOrigin: 'center',
              paintOrder: 'stroke',
              stroke: INK,
              strokeWidth: '.8px',
            }}
          />
          <text x={6} y={10} fontSize={3} fill={LBL} style={LABEL_STYLE}>
            SCORE
          </text>
          <text
            ref={scoreRef}
            x={6}
            y={22}
            fontSize={11}
            fill={TEXT}
            style={BIG_STYLE}
          >
            0
          </text>
          <text
            ref={multRef}
            x={6}
            y={40}
            fontSize={11}
            fill={GOLD}
            style={BIG_STYLE}
          >
            ×1
          </text>
          <text
            ref={streakRef}
            x={6}
            y={46}
            fontSize={2.8}
            fill={LBL}
            style={LABEL_STYLE}
          >
            0 STREAK
          </text>
          <text x={6} y={57} fontSize={2.6} fill={LBL} style={LABEL_STYLE}>
            FEVER
          </text>
          <rect
            x={6}
            y={59}
            width={METER_W}
            height={2.4}
            rx={1.2}
            fill="var(--color-fill-strong)"
          />
          <rect
            ref={meterRef}
            x={6}
            y={59}
            width={0}
            height={2.4}
            rx={1.2}
            fill={GOLD}
          />
          <text
            ref={hintRef}
            x={6}
            y={66}
            fontSize={2.6}
            fill={GOLD}
            fontWeight={600}
            style={LABEL_STYLE}
          />
          <text
            x={204}
            y={10}
            fontSize={3}
            fill={LBL}
            textAnchor="end"
            style={LABEL_STYLE}
          >
            ACCURACY
          </text>
          <text
            ref={accRef}
            x={204}
            y={22}
            fontSize={11}
            fill={TEXT}
            textAnchor="end"
            style={BIG_STYLE}
          >
            –
          </text>
          <rect
            x={152}
            y={30}
            width={METER_W}
            height={1}
            rx={0.5}
            fill="var(--color-fill-strong)"
          />
          {sections.slice(1).map((sec) => {
            const x =
              152 + clamp((sec.start - songStart) / (songEnd - songStart)) * 52;

            return (
              <line
                key={sec.startTick}
                x1={x}
                x2={x}
                y1={29.4}
                y2={31.6}
                stroke={LBL}
                strokeWidth={0.25}
              />
            );
          })}
          <text
            ref={sectionRef}
            x={204}
            y={35.4}
            fontSize={2.2}
            fill={LBL}
            textAnchor="end"
            style={LABEL_STYLE}
          />
          <circle ref={dotRef} cx={152} cy={30.5} r={1.3} fill="#ff5a3c" />
          <ErrorMeter
            x={178}
            y={50}
            halfWidth={26}
            height={3.6}
            windowMs={windowMs}
            ticksRef={ticksRef}
            ink={TEXT}
            labelColor={LBL}
            labelSize={2.4}
          />
          {empty && (
            <text
              x={105}
              y={YS / 2}
              fontSize={3.4}
              fill={TEXT}
              textAnchor="middle"
              style={LABEL_STYLE}
            >
              This kit has no pads for the chart. Add pieces in Build kit.
            </text>
          )}
        </svg>
        <ResultsOverlay arcade={arcade} />
      </div>
      <SheetStrip arcade={arcade} />
      <LiveStats arcade={arcade} />
      <p className="m-0 text-[12px] text-text-muted">
        Each lane stands over its pad on your kit, and every pad is hit on the
        same line. Round gems are cymbals, square gems are drums, the wide bar
        is the kick. Play your kit, use the keys shown on the pads, or tap the
        pads. Fill Fever, then hit a crash for double points.
      </p>
    </div>
  );
}
