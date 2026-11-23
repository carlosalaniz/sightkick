/** SVG geometry of the staff, in viewBox units (the mock's 1200-wide staff). */

export const VIEW_W = 1200;

/** Playhead x in scroll mode. */
export const PLAYHEAD_X = 240;

/** Left edge of the first bar in page mode. */
export const PAGE_X = 170;

/** Width of the pad-label column on the left. */
export const LABEL_W = 150;

export const INK = '#1c1a14';

export const PLAYHEAD_COLOR = '#c4402a';

export type Motion = 'scroll' | 'page';

export const LOOK_AHEAD_OPTIONS = [1, 2, 3];

export const GEMS_AHEAD_OPTIONS = [500, 800, 1200, 2000];

export interface StaffGeometry {
  /** Half-space between staff steps (lane height). */
  sp: number;
  /** y of the middle line (step 4). */
  cy: number;
  height: number;
  /** Top of the up-stems. */
  top: number;
  /** Bottom of the kick stems. */
  bottom: number;
}

export function staffGeometry(sp: number): StaffGeometry {
  const cy = 80 + 6 * sp;

  return {
    sp,
    cy,
    height: cy + 4 * sp + 100,
    top: cy - 6 * sp - 42,
    bottom: cy + 4 * sp + 48,
  };
}

export function stepY(geo: StaffGeometry, step: number): number {
  return geo.cy - (step - 4) * geo.sp;
}

/** Staff line steps, top to bottom. */
export const LINE_STEPS = [8, 6, 4, 2, 0];

/**
 * Pixels per beat: scroll shows `look` bars ahead of the playhead, page shows
 * the current bar plus `look` more.
 */
export function pixelsPerBeat(motion: Motion, look: number): number {
  return motion === 'scroll'
    ? (VIEW_W - PLAYHEAD_X) / (look * 4 + 0.6)
    : (VIEW_W - PAGE_X) / ((look + 1) * 4);
}

export interface StripPosition {
  /** x translation of the note strip. */
  tx: number;
  playheadX: number;
  playheadVisible: boolean;
}

/**
 * Where the strip and playhead go for beat position `beat`. In page mode the
 * strip jumps a bar at a time (`pageStart` is the current bar's downbeat) and
 * the playhead travels across it.
 */
export function stripPosition(
  motion: Motion,
  beat: number,
  pageStart: number,
  ppb: number,
): StripPosition {
  if (motion === 'scroll') {
    return {
      tx: PLAYHEAD_X - beat * ppb,
      playheadX: PLAYHEAD_X,
      playheadVisible: true,
    };
  }

  const start = Math.max(0, pageStart);

  return {
    tx: PAGE_X - start * ppb,
    playheadX: PAGE_X + (beat - start) * ppb,
    playheadVisible: beat >= 0,
  };
}
