import { describe, expect, it } from 'vitest';
import { makeBuffer } from '../test-support';
import { pcmScale, toPcm16 } from './pcm';
import { ChannelStretcher } from './channel-stretcher';

describe('toPcm16', () => {
  it('converts every channel to its own 16-bit array, clamping overshoot', () => {
    const buffer = makeBuffer([
      [0, 0.5, -0.5, 1.2, -1.2, 0.99999],
      [1, -1, 0, 0, 0, 0],
    ]);
    const [left, right] = toPcm16(buffer as unknown as AudioBuffer);

    expect(Array.from(left)).toEqual([0, 16384, -16384, 32767, -32768, 32767]);
    expect(Array.from(right)).toEqual([32767, -32768, 0, 0, 0, 0]);
    expect(left.buffer).not.toBe(right.buffer);
  });

  it('scales 16-bit samples back to -1..1 and leaves floats alone', () => {
    expect(pcmScale(new Int16Array(1)) * 16384).toBe(0.5);
    expect(pcmScale(new Float32Array(1))).toBe(1);
  });
});

describe('ChannelStretcher on 16-bit input', () => {
  it('produces what it produces from the same audio as floats', () => {
    const length = 8192;
    const floats = new Float32Array(length);

    for (let i = 0; i < length; i += 1) {
      floats[i] = 0.5 * Math.sin(i / 7) + 0.25 * Math.sin(i / 31);
    }

    const ints = toPcm16(
      makeBuffer([Array.from(floats)]) as unknown as AudioBuffer,
    )[0];
    const fromFloats = new ChannelStretcher(floats, 0.75).produce(8);
    const fromInts = new ChannelStretcher(ints, 0.75).produce(8);
    const maxDiff = fromFloats.reduce(
      (max, v, i) => Math.max(max, Math.abs(v - fromInts[i])),
      0,
    );

    expect(maxDiff).toBeLessThan(1e-3);
  });
});
