#!/usr/bin/env node
/**
 * Local-first approval ledger for Phase 5 outcome recommendations.
 *
 * This module reads caller-supplied analysis/source snapshots only. It writes
 * ledger state and an append-only journal below an explicit system root; it
 * never applies a strategy change or mutates tracker, report, config, or
 * profile data.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const RECOMMENDATION_STATES = Object.freeze(['candidate', 'approved', 'rejected', 'deferred']);
export const RECOMMENDATION_TRANSITIONS = Object.freeze({ approve: 'approved', reject: 'rejected', defer: 'deferred' });
const VERSION = 1;
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const nowIso = (value) => {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError('invalid date');
  return date.toISOString();
};
const fail = (message, code = 'RECOMMENDATION_BLOCKED') => { const error = new Error(message); error.code = code; throw error; };

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

export function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function fingerprintAnalysisSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('analysisSnapshot must be an object', 'ANALYSIS_SNAPSHOT_REQUIRED');
  return fingerprint(snapshot);
}

export function fingerprintSourceBasis(sourceBasis) {
  if (sourceBasis === undefined || sourceBasis === null || (typeof sourceBasis === 'string' && !text(sourceBasis))) fail('sourceBasis is required', 'SOURCE_BASIS_REQUIRED');
  if (typeof sourceBasis !== 'object' && typeof sourceBasis !== 'string') fail('sourceBasis must be an object or string', 'SOURCE_BASIS_INVALID');
  return fingerprint(sourceBasis);
}

function validateFingerprint(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(text(value))) fail(`${label} must be a SHA-256 fingerprint`, 'FINGERPRINT_INVALID');
  return text(value).toLowerCase();
}

function contextFrom(input = {}, { creation = false } = {}) {
  const hasAnalysis = input.analysisSnapshot !== undefined;
  const hasSource = input.sourceBasis !== undefined;
  const analysisFingerprint = hasAnalysis
    ? fingerprintAnalysisSnapshot(input.analysisSnapshot)
    : validateFingerprint(input.analysisFingerprint, 'analysisFingerprint');
  const sourceFingerprint = hasSource
    ? fingerprintSourceBasis(input.sourceBasis)
    : validateFingerprint(input.sourceFingerprint, 'sourceFingerprint');
  if (creation && !hasAnalysis && !input.analysisFingerprint) fail('analysisSnapshot is required when creating a recommendation', 'ANALYSIS_SNAPSHOT_REQUIRED');
  if (creation && !hasSource && !input.sourceFingerprint) fail('sourceBasis is required when creating a recommendation', 'SOURCE_BASIS_REQUIRED');
  return { analysisFingerprint, sourceFingerprint };
}

function candidateFrom(input = {}) {
  const candidate = input.candidate ?? input.recommendation;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail('an actionable recommendation candidate is required', 'NON_ACTIONABLE_RECOMMENDATION');
  const result = clone(candidate);
  const status = text(result.status).toLowerCase();
  if (status && status !== 'candidate') {
    if (status === 'insufficient-data') fail('insufficient-data recommendations cannot enter the approval ledger', 'INSUFFICIENT_DATA');
    fail('only candidate recommendations can enter the approval ledger', 'NON_ACTIONABLE_RECOMMENDATION');
  }
  if (result.requiresApproval === false) fail('recommendation is non-actionable because it does not require approval', 'NON_ACTIONABLE_RECOMMENDATION');
  result.status = 'candidate';
  return result;
}

function ensureSufficientData(analysisSnapshot, candidate) {
  const warnings = Array.isArray(analysisSnapshot?.warnings) ? analysisSnapshot.warnings : [];
  const insufficient = warnings.find((warning) => {
    const code = text(warning?.code).toLowerCase();
    return code === 'insufficient-observed-outcomes' || code === 'insufficient-band-data' || code === 'no-scored-rows' || code === 'no-tracker-rows';
  });
  if (insufficient) fail(`insufficient data: ${insufficient.message || 'analysis does not support a recommendation'}`, 'INSUFFICIENT_DATA');
  const observed = Number(analysisSnapshot?.counts?.observedOutcomes);
  const minimum = Number(analysisSnapshot?.calibration?.minimumObservedForRecommendation);
  if (Number.isFinite(observed) && Number.isFinite(minimum) && observed < minimum) fail('analysis has insufficient observed outcomes for a recommendation', 'INSUFFICIENT_DATA');
  if (text(candidate.type).toLowerCase() === 'insufficient-data') fail('insufficient-data recommendations cannot be approved', 'INSUFFICIENT_DATA');
}

function recommendationIdentity(context, candidate) {
  return fingerprint({ analysisFingerprint: context.analysisFingerprint, sourceFingerprint: context.sourceFingerprint, candidate });
}

export function recommendationFingerprint(input = {}) {
  const context = contextFrom(input, { creation: true });
  return recommendationIdentity(context, candidateFrom(input));
}

export function recommendationId(input = {}) {
  return `outcome-recommendation-${recommendationFingerprint(input).slice(0, 24)}`;
}

function assertLedger(state) {
  if (!state || state.version !== VERSION || !state.recommendations || typeof state.recommendations !== 'object' || Array.isArray(state.recommendations)) fail('invalid outcome recommendation ledger state', 'INVALID_LEDGER_STATE');
}

export function createRecommendationLedgerState(options = {}) {
  const createdAt = nowIso(options.now);
  return { version: VERSION, recommendations: {}, createdAt, updatedAt: createdAt };
}

/** Build a deterministic candidate record without changing the caller input. */
export function buildRecommendation(input = {}, options = {}) {
  const context = contextFrom(input, { creation: true });
  const candidate = candidateFrom(input);
  if (input.analysisSnapshot) ensureSufficientData(input.analysisSnapshot, candidate);
  const fingerprintValue = recommendationIdentity(context, candidate);
  const generatedId = `outcome-recommendation-${fingerprintValue.slice(0, 24)}`;
  const requestedId = text(input.id || input.recommendationId);
  const id = requestedId || generatedId;
  if (requestedId && requestedId !== generatedId) fail('recommendation id must be derived from its fingerprint', 'RECOMMENDATION_ID_MISMATCH');
  const createdAt = nowIso(options.now);
  return {
    id,
    fingerprint: fingerprintValue,
    status: 'candidate',
    candidate,
    analysisFingerprint: context.analysisFingerprint,
    sourceFingerprint: context.sourceFingerprint,
    createdAt,
    updatedAt: createdAt,
    approvedAt: null,
    rejectedAt: null,
    deferredAt: null,
    decidedBy: null,
    decisionReason: null,
    audit: [{ type: 'candidate', at: createdAt }],
  };
}

export function createRecommendation(state, input = {}, options = {}) {
  assertLedger(state);
  const record = buildRecommendation(input, options);
  const existing = state.recommendations[record.id];
  if (existing) {
    if (existing.fingerprint !== record.fingerprint) fail(`recommendation id already exists: ${record.id}`, 'DUPLICATE_RECOMMENDATION');
    return state;
  }
  const sameFingerprint = Object.values(state.recommendations).find((item) => item.fingerprint === record.fingerprint);
  if (sameFingerprint) return state;
  return { ...clone(state), recommendations: { ...state.recommendations, [record.id]: record }, updatedAt: record.createdAt };
}

function assertFresh(record, input = {}) {
  const context = contextFrom(input);
  if (context.analysisFingerprint !== record.analysisFingerprint) fail('recommendation is stale: analysis fingerprint does not match', 'STALE_ANALYSIS');
  if (context.sourceFingerprint !== record.sourceFingerprint) fail('recommendation source fingerprint does not match', 'SOURCE_FINGERPRINT_MISMATCH');
}

function transition(state, id, target, input = {}, options = {}) {
  assertLedger(state);
  const record = state.recommendations[text(id)];
  if (!record) fail(`recommendation not found: ${id}`, 'RECOMMENDATION_NOT_FOUND');
  assertFresh(record, input);
  const at = nowIso(options.now);
  const actor = text(input.actor || input.reviewer || input.approver || input.decidedBy);
  if (!actor) fail('an explicit reviewer/actor is required for recommendation decisions', 'ACTOR_REQUIRED');
  const reason = text(input.reason || input.decisionReason) || null;
  if (target !== 'approved' && !reason) fail('a reason is required to reject or defer a recommendation', 'DECISION_REASON_REQUIRED');
  if (record.status === target) return state;
  if (record.status !== 'candidate') fail(`cannot transition ${record.status} to ${target}`, 'INVALID_RECOMMENDATION_TRANSITION');
  const next = {
    ...clone(record),
    status: target,
    updatedAt: at,
    decidedBy: actor,
    decisionReason: reason,
    [`${target}At`]: at,
    audit: [...record.audit, { type: target, at, actor, ...(reason ? { reason } : {}) }],
  };
  return { ...clone(state), recommendations: { ...state.recommendations, [record.id]: next }, updatedAt: at };
}

export const approveRecommendation = (state, id, input = {}, options = {}) => transition(state, id, 'approved', input, options);
export const rejectRecommendation = (state, id, input = {}, options = {}) => transition(state, id, 'rejected', input, options);
export const deferRecommendation = (state, id, input = {}, options = {}) => transition(state, id, 'deferred', input, options);

function pathsFor(options = {}) {
  const root = options.rootPath || options.root;
  if (!isAbsolute(root || '')) fail('an explicit absolute rootPath is required', 'ROOT_PATH_REQUIRED');
  const rootPath = resolve(root);
  const statePath = resolve(options.statePath || join(rootPath, 'outcome-recommendation-state.json'));
  const journalPath = resolve(options.journalPath || join(rootPath, 'outcome-recommendation-journal.jsonl'));
  for (const path of [statePath, journalPath]) {
    const rel = relative(rootPath, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('recommendation ledger files must remain under the explicit root', 'RECOMMENDATION_PATH_INVALID');
  }
  return { rootPath, statePath, journalPath };
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function journalEvent(type, record, at) {
  return { eventId: randomUUID(), type, recommendationId: record.id, at, record: clone(record) };
}

export function replayRecommendationJournal(events = [], options = {}) {
  if (!Array.isArray(events)) fail('recommendation journal must be an array', 'INVALID_JOURNAL');
  let state = createRecommendationLedgerState(options);
  const seen = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object' || !event.record) fail('invalid recommendation journal event', 'INVALID_JOURNAL');
    if (event.eventId && seen.has(event.eventId)) continue;
    if (event.eventId) seen.add(event.eventId);
    const record = clone(event.record);
    const existing = state.recommendations[record.id];
    if (existing) {
      if (existing.fingerprint !== record.fingerprint) fail(`journal replay conflict for recommendation ${record.id}`, 'JOURNAL_REPLAY_CONFLICT');
      if (stableStringify(existing) === stableStringify(record) || event.type === 'recommendation_created') continue;
    }
    state = { ...state, recommendations: { ...state.recommendations, [record.id]: record }, updatedAt: record.updatedAt || record.createdAt || state.updatedAt };
  }
  return state;
}

export class OutcomeRecommendationLedger {
  constructor(options = {}) { this.paths = pathsFor(options); }
  load() {
    if (existsSync(this.paths.statePath)) {
      const state = JSON.parse(readFileSync(this.paths.statePath, 'utf8'));
      assertLedger(state);
      return state;
    }
    if (existsSync(this.paths.journalPath)) return replayRecommendationJournal(this.journal());
    return createRecommendationLedgerState();
  }
  journal() {
    if (!existsSync(this.paths.journalPath)) return [];
    return readFileSync(this.paths.journalPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  persist(state, event) {
    atomicWrite(this.paths.statePath, state);
    mkdirSync(dirname(this.paths.journalPath), { recursive: true });
    appendFileSync(this.paths.journalPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return state;
  }
  create(input = {}, options = {}) {
    const current = this.load();
    const next = createRecommendation(current, input, options);
    return next === current ? current : this.persist(next, journalEvent('recommendation_created', next.recommendations[Object.keys(next.recommendations).at(-1)], next.updatedAt));
  }
  approve(id, input = {}, options = {}) { return this.#transition(id, 'approved', input, options); }
  reject(id, input = {}, options = {}) { return this.#transition(id, 'rejected', input, options); }
  defer(id, input = {}, options = {}) { return this.#transition(id, 'deferred', input, options); }
  #transition(id, target, input, options) {
    const current = this.load();
    const next = transition(current, id, target, input, options);
    return next === current ? current : this.persist(next, journalEvent(`recommendation_${target}`, next.recommendations[text(id)], next.updatedAt));
  }
}

export const getCapabilityReport = () => Object.freeze({ phase: 5, recommendationApprovalLedger: true, localFirst: true, appendOnlyJournal: true, appliesStrategyChanges: false, mutatesSources: false });

export default {
  OutcomeRecommendationLedger,
  RECOMMENDATION_STATES,
  RECOMMENDATION_TRANSITIONS,
  createRecommendationLedgerState,
  buildRecommendation,
  createRecommendation,
  approveRecommendation,
  rejectRecommendation,
  deferRecommendation,
  replayRecommendationJournal,
  fingerprint,
  fingerprintAnalysisSnapshot,
  fingerprintSourceBasis,
  recommendationFingerprint,
  recommendationId,
  getCapabilityReport,
};
