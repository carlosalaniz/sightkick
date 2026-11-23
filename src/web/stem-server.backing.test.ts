import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../renderer/hooks/test-support';

// A small in-memory folder tree, enough for where split stems get written.
class Dir {
  files = new Map<string, Blob>();

  dirs = new Map<string, Dir>();

  constructor(public name = '') {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let dir = this.dirs.get(name);

    if (!dir) {
      if (!opts?.create) {
        throw new DOMException('missing', 'NotFoundError');
      }

      dir = new Dir(name);
      this.dirs.set(name, dir);
    }

    return dir;
  }

  async getFileHandle(name: string) {
    return {
      createWritable: async () => ({
        write: async (data: Blob) => {
          this.files.set(name, data);
        },
        close: async () => undefined,
      }),
    };
  }

  async removeEntry(name: string) {
    this.files.delete(name);
    this.dirs.delete(name);
  }

  async *values() {
    for (const name of this.files.keys()) {
      yield { kind: 'file', name };
    }

    for (const name of this.dirs.keys()) {
      yield { kind: 'directory', name };
    }
  }
}

const state = vi.hoisted(() => ({
  root: undefined as unknown,
  song: undefined as unknown,
}));

vi.mock('./library', () => ({
  getRoot: vi.fn(async () => ({ kind: 'browser', handle: state.root })),
  loadSongs: vi.fn(async () => ({ 'song-1': state.song })),
  saveSongs: vi.fn(async () => undefined),
  getFile: vi.fn(async () => new Blob(['audio'])),
  joinPath: (p: string) => p,
}));

vi.mock('./songs', () => ({
  buildSong: vi.fn(async () => state.song),
  listSongDir: vi.fn(async () => []),
  clearAssetCache: vi.fn(),
  toUiSong: vi.fn(async () => ({ id: 'song-1', name: 'Song' })),
}));

const { splitSong } = await import('./stem-server');
let root: Dir;
let songDir: Dir;

function serveJob(stems: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        url.endsWith('/jobs') && init?.method === 'POST'
          ? { id: 'job-1', status: 'done', progress: 100, stems, error: null }
          : url.endsWith('/jobs/job-1') && !init?.method
          ? { id: 'job-1', status: 'done', progress: 100, stems, error: null }
          : undefined;

      if (body) {
        return new Response(JSON.stringify(body));
      }

      if (url.includes('/stems/')) {
        return new Response(url.split('/').pop());
      }

      return new Response('{}');
    }),
  );
}

async function split(parts: 'stems' | 'kit') {
  const reply = vi.fn();
  const done = splitSong(reply, 'song-1', parts);

  await vi.runAllTimersAsync();
  await done;

  expect(reply).toHaveBeenLastCalledWith(
    'split-song',
    expect.objectContaining({ success: true }),
  );
}

beforeEach(async () => {
  installLocalStorage();
  vi.useFakeTimers();
  root = new Dir();
  songDir = await (
    await root.getDirectoryHandle('songs', { create: true })
  ).getDirectoryHandle('one', { create: true });
  state.root = root;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('where a split writes the backing mix', () => {
  it('puts it in drumkit/ with the kit pieces, not next to the stems', async () => {
    songDir.files.set('song.ogg', new Blob(['mix']));
    state.song = {
      id: 'song-1',
      dir: 'songs/one',
      audio: [{ name: 'song', src: 'sk-asset:songs/one/song.ogg' }],
    };
    serveJob(['backing', 'bass', 'drums', 'song', 'kit_kick', 'kit_snare']);

    await split('kit');

    expect([...songDir.files.keys()].sort()).toEqual([
      'bass.ogg',
      'drums.ogg',
      'song.ogg',
    ]);
    expect([...songDir.dirs.get('drumkit')!.files.keys()].sort()).toEqual([
      'backing.ogg',
      'kick.ogg',
      'snare.ogg',
    ]);
    expect(await songDir.files.get('song.ogg')!.text()).toBe('song');
  });

  it('keeps an earlier backing mix when a kit pass replaces the kit pieces', async () => {
    songDir.files.set('drums.ogg', new Blob(['drums']));
    songDir.files.set('bass.ogg', new Blob(['bass']));

    const kit = await songDir.getDirectoryHandle('drumkit', { create: true });

    kit.files.set('backing.ogg', new Blob(['old backing']));
    kit.files.set('kick.ogg', new Blob(['old kick']));
    kit.files.set('crash.ogg', new Blob(['old crash']));
    state.song = {
      id: 'song-1',
      dir: 'songs/one',
      audio: [
        { name: 'drums', src: 'sk-asset:songs/one/drums.ogg' },
        { name: 'bass', src: 'sk-asset:songs/one/bass.ogg' },
      ],
    };
    serveJob(['kit_kick', 'kit_snare']);

    await split('kit');

    expect([...kit.files.keys()].sort()).toEqual([
      'backing.ogg',
      'kick.ogg',
      'snare.ogg',
    ]);
    expect(await kit.files.get('backing.ogg')!.text()).toBe('old backing');
    expect([...songDir.files.keys()].sort()).toEqual(['bass.ogg', 'drums.ogg']);
  });
});
