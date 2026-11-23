import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../renderer/hooks/test-support';
import {
  checkStemServer,
  deleteJob,
  downloadStem,
  fetchJob,
  parseJob,
  postJob,
} from './stem-server-api';
import { json, routedFetch } from './test-support';

beforeEach(() => {
  installLocalStorage();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function answer(response: Response | 'network-error') {
  const fake = routedFetch(() =>
    response === 'network-error' ? response : response.clone(),
  );
  const spy = vi.fn(fake.fetch);

  vi.stubGlobal('fetch', spy);

  return spy;
}

describe('checkStemServer', () => {
  it.each([
    ['ready', json({ ok: true }), 'ready'],
    ['ready, with the API version', json({ ok: true, apiVersion: 1 }), 'ready'],
    [
      'a model that failed to load',
      json({ ok: false, models: {} }),
      'unhealthy',
    ],
    ['an error status', new Response('oops', { status: 500 }), 'unhealthy'],
    [
      'something that is not a stem server',
      new Response('<html>'),
      'unhealthy',
    ],
    ['no answer', 'network-error' as const, 'unreachable'],
  ] as const)('reports %s', async (_, response, health) => {
    answer(response);

    await expect(checkStemServer()).resolves.toBe(health);
  });
});

describe('requests', () => {
  it('puts a timeout on every call', async () => {
    const spy = answer(json({ id: 'j', status: 'done', stems: [] }));

    await checkStemServer();
    await postJob(new FormData());
    await fetchJob('j');
    await downloadStem('j', 'drums');
    await deleteJob('j', { songId: 's' });

    expect(spy).toHaveBeenCalledTimes(5);

    for (const [, init] of spy.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('reads a job that is gone as gone, not as a failed poll', async () => {
    answer(json({ detail: 'Unknown or expired job', code: 'not_found' }, 404));

    await expect(fetchJob('j')).resolves.toEqual({ kind: 'gone' });
  });

  it("logs the server's own text but returns only our refusal", async () => {
    answer(json({ detail: 'Upload is over 500 MB', code: 'too_large' }, 413));

    await expect(postJob(new FormData())).resolves.toEqual({
      kind: 'refused',
      refusal: 'too_large',
    });
    expect(console.warn).toHaveBeenCalledWith(
      'stem_server.request_refused',
      expect.objectContaining({ detail: 'Upload is over 500 MB' }),
    );
  });

  it.each([
    [400, 'bad_request'],
    [404, 'not_found'],
    [413, 'too_large'],
    [418, 'bad_request'],
    [422, 'bad_request'],
    [429, 'busy'],
    [500, 'server_error'],
    [503, 'model_unavailable'],
  ] as const)(
    'goes by the status (%i) when the body has no code',
    async (status, refusal) => {
      answer(new Response('Internal Server Error', { status }));

      await expect(postJob(new FormData())).resolves.toEqual({
        kind: 'refused',
        refusal,
      });
    },
  );
});

describe('parseJob', () => {
  it('rejects a stem name that could leave the song folder', () => {
    expect(
      parseJob({ id: 'j', status: 'done', stems: ['../../evil'] }),
    ).toEqual({ kind: 'malformed', reason: 'bad stem list' });
  });

  it('rejects a job without an id', () => {
    expect(parseJob({ status: 'running' }).kind).toBe('malformed');
  });

  it('clamps progress and reads queued and running as working', () => {
    expect(parseJob({ id: 'j', status: 'queued', progress: 140 })).toEqual({
      kind: 'ok',
      job: { state: 'working', id: 'j', progress: 100 },
    });
  });
});
