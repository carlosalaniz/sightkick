import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../../../hooks/test-support';
import { DEFAULT_KITS, pieceByVoice } from '../../../../kit';
import { JudgedHit } from '../../../../services/engine';
import { TimeStore } from '../../../../services/time-store';
import { PlaySession } from '../../session';
import { LessonView } from '../LessonView';
import { makeBars, rockBar, TICKS_PER_BAR } from './fixtures';
import { LIMB_TRACK_GAIN } from './steps';

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

  it('turns the kit pieces you play down to a guide when the drums are split', () => {
    const { session } = makeSession({
      kitStems: ['kick', 'snare', 'hihat'],
    });

    render(<LessonView session={session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));

    const calls = vi.mocked(session.setStemScale).mock.calls;
    const last = (name: string) =>
      calls.filter(([n]) => n === name).at(-1)?.[1];

    expect(last('kick')).toBe(LIMB_TRACK_GAIN);
    expect(last('hihat')).toBe(LIMB_TRACK_GAIN);
    expect(last('snare')).toBe(1);
    expect(calls.some(([n]) => n === 'drums')).toBe(false);
  });

  /** Holds on the hi-hat + kick chord at `at` s, then hits it. */
  const holdChord = (runUp: boolean, at = 0) => {
    localStorage.setItem('settings.v7.runUp', JSON.stringify(runUp));

    const ctx = makeSession({ isPlaying: true });

    // A seek (the run-up) ends the hold.
    vi.mocked(ctx.session.seekSeconds).mockImplementation(() => {
      ctx.engine.isHeld = false;
    });

    render(<LessonView session={ctx.session} />);
    fireEvent.click(screen.getByText('3 · Hi-hat + kick'));
    fireEvent.click(screen.getByTestId('wait-mode'));

    const mineSoFar = notes.filter(
      (n) => (n.voice === 'hihat' || n.voice === 'kick') && n.time <= at,
    );
    const first = mineSoFar.find((n) => n.time === at)!;

    // Everything before it was played in time.
    mineSoFar
      .filter((n) => n.time < at)
      .forEach((n) =>
        ctx.hit({ tick: n.tick, prefixes: [n.prefix], offsetSeconds: 0 }),
      );

    const chord = notes.filter(
      (n) => n.tick === first.tick && ['hihat', 'kick'].includes(n.voice),
    );

    // Inside the 60 ms grace the song keeps going.
    playThrough(ctx.timeStore, first.time - 0.1, first.time + 0.055);

    expect(ctx.engine.hold).not.toHaveBeenCalled();

    playThrough(ctx.timeStore, first.time + 0.06, first.time + 0.09);

    expect(ctx.engine.hold).toHaveBeenCalled();
    expect(screen.getByTestId('waiting-for')).toHaveTextContent('Waiting for');
    expect(screen.getByTestId('wait-count')).toHaveTextContent('1');

    ctx.engine.isHeld = true;

    const releasesBefore = ctx.engine.release.mock.calls.length;

    chord.forEach((n) =>
      ctx.hit({ tick: n.tick, prefixes: [n.prefix], offsetSeconds: 0 }),
    );
    playThrough(ctx.timeStore, first.time + 0.09, first.time + 0.12);

    return {
      ...ctx,
      first,
      released: ctx.engine.release.mock.calls.length > releasesBefore,
    };
  };

  it('holds playback on your next note in wait mode until it is hit', () => {
    const { released, session } = holdChord(false);

    expect(released).toBe(true);
    expect(session.seekSeconds).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waiting-for')).toBeNull();
    expect(screen.getByTestId('timing-strip')).toBeInTheDocument();
    expect(screen.getByTestId('wait-stats')).toBeInTheDocument();
    expect(screen.queryByTestId('tempo-bar')).toBeNull();
  });

  it('backs up a beat after a hold so the note is played again in time', () => {
    // Beat 3 of the first bar: the run-up starts on beat 2.
    const { released, session } = holdChord(true, 1);

    expect(released).toBe(false);
    expect(session.seekSeconds).toHaveBeenCalledWith(0.5);
    expect(screen.getByTestId('run-up-for')).toHaveTextContent('Now in time');
  });

  it('just carries on when there is no room for a run-up', () => {
    const { released, session } = holdChord(true, 0);

    expect(released).toBe(true);
    expect(session.seekSeconds).not.toHaveBeenCalled();
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

  it('opens on saved progress that lost its stars instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    localStorage.setItem(
      'settings.v7.progress',
      JSON.stringify({ 'song-1': { seen: { b0: true }, lesson: 'b4' } }),
    );
    localStorage.setItem('settings.v7.waitGraceMs', '45');
    render(<LessonView session={makeSession().session} />);

    expect(screen.getByText('Verse').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(localStorage.getItem('settings.v7.waitGraceMs')).toBe('60');
    warn.mockRestore();
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
