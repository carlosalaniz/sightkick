import { Judgment, ScoringRules, Summary, summarize } from './scoring';

/**
 * Judgments of the current pass, by note id, in the order they happened.
 * Views read it every frame (note status) and the sheet strip subscribes to
 * redraw its marks.
 */
export class JudgmentLog {
  private byId = new Map<string, Judgment>();

  private listeners = new Set<() => void>();

  private cached: { version: number; summary: Summary } | undefined;

  /** Bumped on every change. */
  version = 0;

  constructor(private rules: ScoringRules) {}

  get(noteId: string): Judgment | undefined {
    return this.byId.get(noteId);
  }

  values(): Judgment[] {
    return [...this.byId.values()];
  }

  get size(): number {
    return this.byId.size;
  }

  add(j: Judgment): void {
    this.byId.set(j.noteId, j);
    this.changed();
  }

  clear(): void {
    if (this.byId.size === 0) {
      return;
    }

    this.byId.clear();
    this.changed();
  }

  /** Forgets judgments of notes at or after `time` (a rewind). */
  dropFrom(time: number): void {
    let dropped = false;

    for (const [id, j] of this.byId) {
      if (j.time >= time) {
        this.byId.delete(id);
        dropped = true;
      }
    }

    if (dropped) {
      this.changed();
    }
  }

  /** Summary of everything logged, cached until the next change. */
  summary(): Summary {
    if (this.cached?.version !== this.version) {
      this.cached = {
        version: this.version,
        summary: summarize(this.byId.values(), this.rules),
      };
    }

    return this.cached.summary;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}
