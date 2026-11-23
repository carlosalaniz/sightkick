import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Segmented, Select, Tooltip } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAngleLeft,
  faAngleRight,
  faEye,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { usePersisted } from '../../../hooks/usePersisted';
import { TimelineNote, VOICES } from '../../../kit';
import { usePadStrikes, useAnimationFrame, useNoteJudgments } from '../hooks';
import { PlaySession } from '../session';
import {
  coachBand,
  CoachReport,
  coachReport,
  pushOffset,
} from './sheetLanes/coach';
import {
  fadeAfterHit,
  fadeAfterMiss,
  GUIDE_MODES,
  GuideMode,
  initialLevels,
  isGuideMode,
  kitGlowLevel,
  labelLevel,
  laneLevel,
  laneSpacing,
  presetLevel,
} from './sheetLanes/guide';
import { GuideKit, KitGlow } from './sheetLanes/GuideKit';
import {
  GEMS_AHEAD_OPTIONS,
  INK,
  LABEL_W,
  LINE_STEPS,
  LOOK_AHEAD_OPTIONS,
  Motion,
  pixelsPerBeat,
  PLAYHEAD_COLOR,
  staffGeometry,
  stepY,
  stripPosition,
  VIEW_W,
} from './sheetLanes/layout';
import {
  CoachPanel,
  GuideBars,
  Panel,
  PassReport,
  ReadingProgress,
  SongProgress,
  SummaryPanel,
  TempoLadder,
} from './sheetLanes/Panels';
import {
  BarRange,
  buildLoopModel,
  defaultRange,
  loopBarAtBeat,
  loopBeatAt,
  nextRangeWithNotes,
  rangeLabel,
  sectionRanges,
  shiftRange,
} from './sheetLanes/region';
import {
  evaluatePass,
  gradeHit,
  hitPoints,
  LadderState,
  ladderStep,
  mean,
  MISS_COLOR,
  NoteResult,
  passOutcome,
  readingBonus,
  RUNGS,
  START_RUNG,
  streakAfterHit,
  streakAfterMiss,
  StreakState,
  TIER_BY_ID,
} from './sheetLanes/scoring';
import { StaffStrip } from './sheetLanes/StaffStrip';

/** Mutable per-frame state; never rendered directly. */
interface Runtime {
  /** Guide level per loop bar, 0–1. */
  levels: number[];
  streak: StreakState;
  /** Score of the pass in progress. */
  score: number;
  /** Virtual pass index of the playhead (bars after the loop end are pass + 1). */
  pass: number;
  /** Notes judged before this audio time in the current pass are not scored. */
  passFrom: number;
  results: Map<number, Map<string, NoteResult>>;
  /** Real-ms offsets per piece id, rolling. */
  logs: Map<string, number[]>;
  lastTime: number;
  wasPlaying: boolean;
  /** The current pass is an unseen-bars pass (sheet only, 100%). */
  probe: boolean;
  guide: GuideMode;
  ladder: LadderState;
  passCount: number;
  /** Last written DOM values, to skip no-op writes. */
  dom: Map<Element, Map<string, string>>;
}

const MOTIONS: { value: Motion; label: string }[] = [
  { value: 'scroll', label: 'Scroll' },
  { value: 'page', label: 'Page' },
];
const EMPTY_PROGRESS: SongProgress = { probes: [] };
const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Writes a DOM attribute (or `text` / `style.width`) only when it changed. */
function setAttr(rt: Runtime, el: Element | null, name: string, v: string) {
  if (!el) {
    return;
  }

  let cache = rt.dom.get(el);

  if (!cache) {
    cache = new Map();
    rt.dom.set(el, cache);
  }

  if (cache.get(name) === v) {
    return;
  }

  cache.set(name, v);

  if (name === 'style.width') {
    (el as HTMLElement).style.width = v;
  } else if (name === 'text') {
    el.textContent = v;
  } else {
    el.setAttribute(name, v);
  }
}

export function SheetLanesView({ session }: { session: PlaySession }) {
  const { bars, notes, engine, kit, pieceByVoice, setPlaybackSpeed } = session;
  const [guideSetting, setGuide] = usePersisted<GuideMode>(
    'settings.v6.guide',
    'adaptive',
  );
  const guide = isGuideMode(guideSetting) ? guideSetting : 'adaptive';
  const [motionSetting, setMotion] = usePersisted<Motion>(
    'settings.v6.view',
    'scroll',
  );
  const motion: Motion = motionSetting === 'page' ? 'page' : 'scroll';
  const [lookSetting, setLook] = usePersisted('settings.v6.lookAhead', 2);
  const look = LOOK_AHEAD_OPTIONS.includes(lookSetting) ? lookSetting : 2;
  const [gemsMs, setGemsMs] = usePersisted('settings.v6.gemsMs', 1200);
  const [allProgress, setAllProgress] = usePersisted<
    Record<string, SongProgress>
  >('settings.v6.progress', {});
  const songId = session.song.id;
  const progress = allProgress[songId] ?? EMPTY_PROGRESS;
  const [range, setRange] = useState<BarRange>(() => defaultRange(bars, notes));
  const model = useMemo(
    () => buildLoopModel(bars, notes, range),
    [bars, notes, range],
  );
  const sections = useMemo(
    () => sectionRanges(session.chart.sections ?? [], bars),
    [session.chart.sections, bars],
  );
  const [spacing, setSpacing] = useState(() =>
    laneSpacing(initialLevels(guide, range.end - range.start)),
  );
  const [ladder, setLadder] = useState<LadderState>({
    index: START_RUNG,
    clean: 0,
    fails: 0,
  });
  const [probe, setProbe] = useState(false);
  const [report, setReport] = useState<PassReport>();
  const [coach, setCoach] = useState<CoachReport<string>>();
  const [reduced] = useState(prefersReducedMotion);
  const [kitGlow] = useState(() => new KitGlow(prefersReducedMotion()));
  const rt = useRef<Runtime>({
    levels: initialLevels(guide, range.end - range.start),
    streak: { streak: 0, mult: 1 },
    score: 0,
    pass: 0,
    passFrom: -Infinity,
    results: new Map(),
    logs: new Map(),
    lastTime: -Infinity,
    wasPlaying: false,
    probe: false,
    guide,
    ladder,
    passCount: 0,
    dom: new Map(),
  });
  const stripRef = useRef<SVGGElement>(null);
  const strip = useRef<StaffStrip | null>(null);
  const playheadRef = useRef<SVGGElement>(null);
  const bandsRef = useRef<SVGGElement>(null);
  const labelsRef = useRef<SVGGElement>(null);
  const clefRef = useRef<SVGGElement>(null);
  const streakRef = useRef<HTMLSpanElement>(null);
  const guideBarEls = useRef<(HTMLElement | null)[]>([]);
  const geo = useMemo(() => staffGeometry(spacing), [spacing]);
  const ppb = pixelsPerBeat(motion, look);
  const speed = probe ? 1 : RUNGS[ladder.index];
  const pieceOf = useCallback(
    (note: TimelineNote) => pieceByVoice.get(note.voice),
    [pieceByVoice],
  );
  const laneVoices = useMemo(
    () =>
      VOICES.flatMap((v) => {
        const p = pieceByVoice.get(v.id);

        return p
          ? [
              {
                voice: v,
                piece: p,
                label: p.voices.length > 1 ? v.name : p.name,
              },
            ]
          : [];
      }),
    [pieceByVoice],
  );

  // The ladder (or an unseen-bars pass at 100%) owns the speed in this view.
  useEffect(() => {
    setPlaybackSpeed(speed);
  }, [setPlaybackSpeed, speed]);

  useEffect(() => () => setPlaybackSpeed(1), [setPlaybackSpeed]);

  useEffect(() => {
    engine.setLoopRegion({
      startTick: model.startTick,
      endTick: model.endTick,
    });
  }, [engine, model.startTick, model.endTick]);

  useEffect(() => () => engine.setLoopRegion(undefined), [engine]);

  useEffect(() => {
    rt.current.guide = guide;
  }, [guide]);

  const statusOf = useCallback(
    (pass: number, id: string) => rt.current.results.get(pass)?.get(id),
    [],
  );

  // (Re)build the note strip when the loop, lane spacing or scale changes.
  useEffect(() => {
    const root = stripRef.current;

    if (!root) {
      return;
    }

    strip.current ??= new StaffStrip(root);
    strip.current.configure({
      model,
      geo,
      ppb,
      colorOf: (v) => pieceByVoice.get(v)?.color,
    });
    rt.current.dom.clear();
  }, [model, geo, ppb, pieceByVoice]);

  /** Resets everything that belongs to a loop and switches to `next`. */
  const switchRange = (next: BarRange, asProbe: boolean) => {
    const r = rt.current;
    const count = next.end - next.start;

    r.levels = asProbe
      ? Array.from({ length: count }, () => 0)
      : initialLevels(r.guide, count);
    r.pass = 0;
    r.passFrom = session.timeStore.get();
    r.results.clear();
    r.score = 0;
    r.probe = asProbe;
    setProbe(asProbe);
    setSpacing(laneSpacing(r.levels));
    setRange(next);
  };
  const pickRange = (next: BarRange) => switchRange(next, false);
  const startUnseen = () => {
    const from = Math.max(range.end, progress.seenTo ?? 0);
    const next = nextRangeWithNotes(notes, from, bars.length);

    if (next) {
      switchRange(next, true);
    }
  };
  const unseenAvailable =
    nextRangeWithNotes(
      notes,
      Math.max(range.end, progress.seenTo ?? 0),
      bars.length,
    ) !== undefined;
  const changeGuide = (mode: GuideMode) => {
    const r = rt.current;
    const level = presetLevel(mode);

    setGuide(mode);
    r.guide = mode;

    if (level !== undefined && !r.probe) {
      r.levels = r.levels.map(() => level);
    }

    setSpacing(laneSpacing(r.probe ? [0] : r.levels));
  };
  const restart = () => {
    const r = rt.current;

    r.streak = { streak: 0, mult: 1 };
    r.score = 0;
    session.playFromTick(model.startTick);
  };
  const pickRung = (index: number) => {
    const next = { index, clean: 0, fails: 0 };

    rt.current.ladder = next;
    setLadder(next);
  };
  const recordMiss = (note: TimelineNote, pass: number) => {
    const r = rt.current;
    const piece = pieceOf(note);
    const map = r.results.get(pass) ?? new Map<string, NoteResult>();

    if (!piece || map.has(note.id)) {
      return;
    }

    const result: NoteResult = { tier: 'miss' };
    const j = note.measureIdx - model.range.start;

    map.set(note.id, result);
    r.results.set(pass, map);
    r.streak = streakAfterMiss(r.streak);

    if (!r.probe && r.guide === 'adaptive' && r.levels[j] !== undefined) {
      r.levels[j] = fadeAfterMiss(r.levels[j]);
    }

    strip.current?.mark(pass, note.id, result, false);
    kitGlow.ring(piece.id, MISS_COLOR);
  };
  const inLoop = (note: TimelineNote) =>
    note.measureIdx >= model.range.start && note.measureIdx < model.range.end;

  useNoteJudgments(session, {
    onHit: (note, offsetSeconds) => {
      const r = rt.current;
      const piece = pieceOf(note);

      if (!piece || !inLoop(note)) {
        return;
      }

      // An early hit on the loop's first notes lands before the time wraps.
      const now = session.timeStore.get();
      const pass = now - note.time > model.span / 2 ? r.pass + 1 : r.pass;
      const map = r.results.get(pass) ?? new Map<string, NoteResult>();

      if (map.has(note.id)) {
        return;
      }

      const offsetMs = (offsetSeconds / session.playbackSpeed) * 1000;
      const tier = gradeHit(offsetMs);
      const result: NoteResult = { tier, offsetMs };
      const j = note.measureIdx - model.range.start;
      const level = r.probe ? 0 : r.levels[j] ?? 1;

      map.set(note.id, result);
      r.results.set(pass, map);
      r.streak = streakAfterHit(r.streak);
      r.score += hitPoints(tier, r.streak.mult, level);

      if (!r.probe) {
        if (r.guide === 'adaptive' && r.levels[j] !== undefined) {
          r.levels[j] = fadeAfterHit(r.levels[j], tier);
        }

        r.logs.set(piece.id, pushOffset(r.logs.get(piece.id), offsetMs));
      }

      strip.current?.mark(pass, note.id, result, !reduced);
      kitGlow.ring(piece.id, TIER_BY_ID[tier].color);
    },
    onMiss: (note) => {
      const r = rt.current;

      if (inLoop(note) && note.time >= r.passFrom) {
        recordMiss(note, r.pass);
      }
    },
  });

  usePadStrikes(session, (piece) => {
    if (piece) {
      kitGlow.flash(piece.id);
    }
  });

  /** The loop wrapped: score the pass that just ended and move the ladder. */
  const endPass = () => {
    const r = rt.current;
    const pass = r.pass;

    // Notes still open at the wrap (the last ones in the loop) count as missed.
    for (const ln of model.notes) {
      if (ln.note.time >= r.passFrom) {
        recordMiss(ln.note, pass);
      }
    }

    const results = [...(r.results.get(pass)?.values() ?? [])];

    r.pass += 1;
    r.passFrom = -Infinity;

    for (const p of r.results.keys()) {
      if (p < r.pass - 1) {
        r.results.delete(p);
      }
    }

    if (results.length === 0) {
      return;
    }

    const stats = evaluatePass(results);
    const tempo = session.playbackSpeed;
    const base = {
      ...stats,
      range: model.range,
      tempo,
      score: r.score,
      bonus: r.probe ? 2 : readingBonus(mean(r.levels)),
    };
    const seenTo = Math.max(progress.seenTo ?? 0, model.range.end);

    r.score = 0;

    if (r.probe) {
      r.probe = false;
      setProbe(false);

      const level = presetLevel(r.guide);

      if (level !== undefined) {
        r.levels = r.levels.map(() => level);
      }

      setAllProgress((all) => {
        const prev = all[songId] ?? EMPTY_PROGRESS;

        return {
          ...all,
          [songId]: {
            ...prev,
            seenTo: Math.max(prev.seenTo ?? 0, seenTo),
            probes: [
              {
                at: Date.now(),
                start: model.range.start,
                end: model.range.end,
                accuracy: stats.accuracy,
                sdMs: stats.sdMs,
                tempo,
              },
              ...prev.probes,
            ].slice(0, 8),
          },
        };
      });
      setReport({
        ...base,
        pass: undefined,
        verdict:
          'Logged in Reading progress. Practice continues on these bars; misses bring the guide back.',
        good: true,
      });
      setSpacing(laneSpacing(r.levels));

      return;
    }

    r.passCount += 1;

    const step = ladderStep(r.ladder, passOutcome(stats));

    r.ladder = step.state;
    setLadder(step.state);
    setReport({
      ...base,
      pass: r.passCount,
      verdict: step.verdict,
      good: step.good,
    });

    const sixteenthMs = (model.beatSeconds / 4 / tempo) * 1000;

    setCoach(coachReport(r.logs.entries(), coachBand(sixteenthMs)));
    setSpacing(laneSpacing(r.levels));
    setAllProgress((all) => {
      const prev = all[songId] ?? EMPTY_PROGRESS;
      const best100 =
        Math.abs(tempo - 1) < 1e-6
          ? Math.max(prev.best100 ?? 0, stats.accuracy)
          : prev.best100;

      return {
        ...all,
        [songId]: {
          ...prev,
          best100,
          seenTo: Math.max(prev.seenTo ?? 0, seenTo),
        },
      };
    });
  };
  /** Time jumped back without a wrap (seek, restart, play): drop the partial pass. */
  const abandonPass = (now: number) => {
    const r = rt.current;

    strip.current?.clearMarks(r.pass);
    strip.current?.clearMarks(r.pass + 1);
    r.results.delete(r.pass);
    r.results.delete(r.pass + 1);
    r.passFrom = now <= model.start + 0.3 ? -Infinity : now;
    r.score = 0;

    // A seek into the middle of an unseen-bars pass spoils it.
    if (r.probe && now > model.start + 0.3) {
      r.probe = false;
      setProbe(false);
      r.levels = initialLevels(r.guide, r.levels.length);
      setSpacing(laneSpacing(r.levels));
    }
  };

  useAnimationFrame(session, (now) => {
    const r = rt.current;
    const s = strip.current;

    if (!s || model.bars.length === 0) {
      return;
    }

    if (now < r.lastTime - 0.05) {
      const wrapped =
        r.wasPlaying &&
        r.lastTime >= model.end - 0.3 &&
        now <= model.start + 0.3;

      if (wrapped) {
        endPass();
      } else {
        abandonPass(now);
      }
    }

    r.lastTime = now;
    r.wasPlaying = session.isPlaying;

    const local = Math.max(-4, loopBeatAt(model, now));
    const vBeat = r.pass * model.beats + local;
    const p = Math.floor(vBeat / model.beats);
    const inPass = vBeat - p * model.beats;
    const j = loopBarAtBeat(model, inPass);
    const per = model.bars.length;
    const curV = p * per + j;

    s.ensure(curV - 1, curV + look + 1, statusOf);

    const bare = r.probe;
    const rate = session.playbackSpeed || 1;

    s.paint({
      levels: r.levels,
      bare,
      pass: r.pass,
      now,
      rate,
      aheadSeconds: gemsMs / 1000,
      statusOf,
    });

    const pos = stripPosition(
      motion,
      vBeat,
      p * model.beats + model.bars[j].beatOffset,
      ppb,
    );

    setAttr(
      r,
      stripRef.current,
      'transform',
      `translate(${pos.tx.toFixed(1)} 0)`,
    );
    setAttr(
      r,
      playheadRef.current,
      'transform',
      `translate(${pos.playheadX.toFixed(1)} 0)`,
    );
    setAttr(r, playheadRef.current, 'opacity', pos.playheadVisible ? '1' : '0');

    const jNow = local < 0 ? 0 : j;
    const lop = bare ? 0 : labelLevel(r.levels);

    setAttr(
      r,
      bandsRef.current,
      'opacity',
      (bare ? 0 : laneLevel(r.levels[jNow] ?? 1)).toFixed(3),
    );
    setAttr(r, labelsRef.current, 'opacity', lop.toFixed(2));
    setAttr(r, clefRef.current, 'opacity', (1 - lop).toFixed(2));
    guideBarEls.current.forEach((el, i) =>
      setAttr(r, el, 'style.width', `${Math.round((r.levels[i] ?? 0) * 100)}%`),
    );
    setAttr(
      r,
      streakRef.current,
      'text',
      r.streak.streak >= 5
        ? `Streak ${r.streak.streak}${
            r.streak.mult > 1 ? ` · ×${r.streak.mult}` : ''
          }`
        : '',
    );

    // Closing rings on the pads during the beat before each note.
    const glowLevel = bare ? 0 : kitGlowLevel(r.levels);
    const near = new Map<string, number>();

    if (glowLevel > 0) {
      s.upcoming(r.pass, now, model.beatSeconds, statusOf, (ln, dt) => {
        const piece = pieceOf(ln.note);
        const u = dt / model.beatSeconds;

        if (piece && (near.get(piece.id) ?? Infinity) > u) {
          near.set(piece.id, u);
        }
      });
    }

    kitGlow.glow(glowLevel, near);
  });

  const sectionValue = sections.findIndex(
    (sec) => sec.start === range.start && sec.end === range.end,
  );
  const barCount = range.end - range.start;
  const pieceById = useMemo(
    () => new Map(kit.pieces.map((p) => [p.id, p])),
    [kit.pieces],
  );

  return (
    <div className="flex flex-col gap-4 p-4 font-ui text-text-body">
      <p className="m-0 text-[13px] text-text-muted max-w-[80ch]">
        Your sheet music, mapped to your kit. Each staff line starts as a wide
        lane labeled with the pad that plays it, notes are colored gems, and the
        kit glows just before each hit. As you get the loop, the lanes narrow,
        the labels and colors fade and the kit hints go quiet, until it&rsquo;s
        just the bars. Misses bring the guide back.
      </p>

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<FontAwesomeIcon icon={faRotateLeft} />}
            onClick={restart}
          >
            Restart
          </Button>
          <Button
            icon={<FontAwesomeIcon icon={faAngleLeft} />}
            aria-label="Previous 4 bars"
            disabled={range.start === 0}
            onClick={() => pickRange(shiftRange(range, -1, bars.length))}
          />
          <span className="text-[13px] text-text tabular-nums min-w-[86px] text-center">
            {rangeLabel(range)}
          </span>
          <Button
            icon={<FontAwesomeIcon icon={faAngleRight} />}
            aria-label="Next 4 bars"
            disabled={range.start + 4 >= bars.length}
            onClick={() => pickRange(shiftRange(range, 1, bars.length))}
          />
          {sections.length > 0 && (
            <Select
              className="min-w-[150px]"
              placeholder="Section"
              value={sectionValue >= 0 ? sectionValue : undefined}
              onChange={(i: number) => {
                const sec = sections[i];

                if (sec) {
                  pickRange({ start: sec.start, end: sec.end });
                }
              }}
              options={sections.map((sec, i) => ({
                value: i,
                label: `${sec.name} · ${rangeLabel(sec)}`,
              }))}
              popupMatchSelectWidth={false}
            />
          )}
          <Tooltip title="Loop the next bars you haven't played, sheet only, at 100%, and log that first pass in Reading progress">
            <Button
              icon={<FontAwesomeIcon icon={faEye} />}
              disabled={probe || !unseenAvailable}
              onClick={startUnseen}
            >
              Next unseen bars
            </Button>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<GuideMode>
            aria-label="Guide"
            value={guide}
            options={GUIDE_MODES}
            onChange={changeGuide}
          />
          <Segmented<Motion>
            aria-label="Staff motion"
            value={motion}
            options={MOTIONS}
            onChange={setMotion}
          />
          <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
            Read ahead
            <Select
              value={look}
              onChange={setLook}
              options={LOOK_AHEAD_OPTIONS.map((n) => ({
                value: n,
                label: `${n} bar${n > 1 ? 's' : ''}`,
              }))}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-text-muted">
            Gems show
            <Select
              value={gemsMs}
              onChange={setGemsMs}
              options={GEMS_AHEAD_OPTIONS.map((ms) => ({
                value: ms,
                label: `${ms / 1000} s ahead`,
              }))}
            />
          </label>
          <Checkbox
            checked={session.clickVolume > 0}
            onChange={(e) => session.setClickVolume(e.target.checked ? 0.7 : 0)}
          >
            Click
          </Checkbox>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 min-[900px]:grid-cols-[minmax(240px,30%)_minmax(0,1fr)]">
        <div className="flex items-center rounded-[14px] border border-border bg-[#121315] p-2">
          <GuideKit kit={kit} glow={kitGlow} onStrike={session.strikePiece} />
        </div>
        <div className="overflow-x-auto rounded-[10px]">
          <div
            className="relative rounded-[10px] min-w-[720px]"
            style={{
              background: 'var(--color-paper)',
              boxShadow: 'var(--shadow-paper)',
            }}
          >
            <div className="absolute top-2 right-2.5 flex gap-1.5 pointer-events-none">
              {probe && (
                <span className="font-semibold text-[12px] rounded-full px-2.5 py-[3px] bg-[#c4402a] text-[#f2ede1]">
                  Unseen bars · sheet only · 100%
                </span>
              )}
              <span
                ref={streakRef}
                className="font-semibold text-[12px] rounded-full px-2.5 py-[3px] bg-[#1c1a14] text-[#f2ede1] empty:hidden"
              />
            </div>
            <svg
              viewBox={`0 0 ${VIEW_W} ${geo.height}`}
              className="block w-full h-auto"
              aria-label="Sheet music mapped to your kit"
            >
              <g ref={bandsRef} opacity={0}>
                {laneVoices.map(({ voice, piece }) => (
                  <rect
                    key={voice.id}
                    x={LABEL_W}
                    y={stepY(geo, voice.step) - geo.sp / 2}
                    width={VIEW_W - LABEL_W}
                    height={geo.sp}
                    fill={piece.color}
                  />
                ))}
              </g>
              <StaffLines geo={geo} width={VIEW_W} />
              <g ref={stripRef} />
              <rect
                x={0}
                y={0}
                width={LABEL_W}
                height={geo.height}
                fill="var(--color-paper)"
              />
              <StaffLines geo={geo} width={LABEL_W} />
              <g ref={clefRef} opacity={0}>
                <rect
                  x={20}
                  y={stepY(geo, 6)}
                  width={6}
                  height={stepY(geo, 2) - stepY(geo, 6)}
                  fill={INK}
                />
                <rect
                  x={32}
                  y={stepY(geo, 6)}
                  width={6}
                  height={stepY(geo, 2) - stepY(geo, 6)}
                  fill={INK}
                />
              </g>
              <g ref={labelsRef}>
                {laneVoices.map(({ voice, piece, label }) => (
                  <g key={voice.id}>
                    <circle
                      cx={LABEL_W - 14}
                      cy={stepY(geo, voice.step)}
                      r={4.5}
                      fill={piece.color}
                    />
                    <text
                      x={LABEL_W - 24}
                      y={stepY(geo, voice.step) + 4.5}
                      textAnchor="end"
                      fontSize={13}
                      fontWeight={600}
                      fill={INK}
                      fontFamily="var(--font-ui)"
                    >
                      {label}
                    </text>
                  </g>
                ))}
              </g>
              <g ref={playheadRef}>
                <rect
                  x={-16}
                  y={geo.top + 18}
                  width={32}
                  height={geo.bottom - geo.top - 40}
                  fill={PLAYHEAD_COLOR}
                  fillOpacity={0.08}
                />
                <line
                  x1={0}
                  x2={0}
                  y1={geo.top + 18}
                  y2={geo.bottom - 22}
                  stroke={PLAYHEAD_COLOR}
                  strokeWidth={2.5}
                />
              </g>
            </svg>
          </div>
        </div>
      </div>

      <div className="grid gap-4 items-start grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_300px]">
        <SummaryPanel
          report={report}
          windowMs={(engine.hitTolerance / speed) * 1000}
          guide={
            <GuideBars
              count={barCount}
              mode={guide}
              barRef={(i, el) => {
                guideBarEls.current[i] = el;
              }}
            />
          }
        />
        <CoachPanel report={coach} pieceOf={(id) => pieceById.get(id)} />
        <Panel className="md:col-span-2 xl:col-span-1">
          <TempoLadder
            ladder={ladder}
            bpm={60 / model.beatSeconds}
            speed={speed}
            onPick={pickRung}
          />
          <h3 className="m-0 font-ui font-semibold text-[11px] leading-none tracking-[.12em] uppercase text-text-muted">
            Reading progress
          </h3>
          <ReadingProgress progress={progress} />
        </Panel>
      </div>
    </div>
  );
}

function StaffLines({
  geo,
  width,
}: {
  geo: ReturnType<typeof staffGeometry>;
  width: number;
}) {
  return (
    <>
      {LINE_STEPS.map((step) => (
        <line
          key={step}
          x1={0}
          x2={width}
          y1={stepY(geo, step)}
          y2={stepY(geo, step)}
          stroke={INK}
          strokeOpacity={0.4}
          strokeWidth={1.2}
        />
      ))}
    </>
  );
}
