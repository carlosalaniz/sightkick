import { RefObject, useRef } from 'react';
import {
  hitRadius,
  KitPiece,
  KitSvg,
  TimelineNote,
  Voice,
} from '../../../../kit';
import { useAnimationFrame } from '../../hooks';
import { PlaySession } from '../../session';

/** Pad flashes, written by the view's event handlers and drawn here per frame. */
export interface KitFlashes {
  /** Piece id → `performance.now()` of the last strike (yours or the track's). */
  strikes: Map<string, number>;
  /** Piece id → last judged hit, ringed in its timing color. */
  judged: Map<string, { at: number; color: string }>;
}

const STRIKE_MS = 280;
const JUDGED_MS = 420;

interface PieceEls {
  flash?: SVGCircleElement | null;
  judged?: SVGCircleElement | null;
  approach?: SVGCircleElement | null;
}

export interface LessonKitProps {
  session: PlaySession;
  /** The window's notes, sorted by time. */
  notes: TimelineNote[];
  /** Voices whose upcoming notes get an approach ring. */
  ringVoices: Set<Voice>;
  /** Voices the track plays this step: their pads flash as notes pass. */
  trackVoices: Set<Voice>;
  /** Approach ring strength, 0–1. */
  hints: number;
  /** Seconds of look-ahead for the approach rings (one beat). */
  lookahead: number;
  /** Ids of notes already hit this pass (their rings stop). */
  hitIds: RefObject<{ hits: Map<string, number> }>;
  flashes: RefObject<KitFlashes>;
  usedPieceIds: Set<string>;
}

/**
 * The kit beside the staff: rings close in on a pad just before a note, pads
 * flash when struck, and clicking a pad strikes it.
 */
export function LessonKit({
  session,
  notes,
  ringVoices,
  trackVoices,
  hints,
  lookahead,
  hitIds,
  flashes,
  usedPieceIds,
}: LessonKitProps) {
  const els = useRef(new Map<string, PieceEls>());
  const cursor = useRef({ index: 0, last: -Infinity });
  const bind =
    (id: string, part: keyof PieceEls) => (el: SVGCircleElement | null) => {
      const entry = els.current.get(id) ?? {};

      entry[part] = el;
      els.current.set(id, entry);
    };

  useAnimationFrame(session, (now) => {
    const ms = performance.now();
    const { strikes, judged } = flashes.current;
    const hits = hitIds.current.hits;
    const c = cursor.current;

    // Notes the track plays flash their pad as they pass.
    if (now < c.last - 0.05) {
      c.index = 0;

      while (c.index < notes.length && notes[c.index].time < now) {
        c.index += 1;
      }
    }

    c.last = now;

    while (c.index < notes.length && notes[c.index].time <= now) {
      const n = notes[c.index];

      c.index += 1;

      if (session.isPlaying && trackVoices.has(n.voice) && now - n.time < 0.1) {
        const piece = session.pieceByVoice.get(n.voice);

        if (piece) {
          strikes.set(piece.id, ms);
        }
      }
    }

    const near = new Map<string, number>();

    if (hints > 0) {
      for (let i = c.index; i < notes.length; i += 1) {
        const n = notes[i];
        const d = (n.time - now) / lookahead;

        if (d > 1) {
          break;
        }

        if (d < 0 || !ringVoices.has(n.voice) || hits.has(n.id)) {
          continue;
        }

        const piece = session.pieceByVoice.get(n.voice);

        if (piece && (!near.has(piece.id) || d < (near.get(piece.id) ?? 1))) {
          near.set(piece.id, d);
        }
      }
    }

    for (const piece of session.kit.pieces) {
      const e = els.current.get(piece.id);

      if (!e) {
        continue;
      }

      const r = hitRadius(piece);
      const d = near.get(piece.id);

      if (e.approach) {
        if (d === undefined) {
          e.approach.setAttribute('opacity', '0');
        } else {
          e.approach.setAttribute('r', (r + 1.6 + d * 5).toFixed(2));
          e.approach.setAttribute('opacity', (hints * (1 - d)).toFixed(2));
        }
      }

      const struck = strikes.get(piece.id);

      e.flash?.setAttribute(
        'opacity',
        struck === undefined
          ? '0'
          : Math.max(0, 0.7 * (1 - (ms - struck) / STRIKE_MS)).toFixed(2),
      );

      const j = judged.get(piece.id);

      if (e.judged) {
        if (j) {
          e.judged.setAttribute('stroke', j.color);
        }

        e.judged.setAttribute(
          'opacity',
          j ? Math.max(0, 1 - (ms - j.at) / JUDGED_MS).toFixed(2) : '0',
        );
      }
    }
  });

  const overlay = (p: KitPiece) => {
    const r = hitRadius(p);

    return (
      <>
        <circle
          ref={bind(p.id, 'flash')}
          r={r + 1}
          fill="#fff"
          opacity={0}
          pointerEvents="none"
        />
        <circle
          ref={bind(p.id, 'judged')}
          r={r + 1.4}
          fill="none"
          strokeWidth={1.6}
          opacity={0}
          pointerEvents="none"
        />
        <circle
          ref={bind(p.id, 'approach')}
          r={r + 1.6}
          fill="none"
          stroke={p.color}
          strokeWidth={1.3}
          opacity={0}
          pointerEvents="none"
        />
      </>
    );
  };

  return (
    <KitSvg
      kit={session.kit}
      showLabels
      className="block w-full h-auto max-h-[320px]"
      ariaLabel="Your kit: rings close in on a pad just before you hit it; click a pad to hit it"
      renderOverlay={overlay}
      pieceProps={(p) => ({
        opacity: usedPieceIds.has(p.id) ? 1 : 0.28,
        style: { cursor: p.voices.length > 0 ? 'pointer' : undefined },
        onPointerDown: (e) => {
          if (p.voices.length > 0) {
            e.preventDefault();
            session.strikePiece(p);
          }
        },
      })}
    />
  );
}
