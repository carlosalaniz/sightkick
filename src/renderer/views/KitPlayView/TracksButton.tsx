import { isValidElement, ReactNode, useState } from 'react';
import { Button, Popover } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSliders } from '@fortawesome/free-solid-svg-icons';
import { popoverOpenChange, popoverStyles } from '../../overlayStyles';

// AudioVolume renders label / slider / mute / solo as siblings, so every
// group of rows needs this grid around it to line up.
const ROWS =
  'grid grid-cols-[minmax(64px,max-content)_1fr_max-content_max-content] items-center gap-x-2 gap-y-2';

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-text-muted text-xs uppercase tracking-[.12em] font-semibold">
      {children}
    </div>
  );
}

function describeScale(scale: number): string {
  return scale <= 0 ? 'muted' : `at ${Math.round(scale * 100)}%`;
}

/**
 * The mixer for the kit play screens: master, one row per stem (with mute
 * and solo) and the click. `stemScales` are levels a view applies on top of
 * the sliders (the lesson turns the drums down while you play them), shown
 * so a full slider with silent drums doesn't look broken.
 */
export function TracksButton({
  masterVolumeControl,
  volumeSliders,
  clickControls,
  stemScales = {},
  kitStems = [],
}: {
  masterVolumeControl: ReactNode;
  /** One slider per stem, keyed by stem name. */
  volumeSliders: ReactNode[];
  clickControls: ReactNode;
  stemScales?: Record<string, number>;
  /** Kit-piece stems, in kit order; shown in their own group. */
  kitStems?: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const scaled = Object.entries(stemScales).filter(([, s]) => s < 1);
  const nameOf = (slider: ReactNode) =>
    isValidElement(slider) ? String(slider.key) : '';
  const kitSliders = kitStems.flatMap((name) =>
    volumeSliders.filter((s) => nameOf(s) === name),
  );
  const songSliders = volumeSliders.filter(
    (s) => !kitStems.includes(nameOf(s)),
  );

  return (
    <Popover
      open={isOpen}
      onOpenChange={popoverOpenChange(setIsOpen)}
      trigger="click"
      placement="bottomRight"
      styles={popoverStyles}
      content={
        <div
          className="w-[min(400px,calc(100vw-32px))] flex flex-col gap-4"
          data-testid="tracks-mixer"
        >
          <div className="flex flex-col gap-2">
            <SectionTitle>Output</SectionTitle>
            <div className={ROWS}>{masterVolumeControl}</div>
          </div>
          {kitSliders.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="kit-tracks">
              <SectionTitle>Drum kit</SectionTitle>
              <div className={ROWS}>{kitSliders}</div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <SectionTitle>
              {kitSliders.length > 0 ? 'Rest of the song' : 'Song tracks'}
            </SectionTitle>
            {songSliders.length > 0 || kitSliders.length > 0 ? (
              <div className={ROWS}>{songSliders}</div>
            ) : (
              <div className="text-text-faint text-sm">
                This song has a single audio track. Split it into stems from the
                song list (⋮ → Split stems) to mix the drums separately.
              </div>
            )}
            {scaled.map(([name, scale]) => (
              <div
                key={name}
                className="text-xs rounded-md px-2.5 py-1.5 bg-surface text-text-muted"
                data-testid={`stem-scale-${name}`}
              >
                <span className="capitalize">{name}</span>: the lesson has it{' '}
                {describeScale(scale)} for this step, on top of the slider.
              </div>
            ))}
            <div className="text-text-faint text-xs">
              M mutes a track, S plays only that track. Levels are remembered.
            </div>
          </div>
          <div className="flex flex-col gap-2">{clickControls}</div>
        </div>
      }
    >
      <Button
        icon={<FontAwesomeIcon icon={faSliders} />}
        data-testid="tracks-button"
      >
        Tracks
      </Button>
    </Popover>
  );
}
