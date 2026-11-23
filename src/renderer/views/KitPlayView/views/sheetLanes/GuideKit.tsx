import { useEffect, useRef } from 'react';
import { hitRadius, Kit, KitPiece, KitSvg } from '../../../../kit';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface PieceEls {
  piece: KitPiece;
  glow: SVGCircleElement;
  flash: SVGCircleElement;
  rings: SVGGElement;
  /** Last written glow values, to skip no-op attribute writes. */
  r: number;
  op: number;
}

/**
 * Imperative handle on the kit drawing: closing glow rings before a hit, a
 * colored ring on each judged note and a flash on every strike.
 */
export class KitGlow {
  private els = new Map<string, PieceEls>();

  constructor(private reduced: boolean) {}

  attach(svg: SVGSVGElement | null, kit: Kit): void {
    this.els.clear();

    if (!svg) {
      return;
    }

    for (const piece of kit.pieces) {
      const g = svg.querySelector(`[data-piece-id="${CSS.escape(piece.id)}"]`);
      const glow = g?.querySelector<SVGCircleElement>('[data-glow]');
      const flash = g?.querySelector<SVGCircleElement>('[data-flash]');
      const rings = g?.querySelector<SVGGElement>('[data-rings]');

      if (glow && flash && rings) {
        this.els.set(piece.id, { piece, glow, flash, rings, r: -1, op: -1 });
      }
    }
  }

  /** Sets each piece's glow: `u` is beats until its next note (0–1), or undefined. */
  glow(level: number, near: Map<string, number>): void {
    for (const [id, e] of this.els) {
      const u = near.get(id);
      const op =
        u === undefined || level <= 0
          ? 0
          : Math.round(level * (1 - u) * 1000) / 1000;
      const r =
        u === undefined
          ? e.r
          : Math.round((hitRadius(e.piece) + 1.6 + u * 5) * 100) / 100;

      if (op !== e.op) {
        e.op = op;
        e.glow.setAttribute('opacity', String(op));
      }

      if (r !== e.r) {
        e.r = r;
        e.glow.setAttribute('r', String(r));
      }
    }
  }

  /** A ring in the judgment color that fades out. */
  ring(pieceId: string, color: string): void {
    const e = this.els.get(pieceId);

    if (!e || this.reduced) {
      return;
    }

    const el = document.createElementNS(SVG_NS, 'circle');

    el.setAttribute('r', String(hitRadius(e.piece) + 1.4));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1.6');
    e.rings.appendChild(el);

    if (typeof el.animate === 'function') {
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420 });

      a.onfinish = () => el.remove();
    } else {
      setTimeout(() => el.remove(), 420);
    }
  }

  flash(pieceId: string): void {
    const e = this.els.get(pieceId);

    if (e && typeof e.flash.animate === 'function') {
      e.flash.animate([{ opacity: 0.7 }, { opacity: 0 }], {
        duration: this.reduced ? 1 : 260,
      });
    }
  }
}

export function GuideKit({
  kit,
  glow,
  onStrike,
}: {
  kit: Kit;
  glow: KitGlow;
  onStrike: (piece: KitPiece) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    glow.attach(svgRef.current, kit);

    return () => glow.attach(null, kit);
  }, [glow, kit]);

  return (
    <KitSvg
      kit={kit}
      showLabels
      className="block w-full h-auto max-h-[320px]"
      ariaLabel="Your kit: pads glow before you hit them and flash when you do; click a pad to hit it"
      svgProps={{ ref: svgRef }}
      renderOverlay={(p) => (
        <>
          <circle
            data-glow=""
            r={hitRadius(p) + 1.6}
            fill="none"
            stroke={p.color}
            strokeWidth={1.2}
            opacity={0}
            pointerEvents="none"
          />
          <circle
            data-flash=""
            r={hitRadius(p)}
            fill="#fff"
            opacity={0}
            pointerEvents="none"
          />
          <g data-rings="" pointerEvents="none" />
        </>
      )}
      pieceProps={(p) =>
        p.voices.length > 0
          ? {
              style: { cursor: 'pointer' },
              onPointerDown: (e) => {
                e.preventDefault();
                onStrike(p);
              },
            }
          : {}
      }
    />
  );
}
