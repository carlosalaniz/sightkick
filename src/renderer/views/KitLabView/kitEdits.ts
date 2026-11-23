import {
  KIT_GRID,
  Kit,
  KitPiece,
  PIECE_PALETTE,
  PIECE_TYPES,
  PiecePositions,
  PieceType,
  Voice,
  VOICES,
} from '../../kit';

/** Where a piece's center may sit on the stage. */
export const STAGE_BOUNDS = { minX: 3, maxX: 97, minY: 3, maxY: 88 };

/** Undo steps kept per kit. */
export const HISTORY_LIMIT = 60;

export type LayoutHistory = Record<string, PiecePositions[]>;

export function snapToGrid(value: number): number {
  return Math.round(value / KIT_GRID) * KIT_GRID;
}

export function clampToStage(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(STAGE_BOUNDS.minX, Math.min(STAGE_BOUNDS.maxX, x)),
    y: Math.max(STAGE_BOUNDS.minY, Math.min(STAGE_BOUNDS.maxY, y)),
  };
}

export function positionsOf(kit: Kit): PiecePositions {
  return Object.fromEntries(kit.pieces.map((p) => [p.id, { x: p.x, y: p.y }]));
}

/** Moves the pieces named in `positions`; others (and unknown ids) are left alone. */
export function withPositions(kit: Kit, positions: PiecePositions): Kit {
  return {
    ...kit,
    pieces: kit.pieces.map((p) =>
      positions[p.id] ? { ...p, ...positions[p.id] } : p,
    ),
  };
}

export function pushHistory(
  history: LayoutHistory,
  kitId: string,
  snapshot: PiecePositions,
): LayoutHistory {
  return {
    ...history,
    [kitId]: [...(history[kitId] ?? []), snapshot].slice(-HISTORY_LIMIT),
  };
}

const TOM_VOICES: Voice[] = ['tom1', 'tom2', 'tom3'];

/** A new piece of `type` for this kit: a free tom voice, an unused color, a numbered name. */
export function createPiece(kit: Kit, type: PieceType): KitPiece {
  const info = PIECE_TYPES[type];
  let voices = [...info.voices];

  if (type === 'tom') {
    const free = TOM_VOICES.find(
      (v) => !kit.pieces.some((p) => p.voices.includes(v)),
    );

    voices = [free ?? 'tom2'];
  }

  const same = kit.pieces.filter((p) => p.type === type).length;
  const used = new Set(kit.pieces.map((p) => p.color));
  const ids = new Set(kit.pieces.map((p) => p.id));
  const makeId = () => `${type}-${Math.random().toString(36).slice(2, 7)}`;
  let id = makeId();

  while (ids.has(id)) {
    id = makeId();
  }

  return {
    id,
    type,
    name: same > 0 ? `${info.label} ${same + 1}` : info.label,
    size: info.size,
    x: 50,
    y: 40,
    voices,
    color: PIECE_PALETTE.find((c) => !used.has(c)) ?? PIECE_PALETTE[0],
  };
}

export function updatePiece(
  kit: Kit,
  pieceId: string,
  patch: Partial<Omit<KitPiece, 'id'>>,
): Kit {
  return {
    ...kit,
    pieces: kit.pieces.map((p) => (p.id === pieceId ? { ...p, ...patch } : p)),
  };
}

export function removePiece(kit: Kit, pieceId: string): Kit {
  const controls = { ...kit.controls };

  delete controls[pieceId];

  return {
    ...kit,
    pieces: kit.pieces.filter((p) => p.id !== pieceId),
    controls,
  };
}

export function toggleVoice(voices: Voice[], voice: Voice): Voice[] {
  return voices.includes(voice)
    ? voices.filter((v) => v !== voice)
    : [...voices, voice];
}

export function byX(pieces: KitPiece[]): KitPiece[] {
  return [...pieces].sort((a, b) => a.x - b.x);
}

/** Which pieces play each of the 8 chart voices. */
export function voiceCoverage(kit: Kit) {
  return VOICES.map((voice) => ({
    voice,
    pieces: kit.pieces.filter((p) => p.voices.includes(voice.id)),
  }));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The `<g data-piece-id>` of a piece inside a kit drawing. */
export function pieceElement(
  svg: SVGSVGElement | null,
  pieceId: string,
): SVGGElement | undefined {
  if (!svg) {
    return undefined;
  }

  return [...svg.querySelectorAll<SVGGElement>('[data-piece-id]')].find(
    (el) => el.dataset.pieceId === pieceId,
  );
}
