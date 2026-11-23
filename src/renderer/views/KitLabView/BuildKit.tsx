import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { Button, Checkbox, Input, Segmented } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRotateLeft,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import {
  hitRadius,
  KitKind,
  KitPieces,
  KIT_VIEWBOX,
  PIECE_TYPE_ORDER,
  PIECE_TYPES,
  PieceTypeIcon,
  useKit,
  VOICE_INFO,
} from '../../kit';
import {
  byX,
  createPiece,
  LayoutHistory,
  removePiece,
  updatePiece,
  voiceCoverage,
} from './kitEdits';
import { PieceInspector } from './PieceInspector';
import {
  Dot,
  Kbd,
  Note,
  Panel,
  SectionTitle,
  Stage,
  WARN_COLOR,
} from './parts';
import { useKitStage } from './useKitStage';

const KINDS: { value: KitKind; label: string }[] = [
  { value: 'electronic', label: 'Electronic' },
  { value: 'acoustic', label: 'Acoustic' },
];

interface Props {
  history: LayoutHistory;
  setHistory: Dispatch<SetStateAction<LayoutHistory>>;
}

export function BuildKit({ history, setHistory }: Props) {
  const { kit, updateKit } = useKit();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [prevKitId, setPrevKitId] = useState(kit.id);

  if (prevKitId !== kit.id) {
    setPrevKitId(kit.id);
    setSelectedId(null);
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const selected = kit.pieces.find((p) => p.id === selectedId);
  const { canUndo, tidy, standard, undo, svgHandlers } = useKitStage({
    kit,
    updateKit,
    snap,
    selectedId,
    setSelectedId,
    history,
    setHistory,
    svgRef,
    positionRef,
  });

  return (
    <div className="grid gap-4 items-start grid-cols-[230px_minmax(0,1fr)_290px] max-[1100px]:grid-cols-[200px_minmax(0,1fr)] max-[760px]:grid-cols-1">
      <Panel aria-label="Pieces">
        <SectionTitle>Add a piece</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {PIECE_TYPE_ORDER.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                const piece = createPiece(kit, type);

                updateKit((k) => ({ ...k, pieces: [...k.pieces, piece] }));
                setSelectedId(piece.id);
              }}
              className="flex items-center gap-[7px] text-left bg-surface-raised border border-border rounded-lg px-2 py-[7px] text-xs text-text-body cursor-pointer hover:border-text-muted focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:outline-offset-2"
            >
              <PieceTypeIcon
                type={type}
                kind={kit.kind}
                className="size-[18px] shrink-0"
              />
              <span className="min-w-0 truncate">
                {PIECE_TYPES[type].label}
              </span>
            </button>
          ))}
        </div>
        <SectionTitle>On this kit</SectionTitle>
        <ul
          aria-label="Pieces on this kit"
          className="list-none m-0 p-0 flex flex-col gap-0.5"
        >
          {kit.pieces.length === 0 && (
            <li>
              <Note>Nothing yet. Add pieces from above.</Note>
            </li>
          )}
          {byX(kit.pieces).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-current={p.id === selectedId}
                onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center gap-2 border-0 px-2 py-1.5 rounded-[7px] cursor-pointer text-left text-text-body focus-visible:outline-2 focus-visible:outline-accent-bright ${
                  p.id === selectedId
                    ? 'bg-fill-strong'
                    : 'bg-transparent hover:bg-fill'
                }`}
              >
                <Dot color={p.color} />
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-text-dim">
                  {p.voices.map((v) => VOICE_INFO[v].name).join(', ') || '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            aria-label="Kit name"
            value={kit.name}
            onChange={(e) => {
              const name = e.target.value;

              updateKit((k) => ({ ...k, name }));
            }}
            onBlur={() => {
              if (!kit.name.trim()) {
                updateKit((k) => ({ ...k, name: 'Untitled kit' }));
              }
            }}
            className="font-display text-[18px] flex-[1_1_200px] min-w-0"
          />
          <Segmented
            aria-label="Kit type"
            value={kit.kind}
            options={KINDS}
            onChange={(kind) => updateKit((k) => ({ ...k, kind }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={faWandMagicSparkles} />}
            title="Keep your layout; align rows, even out spacing, center on the kick, snap to grid"
            onClick={tidy}
            disabled={kit.pieces.length === 0}
          >
            Tidy
          </Button>
          <Button
            title="Rebuild as a standard right-handed layout"
            onClick={standard}
            disabled={kit.pieces.length === 0}
          >
            Standard layout
          </Button>
          <Button
            icon={<FontAwesomeIcon icon={faArrowRotateLeft} />}
            onClick={undo}
            disabled={!canUndo}
          >
            Undo
          </Button>
          <div className="grow" aria-hidden="true" />
          <Checkbox checked={snap} onChange={(e) => setSnap(e.target.checked)}>
            Snap to grid
          </Checkbox>
        </div>
        <Stage>
          <svg
            key={kit.id}
            ref={svgRef}
            viewBox={KIT_VIEWBOX}
            aria-label="Top-down view of the kit"
            role="img"
            {...svgHandlers}
          >
            <KitPieces
              kit={kit}
              showLabels
              showGrid={snap}
              pieceProps={() => ({ style: { cursor: 'grab' } })}
              renderOverlay={(p) =>
                p.id === selectedId ? (
                  <circle
                    r={hitRadius(p) + 3}
                    fill="none"
                    stroke="var(--color-accent-bright)"
                    strokeWidth={0.5}
                    strokeDasharray="1.6 1"
                    pointerEvents="none"
                  />
                ) : null
              }
            />
          </svg>
        </Stage>
        <Note>
          Top-down view from above the throne. Drag pieces to match your setup
          (hold <Kbd>Alt</Kbd> to drag freely); arrow keys nudge the selected
          piece. <Kbd>⌘Z</Kbd> / <Kbd>Ctrl Z</Kbd> undoes. Each piece&apos;s
          position becomes its spot on the play highway.
        </Note>
        <div>
          <SectionTitle className="mb-2">
            Chart voices this kit covers
          </SectionTitle>
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {voiceCoverage(kit).map(({ voice, pieces }) => {
              const covered = pieces.length > 0;

              return (
                <div
                  key={voice.id}
                  className="rounded-[10px] border border-border bg-surface px-2.5 py-2 flex flex-col gap-0.5 min-w-0"
                  style={
                    covered
                      ? undefined
                      : {
                          borderColor: `color-mix(in srgb, ${WARN_COLOR} 45%, transparent)`,
                          background: `color-mix(in srgb, ${WARN_COLOR} 7%, var(--color-surface))`,
                        }
                  }
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-text">
                    {voice.name}
                    <span
                      className={`ml-auto text-[10px] font-semibold tracking-[0.06em] uppercase px-1.5 py-0.5 rounded ${
                        covered
                          ? 'bg-[#3fae6a]/20 text-[#7fd6a0]'
                          : 'bg-[#d9a03a]/20 text-[#f0c46c]'
                      }`}
                    >
                      {covered ? 'on kit' : 'missing'}
                    </span>
                  </div>
                  <div
                    className="text-[11.5px] truncate"
                    style={{
                      color: covered ? 'var(--color-text-muted)' : WARN_COLOR,
                    }}
                  >
                    {covered
                      ? pieces.map((p) => p.name).join(' + ')
                      : 'notes will be skipped'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Panel
        aria-label="Inspector"
        className="max-[1100px]:col-span-full max-[760px]:col-span-1"
      >
        <PieceInspector
          piece={selected}
          positionRef={positionRef}
          onChange={(patch) => {
            if (selected) {
              updateKit((k) => updatePiece(k, selected.id, patch));
            }
          }}
          onRemove={() => {
            if (selected) {
              updateKit((k) => removePiece(k, selected.id));
              setSelectedId(null);
            }
          }}
        />
      </Panel>
    </div>
  );
}
