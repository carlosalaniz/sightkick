export type SampleBlock = Float32Array<ArrayBuffer>;

export interface TrackConfig {
  name: string;
  urls: string[];
  /** Mix the decoded audio down to one channel: half the memory, no panning. */
  mono?: boolean;
}

export interface AudioTrackHandle {
  name: string;
  setVolume(gain: number, fadeSeconds?: number): void;
}

export interface LoopWindow {
  start: number;
  end: number;
}

export interface AudioPlayer {
  ready: Promise<unknown>;
  context: AudioContext;
  audioTracks: AudioTrackHandle[];
  duration: number;
  isInitialised: boolean;
  currentTime: number;
  start(offset?: number, startAt?: number): Promise<void> | void;
  stop(): void;
  pause(): void;
  setMasterVolume(volume: number): void;
  setLoop?(loop: LoopWindow | undefined): void;
  contextTimeForSongTime(songTime: number): number;
  /** Seconds between scheduling audio and hearing it. */
  outputLatency?: number;
  /** Glides the output to `level` of the master volume (wait mode's holds). */
  fadeTo?(level: number, seconds: number, at?: number): void;
  destroy(): void;
}

export interface SpeedControllableAudioPlayer extends AudioPlayer {
  playbackSpeed: number;
  setPlaybackSpeed(speed: number): void;
}

export function isSpeedControllable(
  player: AudioPlayer,
): player is SpeedControllableAudioPlayer {
  return 'setPlaybackSpeed' in player;
}

export type AudioPlayerFactory = (
  trackConfigs: TrackConfig[],
  onEnded: () => void,
  getMinDurationSeconds: () => number,
) => AudioPlayer;
