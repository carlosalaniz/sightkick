import { describe, expect, it } from 'vitest';
import { DEFAULT_KITS } from '../../kit';
import {
  controlChipText,
  controlNoun,
  fallbackVoices,
  unlearnedQueue,
} from './learn';
import { keyName } from '../../kit';
import { createPiece, removePiece } from './kitEdits';

const EKIT = DEFAULT_KITS[0];

describe('control labels', () => {
  it('names MIDI notes by zone and keys by their key', () => {
    expect(controlChipText('midi:38')).toBe('38 head');
    expect(controlChipText('midi:99')).toBe('99');
    expect(controlChipText('keyboard:KeyJ')).toBe('J');
    expect(controlNoun('midi:38')).toBe('Note 38');
    expect(controlNoun('keyboard:Space')).toBe('Key Space');
    expect(keyName('Digit4')).toBe('4');
    expect(keyName('ArrowLeft')).toBe('←');
  });
});

describe('unlearnedQueue', () => {
  it('lists pieces without learned controls left to right', () => {
    const kit = { ...EKIT, controls: { hh: ['midi:42'] } };
    const queue = unlearnedQueue(kit);
    const xs = queue.map((id) => kit.pieces.find((p) => p.id === id)!.x);

    expect(queue).not.toContain('hh');
    expect(queue).toHaveLength(kit.pieces.length - 1);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('fallbackVoices', () => {
  const sn = EKIT.pieces.find((p) => p.id === 'sn')!;
  const cr2 = EKIT.pieces.find((p) => p.id === 'cr2')!;

  it('reports the device mapping an unlearned pad still plays through', () => {
    expect(fallbackVoices(EKIT, sn, { snare: ['midi:38'] })).toEqual(['snare']);
    expect(fallbackVoices(EKIT, sn, {})).toEqual([]);
  });

  it('is empty once another piece learned controls for that voice', () => {
    const kit = { ...EKIT, controls: { cr1: ['midi:49'] } };

    expect(fallbackVoices(kit, cr2, { crash: ['midi:49'] })).toEqual([]);
  });
});

describe('createPiece', () => {
  it('gives a new tom a free tom voice and an unused color', () => {
    const kit = removePiece(EKIT, 't2');
    const tom = createPiece(kit, 'tom');
    const used = new Set(kit.pieces.map((p) => p.color));

    expect(tom.voices).toEqual(['tom2']);
    expect(used.has(tom.color)).toBe(false);
    expect(tom.name).toBe('Rack tom 2');
  });
});
