import { SngStream } from '@eliwhite/parse-sng';
import {
  IpcUpdateSongPayload,
  RescanMode,
  SongData,
  StorageSchema,
} from '../types';
import { assertNever } from '../shared/assertNever';
import { log, LogFields } from '../shared/log';
import {
  canPickFolder,
  errorName,
  getRoot,
  getRootKind,
  getRootName,
  LibraryRoot,
  loadSongs,
  mergeRescan,
  PermissionNeededError,
  removeIfPresent,
  selectBrowserRoot,
  selectFolderRoot,
  updateSongs,
  updateStoredSong,
  writeFile,
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
import { resumeSplits } from './stem-server';

export type Reply = (channel: string, payload: unknown) => void;

/**
 * The error reply of a handler that failed unexpectedly. The renderer shows
 * its own text for these channels; the error itself (its message may be a
 * browser API's) goes to the log, with the channel and IDs.
 */
function errorPayload(channel: string, error: unknown, fields: LogFields = {}) {
  log.error('ipc.handler_failed', { channel, ...fields }, error);

  return { error: `SightKick couldn't complete "${channel}".` };
}

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
      // Splits that finished while access was missing were kept to save now.
      await resumeSplits(reply);
    } catch (error) {
      if (error instanceof PermissionNeededError) {
        // Still denied; the folder button lets the user pick again.
        log.info('library.permission_still_denied');

        return;
      }

      log.error('library.regain_access_failed', {}, error);
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
    reply('load-song-list', errorPayload('load-song-list', error));
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
        log.warn('library.song_skipped', {
          dir: dir.rel,
          error: errorName(error),
        });
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
    reply('rescan-songs', errorPayload('rescan-songs', error, { mode }));
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
    reply('load-song', errorPayload('load-song', error, { songId: id }));
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
    reply(
      'update-song',
      errorPayload('update-song', error, { songId: payload.id }),
    );
  }
}

/** The renderer shows the like at once and expects no reply. */
export async function likeSong(id: string, liked: boolean) {
  try {
    await updateStoredSong(await getRootKind(), id, (prev) => ({
      ...prev,
      liked,
    }));
  } catch (error) {
    log.error('library.like_not_saved', { songId: id, liked }, error);
  }
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

const isSafeFileName = (name: string) =>
  name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);

/** A chart archive is a few MB to a few tens of MB. */
export const SONG_DOWNLOAD_TIMEOUT_MS = 2 * 60_000;

/** Why a song download didn't add a song, in our terms. */
export type DownloadFailure =
  | 'unreachable'
  | 'http_error'
  | 'bad_archive'
  | 'unsafe_path'
  | 'write_failed'
  | 'unreadable_song'
  | 'folder_access_needed'
  | 'unexpected';

const DOWNLOAD_FAILURE_MESSAGES: Record<DownloadFailure, string> = {
  unreachable:
    "Couldn't reach the download server, or it took too long. Try again.",
  http_error: 'The download server refused the download. Try again later.',
  bad_archive: "The downloaded file isn't a song SightKick can read.",
  unsafe_path:
    'The download contains a file path that could write outside its folder, so it was skipped.',
  write_failed: "Couldn't save the song into your library.",
  unreadable_song: "The downloaded song couldn't be read.",
  folder_access_needed:
    'SightKick needs access to your song folder. Click the folder button and allow access.',
  unexpected: 'Something went wrong while downloading. Try again.',
};

export const downloadFailureMessage = (failure: DownloadFailure) =>
  DOWNLOAD_FAILURE_MESSAGES[failure];

type DownloadOutcome =
  | { kind: 'added'; song: SongData; root: LibraryRoot }
  | { kind: 'already_exists' }
  | { kind: 'failed'; failure: DownloadFailure };

const failed = (failure: DownloadFailure): DownloadOutcome => ({
  kind: 'failed',
  failure,
});

type Fetched = { kind: 'ok'; data: Uint8Array } | DownloadOutcome;

async function fetchArchive(url: string, md5: string): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(SONG_DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn('download.http_error', { md5, status: response.status });

      return failed('http_error');
    }

    return { kind: 'ok', data: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    log.warn('download.unreachable', { md5, error: errorName(error) });

    return failed('unreachable');
  }
}

async function addDownloadedSong({
  url,
  md5,
  name,
  artist,
  charter,
}: DownloadProps): Promise<DownloadOutcome> {
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
    return { kind: 'already_exists' };
  }

  const fetched = await fetchArchive(url, md5);

  if (fetched.kind !== 'ok') {
    return fetched;
  }

  let files: { name: string; data: Blob }[];

  try {
    files = await unpackSng(fetched.data);
  } catch (error) {
    log.warn('download.bad_archive', { md5, error: errorName(error) });

    return failed('bad_archive');
  }

  const unsafe = files.find((f) => !isSafeFileName(f.name));

  if (unsafe) {
    log.warn('download.unsafe_path', { md5, path: unsafe.name });

    return failed('unsafe_path');
  }

  const outputDir = await root.handle.getDirectoryHandle(folderName, {
    create: true,
  });
  // A half-written folder would read as "already in your library" next time.
  const removeFolder = () =>
    removeIfPresent(root.handle, folderName, { md5 }, { recursive: true });

  try {
    for (const file of files) {
      await writeFile(outputDir, file.name, file.data);
    }

    await writeFile(outputDir, SONG_ID_FILE, JSON.stringify({ id: md5 }));
  } catch (error) {
    log.error('download.write_failed', { md5, folder: folderName }, error);
    await removeFolder();

    return failed('write_failed');
  }

  const songData = await buildSong(await listSongDir(root.handle, folderName), {
    id: md5,
  });

  if (!songData) {
    log.warn('download.unreadable_song', { md5, folder: folderName });
    await removeFolder();

    return failed('unreadable_song');
  }

  await updateSongs(root.kind, (stored) => ({ ...stored, [md5]: songData }));

  return { kind: 'added', song: songData, root };
}

// Downloads in progress, by md5: a second request for the same song while
// the first runs would race it into the same folder.
const downloadsInFlight = new Set<string>();

export async function downloadSong(reply: Reply, props: DownloadProps) {
  const { md5 } = props;

  if (downloadsInFlight.has(md5)) {
    // The first download's reply answers this request too.
    log.info('download.already_running', { md5 });

    return;
  }

  downloadsInFlight.add(md5);

  try {
    let outcome: DownloadOutcome;

    try {
      outcome = await addDownloadedSong(props);
    } catch (error) {
      if (error instanceof PermissionNeededError) {
        outcome = failed('folder_access_needed');
      } else {
        log.error('download.unexpected_error', { md5 }, error);
        outcome = failed('unexpected');
      }
    }

    switch (outcome.kind) {
      case 'added':
        log.info('download.added', { md5 });
        reply('download-song', {
          success: true,
          md5,
          song: await toUiSong(outcome.root, outcome.song),
        });

        break;

      case 'already_exists':
        reply('download-song', { success: false, md5, alreadyExists: true });

        break;

      case 'failed':
        log.warn('download.failed', { md5, failure: outcome.failure });
        reply('download-song', {
          success: false,
          md5,
          error: downloadFailureMessage(outcome.failure),
        });

        break;

      default:
        assertNever(outcome, 'download outcome');
    }
  } finally {
    downloadsInFlight.delete(md5);
  }
}

export async function midiDeviceList(reply: Reply) {
  try {
    reply('midi-device-list', await listMidiDevices());
  } catch (error) {
    // Shown as "no devices" rather than leaving the device list waiting.
    log.error('midi.list_failed', {}, error);
    reply('midi-device-list', []);
  }
}

export async function startMidi(reply: Reply, port: number) {
  try {
    await listenMidi(port, (message) => reply('listen-midi', message));
  } catch (error) {
    stopListenMidi();
    reply('midi-error', errorPayload('listen-midi', error, { port }));
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
  } catch (error) {
    // Denied (e.g. tab hidden); retried when the tab becomes visible.
    log.info('wake_lock.denied', { error: errorName(error) });
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
  wakeLock?.release().catch((error: unknown) => {
    log.warn('wake_lock.release_failed', { error: errorName(error) });
  });
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
