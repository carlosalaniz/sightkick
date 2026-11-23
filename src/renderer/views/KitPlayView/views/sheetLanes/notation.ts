/**
 * Simplified drum notation for one bar, the way the mock draws it: notes are
 * grouped per beat, hands stem up, the kick stems down, notes in a beat share
 * a beam (two when there are sixteenths) and a lone off-beat note gets a flag.
 */

const EPS = 1e-3;

export interface NotationInput {
  /** Beat position inside the bar. */
  beat: number;
  /** Staff step (kick 1 … crash 10). */
  step: number;
  foot: boolean;
}

export interface StemGroup {
  /** Distinct positions in the beat, ascending. */
  positions: number[];
  /** Lowest staff step at each position (where an up-stem starts). */
  lowSteps: number[];
  /** 0 (single note), 1 (eighths) or 2 (sixteenths or finer). */
  beams: 0 | 1 | 2;
  /** A single note off the beat gets a flag instead of a beam. */
  flag: boolean;
}

export interface BeatNotation {
  beat: number;
  hands: StemGroup;
  feet: StemGroup;
}

const isOn = (x: number, grid: number) =>
  Math.abs(x / grid - Math.round(x / grid)) < EPS;

function stemGroup(notes: NotationInput[]): StemGroup {
  const byPos = new Map<number, number>();

  for (const n of notes) {
    const key = Math.round(n.beat * 1000) / 1000;

    byPos.set(key, Math.min(byPos.get(key) ?? Infinity, n.step));
  }

  const positions = [...byPos.keys()].sort((a, b) => a - b);
  const fine = positions.some((p) => !isOn(p, 0.5));
  let beams: StemGroup['beams'] = 0;

  if (positions.length > 1) {
    beams = fine ? 2 : 1;
  }

  return {
    positions,
    lowSteps: positions.map((p) => byPos.get(p) ?? 0),
    beams,
    flag: positions.length === 1 && !isOn(positions[0], 1),
  };
}

export function barNotation(notes: NotationInput[]): BeatNotation[] {
  const byBeat = new Map<number, NotationInput[]>();

  for (const n of notes) {
    const beat = Math.floor(n.beat + EPS);
    const list = byBeat.get(beat) ?? [];

    list.push(n);
    byBeat.set(beat, list);
  }

  return [...byBeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([beat, list]) => ({
      beat,
      hands: stemGroup(list.filter((n) => !n.foot)),
      feet: stemGroup(list.filter((n) => n.foot)),
    }));
}

export interface CountLabel {
  beat: number;
  text: string;
  strong: boolean;
}

/** `1 & 2 & …` under the bar, plus `e` / `a` where sixteenths are played. */
export function countLabels(
  beatCount: number,
  noteBeats: number[],
): CountLabel[] {
  const sixteenths = new Set<number>();

  for (const b of noteBeats) {
    if (isOn(b, 0.25) && !isOn(b, 0.5)) {
      sixteenths.add(Math.round(b * 4));
    }
  }

  const out: CountLabel[] = [];

  for (let k = 0; k < beatCount; k += 1) {
    out.push({ beat: k, text: String(k + 1), strong: true });

    if (sixteenths.has(k * 4 + 1)) {
      out.push({ beat: k + 0.25, text: 'e', strong: false });
    }

    out.push({ beat: k + 0.5, text: '&', strong: false });

    if (sixteenths.has(k * 4 + 3)) {
      out.push({ beat: k + 0.75, text: 'a', strong: false });
    }
  }

  return out;
}
