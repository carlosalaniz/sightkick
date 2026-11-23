import { KitPiece } from '../../../../kit';
import { SongSection, sectionIndexAt } from './helpers';
import {
  Judgment,
  ScoreState,
  ScoringRules,
  Summary,
  summarize,
  summarizeBy,
  weakest,
} from './scoring';

export interface ArcadeResults {
  summary: Summary;
  score: ScoreState;
  /** Song speed the run was played at, 0.3–2. */
  speed: number;
  pads: { piece: KitPiece; summary: Summary }[];
  sections: { index: number; name: string; summary: Summary }[];
  /** Index (into the song's sections) of the weakest section, if any. */
  weakestSection: number | undefined;
}

export function buildResults(
  judgments: Judgment[],
  rules: ScoringRules,
  score: ScoreState,
  speed: number,
  pieces: KitPiece[],
  sections: SongSection[],
): ArcadeResults {
  const pads = summarizeBy(
    judgments,
    rules,
    (j) => j.pieceId,
    pieces.map((p) => p.id),
  ).map((g) => ({
    piece: pieces.find((p) => p.id === g.key) as KitPiece,
    summary: g.summary,
  }));
  const bySection = summarizeBy(
    judgments,
    rules,
    (j) => sectionIndexAt(sections, j.time),
    sections.map((_, i) => i),
  );

  return {
    summary: summarize(judgments, rules),
    score,
    speed,
    pads,
    sections: bySection.map((g) => ({
      index: g.key,
      name: sections[g.key].name,
      summary: g.summary,
    })),
    weakestSection: bySection.length > 1 ? weakest(bySection)?.key : undefined,
  };
}
