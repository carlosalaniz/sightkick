import { SngStream } from '@eliwhite/parse-sng';
import {
  IpcUpdateSongPayload,
  RescanMode,
  SongData,
  StorageSchema,
} from '../types';
import { assertNever } from '../shared/assertNever';
import {
  canPickFolder,
  getRoot,
  getRootKind,
  getRootName,
  LibraryRoot,
  loadSongs,
  mergeRescan,
  PermissionNeededError,
  selectBrowserRoot,
  selectFolderRoot,
  updateSongs,
  updateStoredSong,
} from './library';
import {
  buildSong,
  clearAssetCache,
  findSongDirs,
  listSongDir,
  mapLimit,
  SONG_ID_FILE,
  toUiSong,
} from './songs';
import { listenMidi, listMidiDevices, stopListenMidi } from './midi';

export type Reply = (channel: string, payload: unknown) => void;

const errorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

async function uiSongList(root: LibraryRoot, songs: StorageSchema['songs']) {
  return mapLimit(Object.values(songs), 16, (s) => toUiSong(root, s));
}

// When a picked folder lost its permission (browsers drop it between visits),
// the list is shown from cache and access is re-requested on the next click.
function regainPermissionOnNextClick(reply: Reply) {
  const handler = async () => {
    window.removeEventListener('pointerdown', handler, true);

    try {
      const root = await getRoot(true);

      clearAssetCache();
      reply('rescan-songs', {
        songs: await uiSongList(root, await loadSongs(root.kind)),
        lastOpenedPath: root.name,
      });
    } catch {
      // Still denied; the folder button lets the user pick again.
    }
  };

  window.addEventListener('pointerdown', handler, true);
}

export async function loadSongList(reply: Reply) {
  try {
    const kind = await getRootKind();
    const songs = await loadSongs(kind);

    try {
      const root = await getRoot(false);

      reply('load-song-list', {
        songs: await uiSongList(root, songs),
        lastOpenedPath: root.name,
      });
    } catch (error) {
      if (!(error instanceof PermissionNeededError)) {
        throw error;
      }

      reply('load-song-list', {
        songs: Object.values(songs).map((s) => ({
          ...s,
          albumCover: undefined,
        })),
        lastOpenedPath: await getRootName(),
      });
      regainPermissionOnNextClick(reply);
    }
  } catch (error) {
    reply('load-song-list', errorPayload(error));
  }
}

type RescanTarget = { kind: 'root'; root: LibraryRoot } | { kind: 'cancelled' };

async function rootForRescan(mode: RescanMode): Promise<RescanTarget> {
  switch (mode) {
    case 'browser':
      return { kind: 'root', root: await selectBrowserRoot() };

    case 'pick': {
      if (!canPickFolder()) {
        // Browser storage is the only library here: rescan it.
        return { kind: 'root', root: await getRoot(true) };
      }

      // Must be the first await so the click's user activation is still valid.
      let handle: FileSystemDirectoryHandle;

      try {
        handle = await window.showDirectoryPicker!({
          id: 'sightkick-library',
          mode: 'readwrite',
        });
      } catch {
        return { kind: 'cancelled' }; // the user closed the picker
      }

      return { kind: 'root', root: await selectFolderRoot(handle) };
    }

    case 'current':
      return { kind: 'root', root: await getRoot(true) };

    default:
      return assertNever(mode, 'rescan mode');
  }
}

export async function rescanSongs(reply: Reply, mode: RescanMode) {
  try {
    const target = await rootForRescan(mode);

    if (target.kind === 'cancelled') {
      return;
    }

    const { root } = target;

    clearAssetCache();

    const existing = await loadSongs(root.kind);
    const existingByDir = new Map(
      Object.values(existing).map((s) => [s.dir, s] as const),
    );

    reply('rescan-songs', { current: 0, total: 0 });

    const dirs = await findSongDirs(root.handle);
    const total = dirs.length;
    const step = Math.max(1, Math.floor(total / 100));
    let done = 0;

    reply('rescan-songs', { current: 0, total });

    const built = await mapLimit(dirs, 8, async (dir) => {
      let song: SongData | null = null;

      try {
        song = await buildSong(dir, existingByDir.get(dir.rel));
      } catch (error) {
        console.warn(`Skipping "${dir.rel}":`, error);
      }

      done += 1;

      if (done % step === 0 || done === total) {
        reply('rescan-songs', { current: done, total });
      }

      return song;
    });
    const scanned: StorageSchema['songs'] = {};

    for (const song of built) {
      if (song) {
        scanned[song.id] = song;
      }
    }

    const songs = await updateSongs(root.kind, (current) =>
      mergeRescan(scanned, existing, current),
    );

    reply('rescan-songs', {
      songs: await uiSongList(root, songs),
      lastOpenedPath: root.name,
    });
  } catch (error) {
    reply('rescan-songs', errorPayload(error));
  }
}

export async function loadSong(reply: Reply, id: string) {
  try {
    const root = await getRoot(true);
    const songData = (await loadSongs(root.kind))[id];

    if (!songData) {
      throw new Error(`Song "${id}" not found`);
    }

    const notesFile = await (
      await (
        await listSongDir(root.handle, songData.dir)
      ).files.get(songData.format === 'mid' ? 'notes.mid' : 'notes.chart')
    )?.getFile();

    if (!notesFile) {
      throw new Error('The chart file is missing. Rescan your library.');
    }

    reply('load-song', {
      data: await toUiSong(root, songData, { withAudio: true }),
      fileData: new Uint8Array(await notesFile.arrayBuffer()),
    });
  } catch (error) {
    reply('load-song', errorPayload(error));
  }
}

export async function updateSong(reply: Reply, payload: IpcUpdateSongPayload) {
  try {
    const { id, ...update } = payload;
    const root = await getRoot(false);
    const next = await updateStoredSong(root.kind, id, (prev) => ({
      ...prev,
      ...update,
      scoreData: { ...prev.scoreData, ...update.scoreData },
    }));

    reply('update-song', await toUiSong(root, next));
  } catch (error) {
    reply('update-song', errorPayload(error));
  }
}

export async function likeSong(id: string, liked: boolean) {
  await updateStoredSong(await getRootKind(), id, (prev) => ({
    ...prev,
    liked,
  }));
}

interface DownloadProps {
  url: string;
  md5: string;
  name: string;
  artist: string;
  charter: string;
}

async function unpackSng(data: Uint8Array) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const sngStream = new SngStream(stream, { generateSongIni: true });
  const files: { name: string; data: Blob }[] = [];

  await new Promise<void>((resolve, reject) => {
    sngStream.on('error', reject);
    sngStream.on(
      'file',
      async (
        fileName: string,
        fileStream: ReadableStream<Uint8Array>,
        nextFile: (() => void) | null,
      ) => {
        try {
          files.push({
            name: fileName,
            data: await new Response(fileStream).blob(),
          });
        } catch (error) {
          reject(error);

          return;
        }

        if (nextFile) {
          nextFile();
        } else {
          resolve();
        }
      },
    );
    sngStream.start();
  });

  return files;
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
) {
  const writable = await (
    await dir.getFileHandle(name, { create: true })
  ).createWritable();

  await writable.write(data);
  await writable.close();
}

const isSafeFileName = (name: string) =>
  name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);

export async function downloadSong(
  reply: Reply,
  { url, md5, name, artist, charter }: DownloadProps,
) {
  try {
    const root = await getRoot(true);
    const folderName = `${artist} - ${name} (${charter})`.replace(
      /[\\/:*?"<>|]/g,
      '',
    );
    const songs = await loadSongs(root.kind);
    const folderExists = await root.handle
      .getDirectoryHandle(folderName)
      .then(() => true)
      .catch(() => false);

    if (songs[md5] || folderExists) {
      reply('download-song', { success: false, md5, alreadyExists: true });

      return;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const files = await unpackSng(new Uint8Array(await response.arrayBuffer()));
    const unsafe = files.find((f) => !isSafeFileName(f.name));

    if (unsafe) {
      throw new Error(`Unsafe file path in archive: ${unsafe.name}`);
    }

    const outputDir = await root.handle.getDirectoryHandle(folderName, {
      create: true,
    });

    try {
      for (const file of files) {
        await writeFile(outputDir, file.name, file.data);
      }

      await writeFile(outputDir, SONG_ID_FILE, JSON.stringify({ id: md5 }));
    } catch (error) {
      await root.handle
        .removeEntry(folderName, { recursive: true })
        .catch(() => undefined);

      throw error;
    }

    const songData = await buildSong(
      await listSongDir(root.handle, folderName),
      {
        id: md5,
      },
    );

    if (!songData) {
      throw new Error('Failed to parse downloaded song');
    }

    await updateStoredSongs(root, songData);
    reply('download-song', {
      success: true,
      md5,
      song: await toUiSong(root, songData),
    });
  } catch (error) {
    reply('download-song', { success: false, md5, error: String(error) });
  }
}

async function updateStoredSongs(root: LibraryRoot, song: SongData) {
  await updateSongs(root.kind, (songs) => ({ ...songs, [song.id]: song }));
}

export async function midiDeviceList(reply: Reply) {
  reply('midi-device-list', await listMidiDevices());
}

export async function startMidi(reply: Reply, port: number) {
  try {
    await listenMidi(port, (message) => reply('listen-midi', message));
  } catch (error) {
    stopListenMidi();
    reply('midi-error', errorPayload(error));
  }
}

export { stopListenMidi };

let wakeLock: WakeLockSentinel | null = null;
let wantWakeLock = false;

async function acquireWakeLock() {
  if (!wantWakeLock || wakeLock || !('wakeLock' in navigator)) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Denied (e.g. tab hidden); retried when the tab becomes visible.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    acquireWakeLock();
  }
});

export function preventSleep() {
  wantWakeLock = true;
  acquireWakeLock();
}

export function resumeSleep() {
  wantWakeLock = false;
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

/** Browsers can't write a PDF silently, so the print dialog is used instead. */
export function exportPdf(reply: Reply, { html }: { html: string }) {
  const iframe = document.createElement('iframe');

  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
    reply('export-pdf', { canceled: true });
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;

    if (!win) {
      cleanup();

      return;
    }

    win.addEventListener('afterprint', () => setTimeout(cleanup, 0), {
      once: true,
    });
    win.focus();
    win.print();
  };
  iframe.srcdoc = html;
}
