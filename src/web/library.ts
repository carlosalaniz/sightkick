import { SongData, StorageSchema } from '../types';
import { BROWSER_ROOT_NAME } from '../browserLibrary';
import { idbGet, idbSet } from './idb';

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
  navigator.storage.persist?.().catch(() => undefined);

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

export async function loadSongs(
  kind: RootKind,
): Promise<StorageSchema['songs']> {
  return (await idbGet<StorageSchema['songs']>(songsKey(kind))) ?? {};
}

export async function saveSongs(
  kind: RootKind,
  songs: StorageSchema['songs'],
): Promise<void> {
  await idbSet(songsKey(kind), songs);
}

export async function updateStoredSong(
  kind: RootKind,
  id: string,
  update: (prev: SongData) => SongData,
): Promise<SongData> {
  const songs = await loadSongs(kind);
  const prev = songs[id];

  if (!prev) {
    throw new Error(`Song "${id}" not found`);
  }

  const next = update(prev);

  songs[id] = next;
  await saveSongs(kind, songs);

  return next;
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

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');
