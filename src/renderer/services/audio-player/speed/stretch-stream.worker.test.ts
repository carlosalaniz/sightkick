import { afterEach, describe, expect, it, vi } from 'vitest';
import { StretchStream } from './stretch-stream';

class FakeWorker {
  static last: FakeWorker | undefined;

  posted: { message: unknown; transfer?: Transferable[] }[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }

  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
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
});
