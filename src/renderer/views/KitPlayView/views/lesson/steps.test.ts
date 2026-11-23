import { describe, expect, it } from 'vitest';
import {
  buildSteps,
  drumTrackGain,
  isListening,
  kitStemGains,
  LIMB_TRACK_GAIN,
  voiceListName,
} from './steps';
import { Voice } from '../../../../kit';

const opts = { hasMix: true, hasDrumStem: true };

describe('buildSteps', () => {
  it('follows the mock for a hi-hat / snare / kick beat', () => {
    const steps = buildSteps(['kick', 'snare', 'hihat'], opts);

    expect(steps.map((s) => s.name)).toEqual([
      'Listen',
      'Count out loud',
      'Hi-hat + kick',
      'Hi-hat + snare',
      'All together',
      'Read it',
      'Mix-up',
    ]);
    expect(steps[2].voices).toEqual(['hihat', 'kick']);
    expect(steps[3].voices).toEqual(['hihat', 'snare']);
    expect(steps[4].voices).toEqual(['hihat', 'snare', 'kick']);
  });

  it('groups every cymbal and drum into the hand steps', () => {
    const steps = buildSteps(['crash', 'hihat', 'snare', 'tom1', 'kick'], opts);
    const limbs = steps.filter((s) => s.kind === 'limb');

    expect(limbs.map((s) => s.voices)).toEqual([
      ['hihat', 'crash', 'kick'],
      ['hihat', 'crash', 'snare', 'tom1'],
    ]);
    expect(limbs[0].name).toBe('Hi-hat + crash + kick');
  });

  it('skips limb steps that would be the whole beat or repeat', () => {
    // No cymbals: kick alone, then the drums.
    expect(
      buildSteps(['snare', 'kick'], opts)
        .filter((s) => s.kind === 'limb')
        .map((s) => s.voices),
    ).toEqual([['kick'], ['snare']]);
    // One voice only: no limb steps at all.
    expect(buildSteps(['snare'], opts).some((s) => s.kind === 'limb')).toBe(
      false,
    );
    // Hands only: the second limb step would be the whole beat.
    expect(
      buildSteps(['hihat', 'snare'], opts)
        .filter((s) => s.kind === 'limb')
        .map((s) => s.voices),
    ).toEqual([['hihat']]);
  });

  it('drops the mix-up when there are no other bars', () => {
    const steps = buildSteps(['kick', 'snare'], { ...opts, hasMix: false });

    expect(steps.at(-1)?.kind).toBe('read');
  });

  it('mentions the drum track only when the song has one', () => {
    const withStem = buildSteps(['kick', 'hihat'], opts);
    const without = buildSteps(['kick', 'hihat'], {
      ...opts,
      hasDrumStem: false,
    });

    expect(withStem.find((s) => s.kind === 'all')?.tip).toContain('drum track');
    expect(without.find((s) => s.kind === 'all')?.tip).not.toContain(
      'drum track',
    );
  });
});

describe('step helpers', () => {
  it('names voice lists', () => {
    expect(voiceListName(['ride', 'kick'])).toBe('Ride + kick');
  });

  it('keeps the drum track for listening, quiet for limbs, off after', () => {
    expect(isListening('listen')).toBe(true);
    expect(isListening('count')).toBe(true);
    expect(isListening('all')).toBe(false);
    expect(drumTrackGain('listen')).toBe(1);
    expect(drumTrackGain('count')).toBe(1);
    expect(drumTrackGain('limb')).toBe(LIMB_TRACK_GAIN);
    expect(drumTrackGain('all')).toBe(0);
    expect(drumTrackGain('read')).toBe(0);
    expect(drumTrackGain('mix')).toBe(0);
  });

  it('turns down only the kit pieces a limb step has you play, to a guide', () => {
    const kit = ['kick', 'snare', 'toms', 'hihat', 'ride', 'crash'] as const;
    const limb = {
      kind: 'limb' as const,
      voices: ['hihat', 'kick'] as Voice[],
    };

    expect(kitStemGains(limb, [...kit])).toEqual({
      kick: LIMB_TRACK_GAIN,
      snare: 1,
      toms: 1,
      hihat: LIMB_TRACK_GAIN,
      ride: 1,
      crash: 1,
    });
    expect(
      kitStemGains({ kind: 'limb', voices: ['tom2'] }, ['toms', 'snare']),
    ).toEqual({ toms: LIMB_TRACK_GAIN, snare: 1 });
    expect(kitStemGains({ kind: 'listen', voices: [] }, ['kick'])).toEqual({
      kick: 1,
    });
    expect(
      kitStemGains({ kind: 'all', voices: ['kick'] }, ['kick', 'ride']),
    ).toEqual({
      kick: 0,
      ride: 0,
    });
  });
});
