import { BaseAudioTrack } from '../base-track';
import { PcmChannel, toPcm16 } from './pcm';

/** What the player still needs to know about a file once its audio is gone. */
export interface FileFormat {
  channels: number;
  sampleRate: number;
}

export class SpeedAudioTrack extends BaseAudioTrack {
  private sources: AudioBufferSourceNode[] = [];

  /** Per file, per channel: the samples, until they go to the stretcher. */
  pcm: PcmChannel[][];

  readonly formats: FileFormat[];

  constructor(
    buffers: AudioBuffer[],
    name: string,
    context: AudioContext,
    destination?: AudioNode,
  ) {
    super(buffers, name, context, destination);
    this.formats = buffers.map((buffer) => ({
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    }));
    // The stretcher reads 16-bit samples, half the size of the decoded
    // floats, and plays only what it produces: the decoded audio can go.
    this.pcm = buffers.map((buffer) => toPcm16(buffer));
    this.buffers = [];
  }

  /** Hands the samples over; the track keeps none of them. */
  takePcm(): PcmChannel[][] {
    const { pcm } = this;

    this.pcm = [];

    return pcm;
  }

  scheduleChunk(fileIndex: number, buffer: AudioBuffer, at: number) {
    const source = this.context.createBufferSource();

    source.buffer = buffer;
    source.connect(this.gainNodes[fileIndex]);
    source.start(at);
    source.addEventListener('ended', this.endedEventListener);
    this.sources.push(source);
  }

  stop() {
    this.sources.forEach((source) => this.stopSource(source));
    this.sources = [];
  }

  endedEventListener = (event: Event) => {
    const source = event.currentTarget as AudioBufferSourceNode;

    source.disconnect();

    const idx = this.sources.indexOf(source);

    if (idx !== -1) {
      this.sources.splice(idx, 1);
    }
  };

  stopSource(source: AudioBufferSourceNode) {
    source.stop();
    source.removeEventListener('ended', this.endedEventListener);
    source.disconnect();
  }
}
