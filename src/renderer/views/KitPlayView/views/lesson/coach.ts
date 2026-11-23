import { Voice } from '../../../../kit';
import { PassResult } from './machine';

/** Hits kept per voice for timing habits. */
export const HISTORY = 24;

/** A habit needs this many hits before the coach mentions it. */
export const MIN_SAMPLES = 8;

/** Mean offsets under this (ms) are normal and not worth a tip. */
export const STEADY_MS = 20;

export type TimingHistory = Map<Voice, number[]>;

export function recordOffset(
  history: TimingHistory,
  voice: Voice,
  offsetMs: number,
): void {
  const list = history.get(voice) ?? [];

  list.push(offsetMs);

  if (list.length > HISTORY) {
    list.shift();
  }

  history.set(voice, list);
}

export type CoachTip =
  | { kind: 'bar'; bar: number }
  | { kind: 'timing'; voice: Voice; ms: number; early: boolean }
  | { kind: 'steady' };

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/**
 * One tip at most, after a pass: where misses bunch up, else the steadiest
 * early / late habit on one pad, else reassurance.
 */
export function coachTip(
  result: Pick<PassResult, 'missed' | 'allowed' | 'missedByBar'>,
  history: TimingHistory,
): CoachTip {
  if (result.missed > result.allowed) {
    const worst = Math.max(...result.missedByBar);

    return { kind: 'bar', bar: result.missedByBar.indexOf(worst) };
  }

  let pick: { voice: Voice; m: number } | undefined;

  for (const [voice, list] of history) {
    if (list.length < MIN_SAMPLES) {
      continue;
    }

    const m = mean(list);

    if (!pick || Math.abs(m) > Math.abs(pick.m)) {
      pick = { voice, m };
    }
  }

  if (pick && Math.abs(pick.m) > STEADY_MS) {
    return {
      kind: 'timing',
      voice: pick.voice,
      ms: Math.round(Math.abs(pick.m)),
      early: pick.m < 0,
    };
  }

  return { kind: 'steady' };
}
