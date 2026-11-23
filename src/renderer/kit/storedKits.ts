import { log } from '../../shared/log';
import { PIECE_TYPES, VOICES } from './constants';
import { Kit, KitKind, KitPiece, PieceType, Voice } from './types';

/** What `settings.kits` holds: the user's kits and the one in use. */
export interface KitState {
  kits: Kit[];
  currentId: string;
}

type Fields = Record<string, unknown>;

const isObject = (raw: unknown): raw is Fields =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isFiniteNumber = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isFinite(raw);
const isPieceType = (raw: unknown): raw is PieceType =>
  typeof raw === 'string' && Object.hasOwn(PIECE_TYPES, raw);
const isVoice = (raw: unknown): raw is Voice =>
  VOICES.some((v) => v.id === raw);
const KIT_KINDS: Record<KitKind, true> = { electronic: true, acoustic: true };
const isKitKind = (raw: unknown): raw is KitKind =>
  typeof raw === 'string' && Object.hasOwn(KIT_KINDS, raw);

function parsePiece(raw: unknown): KitPiece | undefined {
  if (
    !isObject(raw) ||
    typeof raw.id !== 'string' ||
    !isPieceType(raw.type) ||
    typeof raw.name !== 'string' ||
    !isFiniteNumber(raw.size) ||
    !isFiniteNumber(raw.x) ||
    !isFiniteNumber(raw.y) ||
    !Array.isArray(raw.voices) ||
    typeof raw.color !== 'string'
  ) {
    return undefined;
  }

  return {
    id: raw.id,
    type: raw.type,
    name: raw.name,
    size: raw.size,
    x: raw.x,
    y: raw.y,
    voices: raw.voices.filter(isVoice),
    color: raw.color,
  };
}

/** Learned controls per piece id; anything that isn't a list of strings is dropped. */
function parseControls(raw: unknown): Record<string, string[]> {
  if (!isObject(raw)) {
    return {};
  }

  const out: Record<string, string[]> = {};

  for (const [pieceId, list] of Object.entries(raw)) {
    if (Array.isArray(list)) {
      out[pieceId] = list.filter((c): c is string => typeof c === 'string');
    }
  }

  return out;
}

/**
 * One stored kit, or undefined without an id. Repairs what has a safe
 * default: missing `controls` (older builds) become none learned, an
 * unknown kind becomes electronic, and pieces that can't be drawn are
 * dropped with a warning.
 */
export function parseKit(raw: unknown): Kit | undefined {
  if (!isObject(raw) || typeof raw.id !== 'string') {
    return undefined;
  }

  const rawPieces = Array.isArray(raw.pieces) ? raw.pieces : [];
  const pieces = rawPieces.flatMap((p) => {
    const piece = parsePiece(p);

    return piece ? [piece] : [];
  });

  if (pieces.length < rawPieces.length) {
    log.warn('kit.stored_pieces_dropped', {
      kitId: raw.id,
      dropped: rawPieces.length - pieces.length,
    });
  }

  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : 'Kit',
    kind: isKitKind(raw.kind) ? raw.kind : 'electronic',
    pieces,
    controls: parseControls(raw.controls),
  };
}

/**
 * Parses `settings.kits`. Undefined when the value isn't a kit state at all
 * (the caller falls back to the default kits); otherwise the kits that
 * parse, which may be none (the provider already falls back on an empty
 * list).
 */
export function parseKitState(raw: unknown): KitState | undefined {
  if (!isObject(raw) || !Array.isArray(raw.kits)) {
    return undefined;
  }

  const kits = raw.kits.flatMap((k) => {
    const kit = parseKit(k);

    return kit ? [kit] : [];
  });

  if (kits.length < raw.kits.length) {
    log.warn('kit.stored_kits_dropped', {
      dropped: raw.kits.length - kits.length,
    });
  }

  return {
    kits,
    currentId:
      typeof raw.currentId === 'string' ? raw.currentId : kits[0]?.id ?? '',
  };
}
