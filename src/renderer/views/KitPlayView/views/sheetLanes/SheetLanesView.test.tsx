import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { installLocalStorage } from '../../../../hooks/test-support';
import {
  DEFAULT_KITS,
  pieceByVoice,
  TimelineBar,
  TimelineNote,
} from '../../../../kit';
import { JudgedHit } from '../../../../services/engine';
import { TimeStore } from '../../../../services/time-store';
import { PlaySession } from '../../session';
import { SheetLanesView } from '../SheetLanesView';

const bars: TimelineBar[] = Array.from({ length: 8 }, (_, i) => ({
  measureIdx: i,
  startTick: i * 1920,
  endTick: (i + 1) * 1920,
  start: i * 2,
  end: (i + 1) * 2,
  beats: [0, 0.5, 1, 1.5].map((b) => i * 2 + b),
  timeSig: [4, 4],
}));
// A snare on every beat of bars 2–7 (the loop defaults to bars 2–5).
const notes: TimelineNote[] = bars.slice(1).flatMap((b) =>
  [0, 1, 2, 3].map((k) => ({
    id: `${b.startTick + k * 480}:c/5`,
    tick: b.startTick + k * 480,
    time: b.start + k * 0.5,
    prefix: 'c/5',
    voice: 'snare' as const,
    accent: false,
    ghost: false,
    measureIdx: b.measureIdx,
  })),
);

function fakeSession() {
  const kit = DEFAULT_KITS[0];
  const timeStore = new TimeStore();
  const judged = new Set<(hit: JudgedHit) => void>();
  const engine = {
    hitTolerance: 0.1,
    isHit: () => false,
    setLoopRegion: vi.fn(),
    onJudged: (l: (hit: JudgedHit) => void) => {
      judged.add(l);

      return () => judged.delete(l);
    },
  };
  const session = {
    song: { id: 'song-1' },
    chart: { sections: [] },
    notes,
    bars,
    kit,
    mapping: {},
    pieceByVoice: pieceByVoice(kit),
    engine,
    timeStore,
    isPlaying: true,
    isCounting: false,
    playbackSpeed: 0.8,
    setPlaybackSpeed: vi.fn(),
    clickVolume: 0,
    setClickVolume: vi.fn(),
    playFromTick: vi.fn(),
    strikePiece: vi.fn(),
  } as unknown as PlaySession;
  const hit = (note: TimelineNote, offsetSeconds: number) =>
    judged.forEach((l) =>
      l({
        tick: note.tick,
        prefixes: [note.prefix],
        offsetSeconds,
      } as JudgedHit),
    );

  return { session, engine, timeStore, hit };
}

const frame = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );

describe('SheetLanesView', () => {
  beforeEach(() => installLocalStorage());

  it('loops the first 4 bars with notes at the ladder speed', async () => {
    const { session, engine } = fakeSession();
    const { container } = render(<SheetLanesView session={session} />);

    await frame();

    expect(engine.setLoopRegion).toHaveBeenLastCalledWith({
      startTick: 1920,
      endTick: 5 * 1920,
    });
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(0.8);
    expect(screen.getByText('Bars 2–5')).toBeInTheDocument();
    // Staff bars near the playhead are built, not the whole song.
    expect(container.querySelectorAll('ellipse').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('ellipse').length).toBeLessThan(
      notes.length,
    );
  });

  it('scores a pass when the loop wraps and moves the ladder', async () => {
    const { session, timeStore, hit } = fakeSession();

    render(<SheetLanesView session={session} />);
    await frame();

    const loopNotes = notes.filter((n) => n.measureIdx < 5);

    for (const n of loopNotes) {
      timeStore.set(n.time + 0.008);
      hit(n, 0.008);
      await frame();
    }

    timeStore.set(9.9);
    await frame();
    timeStore.set(2.02);
    await frame();

    expect(screen.getByText('Pass 1 · 80% tempo')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(
      screen.getByText('Clean pass. One more moves you to 85%.'),
    ).toBeInTheDocument();
  });

  it('counts notes left open at the wrap as misses', async () => {
    const { session, timeStore } = fakeSession();

    render(<SheetLanesView session={session} />);
    await frame();
    timeStore.set(2);
    await frame();
    timeStore.set(9.9);
    await frame();
    timeStore.set(2.02);
    await frame();

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(
      screen.getByText('Rough pass. Another one drops the tempo.'),
    ).toBeInTheDocument();
  });

  it('credits an early hit on the first note to the next pass', async () => {
    const { session, timeStore, hit } = fakeSession();

    render(<SheetLanesView session={session} />);
    await frame();
    timeStore.set(2);
    await frame();
    timeStore.set(9.95);
    hit(notes[0], -0.05);
    await frame();
    timeStore.set(2.02);
    await frame();

    // Pass 1 had no hits; the early hit opens pass 2 instead.
    expect(screen.getByText('0%')).toBeInTheDocument();

    for (const n of notes.filter((x) => x.measureIdx < 5).slice(1)) {
      timeStore.set(n.time);
      hit(n, 0);
      await frame();
    }

    timeStore.set(9.9);
    await frame();
    timeStore.set(2.02);
    await frame();

    expect(screen.getByText('Pass 2 · 80% tempo')).toBeInTheDocument();
    // 15 perfect + the early hit (-50 ms song time at 80% = -62.5 ms, Good).
    expect(screen.getByText('98%')).toBeInTheDocument();
  });

  it('plays the next unseen bars sheet only at 100% and logs the pass', async () => {
    const { session, engine, timeStore } = fakeSession();

    render(<SheetLanesView session={session} />);
    await frame();
    fireEvent.click(screen.getByText('Next unseen bars'));
    await frame();

    expect(engine.setLoopRegion).toHaveBeenLastCalledWith({
      startTick: 5 * 1920,
      endTick: 8 * 1920,
    });
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(1);
    expect(
      screen.getByText('Unseen bars · sheet only · 100%'),
    ).toBeInTheDocument();

    timeStore.set(10);
    await frame();
    timeStore.set(15.9);
    await frame();
    timeStore.set(10.02);
    await frame();

    expect(screen.getByText('#1 · Bars 6–8')).toBeInTheDocument();
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(0.8);
    expect(
      screen.queryByText('Unseen bars · sheet only · 100%'),
    ).not.toBeInTheDocument();
  });
});
