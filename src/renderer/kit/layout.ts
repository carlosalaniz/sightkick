import { KIT_GRID } from './constants';
import { collisionRadius, isCymbal, pieceRadius } from './geometry';
import { Kit, KitKind, KitPiece, PiecePositions } from './types';

const GAP = 2.5;
/**
 * Half the kick's footprint per kit kind, in pad radii: an acoustic kick is
 * drawn as a wide shell, an electronic one as a narrower tower.
 */
const KICK_HALF: Record<KitKind, { w: number; h: number }> = {
  acoustic: { w: 1, h: 0.575 },
  electronic: { w: 0.85, h: 0.6 },
};
const ROW_TOLERANCE = 6;

interface Item {
  p: KitPiece;
  x: number;
  y: number;
}

const layer = (p: KitPiece) => (isCymbal(p.type) ? 'cym' : 'drum');

function alignRows(items: Item[], kick: Item | undefined): void {
  for (const lay of ['cym', 'drum'] as const) {
    const row = items
      .filter(
        (i) =>
          layer(i.p) === lay && i.p.type !== 'kick' && i.p.type !== 'hhpedal',
      )
      .sort((a, b) => a.y - b.y);
    const clusters: Item[][] = [];

    for (const i of row) {
      const c = clusters[clusters.length - 1];

      if (c && i.y - c[c.length - 1].y < ROW_TOLERANCE) {
        c.push(i);
      } else {
        clusters.push([i]);
      }
    }

    for (const c of clusters) {
      const my = c.reduce((s, i) => s + i.y, 0) / c.length;

      c.forEach((i) => {
        i.y = my;
      });
      c.sort((a, b) => a.x - b.x);

      const allOf = (types: string[]) =>
        c.every((i) => types.includes(i.p.type));
      const symmetric =
        c.length > 1 && (allOf(['tom']) || allOf(['crash', 'splash', 'china']));

      if (c.length < 3 && !symmetric) {
        continue;
      }

      const rs = c.map((i) => collisionRadius(i.p));
      let inner = 0;

      for (let j = 0; j < c.length - 1; j += 1) {
        inner += rs[j] + rs[j + 1];
      }

      const gap = Math.max(
        GAP,
        (c[c.length - 1].x - c[0].x - inner) / (c.length - 1),
      );
      const total = rs[0] + inner + gap * (c.length - 1) + rs[c.length - 1];
      const mid =
        symmetric && kick
          ? kick.x
          : (c[0].x - rs[0] + c[c.length - 1].x + rs[c.length - 1]) / 2;
      let x = mid - total / 2 + rs[0];

      c.forEach((i, j) => {
        i.x = x;

        if (j < c.length - 1) {
          x += rs[j] + rs[j + 1] + gap;
        }
      });
    }
  }
}

function pushApart(items: Item[]): void {
  for (let it = 0; it < 100; it += 1) {
    let moved = false;

    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1) {
        const A = items[a];
        const B = items[b];

        if (layer(A.p) !== layer(B.p)) {
          continue;
        }

        let dx = B.x - A.x;
        let dy = B.y - A.y;
        let d = Math.hypot(dx, dy);
        const min = collisionRadius(A.p) + collisionRadius(B.p) + GAP;

        if (d >= min) {
          continue;
        }

        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }

        const push = min - d;
        const ux = dx / d;
        const uy = dy / d;
        let wa = 0.5;

        if (A.p.type === 'kick') {
          wa = 0;
        } else if (B.p.type === 'kick') {
          wa = 1;
        }

        A.x -= ux * push * wa;
        A.y -= uy * push * wa;
        B.x += ux * push * (1 - wa);
        B.y += uy * push * (1 - wa);
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }
}

/**
 * Keeps the user's arrangement but lines up rows, evens out spacing, removes
 * overlaps, centers the kit on the kick and snaps everything to the grid.
 */
export function layoutTidy(pieces: KitPiece[]): PiecePositions {
  return tidyItems(pieces.map((p) => ({ p, x: p.x, y: p.y })));
}

function tidyItems(items: Item[]): PiecePositions {
  if (items.length === 0) {
    return {};
  }

  const kick = items.find((i) => i.p.type === 'kick');

  alignRows(items, kick);
  pushApart(items);

  const left = Math.min(...items.map((i) => i.x - collisionRadius(i.p)));
  const right = Math.max(...items.map((i) => i.x + collisionRadius(i.p)));
  let sx = 50 - (kick ? kick.x : (left + right) / 2);

  if (left + sx < 2) {
    sx = 2 - left;
  } else if (right + sx > 98) {
    sx = 98 - right;
  }

  const top = Math.min(...items.map((i) => i.y - collisionRadius(i.p)));
  const bottom = Math.max(...items.map((i) => i.y + collisionRadius(i.p)));
  let sy = 0;

  if (top < 3) {
    sy = 3 - top;
  } else if (bottom > 86) {
    sy = 86 - bottom;
  }

  const out: PiecePositions = {};

  for (const i of items) {
    out[i.p.id] = {
      x: Math.round((i.x + sx) / KIT_GRID) * KIT_GRID,
      y: Math.round((i.y + sy) / KIT_GRID) * KIT_GRID,
    };
  }

  return out;
}

/** Rebuilds the kit as a standard right-handed layout, then tidies it. */
export function layoutStandard(kit: Kit): PiecePositions {
  const items: Item[] = kit.pieces.map((p) => ({ p, x: p.x, y: p.y }));
  const by = (...types: string[]) =>
    items.filter((i) => types.includes(i.p.type)).sort((a, b) => a.x - b.x);
  const R = (i: Item) => collisionRadius(i.p);
  const KICK_Y = 60;
  const kick = by('kick')[0];
  let kickHalfW = 0;
  let kickHalfH = 0;

  if (kick) {
    const r = pieceRadius(kick.p);

    kickHalfW = r * KICK_HALF[kit.kind].w;
    kickHalfH = r * KICK_HALF[kit.kind].h;
    kick.x = 50;
    kick.y = KICK_Y;
  }

  let lx = 50 - kickHalfW - 3;

  for (const s of by('snare')) {
    s.x = lx - R(s);
    s.y = 62;
    lx = s.x - R(s) - 3;
  }

  let rx = 50 + kickHalfW + 3;

  for (const f of by('floor')) {
    f.x = rx + R(f);
    f.y = 62;
    rx = f.x + R(f) + 3;
  }

  const toms = by('tom');
  const tomR = Math.max(0, ...toms.map(R));
  const tomY = KICK_Y - kickHalfH - tomR - 4;

  toms.forEach((t, i) => {
    t.y = tomY;
    t.x = 50 + (i - (toms.length - 1) / 2) * (2 * tomR + 3);
  });

  const snare = by('snare')[0];
  const floor = by('floor')[0];

  for (const h of by('hihat')) {
    const r = R(h);

    h.x = snare ? snare.x - R(snare) - r * 0.4 : 22;
    h.y = snare ? snare.y - R(snare) - r * 0.3 : 45;
  }

  const hihat = by('hihat')[0];

  for (const p of by('hhpedal')) {
    p.x = (hihat ? hihat.x : 30) + 3;
    p.y = 80;
  }

  by('ride').forEach((r, i) => {
    r.x = (floor ? floor.x + R(floor) * 0.5 : 78) + i * 6;
    r.y = floor ? floor.y - R(floor) - R(r) * 0.5 : 44;
  });

  const crashes = by('crash', 'splash', 'china');
  const crashR = Math.max(0, ...crashes.map(R));

  crashes.forEach((c, i) => {
    c.y = tomY - tomR - crashR * 0.2 - 2;
    c.x = 50 + (i - (crashes.length - 1) / 2) * (2 * crashR + 4);
  });

  return tidyItems(items);
}
