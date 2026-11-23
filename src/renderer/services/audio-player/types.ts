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

/**
 * Why a song's audio file didn't load:
 * - http: the server answered with an error status (a missing stem: 404).
 * - network: no answer at all (offline, connection dropped, blocked).
 * - timeout: no complete answer within the fetch timeout.
 * - decode: the bytes arrived but aren't audio the browser can decode.
 */
export type TrackLoadFailure =
  | { kind: 'http'; url: string; status: number }
  | { kind: 'network'; url: string }
  | { kind: 'timeout'; url: string }
  | { kind: 'decode'; url: string };

/** What loading a player's tracks came to. */
export type TracksLoadResult<TTrack = unknown> =
  | { kind: 'loaded'; tracks: TTrack[] }
  | { kind: 'failed'; failure: TrackLoadFailure };

/** How a suspend of the player's audio clock (wait mode's freeze) ended. */
export type FreezeResult = 'frozen' | 'failed' | 'timed-out';

/** How a resume of the player's audio clock ended. */
export type ThawResult = 'resumed' | 'failed' | 'timed-out';

export interface AudioPlayer {
  /** Settles once every track has loaded, or one has failed to. */
  ready: Promise<TracksLoadResult>;
  context: AudioContext;
  audioTracks: AudioTrackHandle[];
  duration: number;
  isInitialised: boolean;
  currentTime: number;
  start(offset?: number, startAt?: number): Promise<void> | void;
  stop(): void;
  pause(): void;
  /**
   * Stops the audio clock that the player and anything scheduled on its
   * context run on, in place. Bounded: never waits forever on the browser.
   */
  freeze(): Promise<FreezeResult>;
  /** Restarts the audio clock after `freeze` (or a browser autoplay block). */
  thaw(): Promise<ThawResult>;
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
