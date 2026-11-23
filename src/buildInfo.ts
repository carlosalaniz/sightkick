/** The running build's version and commit (set at build time, see scripts/build-info.ts). */
export const BUILD: { version: string; commit: string; dirty: boolean } =
  typeof __SK_BUILD__ === 'object' && __SK_BUILD__
    ? __SK_BUILD__
    : { version: 'dev', commit: 'unknown', dirty: false };

/**
 * e.g. "v0.1.7 · 8376bdd", with "· modified" for a build with uncommitted
 * changes. The version rises with every commit (scripts/bump-version.mjs), so
 * it alone tells builds apart where the commit is unknown (Harbor).
 */
export function buildLabel(build = BUILD): string {
  const commit =
    build.commit === 'unknown' ? undefined : build.commit.slice(0, 7);

  return [`v${build.version}`, commit, build.dirty ? 'modified' : undefined]
    .filter(Boolean)
    .join(' · ');
}
