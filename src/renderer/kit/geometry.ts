import { PIECE_TYPES } from './constants';
import { KitPiece, PieceType } from './types';

/** Kit units of radius per inch of diameter. */
export const UNITS_PER_INCH = 0.75;

export function pieceRadius(p: Pick<KitPiece, 'type' | 'size'>): number {
  return p.type === 'hhpedal' ? 4 : p.size * UNITS_PER_INCH;
}

/** Radius of the clickable / flashable area around a piece. */
export function hitRadius(p: Pick<KitPiece, 'type' | 'size'>): number {
  return p.type === 'hhpedal' ? 6.5 : pieceRadius(p);
}

/** Radius used for spacing pieces apart. */
export function collisionRadius(p: Pick<KitPiece, 'type' | 'size'>): number {
  if (p.type === 'kick') {
    return pieceRadius(p) * 0.8;
  }

  return p.type === 'hhpedal' ? 5 : pieceRadius(p);
}

export function isCymbal(type: PieceType): boolean {
  return PIECE_TYPES[type].cymbal;
}

/** Paint order: pedals and kick at the bottom, cymbals on top. */
export const DRAW_ORDER: Record<PieceType, number> = {
  hhpedal: 0,
  kick: 1,
  snare: 2,
  tom: 2,
  floor: 2,
  hihat: 3,
  crash: 3,
  ride: 3,
  splash: 3,
  china: 3,
};

export function byDrawOrder(pieces: KitPiece[]): KitPiece[] {
  return [...pieces].sort((a, b) => DRAW_ORDER[a.type] - DRAW_ORDER[b.type]);
}
