#!/usr/bin/env node
// One-command setup for the Plainhand app: `npm run setup` (or `npm run setup -- --check`
// to only report). Installs what is required, reports what is optional, never touches
// personal data, and ends with the next step.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIN_NODE = 22;

const tty = process.stdout.isTTY;
const paint = code => text => tty ? `\x1b[${code}m${text}\x1b[0m` : text;
const ok = paint('32'), warn = paint('33'), bad = paint('31'), dim = paint('2');

export function onPath(command, { platform = process.platform, run = spawnSync } = {}) {
  const probe = platform === 'win32' ? run('where', [command], { encoding: 'utf8' }) : run('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0 && Boolean(String(probe.stdout || '').trim());
}

// Each check returns { level: 'ok' | 'warn' | 'fail', label, fix? }. fail = Plainhand cannot start.
export async function runChecks({ root = ROOT, nodeVersion = process.versions.node, has = onPath, chromium = null } = {}) {
  const results = [];
  const major = Number(String(nodeVersion).split('.')[0]);
  results.push(major >= MIN_NODE
    ? { level: 'ok', label: `Node.js ${nodeVersion}` }
    : { level: 'fail', label: `Node.js ${nodeVersion} is too old`, fix: `Install Node.js ${MIN_NODE} or newer from https://nodejs.org, then run npm run setup again.` });
  const deps = existsSync(path.join(root, 'node_modules', 'playwright')) && existsSync(path.join(root, 'node_modules', 'js-yaml'));
  results.push(deps ? { level: 'ok', label: 'Dependencies installed' } : { level: 'fail', label: 'Dependencies missing', fix: 'npm ci' });
  let browser = false;
  if (deps) {
    try {
      const engine = chromium || (await import('playwright')).chromium;
      browser = existsSync(engine.executablePath());
    } catch { browser = false; }
  }
  results.push(browser ? { level: 'ok', label: 'Chromium for PDFs and form assistance' } : { level: 'fail', label: 'Chromium not installed', fix: 'npx playwright install chromium' });
  results.push(has('pdftotext') ? { level: 'ok', label: 'PDF resume import (pdftotext)' }
    : { level: 'warn', label: 'PDF resume import unavailable; pasting resume text still works', fix: process.platform === 'darwin' ? 'brew install poppler' : process.platform === 'win32' ? 'Install Poppler for Windows and add it to PATH' : 'sudo apt install poppler-utils' });
  const agents = [['claude', 'Claude'], ['codex', 'ChatGPT (Codex)'], ['agy', 'Google Antigravity']].filter(([command]) => has(command)).map(([, name]) => name);
  results.push(agents.length ? { level: 'ok', label: `AI account CLI found: ${agents.join(', ')}` }
    : { level: 'warn', label: 'No AI account CLI found yet', fix: 'Install one: npm install -g @anthropic-ai/claude-code (Claude) or npm install -g @openai/codex (ChatGPT). Sign in from Plainhand → Connections.' });
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) results.push({ level: 'warn', label: 'No graphical desktop detected', fix: 'Evaluation, packets and PDFs work; form assistance needs a visible browser on a desktop session.' });
  return results;
}

function install(steps) {
  for (const [label, command, args] of steps) {
    console.log(dim(`→ ${label}: ${command} ${args.join(' ')}`));
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) { console.log(bad(`✗ ${label} failed. Fix the error above, then run npm run setup again.`)); return false; }
  }
  return true;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  console.log('\nPlainhand setup\n');
  let results = await runChecks();
  const missing = results.filter(r => r.level === 'fail');
  if (!checkOnly && missing.length && !missing.some(r => r.label.startsWith('Node.js'))) {
    const steps = [];
    if (missing.some(r => r.label === 'Dependencies missing')) steps.push(['Install dependencies', 'npm', ['ci', '--no-audit', '--no-fund']]);
    steps.push(['Install Chromium', 'npx', ['playwright', 'install', 'chromium']]);
    if (install(steps)) results = await runChecks();
  }
  for (const r of results) {
    const mark = r.level === 'ok' ? ok('✓') : r.level === 'warn' ? warn('!') : bad('✗');
    console.log(`${mark} ${r.label}${r.fix ? dim(`\n    ${r.fix}`) : ''}`);
  }
  const failed = results.filter(r => r.level === 'fail');
  if (failed.length) {
    console.log(bad(`\n${failed.length} required item${failed.length === 1 ? '' : 's'} missing.`) + (checkOnly ? ' Run npm run setup to install them.' : ''));
    process.exitCode = 1;
    return;
  }
  console.log(ok('\nReady.') + ' Start Plainhand with ' + ok('npm start') + ' and open http://127.0.0.1:3210');
  console.log(dim('Your data stays in this folder (config/, cv.md, data/). To keep it elsewhere: npm start -- --data-root /path/to/workspace'));
  console.log(dim('Moving from another computer? Import your exported workspace in Plainhand → Workspace.\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
