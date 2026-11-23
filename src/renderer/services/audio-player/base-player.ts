import { BaseAudioTrack } from './base-track';
import { LoopWindow, TrackConfig } from './types';
import { trimTrailingSilence } from './helpers';

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

    for (const { name, urls } of trackConfigs) {
      const audioBuffers: AudioBuffer[] = [];

      for (const url of urls) {
        const data = await fetch(url).then((res) => res.arrayBuffer());
        const decoded = await this.context.decodeAudioData(data);

        audioBuffers.push(
          trimTrailingSilence(
            decoded,
            this.context,
            undefined,
            this.getMinDurationSeconds(),
          ),
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

  setMasterVolume(volume: number): void {
    this.masterGain.gain.setValueAtTime(volume, this.context.currentTime);
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
