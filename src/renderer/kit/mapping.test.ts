import { describe, expect, it } from 'vitest';
import { InputMapping } from '../../types';
import {
  assignControlToPiece,
  controlsForPiece,
  kitInputMapping,
  pieceForControl,
  removeControlFromPiece,
} from './mapping';
import { Kit, KitPiece, Voice } from './types';

function piece(id: string, name: string, voices: Voice[]): KitPiece {
  return {
    id,
    type: 'snare',
    name,
    size: 12,
    x: 50,
    y: 50,
    voices,
    color: '#fff',
  };
}

const KIT: Kit = {
  id: 'k',
  name: 'Test kit',
  kind: 'electronic',
  pieces: [
    piece('sn', 'Snare', ['snare']),
    piece('t1', 'Tom 1', ['tom1']),
    piece('c1', 'Crash', ['crash']),
    piece('c2', 'Crash 2', ['crash']),
    piece('cr', 'Crash / ride', ['crash', 'ride']),
    piece('kk', 'Kick', ['kick']),
  ],
  controls: {},
};
const DEVICE: InputMapping = {
  snare: ['midi:38'],
  tom1: ['midi:48'],
  crash: ['midi:49'],
  ride: ['midi:51'],
  kick: ['midi:36'],
  hihat: ['midi:42', 'midi:46'],
};

describe('assignControlToPiece', () => {
  it('adds a control to a piece once', () => {
    const once = assignControlToPiece(KIT, 'sn', 'midi:38');
    const twice = assignControlToPiece(once.kit, 'sn', 'midi:38');

    expect(twice.kit.controls.sn).toEqual(['midi:38']);
    expect(twice.movedFrom).toBeUndefined();
  });

  it('moves a control off the piece that had it', () => {
    const learned = assignControlToPiece(KIT, 'sn', 'midi:38').kit;
    const withRim = assignControlToPiece(learned, 'sn', 'midi:40').kit;
    const { kit, movedFrom } = assignControlToPiece(withRim, 't1', 'midi:38');

    expect(movedFrom?.name).toBe('Snare');
    expect(kit.controls.sn).toEqual(['midi:40']);
    expect(kit.controls.t1).toEqual(['midi:38']);
    expect(pieceForControl(kit, 'midi:38', {})?.id).toBe('t1');
  });

  it('does not mutate the kit it was given', () => {
    assignControlToPiece(KIT, 'sn', 'keyboard:KeyJ');

    expect(KIT.controls).toEqual({});
  });
});

describe('removeControlFromPiece', () => {
  it('removes only that control', () => {
    let kit = assignControlToPiece(KIT, 'sn', 'midi:38').kit;

    kit = assignControlToPiece(kit, 'sn', 'midi:40').kit;
    kit = removeControlFromPiece(kit, 'sn', 'midi:38');

    expect(kit.controls.sn).toEqual(['midi:40']);
  });
});

describe('kitInputMapping', () => {
  it("falls back to the device's mapping for every voice when nothing is learned", () => {
    expect(kitInputMapping(KIT, DEVICE)).toEqual({
      hihat: ['midi:42', 'midi:46'],
      crash: ['midi:49'],
      ride: ['midi:51'],
      snare: ['midi:38'],
      tom1: ['midi:48'],
      tom2: [],
      tom3: [],
      kick: ['midi:36'],
    });
  });

  it('unions the learned controls of every piece that plays a voice', () => {
    let kit = assignControlToPiece(KIT, 'c1', 'midi:49').kit;

    kit = assignControlToPiece(kit, 'c2', 'midi:57').kit;
    kit = assignControlToPiece(kit, 'cr', 'midi:52').kit;
    kit = assignControlToPiece(kit, 'cr', 'keyboard:KeyC').kit;

    const mapping = kitInputMapping(kit, DEVICE);

    expect(mapping.crash).toEqual([
      'midi:49',
      'midi:57',
      'midi:52',
      'keyboard:KeyC',
    ]);
    // The crash/ride piece's controls also play the ride, replacing the device's 51.
    expect(mapping.ride).toEqual(['midi:52', 'keyboard:KeyC']);
  });

  it('falls back per voice: learned voices replace the device mapping, others keep it', () => {
    const kit = assignControlToPiece(KIT, 'sn', 'keyboard:KeyJ').kit;
    const mapping = kitInputMapping(kit, DEVICE);

    expect(mapping.snare).toEqual(['keyboard:KeyJ']);
    expect(mapping.kick).toEqual(['midi:36']);
    expect(mapping.tom1).toEqual(['midi:48']);
  });

  it('does not repeat a control shared by two voices of one piece', () => {
    const kit = assignControlToPiece(KIT, 'cr', 'midi:51').kit;

    expect(kitInputMapping(kit, {}).ride).toEqual(['midi:51']);
  });
});

describe('controlsForPiece', () => {
  it("uses learned controls, else the piece's voices from the device mapping", () => {
    const kit = assignControlToPiece(KIT, 'sn', 'midi:40').kit;

    expect(controlsForPiece(kit, kit.pieces[0], DEVICE)).toEqual(['midi:40']);
    expect(controlsForPiece(kit, kit.pieces[4], DEVICE)).toEqual([
      'midi:49',
      'midi:51',
    ]);
  });
});
