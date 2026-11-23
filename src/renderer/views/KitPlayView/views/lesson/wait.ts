import { TimelineNote, Voice } from '../../../../kit';

/**
 * Wait mode ("Wait for me") as a state machine. The song holds on a note the
 * player is late for (beyond a grace) until it is hit; with run-ups on, once
 * it is hit the song seeks back to the beat before it so the note is played
 * again, in time. These functions are pure: they take the current state and
 * an event, and return the next state plus what the view must do to the
 * engine (hold, release, seek). The view owns the engine and the clock.
 */

/** How far before the lesson window a run-up may start (into the bar before), s. */
export const RUN_UP_REACH_SECONDS = 2;

/** A run-up shorter than this isn't one; the song just carries on, s. */
export const MIN_RUN_UP_SECONDS = 0.2;

/**
 * Run-ups into one note per pass. Still late after that, the song just carries
 * on once you find it, rather than looping on a note you can't place yet.
 */
export const MAX_RUN_UPS = 2;

/**
 * How near a rewind must land to where a run-up seeked for it to be that
 * run-up, s. Anything else (a loop wrap, a restart) ends the pass.
 */
export const RUN_UP_REWIND_MATCH_SECONDS = 0.25;

export type WaitPhase =
  /** Playing normally. */
  | { kind: 'free' }
  /** The song is held for these notes; `since` is when (performance.now). */
  | { kind: 'holding'; since: number; ids: ReadonlySet<string> }
  /**
   * A run-up is leading back into these notes (whose voices the view shows)
   * until they are all hit, or the player is late again and it holds.
   */
  | { kind: 'runningUp'; ids: ReadonlySet<string>; voices: readonly Voice[] };

/** Wait mode's scoreboard (WaitStatsBar). */
export interface WaitStats {
  /** Times the song waited in this pass so far. */
  waits: number;
  /** Your notes in a row hit without the song waiting. */
  streak: number;
  best: number;
  /** Waits in the last finished pass. */
  lastWaits: number | undefined;
}

export const NO_WAIT_STATS: WaitStats = {
  waits: 0,
  streak: 0,
  best: 0,
  lastWaits: undefined,
};

export interface WaitState {
  phase: WaitPhase;
  /**
   * Where the last run-up seeked to, until the view sees the rewind it
   * causes. Kept apart from the phase: the seek may land after the phase has
   * moved on, and its rewind must still not count as the end of a pass.
   */
  rewindTo: number | undefined;
  /** Run-ups into each note this pass, by the id of the first held note. */
  tries: ReadonlyMap<string, number>;
  stats: WaitStats;
}

export const INITIAL_WAIT: WaitState = {
  phase: { kind: 'free' },
  rewindTo: undefined,
  tries: new Map(),
  stats: NO_WAIT_STATS,
};

/** What the view must do to the engine after a frame. */
export type WaitAction =
  | { kind: 'hold'; ticks: number[] }
  | { kind: 'release' }
  /** Run-up: seek the song back to `seconds`. */
  | { kind: 'seek'; seconds: number };

export interface WaitFrame {
  /** performance.now() at this frame. */
  at: number;
  /**
   * The notes the song is late for now (pace.dueNotes, given `heldIds`); []
   * when wait mode is off, in a listening step, or paused.
   */
  due: readonly TimelineNote[];
  /** Whether the engine is holding the song. */
  engineHeld: boolean;
  /** The player's notes in the window, in time order. */
  notes: readonly TimelineNote[];
  /** Whether a note was hit this pass. */
  isHit: (id: string) => boolean;
  /**
   * Where a run-up into a note at `time` starts (pace.runUpStart), or
   * undefined when run-ups are off.
   */
  runUpStart: ((time: number) => number) | undefined;
}

/** The notes the song is held for, to keep holding them however late. */
export function heldIds(state: WaitState): ReadonlySet<string> | undefined {
  return state.phase.kind === 'holding' ? state.phase.ids : undefined;
}

/** When the song started holding for `id`, or undefined if it isn't. */
export function holdStartFor(state: WaitState, id: string): number | undefined {
  const { phase } = state;

  return phase.kind === 'holding' && phase.ids.has(id)
    ? phase.since
    : undefined;
}

/**
 * One animation frame. Late notes due: hold for them (counting a wait when a
 * new hold starts, which also ends a run-up that was late again). None due
 * while the engine holds: the held notes were found, so run up to them, or
 * release when run-ups are off, used up for that note this pass, or have no
 * room (the very start of the song).
 */
export function waitFrame(
  state: WaitState,
  frame: WaitFrame,
): { state: WaitState; actions: WaitAction[] } {
  const { phase } = state;

  if (frame.due.length > 0) {
    const holding =
      phase.kind === 'holding'
        ? phase
        : { kind: 'holding' as const, since: frame.at, ids: new Set<string>() };
    const added = frame.due.some((n) => !holding.ids.has(n.id));
    const ids = added
      ? new Set([...holding.ids, ...frame.due.map((n) => n.id)])
      : holding.ids;
    const stats =
      phase.kind === 'holding'
        ? state.stats
        : { ...state.stats, waits: state.stats.waits + 1, streak: 0 };

    return {
      state: { ...state, phase: { ...holding, ids }, stats },
      actions: [{ kind: 'hold', ticks: frame.due.map((n) => n.tick) }],
    };
  }

  // Nothing due: whatever the song was holding for is no longer due.
  const free = phase.kind === 'holding' ? { kind: 'free' as const } : phase;

  if (!frame.engineHeld) {
    return { state: { ...state, phase: free }, actions: [] };
  }

  const ids = heldIds(state);
  const targets = ids ? frame.notes.filter((n) => ids.has(n.id)) : [];
  const found = targets.length > 0 && targets.every((n) => frame.isHit(n.id));

  if (!found) {
    return {
      state: { ...state, phase: free },
      actions: [{ kind: 'release' }],
    };
  }

  const first = Math.min(...targets.map((n) => n.time));
  const key = targets[0].id;
  const tries = state.tries.get(key) ?? 0;
  const from =
    frame.runUpStart && tries < MAX_RUN_UPS ? frame.runUpStart(first) : first;

  if (first - from < MIN_RUN_UP_SECONDS) {
    return {
      state: { ...state, phase: free },
      actions: [{ kind: 'release' }],
    };
  }

  return {
    state: {
      ...state,
      phase: {
        kind: 'runningUp',
        ids: new Set(targets.map((n) => n.id)),
        voices: targets.map((n) => n.voice),
      },
      rewindTo: from,
      tries: new Map(state.tries).set(key, tries + 1),
    },
    actions: [{ kind: 'seek', seconds: from }],
  };
}

/**
 * One of the player's notes was hit. A hit the song didn't wait for adds to
 * the streak (in wait mode, and not an early hit that belongs to the next
 * pass); a hit on the last note a run-up leads into ends the run-up.
 */
export function waitHit(
  state: WaitState,
  hit: { id: string; waitMode: boolean; nextPass: boolean },
): WaitState {
  const { phase } = state;
  const waitedFor = phase.kind === 'holding' && phase.ids.has(hit.id);
  let { stats } = state;

  if (hit.waitMode && !waitedFor && !hit.nextPass) {
    const streak = stats.streak + 1;

    stats = { ...stats, streak, best: Math.max(stats.best, streak) };
  }

  if (phase.kind !== 'runningUp' || !phase.ids.has(hit.id)) {
    return stats === state.stats ? state : { ...state, stats };
  }

  const ids = new Set(phase.ids);

  ids.delete(hit.id);

  return {
    ...state,
    stats,
    phase: ids.size > 0 ? { ...phase, ids } : { kind: 'free' },
  };
}

/** One of the player's notes went by unhit: the streak is over. */
export function waitMiss(state: WaitState): WaitState {
  return state.stats.streak === 0
    ? state
    : { ...state, stats: { ...state.stats, streak: 0 } };
}

export type WaitRewind =
  /** The run-up's own seek: the same pass, replayed from `from`. */
  | { kind: 'runUp'; from: number }
  /** A loop wrap, restart or seek: the pass is over. */
  | { kind: 'wrap' };

/** Song time jumped back to `now`: tell a run-up from the end of a pass. */
export function waitRewind(
  state: WaitState,
  now: number,
): { state: WaitState; rewind: WaitRewind } {
  const to = state.rewindTo;
  const next = to === undefined ? state : { ...state, rewindTo: undefined };

  if (to !== undefined && Math.abs(now - to) < RUN_UP_REWIND_MATCH_SECONDS) {
    return { state: next, rewind: { kind: 'runUp', from: to } };
  }

  return { state: next, rewind: { kind: 'wrap' } };
}

/**
 * A pass ended (after a wrap). Waits and run-up tries start again; `scored`
 * keeps this pass's waits as the one to beat (a full pass in wait mode).
 * A hold in progress is left to the next frame, which drops it once its notes
 * are no longer due.
 */
export function waitPassEnd(state: WaitState, scored: boolean): WaitState {
  const { stats, phase } = state;

  return {
    ...state,
    phase: phase.kind === 'runningUp' ? { kind: 'free' } : phase,
    tries: new Map(),
    stats: {
      ...stats,
      waits: 0,
      lastWaits: scored ? stats.waits : stats.lastWaits,
    },
  };
}
