import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Segmented, Spin } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faDrum,
  faPause,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useInput } from '../../context/InputContext';
import { useSongViewSettings } from '../../context/SongViewSettingsContext';
import { isLowMemoryDevice, useSongLoader } from '../../hooks/useSongLoader';
import { useSheetMusic } from '../../hooks/useSheetMusic';
import { useEngine } from '../../hooks/useEngine';
import { usePersisted } from '../../hooks/usePersisted';
import { ticksToSeconds } from '../../../chart-parser/timing';
import { AudioData, ScoreData } from '../../../types';
import { TrackConfig } from '../../services/audio-player/types';
import { DRUM_KIT_PIECES, DrumKitPiece } from '../../../songData';
import { CountIn } from '../../components/CountIn';
import { AudioVolume } from '../../components/AudioVolume';
import { ClickControls } from '../../components/ClickControls';
import { useVolumeControls } from '../../hooks/useVolumeControls';
import { useMuteToggle } from '../../hooks/useMuteToggle';
import { TracksButton } from './TracksButton';
import { inputBus } from '../../input';
import {
  buildBarTimeline,
  buildNoteTimeline,
  controlsForPiece,
  kitInputMapping,
  KitPiece,
  pieceByVoice,
  useKit,
} from '../../kit';
import {
  isKitPlayView,
  KIT_PLAY_VIEWS,
  KitPlayViewId,
  PlaySession,
} from './session';
import { KitHighwayView } from './views/KitHighwayView';
import { SheetLanesView } from './views/SheetLanesView';
import { LessonView } from './views/LessonView';
import { RailsView } from './views/RailsView';
import { LanesView } from './views/LanesView';

const VIEW_COMPONENTS: Record<
  KitPlayViewId,
  (props: { session: PlaySession }) => React.ReactNode
> = {
  kit: KitHighwayView,
  v6: SheetLanesView,
  v7: LessonView,
  v12: RailsView,
  v13: LanesView,
};

export function KitPlayView() {
  const { difficulty, isDev } = useApp();
  const { inputMapping } = useInput();
  const { countIn, hitWindowMs, muteDrumsOnMiss } = useSongViewSettings();
  const { kit } = useKit();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const viewParam = searchParams.get('view');
  const view: KitPlayViewId = isKitPlayView(viewParam) ? viewParam : 'kit';
  const {
    fileData,
    format,
    songData,
    trackData: songTrackData,
  } = useSongLoader(id);
  // With a drum-kit split, the kit pieces play instead of the drums stem so
  // views can mute just the pieces the player is playing.
  const { trackData, kitStems } = useMemo(
    () => withKitStems(songTrackData, songData?.drumKit, isLowMemoryDevice()),
    [songTrackData, songData?.drumKit],
  );
  const { chart, parsedMidi } = useSheetMusic({
    fileData,
    format,
    fiveLaneDrums: songData?.fiveLaneDrums ?? false,
    proDrums: songData?.proDrums ?? false,
    songId: songData?.id,
    difficulty,
    showBarNumbers: false,
    enableColors: false,
    showTempo: false,
    stemDirection: 1,
  });
  const measures = useMemo(() => parsedMidi?.measures ?? [], [parsedMidi]);
  const delaySeconds = songData?.delaySeconds ?? 0;
  const mapping = useMemo(
    () => kitInputMapping(kit, inputMapping),
    [kit, inputMapping],
  );
  const minDurationSeconds = useMemo(() => {
    const last = measures[measures.length - 1];

    return chart && last
      ? ticksToSeconds(last.endTick, chart.resolution, chart.tempos) +
          delaySeconds
      : 0;
  }, [chart, measures, delaySeconds]);
  const [endedListeners] = useState(
    () => new Set<(score: ScoreData) => void>(),
  );
  const engineState = useEngine({
    trackData,
    isDev,
    chart,
    measures,
    renderData: EMPTY_RENDER_DATA,
    delaySeconds,
    minDurationSeconds,
    countInEnabled: countIn,
    finishAfterLastNote: true,
    playheadStyle: 'Cursor',
    mapping,
    player: 'speed',
    hitWindowMs,
    muteDrumsOnMiss,
    onEnded: (score) => endedListeners.forEach((l) => l(score)),
  });
  const { engine, isReady, isPlaying, isCounting, play, pause, cancel } =
    engineState;
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [clickVolume, setClickVolume] = usePersisted(
    'settings.kitClickVolume',
    0,
  );
  const [clickTone, setClickTone] = usePersisted('settings.clickTone', 50);
  const [masterVolume, setMasterVolume] = usePersisted(
    'settings.masterVolume',
    100,
  );
  const {
    isMuted: isMasterMuted,
    toggleMute: toggleMasterMute,
    handleChange: handleMasterChange,
  } = useMuteToggle(masterVolume, setMasterVolume, 100);
  // Stem gain = the user's mixer level × a view's scale (e.g. the lesson
  // turning the drums down), so views never overwrite the mixer.
  const [stemGains] = useState(() => ({
    user: new Map<string, number>(),
    scale: new Map<string, number>(),
  }));
  const applyStem = useCallback(
    (name: string) =>
      engine?.setStemVolume(
        name,
        (stemGains.user.get(name) ?? 1) * (stemGains.scale.get(name) ?? 1),
      ),
    [engine, stemGains],
  );
  const setUserStemVolume = useCallback(
    (name: string, gain: number) => {
      stemGains.user.set(name, gain);
      applyStem(name);
    },
    [stemGains, applyStem],
  );
  // Mirrors stemGains.scale for the mixer, which shows what a view turned down.
  const [stemScales, setStemScales] = useState<Record<string, number>>({});
  const setStemScale = useCallback(
    (name: string, scale: number) => {
      stemGains.scale.set(name, scale);
      applyStem(name);
      setStemScales((prev) =>
        prev[name] === scale ? prev : { ...prev, [name]: scale },
      );
    },
    [stemGains, applyStem],
  );
  const { volumeSliders } = useVolumeControls(
    trackData,
    setUserStemVolume,
    isReady,
  );

  useEffect(() => {
    engine?.setPlaybackSpeed(playbackSpeed);
  }, [engine, playbackSpeed]);

  useEffect(() => {
    engine?.setClickSettings(clickVolume, clickTone / 100);
  }, [engine, clickVolume, clickTone]);

  useEffect(() => {
    if (isReady) {
      engine?.setMasterVolume(masterVolume / 100);
    }
  }, [engine, isReady, masterVolume]);

  useEffect(() => {
    window.electron.ipcRenderer.sendMessage('prevent-sleep');

    return () => window.electron.ipcRenderer.sendMessage('resume-sleep');
  }, []);

  const notes = useMemo(
    () => (chart ? buildNoteTimeline(measures, chart, delaySeconds) : []),
    [chart, measures, delaySeconds],
  );
  const bars = useMemo(
    () => (chart ? buildBarTimeline(measures, chart, delaySeconds) : []),
    [chart, measures, delaySeconds],
  );
  const byVoice = useMemo(() => pieceByVoice(kit), [kit]);
  const togglePlay = useCallback(() => {
    if (isCounting) {
      cancel();
    } else if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isCounting, isPlaying, cancel, pause, play]);
  const strikePiece = useCallback(
    (piece: KitPiece) => {
      const [controlId] = controlsForPiece(kit, piece, mapping);

      if (controlId) {
        inputBus.inject({ controlId, value: 100 });
      }
    },
    [kit, mapping],
  );
  const onEnded = useCallback(
    (listener: (score: ScoreData) => void) => {
      endedListeners.add(listener);

      return () => {
        endedListeners.delete(listener);
      };
    },
    [endedListeners],
  );
  const session = useMemo<PlaySession | undefined>(() => {
    if (!engine || !chart || !songData) {
      return undefined;
    }

    return {
      song: songData,
      chart,
      measures,
      delaySeconds,
      notes,
      bars,
      kit,
      mapping,
      pieceByVoice: byVoice,
      engine,
      timeStore: engineState.timeStore,
      duration: engineState.duration,
      isReady,
      isPlaying,
      isCounting,
      isEnded: engineState.isEnded,
      countInBeat: engineState.countInBeat,
      play,
      pause,
      togglePlay,
      playFromTick: engineState.playFromTick,
      seekSeconds: engineState.seekSeconds,
      setLoopRegion: (region) => engine.setLoopRegion(region),
      playbackSpeed,
      setPlaybackSpeed,
      clickVolume,
      setClickVolume,
      setStemScale,
      kitStems,
      onEnded,
      strikePiece,
    };
  }, [
    engine,
    chart,
    songData,
    measures,
    delaySeconds,
    notes,
    bars,
    kit,
    mapping,
    byVoice,
    engineState.timeStore,
    engineState.duration,
    engineState.isEnded,
    engineState.countInBeat,
    engineState.playFromTick,
    engineState.seekSeconds,
    isReady,
    isPlaying,
    isCounting,
    play,
    pause,
    togglePlay,
    playbackSpeed,
    clickVolume,
    setClickVolume,
    setStemScale,
    kitStems,
    onEnded,
    strikePiece,
  ]);
  const exit = () => {
    cancel();
    pause();
    navigate('/');
  };
  const ViewComponent = VIEW_COMPONENTS[view];
  const audioLoading = trackData.length > 0 && !isReady;

  return (
    <div className="h-full flex flex-col bg-bg pointer-events-auto">
      <div
        className="flex items-center p-4 gap-5 flex-wrap border-b border-divider"
        style={{ background: 'var(--gradient-header)' }}
      >
        <Button
          icon={<FontAwesomeIcon icon={faArrowLeft} />}
          data-testid="back-button"
          onClick={exit}
          size="large"
        />
        <Button
          type="primary"
          icon={<FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />}
          loading={audioLoading}
          data-testid="play-toggle"
          onClick={togglePlay}
          shape="circle"
          size="large"
          style={{ width: 50, height: 50 }}
        />
        <div className="min-w-0">
          <div className="text-text-body font-ui text-[18px] truncate">
            {songData?.name}
          </div>
          <div className="text-text-faint flex items-center gap-1">
            <div className="truncate">{songData?.artist}</div>
            <div>·</div>
            <div className="capitalize">{difficulty}</div>
          </div>
        </div>
        <div className="grow" aria-hidden="true" />
        <Segmented
          value={view}
          options={KIT_PLAY_VIEWS.map((v) => ({
            value: v.id,
            label: v.label,
            title: v.description,
          }))}
          onChange={(value) => {
            cancel();
            pause();
            engine?.setLoopRegion(undefined);
            setSearchParams({ view: String(value) }, { replace: true });
          }}
        />
        <TracksButton
          volumeSliders={volumeSliders}
          kitStems={kitStems}
          stemScales={Object.fromEntries(
            Object.entries(stemScales).filter(([name]) =>
              trackData.some((t) => t.name === name),
            ),
          )}
          masterVolumeControl={
            <AudioVolume
              name="Master"
              volume={masterVolume}
              onChange={handleMasterChange}
              canSolo={false}
              onMuteClick={toggleMasterMute}
              isMuted={isMasterMuted}
            />
          }
          clickControls={
            <ClickControls
              volume={Math.round(clickVolume * 100)}
              onVolumeChange={(value) => setClickVolume(value / 100)}
              tone={clickTone}
              onToneChange={setClickTone}
            />
          }
        />
        <Button
          icon={<FontAwesomeIcon icon={faDrum} />}
          onClick={() => {
            cancel();
            pause();
            navigate('/kit');
          }}
        >
          {kit.name}
        </Button>
      </div>
      <div className="relative grow min-h-0 overflow-auto">
        {session ? (
          <ViewComponent key={view} session={session} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spin size="large" />
          </div>
        )}
        <CountIn
          count={engineState.countInBeat}
          beatMs={engineState.countInBeatMs}
        />
      </div>
    </div>
  );
}

const EMPTY_RENDER_DATA: never[] = [];

/**
 * Swaps the drums track for the song's kit-piece stems, when it has them.
 * With `mono`, the pieces are mixed down to one channel each: half the memory
 * on small devices, at the cost of the toms' and cymbals' stereo placement.
 */
export function withKitStems(
  trackData: TrackConfig[],
  drumKit: AudioData[] | undefined,
  mono = false,
): { trackData: TrackConfig[]; kitStems: DrumKitPiece[] } {
  const pieces = DRUM_KIT_PIECES.filter(
    (p) => drumKit?.some((a) => a.name === p),
  );

  if (pieces.length === 0 || trackData.length === 0) {
    return { trackData, kitStems: [] };
  }

  return {
    trackData: [
      ...pieces.map((name) => ({
        name,
        urls: drumKit!.filter((a) => a.name === name).map((a) => a.src),
        ...(mono ? { mono } : {}),
      })),
      ...trackData.filter((t) => t.name !== 'drums'),
    ],
    kitStems: pieces,
  };
}
