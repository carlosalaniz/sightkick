/**
 * Pass and star limits of the kit play views, side by side so a change to
 * one view's grading is a visible decision about the others.
 *
 * The views grade differently on purpose (a lesson, a sight-reading loop and
 * an arcade game), so each view keeps its own named limits even where the
 * values match today. Changing any of them changes grading: ask first
 * (AGENTS.md).
 *
 * Known difference, not yet decided by the owner: the unit of a hit's
 * timing offset.
 * - Sheet lanes divides the judge's offset by the playback speed and grades
 *   real (wall-clock) ms, so its tiers are as strict at 70% speed as at 100%.
 * - The lesson and the arcade views grade the judge's offset as is, in song
 *   time, so a slowed-down song is graded more leniently in real time.
 * The tier tables themselves live with each view's scoring
 * (`lesson/machine.ts`, `sheetLanes/scoring.ts`, `arcade/scoring.ts`).
 */

/** Lesson: accuracy a pass needs to count as clean. */
export const LESSON_CLEAN_ACCURACY = 0.85;

/** Lesson: below this a pass is rough; two in a row and the lesson eases off. */
export const LESSON_ROUGH_ACCURACY = 0.6;

/** Lesson: timing tier edges in song-time ms (on time, close; else off). */
export const LESSON_TIER_MS = [35, 70] as const;

/** Lesson: accuracy credit of an on-time, close and off hit. */
export const LESSON_TIER_WEIGHT = [1, 0.7, 0.4] as const;

/** Sheet lanes: accuracy a pass needs to count as clean. */
export const SHEET_LANES_CLEAN_ACCURACY = 0.85;

/** Sheet lanes: misses a clean pass may have, whatever the loop's length. */
export const SHEET_LANES_CLEAN_MAX_MISSES = 1;

/** Sheet lanes: a pass under this accuracy is a clear fail (rough). */
export const SHEET_LANES_ROUGH_ACCURACY = 0.6;

/** Sheet lanes: accuracy for 1, 2 and 3 stars. */
export const SHEET_LANES_STAR_ACCURACY = [0.7, 0.85, 0.95] as const;

/** Arcade views: a loop pass at or above this accuracy gets a green toast. */
export const ARCADE_LOOP_PASS_ACCURACY = 0.85;

/** Arcade views: accuracy for 1 to 5 stars on the results card. */
export const ARCADE_STAR_ACCURACY = [0.5, 0.65, 0.8, 0.9, 0.95] as const;

/** Stars earned: how many of the ascending `limits` the accuracy reaches. */
export function starsFromAccuracy(
  accuracy: number,
  limits: readonly number[],
): number {
  return limits.filter((limit) => accuracy >= limit).length;
}

/** `0.85` → `85%`, for text that quotes a limit. */
export function limitPercent(limit: number): string {
  return `${Math.round(limit * 100)}%`;
}
