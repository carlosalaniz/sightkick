import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KITS,
  KitPiece,
  pieceByVoice,
  TimelineBar,
  TimelineNote,
  Voice,
} from '../../../../kit';
import {
  barIndexAt,
  beatSecondsAt,
  buildSections,
  forEachBeat,
  keyLabel,
  laneOwner,
  lanePieces,
  maxNotesInWindow,
  padKeyLabel,
  poolSizes,
  prettySectionName,
  sectionIndexAt,
  skippedLine,
  skippedVoices,
  songProgress,
  spreadPositions,
  staffStep,
  LANE_GEM_FADE,
  LANE_GEM_FAR,
  laneGemOpacity,
  MISSED_LANE_GEM_OPACITY,
} from './helpers';
import { pageStartFor } from './SheetStrip';

const RES = 480;
/** 120 BPM: one beat (480 ticks) is 0.5 s. */
const TEMPOS = [{ tick: 0, beatsPerMinute: 120, msTime: 0 }];

function bars(count: number, delay = 0): TimelineBar[] {
  return Array.from({ length: count }, (_, i) => ({
    measureIdx: i,
    startTick: i * 4 * RES,
    endTick: (i + 1) * 4 * RES,
    start: delay + i * 2,
    end: delay + (i + 1) * 2,
    beats: [0, 1, 2, 3].map((b) => delay + i * 2 + b * 0.5),
    timeSig: [4, 4] as [number, number],
  }));
}

function note(time: number, voice: Voice, i = 0): TimelineNote {
  return {
    id: `${time}:${voice}:${i}`,
    tick: Math.round(time * 2 * RES),
    time,
    prefix: voice,
    voice,
    accent: false,
    ghost: false,
    measureIdx: Math.floor(time / 2),
  };
}

const chart = (sections: { tick: number; name: string }[]) =>
  ({ sections, resolution: RES, tempos: TEMPOS }) as unknown as Parameters<
    typeof buildSections
  >[0];

describe('buildSections', () => {
  it('turns markers into ranges ending at the next marker', () => {
    const s = buildSections(
      chart([
        { tick: 0, name: 'intro' },
        { tick: 8 * RES, name: 'verse_1' },
        { tick: 16 * RES, name: 'Chorus' },
      ]),
      bars(6),
      0.25,
    );

    expect(s.map((x) => x.name)).toEqual(['Intro', 'Verse 1', 'Chorus']);
    expect(s.map((x) => [x.startTick, x.endTick])).toEqual([
      [0, 8 * RES],
      [8 * RES, 16 * RES],
      [16 * RES, 24 * RES],
    ]);
    expect(s[1].start).toBeCloseTo(4.25);
    expect(s[2].end).toBeCloseTo(12.25);
  });

  it('adds a Start section before a late first marker and drops duplicates', () => {
    const s = buildSections(
      chart([
        { tick: 8 * RES, name: 'verse' },
        { tick: 8 * RES, name: 'verse again' },
        { tick: 99 * RES * 4, name: 'past the end' },
      ]),
      bars(4),
      0,
    );

    expect(s.map((x) => x.name)).toEqual(['Start', 'Verse']);
    expect(s[1].endTick).toBe(16 * RES);
  });

  it('falls back to 8-bar chunks without markers', () => {
    const s = buildSections(chart([]), bars(20), 0);

    expect(s.map((x) => x.name)).toEqual([
      'Bars 1–8',
      'Bars 9–16',
      'Bars 17–20',
    ]);
    expect(s[2]).toMatchObject({ startTick: 16 * 4 * RES, start: 32, end: 40 });
  });

  it('is empty without bars', () => {
    expect(buildSections(chart([{ tick: 0, name: 'x' }]), [], 0)).toEqual([]);
  });
});

describe('prettySectionName', () => {
  it('cleans chart section names', () => {
    expect(prettySectionName('prc_chorus_a')).toBe('Chorus a');
    expect(prettySectionName('section Guitar Solo')).toBe('Guitar Solo');
    expect(prettySectionName('  ')).toBe('Section');
  });
});

describe('time lookups', () => {
  const b = bars(4);
  const sections = buildSections(
    chart([
      { tick: 0, name: 'a' },
      { tick: 8 * RES, name: 'b' },
    ]),
    b,
    0,
  );

  it('finds the bar and section at a time, clamped', () => {
    expect(barIndexAt(b, -1)).toBe(0);
    expect(barIndexAt(b, 2)).toBe(1);
    expect(barIndexAt(b, 99)).toBe(3);
    expect(sectionIndexAt(sections, 3.9)).toBe(0);
    expect(sectionIndexAt(sections, 4.001)).toBe(1);
  });

  it('measures beats and progress', () => {
    expect(beatSecondsAt(b, 3)).toBe(0.5);
    expect(beatSecondsAt([], 3)).toBe(0.5);
    expect(songProgress(b, 4)).toBe(0.5);
    expect(songProgress(b, -5)).toBe(0);
  });

  it('walks beats in a window, flagging downbeats', () => {
    const seen: [number, boolean][] = [];

    forEachBeat(b, 1.4, 2.6, (t, down) => seen.push([t, down]));

    expect(seen).toEqual([
      [1.5, false],
      [2, true],
      [2.5, false],
    ]);
  });
});

describe('keyLabel', () => {
  it('shortens key codes', () => {
    expect(keyLabel('KeyJ')).toBe('J');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('F5')).toBe('F5');
  });

  it('labels a pad by its keyboard control only', () => {
    const kit = {
      ...DEFAULT_KITS[0],
      controls: { sn: ['midi:38', 'keyboard:KeyF'], kk: ['midi:36'] },
    };
    const sn = kit.pieces.find((p) => p.id === 'sn') as KitPiece;
    const kk = kit.pieces.find((p) => p.id === 'kk') as KitPiece;

    expect(padKeyLabel(kit, sn, {})).toBe('F');
    expect(padKeyLabel(kit, kk, {})).toBe('');
  });
});

describe('spreadPositions', () => {
  it('keeps positions that are already apart', () => {
    expect(spreadPositions([10, 30, 50], 9, 0, 100)).toEqual([10, 30, 50]);
  });

  it('pushes neighbors apart around the same center', () => {
    const out = spreadPositions([40, 42, 44], 10, 0, 100);

    expect(out).toEqual([32, 42, 52]);
  });

  it('stays inside the bounds and squeezes when it must', () => {
    expect(spreadPositions([1, 2], 10, 0, 100)).toEqual([0, 10]);
    expect(spreadPositions([0, 1, 2], 10, 0, 10)).toEqual([0, 5, 10]);
    expect(spreadPositions([], 10, 0, 10)).toEqual([]);
  });
});

describe('maxNotesInWindow / poolSizes', () => {
  it('counts the busiest window', () => {
    expect(maxNotesInWindow([0, 0.1, 0.2, 1, 1.05], 0.1, 0.1)).toBe(3);
    expect(maxNotesInWindow([], 1, 1)).toBe(0);
  });

  it('sizes a pool per piece with headroom and a floor', () => {
    const kit = DEFAULT_KITS[0];
    const byVoice = pieceByVoice(kit);
    const notes = [
      ...Array.from({ length: 40 }, (_, i) => note(i * 0.125, 'hihat', i)),
      note(1, 'kick'),
    ];
    const sizes = poolSizes(notes, byVoice, 0.2, 1);

    expect(sizes.get('hh')).toBe(10 + 2);
    expect(sizes.get('kk')).toBe(4);
    expect(sizes.has('sn')).toBe(false);
  });
});

describe('lanes', () => {
  const kit = DEFAULT_KITS[0];
  const byVoice = pieceByVoice(kit);
  const notes = [
    note(0, 'kick'),
    note(0, 'hihat'),
    note(0.5, 'snare'),
    note(1, 'crash'),
  ];

  it('gives a lane to every piece the chart lands on, kick apart', () => {
    const lanes = lanePieces(notes, byVoice);

    expect(lanes.kick?.id).toBe('kk');
    expect(lanes.hands.map((p) => p.id)).toEqual(['hh', 'sn', 'cr1']);
  });

  it('routes a second crash to the crash lane', () => {
    const lanes = lanePieces(notes, byVoice);
    const cr2 = kit.pieces.find((p) => p.id === 'cr2') as KitPiece;
    const rd = kit.pieces.find((p) => p.id === 'rd') as KitPiece;

    expect(laneOwner(cr2, lanes)?.id).toBe('cr1');
    expect(laneOwner(rd, lanes)).toBeUndefined();
  });

  it('orders pieces by staff step', () => {
    const hh = byVoice.get('hihat') as KitPiece;
    const kk = byVoice.get('kick') as KitPiece;

    expect(staffStep(hh, byVoice)).toBe(9);
    expect(staffStep(kk, byVoice)).toBe(1);
  });

  it('reports voices the kit cannot play', () => {
    const junior = DEFAULT_KITS[1];
    const noTom3 = {
      ...junior,
      pieces: junior.pieces.filter((p) => p.id !== 'ft'),
    };
    const skipped = skippedVoices(
      [note(0, 'tom3'), note(1, 'tom3'), note(2, 'snare')],
      pieceByVoice(noTom3),
    );

    expect(skipped).toEqual({ names: ['Tom 3'], count: 2 });
    expect(skippedLine(skipped)).toBe(
      'Not on this kit: Tom 3 (2 notes skipped).',
    );
    expect(skippedLine({ names: [], count: 0 })).toBe('');
  });
});

describe('pageStartFor', () => {
  it('pages 4 bars at a time from the origin', () => {
    expect(pageStartFor(0, 0)).toBe(0);
    expect(pageStartFor(5, 0)).toBe(4);
    expect(pageStartFor(9, 6)).toBe(6);
    expect(pageStartFor(10, 6)).toBe(10);
    expect(pageStartFor(2, 6)).toBe(6);
  });
});

describe('laneGemOpacity', () => {
  it('fades in at the far edge, out past the hit line, and dims misses', () => {
    expect(laneGemOpacity(LANE_GEM_FAR, false)).toBe(0);
    expect(laneGemOpacity(0.5, false)).toBe(1);
    expect(laneGemOpacity(-LANE_GEM_FADE / 2, false)).toBeCloseTo(0.5);
    expect(laneGemOpacity(-LANE_GEM_FADE, false)).toBe(0);
    expect(laneGemOpacity(0.5, true)).toBe(MISSED_LANE_GEM_OPACITY);
  });
});
