import { describe, expect, it, vi } from 'vitest';
import { SongData } from '../types';
import { mergeRescan, parseSongMap, withStoredUserData } from './library';

const song = (id: string, extra: Partial<SongData> = {}): SongData =>
  ({
    id,
    dir: `songs/${id}`,
    name: id,
    audio: [{ name: 'song', src: `sk-asset:songs/${id}/song.ogg` }],
    ...extra,
  }) as SongData;
const stems = (id: string) => [
  { name: 'drums', src: `sk-asset:songs/${id}/drums.ogg` },
  { name: 'song', src: `sk-asset:songs/${id}/song.ogg` },
];

describe('mergeRescan', () => {
  it('keeps a like and a score saved while the scan ran', () => {
    const before = { a: song('a') };
    const scanned = { a: song('a', { name: 'renamed' }) };
    const current = {
      a: song('a', {
        liked: true,
        scoreData: { expert: { score: 9 } } as never,
      }),
    };

    expect(mergeRescan(scanned, before, current).a).toEqual(
      song('a', {
        name: 'renamed',
        liked: true,
        scoreData: { expert: { score: 9 } } as never,
      }),
    );
  });

  it("takes a split's audio that landed after the scan listed the folder", () => {
    const before = { a: song('a') };
    const scanned = { a: song('a') };
    const current = { a: song('a', { audio: stems('a') }) };

    expect(mergeRescan(scanned, before, current).a.audio).toEqual(stems('a'));
  });

  it("keeps the scan's audio when storage didn't change it", () => {
    const before = { a: song('a') };
    const scanned = { a: song('a', { audio: stems('a') }) };
    const current = { a: song('a') };

    expect(mergeRescan(scanned, before, current).a.audio).toEqual(stems('a'));
  });

  it('keeps a song downloaded during the scan and drops one gone from disk', () => {
    const before = { a: song('a'), gone: song('gone') };
    const scanned = { a: song('a') };
    const current = { a: song('a'), gone: song('gone'), new: song('new') };

    expect(Object.keys(mergeRescan(scanned, before, current)).sort()).toEqual([
      'a',
      'new',
    ]);
  });
});

describe('withStoredUserData', () => {
  it("drops the fresh copy's like when storage has none", () => {
    expect(
      withStoredUserData(song('a', { liked: true }), song('a')),
    ).not.toHaveProperty('liked');
  });
});

describe('parseSongMap', () => {
  it('drops entries an older build or a bug left unusable, with a log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      parseSongMap(
        { a: song('a'), b: { id: 'b' }, c: song('x'), d: 'nope' },
        'browser',
      ),
    ).toEqual({ a: song('a') });
    expect(warn).toHaveBeenCalledWith('library.stored_song_dropped', {
      kind: 'browser',
      songId: 'b',
    });
    warn.mockRestore();
  });

  it('reads nothing stored as an empty library', () => {
    expect(parseSongMap(undefined, 'folder')).toEqual({});
  });
});
