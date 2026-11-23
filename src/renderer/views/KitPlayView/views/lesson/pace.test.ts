import { describe, expect, it } from 'vitest';
import { TimelineNote } from '../../../../kit';
import { dueNotes, effectiveGrace, offsetStats, TempoMeter } from './pace';
import { tempoVerdict } from './TempoBar';

const note = (tick: number, time: number, voice = 'kick'): TimelineNote =>
  ({
    id: `${tick}:${voice}`,
    tick,
    time,
    voice,
    prefix: voice,
  }) as TimelineNote;

describe('dueNotes', () => {
  const notes = [
    note(0, 1, 'kick'),
    note(0, 1, 'hihat'),
    note(480, 1.5, 'snare'),
  ];
  const none = () => false;

  it('waits for every voice at the earliest due tick', () => {
    expect(dueNotes(notes, none, 0.99, 0.1).map((n) => n.id)).toEqual([
      '0:kick',
      '0:hihat',
    ]);
  });

  it('is empty before a note is due', () => {
    expect(dueNotes(notes, none, 0.9, 0.1)).toEqual([]);
  });

  it('drops voices already hit and moves on once all are', () => {
    const hit = new Set(['0:kick']);

    expect(
      dueNotes(notes, (n) => hit.has(n.id), 1, 0.1).map((n) => n.id),
    ).toEqual(['0:hihat']);

    hit.add('0:hihat');

    expect(dueNotes(notes, (n) => hit.has(n.id), 1, 0.1)).toEqual([]);
  });

  it('skips notes that were already missed', () => {
    expect(dueNotes(notes, none, 1.3, 0.1)).toEqual([]);
  });

  it('keeps playing through the grace before holding', () => {
    expect(dueNotes(notes, none, 1.02, 0.1, 0.06)).toEqual([]);
    expect(dueNotes(notes, none, 1.045, 0.1, 0.06)).toHaveLength(2);
  });

  it('caps the grace so a held note can still be judged', () => {
    expect(effectiveGrace(60, 0.1)).toBeCloseTo(0.06);
    expect(effectiveGrace(90, 0.1)).toBeCloseTo(0.07);
    expect(effectiveGrace(90, 0.02)).toBe(0);
  });
});

describe('offsetStats', () => {
  it('needs three hits, then reports mean and spread', () => {
    expect(offsetStats([10], 20).mean).toBeUndefined();

    const stats = offsetStats([10, 20], 30);

    expect(stats.mean).toBeCloseTo(20);
    expect(stats.spread).toBeCloseTo(10);
  });

  it('keeps only the most recent hits', () => {
    const stats = offsetStats([1, 2, 3, 4], 5, 3);

    expect(stats.offsets).toEqual([3, 4, 5]);
  });
});

describe('TempoMeter', () => {
  const play = (meter: TempoMeter, gap: number, playedGap: number, n = 6) => {
    for (let i = 0; i < n; i += 1) {
      const time = i * gap;

      meter.add({ tick: i * 480, time }, i * playedGap - time);
    }
  };

  it('reads 1 when the gaps match the chart, even with a constant lag', () => {
    const meter = new TempoMeter();

    for (let i = 0; i < 6; i += 1) {
      meter.add({ tick: i * 480, time: i * 0.5 }, 0.04);
    }

    expect(meter.ratio).toBeCloseTo(1);
  });

  it('reads above 1 when rushing and below 1 when dragging', () => {
    const rushing = new TempoMeter();
    const dragging = new TempoMeter();

    play(rushing, 0.5, 0.45);
    play(dragging, 0.5, 0.55);

    expect(rushing.ratio).toBeGreaterThan(1.05);
    expect(dragging.ratio).toBeLessThan(0.95);
    expect(tempoVerdict(rushing.ratio!)).toBe('rushing');
    expect(tempoVerdict(dragging.ratio!)).toBe('dragging');
    expect(tempoVerdict(1.01)).toBe('steady');
  });

  it('needs a few readings and ignores chords and stumbles', () => {
    const meter = new TempoMeter();

    meter.add({ tick: 0, time: 0 }, 0);
    meter.add({ tick: 0, time: 0 }, 0.01);
    meter.add({ tick: 480, time: 0.5 }, 0);
    // A 2x stumble is not a tempo.
    meter.add({ tick: 960, time: 1 }, 0.5);

    expect(meter.ratio).toBeUndefined();
  });

  it('does not measure across a break', () => {
    const meter = new TempoMeter();

    play(meter, 0.5, 0.5, 4);
    meter.break();
    meter.add({ tick: 99999, time: 30 }, 0);

    expect(meter.ratio).toBeCloseTo(1);
  });
});
