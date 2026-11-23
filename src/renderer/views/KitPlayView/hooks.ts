import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { inputBus } from '../../input';
import {
  firstNoteAtOrAfter,
  KitPiece,
  pieceForControl,
  TimelineNote,
} from '../../kit';
import { JudgedHit } from '../../services/engine';
import { PlaySession } from './session';

/**
 * A ref that animation-frame and input callbacks read, kept equal to a piece
 * of React state by being its only writer: the returned setter writes the ref
 * first, then the state. Use it instead of setting a ref and its state in
 * pairs, which drift apart as soon as one call site forgets the other.
 */
export function useMirror<T>(
  value: T,
  setValue: (next: T) => void,
): readonly [RefObject<T>, (next: T) => void] {
  const ref = useRef(value);
  const set = useCallback(
    (next: T) => {
      ref.current = next;
      setValue(next);
    },
    [setValue],
  );

  return [ref, set];
}

/** A short status message over a play view; `ok` colors it green. */
export interface Toast {
  /** Changes with every new message, so the same text shows again. */
  id: number;
  message: string;
  ok: boolean;
}

/**
 * The toast on screen and a function that shows a new one, replacing the
 * last, for `durationMs`. The timer is cleared on unmount.
 */
export function useToast(
  durationMs: number,
): readonly [Toast | undefined, (message: string, ok: boolean) => void] {
  const [toast, setToast] = useState<Toast | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback(
    (message: string, ok: boolean) => {
      clearTimeout(timer.current);
      setToast({ id: Date.now(), message, ok });
      timer.current = setTimeout(() => setToast(undefined), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return [toast, show];
}

/** Runs `callback(now)` every animation frame with the current audio time. */
export function useAnimationFrame(
  session: Pick<PlaySession, 'timeStore'>,
  callback: (now: number) => void,
): void {
  const ref = useRef(callback);

  useEffect(() => {
    ref.current = callback;
  }, [callback]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ref.current(session.timeStore.get());
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [session.timeStore]);
}

/**
 * Every pad strike (mapped or not, judged or not) with the piece it belongs
 * to. Use for lighting pads; use `useNoteJudgments` for scoring.
 */
export function usePadStrikes(
  session: Pick<PlaySession, 'kit' | 'mapping'>,
  callback: (
    piece: KitPiece | undefined,
    controlId: string,
    value: number,
  ) => void,
): void {
  const ref = useRef(callback);
  const sessionRef = useRef(session);

  useEffect(() => {
    ref.current = callback;
    sessionRef.current = session;
  });

  useEffect(
    () =>
      inputBus.subscribe(({ controlId, value }) => {
        if (value === 0) {
          return;
        }

        const { kit, mapping } = sessionRef.current;

        ref.current(pieceForControl(kit, controlId, mapping), controlId, value);
      }),
    [],
  );
}

export interface NoteJudgmentHandlers {
  /** A note was hit; `offsetSeconds` < 0 is early. */
  onHit?: (note: TimelineNote, offsetSeconds: number) => void;
  /** A note's hit window closed with no hit. */
  onMiss?: (note: TimelineNote) => void;
  /** Time jumped backwards (seek, restart, loop wrap): forget statuses from `time` on. */
  onRewind?: (time: number) => void;
}

/**
 * Per-note hit / miss events on top of the engine's judge. Misses are emitted
 * once the hit window has passed; a backwards time jump rewinds statuses.
 */
export function useNoteJudgments(
  session: PlaySession,
  handlers: NoteJudgmentHandlers,
): void {
  const ref = useRef(handlers);
  const statusRef = useRef(new Map<string, 'hit' | 'miss'>());
  const cursorRef = useRef(0);
  const lastTimeRef = useRef(-Infinity);
  const byKey = useRef(new Map<string, TimelineNote>());

  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    byKey.current = new Map(session.notes.map((n) => [n.id, n]));
    statusRef.current.clear();
    cursorRef.current = 0;
    lastTimeRef.current = -Infinity;
  }, [session.notes]);

  useEffect(
    () =>
      session.engine.onJudged((hit: JudgedHit) => {
        for (const prefix of hit.prefixes) {
          const note = byKey.current.get(`${hit.tick}:${prefix}`);

          if (note && statusRef.current.get(note.id) !== 'hit') {
            statusRef.current.set(note.id, 'hit');
            ref.current.onHit?.(note, hit.offsetSeconds);
          }
        }
      }),
    [session.engine],
  );

  useAnimationFrame(session, (now) => {
    const { notes, engine } = session;
    const status = statusRef.current;

    if (now < lastTimeRef.current - 0.05) {
      for (const [id] of status) {
        const note = byKey.current.get(id);

        if (note && note.time >= now - engine.hitTolerance) {
          status.delete(id);
        }
      }

      cursorRef.current = firstNoteAtOrAfter(notes, now - engine.hitTolerance);
      ref.current.onRewind?.(now);
    } else if (now > lastTimeRef.current + 0.5) {
      // Jumped forward (seek / play from a bar): skip without counting misses.
      cursorRef.current = firstNoteAtOrAfter(notes, now - engine.hitTolerance);
    }

    lastTimeRef.current = now;

    if (!session.isPlaying) {
      return;
    }

    const closed = now - engine.hitTolerance;

    while (
      cursorRef.current < notes.length &&
      notes[cursorRef.current].time < closed
    ) {
      const note = notes[cursorRef.current];

      cursorRef.current += 1;

      if (status.has(note.id)) {
        continue;
      }

      if (engine.isHit(note.tick, note.prefix)) {
        status.set(note.id, 'hit');

        continue;
      }

      status.set(note.id, 'miss');
      ref.current.onMiss?.(note);
    }
  });
}
