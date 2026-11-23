import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../../../hooks/test-support';
import {
  DEFAULT_KITS,
  pieceByVoice,
  TimelineBar,
  TimelineNote,
} from '../../../../kit';
import { JudgedHit } from '../../../../services/engine';
import { TimeStore } from '../../../../services/time-store/time-store';
import { ScoreData } from '../../../../../types';
import { PlaySession } from '../../session';
import { KitHighwayView } from '../KitHighwayView';
import { LanesView } from '../LanesView';
import { RailsView } from '../RailsView';

const RES = 480;
const PREFIX = {
  kick: 'f/4',
  snare: 'c/5',
  hihat: 'g/5',
  crash: 'a/5',
} as const;

function makeSession() {
  const kit = DEFAULT_KITS[0];
  const bars: TimelineBar[] = Array.from({ length: 8 }, (_, i) => ({
    measureIdx: i,
    startTick: i * 4 * RES,
    endTick: (i + 1) * 4 * RES,
    start: i * 2,
    end: (i + 1) * 2,
    beats: [0, 1, 2, 3].map((b) => i * 2 + b * 0.5),
    timeSig: [4, 4],
  }));
  const notes: TimelineNote[] = [];

  for (let beat = 0; beat < 32; beat += 1) {
    const voices: (keyof typeof PREFIX)[] = [
      'hihat',
      beat % 2 ? 'snare' : 'kick',
    ];

    if (beat % 16 === 0) {
      voices.push('crash');
    }

    for (const voice of voices) {
      const tick = beat * RES;

      notes.push({
        id: `${tick}:${PREFIX[voice]}`,
        tick,
        time: beat * 0.5,
        prefix: PREFIX[voice],
        voice,
        accent: false,
        ghost: false,
        measureIdx: Math.floor(beat / 4),
      });
    }
  }

  notes.sort((a, b) => a.time - b.time || a.prefix.localeCompare(b.prefix));

  const judged = new Set<(hit: JudgedHit) => void>();
  const ended = new Set<(score: ScoreData) => void>();
  const timeStore = new TimeStore();
  const engine = {
    hitTolerance: 0.1,
    hasDrumStem: false,
    onJudged: (l: (hit: JudgedHit) => void) => {
      judged.add(l);

      return () => judged.delete(l);
    },
    isHit: () => false,
    setStemVolume: vi.fn(),
    setLoopRegion: vi.fn(),
  };
  const session = {
    song: { name: 'Test song', artist: 'Band', audio: [] },
    chart: {
      sections: [
        { tick: 0, name: 'intro' },
        { tick: 16 * RES, name: 'verse_1' },
      ],
      resolution: RES,
      tempos: [{ tick: 0, beatsPerMinute: 120, msTime: 0 }],
    },
    measures: [],
    delaySeconds: 0,
    notes,
    bars,
    kit,
    mapping: {},
    pieceByVoice: pieceByVoice(kit),
    engine,
    timeStore,
    duration: 16,
    isReady: true,
    isPlaying: true,
    isCounting: false,
    isEnded: false,
    countInBeat: undefined,
    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    playFromTick: vi.fn(),
    seekSeconds: vi.fn(),
    setLoopRegion: vi.fn(),
    playbackSpeed: 1,
    setPlaybackSpeed: vi.fn(),
    clickVolume: 0,
    setClickVolume: vi.fn(),
    onEnded: (l: (score: ScoreData) => void) => {
      ended.add(l);

      return () => {
        ended.delete(l);
      };
    },
    strikePiece: vi.fn(),
  } as unknown as PlaySession;

  return {
    session,
    hit: (note: TimelineNote, offsetSeconds: number) =>
      judged.forEach((l) =>
        l({
          pos: { measureIdx: 0, noteIdx: 0 },
          tick: note.tick,
          prefixes: [note.prefix],
          offsetSeconds,
          controlId: 'keyboard:KeyF',
          value: 100,
        }),
      ),
    end: () => ended.forEach((l) => l({ totalNotes: 0, falseHits: 0 })),
  };
}

let frames: FrameRequestCallback[] = [];

function runFrames(n = 1) {
  for (let i = 0; i < n; i += 1) {
    const queue = frames;

    frames = [];
    act(() => queue.forEach((cb) => cb(performance.now() + 1000 * i)));
  }
}

beforeEach(() => {
  installLocalStorage();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);

    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ['Play', KitHighwayView],
  ['v12 rails', RailsView],
  ['v13 lanes', LanesView],
])('%s', (_name, View) => {
  it('scores real judgments, shows gems, the sheet strip and the results', () => {
    const { session, hit, end } = makeSession();
    const { container } = render(<View session={session} />);

    session.timeStore.set(1);
    runFrames(2);

    // Gems in the visible window are placed, not every note in the chart.
    const shown = container.querySelectorAll('g[display="inline"]').length;

    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(session.notes.length);

    // Sheet strip: noteheads for the first 4 bars, playhead and label.
    expect(
      screen.getByLabelText('Sheet music for the current bars'),
    ).toBeTruthy();
    expect(screen.getByText(/Intro · Bars 1–4/)).toBeTruthy();

    const snare = session.notes.find(
      (n) => n.voice === 'snare' && n.time > 1,
    ) as TimelineNote;

    act(() => hit(snare, 0.01));
    runFrames(2);

    expect(screen.getAllByText('100').length).toBeGreaterThan(0);

    // The loop select offers the chart's real sections.
    expect(container.textContent).toContain('Whole song');

    act(() => end());

    expect(screen.getByText(/Full combo|Song complete/)).toBeTruthy();
    expect(screen.getByText('Play again')).toBeTruthy();
  });
});
