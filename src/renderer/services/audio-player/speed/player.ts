import { SpeedAudioTrack } from './track';
import { ProduceResult, StretchFailure, StretchStream } from './stretch-stream';
import { VoiceGroup } from './build-units';
import { SYNTHESIS_HOP } from './channel-stretcher';
import { PcmChannel } from './pcm';
import { DRUM_KIT_PIECES, DRUM_STEM } from '../../../../songData';
import { assertNever } from '../../../../shared/assertNever';
import { log } from '../../../../shared/log';
import { BaseAudioPlayer } from '../base-player';
import {
  LoopWindow,
  SampleBlock,
  SpeedControllableAudioPlayer,
  TrackConfig,
} from '../types';

const FRAMES_PER_CHUNK = 64;
const LOOKAHEAD_SECONDS = 2;
const SCHEDULER_INTERVAL_MS = 100;
const START_LEAD_SECONDS = 0.1;
const DRUM_TRACK_NAMES: readonly string[] = [DRUM_STEM, ...DRUM_KIT_PIECES];
/**
 * Drums and the kit pieces split from them are stretched with their hits kept
 * sharp (phase reset at each onset); everything else as a smooth vocoder.
 */
const isDrumTrack = (name: string) => DRUM_TRACK_NAMES.includes(name);

interface ChunkTarget {
  track: SpeedAudioTrack;
  fileIndex: number;
  channels: number;
  voiceStart: number;
  sampleRate: number;
}

interface ProducedChunk {
  blocks: SampleBlock[];
  sampleCount: number;
}

/**
 * - chunk: audio to schedule.
 * - none: nothing to schedule (the song's end, or a stop/seek overtook it).
 * - failed: the stretcher can't produce audio any more.
 */
type ChunkOutcome =
  | { kind: 'chunk'; chunk: ProducedChunk }
  | { kind: 'none' }
  | { kind: 'failed'; reason: StretchFailure };

/**
 * Whether the stretcher can play the song at the latest speed asked for:
 * - prepared: yes.
 * - not-loaded: the song's audio never loaded (reported where it is loaded).
 * - failed: setting up the stretcher failed; see the log.
 */
type PrepareResult = 'prepared' | 'not-loaded' | 'failed';

/**
 * The stretcher's samples: still in the tracks, handed to the stream, or
 * lost to a setup that failed after taking them (takePcm empties the tracks,
 * so there is nothing left to retry with).
 */
type StreamSetup = 'unbuilt' | 'ready' | 'failed';

/** What a produce that brought no blocks means for scheduling. */
function withoutBlocks(
  result: Exclude<ProduceResult, { kind: 'produced' }>,
): ChunkOutcome {
  switch (result.kind) {
    case 'stopped':
      return { kind: 'none' };

    case 'failed':
      return result;

    default:
      return assertNever(result, 'produce result');
  }
}

export class SpeedAudioPlayer
  extends BaseAudioPlayer<SpeedAudioTrack>
  implements SpeedControllableAudioPlayer
{
  prepared: Promise<PrepareResult> = Promise.resolve('not-loaded');
  onEnded: (() => void) | undefined;
  private _playbackSpeed: number = 1;
  private stream: StretchStream = new StretchStream();
  private voices: PcmChannel[] = [];
  private targets: ChunkTarget[] = [];
  private groups: VoiceGroup[] = [];
  private streamSetup: StreamSetup = 'unbuilt';
  private timer: ReturnType<typeof setInterval> | undefined;
  private scheduledUntil: number = 0;
  private outputProducedSeconds: number = 0;
  private totalOutputSeconds: number = 0;
  private totalScheduledSamples: number = 0;
  private loopPass: number = 0;
  private pumping: boolean = false;
  private epoch: number = 0;

  constructor(
    trackConfigs: TrackConfig[],
    onEnded: () => void,
    getMinDurationSeconds: () => number = () => 0,
  ) {
    super(trackConfigs, getMinDurationSeconds);
    this.onEnded = onEnded;
    this.prepare();
  }

  protected createTrack(buffers: AudioBuffer[], name: string): SpeedAudioTrack {
    return new SpeedAudioTrack(buffers, name, this.context, this.masterGain);
  }

  contextTimeForSongTime(songTime: number): number {
    if (this.startedAt < 0) {
      return this.context.currentTime;
    }

    return this.startedAt + (songTime - this.offset) / this._playbackSpeed;
  }

  get playbackSpeed() {
    return this._playbackSpeed;
  }

  setPlaybackSpeed(speed: number) {
    if (speed === this._playbackSpeed) {
      return;
    }

    const running = this.isInitialised && this.context.state === 'running';
    const resumeAt = running ? this.currentTime : undefined;
    const deferredStart =
      running && this.startedAt > this.context.currentTime
        ? this.startedAt
        : undefined;

    this._playbackSpeed = speed;
    this.prepare();

    if (resumeAt !== undefined) {
      void this.start(resumeAt, deferredStart);
    }
  }

  setLoop(loop: LoopWindow | undefined) {
    if (this.loop?.start === loop?.start && this.loop?.end === loop?.end) {
      return;
    }

    const running = this.isInitialised && this.context.state === 'running';

    if (!running) {
      this.loop = loop;

      return;
    }

    const resumeAt = this.currentTime;
    const deferredStart =
      this.startedAt > this.context.currentTime ? this.startedAt : undefined;
    const scheduledSongEnd =
      this.offset +
      (this.totalScheduledSamples / this.context.sampleRate) *
        this._playbackSpeed;
    const needsRestart =
      this.loopPass > 0 ||
      (loop !== undefined &&
        loop.end > loop.start &&
        scheduledSongEnd > loop.end);

    this.loop = loop;

    if (
      needsRestart &&
      (!loop || (resumeAt >= loop.start && resumeAt < loop.end))
    ) {
      void this.start(resumeAt, deferredStart);
    }
  }

  private prepare() {
    const speed = this._playbackSpeed;

    this.prepared = this.ready.then((loaded): PrepareResult => {
      switch (loaded.kind) {
        case 'loaded':
          return this.prepareStream(loaded.tracks, speed);

        case 'failed':
          // Reported by whoever awaits `ready` (the transport).
          return 'not-loaded';

        default:
          return assertNever(loaded, 'tracks load result');
      }
    });
  }

  private prepareStream(
    tracks: SpeedAudioTrack[],
    speed: number,
  ): PrepareResult {
    const setup = this.streamSetup;

    try {
      switch (setup) {
        case 'unbuilt':
          this.buildVoices(tracks);
          this.stream.init(
            this.voices,
            speed,
            this.groups,
            this.context.sampleRate,
          );
          // The stream owns the samples now (moved to its worker, if any).
          this.voices = [];
          this.streamSetup = 'ready';

          return 'prepared';

        case 'ready':
          this.stream.setSpeed(speed);

          return 'prepared';

        case 'failed':
          return 'failed';

        default:
          return assertNever(setup, 'stream setup');
      }
    } catch (err) {
      if (setup === 'unbuilt') {
        this.voices = [];
        this.streamSetup = 'failed';
      }

      log.error('speed_player.prepare_failed', { setup, speed }, err);

      return 'failed';
    }
  }

  private buildVoices(tracks: SpeedAudioTrack[]) {
    this.voices = [];
    this.targets = [];
    this.groups = [];

    tracks.forEach((track) => {
      const pcm = track.takePcm();

      track.formats.forEach(({ channels, sampleRate }, fileIndex) => {
        const voiceStart = this.voices.length;

        this.voices.push(...pcm[fileIndex]);

        this.targets.push({
          track,
          fileIndex,
          channels,
          voiceStart,
          sampleRate,
        });

        this.groups.push({
          start: voiceStart,
          count: channels,
          kind: isDrumTrack(track.name) ? 'transient' : 'vocoder',
        });
      });
    });
  }

  async start(offset: number = 0, requestedStartAt?: number) {
    if (this.isInitialised) {
      this.stop();
    }

    this.offset = offset;
    this.epoch += 1;

    const epoch = this.epoch;
    const prepared = await this.prepared;

    if (epoch !== this.epoch) {
      return;
    }

    // Starting anyway would play a silent song with no error.
    if (prepared !== 'prepared') {
      throw new Error(`time-stretched audio not ready: ${prepared}`);
    }

    const thawed =
      this.context.state === 'suspended' ? await this.thaw() : 'resumed';

    if (epoch !== this.epoch) {
      return;
    }

    // Chunks scheduled on a context that isn't running would never play.
    if (thawed !== 'resumed') {
      throw new Error(`audio context did not resume: ${thawed}`);
    }

    const speed = this._playbackSpeed;
    const { sampleRate } = this.context;

    this.totalOutputSeconds = this.duration / speed;
    this.totalScheduledSamples = 0;
    this.loopPass = 0;

    const outputStartSeconds = offset / speed;

    this.stream.seek(Math.round(outputStartSeconds * sampleRate));
    this.outputProducedSeconds = outputStartSeconds;

    const first = await this.produceNextChunk(epoch);

    if (epoch !== this.epoch) {
      return;
    }

    if (first.kind === 'failed') {
      throw new Error(`time-stretched audio failed: ${first.reason}`);
    }

    const leadStartAt = this.context.currentTime + START_LEAD_SECONDS;
    const startAt = Math.max(requestedStartAt ?? leadStartAt, leadStartAt);

    this.startedAt = startAt;
    this.scheduledUntil = startAt;
    this.isInitialised = true;

    if (first.kind === 'chunk') {
      this.commitChunk(first.chunk);
    }

    this.timer = setInterval(this.pump, SCHEDULER_INTERVAL_MS);
  }

  private async produceNextChunk(epoch: number): Promise<ChunkOutcome> {
    if (!this.hasActiveLoop()) {
      const result = await this.stream.produce(FRAMES_PER_CHUNK);

      if (result.kind !== 'produced') {
        return withoutBlocks(result);
      }

      const { blocks } = result;

      if (epoch !== this.epoch || blocks.length === 0) {
        return { kind: 'none' };
      }

      return {
        kind: 'chunk',
        chunk: { blocks, sampleCount: blocks[0].length },
      };
    }

    const speed = this._playbackSpeed;
    const { sampleRate } = this.context;
    const { start, end } = this.loop;
    const span = end - start;
    let remainingInPass = this.remainingSamplesInLoopPass(
      start,
      end,
      span,
      speed,
      sampleRate,
    );

    if (remainingInPass <= 0) {
      this.loopPass += 1;
      this.stream.seek(Math.round((start / speed) * sampleRate));
      remainingInPass = this.remainingSamplesInLoopPass(
        start,
        end,
        span,
        speed,
        sampleRate,
      );
    }

    const maxChunkSamples = FRAMES_PER_CHUNK * SYNTHESIS_HOP;
    const sampleCount = Math.min(maxChunkSamples, remainingInPass);
    const frames = Math.max(1, Math.ceil(sampleCount / SYNTHESIS_HOP));
    const wrapsAtEnd = sampleCount === remainingInPass;
    const result = await this.stream.produce(frames);

    if (result.kind !== 'produced') {
      return withoutBlocks(result);
    }

    const { blocks } = result;

    if (epoch !== this.epoch || blocks.length === 0) {
      return { kind: 'none' };
    }

    if (wrapsAtEnd && this.hasActiveLoop()) {
      this.loopPass += 1;
      this.stream.seek(
        Math.round((this.loop.start / this._playbackSpeed) * sampleRate),
      );
    }

    return {
      kind: 'chunk',
      chunk: { blocks, sampleCount: Math.min(sampleCount, blocks[0].length) },
    };
  }

  private remainingSamplesInLoopPass(
    start: number,
    end: number,
    span: number,
    speed: number,
    sampleRate: number,
  ): number {
    const unwrappedLoopEnd = end + this.loopPass * span;
    const targetEndSamples = Math.round(
      ((unwrappedLoopEnd - this.offset) / speed) * sampleRate,
    );

    return targetEndSamples - this.totalScheduledSamples;
  }

  private commitChunk({ blocks, sampleCount }: ProducedChunk) {
    if (sampleCount <= 0) {
      return;
    }

    this.scheduleBlocks(blocks, this.scheduledUntil, sampleCount);

    const chunkDuration = sampleCount / this.context.sampleRate;

    this.scheduledUntil += chunkDuration;
    this.totalScheduledSamples += sampleCount;
    this.outputProducedSeconds += chunkDuration;
  }

  private scheduleBlocks(
    blocks: SampleBlock[],
    at: number,
    sampleCount: number,
  ) {
    this.targets.forEach((target) => {
      const length = Math.min(sampleCount, blocks[target.voiceStart].length);
      const buffer = this.context.createBuffer(
        target.channels,
        length,
        target.sampleRate,
      );

      for (let channel = 0; channel < target.channels; channel += 1) {
        buffer.copyToChannel(
          blocks[target.voiceStart + channel].subarray(0, length),
          channel,
        );
      }

      target.track.scheduleChunk(target.fileIndex, buffer, at);
    });
  }

  private pump = async () => {
    if (this.pumping || !this.isInitialised) {
      return;
    }

    this.pumping = true;

    const epoch = this.epoch;

    try {
      while (
        epoch === this.epoch &&
        this.isInitialised &&
        this.scheduledUntil < this.context.currentTime + LOOKAHEAD_SECONDS &&
        (this.hasActiveLoop() ||
          this.outputProducedSeconds < this.totalOutputSeconds)
      ) {
        const next = await this.produceNextChunk(epoch);

        if (epoch !== this.epoch || !this.isInitialised) {
          break;
        }

        if (next.kind === 'failed') {
          this.handleStretchFailed(next.reason);

          break;
        }

        if (next.kind === 'none') {
          break;
        }

        this.commitChunk(next.chunk);
      }
    } finally {
      this.pumping = false;
    }

    if (
      epoch === this.epoch &&
      this.isInitialised &&
      !this.hasActiveLoop() &&
      this.outputProducedSeconds >= this.totalOutputSeconds &&
      this.context.currentTime >= this.scheduledUntil
    ) {
      this.stop();
      this.onEnded?.();
    }
  };

  /**
   * No more audio is coming mid-song: stop asking. What is scheduled plays
   * out and the clock keeps the song time going; a new start tries again.
   */
  private handleStretchFailed(reason: StretchFailure) {
    log.error('speed_player.stretch_failed', {
      reason,
      songTime: this.currentTime,
    });

    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  stop() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.audioTracks.forEach((track) => track.stop());
    this.isInitialised = false;
    this.startedAt = -1;
    this.epoch += 1;
  }

  get currentTime() {
    if (this.startedAt < 0) {
      return 0;
    }

    const unwrapped = Math.max(
      this.offset,
      (this.audibleContextTime() - this.startedAt) * this._playbackSpeed +
        this.offset,
    );

    if (this.hasActiveLoop()) {
      return this.wrapLoopTime(unwrapped);
    }

    return Math.min(this.duration, unwrapped);
  }

  destroy() {
    this.stop();
    super.destroy();
    this.onEnded = undefined;
    this.stream.destroy();
  }
}
