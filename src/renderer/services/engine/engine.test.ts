import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stave, StaveNote } from 'vexflow';
import { TrackConfig } from '../audio-player';
import {
  Measure,
  Note,
  ParsedChart,
  RenderData,
  RenderedNote,
} from '../../../chart-parser/types';
import { InputEvent } from '../../input/types';
import { Engine } from './engine';
import { EngineContext } from './types';
import { MAX_HIT_TOLERANCE_MS } from './constants';
import { log } from '../../../shared/log';

vi.mock('../click-track/metronome', () => ({
  renderClickBuffers: vi.fn(() => ({ downbeat: {}, beat: {} })),
}));

const { MockAudioPlayer } = vi.hoisted(() => {
  const fakeContext = () => ({
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        cancelScheduledValues: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    }),
    createBufferSource: () => ({
      buffer: undefined,
      connect: () => {},
      start: () => {},
      stop: () => {},
      addEventListener: () => {},
    }),
  });

  class MockAudioPlayerImpl {
    static instances: MockAudioPlayerImpl[] = [];
    onEnded: () => void;
    ready = Promise.resolve([]);
    context = fakeContext();
    audioTracks: { name: string; setVolume: () => void }[] = [];
    currentTime = 0;
    duration = 100;
    isInitialised = false;
    startedAt = -1;
    offset = 0;
    start = vi.fn((offset = 0, startAt?: number) => {
      this.isInitialised = true;
      this.offset = offset;
      this.startedAt = startAt ?? this.context.currentTime;
      this.currentTime = offset;
    });
    pause = vi.fn();
    freeze = vi.fn(() => Promise.resolve('frozen' as const));
    thaw = vi.fn(() => Promise.resolve('resumed' as const));
    stop = vi.fn();
    setMasterVolume = vi.fn();
    setPlaybackSpeed = vi.fn();
    destroy = vi.fn();

    contextTimeForSongTime(songTime: number) {
      return this.startedAt < 0
        ? this.context.currentTime
        : this.startedAt + (songTime - this.offset);
    }

    constructor(_trackData: unknown, onEnded: () => void) {
      this.onEnded = onEnded;
      MockAudioPlayerImpl.instances.push(this);
    }
  }

  return { MockAudioPlayer: MockAudioPlayerImpl };
});

vi.mock('../audio-player/factories', () => ({
  playerFactoryForMode: () => (trackData: unknown, onEnded: () => void) =>
    new MockAudioPlayer(trackData, onEnded),
}));

type MockPlayer = {
  onEnded: () => void;
  context: { currentTime: number };
  currentTime: number;
  start: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setMasterVolume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

const TRACKS: TrackConfig[] = [{ name: 'drums', urls: ['d.ogg'] }];
const CHART = {
  resolution: 480,
  tempos: [{ tick: 0, beatsPerMinute: 120, msTime: 0 }],
} as unknown as ParsedChart;

function svgEl(): SVGElement {
  return document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  ) as SVGElement;
}

function staveNote(keys: string[], isRest = false): StaveNote {
  const noteHeads = keys.map(() => {
    const el = svgEl();

    el.style.fill = '';

    return { getSVGElement: () => el };
  });

  return {
    isRest: () => isRest,
    getKeys: () => keys,
    getAbsoluteX: () => 0,
    noteHeads,
  } as unknown as StaveNote;
}

function fakeStave(): Stave {
  return {
    getX: () => 0,
    getY: () => 10,
    getWidth: () => 100,
    getHeight: () => 40,
  } as unknown as Stave;
}

function rendered(tick: number, note: StaveNote): RenderedNote {
  return { tick, note };
}

function measureData(
  startTick: number,
  endTick: number,
  notes: RenderedNote[],
  modelNotes: Note[] = [],
): RenderData {
  return {
    stave: fakeStave(),
    measure: {
      startTick,
      endTick,
      notes: modelNotes,
      timeSig: [4, 4],
    } as unknown as Measure,
    renderedNotes: notes,
    yOffset: 0,
  };
}

function hasClass(note: StaveNote, cls: string, head = 0): boolean {
  return (
    note.noteHeads[head].getSVGElement() as SVGElement
  ).classList.contains(cls);
}

function uncolored(note: StaveNote, head = 0): boolean {
  return (
    !hasClass(note, 'vf-note-hit', head) &&
    !hasClass(note, 'vf-note-missed', head)
  );
}

function getPlayerInstances(): MockPlayer[] {
  return MockAudioPlayer.instances as unknown as MockPlayer[];
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

let inputListeners: Set<(event: InputEvent) => void>;

function emitInput(controlId: string, value = 100) {
  inputListeners.forEach((listener) => listener({ controlId, value }));
}

async function setup(over: Partial<EngineContext> = {}) {
  const onEnded = vi.fn();
  const onError = vi.fn();
  const engine = new Engine({
    trackData: TRACKS,
    isDev: false,
    player: 'default',
    subscribeInput: (listener) => {
      inputListeners.add(listener);

      return () => {
        inputListeners.delete(listener);
      };
    },
    onEnded,
    onError,
  });
  const renderData = over.renderData ?? [];

  engine.setSettings({ playheadStyle: 'Cursor' });
  engine.setContext({
    chart: CHART,
    measures: renderData.map((rd) => rd.measure),
    renderData,
    delaySeconds: 0,
    minDurationSeconds: 0,
    countInEnabled: false,
    mapping: {},
    ...over,
  });

  await flush();

  const [player] = getPlayerInstances();

  return { engine, onEnded, player };
}

let frameQueue: FrameRequestCallback[] = [];

function flushFrame() {
  const callbacks = frameQueue;

  frameQueue = [];
  callbacks.forEach((cb) => cb(0));
}

function advanceClockTo(
  player: { context: { currentTime: number } },
  t: number,
) {
  player.context.currentTime = t;
  flushFrame();
}

beforeEach(() => {
  inputListeners = new Set();
  frameQueue = [];
  MockAudioPlayer.instances.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb);

    return frameQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Engine', () => {
  it('delegates transport to playback and reflects state', async () => {
    const { engine, player } = await setup({
      renderData: [measureData(0, 1920, [])],
    });

    engine.playFromTick(0);

    expect(player.start).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().isPlaying).toBe(true);
  });

  it('forwards master volume changes to the player', async () => {
    const { engine, player } = await setup({
      renderData: [measureData(0, 1920, [])],
    });

    engine.setMasterVolume(0.6);

    expect(player.setMasterVolume).toHaveBeenCalledWith(0.6);
  });

  it('forwards the score on ended, counting only non-rest model notes', async () => {
    const { onEnded, player } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [],
          [
            { isRest: false, notes: ['c/5', 'g/5'] } as Note,
            { isRest: true, notes: ['x'] } as Note,
            { isRest: false, notes: ['f/4'] } as Note,
          ],
        ),
      ],
    });

    player.onEnded();

    expect(onEnded).toHaveBeenCalledWith({
      hitNotes: 0,
      falseHits: 0,
      totalNotes: 3,
    });
  });

  it('positions the cursor element from the current time', async () => {
    const note = staveNote(['c/5'], true);
    const { engine } = await setup({
      renderData: [measureData(0, 1920, [rendered(0, note)])],
    });
    const cursorEl = document.createElement('div');

    engine.setRendererRefs({ cursorEl, highlightEls: [] });
    engine.timeStore.set(1);

    expect(cursorEl.style.display).toBe('');
    expect(cursorEl.style.transform).toBe(
      'translate3d(50px, 10px, 0) translateX(-50%)',
    );
    expect(cursorEl.style.height).toBe('70px');
  });

  it('hides the cursor when the playhead style is not Cursor', async () => {
    const note = staveNote(['c/5'], true);
    const { engine } = await setup({
      renderData: [measureData(0, 1920, [rendered(0, note)])],
    });

    engine.setSettings({ playheadStyle: 'Measure' });

    const cursorEl = document.createElement('div');

    engine.setRendererRefs({ cursorEl, highlightEls: [] });
    engine.timeStore.set(1);

    expect(cursorEl.style.display).toBe('none');
  });

  it('toggles the active measure highlight in Measure mode', async () => {
    const { engine } = await setup({
      renderData: [
        measureData(0, 1920, [rendered(0, staveNote(['c/5'], true))]),
        measureData(1920, 3840, [rendered(1920, staveNote(['c/5'], true))]),
      ],
    });

    engine.setSettings({ playheadStyle: 'Measure' });

    const a = document.createElement('div');
    const b = document.createElement('div');

    engine.setRendererRefs({ cursorEl: undefined, highlightEls: [a, b] });
    engine.timeStore.set(2.1);

    expect(b.style.border).toContain('var(--color-accent-bright)');
    expect(b.style.backgroundColor).toBe('var(--color-accent-soft-bg)');
    expect(a.style.backgroundColor).toBe('');
  });

  it('progress-colours notes before the active note', async () => {
    const n0 = staveNote(['c/5']);
    const n1 = staveNote(['d/5']);
    const n2 = staveNote(['e/5']);
    const { engine } = await setup({
      renderData: [
        measureData(0, 1920, [
          rendered(0, n0),
          rendered(240, n1),
          rendered(480, n2),
        ]),
      ],
    });

    engine.setSettings({ playheadStyle: 'Cursor' });
    engine.setRendererRefs({
      cursorEl: document.createElement('div'),
      highlightEls: [],
    });
    engine.timeStore.set(0.5);

    expect(hasClass(n0, 'vf-note-missed')).toBe(true);
    expect(hasClass(n1, 'vf-note-missed')).toBe(true);
    expect(uncolored(n2)).toBe(true);
  });

  it('registers an input hit and hides the struck note head', async () => {
    const note = staveNote(['c/5']);
    const { engine, onEnded, player } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(480, note)],
          [{ tick: 480, isRest: false, notes: ['c/5'] } as Note],
        ),
      ],
    });

    engine.setSettings({ playheadStyle: 'Cursor' });
    engine.setRendererRefs({
      cursorEl: document.createElement('div'),
      highlightEls: [],
    });
    engine.setMapping({ snare: ['midi:38'] });
    engine.playFromTick(0);
    engine.seekSeconds(0.5);

    emitInput('midi:38');

    expect(hasClass(note, 'vf-note-hit')).toBe(true);

    player.onEnded();
    expect(onEnded).toHaveBeenCalledWith(
      expect.objectContaining({ hitNotes: 1, falseHits: 0 }),
    );
  });

  it('prunes a false hit made ahead of a seek when seeking back', async () => {
    const note = staveNote(['c/5']);
    const { engine, onEnded, player } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(480, note)],
          [{ tick: 480, isRest: false, notes: ['c/5'] } as Note],
        ),
      ],
    });

    engine.setMapping({ crash: ['midi:49'] });
    engine.playFromTick(0);
    engine.seekSeconds(0.5);
    emitInput('midi:49');
    engine.seekSeconds(0.1);

    player.onEnded();
    expect(onEnded).toHaveBeenCalledWith(
      expect.objectContaining({ falseHits: 0 }),
    );
  });

  it('clears a hit on the opening note when restarting from tick zero', async () => {
    const n0 = staveNote(['c/5']);
    const n1 = staveNote(['c/5']);
    const { engine } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(0, n0), rendered(480, n1)],
          [
            { tick: 0, isRest: false, notes: ['c/5'] } as Note,
            { tick: 480, isRest: false, notes: ['c/5'] } as Note,
          ],
        ),
      ],
    });

    engine.setRendererRefs({
      cursorEl: document.createElement('div'),
      highlightEls: [],
    });
    engine.setMapping({ snare: ['midi:38'] });
    engine.playFromTick(0);
    emitInput('midi:38');

    expect(hasClass(n0, 'vf-note-hit')).toBe(true);

    engine.seekSeconds(1);
    engine.playFromTick(0);

    expect(uncolored(n0)).toBe(true);
  });

  it('does not register input hits before playback starts', async () => {
    const note = staveNote(['c/5']);
    const { engine } = await setup({
      renderData: [measureData(0, 1920, [rendered(480, note)])],
    });

    engine.setSettings({ playheadStyle: 'Cursor' });
    engine.setMapping({ snare: ['midi:38'] });
    engine.timeStore.set(1);

    emitInput('midi:38');

    expect(uncolored(note)).toBe(true);
  });

  it('does not score input during the count-in, only once playing', async () => {
    const note = staveNote(['c/5']);
    const { engine, player } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(480, note)],
          [{ tick: 480, isRest: false, notes: ['c/5'] } as Note],
        ),
      ],
      countInEnabled: true,
    });

    engine.setRendererRefs({
      cursorEl: document.createElement('div'),
      highlightEls: [],
    });
    engine.setMapping({ snare: ['midi:38'] });

    engine.playFromTick(0);
    engine.timeStore.set(0.5);
    emitInput('midi:38');

    expect(uncolored(note)).toBe(true);

    advanceClockTo(player, 5);
    flushFrame();
    engine.timeStore.set(0.5);
    emitInput('midi:38');

    expect(hasClass(note, 'vf-note-hit')).toBe(true);
  });

  it('stops scoring input after dispose', async () => {
    const { engine } = await setup();

    expect(inputListeners.size).toBe(1);

    engine.dispose();

    expect(inputListeners.size).toBe(0);
  });

  it('destroys the player on dispose', async () => {
    const { engine, player } = await setup();

    engine.dispose();

    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it('scores an early hit near the loop seam on the first bar of the loop instead of the post-loop bar and preserves it across wrap', async () => {
    const preLoopNote = staveNote(['c/5']);
    const loopStartNote = staveNote(['c/5']);
    const loopEndBeatNote = staveNote(['f/4']);
    const postLoopNote = staveNote(['c/5']);
    const { engine, player } = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(0, preLoopNote)],
          [{ tick: 0, isRest: false, notes: ['c/5'] } as Note],
        ),
        measureData(
          1920,
          3840,
          [rendered(1920, loopStartNote), rendered(3360, loopEndBeatNote)],
          [
            { tick: 1920, isRest: false, notes: ['c/5'] } as Note,
            { tick: 3360, isRest: false, notes: ['f/4'] } as Note,
          ],
        ),
        measureData(
          3840,
          5760,
          [rendered(3840, postLoopNote)],
          [{ tick: 3840, isRest: false, notes: ['c/5'] } as Note],
        ),
      ],
    });

    engine.setRendererRefs({
      cursorEl: document.createElement('div'),
      highlightEls: [],
    });
    engine.setMapping({ snare: ['midi:38'] });
    engine.setLoopRegion({ startTick: 1920, endTick: 3840 });
    engine.play();
    await flush();

    player.currentTime = 2.0;
    advanceClockTo(player, 0.1);
    emitInput('midi:38');
    expect(hasClass(loopStartNote, 'vf-note-hit')).toBe(true);

    player.currentTime = 3.96;
    advanceClockTo(player, 1.96);

    emitInput('midi:38');

    expect(hasClass(postLoopNote, 'vf-note-hit')).toBe(false);
    expect(hasClass(preLoopNote, 'vf-note-hit')).toBe(false);
    expect(hasClass(loopStartNote, 'vf-note-hit')).toBe(true);

    player.currentTime = 2.0;
    advanceClockTo(player, 2.05);

    expect(hasClass(loopStartNote, 'vf-note-hit')).toBe(true);
    expect(hasClass(preLoopNote, 'vf-note-hit')).toBe(false);
    expect(hasClass(postLoopNote, 'vf-note-hit')).toBe(false);
  });
});

describe('Engine mute drums on miss', () => {
  async function gateSetup() {
    const note = staveNote(['c/5']);
    const ctx = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(480, note)],
          [{ tick: 480, isRest: false, notes: ['c/5'] } as Note],
        ),
      ],
    });
    const drums = { name: 'drums', setVolume: vi.fn() };

    (ctx.player as unknown as { audioTracks: unknown[] }).audioTracks = [drums];
    ctx.engine.setMapping({ snare: ['midi:38'] });

    return { ...ctx, drums };
  }

  function playTo(player: MockPlayer, seconds: number) {
    player.currentTime = seconds;
    flushFrame();
  }

  it('silences the drum stem when a note passes unhit and restores it on the next hit', async () => {
    const { engine, player, drums } = await gateSetup();

    engine.setStemVolume('drums', 0.8);
    engine.setJudgeSettings({
      hitToleranceSeconds: 0.1,
      muteDrumsOnMiss: true,
    });
    engine.playFromTick(0);
    playTo(player, 0.4);
    drums.setVolume.mockClear();

    playTo(player, 0.55); // note at 0.5 s passed unhit
    expect(drums.setVolume).toHaveBeenLastCalledWith(0, expect.any(Number));

    emitInput('midi:38'); // late but inside the 100 ms window
    expect(drums.setVolume).toHaveBeenLastCalledWith(0.8, expect.any(Number));
  });

  it('leaves the drums alone when the option is off', async () => {
    const { engine, player, drums } = await gateSetup();

    engine.setStemVolume('drums', 0.8);
    engine.setJudgeSettings({
      hitToleranceSeconds: 0.1,
      muteDrumsOnMiss: false,
    });
    engine.playFromTick(0);
    playTo(player, 0.55);

    expect(drums.setVolume).not.toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('keeps the mixer volume when the user changes it while muted', async () => {
    const { engine, player, drums } = await gateSetup();

    engine.setJudgeSettings({
      hitToleranceSeconds: 0.1,
      muteDrumsOnMiss: true,
    });
    engine.playFromTick(0);
    playTo(player, 0.55);

    engine.setStemVolume('drums', 0.3);
    expect(drums.setVolume).toHaveBeenLastCalledWith(0, expect.any(Number));

    emitInput('midi:38');
    expect(drums.setVolume).toHaveBeenLastCalledWith(0.3, expect.any(Number));
  });

  it('clamps a hit window outside the settings range', async () => {
    const { engine } = await gateSetup();

    vi.spyOn(log, 'warn').mockImplementation(() => {});
    engine.setJudgeSettings({
      hitToleranceSeconds: 5,
      muteDrumsOnMiss: false,
    });

    expect(engine.hitTolerance).toBe(MAX_HIT_TOLERANCE_MS / 1000);
    expect(log.warn).toHaveBeenCalledWith(
      'engine.hit_tolerance_clamped',
      expect.objectContaining({ requested: 5 }),
    );
  });

  it('applies the configured hit window to scoring', async () => {
    const { engine, player, onEnded } = await gateSetup();

    engine.setJudgeSettings({
      hitToleranceSeconds: 0.02,
      muteDrumsOnMiss: false,
    });
    engine.playFromTick(0);
    playTo(player, 0.55); // 50 ms late: outside a ±20 ms window
    emitInput('midi:38');

    player.onEnded();
    expect(onEnded).toHaveBeenCalledWith(
      expect.objectContaining({ hitNotes: 0 }),
    );
  });
});

describe('Engine wait mode', () => {
  async function waitSetup() {
    const ctx = await setup({
      renderData: [
        measureData(
          0,
          1920,
          [rendered(480, staveNote(['c/5']))],
          [
            {
              tick: 480,
              isRest: false,
              notes: ['c/5'],
              ghosts: ['c/5'],
            } as Note,
          ],
        ),
      ],
    });

    ctx.engine.setMapping({ snare: ['midi:38'] });

    return ctx;
  }

  function playTo(player: MockPlayer, seconds: number) {
    player.currentTime = seconds;
    flushFrame();
  }

  it('gives a held ghost note a loud hit from outside its window', async () => {
    const { engine, player } = await waitSetup();

    engine.playFromTick(0);
    playTo(player, 0.8); // 300 ms past the note at 0.5 s
    engine.hold([480]);
    emitInput('midi:38', 127);

    expect(engine.isHit(480, 'c/5')).toBe(true);
  });

  it('judges the same note as usual once released', async () => {
    const { engine, player } = await waitSetup();

    engine.playFromTick(0);
    playTo(player, 0.55);
    engine.hold([480]);
    engine.release();
    emitInput('midi:38', 127); // too loud for a ghost note

    expect(engine.isHit(480, 'c/5')).toBe(false);
  });

  it('changes no scoring when asked to hold with nothing playing', async () => {
    const { engine, player } = await waitSetup();

    expect(engine.hold([480])).toBe('not-playing');
    expect(engine.isHeld).toBe(false);

    engine.play();
    playTo(player, 0.5);
    emitInput('midi:38', 127); // too loud for a ghost note

    expect(engine.isHit(480, 'c/5')).toBe(false);
  });

  it('says whether a hold took effect', async () => {
    const { engine, player } = await waitSetup();

    engine.playFromTick(0);
    playTo(player, 0.6);

    expect(engine.hold([480])).toBe('held');
    expect(engine.hold([480])).toBe('already-held');
    expect(engine.isHeld).toBe(true);
  });
});
