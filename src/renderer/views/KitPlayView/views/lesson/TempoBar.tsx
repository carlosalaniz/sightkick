import { OK, WARN } from './LessonPanels';

/** The bar spans ±RANGE around the selected tempo. */
const RANGE = 0.12;

/** Within ±STEADY of the selected tempo counts as in tempo. */
export const STEADY = 0.03;

export function tempoVerdict(ratio: number): 'steady' | 'rushing' | 'dragging' {
  if (ratio > 1 + STEADY) {
    return 'rushing';
  }

  return ratio < 1 - STEADY ? 'dragging' : 'steady';
}

/**
 * How the player's tempo compares with the selected one: a marker on a bar
 * centred on the selected tempo, dragging to the left, rushing to the right.
 */
export function TempoBar({
  ratio,
  speed,
  note,
}: {
  /** Played / selected tempo; undefined until there are enough hits. */
  ratio: number | undefined;
  /** Selected playback speed, e.g. 0.8. */
  speed: number;
  /** Replaces the reading, e.g. while wait mode is on. */
  note?: string;
}) {
  const pct = Math.round(speed * 100);
  const verdict = ratio === undefined ? undefined : tempoVerdict(ratio);
  const offset = ratio === undefined ? 0 : ratio - 1;
  const pos = 50 + (Math.max(-RANGE, Math.min(RANGE, offset)) / RANGE) * 50;
  const color = verdict === 'steady' ? OK : WARN;
  const steadyWidth = (STEADY / RANGE) * 100;
  let label = 'Play a few notes to see your tempo';

  if (note) {
    label = note;
  } else if (verdict === 'steady') {
    label = `In tempo with ${pct}%`;
  } else if (verdict) {
    const by = Math.round(Math.abs(offset) * 100);

    label = `${verdict === 'rushing' ? 'Rushing' : 'Dragging'}: ${by}% ${
      verdict === 'rushing' ? 'faster' : 'slower'
    } than ${pct}%`;
  }

  return (
    <div
      className="flex flex-1 basis-[440px] items-center gap-3 min-w-0"
      data-testid="tempo-bar"
      data-verdict={note ? 'off' : verdict ?? 'none'}
      title="Compares the gaps between your hits with the notes at the selected tempo"
    >
      <span className="text-[11px] uppercase tracking-[.12em] font-semibold text-text-muted shrink-0">
        Your tempo
      </span>
      <span className="text-[11px] text-text-faint shrink-0">Dragging</span>
      <div
        className="relative h-2.5 grow min-w-[120px] rounded-full bg-surface overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-y-0 rounded-full"
          style={{
            left: `${50 - steadyWidth / 2}%`,
            width: `${steadyWidth}%`,
            background: OK,
            opacity: 0.25,
          }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-text-faint" />
        {ratio !== undefined && !note && (
          <div
            className="absolute top-0 bottom-0 w-2.5 -ml-[5px] rounded-full transition-[left] duration-200"
            style={{ left: `${pos}%`, background: color }}
          />
        )}
      </div>
      <span className="text-[11px] text-text-faint shrink-0">Rushing</span>
      <span
        className="text-[13px] font-medium shrink-0"
        style={{ color: note || !verdict ? undefined : color }}
        aria-live="polite"
      >
        {label}
      </span>
    </div>
  );
}
