import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Select } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPause,
  faPlay,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { assertNever } from '../../../../shared/assertNever';
import { usePersisted } from '../../../hooks/usePersisted';
import { TimelineNote, Voice, VOICE_INFO } from '../../../kit';
import { useAnimationFrame, useNoteJudgments, usePadStrikes } from '../hooks';
import { PlaySession } from '../session';
import {
  coachTip,
  CoachTip,
  recordOffset,
  TimingHistory,
} from './lesson/coach';
import { KitFlashes, LessonKit } from './lesson/LessonKit';
import {
  CoachPanel,
  LessonPath,
  ResultPanel,
  ShownResult,
  OK,
  StepBar,
  TONE_COLOR,
  WARN,
  WhyPanel,
} from './lesson/LessonPanels';
import {
  LessonStaff,
  markStaffNote,
  MISS_COLOR,
  TIER_COLORS,
} from './lesson/LessonStaff';
import {
  belongsToNextPass,
  endPass,
  guideLevel,
  isPassComplete,
  jumpToStep,
  LessonState,
  MAX_STARS,
  nextLesson,
  scorePass,
  startLesson,
  tierOf,
} from './lesson/machine';
import {
  LessonProgress,
  parseFlag,
  parseProgress,
  parseWaitGrace,
  PROGRESS_KEY,
  RUN_UP_KEY,
  SongProgress,
  WAIT_GRACE_KEY,
  WAIT_MODE_KEY,
  WaitGraceMs,
} from './lesson/persisted';
import {
  describeOutcome,
  OutcomeTone,
  outcomeTone,
} from './lesson/outcomeText';
import { layoutStaff } from './lesson/staff';
import { TempoControl } from './lesson/TempoControl';
import { TempoBar } from './lesson/TempoBar';
import {
  dueNotes,
  effectiveGrace,
  OffsetStats,
  offsetStats,
  TempoMeter,
  runUpStart,
  WAIT_GRACE_OPTIONS_MS,
} from './lesson/pace';
import { WaitStatsBar } from './lesson/WaitStatsBar';
import {
  heldIds,
  holdStartFor,
  INITIAL_WAIT,
  RUN_UP_REACH_SECONDS,
  WaitAction,
  waitFrame,
  waitHit,
  waitMiss,
  waitPassEnd,
  waitRewind,
  WaitState,
  WaitStats,
} from './lesson/wait';
import { TimingStrip } from './lesson/TimingStrip';
import {
  buildSteps,
  drumTrackGain,
  isListening,
  kitStemGains,
} from './lesson/steps';
import {
  buildLessons,
  LessonWindow,
  mixWindow,
  windowNotes,
  windowSpan,
} from './lesson/windows';

const EMPTY_PROGRESS: SongProgress = { stars: {}, seen: {} };
const DEFAULT_CLICK = 0.6;

interface PassTracker {
  /** Earliest / latest audio time seen while playing this pass. */
  minTime: number;
  maxTime: number;
  /** Note id → hit offset (ms) for this pass. */
  hits: Map<string, number>;
  /** Early hits on the first notes, landed just before the loop wrapped. */
  next: Map<string, number>;
  history: TimingHistory;
}

interface Toast {
  id: number;
  message: string;
  tone: OutcomeTone;
}

const voicesOf = (notes: TimelineNote[]) => new Set(notes.map((n) => n.voice));
const NO_VOICES: readonly Voice[] = [];

export function LessonView({ session }: { session: PlaySession }) {
  const { engine, bars, notes, pieceByVoice, timeStore, setPlaybackSpeed } =
    session;
  const songId = session.song.id;
  const [allProgress, setAllProgress] = usePersisted<LessonProgress>(
    PROGRESS_KEY,
    {},
    parseProgress,
  );
  const progress = allProgress[songId] ?? EMPTY_PROGRESS;
  const lessons = useMemo(
    () => buildLessons(bars, notes, session.chart.sections ?? []),
    [bars, notes, session.chart.sections],
  );
  const mixes = useMemo(
    () => lessons.map((l) => mixWindow(l, bars, notes)),
    [lessons, bars, notes],
  );
  const { kitStems } = session;
  const hasKitStems = session.isReady && kitStems.length > 0;
  const hasDrumStem = (session.isReady && engine.hasDrumStem) || hasKitStems;
  const allSteps = useMemo(
    () =>
      lessons.map((l, i) =>
        buildSteps(voicesOf(windowNotes(notes, l)), {
          hasMix: mixes[i] !== undefined,
          hasDrumStem,
          hasKitStems,
        }),
      ),
    [lessons, mixes, notes, hasDrumStem, hasKitStems],
  );
  const stars = lessons.map((l) => progress.stars[l.key] ?? 0);
  const seen = lessons.map((l) => progress.seen[l.key] ?? false);
  const [state, setState] = useState<LessonState>(() => {
    const saved = lessons.findIndex((l) => l.key === progress.lesson);
    const idx = saved >= 0 ? saved : nextLesson(stars, -1);

    return startLesson(
      idx,
      stars[idx] ?? 0,
      seen[idx] ?? false,
      allSteps[idx] ?? [],
    );
  });
  const [result, setResult] = useState<ShownResult>();
  const [tip, setTip] = useState<CoachTip>();
  const [toast, setToast] = useState<Toast>();
  const [toastShown, setToastShown] = useState(false);
  const [passId, setPassId] = useState(0);
  const tracker = useRef<PassTracker>({
    minTime: Infinity,
    maxTime: -Infinity,
    hits: new Map(),
    next: new Map(),
    history: new Map(),
  });
  const flashes = useRef<KitFlashes>({ strikes: new Map(), judged: new Map() });
  const [waitMode, setWaitMode] = usePersisted(WAIT_MODE_KEY, false, parseFlag);
  const [waitGraceMs, setWaitGraceMs] = usePersisted<WaitGraceMs>(
    WAIT_GRACE_KEY,
    WAIT_GRACE_OPTIONS_MS[1],
    parseWaitGrace,
  );
  const [runUp, setRunUp] = usePersisted(RUN_UP_KEY, true, parseFlag);
  /** Wait mode's state (lesson/wait.ts). The UI mirrors only `waitView`. */
  const wait = useRef<WaitState>(INITIAL_WAIT);
  const [waitView, setWaitView] = useState<{
    stats: WaitStats;
    runUpFor: readonly Voice[];
  }>({ stats: INITIAL_WAIT.stats, runUpFor: NO_VOICES });
  const [timing, setTiming] = useState<{ key: string; stats: OffsetStats }>({
    key: '',
    stats: { offsets: [], mean: undefined, spread: undefined },
  });
  /** Voices wait mode is holding for; empty while it isn't holding. */
  const [waitingFor, setWaitingFor] = useState<Voice[]>([]);
  const tempoMeter = useRef({ key: '', meter: new TempoMeter() });
  const [tempoReading, setTempoReading] = useState<{
    key: string;
    ratio: number | undefined;
  }>({ key: '', ratio: undefined });
  const staffRef = useRef<SVGSVGElement>(null);
  const lessonIdx = Math.max(0, Math.min(state.lesson, lessons.length - 1));
  const lesson: LessonWindow | undefined = lessons[lessonIdx];
  const steps = allSteps[lessonIdx] ?? [];
  const stepIdx = Math.min(state.step, Math.max(0, steps.length - 1));
  const step = steps[stepIdx];
  const kind = step?.kind ?? 'listen';
  const win = kind === 'mix' ? mixes[lessonIdx] ?? lesson : lesson;
  const span = win ? windowSpan(bars, win) : undefined;
  const winBars = useMemo(
    () => (win ? bars.slice(win.startBar, win.endBar) : []),
    [bars, win],
  );
  const winNotes = useMemo(
    () => (win ? windowNotes(notes, win) : []),
    [notes, win],
  );
  const noteById = useMemo(
    () => new Map(winNotes.map((n) => [n.id, n])),
    [winNotes],
  );
  const listening = isListening(kind);
  const playable = useMemo(
    () => new Set([...voicesOf(winNotes)].filter((v) => pieceByVoice.has(v))),
    [winNotes, pieceByVoice],
  );
  const mine = useMemo<Set<Voice>>(() => {
    if (listening) {
      return new Set();
    }

    const voices = kind === 'limb' ? step?.voices ?? [] : [...playable];

    return new Set(voices.filter((v) => playable.has(v)));
  }, [listening, kind, step, playable]);
  const onVoices = listening ? playable : mine;
  const trackVoices = useMemo(
    () => new Set([...playable].filter((v) => !mine.has(v))),
    [playable, mine],
  );
  const guide = step ? guideLevel(step, state.readGuide) : 1;
  const hints = listening ? 1 : Math.max(0, Math.min(1, guide / 0.5));
  const layout = useMemo(
    () => layoutStaff(winBars, winNotes, guide),
    [winBars, winNotes, guide],
  );
  const usedPieceIds = useMemo(
    () =>
      new Set(
        [...playable].flatMap((v) => {
          const p = pieceByVoice.get(v);

          return p ? [p.id] : [];
        }),
      ),
    [playable, pieceByVoice],
  );
  const lookahead = winBars[0]
    ? (winBars[0].end - winBars[0].start) / Math.max(1, winBars[0].beats.length)
    : 0.5;
  const startTick = span?.startTick;
  const endTick = span?.endTick;
  const stemGain = drumTrackGain(kind);

  // Loop the lesson window; a new window starts a fresh pass.
  useEffect(() => {
    if (startTick === undefined || endTick === undefined) {
      return;
    }

    const t = tracker.current;

    t.minTime = Infinity;
    t.maxTime = -Infinity;
    t.hits = new Map();
    t.next = new Map();
    engine.setLoopRegion({ startTick, endTick });
  }, [engine, startTick, endTick]);

  useEffect(() => () => engine.setLoopRegion(undefined), [engine]);

  const { setStemScale } = session;
  // With a kit split, mute only the pieces this step has you play.
  const kitGainKey = JSON.stringify(
    step && kitStems.length > 0 ? kitStemGains(step, kitStems) : {},
  );

  useEffect(() => {
    const gains = JSON.parse(kitGainKey) as Record<string, number>;
    const pieces = Object.keys(gains);

    if (pieces.length === 0) {
      setStemScale('drums', stemGain);

      return undefined;
    }

    pieces.forEach((piece) => setStemScale(piece, gains[piece]));

    return undefined;
  }, [setStemScale, stemGain, kitGainKey]);

  useEffect(
    () => () => {
      setStemScale('drums', 1);
      kitStems.forEach((piece) => setStemScale(piece, 1));
    },
    [setStemScale, kitStems],
  );

  useEffect(() => {
    setPlaybackSpeed(state.speed);
  }, [setPlaybackSpeed, state.speed]);

  useEffect(() => () => setPlaybackSpeed(1), [setPlaybackSpeed]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const hide = setTimeout(() => setToastShown(false), 3200);

    return () => clearTimeout(hide);
  }, [toast]);

  /** Moves wait mode on, and shows what the UI shows of it if that changed. */
  const setWait = (next: WaitState) => {
    const runUpFor =
      next.phase.kind === 'runningUp' ? next.phase.voices : NO_VOICES;

    wait.current = next;
    setWaitView((prev) =>
      prev.stats === next.stats && prev.runUpFor === runUpFor
        ? prev
        : { stats: next.stats, runUpFor },
    );
  };
  const performWaitAction = (action: WaitAction) => {
    switch (action.kind) {
      case 'hold':
        engine.hold(action.ticks);

        return;

      case 'release':
        engine.release();

        return;

      case 'seek':
        session.seekSeconds(action.seconds);

        return;

      default:
        assertNever(action, 'wait action');
    }
  };
  const saveProgress = (update: (p: SongProgress) => SongProgress) =>
    setAllProgress((all) => ({
      ...all,
      [songId]: update(all[songId] ?? EMPTY_PROGRESS),
    }));
  const resetPass = () => {
    const t = tracker.current;

    t.minTime = Infinity;
    t.maxTime = -Infinity;
    t.hits = new Map();
    t.next = new Map();
    setPassId((n) => n + 1);
  };
  /** Restarts the pass from the top if the window is unchanged and playing. */
  const restartIfSameWindow = (next: LessonWindow | undefined) => {
    resetPass();

    if (
      session.isPlaying &&
      next &&
      win &&
      next.startBar === win.startBar &&
      next.endBar === win.endBar
    ) {
      session.playFromTick(windowSpan(bars, next).startTick);
    }
  };
  const goToLesson = (index: number) => {
    const l = lessons[index];

    if (!l) {
      return;
    }

    const next = startLesson(index, stars[index], seen[index], allSteps[index]);
    const nextSteps = allSteps[index];

    setState(next);
    saveProgress((p) => ({ ...p, lesson: l.key }));
    restartIfSameWindow(
      nextSteps[next.step]?.kind === 'mix' ? mixes[index] : l,
    );
  };
  const goToStep = (index: number) => {
    setState((s) => jumpToStep(s, index));
    restartIfSameWindow(
      steps[index]?.kind === 'mix' ? mixes[lessonIdx] : lesson,
    );
  };
  const resetProgress = () => {
    const zero = lessons.map(() => 0);

    tracker.current.history = new Map();
    setResult(undefined);
    setTip(undefined);
    saveProgress(() => ({ ...EMPTY_PROGRESS, lesson: lessons[0]?.key }));
    setState(startLesson(nextLesson(zero, -1), 0, false, allSteps[0] ?? []));
    restartIfSameWindow(lessons[0]);
  };
  const inWindow = (n: TimelineNote) =>
    win !== undefined &&
    n.measureIdx >= win.startBar &&
    n.measureIdx < win.endBar;
  const evaluatePass = () => {
    if (!step || !win || !span) {
      return;
    }

    const scored = winNotes.filter((n) => mine.has(n.voice));
    const hits = tracker.current.hits;
    const passResult =
      listening || scored.length === 0
        ? undefined
        : scorePass(
            scored.map((n) => ({
              bar: n.measureIdx - win.startBar,
              offsetMs: hits.get(n.id),
            })),
            win.endBar - win.startBar,
          );
    const passWaits = waitMode ? wait.current.stats.waits : 0;
    const outcome = endPass(state, passResult, {
      steps,
      stars,
      seen,
      stepsFor: (i) => allSteps[i] ?? [],
      starAllowed: passWaits === 0,
    });
    const message = describeOutcome(
      outcome,
      { lessons: lessons.map((l) => l.name), steps: steps.map((s) => s.name) },
      waitMode ? passWaits : undefined,
    );
    const tone = outcomeTone(outcome);

    setState(outcome.state);
    setToast((t) => ({ id: (t?.id ?? 0) + 1, message, tone }));
    setToastShown(true);

    if (passResult) {
      setResult({ ...passResult, message, tone });
      setTip(coachTip(passResult, tracker.current.history));
    }

    if (outcome.kind === 'finished') {
      const key = lessons[outcome.lesson].key;
      const nextKey = lessons[outcome.nextLesson]?.key;
      const earned = outcome.star === 'earned' ? 1 : 0;

      saveProgress((p) => ({
        stars: {
          ...p.stars,
          [key]: Math.min(MAX_STARS, (p.stars[key] ?? 0) + earned),
        },
        seen: { ...p.seen, [key]: true },
        lesson: nextKey,
      }));
    }
  };
  /** A run-up: the same pass, replayed from a beat before the held note. */
  const replayFrom = (from: number) => {
    const t = tracker.current;

    // Hits from there on are played again; the rest of the pass stands.
    [...t.hits.keys()].forEach((id) => {
      if ((noteById.get(id)?.time ?? -Infinity) >= from - 1e-3) {
        t.hits.delete(id);
      }
    });
    tempoMeter.current.meter.break();
  };
  /** A loop wrap, restart or seek: score the pass if it was played through. */
  const endPassAt = (now: number) => {
    const t = tracker.current;
    const complete =
      span !== undefined && isPassComplete(t.minTime, t.maxTime, span);

    if (complete) {
      evaluatePass();
    }

    setWait(waitPassEnd(wait.current, complete && waitMode));
    t.hits = complete ? t.next : new Map();
    t.next = new Map();
    t.minTime = now;
    t.maxTime = now;
    tempoMeter.current.meter.break();
    setPassId((n) => n + 1);
  };
  const tempoKey = `${state.speed}:${stepIdx}:${lessonIdx}:${waitMode}`;

  useNoteJudgments(session, {
    onHit: (note, offsetSeconds) => {
      if (!span || !inWindow(note) || !mine.has(note.voice)) {
        return;
      }

      const t = tracker.current;
      const ms = offsetSeconds * 1000;
      const now = timeStore.get();
      const slack = Math.max(0.15, engine.hitTolerance * 2);
      const next = belongsToNextPass(note.time, now, span, slack);

      // A late hit on the last notes, judged after the loop wrapped: it
      // belonged to the pass that was just scored.
      if (!next && note.time - now > 1) {
        return;
      }

      if (next) {
        t.next.set(note.id, ms);
      } else {
        t.hits.set(note.id, ms);

        const index = winNotes.indexOf(note);

        if (index >= 0) {
          markStaffNote(
            staffRef.current,
            index,
            TIER_COLORS[tierOf(ms)],
            false,
          );
        }
      }

      recordOffset(t.history, note.voice, ms);

      const holdSince = holdStartFor(wait.current, note.id);

      // Live timing. After a hold, count the time you actually took, so a
      // late hit still shows as late even though the song waited for it;
      // with a run-up, the hit that counts is the one in the run-up.
      if (holdSince === undefined || !runUp) {
        const realMs =
          holdSince === undefined
            ? ms
            : ms + (performance.now() - holdSince) * state.speed;

        setTiming((prev) => ({
          key: tempoKey,
          stats: offsetStats(
            prev.key === tempoKey ? prev.stats.offsets : [],
            realMs,
          ),
        }));
      }

      setWait(waitHit(wait.current, { id: note.id, waitMode, nextPass: next }));

      if (!waitMode) {
        // A new tempo, step or lesson starts a fresh reading.
        const tm = tempoMeter.current;

        if (tm.key !== tempoKey) {
          tm.key = tempoKey;
          tm.meter.reset();
        }

        tm.meter.add(note, offsetSeconds);
        setTempoReading({ key: tempoKey, ratio: tm.meter.ratio });
      }

      const piece = pieceByVoice.get(note.voice);

      if (piece) {
        flashes.current.judged.set(piece.id, {
          at: performance.now(),
          color: TIER_COLORS[tierOf(ms)],
        });
      }
    },
    onMiss: (note) => {
      if (
        !inWindow(note) ||
        !mine.has(note.voice) ||
        tracker.current.hits.has(note.id)
      ) {
        return;
      }

      const index = winNotes.indexOf(note);

      if (index >= 0) {
        markStaffNote(staffRef.current, index, MISS_COLOR, true);
      }

      setWait(waitMiss(wait.current));
    },
    onRewind: (now) => {
      const { state: next, rewind } = waitRewind(wait.current, now);

      setWait(next);

      switch (rewind.kind) {
        case 'runUp':
          replayFrom(rewind.from);

          return;

        case 'wrap':
          endPassAt(now);

          return;

        default:
          assertNever(rewind, 'wait rewind');
      }
    },
  });

  usePadStrikes(session, (piece) => {
    if (piece) {
      flashes.current.strikes.set(piece.id, performance.now());
    }
  });

  // Track how far through the window playback got, to tell a loop wrap from a restart.
  useAnimationFrame(session, (now) => {
    if (
      !session.isPlaying ||
      !span ||
      now < span.start - 0.5 ||
      now > span.end + 0.5
    ) {
      return;
    }

    const t = tracker.current;

    t.minTime = Math.min(t.minTime, now);
    t.maxTime = Math.max(t.maxTime, now);
  });

  const waiting = waitMode && !listening;
  const myNotes = useMemo(
    () => winNotes.filter((n) => mine.has(n.voice)),
    [winNotes, mine],
  );

  // Wait mode: freeze on each of your notes until it is hit.
  useAnimationFrame(session, (now) => {
    const isHit = (id: string) => tracker.current.hits.has(id);
    const due =
      waiting && session.isPlaying
        ? dueNotes(
            myNotes,
            (n) => isHit(n.id),
            now,
            engine.hitTolerance,
            effectiveGrace(waitGraceMs, engine.hitTolerance),
            heldIds(wait.current),
          )
        : [];
    const floor = span ? span.start - RUN_UP_REACH_SECONDS : undefined;
    const { state: next, actions } = waitFrame(wait.current, {
      at: performance.now(),
      due,
      engineHeld: engine.isHeld,
      notes: myNotes,
      isHit,
      runUpStart:
        runUp && floor !== undefined
          ? (time) => runUpStart(time, bars, floor)
          : undefined,
    });

    // State first: a seek's rewind must find the run-up it belongs to.
    setWait(next);
    actions.forEach(performWaitAction);

    const voices = due.map((n) => n.voice);

    setWaitingFor((prev) =>
      prev.length === voices.length && prev.every((v, i) => v === voices[i])
        ? prev
        : voices,
    );
  });

  useEffect(() => {
    if (!waiting) {
      engine.release();
    }
  }, [engine, waiting]);

  useEffect(() => () => engine.release(), [engine]);

  if (!lesson || !step || !span) {
    return (
      <div className="p-6 text-text-muted">
        This chart has no drum notes to build a lesson from.
      </div>
    );
  }

  const speedPct = Math.round(state.speed * 100);
  const otherLabel = hasDrumStem ? ' · track' : ' · song';
  const missingVoices = [...voicesOf(winNotes)]
    .filter((v) => !pieceByVoice.has(v))
    .map((v) => VOICE_INFO[v].name.toLowerCase());

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1500px] mx-auto">
      <LessonPath
        lessons={lessons}
        stars={stars}
        current={lessonIdx}
        onPick={goToLesson}
      />
      <div className="flex flex-wrap gap-x-5 gap-y-3 items-center justify-between">
        <div className="min-w-0">
          <div className="font-display font-medium text-[26px] leading-tight text-text mb-1">
            {step.name} · {speedPct}% speed
          </div>
          <p className="text-[13px] text-text-muted m-0 max-w-[80ch]">
            {step.tip}
            {kind === 'mix' && win !== lesson ? ` (${win?.name})` : ''}
          </p>
          {missingVoices.length > 0 && (
            <p className="text-xs m-0 mt-1" style={{ color: WARN }}>
              Your kit has no pad for {missingVoices.join(', ')}; those notes
              are greyed out and not scored.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            type="primary"
            icon={
              <FontAwesomeIcon icon={session.isPlaying ? faPause : faPlay} />
            }
            onClick={session.togglePlay}
          >
            {session.isPlaying || session.isCounting ? 'Pause' : 'Play'}
          </Button>
          <Button
            icon={<FontAwesomeIcon icon={faRotateLeft} />}
            onClick={resetProgress}
            title="Clears the stars for this song and starts from the first lesson"
          >
            Restart lessons
          </Button>
          <TempoControl
            speed={state.speed}
            starSpeed={state.baseSpeed}
            onChange={(speed) => setState((s) => ({ ...s, speed }))}
          />
          <Checkbox
            data-testid="wait-mode"
            checked={waitMode}
            onChange={(e) => setWaitMode(e.target.checked)}
            title="Playback stops at each of your notes until you hit the right pad. Timing isn't scored, so no stars."
          >
            Wait for me
          </Checkbox>
          {waitMode && (
            <Select
              aria-label="Wait grace"
              data-testid="wait-grace"
              size="small"
              value={waitGraceMs}
              onChange={setWaitGraceMs}
              popupMatchSelectWidth={false}
              title="How late a note can be before the song stops for it"
              options={WAIT_GRACE_OPTIONS_MS.map((ms) => ({
                value: ms,
                label: `${ms} ms grace`,
              }))}
            />
          )}
          {waitMode && (
            <Checkbox
              data-testid="run-up"
              checked={runUp}
              onChange={(e) => setRunUp(e.target.checked)}
              title="Once you find the pad the song waited for, it backs up a beat so you play that note again, in time"
            >
              Run-up
            </Checkbox>
          )}
          <Checkbox
            checked={session.clickVolume > 0}
            onChange={(e) =>
              session.setClickVolume(e.target.checked ? DEFAULT_CLICK : 0)
            }
          >
            Click
          </Checkbox>
        </div>
      </div>
      <StepBar steps={steps} current={stepIdx} onPick={goToStep} />
      {!listening && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 items-center">
          <TimingStrip
            stats={
              timing.key === tempoKey
                ? timing.stats
                : { offsets: [], mean: undefined, spread: undefined }
            }
            windowMs={engine.hitTolerance * 1000}
            graceMs={
              waitMode
                ? effectiveGrace(waitGraceMs, engine.hitTolerance) * 1000
                : undefined
            }
          />
          {waitMode ? (
            <WaitStatsBar stats={waitView.stats} />
          ) : (
            <TempoBar
              ratio={
                tempoReading.key === tempoKey ? tempoReading.ratio : undefined
              }
              speed={state.speed}
            />
          )}
        </div>
      )}
      <div className="grid gap-4 grid-cols-1 min-[900px]:grid-cols-[minmax(240px,30%)_minmax(0,1fr)]">
        <div className="relative overflow-x-auto rounded-[10px] min-[900px]:order-2">
          <div
            className="relative bg-paper rounded-[10px] min-w-[720px]"
            style={{ boxShadow: 'var(--shadow-paper)' }}
          >
            <div
              role="status"
              className="absolute top-3 left-1/2 -translate-x-1/2 bg-surface border rounded-full px-3.5 py-1.5 font-semibold text-[13px] whitespace-nowrap max-w-[92%] overflow-hidden text-ellipsis pointer-events-none transition-opacity duration-300"
              style={{
                opacity: toast && toastShown ? 1 : 0,
                borderColor: toast ? TONE_COLOR[toast.tone] : undefined,
                color: toast ? TONE_COLOR[toast.tone] : undefined,
              }}
            >
              {toast?.message}
            </div>
            {waitingFor.length > 0 && (
              <div
                data-testid="waiting-for"
                className="absolute top-3 right-3 rounded-full px-3.5 py-1.5 font-semibold text-[13px] whitespace-nowrap pointer-events-none"
                style={{ background: WARN, color: '#1b1b1b' }}
              >
                Waiting for{' '}
                {[...new Set(waitingFor)]
                  .map((v) => VOICE_INFO[v].name.toLowerCase())
                  .join(' + ')}
              </div>
            )}
            {waitingFor.length === 0 && waitView.runUpFor.length > 0 && (
              <div
                data-testid="run-up-for"
                className="absolute top-3 right-3 rounded-full px-3.5 py-1.5 font-semibold text-[13px] whitespace-nowrap pointer-events-none"
                style={{ background: OK, color: '#1b1b1b' }}
              >
                Now in time:{' '}
                {[...new Set(waitView.runUpFor)]
                  .map((v) => VOICE_INFO[v].name.toLowerCase())
                  .join(' + ')}
              </div>
            )}
            <LessonStaff
              key={`${win?.key}:${passId}`}
              session={session}
              layout={layout}
              bars={winBars}
              notes={winNotes}
              pieceByVoice={pieceByVoice}
              guide={guide}
              onVoices={onVoices}
              showCounts={kind !== 'listen'}
              otherLabel={otherLabel}
              svgRef={staffRef}
            />
          </div>
        </div>
        <div className="flex items-center rounded-[14px] border border-border bg-[#121315] p-2 min-[900px]:order-1">
          <LessonKit
            session={session}
            notes={winNotes}
            ringVoices={onVoices}
            trackVoices={trackVoices}
            hints={hints}
            lookahead={lookahead}
            hitIds={tracker}
            flashes={flashes}
            usedPieceIds={usedPieceIds}
          />
        </div>
      </div>
      <div className="grid gap-4 items-start grid-cols-1 min-[700px]:grid-cols-2 min-[1000px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_300px]">
        <ResultPanel result={result} />
        <CoachPanel guide={guide} tip={tip} pieceByVoice={pieceByVoice} />
        <div className="min-[700px]:col-span-2 min-[1000px]:col-span-1">
          <WhyPanel />
        </div>
      </div>
    </div>
  );
}
