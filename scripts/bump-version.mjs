// pre-commit hook (.githooks/pre-commit): raises the patch version in
// package.json with every commit, so each build says which one it is. A
// Harbor build has no .git to ask, but it always has package.json.
//
// It edits the staged copy (and the working copy to match) rather than
// running `git add`, so other unstaged edits to package.json stay out of the
// commit. A commit that already changes the version (by hand, or a second
// run) is left alone. Skip it with SK_SKIP_VERSION_BUMP=1 or --no-verify.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'package.json';
const VERSION = /("version"\s*:\s*")(\d+)\.(\d+)\.(\d+)(")/;
const git = (args, input) =>
  execFileSync('git', args, {
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  }).toString();

function versionOf(text) {
  const match = text?.match(VERSION);

  return match ? match.slice(2, 5).join('.') : undefined;
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

if (process.env.SK_SKIP_VERSION_BUMP === '1') {
  process.exit(0);
}

const staged = tryGit(['show', `:${FILE}`]);
const current = versionOf(staged);

if (!staged || !current) {
  process.exit(0);
}

const before = tryGit(['show', `HEAD:${FILE}`]);

// The first commit, or one that already sets its own version: leave it.
if (before === undefined || versionOf(before) !== current) {
  process.exit(0);
}

const [major, minor, patch] = current.split('.').map(Number);
const next = `${major}.${minor}.${patch + 1}`;
const bump = (text) =>
  text.replace(VERSION, (_, pre, _a, _b, _c, post) => `${pre}${next}${post}`);
const blob = git(
  ['hash-object', '-w', '--stdin', '--path', FILE],
  bump(staged),
).trim();
const mode = git(['ls-files', '-s', FILE]).split(/\s+/)[0] || '100644';

git(['update-index', '--cacheinfo', `${mode},${blob},${FILE}`]);

const working = readFileSync(FILE, 'utf8');

if (versionOf(working) === current) {
  writeFileSync(FILE, bump(working));
}

console.log(`SightKick version ${current} -> ${next}`);
