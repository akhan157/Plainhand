#!/usr/bin/env node
// One command for a normal user: the curl installer on the README.
// It keeps the code separate from the workspace (the home folder unless this is
// a git checkout), installs Chromium once when needed, starts the local server
// and opens the browser. No clone, no npm setup, no terminal beyond this.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = name => { const index = argv.indexOf('--' + name); return index < 0 ? null : argv[index + 1]; };
const help = argv.includes('--help') || argv.includes('-h');
const check = argv.includes('--check');
const noOpen = argv.includes('--no-open');
const port = Number(value('port') || process.env.PLAINHAND_PORT || 3210);
const explicitRoot = value('data-root');
const checkout = existsSync(path.join(APP_ROOT, '.git'));
const dataRoot = path.resolve(explicitRoot || (checkout ? APP_ROOT : path.join(os.homedir(), '.plainhand')));
// Update commands are handed to the updater. They are separate from the server so they can
// replace the code this launcher is running from and still exit cleanly.
const COMMANDS = { update: 'apply', rollback: 'rollback', 'update-check': 'check', migrate: 'migrate', status: 'status' };
const command = argv.find(item => Object.hasOwn(COMMANDS, item));

if (help) {
  console.log(`Plainhand — your job applications, in your own words

Install:
  curl -fsSL https://raw.githubusercontent.com/akhan157/Plainhand/main/install.sh | sh

Usage:
  plainhand
  plainhand --port 3211
  plainhand --data-root /path/to/workspace
  plainhand --check
  plainhand update          Install the newest release; your workspace is kept
  plainhand rollback        Return to the version before the last update
  plainhand status          Show versions and any pending workspace migration

Options:
  --port <number>     Port to use (default 3210)
  --data-root <dir>   Workspace folder (default: this checkout, or ~/.plainhand)
  --no-open           Do not open the browser
  --check             Check Node, Chromium and the workspace, then exit
  --version <tag>     For update and rollback: the release tag or ref to use
  --help              Show this help

Node.js 22 or newer is required. The first run downloads Chromium once.`);
  process.exit(0);
}

const major = Number(String(process.versions.node).split('.')[0]);
if (major < 22) {
  console.error(`Plainhand needs Node.js 22 or newer (this is ${process.versions.node}). Install it from https://nodejs.org and run the command again.`);
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Choose a port between 1 and 65535.');
  process.exit(1);
}

if (command) {
  const result = spawnSync(process.execPath, [path.join(APP_ROOT, 'lib', 'plainhand-update.mjs'), COMMANDS[command], ...argv.filter(item => item !== command)], { cwd: APP_ROOT, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

await mkdir(dataRoot, { recursive: true });
const { chromium } = await import('playwright');
const chromiumPath = chromium.executablePath();
const hasChromium = existsSync(chromiumPath);

if (check) {
  console.log(`Node.js ${process.versions.node}`);
  // The state version tells a candidate (and support) whether a start will migrate.
  const stateFile = path.join(dataRoot, 'data', 'plainhand', 'workspace.json');
  let state = existsSync(stateFile) ? 'state version unreadable' : 'new workspace';
  if (existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
      const version = Number.isInteger(parsed.version) ? parsed.version : 1;
      let current = null;
      try { current = (await import(pathToFileURL(path.join(APP_ROOT, 'plainhand', 'migrations.mjs')).href)).STATE_VERSION; } catch { /* deps may be missing; the version alone is useful */ }
      state = current && version < current ? `state version ${version} (migrates to ${current} on the next start)` : `state version ${version}`;
    } catch { /* keep the unreadable message */ }
  }
  console.log(`Workspace ${dataRoot} (${state})`);
  console.log(`Chromium ${hasChromium ? chromiumPath : 'not installed'}`);
  console.log(`Plainhand ${path.join(APP_ROOT, 'plainhand-server.mjs')}`);
  process.exit(0);
}

if (!hasChromium) {
  console.log('Setting up Chromium once for PDFs and form assistance…');
  const cli = path.join(APP_ROOT, 'node_modules', 'playwright', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { cwd: APP_ROOT, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (result.error || result.status !== 0) {
    console.warn('Chromium did not install. Plainhand can still run; PDFs and form assistance need it.');
    console.warn('If needed, run: npx playwright install chromium');
  }
}

const child = spawn(process.execPath, [
  path.join(APP_ROOT, 'plainhand-server.mjs'),
  '--port', String(port),
  '--data-root', dataRoot,
], { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

let opened = false;
const openBrowser = url => {
  if (noOpen || opened) return;
  opened = true;
  try {
    if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* the printed URL is enough */ }
};

child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  const match = String(chunk).match(/Plainhand is ready → (http:\/\/127\.0\.0\.1:\d+)/);
  if (match) openBrowser(match[1]);
});
child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
  if (/EADDRINUSE/.test(String(chunk))) console.error(`Port ${port} is already in use. Try --port ${port + 1}.`);
});
child.on('error', error => {
  console.error(`Plainhand could not start: ${error.message}`);
  process.exit(1);
});
child.on('exit', code => process.exit(code ?? 1));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { try { child.kill(signal); } catch {} });
}
