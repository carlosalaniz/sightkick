import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../renderer/hooks/test-support';
import { SongData } from '../types';
import { FakeDir, json, Route, routedFetch } from './test-support';

// The real split code and stem-server adapter, on a fake fetch and an
// in-memory song folder. Only the library's IndexedDB-backed storage is
// replaced (there is no IndexedDB in the test environment).
const storage = vi.hoisted(() => ({
  root: undefined as unknown,
  songs: {} as Record<string, unknown>,
  rootError: undefined as unknown,
  loadError: undefined as unknown,
}));

vi.mock('./library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./library')>()),
  getRoot: vi.fn(async () => {
    if (storage.rootError) {
      throw storage.rootError;
    }

    return { kind: 'browser', handle: storage.root, name: 'Browser storage' };
  }),
  loadSongs: vi.fn(async () => {
    if (storage.loadError) {
      throw storage.loadError;
    }

    return structuredClone(storage.songs);
  }),
  updateSongs: vi.fn(
    async (_kind: string, update: (songs: unknown) => typeof storage.songs) => {
      storage.songs = update(structuredClone(storage.songs));

      return storage.songs;
    },
  ),
}));

const {
  cancelSplit,
  MAX_CONSECUTIVE_POLL_FAILURES,
  PENDING_SPLITS_KEY,
  resumeSplits,
  splitFailureMessage,
  splitSong,
} = await import('./stem-server');
const { PermissionNeededError } = await import('./library');
const JOB = 'job-1';
let root: FakeDir;
let songDir: FakeDir;
const asset = (name: string) => ({
  name: name.replace(/\.ogg$/i, ''),
  src: `sk-asset:songs/one/${name}`,
});

function song(audio: string[], extra: Partial<SongData> = {}): SongData {
  return {
    id: 'song-1',
    dir: 'songs/one',
    name: 'Song',
    albumCover: null,
    format: 'chart',
    drumDifficulties: ['expert'],
    audio: audio.map(asset),
    ...extra,
  } as unknown as SongData;
}

/** A song folder with these audio files (content: "<name> original"). */
function library(audio: string[] = ['song.ogg']) {
  root = new FakeDir();
  root.put('songs/one/song.ini', '[song]\nname = Song\n');
  root.put('songs/one/notes.chart', 'chart');

  for (const name of audio) {
    root.put(`songs/one/${name}`, `${name} original`);
  }

  songDir = root.at('songs/one');
  storage.root = root;
  storage.songs = { 'song-1': song(audio) };
}

function job(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: JOB,
    status,
    stage: status,
    progress: 0,
    stems: [],
    error: null,
    ...extra,
  };
}

const done = (stems: string[]) => job('done', { progress: 100, stems });

interface ServerOptions {
  post?: Response | 'network-error';
  /** Answers to successive polls; the last one repeats. */
  polls?: (Response | 'network-error')[];
  stem?: (name: string) => Response;
}

function server({
  post = json(job('queued')),
  polls = [json(done(['drums', 'song']))],
  stem = (name) => new Response(`${name} stem`),
}: ServerOptions = {}) {
  const queue = [...polls];
  const routes: Route[] = [
    (url, init) =>
      url.endsWith('/jobs') && init.method === 'POST' ? post : undefined,
    (url, init) =>
      url.endsWith(`/jobs/${JOB}`) && init.method === 'DELETE'
        ? json({ id: JOB, cancelled: true })
        : undefined,
    (url) => {
      if (!url.endsWith(`/jobs/${JOB}`)) {
        return undefined;
      }

      const answer = queue.length > 1 ? queue.shift()! : queue[0];

      return answer === 'network-error' ? answer : answer.clone();
    },
    (url) => {
      const match = url.match(/\/stems\/([^/]+)$/);

      return match ? stem(match[1]) : undefined;
    },
  ];
  const fake = routedFetch(...routes);

  vi.stubGlobal('fetch', vi.fn(fake.fetch));

  return fake;
}

const pendingJobs = () =>
  JSON.parse(localStorage.getItem(PENDING_SPLITS_KEY) ?? '{}');

function savePendingJob(entry: Record<string, unknown> = {}) {
  localStorage.setItem(
    PENDING_SPLITS_KEY,
    JSON.stringify({
      'song-1': {
        id: 'song-1',
        jobId: JOB,
        kitOnly: false,
        inputRels: ['songs/one/song.ogg'],
        ...entry,
      },
    }),
  );
}

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();

  return work;
}

async function split(parts: 'stems' | 'kit' = 'stems') {
  const reply = vi.fn();

  await settle(splitSong(reply, 'song-1', parts));

  return reply;
}

async function resume() {
  const reply = vi.fn();

  await settle(resumeSplits(reply));

  return reply;
}

const lastReply = (reply: ReturnType<typeof vi.fn>) =>
  reply.mock.calls.at(-1)?.[1] as Record<string, unknown>;
const failedWith = (failure: Parameters<typeof splitFailureMessage>[0]) => ({
  id: 'song-1',
  success: false,
  error: splitFailureMessage(failure),
});

beforeEach(() => {
  installLocalStorage();
  vi.useFakeTimers();
  storage.rootError = undefined;
  storage.loadError = undefined;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  library();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a split that works', () => {
  it('follows the job, saved for a reload, and swaps the mix for the stems', async () => {
    let seenPending: unknown;
    const fake = server({
      polls: [
        json(job('running', { progress: 40 })),
        json(done(['bass', 'drums', 'song'])),
      ],
    });
    const reply = vi.fn((_channel: string, payload: unknown) => {
      if ((payload as { progress?: number }).progress === 40) {
        seenPending = pendingJobs();
      }
    });

    await settle(splitSong(reply, 'song-1'));

    expect(seenPending).toEqual({
      'song-1': {
        id: 'song-1',
        jobId: JOB,
        kitOnly: false,
        inputRels: ['songs/one/song.ogg'],
      },
    });
    expect(pendingJobs()).toEqual({});
    expect([...songDir.files.keys()].sort()).toEqual([
      'bass.ogg',
      'drums.ogg',
      'notes.chart',
      'song.ini',
      'song.ogg',
    ]);
    expect(await songDir.text('song.ogg')).toBe('song stem');
    expect(lastReply(reply)).toMatchObject({ id: 'song-1', success: true });
    expect(
      (storage.songs['song-1'] as SongData).audio.map((a) => a.name).sort(),
    ).toEqual(['bass', 'drums', 'song']);
    // The finished job is let go on the server.
    expect(fake.calls).toContainEqual({
      url: expect.stringContaining(`/jobs/${JOB}`),
      method: 'DELETE',
    });
  });

  it('removes inputs no stem replaced, and never one a stem overwrote', async () => {
    library(['Song.ogg', 'guitar.ogg', 'crowd.ogg']);
    storage.songs = { 'song-1': song(['Song.ogg', 'guitar.ogg', 'crowd.ogg']) };
    server({ polls: [json(done(['drums', 'song']))] });

    const removed = vi.spyOn(songDir, 'removeEntry');

    await split();

    // "Song.ogg" is the file the song stem just replaced where names ignore
    // case (macOS, Windows), so removing it would delete the new stem.
    expect(removed.mock.calls.map(([name]) => name)).toEqual(['guitar.ogg']);
    expect(songDir.files.has('crowd.ogg')).toBe(true);
  });

  it('keeps a like saved while the server worked', async () => {
    server({
      polls: [json(job('running')), json(done(['drums', 'song']))],
    });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      (storage.songs['song-1'] as SongData).liked = true;

      return json(job('queued'));
    });

    await split();

    expect((storage.songs['song-1'] as SongData).liked).toBe(true);
  });

  it('puts the backing mix in drumkit/ with the kit pieces', async () => {
    server({
      post: json(
        done(['backing', 'bass', 'drums', 'song', 'kit_kick', 'kit_snare']),
      ),
    });

    const reply = await split('kit');

    expect(lastReply(reply)).toMatchObject({ success: true });
    expect(
      [...songDir.files.keys()].filter((n) => n.endsWith('.ogg')).sort(),
    ).toEqual(['bass.ogg', 'drums.ogg', 'song.ogg']);
    expect([...songDir.at('drumkit').files.keys()].sort()).toEqual([
      'backing.ogg',
      'kick.ogg',
      'snare.ogg',
    ]);
  });

  it('replaces old kit pieces but keeps an earlier backing mix on a kit pass', async () => {
    library(['drums.ogg', 'bass.ogg']);
    root.put('songs/one/drumkit/backing.ogg', 'old backing');
    root.put('songs/one/drumkit/kick.ogg', 'old kick');
    root.put('songs/one/drumkit/crash.ogg', 'old crash');
    server({ post: json(done(['kit_kick', 'kit_snare'])) });

    await split('kit');

    const kit = songDir.at('drumkit');

    expect([...kit.files.keys()].sort()).toEqual([
      'backing.ogg',
      'kick.ogg',
      'snare.ogg',
    ]);
    expect(await kit.text('backing.ogg')).toBe('old backing');
    expect(await kit.text('kick.ogg')).toBe('kit_kick stem');
    expect(songDir.files.has('drums.ogg')).toBe(true);
  });

  it('reattaches to a saved job after a reload and finishes it', async () => {
    savePendingJob();
    server({
      polls: [
        json(job('running', { progress: 70 })),
        json(done(['drums', 'song'])),
      ],
    });

    const reply = await resume();

    expect(reply).toHaveBeenCalledWith('split-song', {
      id: 'song-1',
      progress: 70,
    });
    expect(lastReply(reply)).toMatchObject({ id: 'song-1', success: true });
    expect(pendingJobs()).toEqual({});
  });

  it('keeps following a job through a status it does not know', async () => {
    server({
      polls: [
        json(job('paused', { progress: 30 })),
        json(done(['drums', 'song'])),
      ],
    });

    const reply = await split();

    expect(lastReply(reply)).toMatchObject({ success: true });
    expect(console.warn).toHaveBeenCalledWith('split.job_status_unknown', {
      jobId: JOB,
      status: 'paused',
    });
  });
});

describe('a split the server turns down', () => {
  it.each([
    ['unreachable', 'network-error' as const, 'server_unreachable'],
    [
      'an upload over the limit (older server)',
      json({ detail: 'Upload is over 500 MB' }, 413),
      'upload_too_large',
    ],
    [
      'a full queue',
      json({ detail: 'Queue is full', code: 'busy' }, 429),
      'server_busy',
    ],
    [
      'a model that failed to load (older server)',
      json({ detail: 'htdemucs failed to load: CUDA' }, 503),
      'model_unavailable',
    ],
    [
      'a bad request',
      json({ detail: 'Send at most 16 files', code: 'bad_request' }, 400),
      'request_rejected',
    ],
    [
      'a crash (plain-text 500)',
      new Response('Internal Server Error', { status: 500 }),
      'server_failed',
    ],
    ['an answer that is not a job', json({ ok: true }), 'request_rejected'],
  ] as const)(
    'names %s, shows our own text and saves nothing',
    async (_, post, failure) => {
      server({ post });

      const reply = await split();

      expect(lastReply(reply)).toEqual(failedWith(failure));
      expect(pendingJobs()).toEqual({});
      expect(await songDir.text('song.ogg')).toBe('song.ogg original');
    },
  );

  it.each([
    ['decode_failed', 'decode_failed'],
    ['no_drums', 'no_drums'],
    ['model_unavailable', 'model_unavailable'],
    ['timed_out', 'server_timed_out'],
    ['internal', 'server_failed'],
    [undefined, 'server_failed'],
    ['gpu_on_fire', 'server_failed'],
  ] as const)(
    'maps a job that ended with errorCode %s',
    async (errorCode, failure) => {
      server({
        polls: [
          json(job('error', { errorCode, error: 'Traceback: ffmpeg exit 1' })),
        ],
      });

      const reply = await split();

      expect(lastReply(reply)).toEqual(failedWith(failure));
      expect(JSON.stringify(reply.mock.calls)).not.toContain('Traceback');
      expect(console.warn).toHaveBeenCalledWith(
        'split.job_failed_on_server',
        expect.objectContaining({
          jobId: JOB,
          detail: 'Traceback: ffmpeg exit 1',
        }),
      );
      expect(pendingJobs()).toEqual({});
    },
  );

  it('names a job that finished without stems', async () => {
    server({ polls: [json(done([]))] });

    expect(lastReply(await split())).toEqual(failedWith('no_stems'));
  });

  it('drops a saved job the server no longer has', async () => {
    savePendingJob();
    server({ polls: [json({ detail: 'Unknown or expired job' }, 404)] });

    const reply = await resume();

    expect(pendingJobs()).toEqual({});
    expect(lastReply(reply)).toEqual(failedWith('job_gone'));
  });
});

describe('a split that breaks halfway', () => {
  it('reports a stalled split after repeated failed polls and keeps the job', async () => {
    const fake = server({ polls: [json(job('running')), 'network-error'] });
    const reply = await split();

    expect(lastReply(reply)).toEqual(failedWith('server_stalled'));
    expect(pendingJobs()).toHaveProperty('song-1');
    expect(
      fake.calls.filter(
        (c) => c.method === 'GET' && c.url.endsWith(`/jobs/${JOB}`),
      ),
    ).toHaveLength(MAX_CONSECUTIVE_POLL_FAILURES + 1);
    expect(console.warn).toHaveBeenCalledWith(
      'split.poll_failed',
      expect.objectContaining({ songId: 'song-1', jobId: JOB, attempt: 2 }),
    );
  });

  it('keeps the job and the original audio when a stem download fails', async () => {
    server({
      stem: (name) =>
        name === 'drums'
          ? new Response('nope', { status: 500 })
          : new Response(`${name} stem`),
    });

    const reply = await split();

    expect(lastReply(reply)).toEqual(failedWith('download_failed'));
    expect(pendingJobs()).toHaveProperty('song-1');
    expect(await songDir.text('song.ogg')).toBe('song.ogg original');
    expect(songDir.files.has('drums.ogg')).toBe(false);
  });

  it('leaves the original audio in place when writing a stem fails', async () => {
    server({ polls: [json(done(['bass', 'drums', 'song']))] });
    songDir.failWrites.add('song.ogg');

    const reply = await split();

    expect(lastReply(reply)).toEqual(failedWith('write_failed'));
    expect(songDir.aborted).toEqual(['song.ogg']);
    expect(await songDir.text('song.ogg')).toBe('song.ogg original');
    // The stems that did get written are taken out again.
    expect(songDir.files.has('drums.ogg')).toBe(false);
    expect(songDir.files.has('bass.ogg')).toBe(false);
  });

  it('waits for folder access to save a resumed split, keeping the job', async () => {
    savePendingJob();
    server();
    storage.rootError = new PermissionNeededError('Songs');

    const reply = await resume();

    expect(lastReply(reply)).toEqual(failedWith('folder_access_needed'));
    expect(pendingJobs()).toHaveProperty('song-1');
  });

  it('keeps the job and logs an unexpected error', async () => {
    savePendingJob();
    server();
    storage.loadError = new Error('IndexedDB is gone');

    const reply = await resume();

    expect(lastReply(reply)).toEqual(failedWith('unexpected'));
    expect(pendingJobs()).toHaveProperty('song-1');
    expect(console.error).toHaveBeenCalledWith(
      'split.unexpected_error',
      { songId: 'song-1', jobId: JOB },
      expect.any(Error),
    );
  });

  it('names a song folder it cannot read back after saving the stems', async () => {
    songDir.files.delete('song.ini');
    server();

    expect(lastReply(await split())).toEqual(failedWith('rebuild_failed'));
  });
});

describe('a split that never starts', () => {
  it('names a song that is no longer in the library', async () => {
    storage.songs = {};
    server();

    expect(lastReply(await split())).toEqual(failedWith('song_not_found'));
  });

  it('names a song with nothing to split', async () => {
    storage.songs = { 'song-1': song([]) };

    const fake = server();

    expect(lastReply(await split())).toEqual(failedWith('no_audio'));
    expect(fake.calls).toEqual([]);
  });

  it('names audio it cannot read, without uploading', async () => {
    songDir.files.delete('song.ogg');

    const fake = server();

    expect(lastReply(await split())).toEqual(failedWith('audio_unreadable'));
    expect(fake.calls).toEqual([]);
  });
});

describe('cancelling and saved splits', () => {
  it('cancels a running split and tells the server', async () => {
    const fake = server({ polls: [json(job('running'))] });
    const reply = vi.fn((_channel: string, payload: unknown) => {
      if (
        (payload as { progress?: number }).progress === 0 &&
        reply.mock.calls.length > 1
      ) {
        cancelSplit('song-1');
      }
    });

    await settle(splitSong(reply, 'song-1'));

    expect(lastReply(reply)).toEqual({
      id: 'song-1',
      success: false,
      cancelled: true,
    });
    expect(pendingJobs()).toEqual({});
    expect(fake.calls).toContainEqual({
      url: expect.stringContaining(`/jobs/${JOB}`),
      method: 'DELETE',
    });
  });

  it('cancels a saved job that has not been reattached yet', async () => {
    savePendingJob();

    const fake = server();

    cancelSplit('song-1');
    await vi.runAllTimersAsync();

    expect(pendingJobs()).toEqual({});
    expect(fake.calls).toEqual([
      { url: expect.stringContaining(`/jobs/${JOB}`), method: 'DELETE' },
    ]);
  });

  it('drops a saved job an older build left without inputRels', async () => {
    savePendingJob({ inputRels: undefined });

    const fake = server();
    const reply = await resume();

    expect(reply).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
    expect(pendingJobs()).toEqual({});
    expect(console.warn).toHaveBeenCalledWith('split.pending_dropped', {
      songId: 'song-1',
    });
  });
});
