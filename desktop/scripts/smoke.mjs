import { spawn } from 'node:child_process';
import { mkdtemp, readFile, access, rm, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep UNIX socket paths short, and avoid the host's nearly-full tmpfs.
await mkdir(path.join(homedir(), '.cache'), { recursive: true });
const userData = await mkdtemp(path.join(homedir(), '.cache', 'ph-smoke-'));
await mkdir(path.join(userData, 'temp'));
const executable = process.env.PLAINHAND_SMOKE_BINARY || path.join(desktop, 'node_modules/electron/dist/electron');
// Chromium cache can be reused across smoke runs; user/workspace always disposable.
if (process.env.PLAINHAND_SMOKE_BROWSERS) {
  const { symlink } = await import('node:fs/promises');
  await symlink(path.resolve(process.env.PLAINHAND_SMOKE_BROWSERS), path.join(userData, 'browsers'), 'dir');
}
const args = process.env.PLAINHAND_SMOKE_BINARY ? ['--desktop-smoke', '--ozone-platform=x11'] : [desktop, '--desktop-smoke', '--ozone-platform=x11'];
const env = { ...process.env, PLAINHAND_DESKTOP_TEST_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WAYLAND_DISPLAY;
env.TMPDIR = path.join(userData, 'temp'); env.TEMP = env.TMPDIR; env.TMP = env.TMPDIR;
// Packaged builds deliberately ignore the development-only test data override.
// XDG dirs isolate their workspace too.
env.XDG_CONFIG_HOME = path.join(userData, 'config'); env.XDG_CACHE_HOME = path.join(userData, 'cache');
const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '', ready = false;
child.stdout.on('data', chunk => {
  output = (output + chunk).slice(-16384);
  if (!ready && output.includes('DESKTOP_SMOKE_READY')) { ready = true; console.log('DESKTOP_SMOKE_READY'); }
});
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8000); });
const timer = setTimeout(() => child.kill('SIGKILL'), 12 * 60 * 1000);
try {
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  if (code !== 0 || !ready) throw new Error(`Electron smoke failed (${code}): ${errors}`);
  const workspace = process.env.PLAINHAND_SMOKE_BINARY ? path.join(env.XDG_CONFIG_HOME, 'Plainhand', 'workspace') : path.join(userData, 'workspace');
  // App name is from package metadata (plainhand-desktop unless productName is used).
  let actualWorkspace = workspace;
  if (process.env.PLAINHAND_SMOKE_BINARY) {
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(env.XDG_CONFIG_HOME);
    actualWorkspace = path.join(env.XDG_CONFIG_HOME, names.find(name => /plainhand/i.test(name)), 'workspace');
  }
  await readFile(path.join(actualWorkspace, 'data/plainhand/workspace.json'));
  let handoff = false;
  try { await access(path.join(actualWorkspace, 'data/plainhand/local-api.json')); handoff = true; } catch {}
  if (handoff) throw new Error('Local service did not clean up its handoff on exit');
  console.log('DESKTOP_SMOKE_CLEAN_EXIT');
} finally { clearTimeout(timer); await rm(userData, { recursive: true, force: true }); }
