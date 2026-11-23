import { VOICE_INFO, Voice } from '../../../../kit';
import { colorLevel, countLevel, gemFade, gemLevel } from './guide';
import { INK, StaffGeometry, stepY } from './layout';
import { barNotation, countLabels } from './notation';
import { LoopModel, LoopNote } from './region';
import { MISS_COLOR, NoteResult, TIER_BY_ID } from './scoring';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = 'var(--font-ui)';

type Attrs = Record<string, string | number>;

function mk<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);

  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }

  parent?.appendChild(el);

  return el;
}

function fade(el: Element, from: number, duration: number): void {
  if (typeof (el as SVGElement).animate === 'function') {
    (el as SVGElement).animate([{ opacity: from }, { opacity: 0 }], {
      duration,
    });
  }
}

export interface StripConfig {
  model: LoopModel;
  geo: StaffGeometry;
  ppb: number;
  /** Color of the piece that plays a voice; undefined if the kit has none. */
  colorOf: (voice: Voice) => string | undefined;
}

export interface StripFrame {
  /** Guide level per loop bar. */
  levels: number[];
  /** Sheet only, regardless of levels (the unseen-bars pass). */
  bare: boolean;
  /** Pass the playhead is in, and the audio time inside it. */
  pass: number;
  now: number;
  /** Playback speed; gem timing is in real seconds. */
  rate: number;
  aheadSeconds: number;
  statusOf: (pass: number, noteId: string) => NoteResult | undefined;
}

interface BuiltNote {
  ln: LoopNote;
  x: number;
  y: number;
  cym: boolean;
  color: string | undefined;
  gem: SVGElement | undefined;
  paint: SVGElement;
  op: number;
  c: number;
}

interface BuiltBar {
  pass: number;
  bar: number;
  g: SVGGElement;
  chrome: SVGGElement;
  marks: SVGGElement;
  chromeOp: number;
  notes: BuiltNote[];
}

/**
 * The scrolling note strip, built imperatively for a window of "virtual" bars
 * (bar `j` of pass `p` is virtual bar `p * barsPerPass + j`), so the bars
 * after the loop end show the loop start coming round again. Only bars near
 * the playhead exist in the DOM; `paint` updates them every frame.
 */
export class StaffStrip {
  private built = new Map<number, BuiltBar>();

  private cfg: StripConfig | undefined;

  constructor(private root: SVGGElement) {}

  configure(cfg: StripConfig): void {
    this.cfg = cfg;
    this.clear();
  }

  clear(): void {
    this.root.replaceChildren();
    this.built.clear();
  }

  /** Builds virtual bars `from..to` (inclusive) and drops the rest. */
  ensure(
    from: number,
    to: number,
    statusOf: (pass: number, noteId: string) => NoteResult | undefined,
  ): void {
    const cfg = this.cfg;

    if (!cfg || cfg.model.bars.length === 0) {
      return;
    }

    for (const [v, b] of this.built) {
      if (v < from || v > to) {
        b.g.remove();
        this.built.delete(v);
      }
    }

    for (let v = Math.max(0, from); v <= to; v += 1) {
      if (!this.built.has(v)) {
        const bar = this.buildBar(cfg, v);

        for (const n of bar.notes) {
          const r = statusOf(bar.pass, n.ln.note.id);

          if (r) {
            this.addMark(bar, n, r);
          }
        }

        this.built.set(v, bar);
      }
    }
  }

  /** Paints a judged note in every built copy of it in `pass`. */
  mark(pass: number, noteId: string, result: NoteResult, flash: boolean): void {
    for (const bar of this.built.values()) {
      if (bar.pass !== pass) {
        continue;
      }

      const n = bar.notes.find((x) => x.ln.note.id === noteId);

      if (n) {
        this.addMark(bar, n, result);

        if (flash && n.gem && result.tier !== 'miss') {
          fade(n.gem, 0.9, 220);
        }
      }
    }
  }

  /** Removes the hit / miss marks of a pass (it was abandoned or restarted). */
  clearMarks(pass: number): void {
    for (const bar of this.built.values()) {
      if (bar.pass === pass) {
        bar.marks.replaceChildren();
      }
    }
  }

  paint(f: StripFrame): void {
    const cfg = this.cfg;

    if (!cfg) {
      return;
    }

    const { span } = cfg.model;

    for (const bar of this.built.values()) {
      const g = f.bare ? 0 : f.levels[bar.bar] ?? 1;
      const chromeOp = Math.round(countLevel(g) * 100) / 100;

      if (chromeOp !== bar.chromeOp) {
        bar.chromeOp = chromeOp;
        bar.chrome.setAttribute('opacity', String(chromeOp));
      }

      const gemL = gemLevel(g);
      const c = colorLevel(g);

      for (const n of bar.notes) {
        if (n.gem) {
          const r = f.statusOf(bar.pass, n.ln.note.id);
          let status: 'hit' | 'miss' | undefined;

          if (r) {
            status = r.tier === 'miss' ? 'miss' : 'hit';
          }

          const t = n.ln.note.time + (bar.pass - f.pass) * span;
          const op =
            Math.round(
              gemL *
                gemFade((t - f.now) / f.rate, f.aheadSeconds, status) *
                100,
            ) / 100;

          if (op !== n.op) {
            n.op = op;
            n.gem.setAttribute('opacity', String(op));
          }
        }

        if (c !== n.c) {
          n.c = c;

          const col =
            c > 0 && n.color
              ? `color-mix(in srgb, ${n.color} ${Math.round(c * 100)}%, ${INK})`
              : INK;

          n.paint.style.setProperty(n.cym ? 'stroke' : 'fill', col);
        }
      }
    }
  }

  /**
   * Calls `cb(note, secondsAhead)` for unjudged notes in the next `horizon`
   * song seconds.
   */
  upcoming(
    pass: number,
    now: number,
    horizon: number,
    statusOf: (pass: number, noteId: string) => NoteResult | undefined,
    cb: (ln: LoopNote, dt: number) => void,
  ): void {
    const span = this.cfg?.model.span ?? 0;

    for (const bar of this.built.values()) {
      for (const n of bar.notes) {
        const dt = n.ln.note.time + (bar.pass - pass) * span - now;

        if (dt >= 0 && dt < horizon && !statusOf(bar.pass, n.ln.note.id)) {
          cb(n.ln, dt);
        }
      }
    }
  }

  private addMark(bar: BuiltBar, n: BuiltNote, r: NoteResult): void {
    const cfg = this.cfg;

    if (!cfg) {
      return;
    }

    const col = r.tier === 'miss' ? MISS_COLOR : TIER_BY_ID[r.tier].color;

    mk(
      'circle',
      { cx: n.x, cy: cfg.geo.bottom + 16, r: 4.5, fill: col },
      bar.marks,
    );

    if (r.tier === 'miss') {
      mk(
        'circle',
        {
          cx: n.x,
          cy: n.y,
          r: 12,
          fill: 'none',
          stroke: MISS_COLOR,
          'stroke-width': 2,
        },
        bar.marks,
      );
    }
  }

  private buildBar(cfg: StripConfig, v: number): BuiltBar {
    const { model, geo, ppb } = cfg;
    const per = model.bars.length;
    const pass = Math.floor(v / per);
    const j = v - pass * per;
    const lb = model.bars[j];
    const x = (b: number) => b * ppb;
    const g = mk(
      'g',
      {
        transform: `translate(${(
          (pass * model.beats + lb.beatOffset) *
          ppb
        ).toFixed(1)} 0)`,
      },
      this.root,
    );
    const chrome = mk('g', { opacity: 1 }, g);

    // Beat shading and the count: the last guidance to go.
    for (let k = 0; k < lb.beatCount; k += 2) {
      mk(
        'rect',
        {
          x: x(k) - ppb * 0.22,
          y: geo.top + 22,
          width: ppb,
          height: geo.bottom - geo.top - 45,
          fill: INK,
          'fill-opacity': 0.05,
        },
        chrome,
      );
    }

    for (const lab of countLabels(
      lb.beatCount,
      lb.notes.map((n) => n.beat),
    )) {
      const t = mk(
        'text',
        {
          x: x(lab.beat),
          y: geo.bottom + 40,
          'text-anchor': 'middle',
          'font-size': 13,
          'font-weight': lab.strong ? 700 : 500,
          fill: lab.strong ? '#4a463c' : '#8c8577',
          'font-family': FONT,
        },
        chrome,
      );

      t.textContent = lab.text;
    }

    const bx = -ppb * 0.32;

    mk(
      'line',
      {
        x1: bx,
        x2: bx,
        y1: stepY(geo, 8),
        y2: stepY(geo, 0),
        stroke: INK,
        'stroke-width': 1.6,
      },
      g,
    );

    const num = mk(
      'text',
      {
        x: bx + 4,
        y: stepY(geo, 8) - 6,
        'font-size': 11,
        fill: '#8c8577',
        'font-family': FONT,
      },
      g,
    );

    num.textContent = String(lb.bar.measureIdx + 1);

    // Stems and beams per beat: hands up, kick down.
    const notation = barNotation(
      lb.notes.map((n) => ({
        beat: n.beat,
        step: VOICE_INFO[n.note.voice].step,
        foot: n.note.voice === 'kick',
      })),
    );

    for (const { hands, feet } of notation) {
      hands.positions.forEach((b, i) => {
        mk(
          'line',
          {
            x1: x(b) + 8,
            x2: x(b) + 8,
            y1: stepY(geo, hands.lowSteps[i]) - 2,
            y2: geo.top,
            stroke: INK,
            'stroke-width': 1.6,
          },
          g,
        );
      });

      if (hands.beams > 0) {
        const p = hands.positions;
        const x0 = x(p[0]) + 7.2;
        const w = x(p[p.length - 1]) - x(p[0]) + 1.6;

        mk(
          'rect',
          { x: x0, y: geo.top - 2, width: w, height: 6, fill: INK },
          g,
        );

        if (hands.beams > 1) {
          mk(
            'rect',
            { x: x0, y: geo.top + 8, width: w, height: 6, fill: INK },
            g,
          );
        }
      } else if (hands.flag) {
        mk(
          'path',
          {
            d: `M${x(hands.positions[0]) + 8} ${geo.top} q 10 6 8 20`,
            fill: 'none',
            stroke: INK,
            'stroke-width': 2.4,
          },
          g,
        );
      }

      for (const b of feet.positions) {
        mk(
          'line',
          {
            x1: x(b) - 8,
            x2: x(b) - 8,
            y1: stepY(geo, 1) + 2,
            y2: geo.bottom,
            stroke: INK,
            'stroke-width': 1.6,
          },
          g,
        );
      }

      if (feet.beams > 0) {
        const p = feet.positions;

        mk(
          'rect',
          {
            x: x(p[0]) - 8.8,
            y: geo.bottom - 6,
            width: x(p[p.length - 1]) - x(p[0]) + 1.6,
            height: 6,
            fill: INK,
          },
          g,
        );
      } else if (feet.flag) {
        mk(
          'path',
          {
            d: `M${x(feet.positions[0]) - 8} ${geo.bottom} q 10 -6 8 -20`,
            fill: 'none',
            stroke: INK,
            'stroke-width': 2.4,
          },
          g,
        );
      }
    }

    const notes: BuiltNote[] = [];

    for (const ln of lb.notes) {
      const info = VOICE_INFO[ln.note.voice];
      const color = cfg.colorOf(ln.note.voice);
      const nx = x(ln.beat);
      const y = stepY(geo, info.step);
      const s = ln.note.ghost ? 0.7 : 1;
      let gem: SVGElement | undefined;

      if (color) {
        gem = info.cymbal
          ? mk(
              'circle',
              {
                cx: nx,
                cy: y,
                r: 13,
                fill: color,
                'fill-opacity': 0.85,
                opacity: 0,
              },
              g,
            )
          : mk(
              'rect',
              {
                x: nx - 15,
                y: y - 10,
                width: 30,
                height: 20,
                rx: 6,
                fill: color,
                'fill-opacity': 0.85,
                opacity: 0,
              },
              g,
            );
      }

      if (info.step >= 10) {
        mk(
          'line',
          {
            x1: nx - 14,
            x2: nx + 14,
            y1: y,
            y2: y,
            stroke: INK,
            'stroke-width': 1.4,
          },
          g,
        );
      }

      const d = 6.5 * s;
      const paint = info.cymbal
        ? mk(
            'path',
            {
              d: `M${nx - d} ${y - d}L${nx + d} ${y + d}M${nx + d} ${y - d}L${
                nx - d
              } ${y + d}`,
              stroke: INK,
              'stroke-width': 3,
              'stroke-linecap': 'round',
              fill: 'none',
              opacity: color ? 1 : 0.3,
            },
            g,
          )
        : mk(
            'ellipse',
            {
              cx: nx,
              cy: y,
              rx: 8.6 * s,
              ry: 6.2 * s,
              transform: `rotate(-20 ${nx} ${y})`,
              fill: INK,
              opacity: color ? 1 : 0.3,
            },
            g,
          );

      if (ln.note.ghost) {
        const t = mk(
          'text',
          {
            x: nx,
            y: y + 5,
            'text-anchor': 'middle',
            'font-size': 16,
            fill: INK,
            'font-family': FONT,
          },
          g,
        );

        t.textContent = '(   )';
      }

      // Accent wedge above the beams (hands only: below the kick stems sit
      // the judgment dots and the count).
      if (ln.note.accent && ln.note.voice !== 'kick') {
        const ay = geo.top - 14;

        mk(
          'path',
          {
            d: `M${nx - 6} ${ay - 4}L${nx + 6} ${ay}L${nx - 6} ${ay + 4}`,
            fill: 'none',
            stroke: INK,
            'stroke-width': 1.8,
          },
          g,
        );
      }

      notes.push({
        ln,
        x: nx,
        y,
        cym: info.cymbal,
        color,
        gem,
        paint,
        op: -1,
        c: -1,
      });
    }

    const marks = mk('g', {}, g);

    return { pass, bar: j, g, chrome, marks, chromeOp: 1, notes };
  }
}
