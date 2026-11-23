import { Song, SongData } from '../types';
import {
  BACKING_STEM,
  DRUM_KIT_DIR,
  hasDrumAudio,
  isDrumAudio,
  splitInputs,
  SplitParts,
} from '../songData';
import { assertNever } from '../shared/assertNever';
import { log } from '../shared/log';
import {
  errorName,
  getDir,
  getFile,
  getRoot,
  joinPath,
  LibraryRoot,
  loadSongs,
  PermissionNeededError,
  removeIfPresent,
  updateSongs,
  withStoredUserData,
  writeFile,
} from './library';
import { buildSong, clearAssetCache, listSongDir, toUiSong } from './songs';
import {
  deleteJob,
  downloadStem,
  fetchJob,
  Job,
  JobFailure,
  postJob,
  RequestFailure,
  stemQuality,
} from './stem-server-api';

// Splits songs through the optional stem server (stem-server/ in this repo).
// The song's audio files (one mixed file, or several for multitrack charts)
// are uploaded, and the server sends back drums, bass, vocals, ... so the
// drums can be muted, plus kick, snare, ... for a kit split. The HTTP side
// is in stem-server-api.ts; this file follows the job and writes the stems.

export { checkStemServer } from './stem-server-api';

/** How often a running job is polled. */
const POLL_INTERVAL_MS = 1000;
/** Extra wait after a failed poll, on top of the interval. */
const POLL_RETRY_DELAY_MS = 4000;

/**
 * Failed polls in a row before the split is reported as stalled: about a
 * minute (more with poll timeouts) of the server not answering. The job
 * stays saved, so a reload picks it up again once the server is back.
 */
export const MAX_CONSECUTIVE_POLL_FAILURES = 10;

const ASSET_PREFIX = 'sk-asset:';
const KIT_STEM_PREFIX = 'kit_';

type Reply = (channel: string, payload: unknown) => void;

/** Why a split ended without stems, in our terms. */
export type SplitFailure =
  | 'server_unreachable'
  | 'server_stalled'
  | 'job_gone'
  | 'upload_too_large'
  | 'server_busy'
  | 'model_unavailable'
  | 'request_rejected'
  | 'decode_failed'
  | 'no_drums'
  | 'server_timed_out'
  | 'server_failed'
  | 'no_stems'
  | 'download_failed'
  | 'song_not_found'
  | 'no_audio'
  | 'audio_unreadable'
  | 'write_failed'
  | 'rebuild_failed'
  | 'folder_access_needed'
  | 'unexpected';

/**
 * What the user reads for each failure, and whether the server job stays
 * saved so the next page load (or regained folder access) picks it up again.
 */
const SPLIT_FAILURES: Record<
  SplitFailure,
  { message: string; keepJob: boolean }
> = {
  server_unreachable: {
    message:
      "Can't reach the stem server. Check that it's running and its address in Settings.",
    keepJob: false,
  },
  server_stalled: {
    message:
      'The stem server stopped answering. The split is saved and picks up again when you reload SightKick.',
    keepJob: true,
  },
  job_gone: {
    message:
      'The stem server no longer has this split (it was restarted or the result expired). Split the song again.',
    keepJob: false,
  },
  upload_too_large: {
    message: "This song's audio is larger than the stem server accepts.",
    keepJob: false,
  },
  server_busy: {
    message: 'The stem server is busy. Try again in a few minutes.',
    keepJob: false,
  },
  model_unavailable: {
    message:
      "The stem server's splitting model isn't available. Check the server's log.",
    keepJob: false,
  },
  request_rejected: {
    message:
      "The stem server didn't accept this split. It may need updating to match this version of SightKick.",
    keepJob: false,
  },
  decode_failed: {
    message: "The stem server couldn't read this song's audio.",
    keepJob: false,
  },
  no_drums: {
    message: 'The stem server found no drums in this song.',
    keepJob: false,
  },
  server_timed_out: {
    message: 'The split took too long and the stem server gave up on it.',
    keepJob: false,
  },
  server_failed: {
    message:
      "The stem server couldn't split this song. Check the server's log.",
    keepJob: false,
  },
  no_stems: {
    message: 'The stem server finished without any stems.',
    keepJob: false,
  },
  download_failed: {
    message:
      "Couldn't download the stems. The split is saved and picks up again when you reload SightKick.",
    keepJob: true,
  },
  song_not_found: {
    message: 'This song is no longer in your library.',
    keepJob: false,
  },
  no_audio: {
    message: 'This song has no audio to split.',
    keepJob: false,
  },
  audio_unreadable: {
    message:
      "Couldn't read this song's audio files. Rescan your library and try again.",
    keepJob: false,
  },
  write_failed: {
    message:
      "Couldn't save the stems into the song's folder. Its audio was left in place.",
    keepJob: false,
  },
  rebuild_failed: {
    message:
      "The stems were saved, but the song couldn't be read back. Rescan your library.",
    keepJob: false,
  },
  folder_access_needed: {
    message:
      'SightKick needs access to your song folder to save the stems. Click anywhere and allow access to finish the split.',
    keepJob: true,
  },
  unexpected: {
    message:
      'Something went wrong while splitting. The split is saved and picks up again when you reload SightKick.',
    keepJob: true,
  },
};

export const splitFailureMessage = (failure: SplitFailure) =>
  SPLIT_FAILURES[failure].message;

type SplitOutcome =
  | { kind: 'done'; song: Song }
  | { kind: 'cancelled' }
  | { kind: 'failed'; failure: SplitFailure };

function fromRequestFailure(failure: RequestFailure): SplitFailure {
  switch (failure.kind) {
    case 'unreachable':
      return 'server_unreachable';

    case 'malformed':
      return 'request_rejected';

    case 'refused':
      switch (failure.refusal) {
        case 'too_large':
          return 'upload_too_large';

        case 'busy':
          return 'server_busy';

        case 'model_unavailable':
          return 'model_unavailable';

        case 'bad_request':
          return 'request_rejected';

        case 'not_found':
          return 'request_rejected';

        case 'server_error':
          // A 5xx: the server broke, not the request.
          return 'server_failed';

        default:
          return assertNever(failure.refusal, 'stem server refusal');
      }

    default:
      return assertNever(failure, 'stem server request failure');
  }
}

function fromJobFailure(failure: JobFailure): SplitFailure {
  switch (failure) {
    case 'decode_failed':
      return 'decode_failed';

    case 'no_drums':
      return 'no_drums';

    case 'model_unavailable':
      return 'model_unavailable';

    case 'timed_out':
      return 'server_timed_out';

    case 'internal':
      return 'server_failed';

    default:
      return assertNever(failure, 'stem server job failure');
  }
}

// --- Saved splits ----------------------------------------------------------

// Song id -> server job, so a split can be cancelled from the UI.
interface ActiveSplit {
  jobId?: string;
  cancelled: boolean;
}

const activeSplits = new Map<string, ActiveSplit>();

/**
 * A split the server is working on, saved so a page refresh can pick it up
 * again: the server keeps running the job, and the page reattaches, follows
 * its progress and writes the stems when it's done.
 */
interface PendingSplit {
  id: string;
  jobId: string;
  /** Kit pass on existing drum stems: the original audio is kept. */
  kitOnly: boolean;
  /** Library-relative paths of the audio files sent to the server. */
  inputRels: string[];
}

export const PENDING_SPLITS_KEY = 'sk-split-jobs';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function parsePendingSplit(id: string, value: unknown): PendingSplit | null {
  if (
    isRecord(value) &&
    value.id === id &&
    typeof value.jobId === 'string' &&
    value.jobId !== '' &&
    typeof value.kitOnly === 'boolean' &&
    Array.isArray(value.inputRels) &&
    value.inputRels.every(isString)
  ) {
    return {
      id,
      jobId: value.jobId,
      kitOnly: value.kitOnly,
      inputRels: value.inputRels,
    };
  }

  return null;
}

/**
 * Saved splits, validated. An entry this build can't use (one saved by an
 * older build had no inputRels, which failed every reload) is dropped with
 * a log rather than followed.
 */
function loadPending(): Record<string, PendingSplit> {
  let raw: unknown;

  try {
    raw = JSON.parse(localStorage.getItem(PENDING_SPLITS_KEY) ?? '{}');
  } catch (error) {
    log.warn('split.pending_unreadable', { error: errorName(error) });

    return {};
  }

  if (!isRecord(raw)) {
    log.warn('split.pending_unreadable', { type: typeof raw });

    return {};
  }

  const pending: Record<string, PendingSplit> = {};

  for (const [id, value] of Object.entries(raw)) {
    const split = parsePendingSplit(id, value);

    if (split) {
      pending[id] = split;
    } else {
      log.warn('split.pending_dropped', { songId: id });
    }
  }

  return pending;
}

function savePending(pending: Record<string, PendingSplit>): void {
  try {
    localStorage.setItem(PENDING_SPLITS_KEY, JSON.stringify(pending));
  } catch (error) {
    // Storage full or blocked: the split still runs, it just won't survive a refresh.
    log.warn('split.pending_not_saved', { error: errorName(error) });
  }
}

function rememberSplit(split: PendingSplit): void {
  savePending({ ...loadPending(), [split.id]: split });
}

function forgetSplit(id: string): void {
  const pending = loadPending();

  if (id in pending) {
    delete pending[id];
    savePending(pending);
  }
}

export function cancelSplit(id: string): void {
  const split = activeSplits.get(id);

  if (!split) {
    // Saved from an earlier page but not reattached yet: drop it and tell the server.
    const pending = loadPending()[id];

    if (pending) {
      forgetSplit(id);
      void deleteJob(pending.jobId, { songId: id, reason: 'cancel' });
    }

    return;
  }

  split.cancelled = true;

  if (split.jobId) {
    void deleteJob(split.jobId, { songId: id, reason: 'cancel' });
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const fileNameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

// --- Running a split ---------------------------------------------------------

/** Reports how a split ended, and keeps or drops its saved job to match. */
function finish(
  reply: Reply,
  id: string,
  jobId: string | undefined,
  outcome: SplitOutcome,
): void {
  switch (outcome.kind) {
    case 'done':
      forgetSplit(id);
      log.info('split.done', { songId: id, jobId });
      reply('split-song', { id, success: true, song: outcome.song });

      return;

    case 'cancelled':
      forgetSplit(id);
      log.info('split.cancelled', { songId: id, jobId });
      reply('split-song', { id, success: false, cancelled: true });

      return;

    case 'failed': {
      const { message, keepJob } = SPLIT_FAILURES[outcome.failure];

      if (!keepJob) {
        forgetSplit(id);
      }

      log.warn('split.failed', {
        songId: id,
        jobId,
        failure: outcome.failure,
        jobKept: keepJob && jobId !== undefined,
      });
      reply('split-song', { id, success: false, error: message });

      return;
    }

    default:
      assertNever(outcome, 'split outcome');
  }
}

/** Expected failures come back as outcomes; this catches what's left. */
async function guarded(
  id: string,
  split: ActiveSplit,
  work: () => Promise<SplitOutcome>,
): Promise<SplitOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PermissionNeededError) {
      return { kind: 'failed', failure: 'folder_access_needed' };
    }

    log.error(
      'split.unexpected_error',
      { songId: id, jobId: split.jobId },
      error,
    );

    return { kind: 'failed', failure: 'unexpected' };
  }
}

async function readInputs(
  root: LibraryRoot,
  id: string,
  inputRels: string[],
): Promise<FormData | null> {
  const form = new FormData();

  for (const rel of inputRels) {
    try {
      form.append('files', await getFile(root.handle, rel), fileNameOf(rel));
    } catch (error) {
      log.warn('split.input_unreadable', {
        songId: id,
        rel,
        error: errorName(error),
      });

      return null;
    }
  }

  return form;
}

async function startSplit(
  reply: Reply,
  id: string,
  parts: SplitParts,
  split: ActiveSplit,
): Promise<SplitOutcome> {
  const root = await getRoot(true);
  const songData: SongData | undefined = (await loadSongs(root.kind))[id];

  if (!songData) {
    return { kind: 'failed', failure: 'song_not_found' };
  }

  // Kit only: the song already has drum stems, so send just those and
  // leave every other file alone.
  const kitOnly = parts === 'kit' && hasDrumAudio(songData.audio);
  const inputs = kitOnly
    ? songData.audio.filter(isDrumAudio)
    : splitInputs(songData.audio);
  const inputRels = inputs
    .map((a) => a.src)
    .filter((src) => src.startsWith(ASSET_PREFIX))
    .map((src) => src.slice(ASSET_PREFIX.length));

  if (inputRels.length === 0) {
    return { kind: 'failed', failure: 'no_audio' };
  }

  const form = await readInputs(root, id, inputRels);

  if (!form) {
    return { kind: 'failed', failure: 'audio_unreadable' };
  }

  form.append('quality', stemQuality());
  form.append(
    'mode',
    kitOnly ? 'kit' : parts === 'kit' ? 'stems+kit' : 'stems',
  );
  reply('split-song', { id, progress: 0 });

  const posted = await postJob(form);

  if (posted.kind !== 'ok') {
    return { kind: 'failed', failure: fromRequestFailure(posted) };
  }

  const { job } = posted;
  // A job kept from an earlier, stalled attempt is replaced by this one.
  const previous = loadPending()[id];

  if (previous && previous.jobId !== job.id) {
    void deleteJob(previous.jobId, { songId: id, reason: 'replaced' });
  }

  split.jobId = job.id;

  const pending: PendingSplit = { id, jobId: job.id, kitOnly, inputRels };

  rememberSplit(pending);
  log.info('split.started', { songId: id, jobId: job.id, kitOnly });

  return followSplit(reply, split, pending, job);
}

/**
 * Splits a song through the stem server. `stems` replaces the mixed audio
 * with drums, bass, vocals, ...; `kit` also splits the drums into kick,
 * snare, toms, hi-hat, ride and crash, written to the song's drumkit/ folder
 * (songs that already have drum stems only get the kit pass).
 */
export async function splitSong(
  reply: Reply,
  id: string,
  parts: SplitParts = 'stems',
): Promise<void> {
  if (activeSplits.has(id)) {
    return;
  }

  const split: ActiveSplit = { cancelled: false };

  activeSplits.set(id, split);

  try {
    const outcome = await guarded(id, split, () =>
      startSplit(reply, id, parts, split),
    );

    finish(reply, id, split.jobId, outcome);
  } finally {
    activeSplits.delete(id);
  }
}

/**
 * Reattaches to splits saved by an earlier page load: each shows up in the
 * processing queue again and finishes as if the page never reloaded.
 */
export async function resumeSplits(reply: Reply): Promise<void> {
  const saved = loadPending();

  // Persist the validated list, so entries dropped as unusable stay dropped.
  savePending(saved);

  const pending = Object.values(saved).filter((p) => !activeSplits.has(p.id));

  await Promise.all(
    pending.map(async (p) => {
      const split: ActiveSplit = { jobId: p.jobId, cancelled: false };

      activeSplits.set(p.id, split);

      try {
        reply('split-song', { id: p.id, progress: 0 });
        log.info('split.resumed', { songId: p.id, jobId: p.jobId });

        const outcome = await guarded(p.id, split, () =>
          followSplit(reply, split, p),
        );

        finish(reply, p.id, p.jobId, outcome);
      } finally {
        activeSplits.delete(p.id);
      }
    }),
  );
}

/**
 * Polls a server job to the end, then writes its stems into the song.
 * Without `initial` (a resumed split) it polls first.
 */
async function followSplit(
  reply: Reply,
  split: ActiveSplit,
  pending: PendingSplit,
  initial?: Job,
): Promise<SplitOutcome> {
  const { id, jobId } = pending;
  let job = initial;
  let attempt = 0;
  let failuresInARow = 0;

  for (;;) {
    if (split.cancelled) {
      return { kind: 'cancelled' };
    }

    if (job) {
      switch (job.state) {
        case 'working':
          reply('split-song', { id, progress: Math.floor(job.progress) });

          break;

        case 'unknown':
          // A status this client doesn't know yet (logged by the adapter):
          // the job may still finish, so keep following it.
          reply('split-song', { id, progress: Math.floor(job.progress) });

          break;

        case 'done':
          return job.stems.length > 0
            ? saveStems(pending, job.stems)
            : { kind: 'failed', failure: 'no_stems' };

        case 'failed':
          return { kind: 'failed', failure: fromJobFailure(job.failure) };

        case 'cancelled':
          return { kind: 'cancelled' };

        default:
          return assertNever(job, 'job state');
      }

      await sleep(POLL_INTERVAL_MS);

      if (split.cancelled) {
        return { kind: 'cancelled' };
      }
    }

    attempt += 1;

    const polled = await fetchJob(jobId);

    if (polled.kind === 'ok') {
      failuresInARow = 0;
      job = polled.job;

      continue;
    }

    if (polled.kind === 'gone') {
      return { kind: 'failed', failure: 'job_gone' };
    }

    // Unreachable, refused or malformed: the server or network hiccuped.
    // Keep the job saved and retry, up to a limit.
    failuresInARow += 1;
    log.warn('split.poll_failed', {
      songId: id,
      jobId,
      attempt,
      failuresInARow,
      reason: polled.kind,
    });

    if (failuresInARow >= MAX_CONSECUTIVE_POLL_FAILURES) {
      return { kind: 'failed', failure: 'server_stalled' };
    }

    await sleep(POLL_RETRY_DELAY_MS);
  }
}

interface StemFile {
  /** The song's folder, or its drumkit/ folder. */
  folder: 'song' | 'kit';
  name: string;
  data: Blob;
}

/** Where each stem goes: kit pieces and the backing mix live in drumkit/, where Clone Hero won't play them on top of the stems. */
function placeStem(stem: string, data: Blob): StemFile {
  if (stem.startsWith(KIT_STEM_PREFIX)) {
    return {
      folder: 'kit',
      name: `${stem.slice(KIT_STEM_PREFIX.length)}.ogg`,
      data,
    };
  }

  return {
    folder: stem === BACKING_STEM ? 'kit' : 'song',
    name: `${stem}.ogg`,
    data,
  };
}

/** Downloads a finished job's stems and writes them into the song. */
async function saveStems(
  pending: PendingSplit,
  stemNames: string[],
): Promise<SplitOutcome> {
  const { id, jobId, kitOnly, inputRels } = pending;
  const fields = { songId: id, jobId };
  // Needs the library folder; after a reload that may need the user's
  // permission again, in which case the job stays saved (see guarded).
  const root = await getRoot(true);
  const songData: SongData | undefined = (await loadSongs(root.kind))[id];

  if (!songData) {
    return { kind: 'failed', failure: 'song_not_found' };
  }

  // Download every stem before touching the song folder, so a failed
  // download leaves it as it was.
  const downloads = await Promise.all(
    stemNames.map(async (name) => ({
      name,
      result: await downloadStem(jobId, name),
    })),
  );
  const stems: StemFile[] = [];

  for (const { name, result } of downloads) {
    if (result.kind !== 'ok') {
      log.warn('split.stem_download_failed', {
        ...fields,
        stem: name,
        reason: result.kind,
      });

      return { kind: 'failed', failure: 'download_failed' };
    }

    stems.push(placeStem(name, result.data));
  }

  const dir = await getDir(root.handle, songData.dir);
  const written = await writeStems(dir, stems, inputRels, fields);

  if (written.kind === 'failed') {
    return { kind: 'failed', failure: 'write_failed' };
  }

  // Only now that every stem is on disk: drop the audio the stems replace,
  // except files a stem just overwrote (song.ogg, guitar.ogg, ...). Names
  // compare case-insensitively: on macOS and Windows "Song.ogg" and
  // "song.ogg" are the same file.
  const writtenHere = new Set(
    stems.filter((s) => s.folder === 'song').map((s) => s.name.toLowerCase()),
  );

  if (!kitOnly) {
    for (const rel of inputRels) {
      const name = fileNameOf(rel);

      if (!writtenHere.has(name.toLowerCase())) {
        await removeIfPresent(dir, name, fields);
      }
    }
  }

  await removeOldKitPieces(dir, stems, fields);
  void deleteJob(jobId, { songId: id, reason: 'saved' });

  const updated = await buildSong(
    await listSongDir(root.handle, joinPath(songData.dir)),
    {
      id,
      liked: songData.liked,
      scoreData: songData.scoreData,
      drumDifficulties: songData.drumDifficulties,
    },
  );

  if (!updated) {
    return { kind: 'failed', failure: 'rebuild_failed' };
  }

  // Likes and scores may have changed while the server worked.
  const songs = await updateSongs(root.kind, (stored) => ({
    ...stored,
    [id]: withStoredUserData(updated, stored[id]),
  }));

  clearAssetCache();

  return { kind: 'done', song: await toUiSong(root, songs[id]) };
}

/**
 * Writes the stems: kit folder first, then new files in the song folder,
 * and files that overwrite an input (song.ogg, ...) last, so a failure
 * before those leaves every original file in place. On a failure the new
 * files written into the song folder are removed again, so the song isn't
 * left with both its mix and part of the stems.
 */
async function writeStems(
  dir: FileSystemDirectoryHandle,
  stems: StemFile[],
  inputRels: string[],
  fields: Record<string, unknown>,
): Promise<{ kind: 'written' } | { kind: 'failed' }> {
  const inputNames = new Set(
    inputRels.map((rel) => fileNameOf(rel).toLowerCase()),
  );
  const overwrites = (s: StemFile) =>
    s.folder === 'song' && inputNames.has(s.name.toLowerCase());
  const order = [
    ...stems.filter((s) => s.folder === 'kit'),
    ...stems.filter((s) => s.folder === 'song' && !overwrites(s)),
    ...stems.filter(overwrites),
  ];
  const created: string[] = [];
  const kitDir = order.some((s) => s.folder === 'kit')
    ? await dir.getDirectoryHandle(DRUM_KIT_DIR, { create: true })
    : undefined;

  for (const stem of order) {
    try {
      await writeFile(
        stem.folder === 'kit' && kitDir ? kitDir : dir,
        stem.name,
        stem.data,
      );
    } catch (error) {
      log.error(
        'split.stem_write_failed',
        { ...fields, stem: stem.name },
        error,
      );

      for (const name of created) {
        await removeIfPresent(dir, name, fields);
      }

      return { kind: 'failed' };
    }

    if (stem.folder === 'song' && !overwrites(stem)) {
      created.push(stem.name);
    }
  }

  return { kind: 'written' };
}

/**
 * After a kit split: removes pieces of an earlier kit split the new one
 * didn't replace, so old and new pieces don't mix. The backing mix stays:
 * a kit pass on drums from an earlier stem split doesn't bring a new one.
 */
async function removeOldKitPieces(
  dir: FileSystemDirectoryHandle,
  stems: StemFile[],
  fields: Record<string, unknown>,
): Promise<void> {
  const kitNames = new Set(
    stems.filter((s) => s.folder === 'kit').map((s) => s.name.toLowerCase()),
  );

  if (
    !stems.some((s) => s.name !== `${BACKING_STEM}.ogg` && s.folder === 'kit')
  ) {
    return;
  }

  const kitDir = await dir.getDirectoryHandle(DRUM_KIT_DIR);
  const stale: string[] = [];

  for await (const entry of kitDir.values()) {
    const name = entry.name.toLowerCase();

    if (name !== `${BACKING_STEM}.ogg` && !kitNames.has(name)) {
      stale.push(entry.name);
    }
  }

  for (const name of stale) {
    await removeIfPresent(kitDir, name, fields, { recursive: true });
  }
}
