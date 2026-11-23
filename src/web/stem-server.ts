import { SongData } from '../types';
import {
  BACKING_STEM,
  DRUM_KIT_DIR,
  hasDrumAudio,
  isDrumAudio,
  splitInputs,
  SplitParts,
} from '../songData';
import { DEFAULT_STEM_SERVER_URL } from '../stemServerUrl';
import { getFile, getRoot, joinPath, loadSongs, saveSongs } from './library';
import { buildSong, clearAssetCache, listSongDir, toUiSong } from './songs';

// Client for the optional stem server (stem-server/ in this repo), which splits
// a single mixed audio file into drums, bass, vocals, ... so drums can be muted.

export const STEM_SERVER_URL_KEY = 'settings.stemServerUrl';

export const STEM_QUALITY_KEY = 'settings.stemQuality';

export type StemQuality = 'fast' | 'best';

const POLL_MS = 1000;
const ASSET_PREFIX = 'sk-asset:';

type Reply = (channel: string, payload: unknown) => void;

interface JobStatus {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  stage: string;
  progress: number;
  stems: string[];
  error: string | null;
}

export function stemServerUrl(): string {
  try {
    const raw = localStorage.getItem(STEM_SERVER_URL_KEY);
    const url = raw ? (JSON.parse(raw) as string) : '';

    return (url || DEFAULT_STEM_SERVER_URL).replace(/\/+$/, '');
  } catch {
    return DEFAULT_STEM_SERVER_URL;
  }
}

export function stemQuality(): StemQuality {
  try {
    const raw = localStorage.getItem(STEM_QUALITY_KEY);

    return raw && JSON.parse(raw) === 'best' ? 'best' : 'fast';
  } catch {
    return 'fast';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${stemServerUrl()}${path}`, init);
  } catch {
    throw new Error(
      `Can't reach the stem server at ${stemServerUrl()}. Is it running?`,
    );
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);

    throw new Error(detail ?? `Stem server error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function checkStemServer(): Promise<boolean> {
  try {
    const res = await fetch(`${stemServerUrl()}/health`, {
      signal: AbortSignal.timeout(3000),
    });

    return res.ok && ((await res.json()) as { ok: boolean }).ok;
  } catch {
    return false;
  }
}

// Song id -> server job, so a split can be cancelled from the UI.
const activeSplits = new Map<string, { jobId?: string; cancelled: boolean }>();

/**
 * A split the server is working on, saved so a page refresh can pick it up
 * again: the server keeps running the job, and the page reattaches, follows
 * its progress and writes the stems when it's done.
 */
interface PendingSplit {
  id: string;
  jobId: string;
  /** Kit pass on existing drum stems: the original audio is kept. */
  kitOnly: boolean;
  /** Library-relative paths of the audio files sent to the server. */
  inputRels: string[];
}

export const PENDING_SPLITS_KEY = 'sk-split-jobs';

function loadPending(): Record<string, PendingSplit> {
  try {
    const raw = localStorage.getItem(PENDING_SPLITS_KEY);

    return raw ? (JSON.parse(raw) as Record<string, PendingSplit>) : {};
  } catch {
    return {};
  }
}

function savePending(pending: Record<string, PendingSplit>): void {
  try {
    localStorage.setItem(PENDING_SPLITS_KEY, JSON.stringify(pending));
  } catch {
    // Storage full or blocked: the split still runs, it just won't survive a refresh.
  }
}

function rememberSplit(split: PendingSplit): void {
  savePending({ ...loadPending(), [split.id]: split });
}

function forgetSplit(id: string): void {
  const pending = loadPending();

  if (id in pending) {
    delete pending[id];
    savePending(pending);
  }
}

export function cancelSplit(id: string): void {
  const split = activeSplits.get(id);

  if (!split) {
    // Saved from an earlier page but not reattached yet: drop it and tell the server.
    const pending = loadPending()[id];

    if (pending) {
      forgetSplit(id);
      fetch(`${stemServerUrl()}/jobs/${pending.jobId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }

    return;
  }

  split.cancelled = true;

  if (split.jobId) {
    fetch(`${stemServerUrl()}/jobs/${split.jobId}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const fileNameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const KIT_STEM_PREFIX = 'kit_';

class JobGoneError extends Error {}

async function fetchJob(jobId: string): Promise<JobStatus> {
  let res: Response;

  try {
    res = await fetch(`${stemServerUrl()}/jobs/${jobId}`);
  } catch {
    throw new Error(
      `Can't reach the stem server at ${stemServerUrl()}. Is it running?`,
    );
  }

  if (res.status === 404) {
    throw new JobGoneError(
      'The stem server no longer has this split (it was restarted or the result expired). Split the song again.',
    );
  }

  if (!res.ok) {
    throw new Error(`Stem server error ${res.status}`);
  }

  return res.json() as Promise<JobStatus>;
}

/**
 * Splits a song through the stem server. `stems` replaces the mixed audio
 * with drums, bass, vocals, ...; `kit` also splits the drums into kick,
 * snare, toms, hi-hat, ride and crash, written to the song's drumkit/ folder
 * (songs that already have drum stems only get the kit pass).
 */
export async function splitSong(
  reply: Reply,
  id: string,
  parts: SplitParts = 'stems',
): Promise<void> {
  if (activeSplits.has(id)) {
    return;
  }

  const split: { jobId?: string; cancelled: boolean } = { cancelled: false };

  activeSplits.set(id, split);

  try {
    const root = await getRoot(true);
    const songData: SongData | undefined = (await loadSongs(root.kind))[id];

    if (!songData) {
      throw new Error('Song not found');
    }

    // Kit only: the song already has drum stems, so send just those and
    // leave every other file alone.
    const kitOnly = parts === 'kit' && hasDrumAudio(songData.audio);
    const inputs = kitOnly
      ? songData.audio.filter(isDrumAudio)
      : splitInputs(songData.audio);

    if (inputs.length === 0) {
      throw new Error('This song has no audio to split');
    }

    const inputRels = inputs
      .map((a) => a.src)
      .filter((src) => src.startsWith(ASSET_PREFIX))
      .map((src) => src.slice(ASSET_PREFIX.length));
    const form = new FormData();

    for (const rel of inputRels) {
      form.append('files', await getFile(root.handle, rel), fileNameOf(rel));
    }

    form.append('quality', stemQuality());
    form.append(
      'mode',
      kitOnly ? 'kit' : parts === 'kit' ? 'stems+kit' : 'stems',
    );
    reply('split-song', { id, progress: 0 });

    const job = await request<JobStatus>('/jobs', {
      method: 'POST',
      body: form,
    });

    split.jobId = job.id;

    const pending: PendingSplit = { id, jobId: job.id, kitOnly, inputRels };

    rememberSplit(pending);
    await followSplit(reply, split, pending, job);
  } catch (error) {
    reply('split-song', {
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeSplits.delete(id);
  }
}

/**
 * Reattaches to splits saved by an earlier page load: each shows up in the
 * processing queue again and finishes as if the page never reloaded.
 */
export async function resumeSplits(reply: Reply): Promise<void> {
  const pending = Object.values(loadPending()).filter(
    (p) => !activeSplits.has(p.id),
  );

  await Promise.all(
    pending.map(async (p) => {
      const split = { jobId: p.jobId, cancelled: false };

      activeSplits.set(p.id, split);

      try {
        reply('split-song', { id: p.id, progress: 0 });
        await followSplit(reply, split, p, await fetchJob(p.jobId));
      } catch (error) {
        if (error instanceof JobGoneError) {
          forgetSplit(p.id);
        }

        reply('split-song', {
          id: p.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeSplits.delete(p.id);
      }
    }),
  );
}

/** Polls a server job to the end, then writes its stems into the song. */
async function followSplit(
  reply: Reply,
  split: { cancelled: boolean },
  pending: PendingSplit,
  initial: JobStatus,
): Promise<void> {
  const { id, kitOnly, inputRels } = pending;
  let job = initial;

  while (job.status === 'queued' || job.status === 'running') {
    if (split.cancelled) {
      forgetSplit(id);
      reply('split-song', { id, success: false, cancelled: true });

      return;
    }

    reply('split-song', { id, progress: Math.floor(job.progress) });
    await sleep(POLL_MS);

    try {
      job = await fetchJob(job.id);
    } catch (error) {
      if (error instanceof JobGoneError) {
        throw error;
      }

      // The server or network hiccuped: keep the job saved and retry.
      await sleep(POLL_MS * 4);
    }
  }

  if (job.status === 'cancelled' || split.cancelled) {
    forgetSplit(id);
    reply('split-song', { id, success: false, cancelled: true });

    return;
  }

  if (job.status === 'error' || job.stems.length === 0) {
    forgetSplit(id);

    throw new Error(job.error ?? 'The stem server returned no stems');
  }

  // Needs the library folder; after a reload that may need the user's
  // permission again, in which case the job stays saved for the next load.
  const root = await getRoot(true);
  const songData: SongData | undefined = (await loadSongs(root.kind))[id];

  if (!songData) {
    forgetSplit(id);

    throw new Error('Song not found');
  }

  // Download every stem before touching the song folder, so a failed
  // download leaves the original audio in place.
  const stems = await Promise.all(
    job.stems.map(async (name) => {
      const res = await fetch(
        `${stemServerUrl()}/jobs/${job.id}/stems/${name}`,
      );

      if (!res.ok) {
        throw new Error(`Failed to download the ${name} stem`);
      }

      return { name: `${name}.ogg`, data: await res.blob() };
    }),
  );
  let dir = root.handle;

  for (const part of songData.dir.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part);
  }

  if (!kitOnly) {
    for (const rel of inputRels) {
      await dir.removeEntry(fileNameOf(rel)).catch(() => undefined);
    }
  }

  const backingName = `${BACKING_STEM}.ogg`;
  const isKitStem = (name: string) => name.startsWith(KIT_STEM_PREFIX);
  const kitStems = stems.filter((s) => isKitStem(s.name));

  if (kitStems.length > 0) {
    // Replace any earlier kit split rather than mixing old and new pieces,
    // but keep the backing mix: a kit pass on drums from an earlier stem
    // split doesn't bring a new one.
    const old = await dir
      .getDirectoryHandle(DRUM_KIT_DIR)
      .catch(() => undefined);

    if (old) {
      const names: string[] = [];

      for await (const entry of old.values()) {
        if (entry.name !== backingName) {
          names.push(entry.name);
        }
      }

      for (const name of names) {
        await old.removeEntry(name, { recursive: true }).catch(() => undefined);
      }
    }
  }

  // Kit pieces and the backing mix live in drumkit/, where Clone Hero won't
  // play them on top of the stems.
  const kitDir = stems.some((s) => isKitStem(s.name) || s.name === backingName)
    ? await dir.getDirectoryHandle(DRUM_KIT_DIR, { create: true })
    : undefined;

  for (const stem of stems) {
    const isKit = isKitStem(stem.name);
    const target =
      (isKit || stem.name === backingName) && kitDir ? kitDir : dir;
    const name = isKit ? stem.name.slice(KIT_STEM_PREFIX.length) : stem.name;
    const writable = await (
      await target.getFileHandle(name, { create: true })
    ).createWritable();

    await writable.write(stem.data);
    await writable.close();
  }

  forgetSplit(id);
  fetch(`${stemServerUrl()}/jobs/${job.id}`, { method: 'DELETE' }).catch(
    () => undefined,
  );

  const updated = await buildSong(
    await listSongDir(root.handle, joinPath(songData.dir)),
    {
      id,
      liked: songData.liked,
      scoreData: songData.scoreData,
      drumDifficulties: songData.drumDifficulties,
    },
  );

  if (!updated) {
    throw new Error('Failed to rebuild the song after splitting');
  }

  const songs = await loadSongs(root.kind);

  songs[id] = updated;
  await saveSongs(root.kind, songs);
  clearAssetCache();
  reply('split-song', {
    id,
    success: true,
    song: await toUiSong(root, updated),
  });
}
