import { InputMapping } from '../../types';

/** One of the 8 drum voices a chart can contain. */
export type Voice = keyof InputMapping;

export type PieceType =
  | 'hihat'
  | 'crash'
  | 'ride'
  | 'splash'
  | 'china'
  | 'snare'
  | 'tom'
  | 'floor'
  | 'kick'
  | 'hhpedal';

export type KitKind = 'electronic' | 'acoustic';

export interface KitPiece {
  id: string;
  type: PieceType;
  name: string;
  /** Diameter in inches. */
  size: number;
  /** Top-down position in kit units (0–100 wide, 0–104 tall, throne at the bottom). */
  x: number;
  y: number;
  /** Chart voices this piece plays. A piece can play several; several pieces can share one. */
  voices: Voice[];
  color: string;
}

export interface Kit {
  id: string;
  name: string;
  kind: KitKind;
  pieces: KitPiece[];
  /** Learned input controls (e.g. `midi:38`, `keyboard:KeyJ`) per piece id. */
  controls: Record<string, string[]>;
}

export interface VoiceInfo {
  id: Voice;
  name: string;
  cymbal: boolean;
  /** Staff position in half-steps above the bottom line's neighbor (kick = 1, crash = 10). */
  step: number;
}

export interface PieceTypeInfo {
  label: string;
  cymbal: boolean;
  pedal: boolean;
  size: number;
  voices: Voice[];
}

export type PiecePositions = Record<string, { x: number; y: number }>;
