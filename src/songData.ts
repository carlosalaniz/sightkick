import { Song, SongData } from './types';
import { stripColorMarkup } from './colorMarkup';

// Shared by the Electron main process and the browser build, so it must not
// import any Node built-ins.
export function toSong(stored: SongData): Song {
  const rating = parseInt(stored.diff_drums ?? '', 10);

  return {
    id: stored.id,
    dir: stored.dir,
    albumCover: stored.albumCover ?? undefined,
    name: stripColorMarkup(stored.name ?? ''),
    artist: stripColorMarkup(stored.artist ?? ''),
    album: stripColorMarkup(stored.album ?? ''),
    charter: stripColorMarkup(stored.charter ?? ''),
    genre: stored.genre ?? '',
    year: stored.year ?? '',
    fiveLaneDrums: stored.five_lane_drums === 'True',
    proDrums: stored.pro_drums === 'True',
    delaySeconds: (Number(stored.delay) || 0) / 1000,
    drumDifficulty: Number.isNaN(rating) || rating < 0 ? 0 : rating,
    format: stored.format,
    audio: stored.audio,
    ...(stored.drumKit?.length ? { drumKit: stored.drumKit } : {}),
    drumDifficulties: stored.drumDifficulties,
    liked: stored.liked,
    updatedAt: stored.updatedAt,
    scoreData: stored.scoreData,
  };
}

/** What a split produces: instrument stems, or those plus kit pieces. */
export type SplitParts = 'stems' | 'kit';

/** Folder inside a song that holds its drum-kit stems. */
export const DRUM_KIT_DIR = 'drumkit';

/** Kit stems the drum-kit split produces, in mixer order. */
export const DRUM_KIT_PIECES = [
  'kick',
  'snare',
  'toms',
  'hihat',
  'ride',
  'crash',
] as const;

export type DrumKitPiece = (typeof DRUM_KIT_PIECES)[number];

/** Drum audio of its own: drums, or drums_1..4 in multitrack charts. */
export const isDrumAudio = (a: { name: string }) =>
  /^drums(_\d+)?$/.test(a.name);

export function hasDrumAudio(audio: { name: string }[]): boolean {
  return audio.some(isDrumAudio);
}

// Audio a stem split should process: everything except crowd noise, which
// stays as its own track. Only songs without a drum stem need splitting.
export function splitInputs<T extends { name: string }>(audio: T[]): T[] {
  if (hasDrumAudio(audio)) {
    return [];
  }

  return audio.filter((a) => a.name !== 'crowd');
}
