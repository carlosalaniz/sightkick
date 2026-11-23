/**
 * How the play views name stretches of a song. The lesson keeps its own
 * copies for now (lesson/windows.ts sectionLabel and barRangeLabel); they
 * should move here with the lesson refactor.
 */

/** A raw chart section name as a label: `verse_1` → `Verse 1`, `prc_chorus_a` → `Chorus a`. */
export function prettySectionName(raw: string): string {
  const name = raw
    .replace(/^(prc|section)[_ ]/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return name ? name[0].toUpperCase() + name.slice(1) : 'Section';
}

/** Bars `start` (0-based) up to `end` (exclusive), 1-based: `Bars 5–8`, `Bar 1`. */
export function barRangeLabel(start: number, end: number): string {
  return end - start <= 1 ? `Bar ${start + 1}` : `Bars ${start + 1}–${end}`;
}
