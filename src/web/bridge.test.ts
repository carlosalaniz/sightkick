import { describe, expect, it, vi } from 'vitest';

vi.mock('./handlers', () => ({
  loadSongList: vi.fn(async (reply: (c: string, p: unknown) => void) =>
    reply('load-song-list', { songs: [], lastOpenedPath: 'Browser storage' }),
  ),
  rescanSongs: vi.fn(async () => undefined),
  stopListenMidi: vi.fn(),
}));

vi.mock('./stem-server', () => ({
  checkStemServer: vi.fn(async () => false),
  splitSong: vi.fn(async () => undefined),
  cancelSplit: vi.fn(),
}));

const { webHandler } = await import('./bridge');
const stemServer = await import('./stem-server');
const handlers = await import('./handlers');
const ipc = webHandler.ipcRenderer;

describe('web bridge', () => {
  it('delivers replies asynchronously, so subscribing after sending works', async () => {
    const listener = vi.fn();

    ipc.sendMessage('load-song-list');
    ipc.once('load-song-list', listener);
    expect(listener).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith({
        songs: [],
        lastOpenedPath: 'Browser storage',
      }),
    );
  });

  it('only calls a once-listener for the first reply', async () => {
    const listener = vi.fn();

    ipc.once('check-stem-tools', listener);
    ipc.sendMessage('check-stem-tools');
    ipc.sendMessage('check-stem-tools');

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports stem tools as unsupported when no stem server answers', async () => {
    const listener = vi.fn();
    const off = ipc.on('check-stem-tools', listener);

    ipc.sendMessage('check-stem-tools');

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith({ status: 'unsupported' }),
    );
    off();
  });

  it('passes the rescan mode through, defaulting to picking a folder', () => {
    ipc.sendMessage('rescan-songs');
    ipc.sendMessage('rescan-songs', 'browser');

    expect(handlers.rescanSongs).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      undefined,
    );
    expect(handlers.rescanSongs).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      'browser',
    );
  });

  it('reports stem tools as ready when the stem server answers', async () => {
    vi.mocked(stemServer.checkStemServer).mockResolvedValueOnce(true);

    const listener = vi.fn();
    const off = ipc.on('check-stem-tools', listener);

    ipc.sendMessage('check-stem-tools');

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith({ status: 'ready' }),
    );
    off();
  });

  it('sends splits and cancels to the stem server', () => {
    ipc.sendMessage('split-song', 'song-1');
    ipc.sendMessage('cancel-split', 'song-1');

    expect(stemServer.splitSong).toHaveBeenCalledWith(
      expect.any(Function),
      'song-1',
    );
    expect(stemServer.cancelSplit).toHaveBeenCalledWith('song-1');
  });

  it('ignores desktop-only channels', () => {
    expect(() => ipc.sendMessage('check-update')).not.toThrow();
    expect(() => ipc.sendMessage('open-song-directory', '/x')).not.toThrow();
  });
});
