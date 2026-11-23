import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { Button, Select } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { useInput } from '../../context/InputContext';
import {
  controlSource,
  InputDevice,
  inputBus,
  InputEvent,
  isTypingTarget,
  makeControlId,
} from '../../input';
import {
  assignControlToPiece,
  hitRadius,
  KitPiece,
  KitPieces,
  KIT_VIEWBOX,
  pieceForControl,
  removeControlFromPiece,
  useKit,
  VOICE_INFO,
  prefersReducedMotion,
} from '../../kit';
import { byX, pieceElement } from './kitEdits';
import {
  ADVANCE_DELAY_MS,
  controlChipText,
  controlNoun,
  controlZone,
  fallbackVoices,
  learnedControls,
  MONITOR_LENGTH,
  unlearnedQueue,
} from './learn';
import {
  Dot,
  Kbd,
  Note,
  OK_COLOR,
  Panel,
  SectionTitle,
  Stage,
  WARN_COLOR,
} from './parts';
import './kitLab.css';

interface LearnState {
  /** Piece the next hit is assigned to. */
  listening: string | null;
  /** Pieces still to learn after this one ("Learn unmapped pads"), or null when learning one pad. */
  queue: string[] | null;
}

interface MonitorEntry {
  id: number;
  controlId: string;
  value: number;
  /** Owning pad, or null when nothing on the kit answers to it. */
  who: string | null;
}

const IDLE: LearnState = { listening: null, queue: null };
const NONE = '__none';

function fallbackText(voices: string[]): string {
  return voices.length === 1
    ? `using ${voices[0]}'s mapping from Input settings`
    : `using the ${voices.join(' and ')} mappings from Input settings`;
}

export function LearnPads() {
  const { kit, updateKit } = useKit();
  const { selectedDevice, setSelectedDevice, inputMapping } = useInput();
  const [learn, setLearn] = useState<LearnState>(IDLE);
  const [toast, setToast] = useState('');
  const [monitor, setMonitor] = useState<MonitorEntry[]>([]);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [prevKitId, setPrevKitId] = useState(kit.id);
  const svgRef = useRef<SVGSVGElement>(null);
  const advanceTimer = useRef<number | undefined>(undefined);
  const entryId = useRef(0);

  if (prevKitId !== kit.id) {
    setPrevKitId(kit.id);
    setLearn(IDLE);
    setToast('');
  }

  const listeningPiece = kit.pieces.find((p) => p.id === learn.listening);
  const isListening = listeningPiece !== undefined;
  const learnedCount = kit.pieces.filter(
    (p) => learnedControls(kit, p.id).length > 0,
  ).length;
  const deviceLive =
    selectedDevice !== null && devices.some((d) => d.id === selectedDevice.id);
  const cancelAdvance = () => {
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = undefined;
  };
  const stopLearning = () => {
    cancelAdvance();
    setLearn(IDLE);
  };
  const toggleLearning = (pieceId: string) => {
    cancelAdvance();
    setToast('');
    setLearn((s) => ({
      listening: s.listening === pieceId ? null : pieceId,
      queue: null,
    }));
  };
  const learnUnmapped = () => {
    const queue = unlearnedQueue(kit);

    cancelAdvance();

    if (queue.length === 0) {
      setToast('Every pad is already mapped.');
      setLearn(IDLE);

      return;
    }

    setToast('');
    setLearn({ listening: queue[0], queue: queue.slice(1) });
  };
  const flash = (pieceId: string) => {
    const el = pieceElement(svgRef.current, pieceId)?.querySelector<SVGElement>(
      '[data-flash]',
    );

    el?.animate?.([{ opacity: 0.7 }, { opacity: 0 }], {
      duration: prefersReducedMotion() ? 1 : 280,
    });
  };
  const log = (controlId: string, value: number, who: string | null) => {
    entryId.current += 1;

    const entry = { id: entryId.current, controlId, value, who };

    setMonitor((m) => [entry, ...m].slice(0, MONITOR_LENGTH));
  };
  const learnHit = (controlId: string, value: number) => {
    const piece = listeningPiece;

    if (!piece) {
      return;
    }

    const { movedFrom } = assignControlToPiece(kit, piece.id, controlId);

    // Updater form: two hits before the next render must both land.
    updateKit((k) => assignControlToPiece(k, piece.id, controlId).kit);
    setToast(
      movedFrom
        ? `${controlNoun(controlId)} was on ${movedFrom.name}; moved it to ${
            piece.name
          }.`
        : '',
    );
    log(
      controlId,
      value,
      `${piece.name} · ${controlZone(controlId) ?? 'learned'}`,
    );
    flash(piece.id);

    if (learn.queue !== null) {
      cancelAdvance();
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = undefined;
        setLearn((s) => {
          if (s.queue === null) {
            return s;
          }

          return s.queue.length > 0
            ? { listening: s.queue[0], queue: s.queue.slice(1) }
            : IDLE;
        });
      }, ADVANCE_DELAY_MS);
    }
  };
  const onMonitored = useEffectEvent(({ controlId, value }: InputEvent) => {
    const owner = pieceForControl(kit, controlId, inputMapping);

    if (!owner) {
      log(controlId, value, null);

      return;
    }

    const learned = learnedControls(kit, owner.id).includes(controlId);
    const zone = controlZone(controlId);

    log(
      controlId,
      value,
      learned
        ? [owner.name, zone].filter(Boolean).join(' · ')
        : `${owner.name} · via Input settings`,
    );
    flash(owner.id);
  });
  const onCaptured = useEffectEvent(({ controlId, value }: InputEvent) => {
    // Keys are learned by the key listener below (which swallows them first).
    if (controlSource(controlId) !== 'keyboard') {
      learnHit(controlId, value);
    }
  });
  const onLearnKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.key === 'Tab' ||
      isTypingTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type !== 'keydown' || event.repeat) {
      return;
    }

    if (event.key === 'Escape') {
      stopLearning();

      return;
    }

    learnHit(makeControlId('keyboard', event.code), 127);
  });

  // Not learning: show hits in the monitor and flash the pad they belong to.
  useEffect(() => inputBus.subscribe((event) => onMonitored(event)), []);

  // Learning: take every MIDI note exclusively for the listening pad.
  useEffect(() => {
    if (!isListening) {
      return undefined;
    }

    return inputBus.capture((event) => onCaptured(event));
  }, [isListening]);

  // Learning: keys become pads (except Tab and Esc) instead of doing their usual thing.
  useEffect(() => {
    if (!isListening) {
      return undefined;
    }

    const handler = (event: KeyboardEvent) => onLearnKey(event);

    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', handler, true);

    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', handler, true);
    };
  }, [isListening]);

  useEffect(() => {
    const timer = advanceTimer;

    return () => window.clearTimeout(timer.current);
  }, []);

  const refreshDevices = useCallback(() => {
    inputBus.listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const renderPadNotes = (piece: KitPiece) => {
    const controls = learnedControls(kit, piece.id);

    if (controls.length > 0) {
      return controls.map((controlId) => (
        <span
          key={controlId}
          className="text-[11px] tabular-nums bg-surface-raised border border-border rounded-[5px] pl-1.5 pr-0.5 py-px inline-flex items-center gap-0.5"
        >
          {controlChipText(controlId)}
          <button
            type="button"
            aria-label={`Remove ${controlNoun(controlId)} from ${piece.name}`}
            onClick={() =>
              updateKit((k) => removeControlFromPiece(k, piece.id, controlId))
            }
            className="border-0 bg-transparent text-text-dim hover:text-text cursor-pointer px-[3px] leading-none"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </span>
      ));
    }

    const fallback = fallbackVoices(kit, piece, inputMapping).map(
      (v) => VOICE_INFO[v].name,
    );

    return fallback.length > 0 ? (
      <span className="text-[11px] text-text-muted">
        Not learned · {fallbackText(fallback)}
      </span>
    ) : (
      <span className="text-[11px]" style={{ color: WARN_COLOR }}>
        not mapped
      </span>
    );
  };

  return (
    <div className="grid gap-4 items-start grid-cols-[minmax(0,1fr)_360px] max-[760px]:grid-cols-1">
      <div className="flex flex-col gap-3 min-w-0">
        {kit.kind === 'acoustic' && (
          <div
            role="note"
            className="flex gap-2.5 items-start rounded-[10px] px-3 py-2.5 text-[13px] border"
            style={{
              borderColor: `color-mix(in srgb, ${WARN_COLOR} 45%, transparent)`,
              background: `color-mix(in srgb, ${WARN_COLOR} 8%, var(--color-surface))`,
            }}
          >
            <FontAwesomeIcon
              icon={faTriangleExclamation}
              className="mt-0.5"
              style={{ color: WARN_COLOR }}
            />
            <div>
              <b className="text-text">This is an acoustic kit.</b> It sends no
              MIDI, so its pads can only be learned from MIDI once you add
              triggers (or a trigger-to-MIDI module). Until then, learn a
              keyboard key for each piece and play it with the keyboard.
            </div>
          </div>
        )}
        <div className="flex items-center gap-3.5 flex-wrap bg-surface border border-border rounded-xl px-3.5 py-3">
          <div className="flex-[1_1_240px] font-display text-[20px] leading-tight text-text">
            {listeningPiece ? (
              <>
                Hit the{' '}
                <em className="text-accent-bright">{listeningPiece.name}</em>{' '}
                now.
              </>
            ) : (
              'Click a piece, then hit it.'
            )}
            <Note className="font-ui mt-1">
              {listeningPiece
                ? [
                    'Hit every zone you use (head, rim, bell…), or press a key. Each new note is added to this pad.',
                    learn.queue ? `${learn.queue.length} more after this.` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                : `${learnedCount} of ${kit.pieces.length} pads learned. Hits on mapped pads light up here so you can test.`}
            </Note>
          </div>
          {listeningPiece && (
            <Button onClick={stopLearning}>
              Done <Kbd>Esc</Kbd>
            </Button>
          )}
        </div>
        <Stage>
          <svg
            key={kit.id}
            ref={svgRef}
            viewBox={KIT_VIEWBOX}
            role="img"
            aria-label="Kit, click a piece to learn its pad"
            onClick={(e) => {
              const id = (e.target as Element).closest<SVGGElement>(
                '[data-piece-id]',
              )?.dataset.pieceId;

              if (id) {
                toggleLearning(id);
              }
            }}
          >
            <KitPieces
              kit={kit}
              showLabels
              pieceProps={() => ({ style: { cursor: 'pointer' } })}
              renderOverlay={(p) => {
                const r = hitRadius(p);
                const learned = learnedControls(kit, p.id).length > 0;

                return (
                  <g pointerEvents="none">
                    <circle data-flash r={r + 1} fill="#fff" opacity={0} />
                    {p.id === learn.listening && (
                      <circle
                        className="kit-listen-ring"
                        r={r + 2}
                        fill="none"
                        stroke="var(--color-accent-bright)"
                        strokeWidth={0.9}
                      />
                    )}
                    <g
                      transform={`translate(${(r * 0.75).toFixed(2)} ${(
                        -r * 0.75
                      ).toFixed(2)})`}
                    >
                      <circle
                        r={2.3}
                        fill={learned ? OK_COLOR : 'var(--color-accent)'}
                        stroke="#0d0e10"
                        strokeWidth={0.4}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={2.8}
                        fontWeight={700}
                        fill="#fff"
                        style={{ fontFamily: 'var(--font-ui)' }}
                      >
                        {learned ? '✓' : '?'}
                      </text>
                    </g>
                  </g>
                );
              }}
            />
          </svg>
        </Stage>
      </div>

      <Panel aria-label="Pads and input">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-muted">Input device</span>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 rounded-full shrink-0"
              style={
                deviceLive
                  ? { background: OK_COLOR, boxShadow: `0 0 8px ${OK_COLOR}` }
                  : { background: 'var(--color-text-dim)' }
              }
            />
            <Select
              aria-label="Input device"
              className="grow min-w-0"
              value={selectedDevice?.id ?? NONE}
              // Opening the list is a user gesture, which the web build needs
              // before the browser will ask for MIDI permission.
              onOpenChange={(open) => open && refreshDevices()}
              notFoundContent="No devices found"
              onChange={(id) =>
                setSelectedDevice(devices.find((d) => d.id === id) ?? null)
              }
              options={[
                { value: NONE, label: '- None -' },
                ...devices.map(({ id, name }) => ({ value: id, label: name })),
              ]}
            />
            <Button
              aria-label="Refresh device list"
              title="Refresh device list"
              icon={<FontAwesomeIcon icon={faArrowsRotate} />}
              onClick={refreshDevices}
            />
          </div>
          {!devices.some((d) => d.sourceId === 'midi') && (
            <Note>
              No MIDI devices found. Plug in your module (or phone in USB MIDI
              mode), then open this list or press refresh. In the browser build,
              allow MIDI access when asked.
            </Note>
          )}
          <Note>
            {selectedDevice?.sourceId === 'midi'
              ? `Pads send notes from ${selectedDevice.name}. Keys work too.`
              : 'No MIDI device selected: only keys can be learned. Pick your drum module to learn its pads.'}
          </Note>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="primary" onClick={learnUnmapped}>
            Learn unmapped pads
          </Button>
        </div>
        <p
          aria-live="polite"
          className="m-0 text-xs min-h-[1.2em]"
          style={{ color: WARN_COLOR }}
        >
          {toast}
        </p>
        <SectionTitle>Pads</SectionTitle>
        <ul className="list-none m-0 p-0 flex flex-col gap-1">
          {byX(kit.pieces).map((p) => (
            <li
              key={p.id}
              className={`grid grid-cols-[12px_minmax(0,1fr)_auto] gap-2 items-center px-2 py-1.5 rounded-lg bg-surface-sunken border ${
                p.id === learn.listening
                  ? 'border-accent-bright'
                  : 'border-transparent'
              }`}
            >
              <Dot color={p.color} />
              <div className="min-w-0">
                <div className="font-semibold text-text text-[13px] truncate">
                  {p.name}
                </div>
                <div className="flex flex-wrap gap-1 mt-[3px]">
                  {renderPadNotes(p)}
                </div>
              </div>
              <Button
                size="small"
                type={p.id === learn.listening ? 'primary' : 'default'}
                onClick={() => toggleLearning(p.id)}
              >
                {p.id === learn.listening ? 'Listening…' : 'Learn'}
              </Button>
            </li>
          ))}
        </ul>
        <Note>
          Pads you haven&apos;t learned play through the voice mapping in Input
          settings.
        </Note>
        <SectionTitle>Input monitor</SectionTitle>
        {monitor.length === 0 ? (
          <Note>Hit a pad or press a key to see it here.</Note>
        ) : (
          <ol className="list-none m-0 p-0 text-xs flex flex-col gap-[3px]">
            {monitor.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[58px_74px_minmax(0,1fr)] gap-2 items-center px-1.5 py-1 rounded-md bg-surface-sunken"
              >
                <span className="tabular-nums truncate">
                  {controlNoun(m.controlId)}
                </span>
                <span
                  title={`velocity ${m.value}`}
                  className="relative h-[5px] rounded-[3px] bg-fill-strong overflow-hidden"
                >
                  <i
                    className="absolute inset-y-0 left-0 bg-accent-bright"
                    style={{ width: `${(m.value / 127) * 100}%` }}
                  />
                </span>
                <span
                  className="truncate"
                  style={{
                    color: m.who ? 'var(--color-text-body)' : WARN_COLOR,
                  }}
                >
                  {m.who ?? 'unmapped'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
