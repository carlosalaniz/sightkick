import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SongData } from '../types';
import { clearAssetCache, toUiSong } from './songs';
import { LibraryRoot } from './library';

// A one-folder library root: getFile resolves names in it, anything else is
// missing, as a moved or deleted file would be.
function folder(files: Record<string, string>) {
  const dir = {
    getDirectoryHandle: async () => dir,
    getFileHandle: async (name: string) => {
      if (!(name in files)) {
        throw new DOMException('missing', 'NotFoundError');
      }

      return { getFile: async () => new File([files[name]], name) };
    },
  };

  return dir as unknown as FileSystemDirectoryHandle;
}

const stored = {
  id: 'song-1',
  dir: 'one',
  name: 'Song',
  albumCover: 'sk-asset:one/album.png',
  format: 'chart',
  audio: [
    { name: 'drums', src: 'sk-asset:one/drums.ogg' },
    { name: 'song', src: 'sk-asset:one/song.ogg' },
  ],
  drumKit: [{ name: 'kick', src: 'sk-asset:one/drumkit/kick.ogg' }],
  drumDifficulties: [],
} as unknown as SongData;

beforeEach(() => {
  let n = 0;

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      n += 1;

      return `blob:${n}`;
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  clearAssetCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toUiSong', () => {
  it('leaves out a track whose file is gone, with a log, instead of an sk-asset ref', async () => {
    const root: LibraryRoot = {
      kind: 'browser',
      name: 'Browser storage',
      handle: folder({ 'song.ogg': 'mix' }),
    };
    const song = await toUiSong(root, stored, { withAudio: true });

    expect(song.audio).toEqual([{ name: 'song', src: 'blob:1' }]);
    expect(song.albumCover).toBeUndefined();
    expect(song).not.toHaveProperty('drumKit');
    expect(console.warn).toHaveBeenCalledWith('library.asset_missing', {
      songId: 'song-1',
      rel: 'one/drums.ogg',
      error: 'NotFoundError',
    });
  });

  it('resolves every file that is there', async () => {
    const root: LibraryRoot = {
      kind: 'browser',
      name: 'Browser storage',
      handle: folder({
        'album.png': 'png',
        'drums.ogg': 'd',
        'song.ogg': 's',
        'kick.ogg': 'k',
      }),
    };
    const song = await toUiSong(root, stored, { withAudio: true });

    expect(song.albumCover).toMatch(/^blob:/);
    expect(song.audio.every((a) => a.src.startsWith('blob:'))).toBe(true);
    expect(song.drumKit).toEqual([{ name: 'kick', src: expect.any(String) }]);
  });
});
