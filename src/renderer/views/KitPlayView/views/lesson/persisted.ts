import { log } from '../../../../../shared/log';
import { MAX_STARS } from './machine';
import { WAIT_GRACE_OPTIONS_MS } from './pace';

/**
 * The lesson's saved settings. The keys are users' saved data: renaming one
 * (or changing its shape without reading the old one) drops their progress.
 */
export const PROGRESS_KEY = 'settings.v7.progress';

export const WAIT_MODE_KEY = 'settings.v7.waitMode';

export const WAIT_GRACE_KEY = 'settings.v7.waitGraceMs';

export const RUN_UP_KEY = 'settings.v7.runUp';

export interface SongProgress {
  /** Stars per lesson key, 0 to MAX_STARS. */
  stars: Record<string, number>;
  /** Lessons read at least once, by key. */
  seen: Record<string, boolean>;
  /** Key of the lesson last worked on. */
  lesson?: string;
}

/** Progress per song id. */
export type LessonProgress = Record<string, SongProgress>;

export type WaitGraceMs = (typeof WAIT_GRACE_OPTIONS_MS)[number];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** The entries of `raw` that pass `keep`; anything else is dropped. */
function entriesOf<V>(
  raw: unknown,
  keep: (v: unknown) => v is V,
): { value: Record<string, V>; dropped: number } {
  if (!isRecord(raw)) {
    return { value: {}, dropped: raw === undefined ? 0 : 1 };
  }

  const value: Record<string, V> = {};
  let dropped = 0;

  for (const [k, v] of Object.entries(raw)) {
    if (keep(v)) {
      value[k] = v;
    } else {
      dropped += 1;
    }
  }

  return { value, dropped };
}

const isStarCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_STARS;
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Saved lesson progress. Salvages what it can per song (a song with a broken
 * `stars` keeps its `seen` and last lesson) rather than dropping every song's
 * progress over one bad field; what it drops is logged.
 */
export function parseProgress(raw: unknown): LessonProgress | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const out: LessonProgress = {};

  for (const [songId, song] of Object.entries(raw)) {
    if (!isRecord(song)) {
      log.warn('lesson.progress_dropped', { key: PROGRESS_KEY, songId });

      continue;
    }

    const stars = entriesOf(song.stars, isStarCount);
    const seen = entriesOf(song.seen, isBoolean);
    const lesson = typeof song.lesson === 'string' ? song.lesson : undefined;
    const badLesson = song.lesson !== undefined && lesson === undefined;

    if (stars.dropped > 0 || seen.dropped > 0 || badLesson) {
      log.warn('lesson.progress_repaired', {
        key: PROGRESS_KEY,
        songId,
        droppedStars: stars.dropped,
        droppedSeen: seen.dropped,
        droppedLesson: badLesson,
      });
    }

    out[songId] = {
      stars: stars.value,
      seen: seen.value,
      ...(lesson !== undefined ? { lesson } : {}),
    };
  }

  return out;
}

export function parseFlag(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/** A wait grace the menu offers; anything else falls back to the default. */
export function parseWaitGrace(raw: unknown): WaitGraceMs | undefined {
  return WAIT_GRACE_OPTIONS_MS.find((ms) => ms === raw);
}
