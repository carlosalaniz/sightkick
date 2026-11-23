import { assertNever } from '../../../../../shared/assertNever';

/** The highest score multiplier any play view gives. */
export const MAX_MULTIPLIER = 4;

/** Hits in a row per multiplier step. */
export const HITS_PER_MULTIPLIER_STEP = 10;

/**
 * How a streak turns into a score multiplier.
 * - `steps`: +1 every 10 hits in a row, halved by a miss (arcade, sheet lanes).
 * - `streak`: 1 + streak / 10, back to 1 on a miss (Play).
 */
export type MultiplierRule = 'steps' | 'streak';

/** The multiplier after a hit that made the streak `streak` long. */
export function multiplierAfterHit(
  rule: MultiplierRule,
  mult: number,
  streak: number,
): number {
  switch (rule) {
    case 'steps':
      return streak % HITS_PER_MULTIPLIER_STEP === 0
        ? Math.min(MAX_MULTIPLIER, mult + 1)
        : mult;

    case 'streak':
      return streakMultiplier(streak);

    default:
      return assertNever(rule, 'multiplier rule');
  }
}

/** The multiplier after a miss. */
export function multiplierAfterMiss(
  rule: MultiplierRule,
  mult: number,
): number {
  switch (rule) {
    case 'steps':
      return Math.max(1, Math.floor(mult / 2));

    case 'streak':
      return 1;

    default:
      return assertNever(rule, 'multiplier rule');
  }
}

/** The `streak` rule's multiplier for a run of `streak` hits. */
function streakMultiplier(streak: number): number {
  return Math.min(
    MAX_MULTIPLIER,
    1 + Math.floor(streak / HITS_PER_MULTIPLIER_STEP),
  );
}
