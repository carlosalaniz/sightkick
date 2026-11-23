import { InputMapping } from '../../../types';
import { controlLabel, controlSource } from '../../input';
import { Kit, KitPiece, MIDI_ZONES, Voice } from '../../kit';
import { byX } from './kitEdits';

/** Delay before "Learn unmapped pads" moves on after a learned hit. */
export const ADVANCE_DELAY_MS = 650;

export const MONITOR_LENGTH = 7;

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: '⌫',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/** A readable name for a `KeyboardEvent.code` ("KeyJ" → "J"). */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }

  if (code.startsWith('Numpad')) {
    return `Num ${code.slice(6)}`;
  }

  return KEY_NAMES[code] ?? code;
}

function midiNote(controlId: string): number | undefined {
  if (controlSource(controlId) !== 'midi') {
    return undefined;
  }

  const note = Number(controlLabel(controlId));

  return Number.isFinite(note) ? note : undefined;
}

/** Zone name of a MIDI control ("head", "rim"), if it is a known GM drum note. */
export function controlZone(controlId: string): string | undefined {
  const note = midiNote(controlId);

  return note === undefined ? undefined : MIDI_ZONES[note];
}

/** Chip text: "38 head" for MIDI, the key's name for the keyboard. */
export function controlChipText(controlId: string): string {
  const note = midiNote(controlId);

  if (note !== undefined) {
    return [note, MIDI_ZONES[note]].filter(Boolean).join(' ');
  }

  return controlSource(controlId) === 'keyboard'
    ? keyName(controlLabel(controlId))
    : controlLabel(controlId);
}

/** In a sentence: "Note 38" or "Key J". */
export function controlNoun(controlId: string): string {
  const note = midiNote(controlId);

  if (note !== undefined) {
    return `Note ${note}`;
  }

  return controlSource(controlId) === 'keyboard'
    ? `Key ${keyName(controlLabel(controlId))}`
    : controlLabel(controlId);
}

export function learnedControls(kit: Kit, pieceId: string): string[] {
  return kit.controls[pieceId] ?? [];
}

/** Pieces without learned controls, left to right: the "Learn unmapped pads" queue. */
export function unlearnedQueue(kit: Kit): string[] {
  return byX(kit.pieces)
    .filter((p) => learnedControls(kit, p.id).length === 0)
    .map((p) => p.id);
}

/**
 * Voices of a piece with no learned controls that the judge will still hear
 * through the device's voice mapping (see `kitInputMapping`): no piece on the
 * kit has learned controls for them, and Input settings maps them.
 */
export function fallbackVoices(
  kit: Kit,
  piece: KitPiece,
  mapping: InputMapping,
): Voice[] {
  if (learnedControls(kit, piece.id).length > 0) {
    return [];
  }

  return piece.voices.filter(
    (v) =>
      (mapping[v]?.length ?? 0) > 0 &&
      !kit.pieces.some(
        (p) => p.voices.includes(v) && learnedControls(kit, p.id).length > 0,
      ),
  );
}
