import { CSSProperties, RefObject } from 'react';
import { hitRadius, KitPieces, KitPiece } from '../../../../kit';
import { usePadStrikes } from '../../hooks';
import { flashPiece } from './fx';
import { laneOwner } from './helpers';
import { Arcade } from './useArcade';

export const TEXT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  pointerEvents: 'none',
};

export const BIG_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};

export const LABEL_STYLE: CSSProperties = {
  ...TEXT_STYLE,
  fontWeight: 600,
  letterSpacing: '.08em',
};

/** A keycap label centered at (x, y), in highway units. */
export function KeyBadge({
  x,
  y,
  label,
}: {
  x: number;
  y: number;
  label: string;
}) {
  if (!label) {
    return null;
  }

  const w = label.length > 1 ? Math.max(9.2, label.length * 1.9 + 1.6) : 4.4;

  return (
    <g
      transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
      style={TEXT_STYLE}
    >
      <rect
        x={-w / 2}
        y={-2}
        width={w}
        height={4}
        rx={1}
        fill="#f2ede1"
        opacity={0.92}
      />
      <text
        fontSize={2.8}
        fontWeight={700}
        fill="#0d0e10"
        textAnchor="middle"
        dominantBaseline="central"
        style={TEXT_STYLE}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * The top-down kit with a flash overlay on every piece; tapping a piece
 * strikes it. Place inside a transformed `<g>`.
 */
export function KitLayer({
  arcade,
  dim = 1,
  showThrone = true,
  showKeys = false,
}: {
  arcade: Arcade;
  dim?: number;
  showThrone?: boolean;
  /** Draw each piece's keyboard key on it (kit units). */
  showKeys?: boolean;
}) {
  const { session, keyLabels } = arcade;

  return (
    <KitPieces
      kit={session.kit}
      dim={dim}
      showThrone={showThrone}
      renderOverlay={(p) => (
        <>
          <circle
            data-flash={p.id}
            r={hitRadius(p) + 1}
            fill="#fff"
            opacity={0}
            style={{ pointerEvents: 'none' }}
          />
          {showKeys && (
            <KeyBadge
              x={0}
              y={p.type === 'kick' ? 0 : hitRadius(p) * 0.35}
              label={keyLabels.get(p.id) ?? ''}
            />
          )}
        </>
      )}
      pieceProps={(p) => ({
        style: { cursor: p.voices.length ? 'pointer' : undefined },
        onPointerDown: p.voices.length
          ? () => session.strikePiece(p)
          : undefined,
      })}
    />
  );
}

/**
 * Lights the struck pad (and the lane it feeds, if a different piece) on
 * every strike, judged or not.
 */
export function useStrikeFlash(
  arcade: Arcade,
  rootRef: RefObject<Element | null>,
  onStrike?: (piece: KitPiece, owner: KitPiece | undefined) => void,
): void {
  usePadStrikes(arcade.session, (piece) => {
    if (!piece) {
      return;
    }

    const owner = laneOwner(piece, arcade.lanes);

    flashPiece(rootRef.current, piece.id);

    if (owner && owner.id !== piece.id) {
      flashPiece(rootRef.current, owner.id);
    }

    onStrike?.(piece, owner);
  });
}

export const ERROR_TICKS = 22;

/**
 * The early / late strip: a dark track, the Great and Perfect zones and a
 * rolling row of ticks (drawn by `ErrorTicks`) in a group scaled so its
 * inner half-width is always 16.
 */
export function ErrorMeter({
  x,
  y,
  halfWidth,
  height,
  windowMs,
  ticksRef,
  track = 'var(--color-fill-strong)',
  ink = '#f2ede1',
  labelColor = '#a99fc7',
  labelSize = 2,
}: {
  x: number;
  y: number;
  halfWidth: number;
  height: number;
  windowMs: number;
  ticksRef: RefObject<SVGGElement | null>;
  track?: string;
  ink?: string;
  labelColor?: string;
  labelSize?: number;
}) {
  const zone = (ms: number) =>
    Math.min(1, ms / Math.max(1, windowMs)) * halfWidth;
  const h = height;

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-halfWidth}
        y={-h / 2}
        width={2 * halfWidth}
        height={h}
        rx={h / 2}
        fill={track}
      />
      <rect
        x={-zone(50)}
        y={-h / 2}
        width={2 * zone(50)}
        height={h}
        fill="#9ff0b8"
        opacity={0.16}
      />
      <rect
        x={-zone(25)}
        y={-h / 2}
        width={2 * zone(25)}
        height={h}
        fill="#ffe9a8"
        opacity={0.28}
      />
      <line
        x1={0}
        x2={0}
        y1={-h / 2 - 1}
        y2={h / 2 + 1}
        stroke={ink}
        strokeWidth={0.3}
      />
      <text
        x={-halfWidth}
        y={-h / 2 - 1.4}
        fontSize={labelSize}
        fill={labelColor}
        style={LABEL_STYLE}
      >
        EARLY
      </text>
      <text
        x={halfWidth}
        y={-h / 2 - 1.4}
        fontSize={labelSize}
        fill={labelColor}
        textAnchor="end"
        style={LABEL_STYLE}
      >
        LATE
      </text>
      <g ref={ticksRef} transform={`scale(${halfWidth / 16} 1)`}>
        {Array.from({ length: ERROR_TICKS }, (_, i) => (
          <rect
            key={i}
            x={0}
            y={-h / 2 - 0.6}
            width={0.7}
            height={h + 1.2}
            rx={0.3}
            opacity={0}
          />
        ))}
      </g>
    </g>
  );
}

/** A pool of `count` copies of a gem, hidden until placed by `GemPools`. */
export function GemPool({
  id,
  count,
  register,
  children,
}: {
  id: string;
  count: number;
  register: (id: string, el: Element | null) => void;
  children: React.ReactNode;
}) {
  return (
    <g ref={(el) => register(id, el)}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i} display="none">
          {children}
        </g>
      ))}
    </g>
  );
}
