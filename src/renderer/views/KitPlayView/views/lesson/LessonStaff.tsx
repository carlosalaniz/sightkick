import { RefObject, useRef } from 'react';
import {
  KitPiece,
  TimelineBar,
  TimelineNote,
  Voice,
  VOICES_BY_STAFF,
} from '../../../../kit';
import { useAnimationFrame } from '../../hooks';
import { PlaySession } from '../../session';
import {
  countIndexAt,
  playheadX,
  StaffLayout,
  STAFF_H,
  STAFF_W,
  STAFF_X0,
} from './staff';

/** Colors drawn on the paper staff (the mock's, tuned for paper). */
export const INK = '#1c1a14';

export const TIER_COLORS = ['#2c8c52', '#b08a14', '#c46a2a'] as const;

export const MISS_COLOR = '#c62828';

const PLAYHEAD = '#c4402a';
const COUNT_BEAT = '#4a463c';
const COUNT_SUB = '#8c8577';
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const f1 = (x: number) => Number(x.toFixed(1));

export interface LessonStaffProps {
  session: PlaySession;
  layout: StaffLayout;
  bars: TimelineBar[];
  notes: TimelineNote[];
  pieceByVoice: Map<Voice, KitPiece>;
  /** Help on screen, 0–1. */
  guide: number;
  /** Voices drawn at full strength and in color (yours, or all while listening). */
  onVoices: Set<Voice>;
  showCounts: boolean;
  /** Label suffix for voices you do not play this step. */
  otherLabel: string;
  svgRef: RefObject<SVGSVGElement | null>;
}

/** Marks a judged note on the staff: a dot under it, and a ring if missed. */
export function markStaffNote(
  svg: SVGSVGElement | null,
  index: number,
  color: string,
  missed: boolean,
): void {
  if (!svg) {
    return;
  }

  svg.querySelector(`[data-n="${index}"]`)?.setAttribute('opacity', '0.45');

  const dot = svg.querySelector(`[data-m="${index}"]`);

  dot?.setAttribute('fill', color);
  dot?.setAttribute('opacity', '1');

  if (missed) {
    svg.querySelector(`[data-r="${index}"]`)?.setAttribute('opacity', '1');
  }
}

/** The static 4-bar staff of the mock, with a moving playhead and count. */
export function LessonStaff({
  session,
  layout,
  bars,
  notes,
  pieceByVoice,
  guide,
  onVoices,
  showCounts,
  otherLabel,
  svgRef,
}: LessonStaffProps) {
  const playheadRef = useRef<SVGGElement>(null);
  const countCache = useRef<{
    layout?: StaffLayout;
    els: SVGTextElement[];
    last: number;
  }>({
    els: [],
    last: -1,
  });
  const { y, top, bot, rx, ry, countY } = layout;
  const lop = clamp01(guide / 0.5);
  const stemOpacity = 1 - 0.75 * guide;
  const voices = new Set(notes.map((n) => n.voice));
  const rows = VOICES_BY_STAFF.filter((v) => voices.has(v.id));

  useAnimationFrame(session, (now) => {
    const ph = playheadRef.current;
    const x = playheadX(bars, now);

    if (ph) {
      ph.setAttribute('opacity', x === undefined ? '0' : '1');

      if (x !== undefined) {
        ph.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      }
    }

    const cache = countCache.current;

    if (cache.layout !== layout) {
      cache.layout = layout;
      cache.els = Array.from(
        svgRef.current?.querySelectorAll<SVGTextElement>('[data-c]') ?? [],
      );
      cache.last = -1;
    }

    const ci = x === undefined ? -1 : countIndexAt(layout.counts, now);

    if (ci !== cache.last) {
      const set = (i: number, on: boolean) => {
        const el = cache.els[i];
        const mark = layout.counts[i];

        if (!el || !mark) {
          return;
        }

        el.setAttribute(
          'fill',
          on ? PLAYHEAD : mark.beat ? COUNT_BEAT : COUNT_SUB,
        );
        el.setAttribute('font-size', String(on ? 20 : mark.beat ? 15 : 12));
      };

      set(cache.last, false);
      set(ci, true);
      cache.last = ci;
    }
  });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${STAFF_W} ${STAFF_H}`}
      className="block w-full h-auto"
      role="img"
      aria-label="Four bars of drum notation with a moving playhead"
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {rows.map((v) => {
        const piece = pieceByVoice.get(v.id);

        if (!piece) {
          return null;
        }

        const ly = y(v.step);
        const on = onVoices.has(v.id);

        return (
          <g key={v.id}>
            {guide > 0 && (
              <rect
                x={STAFF_X0 - 6}
                y={f1(ly - layout.h * 0.8)}
                width={STAFF_W - STAFF_X0 - 2}
                height={f1(layout.h * 1.6)}
                rx={5}
                fill={piece.color}
                opacity={0.26 * guide * (on ? 1 : 0.3)}
              />
            )}
            <g opacity={lop}>
              <circle cx={STAFF_X0 - 18} cy={f1(ly)} r={5} fill={piece.color} />
              <text
                x={STAFF_X0 - 30}
                y={f1(ly + 4.5)}
                textAnchor="end"
                fontSize={13}
                fontWeight={600}
                fill={INK}
              >
                {piece.name}
                {on ? '' : otherLabel}
              </text>
            </g>
          </g>
        );
      })}
      <g opacity={1 - lop}>
        <rect
          x={40}
          y={f1(y(6))}
          width={5}
          height={f1(y(2) - y(6))}
          fill={INK}
        />
        <rect
          x={50}
          y={f1(y(6))}
          width={5}
          height={f1(y(2) - y(6))}
          fill={INK}
        />
      </g>
      {[0, 2, 4, 6, 8].map((l) => (
        <line
          key={l}
          x1={14}
          x2={STAFF_W - 10}
          y1={f1(y(l))}
          y2={f1(y(l))}
          stroke={INK}
          strokeWidth={1.1}
          opacity={0.22 + 0.5 * (1 - guide)}
        />
      ))}
      {layout.barX.map((x, i) => (
        <line
          key={i}
          x1={x}
          x2={x}
          y1={f1(y(8))}
          y2={f1(y(0))}
          stroke={INK}
          strokeWidth={i === layout.barX.length - 1 ? 3 : 1.4}
          opacity={0.8}
        />
      ))}
      {layout.ledgers.map((l, i) => (
        <line
          key={i}
          x1={f1(l.x1)}
          x2={f1(l.x2)}
          y1={f1(l.y1)}
          y2={f1(l.y2)}
          stroke={INK}
          strokeWidth={1.1}
          opacity={0.6}
        />
      ))}
      <g opacity={stemOpacity} fill={INK} stroke={INK}>
        {layout.stems.map((s, i) => (
          <line
            key={i}
            x1={f1(s.x1)}
            x2={f1(s.x2)}
            y1={f1(s.y1)}
            y2={f1(s.y2)}
            strokeWidth={1.5}
          />
        ))}
        {layout.beams.map((b, i) => (
          <rect
            key={i}
            x={f1(b.x)}
            y={f1(b.y)}
            width={f1(b.w)}
            height={b.h}
            stroke="none"
          />
        ))}
        {layout.flags.map((d, i) => (
          <path key={i} d={d} fill="none" strokeWidth={1.6} />
        ))}
      </g>
      {layout.notes.map((n) => {
        const piece = pieceByVoice.get(n.voice);
        const on = onVoices.has(n.voice);
        const gg = on ? guide : 0;
        const color = piece?.color ?? '#999';
        const x = f1(n.x);
        const ny = f1(n.y);
        const d = rx * 0.6;

        return (
          <g key={n.id} data-n={n.index} opacity={!piece ? 0.2 : on ? 1 : 0.4}>
            {n.cymbal ? (
              <>
                {gg > 0 && (
                  <circle
                    cx={x}
                    cy={ny}
                    r={f1(rx + 1)}
                    fill={color}
                    stroke={INK}
                    strokeOpacity={0.4}
                    opacity={gg}
                  />
                )}
                <path
                  d={`M${f1(n.x - d)} ${f1(n.y - d)}L${f1(n.x + d)} ${f1(
                    n.y + d,
                  )}M${f1(n.x - d)} ${f1(n.y + d)}L${f1(n.x + d)} ${f1(
                    n.y - d,
                  )}`}
                  stroke={INK}
                  strokeWidth={f1(2.3 + guide)}
                  strokeLinecap="round"
                />
              </>
            ) : (
              <>
                <ellipse
                  cx={x}
                  cy={ny}
                  rx={f1(rx)}
                  ry={f1(ry)}
                  transform={`rotate(-20 ${x} ${ny})`}
                  fill={INK}
                />
                {gg > 0 && (
                  <ellipse
                    cx={x}
                    cy={ny}
                    rx={f1(rx)}
                    ry={f1(ry)}
                    transform={`rotate(-20 ${x} ${ny})`}
                    fill={color}
                    stroke={INK}
                    strokeWidth={1.2}
                    opacity={gg}
                  />
                )}
              </>
            )}
          </g>
        );
      })}
      <g opacity={showCounts && guide > 0 ? 1 : 0}>
        {layout.counts.map((c, i) => (
          <text
            key={i}
            data-c={i}
            x={f1(c.x)}
            y={f1(countY)}
            textAnchor="middle"
            fontSize={c.beat ? 15 : 12}
            fontWeight={c.beat ? 700 : 500}
            fill={c.beat ? COUNT_BEAT : COUNT_SUB}
          >
            {c.label}
          </text>
        ))}
      </g>
      <g>
        {layout.notes.map((n) => (
          <g key={n.id}>
            <circle
              data-m={n.index}
              cx={f1(n.x)}
              cy={f1(layout.markY)}
              r={3.6}
              fill={MISS_COLOR}
              opacity={0}
            />
            <circle
              data-r={n.index}
              cx={f1(n.x)}
              cy={f1(n.y)}
              r={13}
              fill="none"
              stroke={MISS_COLOR}
              strokeWidth={2}
              opacity={0}
            />
          </g>
        ))}
      </g>
      <g ref={playheadRef} opacity={0}>
        <rect
          x={-12}
          y={f1(top - 6)}
          width={24}
          height={f1(bot - top + 12)}
          fill={PLAYHEAD}
          fillOpacity={0.08}
        />
        <line
          x1={0}
          x2={0}
          y1={f1(top - 6)}
          y2={f1(bot + 6)}
          stroke={PLAYHEAD}
          strokeWidth={2.5}
        />
      </g>
    </svg>
  );
}
