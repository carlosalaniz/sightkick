import { afterEach, describe, expect, it, vi } from 'vitest';
import { StretchStream } from './stretch-stream';
import { log } from '../../../../shared/log';

class FakeWorker {
  static last: FakeWorker | undefined;

  posted: { message: unknown; transfer?: Transferable[] }[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  onerror: ((event: ErrorEvent) => void) | null = null;

  onmessageerror: ((event: MessageEvent) => void) | null = null;

  terminated = false;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  /** Answers the last produce request with one block. */
  answerLast() {
    const request = [...this.posted]
      .reverse()
      .find((p) => (p.message as { type: string }).type === 'produce')
      ?.message as { id: number };

    this.onmessage?.({
      data: { id: request.id, blocks: [new Float32Array([1])] },
    } as MessageEvent);
  }
}

function startedStream() {
  vi.stubGlobal('Worker', FakeWorker);

  const stream = new StretchStream();

  stream.init(
    [new Int16Array(4)],
    1,
    [{ start: 0, count: 1, kind: 'vocoder' }],
    48000,
  );

  return { stream, worker: FakeWorker.last! };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StretchStream with a worker', () => {
  it('transfers the samples to the worker instead of copying them', () => {
    vi.stubGlobal('Worker', FakeWorker);

    const left = new Int16Array(4);
    const right = new Int16Array(4);
    const stream = new StretchStream();

    stream.init(
      [left, right],
      1,
      [{ start: 0, count: 2, kind: 'vocoder' }],
      48000,
    );

    const [{ message, transfer }] = FakeWorker.last!.posted;

    expect((message as { type: string }).type).toBe('init');
    expect(transfer).toEqual([left.buffer, right.buffer]);
  });

  it("passes on the worker's blocks", async () => {
    const { stream, worker } = startedStream();
    const produced = stream.produce(4);

    worker.answerLast();

    await expect(produced).resolves.toEqual({
      kind: 'produced',
      blocks: [new Float32Array([1])],
    });
  });

  it('fails pending and later produces when the worker dies', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {});

    const { stream, worker } = startedStream();
    const pending = stream.produce(4);

    worker.onerror?.({
      message: 'out of memory',
      preventDefault: () => {},
    } as ErrorEvent);

    await expect(pending).resolves.toEqual({
      kind: 'failed',
      reason: 'worker-crashed',
    });
    await expect(stream.produce(4)).resolves.toEqual({
      kind: 'failed',
      reason: 'worker-crashed',
    });
    expect(worker.terminated).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      'stretch.worker_error',
      expect.objectContaining({ pending: 1, detail: 'out of memory' }),
    );
  });

  it('fails pending produces when a worker message cannot be read', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {});

    const { stream, worker } = startedStream();
    const pending = stream.produce(4);

    worker.onmessageerror?.({} as MessageEvent);

    await expect(pending).resolves.toEqual({
      kind: 'failed',
      reason: 'worker-crashed',
    });
  });

  it('gives up on a produce the worker never answers, and drops a late answer', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const { stream, worker } = startedStream();
    const pending = stream.produce(4);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toEqual({
      kind: 'failed',
      reason: 'timed-out',
    });
    expect(() => worker.answerLast()).not.toThrow();
  });
});
