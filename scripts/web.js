// One-command local run of the browser build: `yarn web`.
// Installs dependencies on first run (skipping the Electron/native builds the
// web version doesn't need), then starts the dev server and opens a browser.
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const port = process.env.PORT || '5173';

if (!fs.existsSync(path.join(root, 'node_modules', 'vite'))) {
  console.log('Installing dependencies (first run)...');
  execSync('yarn install --mode=skip-build', { cwd: root, stdio: 'inherit' });
}

const vite = spawn(
  'yarn',
  ['vite', '--config', 'vite.web.config.ts', '--port', port, '--open'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);

vite.on('exit', (code) => process.exit(code ?? 0));
