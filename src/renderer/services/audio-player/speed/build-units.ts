import { ChannelStretcher } from './channel-stretcher';
import { detectOnsets } from './onset-detection';
import { SampleBlock } from '../types';
import { PcmChannel, pcmScale } from './pcm';

export type VoiceKind = 'vocoder' | 'transient';

export interface VoiceGroup {
  start: number;
  count: number;
  kind: VoiceKind;
}

export interface StretchUnit {
  channelIndices: number[];
  seek(outputSample: number): void;
  produce(frames: number): SampleBlock[];
}

function mixToMono(channels: PcmChannel[]): Float32Array {
  const [first] = channels;

  if (channels.length === 1 && first instanceof Float32Array) {
    return first;
  }

  const length = first.length;
  const mono = new Float32Array(length);

  for (const channel of channels) {
    const scale = pcmScale(channel) / channels.length;

    for (let i = 0; i < length; i += 1) {
      mono[i] += channel[i] * scale;
    }
  }

  return mono;
}

function getOrComputeOnsets(
  cache: (number[] | undefined)[],
  groupIndex: number,
  compute: () => number[],
): number[] {
  const cached = cache[groupIndex];

  if (cached !== undefined) {
    return cached;
  }

  const onsets = compute();

  cache[groupIndex] = onsets;

  return onsets;
}

export function buildUnits(
  channels: PcmChannel[],
  groups: VoiceGroup[],
  speed: number,
  sampleRate: number,
  onsetsByGroup: (number[] | undefined)[],
): StretchUnit[] {
  return groups.map((group, groupIndex) => {
    const channelIndices = Array.from(
      { length: group.count },
      (_, i) => group.start + i,
    );
    const onsets =
      group.kind === 'transient'
        ? getOrComputeOnsets(onsetsByGroup, groupIndex, () =>
            detectOnsets(
              mixToMono(channelIndices.map((index) => channels[index])),
              sampleRate,
            ),
          )
        : [];
    const stretchers = channelIndices.map(
      (index) => new ChannelStretcher(channels[index], speed, onsets),
    );

    return {
      channelIndices,
      seek: (outputSample: number) =>
        stretchers.forEach((stretcher) => stretcher.seek(outputSample)),
      produce: (frames: number) =>
        stretchers.map((stretcher) => stretcher.produce(frames)),
    };
  });
}

export function scatterBlocks(
  units: StretchUnit[],
  channelCount: number,
  frames: number,
): SampleBlock[] {
  const output = new Array<SampleBlock>(channelCount);

  for (const unit of units) {
    const blocks = unit.produce(frames);

    unit.channelIndices.forEach((index, i) => {
      output[index] = blocks[i];
    });
  }

  return output;
}
