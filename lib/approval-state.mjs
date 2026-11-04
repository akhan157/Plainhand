#!/usr/bin/env node
/**
 * Local-first, explicit approval ledger. This module never opens a browser,
 * submits an application, or treats a missing approval as approval.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { reviewApplicationPacket } from './application-packet-review.mjs';

export const APPROVAL_STATES = Object.freeze(['requested', 'approved', 'revoked', 'expired', 'consumed']);
const FINAL_ACTIONS = new Set(['submit', 'apply', 'send', 'finish', 'complete', 'final_submit', 'finalize']);
const VERSION = 1;
const clone = (v) => v === undefined ? undefined : structuredClone(v);
const text = (v) => typeof v === 'string' ? v.trim() : '';
const nowIso = (v) => (v ? new Date(v) : new Date()).toISOString();
const fail = (message, code = 'APPROVAL_BLOCKED') => { const e = new Error(message); e.code = code; throw e; };
function identity(input = {}) {
  const x = input.identity || input.target || input;
  return { company: text(x.company), role: text(x.role), reportId: text(x.reportId || x.report_id || input.report?.id), packetId: text(x.packetId || x.packet_id || input.packetId || input.packet_id) };
}
function artifactIdentity(input = {}) {
  const source = input.artifactIdentity || input.artifacts || input.artifact || {};
  if (typeof source === 'string') return { id: source };
  const result = {};
  for (const key of ['id', 'fingerprint', 'path', 'contentFingerprint', 'content_fingerprint']) if (text(source[key])) result[key] = text(source[key]);
  return result;
}
function ensureIdentity(value, label = 'approval identity') {
  if (!value.company || !value.role || !value.reportId || !value.packetId) fail(`${label} requires exact company, role, report ID, and packet identity`);
  return value;
}
function ensureNoTrackerDuplication(input) {
  for (const key of ['trackerSource', 'tracker_source', 'trackerSources', 'tracker_sources', 'trackerUrl', 'tracker_url']) {
    if (input[key] !== undefined && input[key] !== null && (Array.isArray(input[key]) ? input[key].length : text(input[key]))) fail('tracker source must not be duplicated in approval ledger', 'TRACKER_SOURCE_DUPLICATION');
  }
}
function ensureAction(action) {
  const value = text(action).toLowerCase();
  if (!value) fail('action type is required');
  if (FINAL_ACTIONS.has(value) || [...FINAL_ACTIONS].some((name) => value.includes(name))) fail(`final submission approval is forbidden: ${action}`, 'FINAL_SUBMIT_REJECTED');
  return value;
}
function normalizeSensitive(input) {
  const fields = input.sensitiveFields || input.sensitive_fields || [];
  if (!Array.isArray(fields)) fail('sensitive fields must be an array');
  return [...new Set(fields.map(text).filter(Boolean))].sort();
}
function confirmations(input) {
  const values = input.sensitiveConfirmations || input.sensitive_confirmations || input.confirmations || {};
  if (Array.isArray(values)) return [...new Set(values.map(text).filter(Boolean))].sort();
  return Object.entries(values && typeof values === 'object' ? values : {}).filter(([, v]) => v === true).map(([k]) => k).sort();
}
function exactPacketMatch(record, input) {
  const id = identity(input);
  if (id.company !== record.identity.company || id.role !== record.identity.role || id.reportId !== record.identity.reportId || id.packetId !== record.identity.packetId) fail('approval identity does not exactly match requested company, role, report, and packet', 'IDENTITY_MISMATCH');
  const artifact = artifactIdentity(input);
  if (JSON.stringify(artifact) !== JSON.stringify(record.artifactIdentity)) fail('packet/artifact identity does not exactly match approval', 'ARTIFACT_MISMATCH');
}
function packetCheck(input) {
  const review = input.packetReview || input.packet_review || input.review;
  if (!review || review.ok !== true || review.status !== 'ready_for_review') fail('packet/reviewer readiness is required before approval', 'PACKET_NOT_READY');
  return review;
}
function assertLedger(state) {
  if (!state || state.version !== VERSION || typeof state.approvals !== 'object') fail('invalid approval ledger state');
}
function transition(state, approvalId, target, input = {}, options = {}) {
  assertLedger(state);
  const at = nowIso(options.now);
  const record = state.approvals[approvalId];
  if (record.expiresAt && new Date(record.expiresAt) <= new Date(at) && ['requested', 'approved'].includes(record.status)) {
    if (target !== 'expired') fail('approval has expired', 'APPROVAL_EXPIRED');
    return applyTransition(state, record, 'expired', { expiredAt: at }, at);
  }
  const allowed = { approved: ['requested'], revoked: ['requested', 'approved'], consumed: ['approved'], expired: ['requested', 'approved'] };
  if (!allowed[target]?.includes(record.status)) fail(`cannot transition ${record.status} to ${target}`, 'INVALID_APPROVAL_TRANSITION');
  if (target === 'approved') {
    exactPacketMatch(record, input); packetCheck(input);
    const reviewer = text(input.reviewer || input.reviewerId || input.reviewer_id);
    const approver = text(input.approver || input.approverId || input.approver_id);
    if (!reviewer || !approver) fail('reviewer and approver are required for approval');
    const confirmed = confirmations(input);
    if (record.sensitiveFields.some((field) => !confirmed.includes(field))) fail('all required sensitive-field confirmations are explicit', 'SENSITIVE_CONFIRMATION_REQUIRED');
    return applyTransition(state, record, target, { reviewer, approver, approvedAt: at, sensitiveConfirmations: confirmed }, at);
  }
  if (target === 'consumed') exactPacketMatch(record, input);
  return applyTransition(state, record, target, { [`${target}At`]: at, reason: text(input.reason) || null }, at);
}
function applyTransition(state, record, target, fields, at) {
  const next = { ...clone(record), ...fields, status: target, audit: [...record.audit, { type: target, at, ...(fields.reason ? { reason: fields.reason } : {}) }] };
  return { ...clone(state), approvals: { ...state.approvals, [record.id]: next }, updatedAt: at };
}

export function createApprovalLedgerState(options = {}) { return { version: VERSION, approvals: {}, journal: [], createdAt: nowIso(options.now), updatedAt: nowIso(options.now) }; }
export function requestApproval(state, input = {}, options = {}) {
  assertLedger(state); ensureNoTrackerDuplication(input); const id = text(input.id || input.approvalId) || randomUUID();
  const actionType = ensureAction(input.actionType || input.type); const exact = ensureIdentity(identity(input));
  const callerPath = text(input.callerPath || input.caller_path || input.sourcePath || input.source_path);
  if (!callerPath) fail('caller path is required');
  const artifact = artifactIdentity(input); if (!Object.keys(artifact).length) fail('packet/artifact identity is required');
  const sensitiveFields = normalizeSensitive(input); const requestedAt = nowIso(options.now);
  const expiresAt = input.expiresAt ? nowIso(input.expiresAt) : (input.ttlMs ? new Date(Date.parse(requestedAt) + Number(input.ttlMs)).toISOString() : null);
  if (expiresAt && new Date(expiresAt) <= new Date(requestedAt)) fail('approval expiry must be in the future');
  const record = { id, status: 'requested', callerPath, actionType, identity: exact, artifactIdentity: artifact, sensitiveFields, sensitiveConfirmations: [], reviewer: null, approver: null, requestedAt, approvedAt: null, expiresAt, revokedAt: null, expiredAt: null, consumedAt: null, audit: [{ type: 'requested', at: requestedAt, callerPath }] };
  if (state.approvals[id]) fail(`approval already exists: ${id}`, 'DUPLICATE_APPROVAL');
  return { ...clone(state), approvals: { ...state.approvals, [id]: record }, updatedAt: requestedAt };
}
export const approveApproval = (state, id, input = {}, options = {}) => transition(state, id, 'approved', input, options);
export const revokeApproval = (state, id, input = {}, options = {}) => transition(state, id, 'revoked', input, options);
export const expireApproval = (state, id, input = {}, options = {}) => transition(state, id, 'expired', input, options);
export const consumeApproval = (state, id, input = {}, options = {}) => transition(state, id, 'consumed', input, options);

function paths(options = {}) {
  const root = options.rootPath || options.root;
  if (!isAbsolute(root || '')) fail('an explicit absolute rootPath is required');
  const rootPath = resolve(root);
  const result = {
    state: resolve(options.statePath || join(rootPath, 'approval-state.json')),
    journal: resolve(options.journalPath || join(rootPath, 'approval-journal.jsonl')),
  };
  for (const path of Object.values(result)) {
    const rel = relative(rootPath, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('approval files must remain under the explicit root', 'APPROVAL_PATH_INVALID');
  }
  return result;
}
function atomic(path, value) { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); renameSync(tmp, path); }
export class ApprovalLedger {
  constructor(options = {}) { this.paths = paths(options); }
  load() { if (!existsSync(this.paths.state)) return createApprovalLedgerState(); const state = JSON.parse(readFileSync(this.paths.state, 'utf8')); assertLedger(state); return state; }
  journal() { if (!existsSync(this.paths.journal)) return []; return readFileSync(this.paths.journal, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  persist(state, event) { atomic(this.paths.state, state); mkdirSync(dirname(this.paths.journal), { recursive: true }); const entry = { ...clone(event), at: event.at || new Date().toISOString() }; appendFileSync(this.paths.journal, `${JSON.stringify(entry)}\n`); return state; }
  request(input, options = {}) { const state = requestApproval(this.load(), input, options); return this.persist(state, { type: 'approval_requested', approvalId: text(input.id || input.approvalId) || Object.keys(state.approvals).at(-1) }); }
  approve(id, input = {}, options = {}) { const state = approveApproval(this.load(), id, input, options); return this.persist(state, { type: 'approval_approved', approvalId: id }); }
  revoke(id, input = {}, options = {}) { const state = revokeApproval(this.load(), id, input, options); return this.persist(state, { type: 'approval_revoked', approvalId: id }); }
  expire(id, input = {}, options = {}) { const state = expireApproval(this.load(), id, input, options); return this.persist(state, { type: 'approval_expired', approvalId: id }); }
  consume(id, input = {}, options = {}) { const state = consumeApproval(this.load(), id, input, options); return this.persist(state, { type: 'approval_consumed', approvalId: id }); }
}
export default { ApprovalLedger, createApprovalLedgerState, requestApproval, approveApproval, revokeApproval, expireApproval, consumeApproval, APPROVAL_STATES };
