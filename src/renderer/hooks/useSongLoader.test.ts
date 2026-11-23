import { ReactNode, createElement } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App as AntdApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { AudioData, Song } from '../../types';
import { installIpcMock, IpcMock } from './test-support';
import { buildTrackData, useSongLoader } from './useSongLoader';

let ipc: IpcMock;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    MemoryRouter,
    undefined,
    createElement(AntdApp, undefined, children),
  );
}

function response(audio: AudioData[]) {
  return {
    data: { format: 'mid', audio } as Song,
    fileData: Buffer.from([1, 2, 3]),
  };
}

beforeEach(() => {
  ipc = installIpcMock();
});

describe('useSongLoader', () => {
  it('groups every drums stem into a single track placed first', () => {
    const { result } = renderHook(() => useSongLoader('song-1'), { wrapper });

    act(() => {
      ipc.emit(
        'load-song',
        response([
          { name: 'song', src: 'song.ogg' },
          { name: 'drums_1', src: 'd1.ogg' },
          { name: 'drums_2', src: 'd2.ogg' },
          { name: 'guitar', src: 'g.ogg' },
        ]),
      );
    });

    expect(result.current.trackData).toEqual([
      { name: 'drums', urls: ['d1.ogg', 'd2.ogg'] },
      { name: 'song', urls: ['song.ogg'] },
      { name: 'guitar', urls: ['g.ogg'] },
    ]);
  });

  it('omits the drums track when there are no drums stems', () => {
    const { result } = renderHook(() => useSongLoader('song-1'), { wrapper });

    act(() => {
      ipc.emit('load-song', response([{ name: 'song', src: 's.ogg' }]));
    });

    expect(result.current.trackData).toEqual([
      { name: 'song', urls: ['s.ogg'] },
    ]);
  });

  it('does not treat a non-drums name containing "drum" as a drums stem', () => {
    const { result } = renderHook(() => useSongLoader('song-1'), { wrapper });

    act(() => {
      ipc.emit('load-song', response([{ name: 'drum', src: 'drum.ogg' }]));
    });

    expect(result.current.trackData).toEqual([
      { name: 'drum', urls: ['drum.ogg'] },
    ]);
  });

  it('requests each song as the id changes', () => {
    const { rerender } = renderHook(({ id }) => useSongLoader(id), {
      wrapper,
      initialProps: { id: 'song-1' as string | undefined },
    });

    rerender({ id: 'song-2' });

    expect(ipc.sent).toEqual([
      { channel: 'load-song', args: ['song-1'] },
      { channel: 'load-song', args: ['song-2'] },
    ]);
  });

  it('drops the pending listener when the id changes so a stale reply is not double-handled', () => {
    const { rerender } = renderHook(({ id }) => useSongLoader(id), {
      wrapper,
      initialProps: { id: 'song-1' as string | undefined },
    });

    rerender({ id: 'song-2' });

    expect(ipc.onceCount('load-song')).toBe(1);
  });

  it('drops the pending listener on unmount', () => {
    const { unmount } = renderHook(() => useSongLoader('song-1'), { wrapper });

    unmount();

    expect(ipc.onceCount('load-song')).toBe(0);
  });
});

describe('buildTrackData', () => {
  const split = {
    audio: [
      { name: 'drums', src: 'drums.ogg' },
      { name: 'bass', src: 'bass.ogg' },
      { name: 'vocals', src: 'vocals.ogg' },
      { name: 'song', src: 'song.ogg' },
      { name: 'crowd', src: 'crowd.ogg' },
    ],
    backing: { name: 'backing', src: 'backing.ogg' },
  };

  it('plays the backing mix instead of the instrument stems when asked to', () => {
    expect(buildTrackData(split, true)).toEqual([
      { name: 'drums', urls: ['drums.ogg'] },
      { name: 'backing', urls: ['backing.ogg'] },
      { name: 'crowd', urls: ['crowd.ogg'] },
    ]);
  });

  it('keeps every stem otherwise, or when the song has no backing mix', () => {
    const all = [
      { name: 'drums', urls: ['drums.ogg'] },
      { name: 'bass', urls: ['bass.ogg'] },
      { name: 'vocals', urls: ['vocals.ogg'] },
      { name: 'song', urls: ['song.ogg'] },
      { name: 'crowd', urls: ['crowd.ogg'] },
    ];

    expect(buildTrackData(split, false)).toEqual(all);
    expect(buildTrackData({ audio: split.audio }, true)).toEqual(all);
  });
});
