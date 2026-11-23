import {
  buildUnits,
  scatterBlocks,
  StretchUnit,
  VoiceGroup,
} from './build-units';
import { SampleBlock } from '../types';
import { PcmChannel } from './pcm';
import { log } from '../../../../shared/log';

/**
 * How long one produce may take. A chunk normally takes milliseconds, but a
 * produce queues behind an init or speed change, which rebuild the stretch
 * units for the whole song (onset detection included): seconds on a slow
 * tablet. Past this the worker is taken to be wedged, so a start never
 * waits forever.
 */
const PRODUCE_TIMEOUT_MS = 30_000;

/**
 * Why the stream couldn't produce audio:
 * - worker-crashed: the worker died (out of memory on a tablet, a script
 *   error) or sent a message that couldn't be read.
 * - timed-out: no answer within PRODUCE_TIMEOUT_MS.
 */
export type StretchFailure = 'worker-crashed' | 'timed-out';

/**
 * - produced: the next blocks, one per channel (empty at the song's end).
 * - stopped: the stream was destroyed first; nobody needs the blocks.
 * - failed: no audio is coming; see StretchFailure.
 */
export type ProduceResult =
  | { kind: 'produced'; blocks: SampleBlock[] }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: StretchFailure };

interface PendingProduce {
  settle: (result: ProduceResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

function uniqueBuffers(channels: PcmChannel[]): ArrayBuffer[] {
  return [...new Set(channels.map((c) => c.buffer as ArrayBuffer))];
}

export class StretchStream {
  private worker: Worker | undefined;
  private units: StretchUnit[] = [];
  private channels: PcmChannel[] = [];
  private groups: VoiceGroup[] = [];
  private sampleRate = 44100;
  private onsetsByGroup: (number[] | undefined)[] = [];
  private pending = new Map<number, PendingProduce>();
  /** Set once the worker has died: every produce after that fails at once. */
  private crashed = false;
  private nextId = 0;
  private channelCount = 0;

  constructor() {
    if (typeof Worker === 'undefined') {
      return;
    }

    try {
      this.worker = new Worker(
        new URL('./stretch-worker.ts', import.meta.url),
        {
          type: 'module',
        },
      );
      this.worker.onmessage = (
        event: MessageEvent<{ id: number; blocks: SampleBlock[] }>,
      ) => {
        this.settle(event.data.id, {
          kind: 'produced',
          blocks: event.data.blocks,
        });
      };
      this.worker.onerror = (event: ErrorEvent) => {
        // Don't let the browser report it again as uncaught.
        event.preventDefault();
        this.handleCrash('stretch.worker_error', event.message);
      };
      this.worker.onmessageerror = () => {
        this.handleCrash('stretch.worker_message_unreadable', undefined);
      };
    } catch {
      this.worker = undefined;
    }
  }

  /**
   * With a worker, the channels are transferred to it, not copied: they are
   * the whole song's audio, and a second copy can be too much for a tablet.
   * The caller's arrays are empty afterwards.
   */
  init(
    channels: PcmChannel[],
    speed: number,
    groups: VoiceGroup[],
    sampleRate: number,
  ) {
    this.groups = groups;
    this.sampleRate = sampleRate;
    this.onsetsByGroup = new Array(groups.length).fill(undefined);

    if (this.worker) {
      this.channelCount = channels.length;
      this.worker.postMessage(
        {
          type: 'init',
          channels,
          speed,
          groups,
          sampleRate,
        },
        uniqueBuffers(channels),
      );

      return;
    }

    this.channels = channels;
    this.channelCount = channels.length;

    this.units = buildUnits(
      channels,
      groups,
      speed,
      sampleRate,
      this.onsetsByGroup,
    );
  }

  setSpeed(speed: number) {
    if (this.worker) {
      this.worker.postMessage({ type: 'setSpeed', speed });

      return;
    }

    this.units = buildUnits(
      this.channels,
      this.groups,
      speed,
      this.sampleRate,
      this.onsetsByGroup,
    );
  }

  seek(outputSample: number) {
    if (this.worker) {
      this.worker.postMessage({ type: 'seek', outputSample });

      return;
    }

    this.units.forEach((unit) => unit.seek(outputSample));
  }

  produce(frames: number): Promise<ProduceResult> {
    if (this.crashed) {
      return Promise.resolve({ kind: 'failed', reason: 'worker-crashed' });
    }

    if (this.worker) {
      const id = this.nextId;

      this.nextId += 1;

      return new Promise<ProduceResult>((settle) => {
        const timer = setTimeout(() => {
          log.error('stretch.produce_timed_out', {
            id,
            frames,
            timeoutMs: PRODUCE_TIMEOUT_MS,
          });
          this.settle(id, { kind: 'failed', reason: 'timed-out' });
        }, PRODUCE_TIMEOUT_MS);

        this.pending.set(id, { settle, timer });
        this.worker?.postMessage({ type: 'produce', id, frames });
      });
    }

    return Promise.resolve({
      kind: 'produced',
      blocks: scatterBlocks(this.units, this.channelCount, frames),
    });
  }

  /** Answers one request; a late answer to one that timed out is dropped. */
  private settle(id: number, result: ProduceResult): void {
    const request = this.pending.get(id);

    if (!request) {
      return;
    }

    this.pending.delete(id);
    clearTimeout(request.timer);
    request.settle(result);
  }

  private settleAll(result: ProduceResult): void {
    [...this.pending.keys()].forEach((id) => this.settle(id, result));
  }

  private handleCrash(event: string, detail: string | undefined): void {
    log.error(event, { pending: this.pending.size, detail });
    this.crashed = true;
    this.worker?.terminate();
    this.worker = undefined;
    this.settleAll({ kind: 'failed', reason: 'worker-crashed' });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = undefined;
    this.settleAll({ kind: 'stopped' });
    this.units = [];
    this.channels = [];
    this.groups = [];
    this.onsetsByGroup = [];
  }
}
