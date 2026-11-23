import { Measure, Note, ParsedChart } from '../../../chart-parser/types';
import { InputMapping } from '../../../types';
import { InputEvent } from '../../input/types';
import { secondsToTicks, ticksToSeconds } from '../../../chart-parser/timing';
import {
  JudgeContext,
  JudgeGateHandler,
  JudgeHitHandler,
  JudgedHitHandler,
  LoopRegion,
  NoteEntry,
} from './types';
import {
  ACCENT_VALUE_THRESHOLD,
  ELEMENT_TO_KEYS,
  GHOST_VALUE_THRESHOLD,
  HIT_TOLERANCE_SECONDS,
} from './constants';
import { keyPrefix } from './helpers';
import { lowerBound } from '../../helpers';

export class Judge {
  private chart: ParsedChart | undefined;
  private measures: Measure[] = [];
  private noteIndex: NoteEntry[] = [];
  private mapping: InputMapping = {};
  private loopRegion: LoopRegion | undefined;
  private enabled = false;
  private currentTick: number | undefined;
  private hits = new Map<number, Set<string>>();
  private hitTotal = 0;
  private falseHitTicks: number[] = [];
  private hitListeners = new Set<JudgeHitHandler>();
  private judgedListeners = new Set<JudgedHitHandler>();
  private toleranceSeconds = HIT_TOLERANCE_SECONDS;
  // Miss gate: closes when a note comes due with none of its mapped parts hit,
  // reopens on the next correct hit. Drives "mute drums on miss".
  private mappedPrefixes = new Set<string>();
  private gateOpen = true;
  private gateIdx = 0;
  private gateTick: number | undefined;
  private gateLookaheadSeconds = 0;
  private gateListeners = new Set<JudgeGateHandler>();
  /** Ticks a hit is offered to first (wait mode's held notes). */
  private focusTicks = new Set<number>();

  setContext(context: JudgeContext): void {
    const chartChanged = this.chart !== context.chart;
    const measuresChanged = this.measures !== context.measures;

    this.chart = context.chart;
    this.mapping = context.mapping;
    this.measures = context.measures;
    this.mappedPrefixes = new Set(
      Object.entries(context.mapping).flatMap(([element, controls]) =>
        controls && controls.length > 0 ? ELEMENT_TO_KEYS[element] ?? [] : [],
      ),
    );

    if (measuresChanged) {
      this.buildNoteIndex();
    }

    if (chartChanged) {
      this.reset();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Notes the song is holding for (wait mode). A hit that matches one of them
   * goes to it, at any distance and any velocity, before the nearest note is
   * considered: the held note is what the player is reaching for, and the song
   * stops a little after it, so a following note on the same pad can be
   * nearer and would otherwise take every hit, leaving the song stuck.
   */
  setFocus(ticks: Iterable<number>): void {
    this.focusTicks = new Set(ticks);
  }

  /** Half-width of the hit window, in seconds, on either side of a note. */
  setTolerance(seconds: number): void {
    this.toleranceSeconds = seconds;
  }

  get tolerance(): number {
    return this.toleranceSeconds;
  }

  /**
   * How far ahead of the audible position notes are checked by the miss gate,
   * so a mute scheduled now lands when the note is actually heard.
   */
  setGateLookahead(seconds: number): void {
    this.gateLookaheadSeconds = Math.max(0, seconds);
  }

  onGateChange(listener: JudgeGateHandler): () => void {
    this.gateListeners.add(listener);

    return () => {
      this.gateListeners.delete(listener);
    };
  }

  get isGateOpen(): boolean {
    return this.gateOpen;
  }

  setLoopRegion(region: LoopRegion | undefined): void {
    this.loopRegion = region;
    this.buildNoteIndex();
  }

  setTick(tick: number | undefined): void {
    if (tick === undefined) {
      this.currentTick = undefined;

      return;
    }

    const effectiveTick = this.wrapLoopTick(tick);

    if (
      this.loopRegion &&
      this.currentTick !== undefined &&
      effectiveTick < this.currentTick
    ) {
      this.rewindTo(effectiveTick);

      return;
    }

    this.currentTick = effectiveTick;
    this.updateGate(effectiveTick);
  }

  rewindTo(tick: number): void {
    for (const [hitTick, prefixes] of this.hits) {
      if (hitTick >= tick) {
        this.hitTotal -= prefixes.size;
        this.hits.delete(hitTick);
      }
    }

    this.falseHitTicks = this.falseHitTicks.filter((t) => t < tick);
    this.currentTick = tick;
    this.resetGate(tick);
  }

  onHit(listener: JudgeHitHandler): () => void {
    this.hitListeners.add(listener);

    return () => {
      this.hitListeners.delete(listener);
    };
  }

  /** Like `onHit`, with the hit's timing offset and source control. */
  onJudged(listener: JudgedHitHandler): () => void {
    this.judgedListeners.add(listener);

    return () => {
      this.judgedListeners.delete(listener);
    };
  }

  isHit(tick: number, prefix: string): boolean {
    return this.hits.get(tick)?.has(prefix) ?? false;
  }

  get hitCount(): number {
    return this.hitTotal;
  }

  get falseHitCount(): number {
    return this.falseHitTicks.length;
  }

  reset(): void {
    this.hits.clear();
    this.hitTotal = 0;
    this.falseHitTicks = [];
    this.focusTicks.clear();
    this.resetGate(undefined);
  }

  private buildNoteIndex(): void {
    const index: NoteEntry[] = [];
    const loop = this.loopRegion;
    const hasLoop = loop !== undefined && loop.endTick > loop.startTick;

    this.measures.forEach((measure, measureIdx) => {
      measure.notes.forEach((note, noteIdx) => {
        if (
          !note.isRest &&
          (!hasLoop ||
            (note.tick >= loop.startTick && note.tick < loop.endTick))
        ) {
          index.push({ tick: note.tick, note, pos: { measureIdx, noteIdx } });
        }
      });
    });

    index.sort((a, b) => a.tick - b.tick);
    this.noteIndex = index;
    this.resetGate(this.currentTick);
  }

  private setGate(open: boolean): void {
    if (this.gateOpen === open) {
      return;
    }

    this.gateOpen = open;
    this.gateListeners.forEach((listener) => listener(open));
  }

  private resetGate(tick: number | undefined): void {
    this.gateIdx = tick === undefined ? 0 : this.firstNoteAtOrAfter(tick);
    this.gateTick = tick;
    this.setGate(true);
  }

  private updateGate(tick: number): void {
    const chart = this.chart;

    if (!this.enabled || !chart) {
      return;
    }

    if (this.gateTick !== undefined && tick < this.gateTick) {
      this.resetGate(tick);
    }

    this.gateTick = tick;

    const currentTimeS = ticksToSeconds(tick, chart.resolution, chart.tempos);
    const dueTick = secondsToTicks(
      currentTimeS + this.gateLookaheadSeconds,
      chart.resolution,
      chart.tempos,
    );

    while (
      this.gateIdx < this.noteIndex.length &&
      this.noteIndex[this.gateIdx].tick <= dueTick
    ) {
      const entry = this.noteIndex[this.gateIdx];
      const mapped = entry.note.notes
        .map(keyPrefix)
        .filter((p) => this.mappedPrefixes.has(p));

      if (mapped.length > 0 && !mapped.some((p) => this.isHit(entry.tick, p))) {
        this.setGate(false);
      }

      this.gateIdx += 1;
    }
  }

  private wrapLoopTick(tick: number): number {
    const loop = this.loopRegion;
    const chart = this.chart;

    if (
      !loop ||
      !chart ||
      loop.endTick <= loop.startTick ||
      this.noteIndex.length === 0 ||
      tick < loop.startTick ||
      tick >= loop.endTick
    ) {
      return tick;
    }

    const currentTimeS = ticksToSeconds(tick, chart.resolution, chart.tempos);
    const toleranceTicks =
      secondsToTicks(
        currentTimeS + this.toleranceSeconds,
        chart.resolution,
        chart.tempos,
      ) - tick;
    const nextFirstTick =
      loop.endTick + (this.noteIndex[0].tick - loop.startTick);
    const lastTick = this.noteIndex[this.noteIndex.length - 1].tick;
    const seamTick = Math.max(
      nextFirstTick - toleranceTicks,
      (lastTick + nextFirstTick) / 2,
    );

    return tick >= seamTick ? tick - (loop.endTick - loop.startTick) : tick;
  }

  /** The earliest held note that can take the hit, if any. */
  private focusedEntry(
    takes: (entry: NoteEntry) => boolean,
  ): NoteEntry | undefined {
    const ticks = [...this.focusTicks].sort((a, b) => a - b);

    for (const focusTick of ticks) {
      for (
        let i = this.firstNoteAtOrAfter(focusTick);
        i < this.noteIndex.length && this.noteIndex[i].tick === focusTick;
        i += 1
      ) {
        if (takes(this.noteIndex[i])) {
          return this.noteIndex[i];
        }
      }
    }

    return undefined;
  }

  private firstNoteAtOrAfter(tick: number): number {
    return lowerBound(
      this.noteIndex.length,
      (index) => this.noteIndex[index].tick >= tick,
    );
  }

  private recordHit(tick: number, prefix: string): void {
    let prefixes = this.hits.get(tick);

    if (!prefixes) {
      prefixes = new Set();
      this.hits.set(tick, prefixes);
    }

    if (!prefixes.has(prefix)) {
      prefixes.add(prefix);
      this.hitTotal += 1;
    }
  }

  private containingMeasure(tick: number): Measure | undefined {
    const firstAfter = lowerBound(
      this.measures.length,
      (index) => this.measures[index].startTick > tick,
    );
    const candidate = this.measures[firstAfter - 1];

    if (candidate && tick >= candidate.startTick && tick < candidate.endTick) {
      return candidate;
    }

    return undefined;
  }

  private isInSilentRegion(tick: number): boolean {
    const containing = this.containingMeasure(tick);

    if (!containing) {
      return true;
    }

    return containing.notes.every((note) => note.isRest);
  }

  private hasScoreableNoteNear(tick: number, toleranceTicks: number): boolean {
    const entry =
      this.noteIndex[this.firstNoteAtOrAfter(tick - toleranceTicks)];

    return entry !== undefined && entry.tick <= tick + toleranceTicks;
  }

  private maybeRecordFalseHit(tick: number, toleranceTicks: number): void {
    if (
      !this.isInSilentRegion(tick) ||
      this.hasScoreableNoteNear(tick, toleranceTicks)
    ) {
      this.falseHitTicks.push(tick);
    }
  }

  handleInput({ controlId, value }: InputEvent): void {
    if (value === 0 || !this.enabled) {
      return;
    }

    const expectedPrefixes = new Set(
      Object.entries(this.mapping).flatMap(([element, controls]) =>
        controls?.includes(controlId) ? ELEMENT_TO_KEYS[element] ?? [] : [],
      ),
    );

    if (expectedPrefixes.size === 0) {
      return;
    }

    const tick = this.currentTick;
    const chart = this.chart;

    if (tick === undefined || chart === undefined) {
      return;
    }

    const currentTimeS = ticksToSeconds(tick, chart.resolution, chart.tempos);
    const toleranceTicks =
      secondsToTicks(
        currentTimeS + this.toleranceSeconds,
        chart.resolution,
        chart.tempos,
      ) - tick;
    // A note can take this hit if one of its parts matches and isn't hit yet;
    // a note already fully hit doesn't soak up the next hit.
    const takes = (entry: NoteEntry) =>
      entry.note.notes.some((k) => {
        const p = keyPrefix(k);

        return expectedPrefixes.has(p) && !this.isHit(entry.tick, p);
      });
    let best = this.focusedEntry(takes);
    const focused = best !== undefined;
    let bestDist = Infinity;

    for (
      let i = this.firstNoteAtOrAfter(tick - toleranceTicks);
      !focused && i < this.noteIndex.length;
      i += 1
    ) {
      const entry = this.noteIndex[i];

      if (entry.tick > tick + toleranceTicks) {
        break;
      }

      const dist = Math.abs(entry.tick - tick);

      if (dist < bestDist && takes(entry)) {
        bestDist = dist;
        best = entry;
      }
    }

    if (!best) {
      this.maybeRecordFalseHit(tick, toleranceTicks);

      return;
    }

    const hit: Note = best.note;
    const { pos } = best;
    const accentPrefixes = new Set((hit.accents ?? []).map(keyPrefix));
    const ghostPrefixes = new Set((hit.ghosts ?? []).map(keyPrefix));
    const passesVelocity = (prefix: string) => {
      if (accentPrefixes.has(prefix)) {
        return value > ACCENT_VALUE_THRESHOLD;
      }

      if (ghostPrefixes.has(prefix)) {
        return value < GHOST_VALUE_THRESHOLD;
      }

      return true;
    };
    const newPrefixes = hit.notes.map(keyPrefix).filter(
      (p) =>
        expectedPrefixes.has(p) &&
        !this.isHit(hit.tick, p) &&
        // A held note takes any velocity: wait mode is for finding the
        // pads, and a ghost note a keyboard can't play softly enough for
        // would hold the song forever.
        (focused || passesVelocity(p)),
    );

    if (newPrefixes.length === 0) {
      this.maybeRecordFalseHit(tick, toleranceTicks);

      return;
    }

    newPrefixes.forEach((p) => this.recordHit(hit.tick, p));
    this.setGate(true);
    this.hitListeners.forEach((listener) => listener(pos, newPrefixes));

    if (this.judgedListeners.size > 0) {
      const offsetSeconds =
        currentTimeS - ticksToSeconds(hit.tick, chart.resolution, chart.tempos);

      this.judgedListeners.forEach((listener) =>
        listener({
          pos,
          tick: hit.tick,
          prefixes: newPrefixes,
          offsetSeconds,
          controlId,
          value,
        }),
      );
    }
  }
}
