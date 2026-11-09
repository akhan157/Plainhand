// Read-only remote view through the user's own Vercel account.
//
// Plainhand stays local: this module builds the existing static dashboard,
// deploys it with the Vercel CLI and verifies that the generated password
// middleware gates the data. It does not proxy the local server, run tasks or
// submit applications, so it cannot replace the interactive app.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticDashboard } from '../dashboard/node/build-dashboard-static.mjs';

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REMOTE_FILE = 'data/plainhand/remote.json';
const DEFAULT_PROJECT = 'plainhand-dashboard';
const VERCEL_PACKAGE = 'vercel@65';
const ANSI = /\x1b\[[0-9;]*m/g;
const URL_RE = /https:\/\/vercel\.com\/[^\s"'<>)]+/;
const DEPLOY_URL_RE = /https?:\/\/[^\s"'<>]+/i;

const defaults = () => ({
  project: DEFAULT_PROJECT,
  url: null,
  password: null,
  secret: null,
  user: null,
  publishedAt: null,
  verifiedAt: null,
  protected: false,
  enabled: false,
  lastError: null,
  lastFingerprint: null,
});

let writeChain = Promise.resolve();
let activePublish = null;
let login = null;

// Strip ANSI but keep newlines: trimming each stream chunk concatenated
// separate CLI lines (a deployment URL could swallow the following label).
function clean(value) {
  return String(value || '').replace(ANSI, '');
}

function runProcess(command, args, { input = null, timeout = 120000, shell = false, onOutput = null } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell, windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: '', error: error.message });
      return;
    }
    let stdout = '', stderr = '', settled = false;
    const finish = extra => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: child.exitCode ?? -1, stdout, stderr, ...extra });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ error: `Timed out after ${Math.round(timeout / 1000)}s.` });
    }, timeout);
    const collect = chunk => {
      const text = clean(chunk);
      stdout += text;
      if (onOutput) onOutput(text, 'stdout');
    };
    const errors = chunk => {
      const text = clean(chunk);
      stderr += text;
      if (onOutput) onOutput(text, 'stderr');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', errors);
    child.on('error', error => finish({ error: error.message }));
    child.on('close', code => finish({ code }));
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function onPath(command) {
  if (process.platform === 'win32') return spawnSync('where', [command], { stdio: 'ignore' }).status === 0;
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

let cliCache = null;
export function resolveVercelCli() {
  if (process.env.VERCEL_CLI) return { command: process.env.VERCEL_CLI, prefix: [], label: process.env.VERCEL_CLI, shell: false };
  if (cliCache) return cliCache;
  const local = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel');
  if (process.platform !== 'win32' && existsSync(local)) cliCache = { command: local, prefix: [], label: 'node_modules/.bin/vercel', shell: false };
  else if (onPath('vercel')) cliCache = { command: 'vercel', prefix: [], label: 'vercel', shell: process.platform === 'win32' };
  else cliCache = { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', prefix: ['--yes', VERCEL_PACKAGE], label: `npx --yes ${VERCEL_PACKAGE}`, shell: process.platform === 'win32' };
  return cliCache;
}

// cmd.exe does not preserve arguments with spaces unless they are quoted. Backslashes
// need doubling only where the Windows argument parser treats them specially: before a
// quote or at the end of a quoted argument. Doubling every backslash would change an
// ordinary path such as "C:\Program Files\Vercel".
export function shellArgs(args, shell) {
  if (!shell) return args.map(String);
  return args.map(arg => {
    const text = String(arg);
    if (!/[\s"]/.test(text)) return text;
    const escaped = text.includes('"') || /\\$/.test(text)
      ? text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      : text;
    return `"${escaped}"`;
  });
}

function vercel(args, options = {}) {
  const cli = resolveVercelCli();
  let scoped = args;
  if (process.env.VERCEL_SCOPE) {
    const separator = args.indexOf('--');
    scoped = separator < 0
      ? [...args, '--scope', process.env.VERCEL_SCOPE]
      : [...args.slice(0, separator), '--scope', process.env.VERCEL_SCOPE, ...args.slice(separator)];
  }
  return runProcess(cli.command, shellArgs([...cli.prefix, ...scoped], cli.shell), { ...options, shell: cli.shell });
}

export function generatePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // randomInt rejects modulo bias instead of folding 256 values onto a 57-letter alphabet.
  return Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function generateSecret() {
  return randomBytes(32).toString('hex');
}

export async function loadRemote(workspace) {
  const raw = await workspace.read(REMOTE_FILE, '');
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw);
    return { ...defaults(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaults();
  }
}

export async function saveRemote(workspace, patch) {
  writeChain = writeChain.catch(() => {}).then(async () => {
    const current = await loadRemote(workspace);
    const next = { ...current, ...patch };
    await workspace.write(REMOTE_FILE, JSON.stringify(next, null, 2) + '\n');
    return next;
  });
  return writeChain;
}

function publicConfig(config) {
  const { secret, ...rest } = config;
  return { ...rest, hasSecret: Boolean(secret) };
}

export function currentLogin() {
  return login ? { id: login.id, status: login.status, url: login.url, message: login.message } : null;
}

export function cancelVercelLogin() {
  if (login?.child && login.status === 'running') login.child.kill('SIGTERM');
}

export async function beginVercelLogin(workspace, { emit = null } = {}) {
  if (login?.status === 'running') return currentLogin();
  const cli = resolveVercelCli();
  const state = { id: randomUUID(), status: 'running', url: null, message: `Waiting for ${cli.label} to start the sign-in.`, child: null };
  login = state;
  const child = spawn(cli.command, shellArgs([...cli.prefix, 'login'], cli.shell), { stdio: ['ignore', 'pipe', 'pipe'], shell: cli.shell, windowsHide: true });
  state.child = child;
  const timer = setTimeout(() => {
    if (state.status !== 'running') return;
    child.kill('SIGTERM');
    state.status = 'failed';
    state.message = `Vercel sign-in timed out. Run \`${cli.label} login\` in your terminal, then check the connection.`;
    emit?.('state', { remoteLogin: currentLogin() });
  }, 5 * 60 * 1000);
  timer.unref?.();
  let stdout = '', stderr = '';
  const handle = text => {
    const found = text.match(URL_RE);
    if (found && found[0] !== state.url) {
      state.url = found[0];
      state.message = 'Open the Vercel sign-in link, approve the CLI, then come back here.';
      emit?.('state', { remoteLogin: currentLogin() });
    }
  };
  child.stdout.on('data', chunk => { const text = clean(chunk); stdout += text; handle(text); });
  child.stderr.on('data', chunk => { const text = clean(chunk); stderr += text; handle(text); });
  child.on('error', error => {
    clearTimeout(timer);
    state.status = 'failed';
    state.message = `${cli.label} could not start: ${error.message}`;
    emit?.('state', { remoteLogin: currentLogin() });
  });
  child.on('close', async code => {
    clearTimeout(timer);
    if (state.status === 'failed') return;
    if (code === 0) {
      const user = await whoami();
      if (user) {
        await saveRemote(workspace, { user });
        state.status = 'complete';
        state.message = `Connected to Vercel${user ? ` as ${user}` : ''}. Publish when you are ready.`;
      } else {
        state.status = 'failed';
        state.message = 'The Vercel sign-in finished, but no account was detected. Run `vercel login` in your terminal and check again.';
      }
    } else {
      state.status = 'failed';
      const detail = (stderr || stdout).split('\n').filter(Boolean).at(-1);
      state.message = `Vercel sign-in did not finish${detail ? `: ${detail}` : ''}. Run \`${cli.label} login\` in your terminal, then check the connection.`;
    }
    emit?.('state', { remoteLogin: currentLogin() });
  });
  return currentLogin();
}

export function parseWhoamiOutput(raw) {
  const text = clean(raw);
  if (/logged out|not logged in|run `?vercel login/i.test(text)) return null;
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line
      && !/^npm notice/i.test(line)
      && !/^run 'vc'/i.test(line)
      && !/claude-code-hint/i.test(line)
      && !/^vercel cli/i.test(line)
      && !/^plainhand@/i.test(line)
      && !/^[>▲]/.test(line));
  const email = lines.join('\n').match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (email && !/^plainhand@/i.test(email[0])) return email[0];
  return lines.at(-1) || null;
}

async function whoami() {
  const result = await vercel(['whoami'], { timeout: 30000 });
  if (result.code !== 0) return null;
  return parseWhoamiOutput(`${result.stdout}\n${result.stderr}`);
}

export async function remoteStatus(workspace, { refresh = false } = {}) {
  const config = await loadRemote(workspace);
  let user = config.user;
  if (refresh) {
    user = await whoami();
    if (user !== config.user) await saveRemote(workspace, { user });
  }
  return { ...publicConfig({ ...config, user }), cli: resolveVercelCli().label, login: currentLogin() };
}

export async function updateRemoteSettings(workspace, { enabled, project } = {}) {
  const patch = {};
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof project === 'string' && project.trim()) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(project.trim())) throw new Error('A Vercel project name uses lowercase letters, numbers and dashes.');
    patch.project = project.trim();
  }
  return publicConfig(await saveRemote(workspace, patch));
}

export async function forgetRemote(workspace) {
  return publicConfig(await saveRemote(workspace, {
    url: null, password: null, secret: null, publishedAt: null, verifiedAt: null, protected: false, enabled: false, lastFingerprint: null, lastError: null,
  }));
}

export async function rotateRemotePassword(workspace) {
  return publicConfig(await saveRemote(workspace, { password: generatePassword(), secret: generateSecret() }));
}

async function fingerprint(workspace) {
  const hash = createHash('sha256');
  for (const file of ['data/applications.md', 'data/pipeline.md', 'data/plainhand/workspace.json', 'config/profile.yml', 'cv.md']) {
    const text = await workspace.read(file, '');
    hash.update(file).update('\0').update(text).update('\0');
  }
  const { readdir, stat } = await import('node:fs/promises');
  for (const directory of ['reports', 'output']) {
    const full = path.join(workspace.root, directory);
    let entries = [];
    try { entries = await readdir(full, { recursive: true, withFileTypes: true }); } catch { continue; }
    const files = entries.filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath || entry.path || full, entry.name)).sort();
    for (const file of files) {
      const relative = path.relative(workspace.root, file).replace(/\\/g, '/');
      const info = await stat(file).catch(() => null);
      hash.update(relative).update('\0').update(String(info?.size || 0)).update('\0').update(String(info?.mtimeMs || 0)).update('\0');
    }
  }
  return hash.digest('hex');
}

function parseDeployUrl(result) {
  for (const text of [result.stdout, result.stderr]) {
    for (const line of clean(text).split('\n').reverse()) {
      if (!/production|deployed|preview/i.test(line)) continue;
      const match = line.match(DEPLOY_URL_RE);
      if (match) return match[0];
    }
  }
  const match = clean(`${result.stdout}\n${result.stderr}`).match(DEPLOY_URL_RE);
  return match ? match[0] : null;
}

async function verifyDeployment(url, password) {
  try {
    return await verifyWithFetch(url, password);
  } catch (error) {
    try {
      return await verifyProtectedDeployment(url, password);
    } catch (protectedError) {
      throw new Error(`${error.message} ${protectedError.message}`);
    }
  }
}

// Projects can have Vercel Authentication enabled, which answers 404/401/403
// before the dashboard middleware runs. The CLI's curl command adds the
// project's protection bypass so the password gate can still be checked.
async function verifyProtectedDeployment(url, password) {
  const directory = await mkdtemp(path.join(tmpdir(), 'plainhand-verify-'));
  const headers = path.join(directory, 'headers.txt');
  const body = path.join(directory, 'body.txt');
  const curl = async (target, args = []) => {
    const result = await vercel(['curl', target, '--', '--silent', '--show-error', '--dump-header', headers, '--output', body, ...args], { timeout: 90000 });
    const [headerText, bodyText] = await Promise.all([
      readFile(headers, 'utf8').catch(() => ''),
      readFile(body, 'utf8').catch(() => ''),
    ]);
    if (result.error || result.code !== 0) throw new Error(`Vercel-authenticated check failed: ${(result.stderr || result.error || '').split('\n').filter(Boolean).at(-1) || `exit ${result.code}`}.`);
    return { headers: headerText, body: bodyText };
  };
  try {
    const root = await curl(url + '/');
    const location = root.headers.match(/^location:\s*(\S+)/im)?.[1] || '';
    if (!/^HTTP\/[\d.]+ 30[1278]/m.test(root.headers) || !location.includes('/login')) {
      throw new Error('Vercel Authentication is enabled, but the deployment did not redirect to the dashboard password page.');
    }
    const login = await curl(url + '/auth/login', [
      '--request', 'POST',
      '--header', 'Content-Type: application/x-www-form-urlencoded',
      '--data-urlencode', `password=${password}`,
      '--data-urlencode', 'next=/',
    ]);
    const cookie = login.headers.match(/^set-cookie:\s*([^;\r\n]+)/im)?.[1];
    if (!/^HTTP\/[\d.]+ 302/m.test(login.headers) || !cookie) {
      throw new Error('Vercel Authentication is enabled, but the dashboard password was rejected.');
    }
    const data = await curl(url + '/dashboard-data.json', ['--header', `Cookie: ${cookie}`]);
    if (!/^HTTP\/[\d.]+ 200/m.test(data.headers)) throw new Error('Vercel Authentication is enabled, but signed-in dashboard data was not readable.');
    const payload = JSON.parse(data.body);
    if (typeof payload?.counts?.all !== 'number') throw new Error('The dashboard data is not in the expected format.');
    return payload;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyWithFetch(url, password) {
  const check = async (target, options = {}) => {
    try {
      return await fetch(target, { ...options, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      throw new Error(`The deployment did not answer at ${target}: ${error.message}`);
    }
  };
  const root = await check(url + '/', { redirect: 'manual' });
  if (root.status === 503) throw new Error('The deployment is up, but its password middleware has no credentials. Vercel did not apply the deployment environment variables.');
  if (root.status === 401 || root.status === 403) {
    throw new Error(`The deployment is protected by Vercel (HTTP ${root.status}) before it reaches the dashboard password. Sign in to Vercel in that browser, or change the project's Deployment Protection setting.`);
  }
  const location = root.headers.get('location') || '';
  if (![301, 302, 307, 308].includes(root.status) || !location.includes('/login')) {
    throw new Error(`The deployment did not redirect to the password page (HTTP ${root.status}). Check that middleware.js is part of the deployment.`);
  }
  const loginResponse = await check(url + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password, next: '/' }),
    redirect: 'manual',
  });
  const cookie = (loginResponse.headers.get('set-cookie') || '').split(';')[0];
  if (loginResponse.status !== 302 || !cookie.includes('=')) throw new Error(`The generated password was rejected by the deployment (HTTP ${loginResponse.status}).`);
  const data = await check(url + '/dashboard-data.json', { headers: { cookie }, redirect: 'manual' });
  if (data.status !== 200) throw new Error(`Signed-in dashboard data returned HTTP ${data.status}.`);
  const payload = await data.json();
  if (typeof payload?.counts?.all !== 'number') throw new Error('The dashboard data is not in the expected format.');
  return payload;
}

async function publish(workspace, { reason = 'manual publish', log = console.log } = {}) {
  const cli = resolveVercelCli();
  const who = await whoami();
  if (!who) throw new Error(`Connect your Vercel account first: run \`${cli.label} login\`, then check the connection.`);
  let config = await loadRemote(workspace);
  const password = config.password || generatePassword();
  const secret = config.secret || generateSecret();
  const project = process.env.VERCEL_PROJECT || config.project || DEFAULT_PROJECT;
  config = await saveRemote(workspace, { password, secret, project, user: who, lastError: null });

  log(`Building the dashboard for ${workspace.root}…`);
  const { payload } = await buildStaticDashboard({
    rootPath: workspace.root,
    codeRoot: APP_ROOT,
    outDir: path.join(workspace.root, 'dashboard-static'),
    log: () => {},
  });

  log(`Deploying to Vercel project ${project} (${reason})…`);
  const result = await vercel([
    'deploy', path.join(workspace.root, 'dashboard-static'),
    '--prod', '--yes', '--create-if-missing', '--project', project,
    '--env', `DASHBOARD_PASSWORD=${password}`,
    '--env', `DASHBOARD_SECRET=${secret}`,
  ], { timeout: 10 * 60 * 1000, onOutput: line => { if (/https:\/\/|error|Error/.test(line)) log(line); } });
  if (result.error || result.code !== 0) {
    const detail = clean(result.stderr || result.stdout).split('\n').filter(Boolean).slice(-4).join(' ');
    const message = `Vercel deploy failed${detail ? `: ${detail}` : ` (exit ${result.code})`}.`;
    await saveRemote(workspace, { lastError: message });
    throw new Error(message);
  }
  const url = parseDeployUrl(result);
  if (!url) {
    const message = 'Vercel reported success but no deployment URL was found. Check the Vercel dashboard.';
    await saveRemote(workspace, { lastError: message });
    throw new Error(message);
  }
  const verified = await verifyDeployment(url, password);
  const protectedDeployment = /vercel_authentication/i.test(`${result.stdout}\n${result.stderr}`);
  const currentFingerprint = await fingerprint(workspace);
  const saved = await saveRemote(workspace, {
    url, password, secret, project, user: who,
    publishedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    protected: protectedDeployment,
    lastFingerprint: currentFingerprint,
    lastError: null,
  });
  log(`Published ${url} (${verified.counts.all} applications).`);
  return { ...publicConfig(saved), apps: verified.counts.all };
}

export async function publishDashboard(workspace, options = {}) {
  if (activePublish) throw new Error('A publish is already running.');
  activePublish = publish(workspace, options)
    .catch(async error => {
      await saveRemote(workspace, { lastError: error.message }).catch(() => {});
      throw error;
    })
    .finally(() => { activePublish = null; });
  return activePublish;
}

export async function startAutoPublish({ workspace, emit = null, intervalMs = 15 * 60 * 1000, log = console.log } = {}) {
  const config = await loadRemote(workspace);
  if (!config.enabled || !config.url) return null;
  let stopped = false, running = false, timer = null, first = null;
  const tick = async () => {
    if (stopped || running) return;
    const current = await loadRemote(workspace);
    if (!current.enabled || !current.url) return;
    const currentFingerprint = await fingerprint(workspace);
    if (currentFingerprint === current.lastFingerprint) return;
    running = true;
    try {
      await publishDashboard(workspace, { reason: 'automatic publish', log });
      emit?.('state', { remote: 'published' });
    } catch (error) {
      await saveRemote(workspace, { lastError: error.message });
      emit?.('state', { remote: 'error' });
      log(`Remote publish failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  first = setTimeout(tick, 30_000);
  first.unref?.();
  return () => { stopped = true; clearInterval(timer); clearTimeout(first); };
}
