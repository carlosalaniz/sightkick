import { describe, expect, it } from 'vitest';
import { withKitStems } from './KitPlayView';

const tracks = [
  { name: 'drums', urls: ['d1', 'd2'] },
  { name: 'song', urls: ['s'] },
];

describe('withKitStems', () => {
  it('keeps the tracks when the song has no kit split', () => {
    expect(withKitStems(tracks, undefined)).toEqual({
      trackData: tracks,
      kitStems: [],
    });
  });

  it('plays the kit pieces instead of the drums track', () => {
    const result = withKitStems(tracks, [
      { name: 'snare', src: 'sn' },
      { name: 'kick', src: 'k' },
    ]);

    expect(result.kitStems).toEqual(['kick', 'snare']);
    expect(result.trackData).toEqual([
      { name: 'kick', urls: ['k'] },
      { name: 'snare', urls: ['sn'] },
      { name: 'song', urls: ['s'] },
    ]);
  });
});
