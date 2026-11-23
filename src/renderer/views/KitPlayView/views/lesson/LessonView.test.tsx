import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../../../hooks/test-support';
import { DEFAULT_KITS, pieceByVoice } from '../../../../kit';
import { JudgedHit } from '../../../../services/engine';
import { TimeStore } from '../../../../services/time-store';
import { PlaySession } from '../../session';
import { LessonView } from '../LessonView';
import { makeBars, rockBar, TICKS_PER_BAR } from './fixtures';

const bars = makeBars(12);
const notes = Array.from({ length: 12 }, (_, i) => rockBar(i)).flat();

function makeSession(over: Partial<PlaySession> = {}) {
  const judged = new Set<(hit: JudgedHit) => void>();
  const engine = {
    setLoopRegion: vi.fn(),
    setStemVolume: vi.fn(),
    hold: vi.fn(),
    release: vi.fn(),
    isHeld: false,
    hasDrumStem: true,
    hitTolerance: 0.1,
    isHit: () => false,
    onJudged: (l: (hit: JudgedHit) => void) => {
      judged.add(l);

      return () => judged.delete(l);
    },
  };
  const kit = DEFAULT_KITS[0];
  const timeStore = new TimeStore();
  const session = {
    song: { id: 'song-1' },
    chart: {
      sections: [
        { tick: 0, name: 'intro' },
        { tick: 4 * TICKS_PER_BAR, name: 'verse' },
      ],
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
    duration: 24,
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
    setStemScale: vi.fn(),
    kitStems: [],
    onEnded: () => () => {},
    strikePiece: vi.fn(),
    ...over,
  } as unknown as PlaySession;

  return {
    session,
    engine,
    timeStore,
    hit: (h: Pick<JudgedHit, 'tick' | 'prefixes' | 'offsetSeconds'>) =>
      judged.forEach((l) => l(h as JudgedHit)),
  };
}

/** Plays from `from` to `to` seconds in 20 ms frames. */
function playThrough(timeStore: TimeStore, from: number, to: number) {
  for (let t = from; t < to; t += 0.02) {
    timeStore.set(t);
    act(() => {
      vi.advanceTimersByTime(17);
    });
  }
}

describe('LessonView', () => {
  beforeEach(() => {
    installLocalStorage();
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loops the first lesson and restores the engine on unmount', () => {
    const { session, engine } = makeSession();
    const view = render(<LessonView session={session} />);

    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Verse')).toBeInTheDocument();
    expect(screen.getByText('Listen · 80% speed')).toBeInTheDocument();
    expect(engine.setLoopRegion).toHaveBeenLastCalledWith({
      startTick: 0,
      endTick: 4 * TICKS_PER_BAR,
    });
    expect(session.setStemScale).toHaveBeenLastCalledWith('drums', 1);
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(0.8);

    view.unmount();

    expect(engine.setLoopRegion).toHaveBeenLastCalledWith(undefined);
    expect(session.setStemScale).toHaveBeenLastCalledWith('drums', 1);
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(1);
  });

  it('mutes only the kit pieces you play when the drums are split', () => {
    const { session } = makeSession({
      kitStems: ['kick', 'snare', 'hihat'],
    });

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));

    const calls = vi.mocked(session.setStemScale).mock.calls;
    const last = (name: string) =>
      calls.filter(([n]) => n === name).at(-1)?.[1];

    expect(last('kick')).toBe(0);
    expect(last('hihat')).toBe(0);
    expect(last('snare')).toBe(1);
    expect(calls.some(([n]) => n === 'drums')).toBe(false);
  });

  it('holds playback on your next note in wait mode until it is hit', () => {
    const { session, engine, timeStore, hit } = makeSession({
      isPlaying: true,
    });

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));
    fireEvent.click(screen.getByTestId('wait-mode'));

    const first = notes
      .filter((n) => n.voice === 'hihat' || n.voice === 'kick')
      .sort((a, b) => a.time - b.time)[0];
    const chord = notes.filter(
      (n) => n.tick === first.tick && ['hihat', 'kick'].includes(n.voice),
    );

    // Inside the 60 ms grace the song keeps going.
    playThrough(timeStore, first.time - 0.1, first.time + 0.02);

    expect(engine.hold).not.toHaveBeenCalled();

    playThrough(timeStore, first.time + 0.02, first.time + 0.05);

    expect(engine.hold).toHaveBeenCalled();
    expect(screen.getByTestId('waiting-for')).toHaveTextContent('Waiting for');

    engine.isHeld = true;
    chord.forEach((n) =>
      hit({ tick: n.tick, prefixes: [n.prefix], offsetSeconds: 0 }),
    );
    playThrough(timeStore, first.time + 0.05, first.time + 0.07);

    expect(engine.release).toHaveBeenCalled();
    expect(screen.queryByTestId('waiting-for')).toBeNull();
    expect(screen.getByTestId('timing-strip')).toBeInTheDocument();
    expect(screen.getByTestId('tempo-bar')).toHaveAttribute(
      'data-verdict',
      'off',
    );
  });

  it('lets the player change the tempo', () => {
    const { session } = makeSession();

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByTestId('tempo-down'));

    expect(screen.getByText('Listen · 75% speed')).toBeInTheDocument();
    expect(session.setPlaybackSpeed).toHaveBeenLastCalledWith(0.75);
    expect(screen.getByText('no star below 80%')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tempo-up'));
    fireEvent.click(screen.getByTestId('tempo-up'));

    expect(screen.getByText('Listen · 85% speed')).toBeInTheDocument();
  });

  it('moves from listen to count after one full pass', () => {
    const { session, timeStore } = makeSession();

    render(<LessonView session={session} />);
    playThrough(timeStore, 0, 8);
    // Loop wrap.
    playThrough(timeStore, 0, 0.1);

    expect(screen.getByText('Count out loud · 80% speed')).toBeInTheDocument();
  });

  it('scores only the step voices and moves on after a clean pass', () => {
    const { session, timeStore, hit } = makeSession();

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));

    expect(session.playFromTick).toHaveBeenCalledWith(0);
    expect(session.setStemScale).toHaveBeenLastCalledWith('drums', 0.35);

    const mine = notes.filter(
      (n) => n.measureIdx < 4 && (n.voice === 'hihat' || n.voice === 'kick'),
    );

    for (let t = 0; t < 8; t += 0.02) {
      timeStore.set(t);

      for (const n of mine) {
        if (n.time >= t && n.time < t + 0.02) {
          hit({ tick: n.tick, prefixes: [n.prefix], offsetSeconds: 0.01 });
        }
      }

      act(() => {
        vi.advanceTimersByTime(17);
      });
    }

    playThrough(timeStore, 0, 0.1);

    const last = within(screen.getByText('Last pass').closest('section')!);

    expect(last.getByText('100%')).toBeInTheDocument();
    expect(
      screen.getByText('40 on time · 0 close · 0 off · 0 missed'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hi-hat + snare · 80% speed')).toBeInTheDocument();
  });

  it('does not score a restart in the middle of a pass', () => {
    const { session, timeStore } = makeSession();

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));
    playThrough(timeStore, 0, 4);
    playThrough(timeStore, 0, 0.1);

    expect(screen.getByText('Hi-hat + kick · 80% speed')).toBeInTheDocument();
    expect(screen.queryByText('target 85%')).not.toBeInTheDocument();
  });

  it('remembers the lesson per song', () => {
    const { session } = makeSession();
    const view = render(<LessonView session={session} />);

    fireEvent.click(screen.getByText('Verse'));
    view.unmount();

    expect(
      JSON.parse(localStorage.getItem('settings.v7.progress') ?? '{}'),
    ).toEqual({
      'song-1': { stars: {}, seen: {}, lesson: 'b4' },
    });

    render(<LessonView session={makeSession().session} />);

    expect(screen.getByText('Verse').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
