import { describe, expect, it } from 'vitest';
import { DEFAULT_KITS, KIT_GRID, PIECE_TYPES } from './constants';
import { collisionRadius, isCymbal } from './geometry';
import { layoutStandard, layoutTidy } from './layout';
import { Kit, KitPiece, PiecePositions, PieceType } from './types';

function piece(
  id: string,
  type: PieceType,
  x: number,
  y: number,
  size = PIECE_TYPES[type].size,
): KitPiece {
  return {
    id,
    type,
    name: id,
    size,
    x,
    y,
    voices: [...PIECE_TYPES[type].voices],
    color: '#fff',
  };
}

function place(pieces: KitPiece[], positions: PiecePositions): KitPiece[] {
  return pieces.map((p) => ({ ...p, ...positions[p.id] }));
}

function onGrid(value: number): boolean {
  const steps = value / KIT_GRID;

  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Pairs on the same layer (drums or cymbals) closer than their radii allow. */
function overlaps(pieces: KitPiece[]): [string, string][] {
  const out: [string, string][] = [];

  for (let a = 0; a < pieces.length; a += 1) {
    for (let b = a + 1; b < pieces.length; b += 1) {
      const A = pieces[a];
      const B = pieces[b];

      if (isCymbal(A.type) !== isCymbal(B.type)) {
        continue;
      }

      const d = Math.hypot(B.x - A.x, B.y - A.y);

      if (d < collisionRadius(A) + collisionRadius(B)) {
        out.push([A.id, B.id]);
      }
    }
  }

  return out;
}

describe('layoutTidy', () => {
  it('centers the kit on the kick at x = 50', () => {
    const pieces = [
      piece('kk', 'kick', 38, 60, 14),
      piece('sn', 'snare', 26, 62, 10),
      piece('ft', 'floor', 52, 62, 10),
      piece('hh', 'hihat', 14, 45, 10),
    ];
    const out = layoutTidy(pieces);

    expect(out.kk.x).toBe(50);
  });

  it('snaps every piece to the 2.5 grid', () => {
    const out = layoutTidy(DEFAULT_KITS[0].pieces);

    for (const pos of Object.values(out)) {
      expect(onGrid(pos.x)).toBe(true);
      expect(onGrid(pos.y)).toBe(true);
    }
  });

  it('pushes overlapping pieces on the same layer apart', () => {
    const pieces = [
      piece('kk', 'kick', 50, 62, 14),
      piece('t1', 'tom', 44, 36, 10),
      piece('t2', 'tom', 47, 37, 10),
      piece('c1', 'crash', 40, 18, 14),
      piece('c2', 'crash', 42, 19, 14),
    ];

    expect(overlaps(pieces).length).toBeGreaterThan(0);

    const tidied = place(pieces, layoutTidy(pieces));

    expect(overlaps(tidied)).toEqual([]);
  });

  it('lets cymbals hang over drums', () => {
    const pieces = [
      piece('kk', 'kick', 50, 62, 14),
      piece('t1', 'tom', 50, 36, 10),
      piece('c1', 'crash', 50, 36, 14),
    ];
    const out = layoutTidy(pieces);

    expect(Math.hypot(out.t1.x - out.c1.x, out.t1.y - out.c1.y)).toBe(0);
  });

  it('returns nothing for an empty kit', () => {
    expect(layoutTidy([])).toEqual({});
  });
});

describe('layoutStandard', () => {
  const kit = (pieces: KitPiece[], kind: Kit['kind'] = 'electronic'): Kit => ({
    id: 'k',
    name: 'k',
    kind,
    pieces,
    controls: {},
  });

  it('puts the snare left of the kick and the floor tom right of it', () => {
    // Deliberately backwards: snare on the right, floor tom on the left.
    const pieces = [
      piece('kk', 'kick', 20, 30, 16),
      piece('sn', 'snare', 85, 70, 12),
      piece('ft', 'floor', 10, 70, 14),
      piece('hh', 'hihat', 90, 30, 12),
      piece('t1', 'tom', 30, 80, 10),
      piece('cr', 'crash', 60, 80, 14),
    ];

    for (const k of [kit(pieces), kit(pieces, 'acoustic')]) {
      const out = layoutStandard(k);

      expect(out.kk.x).toBe(50);
      expect(out.sn.x).toBeLessThan(out.kk.x);
      expect(out.ft.x).toBeGreaterThan(out.kk.x);
      expect(out.hh.x).toBeLessThan(out.sn.x);
    }
  });

  it('lays out both default kits without same-layer overlaps', () => {
    for (const k of DEFAULT_KITS) {
      const out = layoutStandard(k);

      expect(overlaps(place(k.pieces, out))).toEqual([]);
    }
  });
});
