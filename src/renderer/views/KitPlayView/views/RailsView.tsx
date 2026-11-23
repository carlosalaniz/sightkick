import { useMemo, useRef, useState } from 'react';
import { firstNoteAtOrAfter, isCymbal } from '../../../kit';
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
  staffStep,
} from './arcade/helpers';
import {
  ARCADE_RULES,
  clamp,
  displayMultiplier,
  feverLevel,
  formatPercent,
  gemState,
  hitLabel,
  hitRing,
  MISS_COLOR,
  SPIRIT_PASS,
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

const W = 160;
const H = 78;
/** The hit line (x) and the rail band (y). */
const XH = 66;
const Y0 = 17;
const Y1 = 73;
const KC = (Y0 + Y1) / 2;
const KW = (Y1 - Y0) / 2;
/** The kit drawing inside the left box. */
const KX = 4;
const KY = 14;
const KS = 0.52;
const NAVY = '#17142b';
const CREAM = '#f6ecd6';
const GOLD = '#f2b632';
const LBL = '#a99fc7';
const METER_W = 42;
const BASE_LOOK = 1.4;
const BEAT_LINES = 40;
const STAGE_CSS = `
svg[data-stage="v12"] .fv { transition: opacity .3s; }
svg[data-stage="v12"].fever .fv { opacity: .2; }
svg[data-stage="v12"].fever .gm { stroke: ${GOLD}; stroke-width: .5px; }
`;

/**
 * v12: one horizontal rail per pad, stacked in staff order (cymbals on top,
 * kick across all of them). Notes fly right to left over a single hit line
 * into the kit drawn on the left.
 */
export function RailsView({ session }: { session: PlaySession }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGGElement>(null);
  const judgeRef = useRef<SVGTextElement>(null);
  const ticksRef = useRef<SVGGElement>(null);
  const beatsRef = useRef<SVGGElement>(null);
  const scoreRef = useRef<SVGTextElement>(null);
  const multRef = useRef<SVGTextElement>(null);
  const streakRef = useRef<SVGTextElement>(null);
  const accRef = useRef<SVGTextElement>(null);
  const spiritRef = useRef<SVGRectElement>(null);
  const meterRef = useRef<SVGRectElement>(null);
  const hintRef = useRef<SVGTextElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const sectionRef = useRef<SVGTextElement>(null);
  const feverOn = useRef(false);
  const [pools] = useState(() => new GemPools());
  const [ticks] = useState(() => new ErrorTicks());
  const { notes, bars, pieceByVoice, engine } = session;
  const windowMs = engine.hitTolerance * 1000;
  const arcade = useArcade(session, ARCADE_RULES, {
    onHit: (_note, piece, t, offset) => {
      const y = laneY.get(piece.id);

      if (y !== undefined) {
        flashPiece(svgRef.current, piece.id, 0.5, 240, 'data-lane');
        flashPiece(svgRef.current, piece.id, 1, 320, 'data-curve');

        const ring = hitRing(t, piece.color);

        ringAt(fxRef.current, XH, y, RT, ring.color, ring.big);
      }

      popJudgment(judgeRef.current, hitLabel(t, offset), t.color);
      ticks.push(ticksRef.current, offset * 1000, windowMs, t.color);
    },
    onMiss: () => popJudgment(judgeRef.current, 'Miss', MISS_COLOR),
    onReset: () => ticks.clear(ticksRef.current),
  });
  const { lanes, log, score, keyLabels, sections, hasCrash } = arcade;
  const kick = lanes.kick;
  const hands = useMemo(
    () =>
      [...lanes.hands].sort(
        (a, b) => staffStep(b, pieceByVoice) - staffStep(a, pieceByVoice),
      ),
    [lanes.hands, pieceByVoice],
  );
  const LW = hands.length ? (Y1 - Y0) / hands.length : 8;
  const GS = Math.min(1, LW / 8.2);
  const RT = 3.6 * GS;
  const laneY = new Map(hands.map((p, i) => [p.id, Y0 + (i + 0.5) * LW]));
  const look = BASE_LOOK * arcade.lookFactor;
  const trail = 0.12 * look;
  const sizes = useMemo(
    () => poolSizes(notes, pieceByVoice, trail, look * 1.05),
    [notes, pieceByVoice, trail, look],
  );
  const kx = (x: number) => KX + x * KS;
  const ky = (y: number) => KY + y * KS;
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
      const gem = gemState(log.get(note.id));

      if (!piece || gem === 'hit') {
        continue;
      }

      const t = (note.time - now) / look;
      const o =
        clamp((1.05 - t) / 0.12) *
        (t < 0 ? clamp(1 + t / 0.12) : 1) *
        (gem === 'missed' ? 0.3 : 1);
      const x = (XH + (W - XH) * t).toFixed(2);

      if (piece === kick) {
        pools.place(piece.id, `translate(${x} ${KC})`, o);
      } else {
        const y = laneY.get(piece.id);

        if (y !== undefined) {
          pools.place(
            piece.id,
            `translate(${x} ${y.toFixed(2)}) scale(${GS.toFixed(3)})`,
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

        const x = (XH + ((W - XH) * (bt - now)) / look).toFixed(2);

        el.setAttribute('x1', x);
        el.setAttribute('x2', x);
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
    const meter = feverLevel(s, now);

    setText(scoreRef.current, s.score.toLocaleString());
    setText(multRef.current, `×${displayMultiplier(s)}`);
    setText(streakRef.current, `${s.streak} STREAK`);
    setText(
      accRef.current,
      summary.judged ? formatPercent(summary.accuracy) : '–',
    );
    setAttr(spiritRef.current, 'width', (clamp(s.spirit) * METER_W).toFixed(1));
    setAttr(
      spiritRef.current,
      'fill',
      s.spirit >= SPIRIT_PASS ? GOLD : '#e8492f',
    );
    setAttr(meterRef.current, 'width', (meter * METER_W).toFixed(1));

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
      (66 + songProgress(bars, now) * 92).toFixed(1),
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

  const curve = (y: number, px: number, py: number, x0 = XH - 3) =>
    `M${x0} ${y.toFixed(2)}C${x0 - 9} ${y.toFixed(2)},${(px + 10).toFixed(
      2,
    )} ${py.toFixed(2)},${px.toFixed(2)} ${py.toFixed(2)}`;
  const songStart = bars[0]?.start ?? 0;
  const songEnd = bars[bars.length - 1]?.end ?? 1;
  const empty = hands.length === 0 && !kick;

  return (
    <div className="p-4 flex flex-col gap-3">
      <PlayOptions arcade={arcade} />
      <SkipWarning arcade={arcade} />
      <div
        className="relative rounded-[14px] border border-border overflow-hidden"
        style={{ background: NAVY }}
      >
        <PassToast arcade={arcade} />
        <svg
          ref={svgRef}
          data-stage="v12"
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full h-auto max-h-[66vh] touch-none select-none"
          aria-label="Notes fly right to left along one rail per pad, cross a single hit line and run into your kit on the left"
        >
          <style>{STAGE_CSS}</style>
          <rect width={W} height={H} fill={NAVY} />
          <rect
            x={1.5}
            y={1.5}
            width={58}
            height={75}
            rx={3}
            fill="#100d1f"
            stroke={GOLD}
            strokeOpacity={0.5}
            strokeWidth={0.4}
          />
          <g>
            {hands.map((p, i) => {
              const y = laneY.get(p.id) ?? 0;
              const rail = {
                x: XH,
                y: y - LW / 2 + 0.4,
                width: W - XH,
                height: LW - 0.8,
                rx: 1.5,
              };
              const d = curve(y, kx(p.x), ky(p.y));

              return (
                <g key={p.id}>
                  <rect {...rail} fill={i % 2 ? '#211c3c' : '#28224a'} />
                  <rect {...rail} fill={p.color} opacity={0.1} />
                  <rect {...rail} data-lane={p.id} fill={p.color} opacity={0} />
                  <text
                    x={XH + 6}
                    y={y + 0.8}
                    fontSize={2.3}
                    fontWeight={700}
                    fill={p.color}
                    opacity={0.55}
                    style={LABEL_STYLE}
                  >
                    {p.name.toUpperCase()}
                  </text>
                  <path
                    d={d}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={1.1}
                    strokeLinecap="round"
                    opacity={0.5}
                  />
                  <path
                    d={d}
                    data-curve={p.id}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    opacity={0}
                  />
                </g>
              );
            })}
            {kick && (
              <path
                d={curve(Y1 - 1, kx(kick.x), ky(kick.y), XH - 1.5)}
                fill="none"
                stroke={kick.color}
                strokeWidth={1.1}
                strokeLinecap="round"
                opacity={0.5}
              />
            )}
            <rect
              className="fv"
              x={XH}
              y={Y0}
              width={W - XH}
              height={Y1 - Y0}
              fill="#ff7a1a"
              opacity={0}
            />
          </g>
          <g transform={`translate(${KX} ${KY}) scale(${KS})`}>
            <KitLayer arcade={arcade} />
          </g>
          <g ref={beatsRef}>
            {Array.from({ length: BEAT_LINES }, (_, i) => (
              <line key={i} y1={KC - KW} y2={KC + KW} display="none" />
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
                x={-1.4}
                y={-KW}
                width={2.8}
                height={2 * KW}
                rx={1.4}
                fill={kick.color}
                stroke={CREAM}
                strokeWidth={0.4}
              />
            </GemPool>
          )}
          <rect
            x={XH - 1.1}
            y={Y0 - 1}
            width={2.2}
            height={Y1 - Y0 + 2}
            rx={1.1}
            fill={CREAM}
            opacity={0.85}
          />
          {kick && (
            <g
              transform={`translate(${XH} ${KC})`}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => session.strikePiece(kick)}
            >
              <rect
                x={-0.7}
                y={-KW}
                width={1.4}
                height={2 * KW}
                rx={0.7}
                fill={kick.color}
                opacity={0.8}
              />
              <rect
                data-flash={kick.id}
                x={-1.8}
                y={-KW}
                width={3.6}
                height={2 * KW}
                rx={1.8}
                fill="#fff"
                opacity={0}
              />
            </g>
          )}
          {hands.map((p) => (
            <g
              key={p.id}
              transform={`translate(${XH} ${(laneY.get(p.id) ?? 0).toFixed(
                2,
              )})`}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => session.strikePiece(p)}
            >
              <circle
                r={RT + 0.7}
                fill={NAVY}
                stroke={CREAM}
                strokeWidth={0.7}
              />
              <circle
                r={Math.max(0.5, RT - 0.6)}
                fill="none"
                stroke={p.color}
                strokeWidth={1}
              />
              <circle data-flash={p.id} r={RT} fill="#fff" opacity={0} />
            </g>
          ))}
          {[...hands, ...(kick ? [kick] : [])].map((p) => (
            <KeyBadge
              key={p.id}
              x={kx(p.x)}
              y={ky(p.y)}
              label={keyLabels.get(p.id) ?? ''}
            />
          ))}
          {hands.map((p) => {
            const cym = isCymbal(p.type);

            return (
              <GemPool
                key={p.id}
                id={p.id}
                count={sizes.get(p.id) ?? 4}
                register={register}
              >
                <circle r={3.7} fill={NAVY} />
                {cym ? (
                  <>
                    <circle className="gm" r={3.2} fill={CREAM} />
                    <circle
                      r={2.1}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={1.3}
                    />
                    <circle r={0.7} fill={p.color} />
                  </>
                ) : (
                  <>
                    <circle className="gm" r={3.2} fill={p.color} />
                    <circle
                      r={1.9}
                      fill="none"
                      stroke={CREAM}
                      strokeWidth={0.7}
                      opacity={0.9}
                    />
                  </>
                )}
              </GemPool>
            );
          })}
          <g ref={fxRef} />
          <text x={4} y={5} fontSize={2.2} fill={LBL} style={LABEL_STYLE}>
            SCORE
          </text>
          <text
            ref={scoreRef}
            x={4}
            y={11.6}
            fontSize={6}
            fill={CREAM}
            style={BIG_STYLE}
          >
            0
          </text>
          <text
            ref={multRef}
            x={4}
            y={75.2}
            fontSize={5.5}
            fill={GOLD}
            style={BIG_STYLE}
          >
            ×1
          </text>
          <text
            ref={streakRef}
            x={17}
            y={74.6}
            fontSize={2.2}
            fill={LBL}
            style={LABEL_STYLE}
          >
            0 STREAK
          </text>
          <text
            ref={judgeRef}
            x={XH}
            y={12.4}
            fontSize={4}
            fontWeight={700}
            textAnchor="middle"
            opacity={0}
            style={{
              ...LABEL_STYLE,
              transformBox: 'fill-box',
              transformOrigin: 'center',
              paintOrder: 'stroke',
              stroke: NAVY,
              strokeWidth: '.8px',
            }}
          />
          <text x={82} y={3.2} fontSize={1.9} fill={LBL} style={LABEL_STYLE}>
            SPIRIT
          </text>
          <rect
            x={82}
            y={4.2}
            width={METER_W}
            height={4}
            rx={2}
            fill="#0c0a18"
            stroke={CREAM}
            strokeOpacity={0.5}
            strokeWidth={0.3}
          />
          <rect
            ref={spiritRef}
            x={82}
            y={4.2}
            width={0}
            height={4}
            rx={2}
            fill="#e8492f"
          />
          <line
            x1={82 + SPIRIT_PASS * METER_W}
            x2={82 + SPIRIT_PASS * METER_W}
            y1={3.4}
            y2={9}
            stroke={CREAM}
            strokeWidth={0.4}
          />
          <rect
            x={82}
            y={9.8}
            width={METER_W}
            height={1.6}
            rx={0.8}
            fill="#0c0a18"
          />
          <rect
            ref={meterRef}
            x={82}
            y={9.8}
            width={0}
            height={1.6}
            rx={0.8}
            fill="#ff9a2e"
          />
          <text
            ref={hintRef}
            x={82}
            y={14.6}
            fontSize={2}
            fill="#ffb347"
            fontWeight={600}
            style={LABEL_STYLE}
          />
          <ErrorMeter
            x={138}
            y={7.4}
            halfWidth={9}
            height={3.2}
            windowMs={windowMs}
            ticksRef={ticksRef}
            track="#0c0a18"
            ink={CREAM}
            labelSize={1.7}
          />
          <text
            x={158}
            y={5}
            fontSize={2.2}
            fill={LBL}
            textAnchor="end"
            style={LABEL_STYLE}
          >
            ACCURACY
          </text>
          <text
            ref={accRef}
            x={158}
            y={11.6}
            fontSize={5.5}
            fill={CREAM}
            textAnchor="end"
            style={BIG_STYLE}
          >
            –
          </text>
          <rect x={66} y={76} width={92} height={0.8} rx={0.4} fill="#3a3360" />
          {sections.slice(1).map((sec) => {
            const x =
              66 + clamp((sec.start - songStart) / (songEnd - songStart)) * 92;

            return (
              <line
                key={sec.startTick}
                x1={x}
                x2={x}
                y1={75.6}
                y2={77.2}
                stroke={LBL}
                strokeWidth={0.2}
              />
            );
          })}
          <text
            ref={sectionRef}
            x={158}
            y={75.1}
            fontSize={1.7}
            fill={LBL}
            textAnchor="end"
            style={LABEL_STYLE}
          />
          <circle ref={dotRef} cx={66} cy={76.4} r={1} fill="#e8492f" />
          {empty && (
            <text
              x={(XH + W) / 2}
              y={KC}
              fontSize={3}
              fill={CREAM}
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
        Each pad of your kit has its own rail, stacked the way the notes sit on
        the sheet: cymbals on top, kick across the bottom. Cream gems with a
        colored ring are cymbals, solid gems are drums, and the tall bar is the
        kick. Play your kit, use the keys shown on the pads, or tap the pads.
        Keep Spirit past the line; fill Fever, then hit a crash for double
        points.
      </p>
    </div>
  );
}
