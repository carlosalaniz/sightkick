import { ReactNode, SVGProps } from 'react';
import { KIT_HEIGHT, KIT_VIEWBOX, KIT_WIDTH, PIECE_TYPES } from './constants';
import { byDrawOrder, hitRadius, pieceRadius } from './geometry';
import { Kit, KitKind, KitPiece, PieceType } from './types';

/**
 * Gradients and patterns every kit drawing references. Mounted once by
 * `KitProvider`; kept in a zero-size SVG (not display:none) so they resolve.
 */
export function KitDefs() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="skBronze" cx="45%" cy="42%" r="65%">
          <stop offset="0" stopColor="#f0d38a" />
          <stop offset=".55" stopColor="#c99a45" />
          <stop offset="1" stopColor="#8c6424" />
        </radialGradient>
        <radialGradient id="skBell" cx="40%" cy="38%" r="70%">
          <stop offset="0" stopColor="#f6dfa0" />
          <stop offset="1" stopColor="#a77a30" />
        </radialGradient>
        <radialGradient id="skEcym" cx="42%" cy="40%" r="70%">
          <stop offset="0" stopColor="#2c2c31" />
          <stop offset="1" stopColor="#141416" />
        </radialGradient>
        <linearGradient id="skChrome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef1f4" />
          <stop offset=".5" stopColor="#9da3ab" />
          <stop offset="1" stopColor="#d9dde2" />
        </linearGradient>
        <radialGradient id="skHead" cx="45%" cy="40%" r="70%">
          <stop offset="0" stopColor="#fbf9f4" />
          <stop offset="1" stopColor="#e2ddd2" />
        </radialGradient>
        <radialGradient id="skMesh" cx="45%" cy="40%" r="70%">
          <stop offset="0" stopColor="#f3efe8" />
          <stop offset="1" stopColor="#d9d3c9" />
        </radialGradient>
        <linearGradient id="skShell" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#173a78" />
          <stop offset=".5" stopColor="#2f62b8" />
          <stop offset="1" stopColor="#173a78" />
        </linearGradient>
        <pattern id="skGrid" width="5" height="5" patternUnits="userSpaceOnUse">
          <path
            d="M5 0H0V5"
            fill="none"
            stroke="rgba(255,255,255,.05)"
            strokeWidth=".25"
          />
        </pattern>
        <pattern
          id="skGridMajor"
          width="25"
          height="26"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M25 0H0V26"
            fill="none"
            stroke="rgba(255,255,255,.1)"
            strokeWidth=".3"
          />
        </pattern>
      </defs>
    </svg>
  );
}

function Pedal({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-2.3}
        y={-5.5}
        width={4.6}
        height={11}
        rx={1.3}
        fill="url(#skChrome)"
        stroke="#000"
        strokeOpacity={0.5}
        strokeWidth={0.3}
      />
      <rect x={-1.5} y={-4.3} width={3} height={6} rx={0.8} fill="#26262a" />
      <rect x={-2.3} y={4.2} width={4.6} height={1.3} rx={0.6} fill={color} />
    </g>
  );
}

function wedge(r: number, a0: number, a1: number): string {
  const x0 = Math.cos(a0) * r;
  const y0 = Math.sin(a0) * r;
  const x1 = Math.cos(a1) * r;
  const y1 = Math.sin(a1) * r;

  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(
    2,
  )} ${y1.toFixed(2)} Z`;
}

function ring(count: number, radius: number, offset: number) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + offset;

    return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
  });
}

/** The drawing of one piece, centered on (0, 0), in kit units. */
export function PieceBody({
  piece,
  kind,
}: {
  piece: Pick<KitPiece, 'type' | 'size' | 'color'>;
  kind: KitKind;
}) {
  const info = PIECE_TYPES[piece.type];
  const r = pieceRadius(piece);
  const c = piece.color;

  if (info.pedal) {
    return <Pedal x={0} y={0} color={c} />;
  }

  if (piece.type === 'kick') {
    if (kind === 'acoustic') {
      const h = r * 1.15;

      return (
        <>
          <rect
            x={-r}
            y={-h / 2}
            width={2 * r}
            height={h}
            rx={1.2}
            fill="url(#skShell)"
            stroke={c}
            strokeWidth={0.9}
          />
          <rect
            x={-r}
            y={-h / 2 - 0.8}
            width={2 * r}
            height={1.6}
            rx={0.6}
            fill="url(#skChrome)"
          />
          <rect
            x={-r}
            y={h / 2 - 0.8}
            width={2 * r}
            height={1.6}
            rx={0.6}
            fill="url(#skChrome)"
          />
          <Pedal x={0} y={h / 2 + 6.2} color={c} />
        </>
      );
    }

    const w = r * 1.7;
    const h = r * 1.2;

    return (
      <>
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={1.4}
          fill="#1b1b1e"
          stroke={c}
          strokeWidth={0.9}
        />
        <ellipse
          cx={0}
          cy={h / 2 - 1.3}
          rx={w / 2 - 1.3}
          ry={1.5}
          fill="url(#skMesh)"
        />
        <Pedal x={0} y={h / 2 + 6.2} color={c} />
      </>
    );
  }

  if (!info.cymbal) {
    return (
      <>
        {kind === 'acoustic' ? (
          <>
            {ring(8, r + 0.5, 0.2).map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={0.55} fill="#b9bec5" />
            ))}
            <circle r={r} fill="url(#skChrome)" />
            <circle r={r - 0.9} fill="url(#skHead)" />
          </>
        ) : (
          <>
            <circle r={r} fill="#141416" />
            <circle
              r={r - 0.75}
              fill="none"
              stroke="#ff8a80"
              strokeOpacity={0.8}
              strokeWidth={0.55}
            />
            <circle r={r - 1.25} fill="url(#skMesh)" />
            {ring(6, r - 0.35, 0.5).map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={0.3} fill="#777" />
            ))}
          </>
        )}
        <circle r={r + 1.3} fill="none" stroke={c} strokeWidth={0.9} />
      </>
    );
  }

  return (
    <>
      {kind === 'acoustic' ? (
        <>
          <circle
            r={r}
            fill="url(#skBronze)"
            stroke="#6b4a18"
            strokeWidth={0.25}
          />
          {[0.85, 0.68, 0.5].map((k) => (
            <circle
              key={k}
              r={r * k}
              fill="none"
              stroke="#5a3c10"
              strokeOpacity={0.22}
              strokeWidth={0.18}
            />
          ))}
          <circle r={r * 0.24} fill="url(#skBell)" />
        </>
      ) : (
        <>
          <circle r={r} fill="url(#skEcym)" stroke="#000" strokeWidth={0.3} />
          <path d={wedge(r, -2.4, -0.7)} fill="#34343a" opacity={0.8} />
          <circle r={r * 0.26} fill="#0f0f11" />
        </>
      )}
      {piece.type === 'hihat' && <circle r={1.3} fill="#9aa1a8" />}
      <circle r={0.6} fill="#0b0b0b" />
      <circle r={r + 1.1} fill="none" stroke={c} strokeWidth={0.9} />
    </>
  );
}

export interface KitPiecesProps {
  kit: Kit;
  /** Opacity of the drawings (overlays stay at full opacity). */
  dim?: number;
  showThrone?: boolean;
  showLabels?: boolean;
  showGrid?: boolean;
  /** Per-piece overlay drawn above the piece body, in piece-local coordinates. */
  renderOverlay?: (piece: KitPiece) => ReactNode;
  /** Per-piece label text override (defaults to the piece name). */
  labelFor?: (piece: KitPiece) => string;
  pieceProps?: (piece: KitPiece) => SVGProps<SVGGElement>;
}

/**
 * The top-down kit drawing as SVG children; place inside an `<svg>` with
 * `viewBox={KIT_VIEWBOX}`, or inside a transformed `<g>`. Each piece is a
 * `<g data-piece-id>` translated to its position.
 */
export function KitPieces({
  kit,
  dim = 1,
  showThrone = true,
  showLabels = false,
  showGrid = false,
  renderOverlay,
  labelFor,
  pieceProps,
}: KitPiecesProps) {
  return (
    <>
      {showGrid && (
        <>
          <rect width={KIT_WIDTH} height={KIT_HEIGHT} fill="url(#skGrid)" />
          <rect
            width={KIT_WIDTH}
            height={KIT_HEIGHT}
            fill="url(#skGridMajor)"
          />
          <line
            x1={50}
            x2={50}
            y1={0}
            y2={KIT_HEIGHT}
            stroke="var(--color-text-muted)"
            strokeOpacity={0.35}
            strokeWidth={0.3}
            strokeDasharray="1.5 1.5"
          />
        </>
      )}
      {showThrone && (
        <g opacity={dim}>
          <circle
            cx={50}
            cy={96}
            r={8}
            fill="#232326"
            stroke="#000"
            strokeWidth={0.4}
          />
          <circle
            cx={50}
            cy={96}
            r={5.5}
            fill="none"
            stroke="#000"
            strokeOpacity={0.35}
            strokeWidth={0.3}
          />
        </g>
      )}
      {byDrawOrder(kit.pieces).map((p) => (
        <g
          key={p.id}
          data-piece-id={p.id}
          transform={`translate(${p.x} ${p.y})`}
          {...pieceProps?.(p)}
        >
          <g opacity={dim}>
            <PieceBody piece={p} kind={kit.kind} />
          </g>
          {renderOverlay?.(p)}
          {showLabels && (
            <text
              y={labelY(p, kit.kind)}
              textAnchor="middle"
              fontSize={2.6}
              fontWeight={600}
              fill="var(--color-text)"
              stroke="#0d0e10"
              strokeWidth={0.8}
              paintOrder="stroke"
              style={{ pointerEvents: 'none', fontFamily: 'var(--font-ui)' }}
            >
              {labelFor ? labelFor(p) : p.name}
            </text>
          )}
        </g>
      ))}
    </>
  );
}

function labelY(p: KitPiece, kind: KitKind): number {
  if (p.type === 'kick') {
    return kind === 'acoustic' ? 0.9 : -0.5;
  }

  return p.type === 'hhpedal' ? 8.6 : hitRadius(p) + 4.4;
}

/** A standalone kit drawing. */
export function KitSvg({
  className,
  ariaLabel = 'Top-down view of the kit',
  children,
  svgProps,
  ...props
}: KitPiecesProps & {
  className?: string;
  ariaLabel?: string;
  /** Extra SVG children drawn above the kit. */
  children?: ReactNode;
  svgProps?: SVGProps<SVGSVGElement>;
}) {
  return (
    <svg
      viewBox={KIT_VIEWBOX}
      className={className}
      aria-label={ariaLabel}
      role="img"
      {...svgProps}
    >
      <KitPieces {...props} />
      {children}
    </svg>
  );
}

/** A small icon of a piece type, for palettes. */
export function PieceTypeIcon({
  type,
  kind,
  className,
}: {
  type: PieceType;
  kind: KitKind;
  className?: string;
}) {
  const piece = { type, size: PIECE_TYPES[type].size, color: '#8a8474' };
  let r = pieceRadius(piece) + 1.4;

  if (type === 'hhpedal') {
    r = 6;
  }

  const viewBox =
    type === 'kick'
      ? '-16 -16 32 36'
      : `${-r - 1} ${-r - 1} ${2 * r + 2} ${2 * r + 2}`;

  return (
    <svg viewBox={viewBox} className={className} aria-hidden="true">
      <PieceBody piece={piece} kind={kind} />
    </svg>
  );
}

/** Converts a pointer event to kit coordinates of the given SVG. */
export function svgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();

  if (!ctm) {
    return { x: 0, y: 0 };
  }

  const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());

  return { x: pt.x, y: pt.y };
}
