import {
  buildUnits,
  scatterBlocks,
  StretchUnit,
  VoiceGroup,
} from './build-units';
import { SampleBlock } from '../types';
import { PcmChannel } from './pcm';

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
  private pending = new Map<number, (blocks: SampleBlock[]) => void>();
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
        const resolve = this.pending.get(event.data.id);

        if (resolve) {
          this.pending.delete(event.data.id);
          resolve(event.data.blocks);
        }
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

  produce(frames: number): Promise<SampleBlock[]> {
    if (this.worker) {
      const id = this.nextId;

      this.nextId += 1;

      return new Promise<SampleBlock[]>((resolve) => {
        this.pending.set(id, resolve);
        this.worker?.postMessage({ type: 'produce', id, frames });
      });
    }

    return Promise.resolve(
      scatterBlocks(this.units, this.channelCount, frames),
    );
  }

  destroy() {
    this.worker?.terminate();
    this.worker = undefined;

    for (const resolve of this.pending.values()) {
      resolve([]);
    }

    this.pending.clear();
    this.units = [];
    this.channels = [];
    this.groups = [];
    this.onsetsByGroup = [];
  }
}
