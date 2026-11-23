import { Button, Select } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';

export const TEMPO_MIN = 0.5;

export const TEMPO_MAX = 1.2;

export const TEMPO_STEP = 0.05;

const OPTIONS = Array.from(
  { length: Math.round((TEMPO_MAX - TEMPO_MIN) / TEMPO_STEP) + 1 },
  (_, i) => Math.round((TEMPO_MIN + i * TEMPO_STEP) * 100),
);

/** Snaps a speed to the control's 5% grid, within its range. */
export function snapTempo(speed: number): number {
  const pct = Math.round((speed * 100) / 5) * 5;

  return Math.min(TEMPO_MAX * 100, Math.max(TEMPO_MIN * 100, pct)) / 100;
}

/**
 * Lesson tempo: − / preset list / +. The lesson still moves the tempo itself
 * (it slows down after rough passes and starts each lesson at its star speed);
 * this lets the player override it at any time.
 */
export function TempoControl({
  speed,
  starSpeed,
  onChange,
}: {
  speed: number;
  /** Stars are only earned at this speed or faster. */
  starSpeed: number;
  onChange: (speed: number) => void;
}) {
  const pct = Math.round(speed * 100);
  const step = (dir: 1 | -1) => onChange(snapTempo(speed + dir * TEMPO_STEP));
  const belowStar = speed < starSpeed - 1e-6;

  return (
    <div
      className="flex items-center gap-1"
      data-testid="lesson-tempo"
      title={`Playback tempo. Stars are earned at ${Math.round(
        starSpeed * 100,
      )}% or faster.`}
    >
      <span className="text-text-muted text-[13px] mr-1">Tempo</span>
      <Button
        aria-label="Slower"
        data-testid="tempo-down"
        icon={<FontAwesomeIcon icon={faMinus} />}
        disabled={speed <= TEMPO_MIN + 1e-6}
        onClick={() => step(-1)}
      />
      <Select
        aria-label="Tempo"
        data-testid="tempo-select"
        value={pct}
        popupMatchSelectWidth={false}
        style={{ width: 84 }}
        onChange={(value: number) => onChange(value / 100)}
        options={(OPTIONS.includes(pct) ? OPTIONS : [...OPTIONS, pct])
          .sort((a, b) => a - b)
          .map((value) => ({ value, label: `${value}%` }))}
      />
      <Button
        aria-label="Faster"
        data-testid="tempo-up"
        icon={<FontAwesomeIcon icon={faPlus} />}
        disabled={speed >= TEMPO_MAX - 1e-6}
        onClick={() => step(1)}
      />
      {belowStar && (
        <span className="text-text-faint text-xs ml-1">
          no star below {Math.round(starSpeed * 100)}%
        </span>
      )}
    </div>
  );
}
