/**
 * Samples the stretcher reads: 16-bit integers (half the memory of the 32-bit
 * floats the browser decodes to, and the resolution the songs come in), or
 * floats where a caller already has them.
 */
export type PcmChannel = Int16Array | Float32Array;

const INT16_SCALE = 1 / 32768;

/** Multiplier that turns a channel's raw values into -1..1 samples. */
export const pcmScale = (channel: PcmChannel) =>
  channel instanceof Int16Array ? INT16_SCALE : 1;

/** One Int16Array per channel, each on its own buffer so it can be transferred. */
export function toPcm16(buffer: AudioBuffer): Int16Array[] {
  const channels: Int16Array[] = [];

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const output = new Int16Array(input.length);

    for (let i = 0; i < input.length; i += 1) {
      // Int16Array wraps out-of-range values, so clamp (decoders can overshoot).
      output[i] = Math.max(
        -32768,
        Math.min(32767, Math.round(input[i] * 32768)),
      );
    }

    channels.push(output);
  }

  return channels;
}
