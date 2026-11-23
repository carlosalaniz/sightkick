import { describe, expect, it } from 'vitest';
import { TimelineBar, TimelineNote, Voice } from '../../../../kit';
import { staffGeometry } from './layout';
import { buildLoopModel } from './region';
import { NoteResult } from './scoring';
import { StaffStrip } from './StaffStrip';

const bars: TimelineBar[] = Array.from({ length: 4 }, (_, i) => ({
  measureIdx: i,
  startTick: i * 1920,
  endTick: (i + 1) * 1920,
  start: i * 2,
  end: (i + 1) * 2,
  beats: [0, 0.5, 1, 1.5].map((b) => i * 2 + b),
  timeSig: [4, 4],
}));
const note = (bar: number, beat: number, voice: Voice): TimelineNote => ({
  id: `${bar * 1920 + beat * 480}:${voice}`,
  tick: bar * 1920 + beat * 480,
  time: bar * 2 + beat * 0.5,
  prefix: voice,
  voice,
  accent: false,
  ghost: false,
  measureIdx: bar,
});

function setup() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  svg.appendChild(root);

  const notes = [note(0, 0, 'kick'), note(0, 1, 'snare'), note(1, 0, 'hihat')];
  const model = buildLoopModel(bars, notes, { start: 0, end: 2 });
  const strip = new StaffStrip(root);
  const results = new Map<number, Map<string, NoteResult>>();
  const statusOf = (pass: number, id: string) => results.get(pass)?.get(id);

  strip.configure({
    model,
    geo: staffGeometry(18),
    ppb: 100,
    colorOf: (v) => (v === 'hihat' ? undefined : '#5b7fd1'),
  });

  return { root, strip, model, notes, results, statusOf };
}

describe('StaffStrip', () => {
  it('builds only the requested window of bars, repeating the loop', () => {
    const { root, strip, statusOf } = setup();

    strip.ensure(-1, 2, statusOf);

    // Virtual bars 0, 1 (pass 0) and 2 (bar 0 of pass 1).
    expect(root.children).toHaveLength(3);
    expect(root.children[2].getAttribute('transform')).toBe(
      'translate(800.0 0)',
    );

    strip.ensure(2, 3, statusOf);

    expect(root.children).toHaveLength(2);
  });

  it('draws gems only for voices the kit can play', () => {
    const { root, strip, statusOf } = setup();

    strip.ensure(0, 1, statusOf);

    // Kick rect + snare rect in bar 1; the hi-hat has no piece, so no gem.
    const gems = root.querySelectorAll('[fill-opacity="0.85"]');

    expect(gems).toHaveLength(2);
  });

  it('marks judged notes in their pass and fades gems with the guide', () => {
    const { root, strip, notes, results, statusOf } = setup();

    strip.ensure(0, 2, statusOf);
    results.set(0, new Map([[notes[1].id, { tier: 'miss' }]]));
    strip.mark(0, notes[1].id, { tier: 'miss' }, false);

    const marks = (i: number) =>
      root.children[i].lastElementChild?.children.length ?? 0;

    expect(marks(0)).toBe(2);
    expect(marks(2)).toBe(0);

    strip.paint({
      levels: [1, 1],
      bare: false,
      pass: 0,
      now: 0.4,
      rate: 1,
      aheadSeconds: 1.2,
      statusOf,
    });

    const [kickGem, snareGem] = [
      ...root.children[0].querySelectorAll('[fill-opacity="0.85"]'),
    ];

    expect(kickGem.getAttribute('opacity')).toBe('0');
    expect(snareGem.getAttribute('opacity')).toBe('0.3');

    strip.paint({
      levels: [0.5, 0.5],
      bare: false,
      pass: 0,
      now: 0.4,
      rate: 1,
      aheadSeconds: 1.2,
      statusOf,
    });

    expect(snareGem.getAttribute('opacity')).toBe('0');

    strip.clearMarks(0);

    expect(marks(0)).toBe(0);
  });

  it('lists unjudged notes coming up, across the loop seam', () => {
    const { strip, statusOf } = setup();
    const seen: [string, number][] = [];

    strip.ensure(0, 2, statusOf);
    strip.upcoming(0, 3.8, 0.5, statusOf, (ln, dt) =>
      seen.push([ln.note.voice, Math.round(dt * 10) / 10]),
    );

    expect(seen).toEqual([['kick', 0.2]]);
  });
});
