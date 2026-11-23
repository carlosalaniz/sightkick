import {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
  useEffect,
  useEffectEvent,
  useRef,
} from 'react';
import { isTypingTarget } from '../../input';
import {
  KIT_GRID,
  Kit,
  layoutStandard,
  layoutTidy,
  PiecePositions,
  svgPoint,
} from '../../kit';
import {
  clampToStage,
  LayoutHistory,
  pieceElement,
  positionsOf,
  prefersReducedMotion,
  pushHistory,
  snapToGrid,
  withPositions,
} from './kitEdits';

const ANIMATION_MS = 420;
const NUDGES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  pieceId: string;
  kitId: string;
  pointerId: number;
  g: SVGGElement;
  /** Offset from the pointer to the piece center, so the piece doesn't jump. */
  dx: number;
  dy: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  before: PiecePositions;
}

interface Animation {
  kitId: string;
  frame: number;
  target: PiecePositions;
  /** Where each piece is drawn right now. */
  live: PiecePositions;
}

interface Options {
  kit: Kit;
  updateKit: (next: Kit | ((kit: Kit) => Kit)) => void;
  snap: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  history: LayoutHistory;
  setHistory: Dispatch<SetStateAction<LayoutHistory>>;
  svgRef: RefObject<SVGSVGElement | null>;
  /** The inspector's position readout, updated live while dragging. */
  positionRef: RefObject<HTMLSpanElement | null>;
}

function formatPosition(x: number, y: number): string {
  return `x ${Math.round(x)} · y ${Math.round(y)}`;
}

/**
 * Drag, nudge, tidy, standard layout and undo on the builder stage. Drags and
 * layout animations move the piece `<g>` elements directly and only write the
 * kit (and so localStorage) once they finish.
 */
export function useKitStage({
  kit,
  updateKit,
  snap,
  selectedId,
  setSelectedId,
  history,
  setHistory,
  svgRef,
  positionRef,
}: Options) {
  const dragRef = useRef<Drag | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const undoStack = history[kit.id] ?? [];
  const commit = (kitId: string, positions: PiecePositions) =>
    updateKit((k) => (k.id === kitId ? withPositions(k, positions) : k));
  const draw = (pieceId: string, x: number, y: number) => {
    pieceElement(svgRef.current, pieceId)?.setAttribute(
      'transform',
      `translate(${x} ${y})`,
    );

    if (pieceId === selectedId && positionRef.current) {
      positionRef.current.textContent = formatPosition(x, y);
    }
  };
  /** Positions as drawn, including a layout animation in flight. */
  const currentPositions = (): PiecePositions => ({
    ...positionsOf(kit),
    ...animationRef.current?.live,
  });
  /** Jumps a running animation to its end and saves it. Returns the positions it landed on. */
  const finishAnimation = (): PiecePositions => {
    const anim = animationRef.current;

    if (!anim) {
      return positionsOf(kit);
    }

    cancelAnimationFrame(anim.frame);
    animationRef.current = null;
    Object.entries(anim.target).forEach(([id, p]) => draw(id, p.x, p.y));
    commit(anim.kitId, anim.target);

    return { ...positionsOf(kit), ...anim.target };
  };
  const animateTo = (target: PiecePositions) => {
    const from = currentPositions();
    const running = animationRef.current;

    if (running) {
      cancelAnimationFrame(running.frame);
      animationRef.current = null;
    }

    if (prefersReducedMotion()) {
      Object.entries(target).forEach(([id, p]) => draw(id, p.x, p.y));
      commit(kit.id, target);

      return;
    }

    const anim: Animation = { kitId: kit.id, frame: 0, target, live: from };
    const t0 = performance.now();
    // performance.now() rather than the frame timestamp, which can predate t0.
    const step = () => {
      const u = Math.min(
        1,
        Math.max(0, (performance.now() - t0) / ANIMATION_MS),
      );
      const eased = 1 - (1 - u) ** 3;
      const live: PiecePositions = {};

      for (const [id, to] of Object.entries(target)) {
        const a = from[id];

        if (!a) {
          continue;
        }

        live[id] = {
          x: a.x + (to.x - a.x) * eased,
          y: a.y + (to.y - a.y) * eased,
        };
        draw(id, live[id].x, live[id].y);
      }

      anim.live = { ...anim.live, ...live };

      if (u < 1) {
        anim.frame = requestAnimationFrame(step);
      } else {
        animationRef.current = null;
        commit(anim.kitId, target);
      }
    };

    anim.frame = requestAnimationFrame(step);
    animationRef.current = anim;
  };
  const remember = (snapshot: PiecePositions) =>
    setHistory((h) => pushHistory(h, kit.id, snapshot));
  const tidy = () => {
    if (kit.pieces.length === 0) {
      return;
    }

    const now = currentPositions();

    remember(now);
    animateTo(layoutTidy(withPositions(kit, now).pieces));
  };
  const standard = () => {
    if (kit.pieces.length === 0) {
      return;
    }

    const now = currentPositions();

    remember(now);
    animateTo(layoutStandard(withPositions(kit, now)));
  };
  const undo = () => {
    const snapshot = undoStack[undoStack.length - 1];

    if (!snapshot) {
      return;
    }

    setHistory((h) => ({ ...h, [kit.id]: (h[kit.id] ?? []).slice(0, -1) }));
    animateTo(snapshot);
  };
  const nudge = (dx: number, dy: number) => {
    const piece = kit.pieces.find((p) => p.id === selectedId);

    if (!piece) {
      return;
    }

    const now = finishAnimation();
    const from = now[piece.id] ?? piece;
    const stepSize = snap ? KIT_GRID : 1;
    const to = clampToStage(from.x + dx * stepSize, from.y + dy * stepSize);

    if (to.x === from.x && to.y === from.y) {
      return;
    }

    remember(now);
    commit(kit.id, { [piece.id]: to });
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;

    if (!svg || e.button !== 0) {
      return;
    }

    const g = (e.target as Element).closest<SVGGElement>('[data-piece-id]');
    const pieceId = g?.dataset.pieceId;
    const piece = kit.pieces.find((p) => p.id === pieceId);

    if (!g || !piece) {
      setSelectedId(null);

      return;
    }

    // No preventDefault: the click should still blur a focused text field so arrows nudge.
    const now = finishAnimation();
    const at = now[piece.id] ?? piece;
    const pt = svgPoint(svg, e.clientX, e.clientY);

    setSelectedId(piece.id);
    dragRef.current = {
      pieceId: piece.id,
      kitId: kit.id,
      pointerId: e.pointerId,
      g,
      dx: at.x - pt.x,
      dy: at.y - pt.y,
      startX: at.x,
      startY: at.y,
      x: at.x,
      y: at.y,
      before: now,
    };
    g.style.cursor = 'grabbing';
    svg.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;

    if (!drag || !svg || e.pointerId !== drag.pointerId) {
      return;
    }

    const pt = svgPoint(svg, e.clientX, e.clientY);
    let x = pt.x + drag.dx;
    let y = pt.y + drag.dy;

    if (snap && !e.altKey) {
      x = snapToGrid(x);
      y = snapToGrid(y);
    }

    const next = clampToStage(x, y);

    if (next.x === drag.x && next.y === drag.y) {
      return;
    }

    drag.x = next.x;
    drag.y = next.y;
    drag.g.setAttribute('transform', `translate(${next.x} ${next.y})`);

    if (positionRef.current) {
      positionRef.current.textContent = formatPosition(next.x, next.y);
    }
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;

    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }

    dragRef.current = null;
    drag.g.style.cursor = 'grab';

    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }

    if (drag.x === drag.startX && drag.y === drag.startY) {
      return;
    }

    setHistory((h) => pushHistory(h, drag.kitId, drag.before));
    commit(drag.kitId, { [drag.pieceId]: { x: drag.x, y: drag.y } });
  };
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) {
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === 'z'
    ) {
      e.preventDefault();
      undo();

      return;
    }

    const d = NUDGES[e.key];

    if (!d || !selectedId || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    // Leave arrows alone while a control that uses them (slider, segmented) has focus.
    if (
      e.target instanceof Element &&
      e.target.closest('[role="slider"], [role="radiogroup"], [role="listbox"]')
    ) {
      return;
    }

    e.preventDefault();
    nudge(d[0], d[1]);
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);

    window.addEventListener('keydown', handler);

    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Leaving the tab mid-animation still saves where the layout was going.
  // Switching kits stops it (the guard makes the save a no-op for the new kit).
  const kitId = kit.id;

  useEffect(() => {
    const animation = animationRef;

    return () => {
      const anim = animation.current;

      if (anim) {
        cancelAnimationFrame(anim.frame);
        animation.current = null;
        updateKit((k) =>
          k.id === anim.kitId ? withPositions(k, anim.target) : k,
        );
      }
    };
  }, [kitId, updateKit]);

  return {
    canUndo: undoStack.length > 0,
    tidy,
    standard,
    undo,
    svgHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
    },
  };
}
