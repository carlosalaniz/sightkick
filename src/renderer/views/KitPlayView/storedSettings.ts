/**
 * Parsers for what the kit play views keep in localStorage. Stored JSON is
 * outside data: an old build, another tab or a hand edit can leave any
 * shape under a key. Each parser returns our type, or undefined when the
 * value can't be used, so the caller falls back to its default.
 */

/** How the Play view lays out its highway (`settings.kitPlayLayout`). */
export type KitPlayLayout = 'kit' | 'lanes';

export function parseKitPlayLayout(raw: unknown): KitPlayLayout | undefined {
  return raw === 'kit' || raw === 'lanes' ? raw : undefined;
}
