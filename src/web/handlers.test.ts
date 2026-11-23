import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDir, json, routedFetch } from './test-support';

// downloadSong on a fake fetch, an in-memory library folder and a stand-in
// .sng reader (the vendor parser), with only the IndexedDB-backed song
// storage stubbed.
const storage = vi.hoisted(() => ({
  root: undefined as unknown,
  songs: {} as Record<string, unknown>,
  archive: [] as { name: string; content: string }[] | 'corrupt',
}));

vi.mock('./library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./library')>()),
  getRoot: vi.fn(async () => ({
    kind: 'browser',
    handle: storage.root,
    name: 'Browser storage',
  })),
  loadSongs: vi.fn(async () => structuredClone(storage.songs)),
  updateSongs: vi.fn(
    async (_kind: string, update: (songs: unknown) => typeof storage.songs) => {
      storage.songs = update(structuredClone(storage.songs));

      return storage.songs;
    },
  ),
}));

vi.mock('@eliwhite/parse-sng', () => ({
  SngStream: class {
    private handlers = new Map<string, (...args: unknown[]) => unknown>();

    on(event: string, handler: (...args: unknown[]) => unknown) {
      this.handlers.set(event, handler);
    }

    start() {
      if (storage.archive === 'corrupt') {
        this.handlers.get('error')?.(new Error('bad sng header'));

        return;
      }

      const files = [...storage.archive];
      const next = () => {
        const file = files.shift()!;

        this.handlers.get('file')?.(
          file.name,
          new Response(file.content).body,
          files.length > 0 ? next : null,
        );
      };

      next();
    }
  },
}));

const { downloadFailureMessage, downloadSong } = await import('./handlers');
const SONG = {
  url: 'https://files.example/song.sng',
  md5: 'abc123',
  name: 'Song',
  artist: 'Band',
  charter: 'Someone',
};
const FOLDER = 'Band - Song (Someone)';
let root: FakeDir;
const goodArchive = () => [
  { name: 'song.ini', content: '[song]\nname = Song\n' },
  { name: 'notes.chart', content: 'chart' },
  { name: 'song.ogg', content: 'audio' },
];

function serve(response: Response | 'network-error' = new Response('sng')) {
  const fake = routedFetch(() =>
    response === 'network-error' ? response : response.clone(),
  );

  vi.stubGlobal('fetch', vi.fn(fake.fetch));

  return fake;
}

async function download() {
  const reply = vi.fn();

  await downloadSong(reply, SONG);

  return reply.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

const failedWith = (failure: Parameters<typeof downloadFailureMessage>[0]) => ({
  success: false,
  md5: SONG.md5,
  error: downloadFailureMessage(failure),
});

beforeEach(() => {
  root = new FakeDir();
  storage.root = root;
  storage.songs = {};
  storage.archive = goodArchive();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadSong', () => {
  it('writes the song into its own folder and stores it', async () => {
    serve();

    expect(await download()).toMatchObject({ success: true, md5: SONG.md5 });
    expect([...root.at(FOLDER).files.keys()].sort()).toEqual([
      '.sightkick',
      'notes.chart',
      'song.ini',
      'song.ogg',
    ]);
    expect(storage.songs).toHaveProperty(SONG.md5);
  });

  it('puts a timeout on the download', async () => {
    serve();
    await download();

    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it('rejects an archive with a path that leaves its folder, writing nothing', async () => {
    storage.archive = [...goodArchive(), { name: '../evil.sh', content: 'x' }];
    serve();

    expect(await download()).toEqual(failedWith('unsafe_path'));
    expect(root.dirs.size).toBe(0);
  });

  it('removes a half-written folder when a write fails', async () => {
    serve();

    const create = root.getDirectoryHandle.bind(root);

    vi.spyOn(root, 'getDirectoryHandle').mockImplementation(
      async (name, opts) => {
        const dir = await create(name, opts);

        dir.failWrites.add('song.ogg');

        return dir;
      },
    );

    expect(await download()).toEqual(failedWith('write_failed'));
    expect(root.dirs.has(FOLDER)).toBe(false);
    expect(storage.songs).toEqual({});
  });

  it.each([
    ['no connection', 'network-error' as const, 'unreachable'],
    ['an error status', new Response('gone', { status: 410 }), 'http_error'],
  ] as const)('names %s', async (_, response, failure) => {
    serve(response);

    expect(await download()).toEqual(failedWith(failure));
  });

  it('names an archive it cannot read', async () => {
    storage.archive = 'corrupt';
    serve();

    expect(await download()).toEqual(failedWith('bad_archive'));
  });

  it('names a song it cannot read back, and removes its folder', async () => {
    storage.archive = [{ name: 'readme.txt', content: 'hi' }];
    serve();

    expect(await download()).toEqual(failedWith('unreadable_song'));
    expect(root.dirs.has(FOLDER)).toBe(false);
  });

  it('says a song is already in the library', async () => {
    storage.songs = { [SONG.md5]: { id: SONG.md5 } };
    serve();

    expect(await download()).toEqual({
      success: false,
      md5: SONG.md5,
      alreadyExists: true,
    });
  });

  it('runs one download per song at a time', async () => {
    const fake = serve(json({}));
    const reply = vi.fn();

    await Promise.all([downloadSong(reply, SONG), downloadSong(reply, SONG)]);

    expect(fake.calls).toHaveLength(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
