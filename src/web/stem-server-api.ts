import { log } from '../shared/log';
import {
  DEFAULT_STEM_SERVER_URL,
  STEM_QUALITY_KEY,
  STEM_SERVER_URL_KEY,
  StemQuality,
} from '../stemServerUrl';
import { StemServerHealth } from '../types';
import { errorName } from './library';

// Adapter for the stem server's HTTP API (stem-server/app.py). The server's
// wire shapes, status codes, error codes and error text stay in this file:
// callers get Job, JobFailure and RequestFailure, and the server's own text
// only ever goes to the log.

/** /health is a quick yes/no; the settings page waits on it. */
export const HEALTH_TIMEOUT_MS = 3_000;

/** POST /jobs uploads a song's audio (tens of MB) to a possibly remote server. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** One status poll. A poll that runs out counts as a failed poll and is retried. */
export const POLL_TIMEOUT_MS = 10_000;

/** One stem file (a few MB of Ogg). */
export const STEM_DOWNLOAD_TIMEOUT_MS = 2 * 60_000;

/** Cancelling or cleaning up a job; nothing waits on it. */
export const DELETE_TIMEOUT_MS = 10_000;

export function stemServerUrl(): string {
  try {
    const raw = localStorage.getItem(STEM_SERVER_URL_KEY);
    const url: unknown = raw ? JSON.parse(raw) : '';

    return (
      (typeof url === 'string' && url) ||
      DEFAULT_STEM_SERVER_URL
    ).replace(/\/+$/, '');
  } catch {
    return DEFAULT_STEM_SERVER_URL;
  }
}

export function stemQuality(): StemQuality {
  try {
    const raw = localStorage.getItem(STEM_QUALITY_KEY);

    return raw && JSON.parse(raw) === 'best' ? 'best' : 'fast';
  } catch {
    return 'fast';
  }
}

const JOB_FAILURES = [
  'decode_failed',
  'no_drums',
  'model_unavailable',
  'timed_out',
  'internal',
] as const;

/** Why a job the server ran ended without stems (the job's errorCode). */
export type JobFailure = (typeof JOB_FAILURES)[number];

export type Job =
  | { state: 'working'; id: string; progress: number }
  | { state: 'done'; id: string; stems: string[] }
  | { state: 'failed'; id: string; failure: JobFailure }
  | { state: 'cancelled'; id: string }
  /** A status this client doesn't know (a newer server): keep polling. */
  | { state: 'unknown'; id: string; progress: number };

/** The `code` of an HTTP error body. */
const REFUSAL_CODES = [
  'bad_request',
  'too_large',
  'busy',
  'model_unavailable',
  'not_found',
] as const;

/**
 * Why the server turned a request down: its error body's code, or for
 * servers older than the code, what the HTTP status meant there.
 */
export type Refusal = (typeof REFUSAL_CODES)[number] | 'server_error';

export type RequestFailure =
  /** No connection, or no answer within the timeout. */
  | { kind: 'unreachable' }
  | { kind: 'refused'; refusal: Refusal }
  /** It answered 2xx, but not with what the API promises. */
  | { kind: 'malformed' };

export type PostJobResult = { kind: 'ok'; job: Job } | RequestFailure;

export type FetchJobResult =
  | { kind: 'ok'; job: Job }
  /** 404: the server restarted or the job expired. */
  | { kind: 'gone' }
  | RequestFailure;

export type StemDownload = { kind: 'ok'; data: Blob } | RequestFailure;

// --- Wire format ---------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Stem names become file names in the song's folder: plain words only. */
const SAFE_STEM_NAME = /^[A-Za-z0-9_-]+$/;
const isStemName = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_STEM_NAME.test(value);
const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => (values as readonly unknown[]).includes(value);

function toJobFailure(code: unknown): JobFailure {
  // Servers before errorCode send none; a newer one may add codes.
  return isOneOf(JOB_FAILURES, code) ? code : 'internal';
}

export type ParsedJob =
  | { kind: 'ok'; job: Job }
  | { kind: 'malformed'; reason: string };

/** Validates a job from the server (POST /jobs, GET /jobs/{id}). */
export function parseJob(wire: unknown): ParsedJob {
  if (!isRecord(wire) || typeof wire.id !== 'string' || !wire.id) {
    return { kind: 'malformed', reason: 'no job id' };
  }

  const { id, status } = wire;
  const progress =
    typeof wire.progress === 'number' && Number.isFinite(wire.progress)
      ? Math.min(100, Math.max(0, wire.progress))
      : 0;

  switch (status) {
    case 'queued':
      return { kind: 'ok', job: { state: 'working', id, progress } };

    case 'running':
      return { kind: 'ok', job: { state: 'working', id, progress } };

    case 'done': {
      const stems = Array.isArray(wire.stems) ? wire.stems : undefined;

      if (!stems?.every(isStemName)) {
        return { kind: 'malformed', reason: 'bad stem list' };
      }

      return { kind: 'ok', job: { state: 'done', id, stems } };
    }

    case 'error': {
      const failure = toJobFailure(wire.errorCode);

      log.warn('split.job_failed_on_server', {
        jobId: id,
        failure,
        errorCode: wire.errorCode,
        detail: wire.error,
      });

      return { kind: 'ok', job: { state: 'failed', id, failure } };
    }

    case 'cancelled':
      return { kind: 'ok', job: { state: 'cancelled', id } };

    default:
      log.warn('split.job_status_unknown', { jobId: id, status });

      return { kind: 'ok', job: { state: 'unknown', id, progress } };
  }
}

function refusalOf(status: number, body: unknown): Refusal {
  const code = isRecord(body) ? body.code : undefined;

  if (isOneOf(REFUSAL_CODES, code)) {
    return code;
  }

  // No code: an older server, an unexpected crash (a plain-text 500), or a
  // code this client doesn't know. Go by what the status meant there.
  switch (status) {
    case 404:
      return 'not_found';

    case 413:
      return 'too_large';

    case 429:
      return 'busy';

    case 503:
      // What older servers send when a model failed to load.
      return 'model_unavailable';

    default:
      return status >= 500 ? 'server_error' : 'bad_request';
  }
}

async function readRefusal(res: Response, path: string): Promise<Refusal> {
  const body: unknown = await res.json().catch(() => undefined);
  const refusal = refusalOf(res.status, body);

  log.warn('stem_server.request_refused', {
    path,
    status: res.status,
    refusal,
    code: isRecord(body) ? body.code : undefined,
    detail: isRecord(body) ? body.detail : undefined,
  });

  return refusal;
}

type Sent = { kind: 'ok'; res: Response } | { kind: 'unreachable' };

async function send(
  path: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Sent> {
  try {
    return {
      kind: 'ok',
      res: await fetch(`${stemServerUrl()}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    };
  } catch (error) {
    log.warn('stem_server.unreachable', {
      path,
      method: init.method ?? 'GET',
      error: errorName(error),
    });

    return { kind: 'unreachable' };
  }
}

async function readJob(res: Response, path: string): Promise<PostJobResult> {
  let wire: unknown;

  try {
    wire = await res.json();
  } catch (error) {
    log.warn('stem_server.bad_response', { path, error: errorName(error) });

    // A body cut off by the timeout reads as a lost connection.
    return errorName(error) === 'TimeoutError' ||
      errorName(error) === 'AbortError'
      ? { kind: 'unreachable' }
      : { kind: 'malformed' };
  }

  const parsed = parseJob(wire);

  if (parsed.kind === 'malformed') {
    log.warn('stem_server.bad_response', { path, reason: parsed.reason });

    return { kind: 'malformed' };
  }

  return parsed;
}

// --- Calls ---------------------------------------------------------------

export async function checkStemServer(): Promise<StemServerHealth> {
  const sent = await send('/health', HEALTH_TIMEOUT_MS);

  if (sent.kind === 'unreachable') {
    return 'unreachable';
  }

  const body: unknown = sent.res.ok
    ? await sent.res.json().catch(() => undefined)
    : undefined;

  if (!isRecord(body) || body.ok !== true) {
    // It answered, but can't split: a model failed to load, or this isn't
    // a stem server at all.
    log.warn('stem_server.unhealthy', {
      status: sent.res.status,
      models: isRecord(body) ? body.models : undefined,
    });

    return 'unhealthy';
  }

  // apiVersion 1 is this API; servers before it send none. Only logged so
  // far: nothing differs between them yet.
  if (body.apiVersion !== undefined && body.apiVersion !== 1) {
    log.warn('stem_server.api_version_unknown', {
      apiVersion: body.apiVersion,
    });
  }

  return 'ready';
}

export async function postJob(form: FormData): Promise<PostJobResult> {
  const path = '/jobs';
  const sent = await send(path, UPLOAD_TIMEOUT_MS, {
    method: 'POST',
    body: form,
  });

  if (sent.kind === 'unreachable') {
    return sent;
  }

  if (!sent.res.ok) {
    return { kind: 'refused', refusal: await readRefusal(sent.res, path) };
  }

  return readJob(sent.res, path);
}

export async function fetchJob(jobId: string): Promise<FetchJobResult> {
  const path = `/jobs/${encodeURIComponent(jobId)}`;
  const sent = await send(path, POLL_TIMEOUT_MS);

  if (sent.kind === 'unreachable') {
    return sent;
  }

  if (sent.res.status === 404) {
    return { kind: 'gone' };
  }

  if (!sent.res.ok) {
    return { kind: 'refused', refusal: await readRefusal(sent.res, path) };
  }

  return readJob(sent.res, path);
}

export async function downloadStem(
  jobId: string,
  name: string,
): Promise<StemDownload> {
  const path = `/jobs/${encodeURIComponent(jobId)}/stems/${encodeURIComponent(
    name,
  )}`;
  const sent = await send(path, STEM_DOWNLOAD_TIMEOUT_MS);

  if (sent.kind === 'unreachable') {
    return sent;
  }

  if (!sent.res.ok) {
    return { kind: 'refused', refusal: await readRefusal(sent.res, path) };
  }

  try {
    return { kind: 'ok', data: await sent.res.blob() };
  } catch (error) {
    // The connection dropped or the timeout hit mid-download.
    log.warn('stem_server.unreachable', { path, error: errorName(error) });

    return { kind: 'unreachable' };
  }
}

/**
 * Cancels a job, or lets the server drop a finished one. Nothing waits on
 * it and it never rejects; a failure is logged with `fields` (the song ID).
 */
export async function deleteJob(
  jobId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const path = `/jobs/${encodeURIComponent(jobId)}`;
  const sent = await send(path, DELETE_TIMEOUT_MS, { method: 'DELETE' });

  if (sent.kind === 'unreachable') {
    log.warn('split.job_delete_failed', { ...fields, jobId });

    return;
  }

  if (!sent.res.ok && sent.res.status !== 404) {
    log.warn('split.job_delete_failed', {
      ...fields,
      jobId,
      refusal: await readRefusal(sent.res, path),
    });

    return;
  }

  log.info('split.job_deleted', { ...fields, jobId });
}
