import { SongData, StorageSchema } from '../types';
import { BROWSER_ROOT_NAME } from '../browserLibrary';
import { log } from '../shared/log';
import { idbGet, idbSet, idbUpdate } from './idb';

// Where the song library lives in the browser build:
// - 'browser': the origin-private file system (works in every modern browser,
//   only holds songs downloaded through the app)
// - 'folder': a real folder the user picked (Chromium only), so an existing
//   Clone Hero library can be used as-is
export type RootKind = 'browser' | 'folder';

export interface LibraryRoot {
  kind: RootKind;
  handle: FileSystemDirectoryHandle;
  name: string;
}

const ROOT_KIND_KEY = 'rootKind';
const FOLDER_HANDLE_KEY = 'folderHandle';
const songsKey = (kind: RootKind) => `songs:${kind}`;

export class PermissionNeededError extends Error {
  constructor(name: string) {
    super(
      `SightKick needs permission to read "${name}". Click the folder button and allow access.`,
    );
  }
}

export const canPickFolder = () =>
  typeof window.showDirectoryPicker === 'function';

export async function getRootKind(): Promise<RootKind> {
  return (await idbGet<RootKind>(ROOT_KIND_KEY)) ?? 'browser';
}

async function browserRoot(): Promise<LibraryRoot> {
  const opfs = await navigator.storage.getDirectory();
  const handle = await opfs.getDirectoryHandle('songs', { create: true });

  // Ask the browser not to evict downloaded songs under storage pressure.
  navigator.storage.persist?.().catch((error: unknown) => {
    log.warn('library.persist_request_failed', { error: errorName(error) });
  });

  return { kind: 'browser', handle, name: BROWSER_ROOT_NAME };
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  interactive: boolean,
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const };

  if ((await handle.queryPermission?.(descriptor)) === 'granted') {
    return true;
  }

  if (!interactive) {
    return false;
  }

  try {
    return (await handle.requestPermission?.(descriptor)) === 'granted';
  } catch {
    // requestPermission throws without a user gesture.
    return false;
  }
}

/**
 * Resolves the active library root. With `interactive`, a missing folder
 * permission is requested (needs a user gesture); otherwise it throws
 * PermissionNeededError.
 */
export async function getRoot(interactive = false): Promise<LibraryRoot> {
  const kind = await getRootKind();

  if (kind === 'browser') {
    return browserRoot();
  }

  const handle = await idbGet<FileSystemDirectoryHandle>(FOLDER_HANDLE_KEY);

  if (!handle) {
    await idbSet(ROOT_KIND_KEY, 'browser');

    return browserRoot();
  }

  if (!(await ensurePermission(handle, interactive))) {
    throw new PermissionNeededError(handle.name);
  }

  return { kind: 'folder', handle, name: handle.name };
}

export async function getRootName(): Promise<string> {
  if ((await getRootKind()) === 'browser') {
    return BROWSER_ROOT_NAME;
  }

  const handle = await idbGet<FileSystemDirectoryHandle>(FOLDER_HANDLE_KEY);

  return handle?.name ?? BROWSER_ROOT_NAME;
}

export async function selectBrowserRoot(): Promise<LibraryRoot> {
  await idbSet(ROOT_KIND_KEY, 'browser');

  return browserRoot();
}

export async function selectFolderRoot(
  handle: FileSystemDirectoryHandle,
): Promise<LibraryRoot> {
  await idbSet(FOLDER_HANDLE_KEY, handle);
  await idbSet(ROOT_KIND_KEY, 'folder');

  return { kind: 'folder', handle, name: handle.name };
}

type SongMap = StorageSchema['songs'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The fields the browser build relies on. The rest of SongData is song.ini
 * metadata the UI only displays, so it isn't checked field by field.
 */
function isStoredSong(value: unknown): value is SongData {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.dir === 'string' &&
    Array.isArray(value.audio)
  );
}

/** Parses the stored song map, dropping (and logging) entries it can't use. */
export function parseSongMap(raw: unknown, kind: RootKind): SongMap {
  if (raw === undefined) {
    return {};
  }

  if (!isRecord(raw)) {
    log.error('library.song_map_invalid', { kind, type: typeof raw });

    return {};
  }

  const songs: SongMap = {};

  for (const [id, song] of Object.entries(raw)) {
    if (isStoredSong(song) && song.id === id) {
      songs[id] = song;
    } else {
      log.warn('library.stored_song_dropped', { kind, songId: id });
    }
  }

  return songs;
}

export async function loadSongs(kind: RootKind): Promise<SongMap> {
  return parseSongMap(await idbGet<unknown>(songsKey(kind)), kind);
}

/**
 * Changes the stored song map in one transaction. Every write to the map
 * goes through here: the whole map is one IndexedDB value, so a separate
 * load and save would drop whatever another handler (a like, a score, a
 * finished split or download) wrote in between.
 */
export function updateSongs(
  kind: RootKind,
  update: (songs: SongMap) => SongMap,
): Promise<SongMap> {
  return idbUpdate(songsKey(kind), (raw) => update(parseSongMap(raw, kind)));
}

export async function updateStoredSong(
  kind: RootKind,
  id: string,
  update: (prev: SongData) => SongData,
): Promise<SongData> {
  const songs = await updateSongs(kind, (stored) => {
    const prev = stored[id];

    if (!prev) {
      throw new Error(`Song "${id}" not found`);
    }

    return { ...stored, [id]: update(prev) };
  });

  return songs[id];
}

/**
 * `fresh` (rebuilt from the song's folder) with the player's own data from
 * `stored`, the record as it is now: likes and scores only ever change in
 * storage, so the stored copy is the newest.
 */
export function withStoredUserData(
  fresh: SongData,
  stored: SongData | undefined,
): SongData {
  if (!stored) {
    return fresh;
  }

  const { liked: _liked, scoreData: _scoreData, ...rest } = fresh;

  return {
    ...rest,
    ...(stored.liked !== undefined ? { liked: stored.liked } : {}),
    ...(stored.scoreData !== undefined ? { scoreData: stored.scoreData } : {}),
  };
}

const audioOf = (song: SongData) =>
  JSON.stringify([song.audio, song.drumKit ?? null, song.backing ?? null]);

/**
 * The song map a rescan saves. The scan read `before` when it started and
 * can run for minutes; `current` is what is stored now, read in the same
 * transaction as the save. What changed in storage meanwhile wins over the
 * scan's copy: likes and scores, the audio of a split that finished (its
 * stems may have been written after the scan listed the folder), and songs
 * downloaded during the scan. Songs the scan didn't find are dropped, as
 * before.
 */
export function mergeRescan(
  scanned: SongMap,
  before: SongMap,
  current: SongMap,
): SongMap {
  const merged: SongMap = {};

  for (const song of Object.values(scanned)) {
    const now = current[song.id];
    const then = before[song.id];
    let next = withStoredUserData(song, now);

    if (now && then && audioOf(now) !== audioOf(then)) {
      const { drumKit: _drumKit, backing: _backing, ...rest } = next;

      next = {
        ...rest,
        audio: now.audio,
        ...(now.drumKit ? { drumKit: now.drumKit } : {}),
        ...(now.backing ? { backing: now.backing } : {}),
      };
    }

    merged[song.id] = next;
  }

  for (const [id, song] of Object.entries(current)) {
    if (!(id in before) && !(id in merged)) {
      merged[id] = song;
    }
  }

  return merged;
}

const splitPath = (rel: string) => rel.split('/').filter(Boolean);

export async function getDir(
  root: FileSystemDirectoryHandle,
  rel: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;

  for (const part of splitPath(rel)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }

  return dir;
}

export async function getFile(
  root: FileSystemDirectoryHandle,
  rel: string,
): Promise<File> {
  const parts = splitPath(rel);
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error(`Invalid file path "${rel}"`);
  }

  const dir = await getDir(root, parts.join('/'));

  return (await dir.getFileHandle(fileName)).getFile();
}

/**
 * Writes a file. createWritable() writes to a temporary copy that replaces
 * the file only on close(), so a failed write is aborted to throw that copy
 * away and leave any existing file as it was.
 */
export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
): Promise<void> {
  const writable = await (
    await dir.getFileHandle(name, { create: true })
  ).createWritable();

  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch((abortError: unknown) => {
      log.warn('library.write_abort_failed', {
        name,
        error: errorName(abortError),
      });
    });

    throw error;
  }
}

/**
 * Removes a file or folder that may already be gone. Only "not found" is
 * expected; any other failure is logged with `fields` (the song ID) and
 * reported as 'failed', so the caller decides whether it matters.
 */
export async function removeIfPresent(
  dir: FileSystemDirectoryHandle,
  name: string,
  fields: Record<string, unknown>,
  options?: FileSystemRemoveOptions,
): Promise<'removed' | 'absent' | 'failed'> {
  try {
    await dir.removeEntry(name, options);

    return 'removed';
  } catch (error) {
    if (isNotFound(error)) {
      return 'absent';
    }

    log.error('library.remove_failed', { ...fields, name }, error);

    return 'failed';
  }
}

/**
 * The name of a thrown DOMException or Error ('NotFoundError',
 * 'QuotaExceededError', 'TypeError', ...), for logs and for telling expected
 * file system failures apart. Not every DOMException is an Error instance.
 */
export function errorName(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
    ? error.name
    : typeof error;
}

/** The file or folder isn't there: the one removal failure that's expected. */
export const isNotFound = (error: unknown) =>
  errorName(error) === 'NotFoundError';

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');
