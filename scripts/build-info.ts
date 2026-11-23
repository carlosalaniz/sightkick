import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

/** What a build is: shown in the app and served as version.json by the web build. */
export interface BuildInfo {
  version: string;
  /** Full commit hash, or 'unknown' when the build couldn't tell. */
  commit: string;
  /** Built from a working tree with uncommitted changes. */
  dirty: boolean;
}

const root = path.resolve(__dirname, '..');

function git(...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * The commit comes from SK_COMMIT or HARBOR_SOURCE_COMMIT when set (a Docker
 * build has no .git), else from git itself.
 */
export function buildInfo(): BuildInfo {
  const { version } = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { version: string };
  const given = (
    process.env.SK_COMMIT || process.env.HARBOR_SOURCE_COMMIT
  )?.trim();

  if (given) {
    return { version, commit: given, dirty: false };
  }

  const commit = git('rev-parse', 'HEAD');

  return {
    version,
    commit: commit ?? 'unknown',
    dirty: commit !== undefined && !!git('status', '--porcelain'),
  };
}
