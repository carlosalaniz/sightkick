import { InputMapping } from '../../types';
import { VOICES } from './constants';
import { Kit, KitPiece, Voice } from './types';

/**
 * The input mapping the judge should use for this kit: each voice gets the
 * controls learned on every piece that plays it. Voices with no learned
 * controls keep the device's existing mapping.
 */
export function kitInputMapping(
  kit: Kit,
  fallback: InputMapping,
): InputMapping {
  const out: InputMapping = {};
  // Kits stored by older builds have no `controls`; treat that as none learned.
  const controls: Kit['controls'] = kit.controls ?? {};

  for (const { id } of VOICES) {
    const learned = kit.pieces
      .filter((p) => p.voices.includes(id))
      .flatMap((p) => controls[p.id] ?? []);

    out[id] = learned.length > 0 ? [...new Set(learned)] : fallback[id] ?? [];
  }

  return out;
}

/**
 * The piece that should light up and receive a note for each voice: the first
 * piece whose primary voice it is, otherwise the first that plays it at all.
 */
export function pieceByVoice(kit: Kit): Map<Voice, KitPiece> {
  const map = new Map<Voice, KitPiece>();

  for (const { id } of VOICES) {
    const piece =
      kit.pieces.find((p) => p.voices[0] === id) ??
      kit.pieces.find((p) => p.voices.includes(id));

    if (piece) {
      map.set(id, piece);
    }
  }

  return map;
}

/** Which piece a control belongs to: learned controls first, then the voice mapping. */
export function pieceForControl(
  kit: Kit,
  controlId: string,
  mapping: InputMapping,
): KitPiece | undefined {
  const learned = kit.pieces.find((p) =>
    (kit.controls[p.id] ?? []).includes(controlId),
  );

  if (learned) {
    return learned;
  }

  const voice = VOICES.find((v) => mapping[v.id]?.includes(controlId))?.id;

  return voice ? pieceByVoice(kit).get(voice) : undefined;
}

/** Controls that trigger a piece: its learned ones, or the voice mapping's. */
export function controlsForPiece(
  kit: Kit,
  piece: KitPiece,
  mapping: InputMapping,
): string[] {
  const learned = kit.controls[piece.id] ?? [];

  if (learned.length > 0) {
    return learned;
  }

  return [...new Set(piece.voices.flatMap((v) => mapping[v] ?? []))];
}

/** Assigns a control to one piece, taking it off any other piece. */
export function assignControlToPiece(
  kit: Kit,
  pieceId: string,
  controlId: string,
): { kit: Kit; movedFrom?: KitPiece } {
  let movedFrom: KitPiece | undefined;
  const controls: Record<string, string[]> = {};

  for (const p of kit.pieces) {
    const list = kit.controls[p.id] ?? [];

    if (p.id !== pieceId && list.includes(controlId)) {
      movedFrom = p;
    }

    controls[p.id] =
      p.id === pieceId
        ? [...new Set([...list, controlId])]
        : list.filter((c) => c !== controlId);
  }

  return { kit: { ...kit, controls }, movedFrom };
}

export function removeControlFromPiece(
  kit: Kit,
  pieceId: string,
  controlId: string,
): Kit {
  return {
    ...kit,
    controls: {
      ...kit.controls,
      [pieceId]: (kit.controls[pieceId] ?? []).filter((c) => c !== controlId),
    },
  };
}
