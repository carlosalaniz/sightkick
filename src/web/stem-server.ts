import { SongData } from '../types';
import { getFile, getRoot, joinPath, loadSongs, saveSongs } from './library';
import { buildSong, clearAssetCache, listSongDir, toUiSong } from './songs';

// Client for the optional stem server (stem-server/ in this repo), which splits
// a single mixed audio file into drums, bass, vocals, ... so drums can be muted.

export const STEM_SERVER_URL_KEY = 'settings.stemServerUrl';

export const DEFAULT_STEM_SERVER_URL = 'http://localhost:8765';

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

export function cancelSplit(id: string): void {
  const split = activeSplits.get(id);

  if (!split) {
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

export async function splitSong(reply: Reply, id: string): Promise<void> {
  const split: { jobId?: string; cancelled: boolean } = { cancelled: false };

  activeSplits.set(id, split);

  try {
    const root = await getRoot(true);
    const songData: SongData | undefined = (await loadSongs(root.kind))[id];

    if (!songData || songData.audio.length === 0) {
      throw new Error('No audio file found');
    }

    const audioRels = songData.audio
      .map((a) => a.src)
      .filter((src) => src.startsWith(ASSET_PREFIX))
      .map((src) => src.slice(ASSET_PREFIX.length));
    const form = new FormData();

    for (const rel of audioRels) {
      form.append('files', await getFile(root.handle, rel), fileNameOf(rel));
    }

    form.append('quality', stemQuality());
    reply('split-song', { id, progress: 0 });

    let job = await request<JobStatus>('/jobs', {
      method: 'POST',
      body: form,
    });

    split.jobId = job.id;

    while (job.status === 'queued' || job.status === 'running') {
      if (split.cancelled) {
        reply('split-song', { id, success: false, cancelled: true });

        return;
      }

      reply('split-song', { id, progress: Math.floor(job.progress) });
      await sleep(POLL_MS);
      job = await request<JobStatus>(`/jobs/${job.id}`);
    }

    if (job.status === 'cancelled' || split.cancelled) {
      reply('split-song', { id, success: false, cancelled: true });

      return;
    }

    if (job.status === 'error' || job.stems.length === 0) {
      throw new Error(job.error ?? 'The stem server returned no stems');
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

    for (const rel of audioRels) {
      await dir.removeEntry(fileNameOf(rel)).catch(() => undefined);
    }

    for (const stem of stems) {
      const writable = await (
        await dir.getFileHandle(stem.name, { create: true })
      ).createWritable();

      await writable.write(stem.data);
      await writable.close();
    }

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
