import {
  Measure,
  Note,
  ParsedChart,
  RenderData,
} from '../../../chart-parser/types';
import { InputMapping, ScoreData } from '../../../types';
import { PlayheadStyle } from '../../types';
import { InputEvent } from '../../input/types';
import { AudioPlayerFactory, PlayerMode, TrackConfig } from '../audio-player';

/**
 * Why the song can't play, for the message the user sees:
 * - load: its audio failed to load.
 * - start: the audio failed to start.
 * - resume: the audio clock didn't run again after a wait-mode hold, so the
 *   song was paused where it stood.
 */
export type PlaybackFailure = 'load' | 'start' | 'resume';

export interface EngineOptions {
  trackData: TrackConfig[];
  isDev: boolean;
  player: PlayerMode;
  subscribeInput: (listener: (event: InputEvent) => void) => () => void;
  onEnded: (score: ScoreData) => void;
  onError: (failure: PlaybackFailure) => void;
}

export interface EngineContext {
  chart: ParsedChart | undefined;
  measures: Measure[];
  renderData: RenderData[];
  delaySeconds: number;
  countInEnabled: boolean;
  finishAfterLastNote?: boolean;
  minDurationSeconds: number;
  mapping: InputMapping;
}

export interface EngineSettings {
  playheadStyle: PlayheadStyle;
}

export type JudgeHitHandler = (pos: NotePos, prefixes: string[]) => void;

export type JudgeGateHandler = (open: boolean) => void;

/** A scored hit with its timing, for views that grade or coach timing. */
export interface JudgedHit {
  pos: NotePos;
  /** Chart tick of the note that was hit. */
  tick: number;
  /** Key prefixes (e.g. `c/5`) newly hit on that note. */
  prefixes: string[];
  /** Hit time minus note time, in seconds; negative is early. Frame-quantized. */
  offsetSeconds: number;
  controlId: string;
  value: number;
}

export type JudgedHitHandler = (hit: JudgedHit) => void;

export interface JudgeSettings {
  /** Half-width of the hit window around each note, in seconds. */
  hitToleranceSeconds: number;
  /** Silence the drum stem after a missed note until the next correct hit. */
  muteDrumsOnMiss: boolean;
}

/**
 * How the judge treats priority targets' velocity:
 * - graded: accents and ghost notes need the right velocity, as everywhere.
 * - any: any velocity counts.
 */
export type TargetVelocity = 'graded' | 'any';

export interface PriorityTargetOptions {
  velocity: TargetVelocity;
}

export interface JudgeContext {
  chart: ParsedChart | undefined;
  measures: Measure[];
  mapping: InputMapping;
}

export type IsHit = (tick: number, prefix: string) => boolean;

export interface GameRendererContext {
  chart: ParsedChart | undefined;
  renderData: RenderData[];
}

export interface GameRendererRefs {
  cursorEl: HTMLElement | undefined;
  highlightEls: (HTMLElement | undefined)[];
}

export interface NotePos {
  measureIdx: number;
  noteIdx: number;
}

export interface NoteEntry {
  tick: number;
  note: Note;
  pos: NotePos;
}

export interface ActiveNote extends NotePos {
  noteHeadEls: SVGElement[];
}

export type PlaybackState =
  | 'idle'
  | 'parked'
  | 'counting-in'
  | 'playing'
  | 'ended';

export interface LoopRegion {
  startTick: number;
  endTick: number;
}

export interface TransportContext {
  chart: ParsedChart | undefined;
  measures: Measure[];
  delaySeconds: number;
  countInEnabled: boolean;
  finishAfterLastNote?: boolean;
  minDurationSeconds: number;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  isPlaying: boolean;
  isCounting: boolean;
  isStarted: boolean;
  isEnded: boolean;
  countInBeat: number | undefined;
  countInBeatMs: number | undefined;
  isReady: boolean;
  duration: number;
}

export interface TransportOptions {
  trackData: TrackConfig[];
  isDev: boolean;
  createPlayer: AudioPlayerFactory;
  onEnded: () => void;
  onError: (failure: PlaybackFailure) => void;
  onSeek?: (tick: number) => void;
}
