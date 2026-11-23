import { Measure, ParsedChart } from '../../../chart-parser/types';
import { InputMapping, ScoreData, Song } from '../../../types';
import { Engine, LoopRegion } from '../../services/engine';
import { TimeStore } from '../../services/time-store';
import { Kit, KitPiece, TimelineBar, TimelineNote, Voice } from '../../kit';
import { DrumKitPiece } from '../../../songData';

export const KIT_PLAY_VIEWS = [
  {
    id: 'kit',
    label: 'Play',
    description: 'Notes land on the pads of your kit',
  },
  {
    id: 'v6',
    label: 'v6 · Sheet lanes',
    description: 'Sheet music mapped to your kit, fading into plain bars',
  },
  {
    id: 'v7',
    label: 'v7 · Lesson',
    description: 'A guided lesson on one section',
  },
  {
    id: 'v12',
    label: 'v12 · Rails',
    description: 'Horizontal arcade rails running into your kit',
  },
  {
    id: 'v13',
    label: 'v13 · Lanes',
    description: 'Lanes standing over each pad, one hit line',
  },
] as const;

export type KitPlayViewId = (typeof KIT_PLAY_VIEWS)[number]['id'];

export function isKitPlayView(value: string | null): value is KitPlayViewId {
  return KIT_PLAY_VIEWS.some((v) => v.id === value);
}

/** Everything a kit play view needs; built by `KitPlayView` from the real engine. */
export interface PlaySession {
  song: Song;
  chart: ParsedChart;
  measures: Measure[];
  /** Song audio offset; note and bar times below already include it. */
  delaySeconds: number;
  /** Every voice of every note, sorted by time. Times are audio seconds (`timeStore.get()`). */
  notes: TimelineNote[];
  bars: TimelineBar[];
  kit: Kit;
  /** The mapping the judge uses (kit-learned controls, else the device mapping). */
  mapping: InputMapping;
  pieceByVoice: Map<Voice, KitPiece>;

  engine: Engine;
  /** Current audio time in seconds. Read it every animation frame. */
  timeStore: TimeStore;
  duration: number;
  isReady: boolean;
  isPlaying: boolean;
  isCounting: boolean;
  isEnded: boolean;
  countInBeat: number | undefined;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  playFromTick: (tick: number) => void;
  seekSeconds: (seconds: number) => void;
  /** Loops playback and judging over a tick range; `undefined` plays the whole song. */
  setLoopRegion: (region: LoopRegion | undefined) => void;
  /** 0.3–2. Song audio is time-stretched; note times stay in song time. */
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  /**
   * Scales one stem on top of the user's Tracks mixer (1 = the mixer level).
   * Views use this instead of engine.setStemVolume so they don't overwrite
   * what the user set. Reset to 1 on unmount. Stem names: 'drums', 'song', …
   */
  setStemScale: (name: string, scale: number) => void;
  /**
   * Kit-piece stems playing instead of the 'drums' stem when the song's drums
   * were split into a kit ('kick', 'snare', 'toms', 'hihat', 'ride',
   * 'crash'); empty otherwise. Scale them with setStemScale.
   */
  kitStems: DrumKitPiece[];
  /** Metronome volume, 0–1. */
  clickVolume: number;
  setClickVolume: (volume: number) => void;
  /** Called with the engine's score when the song (not a loop) finishes. */
  onEnded: (listener: (score: ScoreData) => void) => () => void;
  /** Hits a piece as if its pad was struck (pad taps on screen). No-op if it has no control. */
  strikePiece: (piece: KitPiece) => void;
}
