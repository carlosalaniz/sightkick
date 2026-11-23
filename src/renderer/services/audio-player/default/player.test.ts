import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultAudioPlayer } from './player';
import { TrackConfig } from '../types';
import { log } from '../../../../shared/log';
import {
  FakeAudioContext,
  FakeGainNode,
  installFetchByByteLength,
  installWebAudio,
} from '../test-support';

const trimSpy = vi.hoisted(() =>
  vi.fn(
    (
      buffer: unknown,
      _context?: unknown,
      _threshold?: number,
      _minDurationSeconds?: number,
    ) => buffer,
  ),
);

vi.mock('../helpers', () => ({
  trimTrailingSilence: trimSpy,
}));

let context: FakeAudioContext;
const DURATIONS: Record<string, number> = {
  'drums.ogg': 300,
  'song.ogg': 500,
};
const TRACKS: TrackConfig[] = [
  { name: 'drums', urls: ['drums.ogg'] },
  { name: 'song', urls: ['song.ogg'] },
];

async function makePlayer(tracks: TrackConfig[] = TRACKS, onEnded = vi.fn()) {
  const player = new DefaultAudioPlayer(tracks, onEnded);

  await player.ready;
  await Promise.resolve();

  return { player, onEnded };
}

beforeEach(() => {
  context = installWebAudio();
  installFetchByByteLength((url) => DURATIONS[url] ?? 100);
  trimSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AudioPlayer', () => {
  it('fetches, decodes and exposes the longest track as the duration', async () => {
    const { player } = await makePlayer();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(player.audioTracks).toHaveLength(2);
    expect(player.duration).toBe(500);
  });

  it('routes every track through a master gain node wired to the destination', async () => {
    const { player } = await makePlayer();
    const master = player.masterGain as unknown as FakeGainNode;

    expect(master.connectedTo).toContain(context.destination);
    context.gainNodes
      .filter((node) => node !== master)
      .forEach((node) => {
        expect(node.connectedTo).toContain(master);
        expect(node.connectedTo).not.toContain(context.destination);
      });
  });

  it('sets the master gain at the current time', async () => {
    const { player } = await makePlayer();
    const master = player.masterGain as unknown as FakeGainNode;

    context.currentTime = 3.5;
    player.setMasterVolume(0.4);

    expect(master.gain.value).toBe(0.4);
    expect(master.gain.calls.at(-1)).toEqual({ value: 0.4, time: 3.5 });
  });

  it('disconnects the master gain node on destroy', async () => {
    const { player } = await makePlayer();
    const master = player.masterGain as unknown as FakeGainNode;

    player.destroy();

    expect(master.disconnected).toBe(true);
  });

  it('trims each decoded buffer with the provided minimum duration', async () => {
    const player = new DefaultAudioPlayer(TRACKS, vi.fn(), () => 12.5);

    await player.ready;
    await Promise.resolve();

    expect(trimSpy).toHaveBeenCalledTimes(2);
    trimSpy.mock.calls.forEach((call) => expect(call[3]).toBe(12.5));
  });

  it('defaults the minimum duration to zero when no getter is given', async () => {
    await makePlayer();

    expect(trimSpy).toHaveBeenCalled();
    trimSpy.mock.calls.forEach((call) => expect(call[3]).toBe(0));
  });

  it('resumes a suspended context and starts every track on play', async () => {
    const { player } = await makePlayer();

    context.state = 'suspended';
    context.currentTime = 10;
    await player.start(2);

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(player.isInitialised).toBe(true);
    context.bufferSources.forEach((source) =>
      expect(source.starts.at(-1)).toEqual({ at: 10, offset: 2 }),
    );
  });

  it('schedules sources only after the suspended context has resumed', async () => {
    const { player } = await makePlayer();

    context.state = 'suspended';
    context.currentTime = 4;

    const started = player.start(1);

    expect(player.isInitialised).toBe(false);
    expect(context.bufferSources).toHaveLength(0);

    await started;

    expect(player.isInitialised).toBe(true);
    expect(context.bufferSources.length).toBeGreaterThan(0);
    context.bufferSources.forEach((source) =>
      expect(source.starts.at(-1)).toEqual({ at: 4, offset: 1 }),
    );
  });

  it('stops the running playback before starting again', async () => {
    const { player } = await makePlayer();

    player.start(0);

    const firstSources = [...context.bufferSources];

    player.start(0);

    firstSources.forEach((source) => expect(source.stopped).toBe(true));
  });

  it('reports currentTime as elapsed time plus the offset, minus latency', async () => {
    const { player } = await makePlayer();

    context.outputLatency = 0.05;
    context.currentTime = 0;
    player.start(2);

    context.currentTime = 5;

    expect(player.currentTime).toBeCloseTo(5 + 2 - 0.05, 5);
  });

  it('clamps currentTime to the offset and returns zero before starting', async () => {
    const { player } = await makePlayer();

    expect(player.currentTime).toBe(0);

    context.currentTime = 0;
    player.start(3);

    expect(player.currentTime).toBe(3);
  });

  it('suspends the context on pause', async () => {
    const { player } = await makePlayer();

    player.pause();

    expect(context.suspend).toHaveBeenCalledTimes(1);
  });

  it('only fires onEnded once every track has ended', async () => {
    const { player, onEnded } = await makePlayer();

    player.audioTracks[0].ended = true;
    player.trackEndedListener();
    expect(onEnded).not.toHaveBeenCalled();

    player.audioTracks[1].ended = true;
    player.trackEndedListener();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(player.isInitialised).toBe(false);
  });

  it('closes the context and drops tracks on destroy', async () => {
    const { player, onEnded } = await makePlayer();

    player.destroy();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(player.audioTracks).toHaveLength(0);
    expect(player.onEnded).toBeNull();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('applies loop bounds to buffer sources and wraps currentTime across loop passes', async () => {
    const { player } = await makePlayer();

    player.setLoop({ start: 2, end: 4 });
    player.start(2);

    context.bufferSources.forEach((source) => {
      expect(source.loop).toBe(true);
      expect(source.loopStart).toBe(2);
      expect(source.loopEnd).toBe(4);
    });

    context.currentTime = 3.3;
    expect(player.currentTime).toBeCloseTo(3.3, 5);
  });

  it('decodes one file at a time so a fully split song never holds every stem twice', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const decode = context.decodeAudioData.bind(context);

    context.decodeAudioData = async (data: ArrayBuffer) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      inFlight -= 1;

      return decode(data);
    };

    const { player } = await makePlayer([
      { name: 'drums', urls: ['drums.ogg', 'song.ogg'] },
      { name: 'bass', urls: ['bass.ogg'] },
      { name: 'vocals', urls: ['vocals.ogg'] },
    ]);

    expect(maxInFlight).toBe(1);
    expect(player.audioTracks.map((t) => t.name)).toEqual([
      'drums',
      'bass',
      'vocals',
    ]);
  });

  it('reads song time from the output timestamp, which moves every frame', async () => {
    const { player } = await makePlayer();

    context.currentTime = 10;
    await player.start(2);
    vi.spyOn(performance, 'now').mockReturnValue(5030);
    Object.assign(context, {
      // 10.2 s reached the speakers at 5000 ms; 30 ms have passed since.
      getOutputTimestamp: () => ({ contextTime: 10.2, performanceTime: 5000 }),
    });
    context.currentTime = 10.3;

    expect(player.currentTime).toBeCloseTo(2 + 0.23, 6);
  });

  it('falls back to the clock minus latency without a fresh output timestamp', async () => {
    const { player } = await makePlayer();

    context.currentTime = 10;
    await player.start(2);
    context.outputLatency = 0.05;
    context.currentTime = 10.3;
    vi.spyOn(performance, 'now').mockReturnValue(9000);
    Object.assign(context, {
      // From before a suspend: four seconds old.
      getOutputTimestamp: () => ({ contextTime: 10.1, performanceTime: 5000 }),
    });

    expect(player.currentTime).toBeCloseTo(2 + 0.25, 6);

    context.state = 'suspended';

    expect(player.currentTime).toBeCloseTo(2 + 0.3, 6);
  });

  it('fades relative to the master volume and keeps it', async () => {
    const { player } = await makePlayer();
    const master = player.masterGain as unknown as FakeGainNode;

    player.setMasterVolume(0.5);
    player.fadeTo(0, 0.012);
    expect(master.gain.ramps.at(-1)?.value).toBe(0);

    player.setMasterVolume(0.8);
    expect(master.gain.value).toBe(0);

    player.fadeTo(1, 0.012);
    expect(master.gain.ramps.at(-1)?.value).toBe(0.8);
  });

  it('never lets song time step back when a fresh output stamp lands behind the estimate', async () => {
    const { player } = await makePlayer();

    context.currentTime = 10;
    await player.start(2);
    context.outputLatency = 0.05;
    context.currentTime = 10.3;
    // No stamp yet: the clock minus latency, 10.25.
    expect(player.currentTime).toBeCloseTo(2.25, 6);

    vi.spyOn(performance, 'now').mockReturnValue(5010);
    Object.assign(context, {
      // A fresh stamp puts the audible time at 10.21: behind the 10.25 shown.
      getOutputTimestamp: () => ({ contextTime: 10.2, performanceTime: 5000 }),
    });
    expect(player.currentTime).toBeCloseTo(2.25, 6);

    context.currentTime = 10.4;
    vi.spyOn(performance, 'now').mockReturnValue(5100);
    expect(player.currentTime).toBeCloseTo(2.3, 6);
  });

  describe('freeze and thaw', () => {
    beforeEach(() => {
      vi.spyOn(log, 'error').mockImplementation(() => {});
    });

    it('suspends and resumes the context', async () => {
      const { player } = await makePlayer();

      await expect(player.freeze()).resolves.toBe('frozen');
      expect(context.state).toBe('suspended');
      await expect(player.thaw()).resolves.toBe('resumed');
      expect(context.state).toBe('running');
      expect(log.error).not.toHaveBeenCalled();
    });

    it('names a rejected suspend or resume and logs the browser error', async () => {
      const { player } = await makePlayer();
      const error = new DOMException('device lost', 'InvalidStateError');

      context.suspend.mockImplementation(() => Promise.reject(error));
      context.resume.mockImplementation(() => Promise.reject(error));

      await expect(player.freeze()).resolves.toBe('failed');
      await expect(player.thaw()).resolves.toBe('failed');
      expect(log.error).toHaveBeenCalledWith(
        'audio.resume_failed',
        expect.objectContaining({ outcome: 'failed' }),
        error,
      );
    });

    it('stops waiting on a resume that never settles', async () => {
      const { player } = await makePlayer();

      vi.useFakeTimers();

      try {
        context.resume.mockImplementation(() => new Promise(() => {}));

        const thawed = player.thaw();

        await vi.advanceTimersByTimeAsync(2000);
        await expect(thawed).resolves.toBe('timed-out');
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails a start whose context will not resume', async () => {
      const { player } = await makePlayer();

      context.state = 'suspended';
      context.resume.mockImplementation(() =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError')),
      );

      await expect(player.start(0)).rejects.toThrow(
        'audio context did not resume: failed',
      );
      expect(context.bufferSources.every((s) => s.starts.length === 0)).toBe(
        true,
      );
    });
  });
});
