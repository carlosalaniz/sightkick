import { useEffect, useMemo, useRef, useState } from 'react';
import { assertNever } from '../../../../../shared/assertNever';
import { firstNoteAtOrAfter, TimelineNote, VOICE_INFO } from '../../../../kit';
import { useAnimationFrame } from '../../hooks';
import { barIndexAt, sectionIndexAt } from './helpers';
import { makeSvg, setAttr } from './fx';
import {
  ArcadeGrade,
  MISS_SHEET_COLOR,
  ScoringRules,
  tierById,
} from './scoring';
import { Arcade } from './useArcade';

const SX0 = 56;
const BARW = 234;
const BARS = 4;
const INK = '#1c1a14';
const ACCENT = '#d54b30';
/** Staff y of a voice step: the bottom line is y 62, each step is half a space. */
const stepY = (step: number) => 62 - step * 4;

/** Bars on one strip page: aligned to the loop start when looping, else to bar 1. */
export function pageStartFor(bar: number, origin: number): number {
  if (bar < origin) {
    return origin;
  }

  return origin + Math.floor((bar - origin) / BARS) * BARS;
}

interface Head {
  note: TimelineNote;
  x: number;
  y: number;
  color: string;
  playable: boolean;
}

/**
 * The current 4 bars as a simple drum staff: noteheads at each voice's staff
 * step (x-heads for cymbals) in the piece's color, a playhead, a highlight on
 * the bar being played and a hit / miss mark under each judged note.
 */
export function SheetStrip({ arcade }: { arcade: Arcade }) {
  const { session, log, rules, sections, loopIdx } = arcade;
  const { bars, notes, pieceByVoice } = session;
  const origin =
    loopIdx === undefined ? 0 : barIndexAt(bars, sections[loopIdx]?.start ?? 0);
  const [page, setPage] = useState(origin);
  const playheadRef = useRef<SVGLineElement>(null);
  const highlightRef = useRef<SVGRectElement>(null);
  const marksRef = useRef<SVGGElement>(null);
  const pageBars = useMemo(() => bars.slice(page, page + BARS), [bars, page]);
  const heads = useMemo(() => {
    if (pageBars.length === 0) {
      return [];
    }

    const out: Head[] = [];
    const last = pageBars[pageBars.length - 1];

    for (
      let i = firstNoteAtOrAfter(notes, pageBars[0].start - 1e-6);
      i < notes.length && notes[i].measureIdx <= last.measureIdx;
      i += 1
    ) {
      const note = notes[i];
      const b = note.measureIdx - page;
      const bar = pageBars[b];

      if (!bar) {
        continue;
      }

      const span = Math.max(1, bar.endTick - bar.startTick);
      const piece = pieceByVoice.get(note.voice);

      out.push({
        note,
        x:
          SX0 +
          b * BARW +
          22 +
          ((note.tick - bar.startTick) / span) * (BARW - 40),
        y: stepY(VOICE_INFO[note.voice].step),
        color: piece?.color ?? INK,
        playable: Boolean(piece),
      });
    }

    return out;
  }, [notes, pageBars, page, pieceByVoice]);
  const stems = useMemo(() => {
    const byTick = new Map<number, Head[]>();

    for (const h of heads) {
      const list = byTick.get(h.note.tick) ?? [];

      list.push(h);
      byTick.set(h.note.tick, list);
    }

    return [...byTick.values()].map((hs) => {
      const hands = hs.filter((h) => h.note.voice !== 'kick');

      return {
        key: hs[0].note.tick,
        x: hs[0].x,
        handLow: hands.length ? Math.max(...hands.map((h) => h.y)) : undefined,
        kick: hs.some((h) => h.note.voice === 'kick'),
      };
    });
  }, [heads]);

  // Marks under judged notes, redrawn when the page or the log changes.
  useEffect(() => {
    const draw = () => {
      const g = marksRef.current;

      if (!g) {
        return;
      }

      g.replaceChildren();

      for (const h of heads) {
        const j = log.get(h.note.id);

        if (!j) {
          continue;
        }

        const { grade } = j;
        const miss = grade.kind === 'miss';

        makeSvg(
          'circle',
          {
            cx: h.x.toFixed(1),
            cy: 94,
            r: 2.8,
            fill: sheetMarkColor(rules, grade),
          },
          g,
        );

        if (miss) {
          makeSvg(
            'circle',
            {
              cx: h.x.toFixed(1),
              cy: h.y,
              r: 7,
              fill: 'none',
              stroke: MISS_SHEET_COLOR,
              'stroke-width': 1.4,
            },
            g,
          );
        }
      }
    };

    draw();

    return log.subscribe(draw);
  }, [heads, log, rules]);

  useAnimationFrame(session, (now) => {
    if (bars.length === 0) {
      return;
    }

    const idx = barIndexAt(bars, now);
    const next = pageStartFor(idx, origin);

    if (next !== page) {
      setPage(next);

      return;
    }

    const bar = bars[idx];
    const b = idx - page;
    const on = now >= bar.start && now < bar.end && b >= 0 && b < BARS;

    setAttr(playheadRef.current, 'opacity', on ? 1 : 0);
    setAttr(highlightRef.current, 'opacity', on ? 1 : 0);

    if (on) {
      const frac = (now - bar.start) / Math.max(1e-6, bar.end - bar.start);
      const x = (SX0 + b * BARW + 22 + frac * (BARW - 40)).toFixed(1);

      setAttr(playheadRef.current, 'x1', x);
      setAttr(playheadRef.current, 'x2', x);
      setAttr(highlightRef.current, 'x', SX0 + b * BARW);
    }
  });

  const first = pageBars[0];
  const label = first
    ? `${
        sections.length
          ? sections[sectionIndexAt(sections, first.start)].name
          : ''
      } · Bars ${page + 1}–${page + pageBars.length}`.replace(/^ · /, '')
    : '';

  return (
    <div
      className="rounded-md overflow-x-auto bg-paper"
      style={{ boxShadow: 'var(--shadow-paper)' }}
    >
      <svg
        viewBox="0 0 1000 108"
        className="block w-full h-auto min-w-[640px]"
        aria-label="Sheet music for the current bars"
        role="img"
      >
        <rect
          ref={highlightRef}
          x={SX0}
          y={4}
          width={BARW}
          height={84}
          fill={ACCENT}
          fillOpacity={0.07}
          opacity={0}
        />
        <text
          x={SX0 + 6}
          y={104}
          fontSize={10}
          fontWeight={700}
          fill="#8c8577"
          style={{ fontFamily: 'var(--font-ui)', textTransform: 'uppercase' }}
        >
          {label}
        </text>
        <rect x={24} y={38} width={4} height={16} fill="#c46a2a" />
        <rect x={32} y={38} width={4} height={16} fill="#c46a2a" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={16}
            x2={SX0 + BARS * BARW}
            y1={62 - i * 8}
            y2={62 - i * 8}
            stroke={INK}
            strokeOpacity={0.35}
            strokeWidth={0.9}
          />
        ))}
        {Array.from({ length: pageBars.length + 1 }, (_, b) => (
          <line
            key={b}
            x1={SX0 + b * BARW}
            x2={SX0 + b * BARW}
            y1={30}
            y2={62}
            stroke={INK}
            strokeWidth={b === BARS ? 2.4 : 1}
          />
        ))}
        {stems.map((s) => (
          <g key={s.key}>
            {s.handLow !== undefined && (
              <line
                x1={s.x + 4.2}
                x2={s.x + 4.2}
                y1={s.handLow}
                y2={8}
                stroke={INK}
                strokeWidth={1.1}
              />
            )}
            {s.kick && (
              <line
                x1={s.x - 4.2}
                x2={s.x - 4.2}
                y1={stepY(1)}
                y2={86}
                stroke={INK}
                strokeWidth={1.1}
              />
            )}
          </g>
        ))}
        {heads.map(({ note, x, y, color, playable }) => {
          const op = playable ? 1 : 0.3;
          const step = VOICE_INFO[note.voice].step;
          const d = `M${x - 3.4} ${y - 3.4}L${x + 3.4} ${y + 3.4}M${x + 3.4} ${
            y - 3.4
          }L${x - 3.4} ${y + 3.4}`;

          return (
            <g key={note.id} opacity={op}>
              {step >= 10 && (
                <line
                  x1={x - 7}
                  x2={x + 7}
                  y1={stepY(10)}
                  y2={stepY(10)}
                  stroke={INK}
                  strokeWidth={0.9}
                />
              )}
              {VOICE_INFO[note.voice].cymbal ? (
                <>
                  <path
                    d={d}
                    stroke={INK}
                    strokeWidth={3.4}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    stroke={color}
                    strokeWidth={1.7}
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <ellipse
                  cx={x}
                  cy={y}
                  rx={4.4}
                  ry={3.1}
                  transform={`rotate(-20 ${x} ${y})`}
                  fill={color}
                  stroke={INK}
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}
        <g ref={marksRef} />
        <line
          ref={playheadRef}
          x1={SX0}
          x2={SX0}
          y1={4}
          y2={88}
          stroke={ACCENT}
          strokeWidth={2}
          opacity={0}
        />
      </svg>
    </div>
  );
}

function sheetMarkColor(rules: ScoringRules, grade: ArcadeGrade): string {
  switch (grade.kind) {
    case 'hit':
      return tierById(rules, grade.tier).sheetColor;

    case 'miss':
      return MISS_SHEET_COLOR;

    default:
      return assertNever(grade, 'arcade grade');
  }
}
