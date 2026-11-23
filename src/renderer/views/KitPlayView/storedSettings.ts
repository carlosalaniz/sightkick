/**
 * Parsers for what the kit play views keep in localStorage. Stored JSON is
 * outside data: an old build, another tab or a hand edit can leave any
 * shape under a key. Each parser returns our type, or undefined when the
 * value can't be used, so the caller falls back to its default.
 */

import { GEMS_AHEAD_OPTIONS } from './views/sheetLanes/layout';

type Fields = Record<string, unknown>;

const isObject = (raw: unknown): raw is Fields =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isFiniteNumber = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isFinite(raw);

/** How the Play view lays out its highway (`settings.kitPlayLayout`). */
export type KitPlayLayout = 'kit' | 'lanes';

export function parseKitPlayLayout(raw: unknown): KitPlayLayout | undefined {
  return raw === 'kit' || raw === 'lanes' ? raw : undefined;
}

/** How far ahead sheet lanes shows gems, in ms (`settings.v6.gemsMs`): one of the menu's options. */
export function parseGemsAheadMs(raw: unknown): number | undefined {
  return isFiniteNumber(raw) && GEMS_AHEAD_OPTIONS.includes(raw)
    ? raw
    : undefined;
}

/** One logged unseen-bars pass in Reading progress. */
export interface ProbeEntry {
  at: number;
  start: number;
  end: number;
  accuracy: number;
  sdMs: number;
  tempo: number;
}

/** Sheet lanes' reading progress for one song. */
export interface SheetLanesProgress {
  /** Best practice pass at 100% tempo, 0–1. */
  best100?: number;
  /** Furthest bar (exclusive) played through. */
  seenTo?: number;
  /** Newest first. */
  probes: ProbeEntry[];
}

function parseProbe(raw: unknown): ProbeEntry | undefined {
  if (
    !isObject(raw) ||
    !isFiniteNumber(raw.at) ||
    !isFiniteNumber(raw.start) ||
    !isFiniteNumber(raw.end) ||
    !isFiniteNumber(raw.accuracy) ||
    !isFiniteNumber(raw.sdMs) ||
    !isFiniteNumber(raw.tempo)
  ) {
    return undefined;
  }

  return {
    at: raw.at,
    start: raw.start,
    end: raw.end,
    accuracy: raw.accuracy,
    sdMs: raw.sdMs,
    tempo: raw.tempo,
  };
}

/**
 * One song's progress, or undefined if it isn't an object. A missing or
 * broken `probes` list becomes empty and bad entries are dropped, so the
 * rest of the song's progress survives.
 */
export function parseSheetLanesProgress(
  raw: unknown,
): SheetLanesProgress | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const probes = Array.isArray(raw.probes)
    ? raw.probes.flatMap((p) => {
        const probe = parseProbe(p);

        return probe ? [probe] : [];
      })
    : [];

  return {
    ...(isFiniteNumber(raw.best100) ? { best100: raw.best100 } : {}),
    ...(isFiniteNumber(raw.seenTo) ? { seenTo: raw.seenTo } : {}),
    probes,
  };
}

/** Every song's reading progress by song id (`settings.v6.progress`). */
export function parseSheetLanesProgressMap(
  raw: unknown,
): Record<string, SheetLanesProgress> | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const out: Record<string, SheetLanesProgress> = {};

  for (const [songId, entry] of Object.entries(raw)) {
    const progress = parseSheetLanesProgress(entry);

    if (progress) {
      out[songId] = progress;
    }
  }

  return out;
}
