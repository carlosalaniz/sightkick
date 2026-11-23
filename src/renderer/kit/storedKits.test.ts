import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KITS } from './constants';
import { kitInputMapping } from './mapping';
import { parseKit, parseKitState } from './storedKits';
import { Kit } from './types';

const kit = DEFAULT_KITS[0];

afterEach(() => {
  vi.restoreAllMocks();
});

const roundTrip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));

describe('parseKitState', () => {
  it('keeps a valid stored state as it was', () => {
    const state = { kits: DEFAULT_KITS, currentId: kit.id };

    expect(parseKitState(roundTrip(state))).toEqual(state);
  });

  it('rejects values that are not a kit state', () => {
    expect(parseKitState(null)).toBeUndefined();
    expect(parseKitState('kits')).toBeUndefined();
    expect(parseKitState({ currentId: 'x' })).toBeUndefined();
    expect(parseKitState([kit])).toBeUndefined();
  });

  it('drops kits without an id and defaults a missing current id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const parsed = parseKitState({ kits: [{ name: 'no id' }, kit] });

    expect(parsed?.kits.map((k) => k.id)).toEqual([kit.id]);
    expect(parsed?.currentId).toBe(kit.id);
  });
});

describe('parseKit', () => {
  it('gives a kit stored without controls an empty set', () => {
    const { controls: _controls, ...old } = kit;

    expect(parseKit(roundTrip(old))?.controls).toEqual({});
  });

  it('drops pieces that cannot be drawn and unknown voices', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const [first, second] = kit.pieces;
    const parsed = parseKit({
      ...kit,
      pieces: [
        { ...first, voices: [...first.voices, 'cowbell'] },
        { ...second, type: 'gong' },
        { ...second, x: 'left' },
      ],
    });

    expect(parsed?.pieces).toEqual([first]);
  });

  it('defaults an unknown kind to electronic and keeps only string controls', () => {
    const parsed = parseKit({
      ...kit,
      kind: 'hybrid',
      controls: { sn: ['midi:38', 7], hh: 'keyboard:KeyJ' },
    });

    expect(parsed?.kind).toBe('electronic');
    expect(parsed?.controls).toEqual({ sn: ['midi:38'] });
  });
});

describe('kitInputMapping', () => {
  it('falls back to the device mapping for a kit with no controls', () => {
    const { controls: _controls, ...old } = kit;

    expect(kitInputMapping(old as Kit, { snare: ['midi:38'] }).snare).toEqual([
      'midi:38',
    ]);
  });
});
