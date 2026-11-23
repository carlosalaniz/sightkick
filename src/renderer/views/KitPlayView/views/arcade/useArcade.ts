import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersisted } from '../../../../hooks/usePersisted';
import { firstNoteAtOrAfter, KitPiece, TimelineNote } from '../../../../kit';
import { useAnimationFrame, useNoteJudgments, useToast } from '../../hooks';
import { PlaySession } from '../../session';
import {
  beatSecondsAt,
  buildSections,
  hash01,
  lanePieces,
  padKeyLabel,
  skippedLine,
  skippedVoices,
} from './helpers';
import { ARCADE_LOOP_PASS_ACCURACY } from '../shared/judging';
import { JudgmentLog } from './log';
import { ArcadeResults, buildResults } from './results';
import {
  applyHit,
  applyMiss,
  gradeHit,
  formatOffset,
  formatPercent,
  HitContext,
  INITIAL_SCORE,
  replay,
  ScoreState,
  ScoringRules,
  summarize,
  Tier,
  updateFever,
} from './scoring';

export const SONG_SPEEDS = [1, 0.85, 0.75, 0.7, 0.5];

export const NOTE_SPEEDS = [
  { id: 'slow', label: 'Slow', factor: 1.43 },
  { id: 'normal', label: 'Normal', factor: 1 },
  { id: 'fast', label: 'Fast', factor: 0.71 },
] as const;

export type NoteSpeedId = (typeof NOTE_SPEEDS)[number]['id'];

/** Click volume when the Click box is on. */
export const CLICK_ON = 0.6;

/** How long the pass and Fever toasts stay up. */
const TOAST_MS = 3000;

/** Song speed a section's Practice button loops it at. */
export const PRACTICE_SPEED = 0.7;

/** Fever lasts this many beats (2 bars of 4/4). */
const FEVER_BEATS = 8;

export interface ArcadeFx {
  onHit?: (
    note: TimelineNote,
    piece: KitPiece,
    tier: Tier,
    offsetSeconds: number,
  ) => void;
  onMiss?: (note: TimelineNote, piece: KitPiece) => void;
  /** The run was reset (restart, new loop, loop pass). */
  onReset?: () => void;
}

/**
 * Shared game logic of the three arcade-style play views: scoring and
 * Fever on top of the real judge, loop / speed / click / demo
 * options, the pass toast and the end-of-song results.
 */
export function useArcade(
  session: PlaySession,
  rules: ScoringRules,
  fx: ArcadeFx = {},
) {
  const { notes, bars, chart, delaySeconds, pieceByVoice, engine, kit } =
    session;
  const sections = useMemo(
    () => buildSections(chart, bars, delaySeconds),
    [chart, bars, delaySeconds],
  );
  const lanes = useMemo(
    () => lanePieces(notes, pieceByVoice),
    [notes, pieceByVoice],
  );
  const crashPiece = pieceByVoice.get('crash');
  const hasCrash = Boolean(crashPiece && lanes.hands.includes(crashPiece));
  const warning = useMemo(
    () => skippedLine(skippedVoices(notes, pieceByVoice)),
    [notes, pieceByVoice],
  );
  const keyLabels = useMemo(
    () =>
      new Map(
        kit.pieces.map((p) => [p.id, padKeyLabel(kit, p, session.mapping)]),
      ),
    [kit, session.mapping],
  );
  const [log] = useState(() => new JudgmentLog(rules));
  const score = useRef<ScoreState>(INITIAL_SCORE);
  const fxRef = useRef(fx);
  const [loopIdx, setLoopIdx] = useState<number | undefined>(undefined);
  const [demo, setDemo] = useState(false);
  const [noteSpeed, setNoteSpeed] = usePersisted<NoteSpeedId>(
    'settings.kitNoteSpeed',
    'normal',
  );
  const [results, setResults] = useState<ArcadeResults | undefined>();
  const [toast, showToast] = useToast(TOAST_MS);

  useEffect(() => {
    fxRef.current = fx;
  });

  const reset = () => {
    log.clear();
    score.current = INITIAL_SCORE;
    fxRef.current.onReset?.();
    setResults(undefined);
  };
  const context = (note: TimelineNote): HitContext => ({
    time: note.time,
    isCrash: note.voice === 'crash',
    hasCrash,
    feverSeconds: FEVER_BEATS * beatSecondsAt(bars, note.time),
  });

  useNoteJudgments(session, {
    onHit: (note, offsetSeconds) => {
      const piece = pieceByVoice.get(note.voice);

      if (!piece) {
        return;
      }

      const tier = gradeHit(rules, offsetSeconds);
      const ctx = context(note);
      const before = score.current;

      score.current = applyHit(before, rules, tier, ctx);
      log.add({
        ...ctx,
        noteId: note.id,
        voice: note.voice,
        pieceId: piece.id,
        grade: { kind: 'hit', tier: tier.id, offsetMs: offsetSeconds * 1000 },
      });

      if (!before.fever && score.current.fever) {
        showToast('Fever! Double points for 2 bars', true);
      }

      fxRef.current.onHit?.(note, piece, tier, offsetSeconds);
    },
    onMiss: (note) => {
      const piece = pieceByVoice.get(note.voice);

      if (!piece) {
        return;
      }

      const ctx = context(note);

      score.current = applyMiss(score.current, rules, note.time);
      log.add({
        ...ctx,
        noteId: note.id,
        voice: note.voice,
        pieceId: piece.id,
        grade: { kind: 'miss' },
      });
      fxRef.current.onMiss?.(note, piece);
    },
    onRewind: (time) => {
      if (loopIdx !== undefined) {
        // A loop pass ended: report it, then start the next pass clean.
        const s = summarize(log.values(), rules);

        if (s.judged > 0) {
          showToast(
            `${sections[loopIdx]?.name ?? 'Loop'} · ${formatPercent(
              s.accuracy,
            )} · ${s.misses} missed · avg ${formatOffset(s.avgMs)}`,
            s.accuracy >= ARCADE_LOOP_PASS_ACCURACY,
          );
        }

        reset();

        return;
      }

      log.dropFrom(time - engine.hitTolerance);
      score.current = replay(log.values(), rules);
      setResults(undefined);
    },
  });

  useAnimationFrame(session, (now) => {
    score.current = updateFever(score.current, now);
  });

  const finish = () => {
    setResults(
      buildResults(
        log.values(),
        rules,
        score.current,
        session.playbackSpeed,
        lanes.kick ? [...lanes.hands, lanes.kick] : lanes.hands,
        sections,
      ),
    );
  };
  const finishRef = useRef(finish);

  useEffect(() => {
    finishRef.current = finish;
  });

  const { onEnded } = session;

  useEffect(() => onEnded(() => finishRef.current()), [onEnded]);

  useEffect(() => () => engine.setLoopRegion(undefined), [engine]);

  useDemoAutoplay(session, demo);

  const selectLoop = (idx: number | undefined) => {
    reset();
    setLoopIdx(idx);

    const sec = idx === undefined ? undefined : sections[idx];

    session.setLoopRegion(
      sec ? { startTick: sec.startTick, endTick: sec.endTick } : undefined,
    );

    if (sec && session.isPlaying) {
      session.playFromTick(sec.startTick);
    }
  };
  const restart = () => {
    reset();

    const sec = loopIdx === undefined ? undefined : sections[loopIdx];

    session.playFromTick(sec ? sec.startTick : bars[0]?.startTick ?? 0);
  };
  const practice = (idx: number) => {
    const sec = sections[idx];

    if (!sec) {
      return;
    }

    reset();
    setLoopIdx(idx);
    session.setLoopRegion({ startTick: sec.startTick, endTick: sec.endTick });
    session.setPlaybackSpeed(PRACTICE_SPEED);
    session.playFromTick(sec.startTick);
  };
  const lookFactor =
    NOTE_SPEEDS.find((s) => s.id === noteSpeed)?.factor ??
    NOTE_SPEEDS[1].factor;

  return {
    session,
    rules,
    log,
    /** Live score state; read it in animation frames. */
    score,
    sections,
    lanes,
    hasCrash,
    warning,
    keyLabels,
    loopIdx,
    selectLoop,
    restart,
    practice,
    demo,
    setDemo,
    noteSpeed,
    setNoteSpeed,
    lookFactor,
    results,
    closeResults: () => setResults(undefined),
    toast,
  };
}

export type Arcade = ReturnType<typeof useArcade>;

/**
 * Plays the chart by striking each note's piece at its time (with a little
 * human jitter and the odd flub), through the same input path as real pads.
 */
function useDemoAutoplay(session: PlaySession, enabled: boolean): void {
  const cursor = useRef(0);
  const last = useRef(-Infinity);
  const struck = useRef('');

  useAnimationFrame(session, (now) => {
    const { notes, pieceByVoice } = session;

    if (
      !enabled ||
      !session.isPlaying ||
      now < last.current - 0.05 ||
      now > last.current + 0.5
    ) {
      cursor.current = firstNoteAtOrAfter(notes, now - 0.03);
      last.current = now;

      if (!enabled || !session.isPlaying) {
        return;
      }
    }

    last.current = now;

    while (cursor.current < notes.length) {
      const i = cursor.current;
      const note = notes[i];
      const jitter =
        (hash01(i) - 0.5) * 0.044 + (note.voice === 'snare' ? -0.012 : 0);

      if (note.time + jitter > now) {
        break;
      }

      cursor.current += 1;

      const piece = pieceByVoice.get(note.voice);
      const key = `${note.tick}:${piece?.id}`;

      if (!piece || hash01(i + 7919) < 0.012 || struck.current === key) {
        continue;
      }

      struck.current = key;
      session.strikePiece(piece);
    }
  });
}
