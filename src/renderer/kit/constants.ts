import { Kit, PieceType, PieceTypeInfo, Voice, VoiceInfo } from './types';

export const VOICES: VoiceInfo[] = [
  { id: 'hihat', name: 'Hi-hat', cymbal: true, step: 9 },
  { id: 'crash', name: 'Crash', cymbal: true, step: 10 },
  { id: 'ride', name: 'Ride', cymbal: true, step: 8 },
  { id: 'snare', name: 'Snare', cymbal: false, step: 5 },
  { id: 'tom1', name: 'Tom 1', cymbal: false, step: 7 },
  { id: 'tom2', name: 'Tom 2', cymbal: false, step: 6 },
  { id: 'tom3', name: 'Tom 3', cymbal: false, step: 3 },
  { id: 'kick', name: 'Kick', cymbal: false, step: 1 },
];

export const VOICE_INFO = Object.fromEntries(
  VOICES.map((v) => [v.id, v]),
) as Record<Voice, VoiceInfo>;

/** Voices from the top staff line down, the order notes stack on the sheet. */
export const VOICES_BY_STAFF = [...VOICES].sort((a, b) => b.step - a.step);

/** VexFlow key prefix (pitch/octave) for each voice; kick has two. */
export const PREFIX_TO_VOICE: Record<string, Voice> = {
  'f/4': 'kick',
  'e/4': 'kick',
  'c/5': 'snare',
  'g/5': 'hihat',
  'f/5': 'ride',
  'a/5': 'crash',
  'e/5': 'tom1',
  'd/5': 'tom2',
  'a/4': 'tom3',
};

export const PIECE_TYPES: Record<PieceType, PieceTypeInfo> = {
  hihat: {
    label: 'Hi-hat',
    cymbal: true,
    pedal: false,
    size: 12,
    voices: ['hihat'],
  },
  crash: {
    label: 'Crash',
    cymbal: true,
    pedal: false,
    size: 14,
    voices: ['crash'],
  },
  ride: {
    label: 'Ride',
    cymbal: true,
    pedal: false,
    size: 18,
    voices: ['ride'],
  },
  splash: {
    label: 'Splash',
    cymbal: true,
    pedal: false,
    size: 8,
    voices: ['crash'],
  },
  china: {
    label: 'China',
    cymbal: true,
    pedal: false,
    size: 16,
    voices: ['crash'],
  },
  snare: {
    label: 'Snare',
    cymbal: false,
    pedal: false,
    size: 13,
    voices: ['snare'],
  },
  tom: {
    label: 'Rack tom',
    cymbal: false,
    pedal: false,
    size: 10,
    voices: ['tom1'],
  },
  floor: {
    label: 'Floor tom',
    cymbal: false,
    pedal: false,
    size: 14,
    voices: ['tom3'],
  },
  kick: {
    label: 'Kick',
    cymbal: false,
    pedal: false,
    size: 20,
    voices: ['kick'],
  },
  hhpedal: {
    label: 'Hi-hat pedal',
    cymbal: false,
    pedal: true,
    size: 0,
    voices: [],
  },
};

export const PIECE_TYPE_ORDER = Object.keys(PIECE_TYPES) as PieceType[];

/** Common General MIDI drum notes, for labeling learned pads. */
export const MIDI_ZONES: Record<number, string> = {
  36: 'beater',
  37: 'x-stick',
  38: 'head',
  40: 'rim',
  41: 'head',
  42: 'closed',
  43: 'head',
  44: 'pedal',
  45: 'head',
  46: 'open',
  47: 'rim',
  48: 'head',
  49: 'bow',
  50: 'rim',
  51: 'bow',
  52: 'bow',
  53: 'bell',
  55: 'bow',
  57: 'bow',
  58: 'rim',
  59: 'edge',
};

export const PIECE_PALETTE = [
  '#5b7fd1',
  '#a58cf5',
  '#e8823f',
  '#d0cdc6',
  '#6fb4d6',
  '#4fa15e',
  '#b08a7a',
  '#5fb39a',
  '#c9a54a',
  '#d96b8a',
  '#7fb069',
  '#8fa3ff',
];

/** Kit coordinate space. */
export const KIT_WIDTH = 100;

export const KIT_HEIGHT = 104;

export const KIT_VIEWBOX = `0 0 ${KIT_WIDTH} ${KIT_HEIGHT}`;

/** Grid step used for snapping and tidy. */
export const KIT_GRID = 2.5;

export const DEFAULT_KITS: Kit[] = [
  {
    id: 'ekit',
    name: 'Donner mesh e-kit',
    kind: 'electronic',
    pieces: [
      {
        id: 'hh',
        type: 'hihat',
        name: 'Hi-hat',
        size: 12,
        x: 20,
        y: 38,
        voices: ['hihat'],
        color: '#5fb39a',
      },
      {
        id: 'cr1',
        type: 'crash',
        name: 'Crash',
        size: 12,
        x: 40,
        y: 15,
        voices: ['crash'],
        color: '#6fb4d6',
      },
      {
        id: 'cr2',
        type: 'crash',
        name: 'Crash 2',
        size: 12,
        x: 70,
        y: 17,
        voices: ['crash'],
        color: '#c9a54a',
      },
      {
        id: 'rd',
        type: 'ride',
        name: 'Ride',
        size: 13,
        x: 87,
        y: 44,
        voices: ['ride'],
        color: '#d0cdc6',
      },
      {
        id: 'sn',
        type: 'snare',
        name: 'Snare',
        size: 10,
        x: 36,
        y: 60,
        voices: ['snare'],
        color: '#5b7fd1',
      },
      {
        id: 't1',
        type: 'tom',
        name: 'Tom 1',
        size: 8,
        x: 46,
        y: 37,
        voices: ['tom1'],
        color: '#b08a7a',
      },
      {
        id: 't2',
        type: 'tom',
        name: 'Tom 2',
        size: 8,
        x: 61,
        y: 37,
        voices: ['tom2'],
        color: '#4fa15e',
      },
      {
        id: 'ft',
        type: 'floor',
        name: 'Floor tom',
        size: 10,
        x: 64,
        y: 60,
        voices: ['tom3'],
        color: '#e8823f',
      },
      {
        id: 'kk',
        type: 'kick',
        name: 'Kick',
        size: 7,
        x: 50,
        y: 66,
        voices: ['kick'],
        color: '#a58cf5',
      },
      {
        id: 'hp',
        type: 'hhpedal',
        name: 'Hi-hat pedal',
        size: 0,
        x: 27,
        y: 80,
        voices: [],
        color: '#7fb069',
      },
    ],
    controls: {},
  },
  {
    id: 'junior',
    name: 'Donner junior kit',
    kind: 'acoustic',
    pieces: [
      {
        id: 'hh',
        type: 'hihat',
        name: 'Hi-hat',
        size: 10,
        x: 20,
        y: 38,
        voices: ['hihat'],
        color: '#5fb39a',
      },
      {
        id: 'cy',
        type: 'crash',
        name: 'Crash / ride',
        size: 10,
        x: 52,
        y: 11,
        voices: ['crash', 'ride'],
        color: '#6fb4d6',
      },
      {
        id: 't1',
        type: 'tom',
        name: 'Tom 1',
        size: 8,
        x: 37,
        y: 25,
        voices: ['tom1'],
        color: '#b08a7a',
      },
      {
        id: 't2',
        type: 'tom',
        name: 'Tom 2',
        size: 10,
        x: 66,
        y: 27,
        voices: ['tom2'],
        color: '#4fa15e',
      },
      {
        id: 'kk',
        type: 'kick',
        name: 'Kick',
        size: 16,
        x: 50,
        y: 44,
        voices: ['kick'],
        color: '#a58cf5',
      },
      {
        id: 'sn',
        type: 'snare',
        name: 'Snare',
        size: 12,
        x: 24,
        y: 62,
        voices: ['snare'],
        color: '#5b7fd1',
      },
      {
        id: 'ft',
        type: 'floor',
        name: 'Floor tom',
        size: 12,
        x: 78,
        y: 60,
        voices: ['tom3'],
        color: '#e8823f',
      },
      {
        id: 'hp',
        type: 'hhpedal',
        name: 'Hi-hat pedal',
        size: 0,
        x: 37,
        y: 74,
        voices: [],
        color: '#7fb069',
      },
    ],
    controls: {},
  },
];
