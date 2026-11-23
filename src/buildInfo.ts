/** The running build's version and commit (set at build time, see scripts/build-info.ts). */
export const BUILD: { version: string; commit: string; dirty: boolean } =
  typeof __SK_BUILD__ === 'object' && __SK_BUILD__
    ? __SK_BUILD__
    : { version: 'dev', commit: 'unknown', dirty: false };

/** e.g. "v0.1.0 · 8376bdd" (with "· modified" for a build with uncommitted changes). */
export function buildLabel(build = BUILD): string {
  const commit =
    build.commit === 'unknown' ? 'commit unknown' : build.commit.slice(0, 7);

  return [`v${build.version}`, commit, build.dirty ? 'modified' : undefined]
    .filter(Boolean)
    .join(' · ');
}
