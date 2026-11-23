import { Ref } from 'react';
import { Button, Input, Slider } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { KitPiece, PIECE_PALETTE, PIECE_TYPES, VOICES } from '../../kit';
import { toggleVoice } from './kitEdits';
import { Dot, Note, SectionTitle } from './parts';

interface Props {
  piece: KitPiece | undefined;
  positionRef: Ref<HTMLSpanElement>;
  onChange: (patch: Partial<Omit<KitPiece, 'id'>>) => void;
  onRemove: () => void;
}

function FieldLabel({
  children,
  value,
  htmlFor,
}: {
  children: string;
  value?: string;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex justify-between text-xs text-text-muted"
    >
      <span>{children}</span>
      {value && <span className="tabular-nums">{value}</span>}
    </label>
  );
}

export function PieceInspector({
  piece,
  positionRef,
  onChange,
  onRemove,
}: Props) {
  if (!piece) {
    return (
      <>
        <SectionTitle>Selected piece</SectionTitle>
        <Note>
          Select a piece on the kit or in the list to set its size, which chart
          voice it plays, and its highway color.
        </Note>
        <SectionTitle>About chart voices</SectionTitle>
        <Note>
          Charts only have 8 drum voices (Hi-hat, Crash, Ride, Snare, 3 toms,
          Kick). A piece can play more than one voice, and two pieces can share
          one, e.g. two crashes both playing <b>Crash</b>.
        </Note>
      </>
    );
  }

  const info = PIECE_TYPES[piece.type];

  return (
    <>
      <SectionTitle>Selected piece</SectionTitle>
      <div className="flex items-center gap-2.5">
        <Dot color={piece.color} size={14} />
        <Input
          aria-label="Piece name"
          className="font-semibold"
          value={piece.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={() => {
            if (!piece.name.trim()) {
              onChange({ name: info.label });
            }
          }}
        />
      </div>
      <Note>
        {info.label}
        {info.pedal ? '' : ` · ${piece.size}″`}
      </Note>
      {!info.pedal && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel value={`${piece.size}″`}>Size</FieldLabel>
          <Slider
            aria-label="Size in inches"
            min={6}
            max={22}
            step={1}
            value={piece.size}
            tooltip={{ open: false }}
            onChange={(size) => onChange({ size })}
            className="m-0 mx-1"
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Plays as (chart voice)</FieldLabel>
        <div className="flex flex-wrap gap-[5px]">
          {VOICES.map((v) => {
            const on = piece.voices.includes(v.id);

            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({ voices: toggleVoice(piece.voices, v.id) })
                }
                className={`rounded-full border px-[9px] py-1 text-xs cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:outline-offset-2 ${
                  on
                    ? 'bg-accent/20 border-accent/55 text-text'
                    : 'bg-surface-sunken border-border text-text-muted hover:text-text-body'
                }`}
              >
                {v.name}
              </button>
            );
          })}
        </div>
        {info.pedal && (
          <Note>
            Charts don&apos;t contain hi-hat pedal notes. The pedal is learned
            so its chick doesn&apos;t count as a stray hit.
          </Note>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Highway color</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {PIECE_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={c === piece.color}
              onClick={() => onChange({ color: c })}
              className={`size-[22px] rounded-full border-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:outline-offset-2 ${
                c === piece.color ? 'border-text' : 'border-transparent'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Position</FieldLabel>
        <span
          ref={positionRef}
          className="text-xs text-text-muted tabular-nums"
        >
          {/* One text child: drags overwrite textContent directly. */}
          {`x ${Math.round(piece.x)} · y ${Math.round(piece.y)}`}
        </span>
      </div>
      <Button
        danger
        icon={<FontAwesomeIcon icon={faTrashCan} />}
        onClick={onRemove}
      >
        Remove from kit
      </Button>
    </>
  );
}
