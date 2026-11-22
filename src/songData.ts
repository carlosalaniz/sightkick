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
    drumDifficulties: stored.drumDifficulties,
    liked: stored.liked,
    updatedAt: stored.updatedAt,
    scoreData: stored.scoreData,
  };
}
