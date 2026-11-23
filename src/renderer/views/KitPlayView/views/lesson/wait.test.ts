import { describe, expect, it } from 'vitest';
import { TimelineNote } from '../../../../kit';
import { makeNote } from './fixtures';
import {
  heldIds,
  holdStartFor,
  INITIAL_WAIT,
  MAX_RUN_UPS,
  RUN_UP_REWIND_MATCH_SECONDS,
  WaitFrame,
  waitFrame,
  waitHit,
  waitMiss,
  waitPassEnd,
  waitRewind,
  WaitState,
} from './wait';

// A hi-hat + kick chord on beat 3 of bar 0 (1 s), and the hi-hat after it.
const hat = makeNote(0, 2, 'hihat');
const kick = makeNote(0, 2, 'kick');
const nextHat = makeNote(0, 2.5, 'hihat');
const notes = [hat, kick, nextHat];
const RUN_UP_FROM = 0.5;

function frame(
  over: Partial<WaitFrame> & { hits?: TimelineNote[] } = {},
): WaitFrame {
  const hits = new Set((over.hits ?? []).map((n) => n.id));

  return {
    at: 1000,
    due: [],
    engineHeld: false,
    notes,
    isHit: (id) => hits.has(id),
    runUpStart: () => RUN_UP_FROM,
    ...over,
  };
}

/** Late on the chord: the song holds for it. */
const holding = (state: WaitState = INITIAL_WAIT) =>
  waitFrame(state, frame({ due: [hat, kick], at: 1000 })).state;
/** Held, then the chord is hit: the next frame decides what happens. */
const found = (state: WaitState, over: Partial<WaitFrame> = {}) =>
  waitFrame(state, frame({ engineHeld: true, hits: [hat, kick], ...over }));

describe('wait mode', () => {
  describe('holding', () => {
    it('holds on late notes and counts a wait', () => {
      const r = waitFrame(INITIAL_WAIT, frame({ due: [hat, kick], at: 1234 }));

      expect(r.actions).toEqual([
        { kind: 'hold', ticks: [hat.tick, kick.tick] },
      ]);
      expect(r.state.phase).toMatchObject({ kind: 'holding', since: 1234 });
      expect(heldIds(r.state)).toEqual(new Set([hat.id, kick.id]));
      expect(holdStartFor(r.state, hat.id)).toBe(1234);
      expect(holdStartFor(r.state, nextHat.id)).toBeUndefined();
      expect(r.state.stats).toMatchObject({ waits: 1, streak: 0 });
    });

    it('keeps one hold, and one wait, across frames, adding notes as they come due', () => {
      const first = waitFrame(INITIAL_WAIT, frame({ due: [hat], at: 1000 }));
      const second = waitFrame(first.state, frame({ due: [kick], at: 1016 }));

      expect(second.actions).toEqual([{ kind: 'hold', ticks: [kick.tick] }]);
      expect(second.state.phase).toMatchObject({
        kind: 'holding',
        since: 1000,
      });
      expect(heldIds(second.state)).toEqual(new Set([hat.id, kick.id]));
      expect(second.state.stats.waits).toBe(1);
    });

    it('breaks the streak when it starts holding', () => {
      const streaking = waitHit(INITIAL_WAIT, {
        id: nextHat.id,
        waitMode: true,
        nextPass: false,
      });

      expect(streaking.stats.streak).toBe(1);
      expect(holding(streaking).stats).toMatchObject({ streak: 0, best: 1 });
    });

    it('drops a hold the engine is not holding, with nothing to do', () => {
      const r = waitFrame(holding(), frame({ engineHeld: false }));

      expect(r.actions).toEqual([]);
      expect(r.state.phase).toEqual({ kind: 'free' });
    });

    it('releases when the engine holds but the held notes are not all hit', () => {
      const r = waitFrame(holding(), frame({ engineHeld: true, hits: [hat] }));

      expect(r.actions).toEqual([{ kind: 'release' }]);
      expect(r.state.phase).toEqual({ kind: 'free' });
    });

    it('releases an engine hold it did not start', () => {
      const r = waitFrame(INITIAL_WAIT, frame({ engineHeld: true }));

      expect(r.actions).toEqual([{ kind: 'release' }]);
      expect(r.state.phase).toEqual({ kind: 'free' });
    });
  });

  describe('run-up', () => {
    it('releases once the notes are hit when run-ups are off', () => {
      const r = found(holding(), { runUpStart: undefined });

      expect(r.actions).toEqual([{ kind: 'release' }]);
      expect(r.state.phase).toEqual({ kind: 'free' });
      expect(r.state.rewindTo).toBeUndefined();
    });

    it('seeks back to the run-up start once the notes are hit', () => {
      const r = found(holding());

      expect(r.actions).toEqual([{ kind: 'seek', seconds: RUN_UP_FROM }]);
      expect(r.state.phase).toEqual({
        kind: 'runningUp',
        ids: new Set([hat.id, kick.id]),
        voices: ['hihat', 'kick'],
      });
      expect(r.state.rewindTo).toBe(RUN_UP_FROM);
      expect(r.state.tries.get(hat.id)).toBe(1);
    });

    it('just releases when there is no room for a run-up', () => {
      const r = found(holding(), { runUpStart: (t) => t - 0.1 });

      expect(r.actions).toEqual([{ kind: 'release' }]);
      expect(r.state.phase).toEqual({ kind: 'free' });
      expect(r.state.tries.size).toBe(0);
    });

    it(`runs up into a note at most ${MAX_RUN_UPS} times a pass, then releases`, () => {
      let state = INITIAL_WAIT;
      const seeks: number[] = [];

      for (let i = 0; i < MAX_RUN_UPS + 1; i += 1) {
        const r = found(holding(state));

        state = r.state;
        r.actions.forEach((a) => {
          if (a.kind === 'seek') {
            seeks.push(a.seconds);
          }
        });

        if (i === MAX_RUN_UPS) {
          expect(r.actions).toEqual([{ kind: 'release' }]);
        }
      }

      expect(seeks).toHaveLength(MAX_RUN_UPS);
      expect(state.stats.waits).toBe(MAX_RUN_UPS + 1);

      // A new pass gets new run-ups.
      const again = found(holding(waitPassEnd(state, true)));

      expect(again.actions).toEqual([{ kind: 'seek', seconds: RUN_UP_FROM }]);
    });

    it('goes back to holding when the player is late again in the run-up', () => {
      const running = found(holding()).state;
      const r = waitFrame(running, frame({ due: [hat, kick], at: 2000 }));

      expect(r.state.phase).toMatchObject({ kind: 'holding', since: 2000 });
      expect(r.state.stats.waits).toBe(2);
      expect(r.actions).toEqual([
        { kind: 'hold', ticks: [hat.tick, kick.tick] },
      ]);
    });

    it('ends once every note it leads into is hit in time', () => {
      const running = found(holding()).state;
      const half = waitHit(running, {
        id: hat.id,
        waitMode: true,
        nextPass: false,
      });

      expect(half.phase).toMatchObject({
        kind: 'runningUp',
        ids: new Set([kick.id]),
      });

      const done = waitHit(half, {
        id: kick.id,
        waitMode: true,
        nextPass: false,
      });

      expect(done.phase).toEqual({ kind: 'free' });
      expect(done.stats.streak).toBe(2);
    });

    it('keeps the run-up through frames that hold nothing', () => {
      const running = found(holding()).state;

      expect(waitFrame(running, frame()).state.phase.kind).toBe('runningUp');
    });
  });

  describe('streak', () => {
    const hit = (state: WaitState, note: TimelineNote, over = {}) =>
      waitHit(state, {
        id: note.id,
        waitMode: true,
        nextPass: false,
        ...over,
      });

    it('counts notes hit without a wait and keeps the best', () => {
      const two = hit(hit(INITIAL_WAIT, hat), kick);

      expect(two.stats).toMatchObject({ streak: 2, best: 2 });

      const missed = waitMiss(two);

      expect(missed.stats).toMatchObject({ streak: 0, best: 2 });
      expect(hit(missed, nextHat).stats).toMatchObject({ streak: 1, best: 2 });
    });

    it('does not count a note the song waited for', () => {
      expect(hit(holding(), hat).stats.streak).toBe(0);
    });

    it('does not count an early hit that belongs to the next pass', () => {
      expect(hit(INITIAL_WAIT, hat, { nextPass: true }).stats.streak).toBe(0);
    });

    it('does not count with wait mode off', () => {
      expect(hit(INITIAL_WAIT, hat, { waitMode: false })).toBe(INITIAL_WAIT);
    });

    it('leaves the state alone on a miss with no streak', () => {
      expect(waitMiss(INITIAL_WAIT)).toBe(INITIAL_WAIT);
    });
  });

  describe('rewinds', () => {
    const running = () => found(holding()).state;

    it('takes a rewind to where the run-up seeked as the run-up, once', () => {
      const r = waitRewind(
        running(),
        RUN_UP_FROM + RUN_UP_REWIND_MATCH_SECONDS / 2,
      );

      expect(r.rewind).toEqual({ kind: 'runUp', from: RUN_UP_FROM });
      expect(r.state.rewindTo).toBeUndefined();
      expect(r.state.phase.kind).toBe('runningUp');
      expect(waitRewind(r.state, RUN_UP_FROM).rewind).toEqual({
        kind: 'wrap',
      });
    });

    it('takes a rewind elsewhere, even during a run-up, as the end of the pass', () => {
      const r = waitRewind(
        running(),
        RUN_UP_FROM + RUN_UP_REWIND_MATCH_SECONDS,
      );

      expect(r.rewind).toEqual({ kind: 'wrap' });
      expect(r.state.rewindTo).toBeUndefined();
    });

    it('takes any rewind as the end of the pass with no run-up pending', () => {
      expect(waitRewind(INITIAL_WAIT, 0)).toEqual({
        state: INITIAL_WAIT,
        rewind: { kind: 'wrap' },
      });
    });
  });

  describe('pass end', () => {
    it('keeps a scored pass’s waits to beat and starts counting again', () => {
      const running = found(holding()).state;
      const ended = waitPassEnd(running, true);

      expect(ended.stats).toMatchObject({ waits: 0, lastWaits: 1 });
      expect(ended.tries.size).toBe(0);
      expect(ended.phase).toEqual({ kind: 'free' });
    });

    it('keeps the last scored waits when the pass was not scored', () => {
      const scored = waitPassEnd(holding(), true);
      const restarted = waitPassEnd(holding(scored), false);

      expect(restarted.stats).toMatchObject({ waits: 0, lastWaits: 1 });
    });

    it('leaves a hold in progress to the next frame', () => {
      expect(waitPassEnd(holding(), false).phase.kind).toBe('holding');
    });
  });
});
