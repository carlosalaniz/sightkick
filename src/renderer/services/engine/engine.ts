import { Measure, ParsedChart } from '../../../chart-parser/types';
import { InputMapping, ScoreData } from '../../../types';
import { secondsToTicks } from '../../../chart-parser/timing';
import { TimeStore } from '../time-store';
import { AudioPlayer } from '../audio-player/types';
import { playerFactoryForMode } from '../audio-player/factories';
import { Transport } from './transport';
import { Judge } from './judge';
import { GameRenderer } from './game-renderer';
import { DRUM_GATE_FADE_SECONDS, DRUM_STEM_NAME } from './constants';
import {
  EngineContext,
  EngineOptions,
  GameRendererRefs,
  EngineSettings,
  JudgedHitHandler,
  JudgeSettings,
  LoopRegion,
  PlaybackSnapshot,
  PriorityTargetOptions,
} from './types';

/**
 * Wait mode's policy for the notes it holds for. A hit on their pad goes to
 * them first, however far off: the song stops a little after the held note,
 * so a following note on the same pad can be nearer and would otherwise take
 * every hit, leaving the song stuck. And at any velocity: wait mode is for
 * finding the pads, and a ghost note a keyboard can't play softly enough for
 * would hold the song forever.
 */
const WAIT_MODE_TARGETS: PriorityTargetOptions = { velocity: 'any' };

export class Engine {
  private transport: Transport;
  private player: AudioPlayer | undefined;
  private judge = new Judge();
  private renderer = new GameRenderer((tick, key) =>
    this.judge.isHit(tick, key),
  );
  private onEndedCb: (score: ScoreData) => void;
  private chart: ParsedChart | undefined;
  private measures: Measure[] = [];
  private delaySeconds = 0;
  private mapping: InputMapping = {};
  private timeUnsub: () => void;
  private transportUnsub: () => void;
  private inputUnsub: () => void;
  private hitUnsub: () => void;
  private gateUnsub: () => void;
  // Volumes the user set in the mixer; the miss gate is applied on top.
  private stemGains = new Map<string, number>();
  private muteDrumsOnMiss = false;

  constructor(options: EngineOptions) {
    this.onEndedCb = options.onEnded;

    const createPlayer = playerFactoryForMode(options.player);

    this.transport = new Transport({
      trackData: options.trackData,
      isDev: options.isDev,
      createPlayer: (trackConfigs, onEnded, getMinDurationSeconds) => {
        this.player = createPlayer(
          trackConfigs,
          onEnded,
          getMinDurationSeconds,
        );

        return this.player;
      },
      onEnded: () => this.handleEnded(),
      onError: options.onError,
      onSeek: (tick) => this.judge.rewindTo(tick),
    });
    this.timeUnsub = this.transport.timeStore.subscribe(this.handleFrame);
    this.transportUnsub = this.transport.subscribe(this.handleTransportChange);
    this.inputUnsub = options.subscribeInput((event) =>
      this.judge.handleInput(event),
    );
    this.hitUnsub = this.judge.onHit((pos, prefixes) =>
      this.renderer.paintHit(pos, prefixes),
    );
    this.gateUnsub = this.judge.onGateChange(() =>
      this.applyDrumGain(DRUM_GATE_FADE_SECONDS),
    );
  }

  get timeStore(): TimeStore {
    return this.transport.timeStore;
  }

  subscribe = (listener: () => void): (() => void) =>
    this.transport.subscribe(listener);

  getSnapshot = (): PlaybackSnapshot => this.transport.getSnapshot();

  setContext(context: EngineContext): void {
    this.chart = context.chart;
    this.measures = context.measures;
    this.delaySeconds = context.delaySeconds;
    this.mapping = context.mapping;
    this.renderer.setContext({
      chart: context.chart,
      renderData: context.renderData,
    });
    this.transport.setContext({
      chart: context.chart,
      measures: context.measures,
      delaySeconds: context.delaySeconds,
      countInEnabled: context.countInEnabled,
      finishAfterLastNote: context.finishAfterLastNote,
      minDurationSeconds: context.minDurationSeconds,
    });
    this.judge.setContext({
      chart: context.chart,
      measures: context.measures,
      mapping: context.mapping,
    });

    this.renderFrame();
  }

  setSettings(settings: EngineSettings): void {
    this.renderer.setSettings(settings.playheadStyle);
    this.renderFrame();
  }

  setClickSettings(volume: number, tone: number): void {
    this.transport.setClickSettings(volume, tone);
  }

  setMapping(mapping: InputMapping): void {
    this.mapping = mapping;
    this.judge.setContext({
      chart: this.chart,
      measures: this.measures,
      mapping,
    });
  }

  setRendererRefs(rendererRefs: GameRendererRefs): void {
    this.renderer.setRefs(rendererRefs);
    this.renderFrame();
  }

  setDev(isDev: boolean): void {
    this.transport.setDev(isDev);
  }

  setLoopRegion(region: LoopRegion | undefined): void {
    this.judge.setLoopRegion(region);
    this.transport.setLoopRegion(region);
  }

  play(): void {
    this.transport.play();
  }

  playFromTick(tick: number): void {
    this.judge.clearPriorityTargets();
    this.transport.playFromTick(tick);
  }

  pause(): void {
    this.transport.pause();
  }

  cancel(): void {
    this.transport.cancel();
  }

  /**
   * Wait mode: freeze playback on the spot until `release`. `ticks` are the
   * notes it waits for; a matching hit goes to them first.
   */
  hold(ticks: Iterable<number> = []): void {
    this.judge.setPriorityTargets(ticks, WAIT_MODE_TARGETS);
    this.transport.hold();
  }

  release(): void {
    this.judge.clearPriorityTargets();
    this.transport.release();
  }

  get isHeld(): boolean {
    return this.transport.isHeld;
  }

  /** Also ends a hold (wait mode's run-up rewinds this way). */
  seekSeconds(seconds: number): void {
    this.judge.clearPriorityTargets();
    this.transport.seekSeconds(seconds);
  }

  /** Scored hits with their timing offsets. */
  onJudged(listener: JudgedHitHandler): () => void {
    return this.judge.onJudged(listener);
  }

  /** Whether the note key prefix at this tick has been hit in the current pass. */
  isHit(tick: number, prefix: string): boolean {
    return this.judge.isHit(tick, prefix);
  }

  /** Half-width of the hit window, in seconds. */
  get hitTolerance(): number {
    return this.judge.tolerance;
  }

  setStemVolume(name: string, gain: number): void {
    this.stemGains.set(name, gain);

    if (name === DRUM_STEM_NAME) {
      this.applyDrumGain();
    } else {
      this.transport.setStemVolume(name, gain);
    }
  }

  setJudgeSettings(settings: JudgeSettings): void {
    this.judge.setTolerance(settings.hitToleranceSeconds);
    this.transport.setHitTolerance(settings.hitToleranceSeconds);
    this.muteDrumsOnMiss = settings.muteDrumsOnMiss;
    this.applyDrumGain();
  }

  /** False when the song has no separate drum track to silence. */
  get hasDrumStem(): boolean {
    return this.transport.hasStem(DRUM_STEM_NAME);
  }

  setMasterVolume(gain: number): void {
    this.transport.setMasterVolume(gain);
  }

  setPlaybackSpeed(speed: number): void {
    this.transport.setPlaybackSpeed(speed);
  }

  renderFrame(): void {
    if (!this.chart) {
      return;
    }

    const chartTime = this.transport.timeStore.get() - this.delaySeconds;
    const tick = secondsToTicks(
      chartTime,
      this.chart.resolution,
      this.chart.tempos,
    );

    this.judge.setGateLookahead(this.transport.outputLatency);
    this.judge.setTick(tick);
    this.renderer.render(chartTime, tick);
  }

  dispose(): void {
    this.timeUnsub();
    this.transportUnsub();
    this.inputUnsub();
    this.hitUnsub();
    this.gateUnsub();
    this.transport.dispose();
  }

  private applyDrumGain(fadeSeconds = 0): void {
    const userGain = this.stemGains.get(DRUM_STEM_NAME) ?? 1;
    const gated = this.muteDrumsOnMiss && !this.judge.isGateOpen;

    this.transport.setStemVolume(
      DRUM_STEM_NAME,
      gated ? 0 : userGain,
      fadeSeconds,
    );
  }

  private handleFrame = (): void => {
    this.renderFrame();
  };

  private handleTransportChange = (): void => {
    this.judge.setEnabled(this.transport.getSnapshot().isPlaying);
  };

  private handleEnded(): void {
    this.onEndedCb({
      hitNotes: this.judge.hitCount,
      falseHits: this.judge.falseHitCount,
      totalNotes: this.totalNotes(),
    });
  }

  private totalNotes(): number {
    return this.measures
      .flatMap((measure) => measure.notes)
      .filter((note) => !note.isRest)
      .reduce((sum, note) => sum + note.notes.length, 0);
  }
}
