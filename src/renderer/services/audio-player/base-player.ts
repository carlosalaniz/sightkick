import { BaseAudioTrack } from './base-track';
import { LoopWindow, TrackConfig } from './types';
import { downmixToMono, trimTrailingSilence } from './helpers';

/** An output timestamp older than this is from before a suspend: don't trust it. */
const STALE_OUTPUT_STAMP_SECONDS = 0.1;

export abstract class BaseAudioPlayer<TTrack extends BaseAudioTrack> {
  context: AudioContext;
  masterGain: GainNode;
  audioTracks: TTrack[] = [];
  ready: Promise<TTrack[]>;
  duration: number = 0;
  isInitialised: boolean = false;
  protected startedAt: number = -1;
  protected offset: number = 0;
  protected loop: LoopWindow | undefined;
  protected getMinDurationSeconds: () => number;

  constructor(
    trackConfigs: TrackConfig[],
    getMinDurationSeconds: () => number = () => 0,
  ) {
    this.context = new AudioContext({ latencyHint: 'playback' });
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.getMinDurationSeconds = getMinDurationSeconds;
    this.ready = this.createTracks(trackConfigs);
    this.ready
      .then((tracks) => {
        this.duration = Math.max(0, ...tracks.map((track) => track.duration));

        return this.duration;
      })
      .catch(() => {});
  }

  protected abstract createTrack(buffers: AudioBuffer[], name: string): TTrack;

  /**
   * Decodes one file at a time. A decoded stem is about 90 MB for a 4-minute
   * song, so decoding a fully split song all at once can be more memory than a
   * tablet's tab gets; one at a time, a subclass can shrink each track
   * (createTrack) before the next one is decoded.
   */
  private async createTracks(trackConfigs: TrackConfig[]): Promise<TTrack[]> {
    const tracks: TTrack[] = [];

    for (const { name, urls, mono } of trackConfigs) {
      const audioBuffers: AudioBuffer[] = [];

      for (const url of urls) {
        const data = await fetch(url).then((res) => res.arrayBuffer());
        const decoded = await this.context.decodeAudioData(data);
        const trimmed = trimTrailingSilence(
          decoded,
          this.context,
          undefined,
          this.getMinDurationSeconds(),
        );

        audioBuffers.push(
          mono ? downmixToMono(trimmed, this.context) : trimmed,
        );
      }

      const track = this.createTrack(audioBuffers, name);

      this.audioTracks.push(track);
      tracks.push(track);
    }

    return tracks;
  }

  pause(): void {
    this.context.suspend();
  }

  get outputLatency(): number {
    return this.context.outputLatency || this.context.baseLatency || 0;
  }

  private masterVolume = 1;

  /** Multiplies the master volume; wait mode fades it around a hold. */
  private fadeLevel = 1;

  setMasterVolume(volume: number): void {
    this.masterVolume = volume;
    this.masterGain.gain.setValueAtTime(
      volume * this.fadeLevel,
      this.context.currentTime,
    );
  }

  /**
   * Glides the output to `level` (0..1) of the master volume, so stopping and
   * starting the audio for wait mode doesn't click.
   */
  fadeTo(level: number, seconds: number): void {
    const { gain } = this.masterGain;
    const now = this.context.currentTime;

    this.fadeLevel = level;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);

    if (seconds > 0) {
      gain.linearRampToValueAtTime(this.masterVolume * level, now + seconds);
    } else {
      gain.setValueAtTime(this.masterVolume * level, now);
    }
  }

  /**
   * Context time of the audio reaching the speakers right now. The browser's
   * output timestamp moves smoothly; currentTime only advances once per audio
   * buffer (21 ms steps with a playback-latency context in Chrome on a Mac,
   * more on Android), so animation driven by it stalls every few frames.
   * While the context isn't running its clock is still and there is nothing
   * in flight to the speakers.
   */
  protected audibleContextTime(): number {
    const ctx = this.context;

    if (ctx.state !== 'running') {
      return ctx.currentTime;
    }

    const stamp =
      typeof ctx.getOutputTimestamp === 'function'
        ? ctx.getOutputTimestamp()
        : undefined;
    const since =
      stamp?.performanceTime && stamp.contextTime !== undefined
        ? (performance.now() - stamp.performanceTime) / 1000
        : undefined;

    // No stamp yet, or one from before a suspend: fall back to the estimate.
    if (
      stamp?.contextTime === undefined ||
      since === undefined ||
      since < 0 ||
      since > STALE_OUTPUT_STAMP_SECONDS
    ) {
      return ctx.currentTime - this.outputLatency;
    }

    return Math.min(stamp.contextTime + since, ctx.currentTime);
  }

  contextTimeForSongTime(songTime: number): number {
    if (this.startedAt < 0) {
      return this.context.currentTime;
    }

    return this.startedAt + (songTime - this.offset);
  }

  protected hasActiveLoop(): this is { loop: LoopWindow } {
    return this.loop !== undefined && this.loop.end > this.loop.start;
  }

  protected wrapLoopTime(unwrapped: number): number {
    if (!this.hasActiveLoop() || unwrapped < this.loop.end) {
      return unwrapped;
    }

    const span = this.loop.end - this.loop.start;

    return this.loop.start + ((unwrapped - this.loop.start) % span);
  }

  abstract get currentTime(): number;

  abstract start(offset?: number, startAt?: number): Promise<void> | void;

  abstract stop(): void;

  destroy(): void {
    this.audioTracks.forEach((track) => track.destroy());
    this.audioTracks = [];
    this.masterGain.disconnect();
    this.context.close();
  }
}
