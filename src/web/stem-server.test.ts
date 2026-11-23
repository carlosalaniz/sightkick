import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../renderer/hooks/test-support';

const files = new Map<string, Blob>();
const removed: string[] = [];
const songDir = {
  getDirectoryHandle: vi.fn(async () => songDir),
  removeEntry: vi.fn(async (name: string) => {
    removed.push(name);
  }),
  getFileHandle: vi.fn(async (name: string) => ({
    createWritable: async () => ({
      write: async (data: Blob) => {
        files.set(name, data);
      },
      close: async () => undefined,
    }),
  })),
};
const SONG = {
  id: 'song-1',
  name: 'Song',
  dir: 'songs/one',
  audio: [{ name: 'song', src: 'sk-asset:songs/one/song.ogg' }],
};

vi.mock('./library', () => ({
  getRoot: vi.fn(async () => ({ kind: 'browser', handle: songDir })),
  loadSongs: vi.fn(async () => ({ 'song-1': SONG })),
  saveSongs: vi.fn(async () => undefined),
  getFile: vi.fn(async () => new Blob(['audio'])),
  joinPath: (p: string) => p,
}));

vi.mock('./songs', () => ({
  buildSong: vi.fn(async () => ({ ...SONG, audio: [] })),
  listSongDir: vi.fn(async () => []),
  clearAssetCache: vi.fn(),
  toUiSong: vi.fn(async () => ({ id: 'song-1', name: 'Song' })),
}));

const { resumeSplits, splitSong, cancelSplit, PENDING_SPLITS_KEY } =
  await import('./stem-server');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function job(status: string, progress = 0) {
  return {
    id: 'job-1',
    status,
    stage: status,
    progress,
    stems: status === 'done' ? ['drums', 'bass'] : [],
    error: null,
  };
}

const pendingJobs = () =>
  JSON.parse(localStorage.getItem(PENDING_SPLITS_KEY) ?? '{}');

describe('stem server splits across reloads', () => {
  beforeEach(() => {
    installLocalStorage();
    files.clear();
    removed.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves a running job and forgets it once the stems are written', async () => {
    const statuses = [job('running', 40), job('done', 100)];
    let seenPending: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/jobs') && init?.method === 'POST') {
          return jsonResponse(job('queued'));
        }

        if (url.endsWith('/jobs/job-1') && !init?.method) {
          seenPending = pendingJobs();

          return jsonResponse(statuses.shift());
        }

        if (url.includes('/stems/')) {
          return new Response('ogg');
        }

        return jsonResponse({});
      }),
    );

    const reply = vi.fn();
    const done = splitSong(reply, 'song-1');

    await vi.runAllTimersAsync();
    await done;

    expect(seenPending).toEqual({
      'song-1': {
        id: 'song-1',
        jobId: 'job-1',
        kitOnly: false,
        inputRels: ['songs/one/song.ogg'],
      },
    });
    expect(pendingJobs()).toEqual({});
    expect([...files.keys()]).toEqual(['drums.ogg', 'bass.ogg']);
    expect(reply).toHaveBeenLastCalledWith(
      'split-song',
      expect.objectContaining({ id: 'song-1', success: true }),
    );
  });

  it('reattaches to a saved job after a reload and finishes it', async () => {
    localStorage.setItem(
      PENDING_SPLITS_KEY,
      JSON.stringify({
        'song-1': {
          id: 'song-1',
          jobId: 'job-1',
          kitOnly: false,
          inputRels: ['songs/one/song.ogg'],
        },
      }),
    );

    const statuses = [job('running', 70), job('done', 100)];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/jobs/job-1') && !init?.method) {
          return jsonResponse(statuses.shift());
        }

        if (url.includes('/stems/')) {
          return new Response('ogg');
        }

        return jsonResponse({});
      }),
    );

    const reply = vi.fn();
    const done = resumeSplits(reply);

    await vi.runAllTimersAsync();
    await done;

    expect(reply).toHaveBeenCalledWith('split-song', {
      id: 'song-1',
      progress: 70,
    });
    expect(reply).toHaveBeenLastCalledWith(
      'split-song',
      expect.objectContaining({ id: 'song-1', success: true }),
    );
    expect(removed).toContain('song.ogg');
    expect(pendingJobs()).toEqual({});
  });

  it('drops a saved job the server no longer has', async () => {
    localStorage.setItem(
      PENDING_SPLITS_KEY,
      JSON.stringify({
        'song-1': {
          id: 'song-1',
          jobId: 'job-1',
          kitOnly: false,
          inputRels: [],
        },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ detail: 'Unknown job' }, 404)),
    );

    const reply = vi.fn();

    await resumeSplits(reply);

    expect(pendingJobs()).toEqual({});
    expect(reply).toHaveBeenLastCalledWith(
      'split-song',
      expect.objectContaining({ id: 'song-1', success: false }),
    );
  });

  it('cancels a saved job that has not been reattached yet', () => {
    localStorage.setItem(
      PENDING_SPLITS_KEY,
      JSON.stringify({
        'song-1': {
          id: 'song-1',
          jobId: 'job-1',
          kitOnly: false,
          inputRels: [],
        },
      }),
    );

    const fetchMock = vi.fn(async () => jsonResponse({}));

    vi.stubGlobal('fetch', fetchMock);
    cancelSplit('song-1');

    expect(pendingJobs()).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job-1'),
      { method: 'DELETE' },
    );
  });
});
