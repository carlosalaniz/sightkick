import { Measure, ParsedChart } from '../../../chart-parser/types';
import {
  AudioPlayer,
  AudioPlayerFactory,
  isSpeedControllable,
  SpeedControllableAudioPlayer,
  TrackConfig,
} from '../audio-player';
import { TimeStore } from '../time-store';
import { secondsToTicks, ticksToSeconds } from '../../../chart-parser/timing';
import {
  ClickTrack,
  CountInScheduler,
  DEFAULT_CLICK_TONE,
} from '../click-track';
import { Beat, getBeatGrid, getCountInInfo } from '../beat-grid';
import {
  LoopRegion,
  PlaybackSnapshot,
  PlaybackState,
  TransportContext,
  TransportOptions,
} from './types';
import {
  CLICK_GAIN_RAMP_SECONDS,
  COUNT_IN_MIN_VOLUME,
  HIT_TOLERANCE_SECONDS,
  HOLD_FADE_SECONDS,
  LOOKAHEAD_SECONDS,
  SNAPSHOT_KEYS,
} from './constants';

/**
 * How far behind the frozen time a resumed song may read and still count as
 * settling; anything further is a real jump (a loop wrap) and is shown.
 */
const SETTLE_SECONDS = 0.25;

export class Transport {
  readonly timeStore = new TimeStore();
  private isDev: boolean;
  private onEndedCb: () => void;
  private onErrorCb: () => void;
  private onSeekCb: (tick: number) => void;
  private chart: ParsedChart | undefined;
  private hitToleranceSeconds = HIT_TOLERANCE_SECONDS;
  private measures: Measure[] = [];
  private delaySeconds = 0;
  private countInEnabled = false;
  private finishAfterLastNote = true;
  private minDurationSeconds = 0;
  private createPlayer: AudioPlayerFactory;
  private createdPlayer: AudioPlayer | undefined;
  private audioPlayer: AudioPlayer | undefined;
  private held = false;
  /**
   * Song time at the moment of a hold, reported until the context runs again.
   * A suspended context's player stops subtracting its output latency, so its
   * own time jumps ahead by it (0.1-0.3 s on Bluetooth output); left alone,
   * that jump could carry the held note out of wait mode's window and make
   * the song stutter between hold and release.
   */
  private frozenTime: number | undefined;
  /** A release's resume is in flight: the context is still frozen. */
  private resuming = false;
  private freezeTimer: ReturnType<typeof setTimeout> | undefined;
  private speedPlayer: SpeedControllableAudioPlayer | undefined;
  private state: PlaybackState = 'idle';
  private isStarted = false;
  private position = 0;
  private clickTrack: ClickTrack | undefined;
  private clickVolume = 0;
  private clickTone = DEFAULT_CLICK_TONE;
  private beatGrid: Beat[] = [];
  private nextBeatIndex = 0;
  private countIn: CountInScheduler | undefined;
  private songStartCtx: number | undefined;
  private raf: number | undefined;
  private loopRegion: LoopRegion | undefined;
  private loopBeatOffset = 0;
  private playGeneration = 0;
  private pendingSpeed: number | undefined;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: PlaybackSnapshot;

  constructor(options: TransportOptions) {
    this.isDev = options.isDev;
    this.createPlayer = options.createPlayer;
    this.onEndedCb = options.onEnded;
    this.onErrorCb = options.onError;
    this.onSeekCb = options.onSeek ?? (() => {});
    this.snapshot = this.buildSnapshot();

    if (options.trackData.length > 0) {
      this.initAudio(options.trackData);
    }

    this.startPolling();
  }

  setContext(context: TransportContext): void {
    this.chart = context.chart;
    this.measures = context.measures;
    this.delaySeconds = context.delaySeconds;
    this.countInEnabled = context.countInEnabled;
    this.finishAfterLastNote = context.finishAfterLastNote ?? true;
    this.minDurationSeconds = context.minDurationSeconds;
    this.beatGrid = context.chart
      ? getBeatGrid(context.measures, context.chart)
      : [];
    this.syncPlayerLoop();
  }

  setClickSettings(volume: number, tone: number): void {
    this.clickVolume = Math.max(0, Math.min(1, volume));
    this.clickTone = tone;
    this.clickTrack?.setTone(tone);
    this.applyClickVolume();
  }

  private applyClickVolume(): void {
    if (!this.clickTrack || !this.audioPlayer) {
      return;
    }

    if (this.state === 'playing') {
      this.clickTrack.cancelGain();
      this.clickTrack.setGain(this.clickVolume);
    } else if (
      this.state === 'counting-in' &&
      this.songStartCtx !== undefined
    ) {
      const countInVolume = Math.max(this.clickVolume, COUNT_IN_MIN_VOLUME);

      this.clickTrack.cancelGain();
      this.clickTrack.setGain(countInVolume);
      this.clickTrack.rampGain(
        countInVolume,
        this.clickVolume,
        this.songStartCtx,
        CLICK_GAIN_RAMP_SECONDS,
      );
    }
  }

  setDev(isDev: boolean): void {
    this.isDev = isDev;
  }

  setPlaybackSpeed(speed: number): void {
    // A held song's context is suspended, and the player only re-times its
    // audio for a new speed while the context runs: changed then, the song
    // jumped ahead on release. It takes the new speed once it runs again.
    if (this.state === 'counting-in' || this.isFrozen) {
      this.pendingSpeed = speed;

      return;
    }

    this.pendingSpeed = undefined;
    this.applyPlaybackSpeed(speed);
  }

  private applyPlaybackSpeed(speed: number): void {
    const changed =
      this.speedPlayer !== undefined &&
      speed !== this.speedPlayer.playbackSpeed;

    this.speedPlayer?.setPlaybackSpeed(speed);

    if (changed && this.state === 'playing') {
      this.resyncClickScheduling(this.position);
    }
  }

  private flushPendingSpeed(): void {
    if (this.pendingSpeed === undefined) {
      return;
    }

    this.applyPlaybackSpeed(this.pendingSpeed);
    this.pendingSpeed = undefined;
  }

  setLoopRegion(region: LoopRegion | undefined): void {
    const previous = this.loopRegion;
    const unchanged =
      previous?.startTick === region?.startTick &&
      previous?.endTick === region?.endTick;

    this.loopRegion = region;
    this.syncPlayerLoop();

    if (unchanged) {
      return;
    }

    if (!region) {
      if (this.state === 'playing') {
        this.resyncClickScheduling(this.position);
      }

      return;
    }

    const active = this.state === 'playing' || this.state === 'counting-in';

    if (!active) {
      return;
    }

    const startTime = this.tickToTime(region.startTick);
    const endTime = this.tickToTime(region.endTick);

    if (this.position >= startTime && this.position < endTime) {
      if (this.state === 'playing') {
        this.resyncClickScheduling(this.position);
      }

      return;
    }

    this.playFromTick(region.startTick);
  }

  private syncPlayerLoop(): void {
    if (!this.audioPlayer) {
      return;
    }

    if (!this.loopRegion || !this.chart) {
      this.audioPlayer.setLoop?.(undefined);

      return;
    }

    this.audioPlayer.setLoop?.({
      start: this.tickToTime(this.loopRegion.startTick),
      end: this.tickToTime(this.loopRegion.endTick),
    });
  }

  private resyncClickScheduling(songTime: number): void {
    this.clickTrack?.clearPending();
    this.nextBeatIndex = this.firstBeatIndexAtOrAfter(songTime);
    this.loopBeatOffset = 0;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlaybackSnapshot => this.snapshot;

  play(): void {
    if (!this.chart) {
      return;
    }

    if (this.loopRegion) {
      this.playFromTick(this.loopRegion.startTick);

      return;
    }

    const tick = secondsToTicks(
      Math.max(0, this.position - this.delaySeconds),
      this.chart.resolution,
      this.chart.tempos,
    );
    const measure = this.measures.find(
      (m) => tick >= m.startTick && tick < m.endTick,
    );

    this.playFromTick(measure?.startTick ?? 0);
  }

  playFromTick(tick: number): void {
    if (!this.chart || !this.audioPlayer) {
      return;
    }

    // Starting the player resumes its context, which ends any hold.
    this.clearHold();

    this.playGeneration += 1;

    const generation = this.playGeneration;

    this.clearScheduling();
    this.audioPlayer.stop();

    const startTime = this.tickToTime(tick);

    this.onSeekCb(tick);
    this.setPosition(startTime);
    this.nextBeatIndex = this.firstBeatIndexAtOrAfter(startTime);

    void this.beginPlayback(tick, startTime, generation);
  }

  private get playbackSpeed(): number {
    return this.speedPlayer?.playbackSpeed ?? 1;
  }

  private startAudio(...args: [offset: number, startAt?: number]): void {
    Promise.resolve(this.audioPlayer?.start(...args)).catch(this.onErrorCb);
  }

  private async beginPlayback(
    tick: number,
    startTime: number,
    generation: number,
  ): Promise<void> {
    if (!this.chart || !this.audioPlayer || !this.clickTrack) {
      return;
    }

    const ctx = this.audioPlayer.context;

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    if (this.disposed || generation !== this.playGeneration) {
      return;
    }

    if (!this.countInEnabled) {
      this.songStartCtx = ctx.currentTime;
      this.clickTrack.cancelGain();
      this.clickTrack.setGain(this.clickVolume);
      this.startAudio(startTime);
      this.isStarted = true;
      this.state = 'playing';
      this.emit();

      return;
    }

    const { beats, beatDurationSeconds } = getCountInInfo(
      tick,
      this.measures,
      this.chart,
    );
    const realBeatDuration = beatDurationSeconds / this.playbackSpeed;
    const now = ctx.currentTime;

    this.countIn = new CountInScheduler(now, beats, realBeatDuration);
    this.songStartCtx = this.countIn.songStartCtx;

    const countInVolume = Math.max(this.clickVolume, COUNT_IN_MIN_VOLUME);

    this.clickTrack.cancelGain();
    this.clickTrack.setGain(countInVolume, now);
    this.clickTrack.rampGain(
      countInVolume,
      this.clickVolume,
      this.songStartCtx,
      CLICK_GAIN_RAMP_SECONDS,
    );

    for (let i = 0; i < beats; i += 1) {
      this.clickTrack.scheduleClick(now + i * realBeatDuration, i === 0);
    }

    this.state = 'counting-in';
    this.emit();

    this.startAudio(startTime, this.songStartCtx);
  }

  /**
   * Freezes playback where it is (audio, click and song time) without leaving
   * the playing state, for wait mode. `release` carries on from the same spot
   * with no count-in. Suspending the AudioContext stops its clock, which every
   * player and the click are scheduled against.
   *
   * The audio fades out over HOLD_FADE_SECONDS first, since cutting it off
   * mid-waveform clicks; a hit during the fade cancels the freeze, so a
   * slightly late hit dips the volume instead of stopping the song.
   */
  hold(): void {
    if (!this.audioPlayer || this.state !== 'playing' || this.held) {
      return;
    }

    this.held = true;

    const player = this.audioPlayer;

    // Still frozen from a release whose resume hasn't finished (and still
    // silent): freeze again at once.
    if (!player.fadeTo || this.resuming) {
      this.freeze();

      return;
    }

    player.fadeTo(0, HOLD_FADE_SECONDS);
    this.freezeTimer = setTimeout(() => {
      this.freezeTimer = undefined;

      if (this.held) {
        this.freeze();
      }
    }, HOLD_FADE_SECONDS * 1000);
  }

  private freeze(): void {
    if (!this.audioPlayer) {
      return;
    }

    // Never behind the time already shown: a step back reads as a rewind.
    const live = this.audioPlayer.currentTime;
    const shown = this.position;

    this.frozenTime ??=
      live < shown && shown - live < SETTLE_SECONDS ? shown : live;
    void this.audioPlayer.context.suspend().catch(() => {});
  }

  release(): void {
    if (!this.held) {
      return;
    }

    this.held = false;

    const player = this.audioPlayer;

    if (this.freezeTimer !== undefined) {
      // Hit during the fade: the song never stopped, just bring it back up.
      clearTimeout(this.freezeTimer);
      this.freezeTimer = undefined;
      player?.fadeTo?.(1, HOLD_FADE_SECONDS);
      this.flushPendingSpeed();

      return;
    }

    if (!player || this.state !== 'playing') {
      this.frozenTime = undefined;
      player?.fadeTo?.(1, 0);

      return;
    }

    this.resuming = true;
    void player.context
      .resume()
      .catch(() => {})
      .then(() => {
        this.resuming = false;

        if (!this.held) {
          this.flushPendingSpeed();
        }

        // frozenTime stays until the live time catches up with it (see
        // updatePlaybackPosition), so the song never steps back on release.
        if (!this.held) {
          player.fadeTo?.(1, HOLD_FADE_SECONDS);
        }
      });
  }

  /** Ends a hold for a new start, seek or pause, which set their own time. */
  private clearHold(): void {
    if (this.freezeTimer !== undefined) {
      clearTimeout(this.freezeTimer);
      this.freezeTimer = undefined;
    }

    if (this.held || this.frozenTime !== undefined) {
      this.audioPlayer?.fadeTo?.(1, 0);
    }

    const wasFrozen = this.isFrozen;

    this.held = false;
    this.resuming = false;
    this.frozenTime = undefined;

    if (wasFrozen && this.state !== 'counting-in') {
      this.flushPendingSpeed();
    }
  }

  /** Held, or not yet running again after a release. */
  private get isFrozen(): boolean {
    return this.held || this.resuming;
  }

  get isHeld(): boolean {
    return this.held;
  }

  pause(): void {
    const frozen = this.frozenTime;

    this.clearHold();

    if (!this.audioPlayer || this.state !== 'playing') {
      return;
    }

    this.setPosition(frozen ?? this.audioPlayer.currentTime);
    this.audioPlayer.pause();
    this.clickTrack?.clearPending();
    this.state = 'parked';
    this.emit();
  }

  cancel(): void {
    if (this.state !== 'counting-in') {
      return;
    }

    this.playGeneration += 1;
    this.clearScheduling();
    this.audioPlayer?.stop();
    this.state = 'parked';
    this.emit();
  }

  seekSeconds(seconds: number): void {
    if (!this.audioPlayer) {
      return;
    }

    // Seeking out of a hold (wait mode's run-up): start silent and fade in
    // as the audio starts, instead of cutting in mid-waveform.
    const fromHold = this.isFrozen || this.frozenTime !== undefined;

    this.clearHold();

    this.playGeneration += 1;

    const generation = this.playGeneration;
    const wasActive = this.state === 'playing' || this.state === 'counting-in';

    this.clearScheduling();

    if (this.chart) {
      this.onSeekCb(
        secondsToTicks(
          seconds - this.delaySeconds,
          this.chart.resolution,
          this.chart.tempos,
        ),
      );
    }

    this.setPosition(seconds);
    this.nextBeatIndex = this.firstBeatIndexAtOrAfter(seconds);

    if (!wasActive) {
      this.audioPlayer.stop();
      this.state = 'parked';
      this.emit();

      return;
    }

    this.isStarted = true;
    this.state = 'playing';
    this.songStartCtx = this.audioPlayer.context.currentTime;
    this.flushPendingSpeed();
    this.clickTrack?.cancelGain();
    this.clickTrack?.setGain(this.clickVolume);

    const player = this.audioPlayer;

    if (fromHold && player.fadeTo) {
      player.fadeTo(0, 0);
      Promise.resolve(player.start(seconds))
        .then(() =>
          generation === this.playGeneration
            ? player.fadeTo?.(
                1,
                HOLD_FADE_SECONDS,
                player.contextTimeForSongTime(seconds),
              )
            : player.fadeTo?.(1, 0),
        )
        .catch((error) => {
          player.fadeTo?.(1, 0);
          this.onErrorCb();

          return error;
        });
    } else {
      this.startAudio(seconds);
    }

    this.emit();
  }

  private firstBeatIndexAtOrAfter(songTime: number): number {
    const index = this.beatGrid.findIndex(
      (beat) => beat.timeSeconds + this.delaySeconds >= songTime - 1e-4,
    );

    return index < 0 ? this.beatGrid.length : index;
  }

  private clearScheduling(): void {
    this.clickTrack?.clearPending();
    this.clickTrack?.cancelGain();
    this.countIn = undefined;
    this.songStartCtx = undefined;
    this.loopBeatOffset = 0;
  }

  setStemVolume(name: string, gain: number, fadeSeconds = 0): void {
    this.audioPlayer?.audioTracks
      .find((track) => track.name === name)
      ?.setVolume(gain, fadeSeconds);
  }

  hasStem(name: string): boolean {
    return (
      this.audioPlayer?.audioTracks.some((track) => track.name === name) ??
      false
    );
  }

  get outputLatency(): number {
    return this.audioPlayer?.outputLatency ?? 0;
  }

  /** Keeps the song running until the last note's hit window has closed. */
  setHitTolerance(seconds: number): void {
    this.hitToleranceSeconds = seconds;
  }

  setMasterVolume(gain: number): void {
    this.audioPlayer?.setMasterVolume(gain);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.freezeTimer);
    this.playGeneration += 1;
    this.clearScheduling();
    this.clickTrack?.dispose();

    if (this.raf !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.raf);
    }

    if (this.createdPlayer) {
      if (this.isDev) {
        this.createdPlayer.stop();
      } else {
        this.createdPlayer.destroy();
      }
    }

    this.listeners.clear();
  }

  private initAudio(trackData: TrackConfig[]): void {
    const player = this.createPlayer(
      trackData,
      () => this.handleEnded(),
      () => this.minDurationSeconds,
    );

    this.createdPlayer = player;

    player.ready
      .then(() => {
        if (this.disposed) {
          return;
        }

        this.audioPlayer = player;
        this.speedPlayer = isSpeedControllable(player) ? player : undefined;
        this.clickTrack = new ClickTrack(player.context);
        this.clickTrack.setTone(this.clickTone);
        this.syncPlayerLoop();
        this.emit();
      })
      .catch(() => {
        if (this.disposed) {
          return;
        }

        this.onErrorCb();
      });
  }

  private startPolling(): void {
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }

    const poll = () => {
      if (this.disposed) {
        return;
      }

      if (
        (this.state === 'playing' || this.state === 'ended') &&
        this.audioPlayer?.isInitialised
      ) {
        this.updatePlaybackPosition();
      }

      this.scheduleClicks();
      this.updateCountIn();

      this.raf = requestAnimationFrame(poll);
    };

    this.raf = requestAnimationFrame(poll);
  }

  private updatePlaybackPosition(): void {
    if (!this.audioPlayer) {
      return;
    }

    const rawTime = this.heldTime(this.audioPlayer);

    if (!this.loopRegion) {
      this.setPosition(rawTime);

      const lastMeasure = this.measures[this.measures.length - 1];

      if (
        this.state === 'playing' &&
        this.finishAfterLastNote &&
        this.chart &&
        lastMeasure &&
        secondsToTicks(
          rawTime - this.delaySeconds - this.hitToleranceSeconds,
          this.chart.resolution,
          this.chart.tempos,
        ) >= lastMeasure.endTick
      ) {
        this.handleEnded();
      }

      return;
    }

    const startTime = this.tickToTime(this.loopRegion.startTick);
    const endTime = this.tickToTime(this.loopRegion.endTick);
    const span = endTime - startTime;

    if (span <= 0 || rawTime < endTime) {
      this.setPosition(rawTime);

      return;
    }

    this.setPosition(startTime + ((rawTime - startTime) % span));
  }

  /**
   * The song time: frozen while held, and after a release until the live time
   * catches up, since the first readings of a resumed context can sit a
   * little behind the moment it froze.
   */
  private heldTime(player: AudioPlayer): number {
    const live = player.currentTime;
    const frozen = this.frozenTime;

    if (frozen === undefined) {
      return live;
    }

    if (this.held || this.resuming || player.context.state !== 'running') {
      return frozen;
    }

    if (live < frozen && frozen - live < SETTLE_SECONDS) {
      return frozen;
    }

    this.frozenTime = undefined;

    return live;
  }

  private scheduleClicks(): void {
    if (
      !this.clickTrack ||
      !this.audioPlayer?.isInitialised ||
      (this.state !== 'playing' && this.state !== 'counting-in')
    ) {
      return;
    }

    const ctx = this.audioPlayer.context;
    const horizon = ctx.currentTime + LOOKAHEAD_SECONDS;
    const loopStartTime = this.loopRegion
      ? this.tickToTime(this.loopRegion.startTick)
      : undefined;
    const loopEndTime = this.loopRegion
      ? this.tickToTime(this.loopRegion.endTick)
      : undefined;
    const loopSpan =
      loopStartTime !== undefined && loopEndTime !== undefined
        ? loopEndTime - loopStartTime
        : 0;
    const loopStartBeatIndex =
      loopStartTime !== undefined && loopSpan > 0
        ? this.firstBeatIndexAtOrAfter(loopStartTime)
        : 0;
    const loopEndBeatIndex =
      loopEndTime !== undefined && loopSpan > 0
        ? this.firstBeatIndexAtOrAfter(loopEndTime)
        : this.beatGrid.length;
    const canWrapBeats =
      this.loopRegion !== undefined &&
      loopSpan > 0 &&
      loopEndBeatIndex > loopStartBeatIndex;

    while (this.nextBeatIndex < loopEndBeatIndex || canWrapBeats) {
      if (this.nextBeatIndex >= loopEndBeatIndex) {
        this.nextBeatIndex = loopStartBeatIndex;
        this.loopBeatOffset += loopSpan;
      }

      const beat = this.beatGrid[this.nextBeatIndex];
      const songTime =
        beat.timeSeconds + this.delaySeconds + this.loopBeatOffset;
      const contextTime = this.audioPlayer.contextTimeForSongTime(songTime);

      if (contextTime > horizon) {
        break;
      }

      this.clickTrack.scheduleClick(contextTime, beat.isDownbeat);
      this.nextBeatIndex += 1;
    }
  }

  private updateCountIn(): void {
    if (this.state !== 'counting-in' || !this.audioPlayer || !this.countIn) {
      return;
    }

    const now = this.audioPlayer.context.currentTime;

    if (this.countIn.isComplete(now)) {
      this.countIn = undefined;
      this.isStarted = true;
      this.state = 'playing';
      this.flushPendingSpeed();
      this.emit();

      return;
    }

    if (this.countIn.advanceTo(now)) {
      this.emit();
    }
  }

  private handleEnded(): void {
    if (this.loopRegion || this.state === 'ended') {
      return;
    }

    this.state = 'ended';
    this.clickTrack?.clearPending();
    this.emit();
    this.onEndedCb();
  }

  private tickToTime(tick: number): number {
    return this.chart
      ? ticksToSeconds(tick, this.chart.resolution, this.chart.tempos) +
          this.delaySeconds
      : 0;
  }

  private setPosition(seconds: number): void {
    this.position = seconds;
    this.timeStore.set(seconds);
  }

  private buildSnapshot(): PlaybackSnapshot {
    return {
      state: this.state,
      isPlaying: this.state === 'playing',
      isCounting: this.state === 'counting-in',
      isStarted: this.isStarted,
      isEnded: this.state === 'ended',
      countInBeat: this.countIn?.beat,
      countInBeatMs: this.countIn?.beatMs,
      isReady: this.audioPlayer !== undefined,
      duration: this.audioPlayer?.duration ?? 0,
    };
  }

  private emit(): void {
    const next = this.buildSnapshot();

    if (SNAPSHOT_KEYS.every((key) => this.snapshot[key] === next[key])) {
      return;
    }

    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
