import { prefersReducedMotion } from '../../../../kit';

/**
 * Imperative SVG effects for the play views. Everything here runs from
 * animation frames or input callbacks, never during render, and writes DOM
 * attributes directly so React never re-renders per frame.
 */

const SVGNS = 'http://www.w3.org/2000/svg';

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === 'function';
}

export function makeSvg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element | null,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);

  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }

  parent?.appendChild(el);

  return el;
}

/** Sets an attribute only when it changed (cheap per-frame writes). */
export function setAttr(
  el: Element | null | undefined,
  name: string,
  value: string | number,
): void {
  if (!el) {
    return;
  }

  const v = String(value);

  if (el.getAttribute(name) !== v) {
    el.setAttribute(name, v);
  }
}

export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

/** Fades an element's opacity from `from` to 0. */
export function fadeOut(el: Element | null | undefined, from = 0.7, ms = 280) {
  if (!el || !canAnimate(el)) {
    return;
  }

  (el as SVGElement).animate([{ opacity: from }, { opacity: 0 }], {
    duration: prefersReducedMotion() ? 1 : ms,
  });
}

/** Flashes every `[<attr>="<pieceId>"]` element under `root` (pads by default). */
export function flashPiece(
  root: Element | null | undefined,
  pieceId: string,
  from = 0.7,
  ms = 280,
  attr = 'data-flash',
): void {
  root
    ?.querySelectorAll(`[${attr}="${pieceId.replace(/["\\]/g, '\\$&')}"]`)
    .forEach((el) => fadeOut(el, from, ms));
}

/** An expanding ring at (x, y) that removes itself. */
export function ringAt(
  layer: Element | null | undefined,
  x: number,
  y: number,
  r: number,
  color: string,
  big: boolean,
  ry = r,
): void {
  if (!layer || prefersReducedMotion()) {
    return;
  }

  const el = makeSvg(
    'ellipse',
    {
      cx: x.toFixed(2),
      cy: y.toFixed(2),
      rx: r.toFixed(2),
      ry: ry.toFixed(2),
      fill: 'none',
      stroke: color,
      'stroke-width': big ? 1 : 0.6,
      style: 'transform-box:fill-box;transform-origin:center',
    },
    layer,
  );

  if (!canAnimate(el)) {
    el.remove();

    return;
  }

  el.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${big ? 2.3 : 1.7})`, opacity: 0 },
    ],
    { duration: big ? 320 : 240 },
  ).onfinish = () => el.remove();
}

/** A label that floats up from (x, y) and removes itself. */
export function floatText(
  layer: Element | null | undefined,
  x: number,
  y: number,
  text: string,
  color: string,
  attrs: Record<string, string | number> = {},
): void {
  if (!layer || prefersReducedMotion()) {
    return;
  }

  const el = makeSvg(
    'text',
    { x: x.toFixed(2), y: y.toFixed(2), fill: color, ...attrs },
    layer,
  );

  el.textContent = text;

  if (!canAnimate(el)) {
    el.remove();

    return;
  }

  el.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-5px)', opacity: 0 },
    ],
    { duration: 500 },
  ).onfinish = () => el.remove();
}

/** The central judgment pop of v12 / v13: one text element, re-triggered. */
export function popJudgment(
  el: SVGTextElement | null | undefined,
  text: string,
  color: string,
): void {
  if (!el) {
    return;
  }

  el.textContent = text.toUpperCase();
  el.setAttribute('fill', color);

  if (!canAnimate(el) || prefersReducedMotion()) {
    el.setAttribute('opacity', '1');

    return;
  }

  el.animate(
    [
      { transform: 'scale(1.4)', opacity: 1 },
      { transform: 'scale(1)', opacity: 1, offset: 0.3 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: 520, fill: 'forwards' },
  );
}

/**
 * Hands out pre-rendered gem elements per lane each frame. Call `begin`,
 * `place` for every visible note, then `end` to hide the slots left over.
 */
export class GemPools {
  private pools = new Map<string, Element>();

  private used = new Map<string, number>();

  private shown = new Map<string, number>();

  register(key: string, el: Element | null): void {
    if (el) {
      this.pools.set(key, el);
    } else {
      this.pools.delete(key);
    }
  }

  begin(): void {
    this.used.clear();
  }

  /** The next free slot of a lane, or undefined if the pool is exhausted. */
  place(key: string, transform: string, opacity: number): Element | undefined {
    const pool = this.pools.get(key);
    const i = this.used.get(key) ?? 0;
    const el = pool?.children[i];

    if (!el) {
      return undefined;
    }

    this.used.set(key, i + 1);
    el.setAttribute('transform', transform);
    setAttr(el, 'opacity', opacity.toFixed(2));
    setAttr(el, 'display', 'inline');

    return el;
  }

  end(): void {
    for (const [key, pool] of this.pools) {
      const used = this.used.get(key) ?? 0;
      const shown = this.shown.get(key) ?? pool.children.length;

      for (let i = used; i < shown; i += 1) {
        setAttr(pool.children[i], 'display', 'none');
      }

      this.shown.set(key, used);
    }
  }
}

/** A rolling row of early / late ticks (the mock's timing strip). */
export class ErrorTicks {
  private next = 0;

  /** `halfWidth`: half-width of the strip in the tick group's own units. */
  constructor(private halfWidth = 16) {}

  push(
    g: Element | null | undefined,
    offsetMs: number,
    windowMs: number,
    color: string,
  ): void {
    if (!g || g.children.length === 0) {
      return;
    }

    const el = g.children[this.next % g.children.length];
    const x = Math.max(-1, Math.min(1, offsetMs / Math.max(1, windowMs)));

    this.next += 1;
    el.setAttribute('x', (x * this.halfWidth - 0.35).toFixed(2));
    el.setAttribute('fill', color);
    el.setAttribute('opacity', '0.8');
  }

  clear(g: Element | null | undefined): void {
    for (const el of g ? [...g.children] : []) {
      el.setAttribute('opacity', '0');
    }
  }
}
