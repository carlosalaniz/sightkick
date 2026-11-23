import { TimelineBar, TimelineNote, Voice } from '../../../../kit';

/** Test helpers: 4/4 bars of 1920 ticks, 2 s each (120 BPM). */
export const TICKS_PER_BAR = 1920;

export const SECONDS_PER_BAR = 2;

export function makeBars(count: number): TimelineBar[] {
  return Array.from({ length: count }, (_, i) => ({
    measureIdx: i,
    startTick: i * TICKS_PER_BAR,
    endTick: (i + 1) * TICKS_PER_BAR,
    start: i * SECONDS_PER_BAR,
    end: (i + 1) * SECONDS_PER_BAR,
    beats: [0, 0.5, 1, 1.5].map((b) => i * SECONDS_PER_BAR + b),
    timeSig: [4, 4] as [number, number],
  }));
}

const PREFIX: Record<Voice, string> = {
  kick: 'f/4',
  snare: 'c/5',
  hihat: 'g/5',
  ride: 'f/5',
  crash: 'a/5',
  tom1: 'e/5',
  tom2: 'd/5',
  tom3: 'a/4',
};

/** A note in `bar` at `beat` (0-based, fractional for subdivisions). */
export function makeNote(
  bar: number,
  beat: number,
  voice: Voice,
): TimelineNote {
  const tick = bar * TICKS_PER_BAR + Math.round(beat * 480);

  return {
    id: `${tick}:${PREFIX[voice]}`,
    tick,
    time: bar * SECONDS_PER_BAR + beat * 0.5,
    prefix: PREFIX[voice],
    voice,
    accent: false,
    ghost: false,
    measureIdx: bar,
  };
}

/** A rock beat: eighth hi-hats, snare on 2 and 4, kick on 1 and 3. */
export function rockBar(bar: number): TimelineNote[] {
  const out: TimelineNote[] = [];

  for (let e = 0; e < 8; e += 1) {
    out.push(makeNote(bar, e / 2, 'hihat'));
  }

  out.push(makeNote(bar, 1, 'snare'), makeNote(bar, 3, 'snare'));
  out.push(makeNote(bar, 0, 'kick'), makeNote(bar, 2, 'kick'));

  return out.sort((a, b) => a.time - b.time);
}
