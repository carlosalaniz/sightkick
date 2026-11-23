import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPlayer,
  AudioPlayerFactory,
  createDefaultPlayer,
  DefaultAudioPlayer,
  TrackConfig,
} from '../audio-player';
import {
  FakeAudioContext,
  FakeGainNode,
  installFetchByByteLength,
  installWebAudio,
} from '../audio-player/test-support';
import { Measure, ParsedChart } from '../../../chart-parser/types';
import { Transport } from './transport';
import { HOLD_FADE_SECONDS } from './constants';

// Wait mode's hold over the real DefaultAudioPlayer on a fake AudioContext:
// the transport's hold states, and how they meet the player's clock and fade.

vi.mock('../click-track/metronome', () => ({
  renderClickBuffers: () => ({ downbeat: {}, beat: {} }),
}));

const TRACKS: TrackConfig[] = [{ name: 'drums', urls: ['d.ogg'] }];
const CHART = {
  resolution: 480,
  tempos: [{ tick: 0, beatsPerMinute: 120, msTime: 0 }],
} as unknown as ParsedChart;
const MEASURES = Array.from({ length: 20 }, (_, i) => ({
  startTick: i * 1920,
  endTick: (i + 1) * 1920,
  timeSig: [4, 4],
  isCompound: false,
})) as unknown as Measure[];
const FADE_MS = HOLD_FADE_SECONDS * 1000;
let frameQueue: FrameRequestCallback[] = [];
let context: FakeAudioContext;

function flushFrame() {
  const callbacks = frameQueue;

  frameQueue = [];
  callbacks.forEach((cb) => cb(0));
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/** Resumes that settle when the test says so, in any order. */
function deferResumes() {
  const pending: (() => void)[] = [];

  context.resume.mockImplementation(
    () =>
      new Promise<void>((done) => {
        pending.push(() => {
          context.state = 'running';
          done();
        });
      }),
  );

  return pending;
}

async function setup(
  createPlayer: AudioPlayerFactory = createDefaultPlayer,
  tracks: TrackConfig[] = TRACKS,
) {
  let player: AudioPlayer | undefined;
  const onError = vi.fn();
  const transport = new Transport({
    trackData: tracks,
    isDev: false,
    createPlayer: (...args) => {
      player = createPlayer(...args);

      return player;
    },
    onEnded: vi.fn(),
    onError,
  });

  transport.setContext({
    chart: CHART,
    measures: MEASURES,
    delaySeconds: 0,
    countInEnabled: false,
    minDurationSeconds: 0,
  });
  await flush();

  if (!player) {
    throw new Error('no player');
  }

  const master = (player as unknown as { masterGain: FakeGainNode }).masterGain;

  return { transport, player, master, onError };
}

/** Plays from the top and runs the context clock to `seconds`. */
async function playTo(transport: Transport, seconds: number) {
  transport.playFromTick(0);
  await flush();
  context.currentTime = seconds;
  flushFrame();
}

async function holdUntilFrozen(transport: Transport) {
  transport.hold();
  vi.advanceTimersByTime(FADE_MS);
  await flush();
}

beforeEach(() => {
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb);

    return frameQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  context = installWebAudio();
  // 100 s of audio per file: decodeAudioData makes one sample per byte at 1 Hz.
  installFetchByByteLength(() => 100);
  // Timers only: animation frames are stepped by hand (flushFrame).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Transport wait-mode hold over the real player', () => {
  it('keeps song time still through a hold, as the suspended player drops its latency', async () => {
    const { transport } = await setup();

    context.outputLatency = 0.2;
    await playTo(transport, 2.2);
    expect(transport.timeStore.get()).toBeCloseTo(2, 6);

    await holdUntilFrozen(transport);
    expect(context.state).toBe('suspended');
    // Suspended, the player reads the bare clock: 0.2 s ahead.
    flushFrame();
    expect(transport.timeStore.get()).toBeCloseTo(2, 6);

    const resumes = deferResumes();

    transport.release();
    flushFrame();
    expect(transport.timeStore.get()).toBeCloseTo(2, 6);

    resumes[0]();
    await flush();
    context.currentTime = 2.21;
    flushFrame();
    expect(transport.timeStore.get()).toBeCloseTo(2.01, 6);
  });

  it('ignores a stale resume when a new hold comes before it settles', async () => {
    const { transport, master } = await setup();

    await playTo(transport, 2);
    await holdUntilFrozen(transport);

    const resumes = deferResumes();

    transport.release();
    // Held again before the first resume settled: frozen again at once.
    transport.hold();
    expect(transport.isHeld).toBe(true);
    expect(context.suspend).toHaveBeenCalledTimes(2);
    transport.release();

    const rampsBefore = master.gain.ramps.length;

    // The first resume settles, but the context is suspended again behind
    // it: it must not fade the song in or end the hold's frozen time.
    resumes[0]();
    context.state = 'suspended';
    await flush();
    expect(master.gain.ramps).toHaveLength(rampsBefore);
    context.currentTime = 2.5;
    flushFrame();
    expect(transport.timeStore.get()).toBeCloseTo(2, 6);

    resumes[1]();
    await flush();
    expect(master.gain.ramps.at(-1)?.value).toBe(1);
  });

  it('never freezes once a pause has ended the hold during its fade', async () => {
    const { transport, master } = await setup();

    await playTo(transport, 2);
    transport.hold();
    transport.pause();
    // The pause suspends the context itself.
    expect(context.suspend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FADE_MS * 2);
    expect(context.suspend).toHaveBeenCalledTimes(1);
    expect(transport.isHeld).toBe(false);
    expect(master.gain.value).toBe(1);
  });

  it('never freezes once a seek has ended the hold during its fade', async () => {
    const { transport } = await setup();

    await playTo(transport, 2);
    transport.hold();
    transport.seekSeconds(5);
    vi.advanceTimersByTime(FADE_MS * 2);
    await flush();

    expect(context.suspend).not.toHaveBeenCalled();
    expect(transport.isHeld).toBe(false);
    expect(transport.getSnapshot().isPlaying).toBe(true);
  });

  it('never freezes a song that ended during the fade', async () => {
    const { transport, player, master } = await setup();

    await playTo(transport, 2);
    transport.hold();

    const real = player as DefaultAudioPlayer;

    real.audioTracks.forEach((track) => Object.assign(track, { ended: true }));
    real.trackEndedListener();
    expect(transport.getSnapshot().isEnded).toBe(true);

    vi.advanceTimersByTime(FADE_MS * 2);
    expect(context.suspend).not.toHaveBeenCalled();
    expect(transport.isHeld).toBe(false);
    expect(master.gain.value).toBe(1);
  });

  it('parks at the frozen time and restores the volume when paused while frozen', async () => {
    const { transport, master } = await setup();

    context.outputLatency = 0.2;
    await playTo(transport, 3.2);
    await holdUntilFrozen(transport);
    expect(master.gain.value).toBe(0);

    transport.pause();

    expect(transport.getSnapshot().state).toBe('parked');
    expect(transport.isHeld).toBe(false);
    // Not the suspended player's latency-free 3.2.
    expect(transport.timeStore.get()).toBeCloseTo(3, 6);
    expect(master.gain.value).toBe(1);
  });

  it('starts a seek out of a hold silent and fades in at the start time', async () => {
    const { transport, player, master } = await setup();

    await playTo(transport, 2);
    await holdUntilFrozen(transport);

    transport.seekSeconds(1);
    expect(transport.isHeld).toBe(false);
    expect(master.gain.value).toBe(0);
    await flush();

    expect(context.state).toBe('running');
    expect(transport.getSnapshot().isPlaying).toBe(true);
    expect(transport.timeStore.get()).toBe(1);

    const fadeIn = master.gain.ramps.at(-1);
    const startAt = player.contextTimeForSongTime(1);

    expect(fadeIn?.value).toBe(1);
    expect(fadeIn?.time).toBeCloseTo(startAt + HOLD_FADE_SECONDS, 6);
  });
});
