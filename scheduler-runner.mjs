#!/usr/bin/env node
/** Deterministic, local-only scheduler entrypoint. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  createLocalJsonlAdapter,
  deliveryPaths,
  loadDeliveryState,
  saveDeliveryState,
} from './notification-delivery.mjs';
import {
  createScheduleState,
  loadScheduleState,
  saveScheduleState,
  scheduleNotificationRun,
} from './notification-scheduler.mjs';
import { atomicWriteJson } from './scan-state.mjs';

const iso = (value) => {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf())) throw new TypeError('invalid date');
  return date.toISOString();
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export function schedulerPaths(options = {}) {
  if (!isAbsolute(options.rootPath || '')) throw new TypeError('explicit absolute rootPath required');
  const rootPath = resolve(options.rootPath);
  const paths = deliveryPaths({ ...options, rootPath });
  const schedulePath = assertInside(rootPath, options.schedulePath ?? join(rootPath, 'notification-schedule-state.json'), 'schedulePath');
  return { ...paths, schedulePath, scanStatePath: assertInside(rootPath, options.scanStatePath ?? join(rootPath, 'notification-scheduler-scan-state.json'), 'scanStatePath') };
}

function assertInside(rootPath, path, label) {
  const resolved = resolve(path);
  const rel = relative(rootPath, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new TypeError(`${label} must be under rootPath`);
  return resolved;
}

function fixtureInput(options, paths) {
  let fixture = options.fixture;
  if (typeof fixture === 'string') fixture = readJson(fixture);
  fixture ??= {};
  const scanState = options.scanState ?? fixture.scanState;
  const roles = options.roles ?? fixture.roles ?? [];
  if (!scanState || typeof scanState !== 'object') throw new TypeError('scanState JSON fixture is required');
  if (!Array.isArray(roles)) throw new TypeError('roles JSON fixture must be an array');
  return { scanState, roles };
}

/** Run one deterministic scheduler cycle; never invokes scans, providers, or external channels. */
export async function runScheduler(options = {}) {
  const paths = schedulerPaths(options);
  paths.scanStatePath = assertInside(paths.rootPath, paths.scanStatePath, 'scanStatePath');
  const now = iso(options.now);
  const fixture = fixtureInput(options, paths);
  const scheduleState = options.scheduleState ?? loadScheduleState({ ...options, rootPath: paths.rootPath });
  const deliveryState = options.deliveryState ?? loadDeliveryState(paths);
  const scanState = { ...fixture.scanState, ...(options.paused === true ? { paused: true } : {}) };
  const channels = options.channels ?? ((options.channel === 'local-jsonl' || options.outboxPath) ? [createLocalJsonlAdapter({ ...paths, outboxPath: options.outboxPath ?? paths.outboxPath })] : []);
  const result = await scheduleNotificationRun({
    ...options,
    rootPath: paths.rootPath,
    scanState,
    roles: fixture.roles,
    scheduleState,
    lastRunAt: options.lastRunAt ?? scheduleState.lastRunAt,
    deliveryState,
    channels,
    now,
    force: options.force === true && options.paused !== true && scanState.paused !== true,
  });
  if (result.due) {
    saveScheduleState(createScheduleState({ lastRunAt: result.lastRunAt, now }), { ...options, rootPath: paths.rootPath });
    saveDeliveryState(result.delivery.state, paths);
    atomicWriteJson(paths.scanStatePath, result.scan.state);
  } else {
    // Keep delivery state durable even when a paused/not-due cycle does no work.
    saveDeliveryState(deliveryState, paths);
  }
  return { ...result, paths: { schedule: paths.schedulePath, delivery: paths.statePath, journal: paths.journalPath, outbox: paths.outboxPath } };
}

function parseJsonArg(value, label) {
  try { return JSON.parse(value); } catch { throw new TypeError(`${label} must be valid JSON`); }
}
export function parseSchedulerArgs(argv = []) {
  const args = {}; const positional = [...argv];
  for (let i = 0; i < positional.length; i++) {
    const arg = positional[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--paused') args.paused = true;
    else if (arg === '--root') args.rootPath = positional[++i];
    else if (arg === '--fixture') args.fixture = positional[++i];
    else if (arg === '--roles' || arg === '--roles-json') args.roles = parseJsonArg(positional[++i], 'roles');
    else if (arg === '--scan-state' || arg === '--scan-state-json') args.scanState = parseJsonArg(positional[++i], 'scan-state');
    else if (arg === '--now') args.now = positional[++i];
    else if (arg === '--interval') args.intervalMs = Number(positional[++i]);
    else if (arg === '--channel') args.channel = positional[++i];
    else if (arg === '--outbox') args.outboxPath = positional[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new TypeError(`unknown argument: ${arg}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseSchedulerArgs(argv);
  if (options.help) { console.log('Usage: node scheduler-runner.mjs --root <absolute> [--fixture file | --roles JSON --scan-state JSON] [--channel local-jsonl] [--outbox path] [--force] [--interval ms] [--paused]'); return null; }
  if (!options.rootPath || !isAbsolute(options.rootPath)) throw new TypeError('--root must be an absolute path');
  const result = await runScheduler(options);
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 2; });
}

export default { schedulerPaths, runScheduler, parseSchedulerArgs, main };
