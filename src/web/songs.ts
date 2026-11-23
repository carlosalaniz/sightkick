import ini from 'ini';
import { Difficulty, parseChartFile } from 'scan-chart';
import { AudioData, Song, SongData } from '../types';
import { ALL_DIFFICULTIES } from '../constants';
import { stripColorMarkup } from '../colorMarkup';
import {
  BACKING_STEM,
  DRUM_KIT_DIR,
  DRUM_KIT_PIECES,
  toSong,
} from '../songData';
import { log } from '../shared/log';
import { errorName, getFile, joinPath, LibraryRoot } from './library';

export const SONG_ID_FILE = '.sightkick';

// Song data stored in IndexedDB references files by path inside the library
// root. They become blob URLs only when handed to the UI.
const ASSET_PREFIX = 'sk-asset:';
const toAssetRef = (rel: string) => `${ASSET_PREFIX}${rel}`;

type Existing = Pick<
  SongData,
  'id' | 'liked' | 'scoreData' | 'drumDifficulties'
>;

type FileMap = Map<string, FileSystemFileHandle>;

async function listDir(dir: FileSystemDirectoryHandle) {
  const files: FileMap = new Map();
  const dirs: FileSystemDirectoryHandle[] = [];

  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      files.set(entry.name.toLowerCase(), entry as FileSystemFileHandle);
    } else if (!entry.name.startsWith('.')) {
      dirs.push(entry as FileSystemDirectoryHandle);
    }
  }

  return { files, dirs };
}

export interface SongDir {
  rel: string;
  files: FileMap;
  /** Files in the song's drumkit/ folder, if it has one. */
  kitFiles?: FileMap;
}

async function kitFilesOf(
  dirs: FileSystemDirectoryHandle[],
): Promise<FileMap | undefined> {
  const kit = dirs.find((d) => d.name.toLowerCase() === DRUM_KIT_DIR);

  return kit ? (await listDir(kit)).files : undefined;
}

/** Recursively finds every folder that holds a notes.mid or notes.chart. */
export async function findSongDirs(
  root: FileSystemDirectoryHandle,
): Promise<SongDir[]> {
  const found: SongDir[] = [];
  const queue: { handle: FileSystemDirectoryHandle; rel: string }[] = [
    { handle: root, rel: '' },
  ];

  while (queue.length > 0) {
    const { handle, rel } = queue.shift()!;
    const { files, dirs } = await listDir(handle);

    if (files.has('notes.mid') || files.has('notes.chart')) {
      found.push({ rel, files, kitFiles: await kitFilesOf(dirs) });
    }

    for (const child of dirs) {
      queue.push({ handle: child, rel: joinPath(rel, child.name) });
    }
  }

  return found;
}

export async function listSongDir(
  root: FileSystemDirectoryHandle,
  rel: string,
): Promise<SongDir> {
  let dir = root;

  for (const part of rel.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part);
  }

  const { files, dirs } = await listDir(dir);

  return { rel, files, kitFiles: await kitFilesOf(dirs) };
}

function readDrumDifficulties(
  data: Uint8Array,
  format: 'mid' | 'chart',
  proDrums: boolean,
  fiveLaneDrums: boolean,
): Difficulty[] {
  try {
    const chart = parseChartFile(data, format, {
      pro_drums: proDrums,
      five_lane_drums: fiveLaneDrums,
    });
    const present = new Set(
      chart.trackData
        .filter((t) => t.instrument === 'drums')
        .map((t) => t.difficulty),
    );

    return ALL_DIFFICULTIES.filter((d) => present.has(d));
  } catch {
    return [];
  }
}

async function readSongId(files: FileMap): Promise<string | undefined> {
  const handle = files.get(SONG_ID_FILE);

  if (!handle) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(await (await handle.getFile()).text());

    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');

  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};
const baseOf = (name: string) => {
  const dot = name.lastIndexOf('.');

  return dot === -1 ? name : name.slice(0, dot);
};

/** Browser port of main/util.ts buildSongFromDir. */
export async function buildSong(
  { rel, files, kitFiles }: SongDir,
  existing?: Partial<Existing>,
): Promise<SongData | null> {
  const iniHandle = files.get('song.ini');
  const midHandle = files.get('notes.mid');
  const chartHandle = files.get('notes.chart');
  const notesHandle = midHandle ?? chartHandle;

  if (!iniHandle || !notesHandle) {
    return null;
  }

  const info = ini.parse(
    stripColorMarkup(await (await iniHandle.getFile()).text()),
  );
  const meta = info.song ?? info.Song ?? info;
  const format: 'mid' | 'chart' = midHandle ? 'mid' : 'chart';
  const notesFile = await notesHandle.getFile();
  const drumDifficulties =
    existing?.drumDifficulties && existing.drumDifficulties.length > 0
      ? existing.drumDifficulties
      : readDrumDifficulties(
          new Uint8Array(await notesFile.arrayBuffer()),
          format,
          meta.pro_drums === 'True',
          meta.five_lane_drums === 'True',
        );
  const cover = ['album.png', 'album.jpg', 'album.jpeg']
    .map((name) => files.get(name))
    .find(Boolean);
  const audio: AudioData[] = [...files.values()]
    .filter(
      (f) =>
        ['.ogg', '.opus', '.mp3'].includes(extOf(f.name)) &&
        baseOf(f.name) !== 'preview',
    )
    .map((f) => ({
      src: toAssetRef(joinPath(rel, f.name)),
      name: baseOf(f.name),
    }));
  const drumKit: AudioData[] = DRUM_KIT_PIECES.flatMap((piece) => {
    const file = kitFiles?.get(`${piece}.ogg`);

    return file
      ? [
          {
            src: toAssetRef(joinPath(rel, DRUM_KIT_DIR, file.name)),
            name: piece,
          },
        ]
      : [];
  });
  const backingFile = kitFiles?.get(`${BACKING_STEM}.ogg`);

  return {
    ...meta,
    id: existing?.id ?? (await readSongId(files)) ?? crypto.randomUUID(),
    dir: rel,
    albumCover: cover ? toAssetRef(joinPath(rel, cover.name)) : null,
    format,
    audio,
    ...(drumKit.length > 0 ? { drumKit } : {}),
    ...(backingFile
      ? {
          backing: {
            src: toAssetRef(joinPath(rel, DRUM_KIT_DIR, backingFile.name)),
            name: BACKING_STEM,
          },
        }
      : {}),
    drumDifficulties,
    updatedAt: new Date(notesFile.lastModified).toISOString(),
    ...(existing?.liked !== undefined ? { liked: existing.liked } : {}),
    ...(existing?.scoreData !== undefined
      ? { scoreData: existing.scoreData }
      : {}),
  };
}

// Blob URLs are cached per library root so the song list does not create a new
// one for every cover on every load.
const blobUrls = new Map<string, string>();

export function clearAssetCache(): void {
  for (const url of blobUrls.values()) {
    URL.revokeObjectURL(url);
  }

  blobUrls.clear();
}

type AssetUrl = { kind: 'url'; url: string } | { kind: 'missing' };

async function resolveAsset(
  root: LibraryRoot,
  songId: string,
  ref: string,
): Promise<AssetUrl> {
  if (!ref.startsWith(ASSET_PREFIX)) {
    return { kind: 'url', url: ref };
  }

  const rel = ref.slice(ASSET_PREFIX.length);
  const key = `${root.kind}:${rel}`;
  const cached = blobUrls.get(key);

  if (cached) {
    return { kind: 'url', url: cached };
  }

  try {
    const url = URL.createObjectURL(await getFile(root.handle, rel));

    blobUrls.set(key, url);

    return { kind: 'url', url };
  } catch (error) {
    // Moved or deleted since the last scan, or the folder lost permission.
    log.warn('library.asset_missing', {
      songId,
      rel,
      error: errorName(error),
    });

    return { kind: 'missing' };
  }
}

/**
 * Turns stored tracks into playable URLs. A file that can't be read is left
 * out (and logged): an `sk-asset:` ref is no URL the player can load.
 */
async function resolveTracks(
  root: LibraryRoot,
  songId: string,
  list: AudioData[],
): Promise<AudioData[]> {
  const resolved = await Promise.all(
    list.map(async (track) => {
      const asset = await resolveAsset(root, songId, track.src);

      return asset.kind === 'url' ? [{ ...track, src: asset.url }] : [];
    }),
  );

  return resolved.flat();
}

/** Converts stored song data to what the UI expects, with blob URLs. */
export async function toUiSong(
  root: LibraryRoot,
  stored: SongData,
  { withAudio = false } = {},
): Promise<Song> {
  const song = toSong(stored);
  const cover = stored.albumCover
    ? await resolveAsset(root, stored.id, stored.albumCover)
    : undefined;
  const albumCover = cover?.kind === 'url' ? cover.url : undefined;

  if (!withAudio) {
    return { ...song, albumCover };
  }

  const audio = await resolveTracks(root, stored.id, stored.audio);
  const drumKit = song.drumKit
    ? await resolveTracks(root, stored.id, song.drumKit)
    : undefined;
  const [backing] = song.backing
    ? await resolveTracks(root, stored.id, [song.backing])
    : [];
  const { drumKit: _storedKit, backing: _storedBacking, ...rest } = song;

  return {
    ...rest,
    albumCover,
    audio,
    ...(drumKit?.length ? { drumKit } : {}),
    ...(backing ? { backing } : {}),
  };
}

/** Runs `fn` over `items` with at most `limit` promises in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}
