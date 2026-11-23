const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = { ...process.env };

if (os.platform() === 'darwin') {
  try {
    const sdk = execSync('xcrun --show-sdk-path').toString().trim();
    const flags = `-isysroot ${sdk} -I${sdk}/usr/include/c++/v1`;

    env.CXXFLAGS = flags;
    env.CPPFLAGS = flags;
  } catch (e) {
    console.log(e);
  }
}

execSync('install-electron', { stdio: 'inherit', env });
execSync('electron-builder install-app-deps', { stdio: 'inherit', env });

// Use the repo's git hooks (.githooks: the per-commit version bump) when this
// is a git checkout and no other hooks path is set.
try {
  const root = path.resolve(__dirname, '..');

  if (fs.existsSync(path.join(root, '.git'))) {
    let current = '';

    try {
      current = execSync('git config --get core.hooksPath', { cwd: root })
        .toString()
        .trim();
    } catch {
      // Not set.
    }

    if (!current) {
      execSync('git config core.hooksPath .githooks', { cwd: root });
    }
  }
} catch (e) {
  console.log(e);
}
