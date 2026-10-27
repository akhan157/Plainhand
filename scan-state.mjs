#!/usr/bin/env node
/**
 * Local-first state primitives for Phase 3 discovery scans.
 *
 * This module only classifies and persists scan observations. It never fetches
 * portals, opens a browser, sends notifications, or changes user-layer data.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const VERSION = 1;
const DEFAULT_STATE_FILE = 'scan-state.json';
const DEFAULT_JOURNAL_FILE = 'scan-journal.jsonl';
const LIVE_VALUES = new Set(['live', 'active', 'open', 'verified', 'true', 'yes']);
const EXPIRED_VALUES = new Set(['expired', 'closed', 'dead', 'inactive', 'false', 'no']);
const UNCERTAIN_VALUES = new Set(['uncertain', 'unknown', 'pending', 'error']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clone(value));
  }
  return output;
}

function sortedUnique(values) {
  return unique(values).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function canonicalUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|source$|ref$|tracking)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function identityFor(role) {
  const explicit = text(role.id ?? role.roleId ?? role.jobId);
  if (explicit) return `id:${explicit.toLowerCase()}`;
  const url = canonicalUrl(role.url ?? role.jobUrl ?? role.link);
  if (url) return `url:${url}`;
  return `text:${text(role.company ?? role.employer).toLowerCase()}|${text(role.title ?? role.role).toLowerCase()}|${text(role.location).toLowerCase()}`;
}

function normaliseLiveness(value) {
  if (typeof value === 'boolean') return value ? 'live' : 'expired';
  const lower = text(value).toLowerCase();
  if (LIVE_VALUES.has(lower)) return 'live';
  if (EXPIRED_VALUES.has(lower)) return 'expired';
  if (UNCERTAIN_VALUES.has(lower)) return 'uncertain';
  return 'uncertain';
}

function sourceValues(role) {
  return asArray(role.sources ?? role.source).filter((value) => value !== null && value !== undefined && value !== '');
}

function dateValues(role) {
  return asArray(role.dates ?? role.date ?? role.discoveredAt ?? role.observedAt)
    .map(text)
    .filter(Boolean);
}

function provenanceValues(role) {
  return asArray(role.provenance ?? role.provenances ?? role.provenanceRecords)
    .filter((value) => value !== null && value !== undefined);
}

function validDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`invalid scan date: ${value}`);
  return parsed.toISOString();
}

function criteriaFrom(config = {}) {
  return config.criteria && typeof config.criteria === 'object' ? config.criteria : config;
}

function criterionMatches(value, values) {
  const candidates = asArray(values).map(text).filter(Boolean);
  if (!candidates.length) return true;
  const normalised = text(value).toLowerCase();
  return candidates.some((candidate) => normalised === candidate.toLowerCase() || normalised.includes(candidate.toLowerCase()));
}

function scoreFor(role) {
  const value = role.score ?? role.fitScore ?? role.eligibilityScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isEligible(summary, config = {}) {
  if (summary.liveness !== 'live') return false;
  if (summary.eligible === false || summary.isEligible === false) return false;
  const criteria = criteriaFrom(config);
  const threshold = Number(config.eligibilityThreshold ?? config.minScore ?? criteria.minScore ?? 0);
  const score = scoreFor(summary);
  if (score === null || score < threshold) return false;
  return criterionMatches(summary.title, criteria.roles ?? criteria.roleTitles)
    && criterionMatches(summary.company, criteria.companies ?? criteria.companyNames)
    && criterionMatches(summary.location, criteria.locations);
}

// State stores a computed `eligible` field; recompute it after a role changes
// instead of treating yesterday's computed false as an explicit provider veto.
function eligibilityForSummary(summary, config = {}) {
  const candidate = { ...summary };
  delete candidate.eligible;
  delete candidate.isEligible;
  if (summary.eligibilityOverride === false) return false;
  return isEligible(candidate, config);
}

/** Convert provider output into a stable, provenance-preserving role summary. */
export function summarizeRole(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('role must be an object');
  const title = text(input.title ?? input.role);
  const company = text(input.company ?? input.employer);
  if (!title || !company) throw new TypeError('role title and company are required');
  const sources = sortedUnique(sourceValues(input));
  const dates = sortedUnique(dateValues(input));
  const provenance = sortedUnique(provenanceValues(input));
  const observedAt = text(options.observedAt ?? input.observedAt ?? input.date ?? input.discoveredAt) || null;
  if (observedAt) validDate(observedAt);
  const url = canonicalUrl(input.url ?? input.jobUrl ?? input.link);
  const identity = identityFor(input);
  const summary = {
    ...clone(input),
    id: text(input.id ?? input.roleId ?? input.jobId) || identity.slice(3),
    identity,
    title,
    company,
    url: url || null,
    location: text(input.location) || null,
    source: sources[0] ?? null,
    sources,
    date: dates[0] ?? null,
    dates,
    provenance,
    provenanceRecords: provenance,
    liveness: normaliseLiveness(input.liveness ?? input.live ?? input.status),
    score: scoreFor(input),
    firstSeenAt: text(input.firstSeenAt) || observedAt,
    lastSeenAt: text(input.lastSeenAt) || observedAt,
  };
  if (Object.hasOwn(input, 'eligible') || Object.hasOwn(input, 'isEligible')) {
    summary.eligibilityOverride = input.eligible ?? input.isEligible;
  }
  return summary;
}

function mergeSummary(existing, incoming) {
  const merged = {
    ...clone(existing),
    ...clone(incoming),
    id: existing.id,
    identity: existing.identity,
    title: existing.title,
    company: existing.company,
    url: existing.url || incoming.url || null,
    location: incoming.location || existing.location || null,
    source: existing.source || incoming.source || null,
    sources: sortedUnique([...sourceValues(existing), ...sourceValues(incoming)]),
    date: existing.date || incoming.date || null,
    dates: sortedUnique([...dateValues(existing), ...dateValues(incoming)]),
    provenance: sortedUnique([...provenanceValues(existing), ...provenanceValues(incoming)]),
    provenanceRecords: sortedUnique([...provenanceValues(existing), ...provenanceValues(incoming)]),
    firstSeenAt: existing.firstSeenAt || incoming.firstSeenAt || null,
    lastSeenAt: incoming.lastSeenAt || existing.lastSeenAt || null,
  };
  return merged;
}

/** Deduplicate one scan while retaining all source/date/provenance evidence. */
export function dedupeRoleSummaries(roles = [], options = {}) {
  if (!Array.isArray(roles)) throw new TypeError('roles must be an array');
  const byIdentity = new Map();
  for (const candidate of roles) {
    const summary = summarizeRole(candidate, options);
    const prior = byIdentity.get(summary.identity);
    byIdentity.set(summary.identity, prior ? mergeSummary(prior, summary) : summary);
  }
  return [...byIdentity.values()].sort((a, b) => a.identity.localeCompare(b.identity));
}

function meaningfulSignature(role) {
  return {
    identity: role.identity,
    title: role.title,
    company: role.company,
    url: role.url,
    location: role.location,
    liveness: role.liveness,
    eligible: role.eligible === true,
    score: role.score,
  };
}

function fingerprint(role) {
  return createHash('sha256').update(JSON.stringify(meaningfulSignature(role))).digest('hex');
}

function pathsFor(options = {}) {
  const rootPath = options.rootPath ?? options.root;
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) throw new TypeError('an explicit absolute rootPath is required');
  const root = resolve(rootPath);
  const statePath = options.statePath ?? join(root, DEFAULT_STATE_FILE);
  const journalPath = options.journalPath ?? join(root, DEFAULT_JOURNAL_FILE);
  if (!isAbsolute(statePath) || !isAbsolute(journalPath)) throw new TypeError('statePath and journalPath must be absolute');
  for (const candidate of [statePath, journalPath]) {
    const rel = relative(root, resolve(candidate));
    if (rel.startsWith('..') || isAbsolute(rel)) throw new TypeError('statePath and journalPath must remain under rootPath');
  }
  return { rootPath: root, statePath: resolve(statePath), journalPath: resolve(journalPath) };
}

function requireState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.roles) || !state.scan) throw new TypeError('invalid scan state');
  return state;
}

export function createScanState(config = {}, options = {}) {
  const now = validDate(options.now ?? new Date().toISOString());
  const scan = {
    id: text(config.id ?? config.scanId) || 'default-scan',
    name: text(config.name) || text(config.id ?? config.scanId) || 'Career-Ops scan',
    criteria: clone(config.criteria ?? {}),
    eligibilityThreshold: Number(config.eligibilityThreshold ?? config.minScore ?? config.criteria?.minScore ?? 0),
  };
  if (!Number.isFinite(scan.eligibilityThreshold)) throw new TypeError('eligibility threshold must be finite');
  return {
    version: VERSION,
    scan,
    paused: false,
    pauseReason: null,
    roles: [],
    notifications: {},
    runs: [],
    health: {
      status: 'never_run',
      runCount: 0,
      consecutiveFailures: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Return only roles that are live and meet the scan's eligibility contract. */
export function filterEligibleRoles(roles, config = {}) {
  return dedupeRoleSummaries(roles).map((role) => ({ ...role, eligible: isEligible(role, config) })).filter((role) => role.eligible);
}

export function getScanHealth(state) {
  requireState(state);
  return clone(state.health);
}

export function pauseScan(state, reason = 'paused by user', options = {}) {
  requireState(state);
  const pausedHealth = { ...clone(state.health), status: 'paused' };
  return {
    ...clone(state),
    paused: true,
    pauseReason: text(reason) || 'paused by user',
    health: pausedHealth,
    updatedAt: validDate(options.now ?? new Date().toISOString()),
  };
}

export function resumeScan(state, options = {}) {
  requireState(state);
  const health = clone(state.health);
  if (health.status === 'paused') {
    health.status = health.runCount > 0
      ? (health.consecutiveFailures > 0 ? 'degraded' : 'healthy')
      : 'never_run';
  }
  return {
    ...clone(state),
    paused: false,
    pauseReason: null,
    health,
    updatedAt: validDate(options.now ?? new Date().toISOString()),
  };
}

function notificationPayload(role, options = {}) {
  const payload = {
    type: 'career_role_available',
    roleId: role.id,
    identity: role.identity,
    title: role.title,
    company: role.company,
    location: role.location,
    url: role.url,
    liveness: role.liveness,
    score: role.score,
    source: role.source,
    sources: [...role.sources],
    date: role.date,
    dates: [...role.dates],
    provenance: clone(role.provenance),
    reasons: ['live', 'eligible', ...(options.stateChanged ? ['meaningful_state_change'] : ['new_role'])],
  };
  const id = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  return { id: `notification-${id}`, ...payload };
}

/** Build deterministic notification payloads without sending them anywhere. */
export function buildNotificationPayload(role, options = {}) {
  const summary = summarizeRole(role);
  summary.eligible = options.eligible ?? isEligible(summary, options.config ?? {});
  return notificationPayload(summary, options);
}

/**
 * Classify one scan and return a new state plus a deterministic notification list.
 * Existing role observations are merged, while notifications are emitted only
 * for new eligible-live roles or a meaningful eligibility/liveness change.
 */
export function processScanRun(state, roles = [], options = {}) {
  requireState(state);
  if (!Array.isArray(roles)) throw new TypeError('roles must be an array');
  const now = validDate(options.now ?? new Date().toISOString());
  const incoming = dedupeRoleSummaries(roles, { observedAt: now });
  const existingByIdentity = new Map(state.roles.map((role) => [role.identity, role]));
  const uniqueIncoming = [];
  const seen = new Set();
  for (const role of incoming) {
    if (seen.has(role.identity)) continue;
    seen.add(role.identity);
    uniqueIncoming.push({ ...role, lastSeenAt: now, firstSeenAt: existingByIdentity.get(role.identity)?.firstSeenAt || role.firstSeenAt || now });
  }

  const mergedByIdentity = new Map(existingByIdentity);
  const newRoles = [];
  const changedRoles = [];
  let duplicateCount = roles.length - incoming.length;
  for (const role of uniqueIncoming) {
    const prior = existingByIdentity.get(role.identity);
    if (prior) {
      duplicateCount++;
      const priorSignature = JSON.stringify(meaningfulSignature({ ...prior, eligible: eligibilityForSummary(prior, state.scan) }));
      const merged = mergeSummary(prior, role);
      merged.eligible = eligibilityForSummary(merged, state.scan);
      mergedByIdentity.set(role.identity, merged);
      if (priorSignature !== JSON.stringify(meaningfulSignature(merged))) changedRoles.push(merged);
    } else {
      role.eligible = eligibilityForSummary(role, state.scan);
      mergedByIdentity.set(role.identity, role);
      newRoles.push(role);
    }
  }

  const allRoles = [...mergedByIdentity.values()].sort((a, b) => a.identity.localeCompare(b.identity));
  const liveRoles = uniqueIncoming.filter((role) => role.liveness === 'live');
  const expiredRoles = uniqueIncoming.filter((role) => role.liveness === 'expired');
  const uncertainRoles = uniqueIncoming.filter((role) => role.liveness === 'uncertain');
  const eligibleRoles = uniqueIncoming.filter((role) => eligibilityForSummary(role, state.scan));
  const notifications = [];
  const nextNotifications = { ...state.notifications };
  if (!state.paused) {
    const candidateIds = new Set([
      ...newRoles.map((role) => role.identity),
      ...changedRoles.map((role) => role.identity),
      ...uniqueIncoming.filter((role) => !nextNotifications[role.identity]).map((role) => role.identity),
      ...uniqueIncoming.filter((role) => {
        const prior = nextNotifications[role.identity];
        const signature = fingerprint({ ...role, eligible: eligibilityForSummary(role, state.scan) });
        return prior && prior.lastObservedFingerprint !== signature;
      }).map((role) => role.identity),
    ]);
    for (const identity of [...candidateIds].sort()) {
      const current = mergedByIdentity.get(identity);
      if (!current) continue;
      const signature = fingerprint({ ...current, eligible: eligibilityForSummary(current, state.scan) });
      const prior = nextNotifications[identity];
      const priorObserved = prior?.lastObservedFingerprint ?? prior?.fingerprint ?? null;
      const meaningfulChange = priorObserved !== signature;
      if (eligibilityForSummary(current, state.scan) && meaningfulChange) {
        const payload = notificationPayload({ ...current, eligible: true }, { stateChanged: !newRoles.some((item) => item.identity === identity) });
        nextNotifications[identity] = { ...prior, fingerprint: signature, lastObservedFingerprint: signature, notificationId: payload.id, notifiedAt: now };
        notifications.push(payload);
      } else {
        nextNotifications[identity] = { ...prior, lastObservedFingerprint: signature };
      }
    }
  }

  const suppliedError = text(options.error?.message ?? options.error);
  const health = suppliedError
    ? {
        ...clone(state.health), status: state.paused ? 'paused' : 'degraded', runCount: state.health.runCount + 1,
        consecutiveFailures: state.health.consecutiveFailures + 1, lastRunAt: now, lastError: suppliedError,
      }
    : {
        ...clone(state.health), status: state.paused ? 'paused' : 'healthy', runCount: state.health.runCount + 1,
        consecutiveFailures: 0, lastRunAt: now, lastSuccessAt: now, lastError: null,
      };
  const summary = {
    runAt: now,
    paused: state.paused,
    found: roles.length,
    unique: uniqueIncoming.length,
    duplicates: duplicateCount,
    newCount: newRoles.length,
    liveCount: liveRoles.length,
    expiredCount: expiredRoles.length,
    uncertainCount: uncertainRoles.length,
    eligibleCount: eligibleRoles.length,
    changedCount: changedRoles.length,
    notificationCount: notifications.length,
    // Short aliases make the scan summary convenient for CLI/dashboard code.
    new: newRoles.length,
    live: liveRoles.length,
    expired: expiredRoles.length,
    uncertain: uncertainRoles.length,
    eligible: eligibleRoles.length,
    notifications: notifications.length,
    counts: {
      found: roles.length,
      unique: uniqueIncoming.length,
      duplicates: duplicateCount,
      new: newRoles.length,
      live: liveRoles.length,
      expired: expiredRoles.length,
      uncertain: uncertainRoles.length,
      eligible: eligibleRoles.length,
    },
    health: health.status,
  };
  const nextState = {
    ...clone(state),
    roles: allRoles,
    notifications: nextNotifications,
    runs: [...state.runs, clone(summary)],
    health,
    updatedAt: now,
  };
  return { state: nextState, summary, notifications };
}

export const runScan = processScanRun;
export const ingestScanResults = processScanRun;
export const scanHealth = getScanHealth;
export const dedupeRoles = dedupeRoleSummaries;
export const summarizeScanRole = summarizeRole;

export function atomicWriteJson(filePath, value) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('atomic write path must be absolute');
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, filePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function saveScanState(state, options = {}) {
  requireState(state);
  const paths = pathsFor(options);
  atomicWriteJson(paths.statePath, state);
  return paths.statePath;
}

export function loadScanState(options = {}) {
  const paths = pathsFor(typeof options === 'string' ? { rootPath: options } : options);
  if (!existsSync(paths.statePath)) throw new Error(`scan state does not exist: ${paths.statePath}`);
  const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  requireState(state);
  return state;
}

export function appendScanJournal(event, options = {}) {
  const paths = pathsFor(options);
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('journal event must be an object');
  const record = { eventId: randomUUID(), occurredAt: validDate(options.now ?? new Date().toISOString()), ...clone(event) };
  mkdirSync(dirname(paths.journalPath), { recursive: true });
  appendFileSync(paths.journalPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
}

export function readScanJournal(options = {}) {
  const paths = pathsFor(typeof options === 'string' ? { rootPath: options } : options);
  if (!existsSync(paths.journalPath)) return [];
  return readFileSync(paths.journalPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export class ScanStateStore {
  constructor(options = {}) { this.paths = pathsFor(options); }
  create(config, options = {}) {
    const state = createScanState(config, options);
    saveScanState(state, this.paths);
    appendScanJournal({ type: 'scan_created', scanId: state.scan.id }, this.paths);
    return state;
  }
  load() { return loadScanState(this.paths); }
  save(state) { return saveScanState(state, this.paths); }
  run(roles, options = {}) {
    const result = processScanRun(this.load(), roles, options);
    this.save(result.state);
    appendScanJournal({ type: 'scan_run', summary: result.summary, notificationIds: result.notifications.map((item) => item.id) }, { ...this.paths, now: options.now });
    return result;
  }
  pause(reason, options = {}) {
    const state = pauseScan(this.load(), reason, options);
    this.save(state);
    appendScanJournal({ type: 'scan_paused', reason: state.pauseReason }, { ...this.paths, now: options.now });
    return state;
  }
  resume(options = {}) {
    const state = resumeScan(this.load(), options);
    this.save(state);
    appendScanJournal({ type: 'scan_resumed' }, { ...this.paths, now: options.now });
    return state;
  }
}

export default {
  ScanStateStore,
  createScanState,
  summarizeRole,
  summarizeScanRole,
  dedupeRoleSummaries,
  dedupeRoles,
  filterEligibleRoles,
  processScanRun,
  runScan,
  ingestScanResults,
  buildNotificationPayload,
  getScanHealth,
  scanHealth,
  pauseScan,
  resumeScan,
  saveScanState,
  loadScanState,
  atomicWriteJson,
  appendScanJournal,
  readScanJournal,
};
