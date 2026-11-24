#!/usr/bin/env node
// plainhand update / rollback — move a candidate's install to another release without
// touching what they wrote.
//
// Two install kinds, because Plainhand has two documented installs:
// - checkout: a git clone with the workspace inside it (data/, config/, cv.md are
//   gitignored). The update fetches a release tag, checks it out, runs `npm ci` when the
//   lockfile changed, migrates the workspace state and asks for a restart.
// - installer: ~/.plainhand/app (code) with ~/.plainhand/workspace (data). The update
//   re-runs the same installer the candidate used, which replaces only the code folder,
//   then migrates the separate workspace.
//
// Neither path copies user files, asks for setup again, or touches the provider CLI
// sign-ins in ~/.codex and ~/.claude: Plainhand only runs those programs.
//
// Every update writes data/plainhand/backups/update-<stamp>/UPDATE.json so `rollback`
// knows which code to return to; the workspace state itself is restored from the
// migration backup described in plainhand/migrations.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_REMOTE = 'https://github.com/akhan157/Plainhand.git';
const GITHUB_LATEST = 'https://api.github.com/repos/akhan157/Plainhand/releases/latest';
const UPDATE_ROOT = 'data/plainhand/backups';
const GIT_TIMEOUT = 120000;

// ── arguments ───────────────────────────────────────────────────

const argv = process.argv.slice(2);
const command = ['check', 'apply', 'rollback', 'migrate', 'status'].includes(argv[0]) ? argv[0] : 'check';
const rest = command === argv[0] ? argv.slice(1) : argv;
const flags = { _: [] };
for (let index = 0; index < rest.length; index++) {
  const item = rest[index];
  if (!item.startsWith('--')) { flags._.push(item); continue; }
  const [name, inline] = item.slice(2).split('=');
  if (inline !== undefined) flags[name] = inline;
  else if (rest[index + 1] && !rest[index + 1].startsWith('--')) flags[name] = rest[++index];
  else flags[name] = true;
}
const heading = text => `\n${text}\n${'─'.repeat(Math.min(60, text.length))}`;
const say = message => console.log(message);

// ── install shape ───────────────────────────────────────────────

const checkout = () => existsSync(path.join(APP_ROOT, '.git'));
const dataRoot = flags['data-root'] ? path.resolve(flags['data-root']) : checkout() ? APP_ROOT : path.join(os.homedir(), '.plainhand', 'workspace');
const readVersion = (root = APP_ROOT) => {
  try { return readFileSync(path.join(root, 'VERSION'), 'utf8').trim().split(/\s+/)[0] || null; }
  catch { return null; }
};
export function compareVersions(a, b) {
  const parse = value => String(value || '').replace(/^v/, '').split(/[.+-]/).map(number => Number(number) || 0);
  const left = parse(a), right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
  }
  return 0;
}

function git(args, { allowFailure = false, cwd = APP_ROOT } = {}) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT }).trim(); }
  catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(error.stderr || error.stdout || error.message).trim()}`);
  }
}

const resolveRemote = () => flags.remote || git(['remote', 'get-url', 'origin'], { allowFailure: true }) || DEFAULT_REMOTE;

function remoteTags(remote) {
  const output = git(['ls-remote', '--tags', '--refs', remote, 'v*'], { allowFailure: true });
  if (output === null) return null;
  return output.split('\n').map(line => line.split('\t')[1]).filter(Boolean)
    .map(ref => ref.replace(/^refs\/tags\//, '')).filter(tag => /^v\d/.test(tag))
    .sort((left, right) => compareVersions(right, left));
}
const localTags = () => git(['tag', '--list', 'v*'], { allowFailure: true })?.split('\n').filter(tag => /^v\d/.test(tag)).sort((left, right) => compareVersions(right, left)) || [];

// A release is a tag. Without one, the newest tag on the remote is the release.
function newestRelease() {
  const tags = remoteTags(resolveRemote());
  if (tags?.length) return tags[0];
  if (tags === null) {
    const local = localTags();
    if (local.length) return local[0];
    throw new Error(`Could not reach ${resolveRemote()}. Pass --version vX.Y.Z, or connect and try again.`);
  }
  throw new Error('No release tag (vX.Y.Z) was found. Pass --version vX.Y.Z, or set --version main for the development version.');
}

// ── workspace state ─────────────────────────────────────────────

async function workspaceFor(root = dataRoot) {
  const { Workspace } = await import(pathToFileURL(path.join(APP_ROOT, 'plainhand', 'store.mjs')).href);
  return new Workspace(root);
}
// The migrations module is imported from the files on disk with a cache-busting query:
// after a checkout or an installer swap, the running process holds the previous code.
async function migrations(entry) {
  return import(pathToFileURL(path.join(entry, 'plainhand', 'migrations.mjs')).href + `?update=${Date.now()}`);
}

// Runs in a child process: after a checkout or an installer swap the files on disk are the
// new release, and the child loads them instead of the code this process started with.
function runMigrate(entry = APP_ROOT) {
  const result = spawnSync(process.execPath, [path.join(entry, 'lib', 'plainhand-update.mjs'), 'migrate', '--data-root', dataRoot, '--json'], { cwd: entry, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`${String(result.stderr || '').trim()}\nThe workspace migration did not finish. The previous state is backed up in data/plainhand/backups; running Plainhand will retry, and plainhand rollback restores it.`);
  const line = String(result.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed;
  try { parsed = JSON.parse(line); } catch { parsed = { status: 'unreadable' }; }
  if (!flags.json) {
    if (parsed.status === 'migrated') say(`→ workspace state ${parsed.from} → ${parsed.to} (backup ${parsed.backup})`);
    else if (parsed.status === 'current') say('→ workspace state already current');
    else say('→ no workspace yet');
  }
  return parsed;
}

function updateDirectories() {
  const root = path.join(dataRoot, UPDATE_ROOT);
  try { return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('update-')).map(entry => entry.name).sort().reverse(); }
  catch { return []; }
}
function latestUpdate() {
  for (const name of updateDirectories()) {
    try { return { ...JSON.parse(readFileSync(path.join(dataRoot, UPDATE_ROOT, name, 'UPDATE.json'), 'utf8')), directory: path.join(dataRoot, UPDATE_ROOT, name) }; }
    catch { /* keep looking */ }
  }
  return null;
}
function recordUpdate(record) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(dataRoot, UPDATE_ROOT, `update-${stamp}`);
  mkdirSync(directory, { recursive: true });
  writeRecord(directory, record);
  return directory;
}
function writeRecord(directory, record) {
  writeFileSync(path.join(directory, 'UPDATE.json'), JSON.stringify(record, null, 2) + '\n');
}

// ── npm ─────────────────────────────────────────────────────────

function installDependencies({ offline = false } = {}) {
  const args = ['ci', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : [])];
  say(`→ npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, { cwd: APP_ROOT, stdio: 'inherit', env: process.env, timeout: 900000 });
  if (result.status !== 0) throw new Error(`npm ci failed${offline ? ' (offline: the npm cache may not have this release)' : ''}. The app was not switched; fix the install and run the update again.`);
}

function lockfileChanged(fromRef, toRef) {
  if (!fromRef || !toRef) return true;
  const changed = git(['diff', '--name-only', fromRef, toRef, '--', 'package-lock.json'], { allowFailure: true });
  return changed === null || changed !== '';
}

// ── check ───────────────────────────────────────────────────────

function check() {
  const version = readVersion();
  const release = checkout() ? newestRelease() : latestInstallerRelease();
  const newer = release && compareVersions(release, version) > 0;
  if (flags.json) { say(JSON.stringify({ kind: checkout() ? 'checkout' : 'installer', version, latest: release, updateAvailable: Boolean(newer) })); return; }
  say(`Plainhand ${version || 'unknown'} (${checkout() ? 'git checkout' : 'installed'} at ${APP_ROOT}).`);
  if (!release) say('No release tag found; check your connection.');
  else if (newer) say(`Version ${release} is available. Update with: plainhand update`);
  else say('This is the newest release.');
}

// Installer copies have no git history, so the newest release comes from GitHub.
function latestInstallerRelease() {
  const result = spawnSync('curl', ['-fsSL', '-m', '15', GITHUB_LATEST], { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout).tag_name || null; } catch { return null; }
}

// ── apply: git checkout ─────────────────────────────────────────

async function applyCheckout() {
  const steps = [];
  const step = (label, run) => { const at = Date.now(); const value = run(); steps.push({ step: label, ms: Date.now() - at }); return value; };

  const dirty = step('check for local changes', () => git(['status', '--porcelain', '--untracked-files=no']));
  if (dirty && !flags.force) throw new Error(`This checkout has changes to versioned files:\n${dirty}\nCommit or stash them (or pass --force), then run the update again.`);
  const previousRef = step('read current version', () => git(['rev-parse', 'HEAD']));
  const previousVersion = readVersion();
  const remote = resolveRemote();
  const requested = typeof flags.version === 'string' ? flags.version : newestRelease();

  if (!git(['rev-parse', '--verify', '--quiet', `${requested}^{commit}`], { allowFailure: true })) {
    if (flags.offline) throw new Error(`${requested} is not in this checkout and --offline was given.`);
    step('fetch releases', () => git(['fetch', '--tags', '--force', remote]));
  }
  const targetRef = step('resolve release', () => git(['rev-parse', `${requested}^{commit}`]));
  const targetVersion = (git(['show', `${targetRef}:VERSION`], { allowFailure: true }) || '').trim().split(/\s+/)[0] || requested;

  // Never move a checkout backwards by accident: without --version the newest tag can be
  // behind a development checkout, and a release older than this updater cannot finish
  // the update (it has no lib/plainhand-update.mjs to migrate with).
  const behind = targetRef !== previousRef && git(['merge-base', '--is-ancestor', targetRef, previousRef], { allowFailure: true }) !== null;
  if (behind && typeof flags.version !== 'string') {
    say(`This checkout (${previousVersion}, ${previousRef.slice(0, 7)}) is already newer than the latest release ${requested}. Nothing to update.`);
    return { status: 'current', install: 'checkout', previousRef, previousVersion, ref: previousRef, version: previousVersion, record: null, steps };
  }
  if (targetRef !== previousRef && git(['cat-file', '-e', `${targetRef}:lib/plainhand-update.mjs`], { allowFailure: true }) === null && !flags.force) {
    throw new Error(`${requested} predates the Plainhand updater, so it cannot be installed with plainhand update. Nothing was changed. Pass --force to switch anyway, or run git checkout ${requested} yourself.`);
  }

  if (targetRef === previousRef) {
    say(`Already at ${requested} (${targetVersion}). Checking the workspace.`);
  } else {
    step('switch code', () => git(['checkout', '--quiet', '--detach', targetRef]));
    const needsInstall = lockfileChanged(previousRef, targetRef) || !existsSync(path.join(APP_ROOT, 'node_modules', 'playwright'));
    if (needsInstall && !flags['no-install']) {
      const at = Date.now();
      try { installDependencies({ offline: Boolean(flags.offline) }); }
      catch (error) {
        git(['checkout', '--quiet', '--detach', previousRef], { allowFailure: true });
        throw new Error(`${error.message}\nThe code was switched back to ${previousVersion}. Your workspace files were not touched.`);
      }
      steps.push({ step: 'install dependencies', ms: Date.now() - at });
    }
  }

  // The record is written before the migration so a failed migration still leaves
  // rollback something to return to.
  const record = { kind: 'update', install: 'checkout', at: new Date().toISOString(), previousRef, previousVersion, ref: targetRef, version: targetVersion, migration: null, steps, status: 'migrating' };
  const directory = recordUpdate(record);
  let outcome = null;
  if (flags['no-migrate']) steps.push({ step: 'migrate workspace state', ms: 0, skipped: true });
  else {
    const at = Date.now();
    try { outcome = runMigrate(APP_ROOT); }
    catch (error) { writeRecord(directory, { ...record, status: 'migration failed', error: error.message }); throw error; }
    steps.push({ step: 'migrate workspace state', ms: Date.now() - at });
  }

  const migration = outcome?.status === 'migrated' ? { at: new Date().toISOString(), from: outcome.from, to: outcome.to, backup: outcome.backup } : null;
  writeRecord(directory, { ...record, migration, steps, status: 'complete' });
  return { status: targetRef === previousRef ? 'current' : 'updated', install: 'checkout', previousRef, previousVersion, ref: targetRef, version: targetVersion, record: path.relative(dataRoot, directory), steps };
}

// ── apply: installer app ────────────────────────────────────────

async function applyInstaller() {
  const steps = [];
  const step = (label, run) => { const at = Date.now(); const value = run(); steps.push({ step: label, ms: Date.now() - at }); return value; };
  const previousVersion = readVersion();
  const requested = typeof flags.version === 'string' ? flags.version : 'latest';
  // install.sh expects latest, main or a vX.Y.Z tag.
  const version = requested !== 'latest' && requested !== 'main' && !/^v\d/.test(requested) ? `v${requested}` : requested;
  if (flags.offline) throw new Error('Installing a release needs the network; the installer downloads the release and its dependencies.');
  const environment = { ...process.env, PLAINHAND_VERSION: version };
  const run = step('download and install code', () => {
    const result = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'install.ps1'), '--no-start'], { cwd: APP_ROOT, stdio: 'inherit', env: environment })
      : spawnSync('sh', [path.join(APP_ROOT, 'install.sh'), '--no-start'], { cwd: APP_ROOT, stdio: 'inherit', env: environment });
    if (result.status !== 0) throw new Error('The installer did not finish. Your workspace was not touched.');
    return result.status;
  });
  const currentVersion = readVersion();
  const at = Date.now();
  const outcome = runMigrate(APP_ROOT);
  steps.push({ step: 'migrate workspace state', ms: Date.now() - at });
  const migration = outcome?.status === 'migrated' ? { at: new Date().toISOString(), from: outcome.from, to: outcome.to, backup: outcome.backup } : null;
  const directory = recordUpdate({ kind: 'update', install: 'installer', at: new Date().toISOString(), previousVersion, version: currentVersion, requested: version, migration, steps });
  return { status: compareVersions(currentVersion, previousVersion) > 0 ? 'updated' : 'current', install: 'installer', previousVersion, version: currentVersion, record: path.relative(dataRoot, directory), steps };
}

// ── apply ───────────────────────────────────────────────────────

async function apply() {
  const started = Date.now();
  const result = checkout() ? await applyCheckout() : await applyInstaller();
  result.totalMs = Date.now() - started;
  if (flags.json) { say(JSON.stringify(result)); return result; }
  say(heading(result.status === 'updated' ? `Plainhand ${result.version} installed` : `Plainhand ${result.version} is already installed`));
  for (const item of result.steps) say(`  ${item.skipped ? 'skipped' : `${String(item.ms).padStart(6)} ms`}  ${item.step}`);
  if (!result.record) return result;
  say(`\nYour profile, stories, applications, settings and connections are in ${dataRoot}; this update did not rewrite them.`);
  say(`Update record: ${result.record}`);
  say(`\nRestart Plainhand to finish: press Ctrl+C in its terminal, then start it again with: plainhand`);
  return result;
}

// ── rollback ────────────────────────────────────────────────────

async function rollback() {
  const record = latestUpdate();
  const requested = typeof flags.version === 'string' ? flags.version : null;
  const steps = [];
  const step = async (label, run) => { const at = Date.now(); const value = await run(); steps.push({ step: label, ms: Date.now() - at }); return value; };

  // Which code we return to, and which workspace state that release understands.
  let targetRef = null, targetVersion = null;
  if (checkout()) {
    targetRef = requested || record?.previousRef || null;
    if (!targetRef) throw new Error('No update record names the previous version. Pass --version vX.Y.Z to choose the release to return to.');
    if (!git(['rev-parse', '--verify', '--quiet', `${targetRef}^{commit}`], { allowFailure: true })) {
      if (flags.offline) throw new Error(`${targetRef} is not in this checkout and --offline was given.`);
      await step('fetch the previous release', async () => git(['fetch', '--tags', '--force', resolveRemote()]));
    }
    targetRef = git(['rev-parse', `${targetRef}^{commit}`]);
    targetVersion = (git(['show', `${targetRef}:VERSION`], { allowFailure: true }) || '').trim().split(/\s+/)[0] || null;
  } else {
    targetVersion = record?.previousVersion || (requested ? String(requested).replace(/^v/, '') : null);
    if (!targetVersion) throw new Error('This install has no previous version recorded. Pass --version vX.Y.Z to choose the release to return to.');
  }

  // The state is restored first, while the current code can still read it, so the previous
  // release starts against the state it wrote. Only the state that release understands.
  const migrationsModule = await migrations(APP_ROOT);
  const status = await migrationsModule.migrationStatus(await workspaceFor());
  const wanted = flags.to ? Number(flags.to) : targetVersion ? migrationsModule.stateVersionForRelease(targetVersion) : null;
  const restored = status.version !== null && wanted !== null && status.version > wanted
    ? await step('restore workspace state', async () => migrationsModule.rollbackWorkspace(await workspaceFor(), { to: wanted }))
    : { restoredTo: null, skipped: wanted === null ? `no recorded state version for ${targetVersion}; pass --to to choose one` : `workspace state ${status.version ?? 'not migrated'} is already what ${targetVersion} understands` };

  if (checkout()) {
    const currentRef = git(['rev-parse', 'HEAD']);
    await step('switch code back', async () => git(['checkout', '--quiet', '--detach', targetRef]));
    if (lockfileChanged(targetRef, currentRef) && !flags['no-install']) {
      const at = Date.now();
      installDependencies({ offline: Boolean(flags.offline) });
      steps.push({ step: 'install dependencies', ms: Date.now() - at });
    }
  } else {
    say(`\nRestoring the previous app: PLAINHAND_VERSION=v${targetVersion} (the installer replaces the code folder and keeps the workspace).`);
    const at = Date.now();
    const result = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'install.ps1'), '--no-start'], { cwd: APP_ROOT, stdio: 'inherit', env: { ...process.env, PLAINHAND_VERSION: `v${targetVersion}` } })
      : spawnSync('sh', [path.join(APP_ROOT, 'install.sh'), '--no-start'], { cwd: APP_ROOT, stdio: 'inherit', env: { ...process.env, PLAINHAND_VERSION: `v${targetVersion}` } });
    if (result.status !== 0) throw new Error(`The previous version could not be installed. Run the installer with PLAINHAND_VERSION=v${targetVersion} when you are online; the workspace state is already restored.`);
    steps.push({ step: 'install previous version', ms: Date.now() - at });
  }

  const result = { status: 'rolled back', restoredState: restored?.restoredTo ?? null, version: readVersion(), steps, totalMs: steps.reduce((sum, item) => sum + item.ms, 0) };
  if (flags.json) { say(JSON.stringify(result)); return result; }
  say(heading(`Rolled back to Plainhand ${result.version}`));
  if (restored?.restoredTo === null || restored?.restoredTo === undefined) say(`  workspace state  ${restored?.skipped || 'unchanged'}`);
  else {
    say(`  workspace state  restored to version ${restored.restoredTo}`);
    for (const item of restored.backups || []) say(`  from ${item.backup}`);
  }
  for (const item of steps) say(`  ${String(item.ms).padStart(6)} ms  ${item.step}`);
  say(`\nRestart Plainhand: press Ctrl+C in its terminal, then start it again with: plainhand`);
  return result;
}

// ── migrate / status ────────────────────────────────────────────

async function migrate() {
  const { migrateWorkspace, migrationStatus } = await migrations(APP_ROOT);
  const workspace = await workspaceFor();
  const result = await migrateWorkspace(workspace);
  if (flags.json) { say(JSON.stringify(result)); return result; }
  if (result.status === 'empty') say('No workspace yet; nothing to migrate.');
  else if (result.status === 'current') say(`Workspace state is version ${result.version}; nothing to migrate.`);
  else {
    say(`Workspace state migrated ${result.from} → ${result.to}: ${result.steps.map(item => item.name).join(', ')}`);
    say(`Backup of the previous state: ${result.backup}`);
  }
  return result;
}

async function status() {
  const { migrationStatus, STATE_VERSION } = await migrations(APP_ROOT);
  const state = await migrationStatus(await workspaceFor());
  const record = latestUpdate();
  const summary = {
    app: { root: APP_ROOT, kind: checkout() ? 'checkout' : 'installer', version: readVersion() },
    workspace: dataRoot,
    state: { version: state.version, current: STATE_VERSION, pending: state.pending.map(item => `${item.from} → ${item.to} ${item.name}`), corrupt: state.corrupt },
    lastUpdate: record ? { at: record.at, version: record.version, previousVersion: record.previousVersion || null } : null,
  };
  if (flags.json) { say(JSON.stringify(summary)); return summary; }
  say(`Plainhand ${summary.app.version || 'unknown'} (${summary.app.kind}) at ${APP_ROOT}`);
  say(`Workspace ${dataRoot}`);
  say(`State version ${state.version ?? 'none'}${state.corrupt ? ' (unreadable)' : ''}${state.pending.length ? `; ${state.pending.length} migration(s) run on next start` : ''}`);
  if (record) say(`Last update ${record.at}: ${record.previousVersion || '?'} → ${record.version}`);
  return summary;
}

// ── main ────────────────────────────────────────────────────────

try {
  if (command === 'check') check();
  else if (command === 'apply') await apply();
  else if (command === 'rollback') await rollback();
  else if (command === 'migrate') await migrate();
  else await status();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
