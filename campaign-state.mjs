#!/usr/bin/env node
/**
 * Local-first state for Phase 3 discovery and Phase 4 controlled campaigns.
 *
 * This module only reads and writes local files. It never opens a browser and
 * never submits (or attempts to submit) an application. External actions are
 * represented as pending human approvals until a person explicitly approves.
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
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const VERSION = 1;
const DEFAULT_STATE_FILE = 'campaign-state.json';
const DEFAULT_JOURNAL_FILE = 'campaign-journal.jsonl';
const VALID_LIVENESS = new Set(['live', 'active', 'open', 'verified', 'true']);
const TERMINAL_REVIEW_STATES = new Set(['completed', 'skipped', 'rejected']);
const RETRYABLE_REVIEW_STATES = new Set(['failed', 'error']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function uniqueValues(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clone(value));
    }
  }
  return result;
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normaliseDate(value, field = 'date') {
  const result = text(value);
  if (!result) return null;
  if (Number.isNaN(Date.parse(result))) throw new TypeError(`${field} must be an ISO-compatible date`);
  return result;
}

function normaliseCriteria(input = {}) {
  const criteria = input.criteria && typeof input.criteria === 'object' ? input.criteria : input;
  const roles = asArray(criteria.roles ?? criteria.roleTitles ?? criteria.titles).map(text).filter(Boolean);
  const companies = asArray(criteria.companies ?? criteria.companyNames ?? criteria.employers).map(text).filter(Boolean);
  const locations = asArray(criteria.locations).map(text).filter(Boolean);
  const minScore = criteria.minScore ?? input.eligibilityThreshold ?? input.threshold ?? 0;
  if (typeof minScore !== 'number' || !Number.isFinite(minScore)) throw new TypeError('eligibilityThreshold/minScore must be a finite number');
  return Object.freeze({ roles: [...new Set(roles)], companies: [...new Set(companies)], locations: [...new Set(locations)], minScore });
}

/** Validate and return a normalised named campaign configuration. */
export function validateCampaignConfig(input = {}) {
  const errors = [];
  const name = text(input.name ?? input.id);
  if (!name) errors.push('name is required');
  if (name.length > 120) errors.push('name must be at most 120 characters');
  let criteria;
  try {
    criteria = normaliseCriteria(input);
  } catch (error) {
    errors.push(error.message);
    criteria = { roles: [], companies: [], locations: [], minScore: 0 };
  }
  const dailyReviewLimit = input.dailyReviewLimit ?? input.dailyLimit ?? 0;
  if (!Number.isInteger(dailyReviewLimit) || dailyReviewLimit < 0) errors.push('dailyReviewLimit must be a non-negative integer');
  const threshold = input.eligibilityThreshold ?? criteria.minScore;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) errors.push('eligibilityThreshold must be a finite number');
  const timezone = text(input.timezone) || 'UTC';
  if (!/^([A-Za-z_]+\/)*[A-Za-z_]+$/.test(timezone)) errors.push('timezone must be an IANA-style name');
  const config = {
    id: text(input.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    criteria: { ...criteria, minScore: threshold },
    eligibilityThreshold: threshold,
    dailyReviewLimit,
    timezone,
    metadata: clone(input.metadata ?? {}),
  };
  return { valid: errors.length === 0, errors, config: errors.length === 0 ? config : null };
}

export function assertValidCampaignConfig(input) {
  const result = validateCampaignConfig(input);
  if (!result.valid) throw new TypeError(`Invalid campaign configuration: ${result.errors.join('; ')}`);
  return result.config;
}

function canonicalUrl(value) {
  const url = text(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|source$|ref$|tracking)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function roleKey(role) {
  const explicit = text(role.id ?? role.roleId ?? role.jobId);
  if (explicit) return `id:${explicit.toLowerCase()}`;
  const url = canonicalUrl(role.url ?? role.jobUrl ?? role.link);
  if (url) return `url:${url}`;
  const company = text(role.company ?? role.employer).toLowerCase();
  const title = text(role.title ?? role.role).toLowerCase();
  const location = text(role.location).toLowerCase();
  return `text:${company}|${title}|${location}`;
}

function sourceValues(role) {
  return asArray(role.sources ?? role.source).filter((value) => value !== null && value !== undefined && value !== '');
}

function dateValues(role) {
  return asArray(role.dates ?? role.date ?? role.discoveredAt ?? role.observedAt).map(text).filter(Boolean);
}

function provenanceValues(role) {
  return asArray(role.provenance ?? role.provenances ?? role.provenanceRecords).filter((value) => value !== null && value !== undefined);
}

function normaliseRole(input = {}) {
  const title = text(input.title ?? input.role);
  const company = text(input.company ?? input.employer);
  if (!title || !company) throw new TypeError('role title and company are required');
  const sources = uniqueValues(sourceValues(input));
  const dates = uniqueValues(dateValues(input));
  const provenance = uniqueValues(provenanceValues(input));
  for (const date of dates) normaliseDate(date);
  const url = text(input.url ?? input.jobUrl ?? input.link);
  const role = {
    ...clone(input),
    id: text(input.id ?? input.roleId ?? input.jobId) || roleKey(input).slice(5),
    title,
    company,
    url: url || undefined,
    source: sources[0] ?? null,
    sources,
    date: dates[0] ?? null,
    dates,
    provenance,
    provenanceRecords: provenance,
    identity: roleKey(input),
  };
  delete role.role;
  delete role.employer;
  delete role.jobUrl;
  delete role.link;
  return role;
}

function mergeRoles(existing, incoming) {
  const sources = uniqueValues([...sourceValues(existing), ...sourceValues(incoming)]);
  const dates = uniqueValues([...dateValues(existing), ...dateValues(incoming)]);
  const provenance = uniqueValues([...provenanceValues(existing), ...provenanceValues(incoming)]);
  const merged = {
    ...clone(existing),
    ...clone(incoming),
    id: existing.id,
    identity: existing.identity,
    title: existing.title,
    company: existing.company,
    url: existing.url ?? incoming.url,
    source: existing.source ?? incoming.source ?? null,
    sources,
    date: existing.date ?? incoming.date ?? null,
    dates,
    provenance,
    provenanceRecords: provenance,
  };
  // Discovery evidence is append-only; later observations may not erase it.
  return merged;
}

/** Deduplicate roles while retaining every source, date, and provenance record. */
export function dedupeRoles(roles = []) {
  if (!Array.isArray(roles)) throw new TypeError('roles must be an array');
  const byIdentity = new Map();
  for (const candidate of roles) {
    const role = normaliseRole(candidate);
    const prior = byIdentity.get(role.identity);
    byIdentity.set(role.identity, prior ? mergeRoles(prior, role) : role);
  }
  return [...byIdentity.values()];
}

function criterionMatches(value, criteria) {
  if (!criteria.length) return true;
  const normalised = text(value).toLowerCase();
  return criteria.some((candidate) => normalised === candidate.toLowerCase() || normalised.includes(candidate.toLowerCase()));
}

/** Return whether a role is live, matches criteria, and reaches the threshold. */
export function isEligibleRole(role, configOrThreshold = {}) {
  const config = configOrThreshold && typeof configOrThreshold === 'object' ? configOrThreshold : { eligibilityThreshold: configOrThreshold };
  const criteria = config.criteria ?? config;
  const threshold = config.eligibilityThreshold ?? criteria.minScore ?? config.minScore ?? 0;
  if (role.eligible === false || role.isEligible === false) return false;
  const liveness = role.liveness ?? role.live ?? role.status;
  if (liveness !== undefined && liveness !== null && liveness !== '' && !VALID_LIVENESS.has(String(liveness).toLowerCase())) return false;
  const score = role.score ?? role.fitScore ?? role.eligibilityScore;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < threshold) return false;
  if (!criterionMatches(role.title ?? role.role, asArray(criteria.roles ?? criteria.roleTitles).map(text).filter(Boolean))) return false;
  if (!criterionMatches(role.company ?? role.employer, asArray(criteria.companies ?? criteria.companyNames).map(text).filter(Boolean))) return false;
  if (!criterionMatches(role.location, asArray(criteria.locations).map(text).filter(Boolean))) return false;
  return true;
}

export function filterEligibleRoles(roles, configOrThreshold = {}) {
  return dedupeRoles(roles).filter((role) => isEligibleRole(role, configOrThreshold));
}

function nowIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function dayKey(value) {
  return nowIso(value).slice(0, 10);
}

function requireState(state) {
  if (!state || typeof state !== 'object' || !state.campaign || !Array.isArray(state.roles)) throw new TypeError('invalid campaign state');
  return state;
}

export function createCampaignState(configInput, options = {}) {
  const campaign = assertValidCampaignConfig(configInput);
  const now = nowIso(options.now);
  return {
    version: VERSION,
    campaign,
    paused: false,
    pauseReason: null,
    roles: [],
    reviewStates: {},
    reviewCounts: {},
    externalActions: {},
    createdAt: now,
    updatedAt: now,
  };
}

function roleState(state, roleId) {
  return state.reviewStates[roleId] ?? { status: 'pending', attempts: 0, retryCount: 0 };
}

/** Ingest discovery results and preserve role evidence across repeated scans. */
export function ingestRoles(state, roles, options = {}) {
  requireState(state);
  const incoming = dedupeRoles(roles);
  const combined = dedupeRoles([...state.roles, ...incoming]);
  const result = { ...clone(state), roles: combined, updatedAt: nowIso(options.now) };
  return result;
}

export function eligibleRoles(state) {
  requireState(state);
  return filterEligibleRoles(state.roles, state.campaign);
}

export function getReviewQueue(state, options = {}) {
  requireState(state);
  if (state.paused) return [];
  const date = dayKey(options.date);
  const alreadyReviewed = Number(state.reviewCounts?.[date] ?? 0);
  const remaining = Math.max(0, state.campaign.dailyReviewLimit - alreadyReviewed);
  const limit = options.limit === undefined ? remaining : Math.min(remaining, Math.max(0, options.limit));
  return eligibleRoles(state).filter((role) => {
    const current = roleState(state, role.id);
    return !TERMINAL_REVIEW_STATES.has(current.status) && current.status !== 'in_progress';
  }).slice(0, limit);
}

export function markRoleReviewStarted(state, roleId, options = {}) {
  requireState(state);
  const role = state.roles.find((item) => item.id === roleId);
  if (!role) throw new Error(`Unknown role: ${roleId}`);
  if (state.paused) throw new Error('campaign is paused');
  const date = dayKey(options.date);
  const count = Number(state.reviewCounts?.[date] ?? 0);
  if (count >= state.campaign.dailyReviewLimit) throw new Error('daily review limit reached');
  const current = roleState(state, roleId);
  if (TERMINAL_REVIEW_STATES.has(current.status)) throw new Error(`role is already ${current.status}`);
  return {
    ...clone(state),
    reviewCounts: { ...state.reviewCounts, [date]: count + 1 },
    reviewStates: { ...state.reviewStates, [roleId]: { ...current, status: 'in_progress', attempts: current.attempts + 1, startedAt: nowIso(options.now), reviewDate: date } },
    updatedAt: nowIso(options.now),
  };
}

export function markRoleReviewCompleted(state, roleId, options = {}) {
  requireState(state);
  const current = roleState(state, roleId);
  return { ...clone(state), reviewStates: { ...state.reviewStates, [roleId]: { ...current, status: 'completed', completedAt: nowIso(options.now), error: null } }, updatedAt: nowIso(options.now) };
}

export function markRoleReviewFailed(state, roleId, error, options = {}) {
  requireState(state);
  const current = roleState(state, roleId);
  return { ...clone(state), reviewStates: { ...state.reviewStates, [roleId]: { ...current, status: 'failed', failedAt: nowIso(options.now), error: text(error?.message ?? error) || 'Unknown failure' } }, updatedAt: nowIso(options.now) };
}

/** Retry one failed role without changing any other role's state. */
export function retryRole(state, roleId, options = {}) {
  requireState(state);
  const current = roleState(state, roleId);
  if (!RETRYABLE_REVIEW_STATES.has(current.status)) throw new Error(`role ${roleId} is not failed`);
  return { ...clone(state), reviewStates: { ...state.reviewStates, [roleId]: { ...current, status: 'pending', retryCount: current.retryCount + 1, retryRequestedAt: nowIso(options.now), error: null } }, updatedAt: nowIso(options.now) };
}

export function pauseCampaign(state, reason = 'paused by user', options = {}) {
  requireState(state);
  return { ...clone(state), paused: true, pauseReason: text(reason) || 'paused by user', updatedAt: nowIso(options.now) };
}

export function resumeCampaign(state, options = {}) {
  requireState(state);
  return { ...clone(state), paused: false, pauseReason: null, updatedAt: nowIso(options.now) };
}

/** Create a visible, non-executable external action requiring human approval. */
export function requestExternalAction(state, input = {}, options = {}) {
  requireState(state);
  const actionId = text(input.id ?? input.actionId) || randomUUID();
  if (!text(input.reason)) throw new TypeError('external action reason is required');
  const action = {
    id: actionId,
    type: text(input.type) || 'external_action',
    roleId: text(input.roleId) || null,
    reason: text(input.reason),
    artifactReference: text(input.artifactReference ?? input.artifact) || null,
    status: 'human_approval_required',
    requestedAt: nowIso(options.now),
    approvedAt: null,
  };
  return { ...clone(state), externalActions: { ...state.externalActions, [actionId]: action }, updatedAt: nowIso(options.now) };
}

export function approveExternalAction(state, actionId, options = {}) {
  requireState(state);
  const action = state.externalActions?.[actionId];
  if (!action) throw new Error(`Unknown external action: ${actionId}`);
  return { ...clone(state), externalActions: { ...state.externalActions, [actionId]: { ...action, status: 'approved', approvedAt: nowIso(options.now) } }, updatedAt: nowIso(options.now) };
}

function pathsFor(options = {}) {
  const rootPath = options.rootPath ?? options.root;
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) throw new TypeError('an explicit absolute rootPath is required');
  const statePath = options.statePath ?? join(rootPath, DEFAULT_STATE_FILE);
  const journalPath = options.journalPath ?? join(rootPath, DEFAULT_JOURNAL_FILE);
  if (!isAbsolute(statePath) || !isAbsolute(journalPath)) throw new TypeError('statePath and journalPath must be absolute');
  return { rootPath, statePath, journalPath };
}

/** Atomically write JSON in the same directory, then rename it into place. */
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

export function saveCampaignState(state, options = {}) {
  requireState(state);
  const paths = pathsFor(options);
  atomicWriteJson(paths.statePath, state);
  return paths.statePath;
}

export function loadCampaignState(options = {}) {
  const paths = pathsFor(typeof options === 'string' ? { rootPath: options } : options);
  if (!existsSync(paths.statePath)) throw new Error(`campaign state does not exist: ${paths.statePath}`);
  const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  requireState(state);
  return state;
}

/** Append one JSONL event; this file is never rewritten or truncated. */
export function appendJournalEvent(event, options = {}) {
  const paths = pathsFor(options);
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('journal event must be an object');
  const record = { eventId: randomUUID(), occurredAt: nowIso(options.now), ...clone(event) };
  mkdirSync(dirname(paths.journalPath), { recursive: true });
  appendFileSync(paths.journalPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
}

export function readJournal(options = {}) {
  const paths = pathsFor(typeof options === 'string' ? { rootPath: options } : options);
  if (!existsSync(paths.journalPath)) return [];
  return readFileSync(paths.journalPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Persist a transition and append its audit event as two explicit operations. */
export function persistTransition(state, event, options = {}) {
  saveCampaignState(state, options);
  return appendJournalEvent(event, options);
}

export class CampaignStateStore {
  constructor(options = {}) {
    this.paths = pathsFor(options);
  }

  create(config, options = {}) {
    const state = createCampaignState(config, options);
    saveCampaignState(state, this.paths);
    appendJournalEvent({ type: 'campaign_created', campaignId: state.campaign.id }, this.paths);
    return state;
  }

  load() { return loadCampaignState(this.paths); }

  save(state) { return saveCampaignState(state, this.paths); }

  ingest(roles, options = {}) {
    const state = ingestRoles(this.load(), roles, options);
    this.save(state);
    appendJournalEvent({ type: 'roles_ingested', count: roles.length }, this.paths);
    return state;
  }

  pause(reason, options = {}) {
    const state = pauseCampaign(this.load(), reason, options);
    this.save(state);
    appendJournalEvent({ type: 'campaign_paused', reason: state.pauseReason }, this.paths);
    return state;
  }

  resume(options = {}) {
    const state = resumeCampaign(this.load(), options);
    this.save(state);
    appendJournalEvent({ type: 'campaign_resumed' }, this.paths);
    return state;
  }

  retry(roleId, options = {}) {
    const state = retryRole(this.load(), roleId, options);
    this.save(state);
    appendJournalEvent({ type: 'role_retry_requested', roleId }, this.paths);
    return state;
  }

  startReview(roleId, options = {}) {
    const state = markRoleReviewStarted(this.load(), roleId, options);
    this.save(state);
    appendJournalEvent({ type: 'role_review_started', roleId, reviewDate: state.reviewStates[roleId].reviewDate }, this.paths);
    return state;
  }

  completeReview(roleId, options = {}) {
    const state = markRoleReviewCompleted(this.load(), roleId, options);
    this.save(state);
    appendJournalEvent({ type: 'role_review_completed', roleId }, this.paths);
    return state;
  }

  failReview(roleId, error, options = {}) {
    const state = markRoleReviewFailed(this.load(), roleId, error, options);
    this.save(state);
    appendJournalEvent({ type: 'role_review_failed', roleId, error: state.reviewStates[roleId].error }, this.paths);
    return state;
  }

  requestExternalAction(input, options = {}) {
    const state = requestExternalAction(this.load(), input, options);
    this.save(state);
    appendJournalEvent({ type: 'external_action_requested', actionId: Object.keys(state.externalActions).at(-1) }, this.paths);
    return state;
  }

  approveExternalAction(actionId, options = {}) {
    const state = approveExternalAction(this.load(), actionId, options);
    this.save(state);
    appendJournalEvent({ type: 'external_action_approved', actionId }, this.paths);
    return state;
  }
}

export const createCampaign = (config, options = {}) => new CampaignStateStore(options).create(config, options);
export const loadCampaign = loadCampaignState;
export const saveCampaign = saveCampaignState;
export const deduplicateRoles = dedupeRoles;
export const getEligibleRoles = eligibleRoles;

export default {
  CampaignStateStore,
  validateCampaignConfig,
  assertValidCampaignConfig,
  createCampaignState,
  createCampaign,
  loadCampaignState,
  loadCampaign,
  saveCampaignState,
  saveCampaign,
  dedupeRoles,
  deduplicateRoles,
  ingestRoles,
  filterEligibleRoles,
  isEligibleRole,
  eligibleRoles,
  getEligibleRoles,
  getReviewQueue,
  markRoleReviewStarted,
  markRoleReviewCompleted,
  markRoleReviewFailed,
  retryRole,
  pauseCampaign,
  resumeCampaign,
  requestExternalAction,
  approveExternalAction,
  atomicWriteJson,
  appendJournalEvent,
  readJournal,
  persistTransition,
};
