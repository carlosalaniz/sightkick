import { Voice, VOICE_INFO, VOICES } from '../../../../kit';
import { DrumKitPiece } from '../../../../../songData';

export type StepKind = 'listen' | 'count' | 'limb' | 'all' | 'read' | 'mix';

export interface LessonStep {
  id: string;
  kind: StepKind;
  name: string;
  /** Voices you play and are scored on. Empty for listen / count. */
  voices: Voice[];
  tip: string;
}

const CYMBALS: Voice[] = ['hihat', 'ride', 'crash'];
const DRUMS: Voice[] = ['snare', 'tom1', 'tom2', 'tom3'];
const FEET: Voice[] = ['kick'];

/** Drum-track gain in limb steps: quiet, so you still hear the whole beat. */
export const LIMB_TRACK_GAIN = 0.35;

function byVoiceOrder(voices: Iterable<Voice>): Voice[] {
  const set = new Set(voices);

  return VOICES.map((v) => v.id).filter((v) => set.has(v));
}

/** "Hi-hat + crash + kick". */
export function voiceListName(voices: Voice[]): string {
  return voices
    .map((v, i) => {
      const name = VOICE_INFO[v].name;

      return i === 0 ? name : name.toLowerCase();
    })
    .join(' + ');
}

const sameSet = (a: Voice[], b: Voice[]) =>
  a.length === b.length && a.every((v) => b.includes(v));

/**
 * The lesson's steps for the voices in its window: listen, count, one limb
 * group at a time (cymbal hand + foot, then both hands, as in the mock),
 * all together, read, mix-up. Limb steps that would be empty, repeat one
 * before or already be the whole beat are skipped.
 */
export function buildSteps(
  windowVoices: Iterable<Voice>,
  opts: { hasMix: boolean; hasDrumStem: boolean; hasKitStems?: boolean },
): LessonStep[] {
  const all = byVoiceOrder(windowVoices);
  const pick = (group: Voice[]) => all.filter((v) => group.includes(v));
  const cym = pick(CYMBALS);
  const drums = pick(DRUMS);
  const feet = pick(FEET);
  const rest = opts.hasKitStems
    ? 'The parts you are not playing stay in the drum track at full volume, and yours plays quietly as a guide, so you hear the whole groove.'
    : opts.hasDrumStem
    ? 'The rest of the beat stays in the drum track, quietly, so you still hear the whole groove.'
    : 'The song still has its drums in it, so you hear the whole groove.';
  const steps: LessonStep[] = [
    {
      id: 'listen',
      kind: 'listen',
      name: 'Listen',
      voices: [],
      tip: 'Hands off. Listen to the beat and follow the red line. The rings on the kit show which pad is coming next.',
    },
    {
      id: 'count',
      kind: 'count',
      name: 'Count out loud',
      voices: [],
      tip: 'Still hands off. Count out loud with the syllables under the staff, and keep counting through every step after this one.',
    },
  ];
  const limbs: { voices: Voice[]; tip: string }[] = [
    {
      voices: [...cym, ...feet],
      tip:
        cym.length > 0 && feet.length > 0
          ? `One hand and your foot. ${rest} Keep counting out loud.`
          : `One limb first. ${rest} Keep counting out loud.`,
    },
    {
      voices: [...cym, ...drums],
      tip:
        cym.length > 0 && drums.length > 0
          ? `Both hands. ${rest}`
          : `Your hands. ${rest}`,
    },
  ];
  const seen: Voice[][] = [];

  for (const limb of limbs) {
    const voices = byVoiceOrder(limb.voices);

    if (
      voices.length === 0 ||
      sameSet(voices, all) ||
      seen.some((s) => sameSet(s, voices))
    ) {
      continue;
    }

    seen.push(voices);
    steps.push({
      id: `limb${seen.length}`,
      kind: 'limb',
      name: voiceListName(voices),
      voices,
      tip: limb.tip,
    });
  }

  steps.push(
    {
      id: 'all',
      kind: 'all',
      name: 'All together',
      voices: all,
      tip: opts.hasDrumStem
        ? 'The whole beat, with colors and kit hints on. The drum track is off now: what you hear is you. A clean pass moves you on.'
        : 'The whole beat, with colors and kit hints on. A clean pass moves you on.',
    },
    {
      id: 'read',
      kind: 'read',
      name: 'Read it',
      voices: all,
      tip: 'Colors and kit hints fade after each clean pass. Play it clean with no help at all and you have read it.',
    },
  );

  if (opts.hasMix) {
    steps.push({
      id: 'mix',
      kind: 'mix',
      name: 'Mix-up',
      voices: all,
      tip: 'The next four bars of the song, which you have not practised. Plain notation, no hints. Look a beat ahead of the red line.',
    });
  }

  return steps;
}

/** Steps where you only listen: nothing is scored. */
export function isListening(kind: StepKind): boolean {
  return kind === 'listen' || kind === 'count';
}

/** Drum-stem gain for a step: full while listening, quiet for limbs, off when it is all you. */
export function drumTrackGain(kind: StepKind): number {
  if (isListening(kind)) {
    return 1;
  }

  return kind === 'limb' ? LIMB_TRACK_GAIN : 0;
}

/** The kit stem that carries a chart voice. */
export const KIT_STEM_OF_VOICE: Record<Voice, DrumKitPiece> = {
  kick: 'kick',
  snare: 'snare',
  tom1: 'toms',
  tom2: 'toms',
  tom3: 'toms',
  hihat: 'hihat',
  ride: 'ride',
  crash: 'crash',
};

/**
 * Gains for kit-piece stems: everything while listening; in limb steps the
 * rest of the kit plays at full volume and the pieces you play drop to a quiet
 * guide (the level a song without a kit split plays its whole drum track at:
 * the app makes no sound when you hit, so silence would leave a player whose
 * kit isn't audible with nothing to follow); off when it is all you.
 */
export function kitStemGains(
  step: Pick<LessonStep, 'kind' | 'voices'>,
  kitStems: DrumKitPiece[],
): Record<string, number> {
  const mine = new Set(step.voices.map((v) => KIT_STEM_OF_VOICE[v]));

  return Object.fromEntries(
    kitStems.map((piece) => {
      if (isListening(step.kind)) {
        return [piece, 1];
      }

      if (step.kind !== 'limb') {
        return [piece, 0];
      }

      return [piece, mine.has(piece) ? LIMB_TRACK_GAIN : 1];
    }),
  );
}
