#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalLedger, approveApproval, consumeApproval, createApprovalLedgerState, expireApproval, requestApproval, revokeApproval } from './approval-state.mjs';

const base = (overrides = {}) => ({ id: 'a-1', callerPath: 'campaign-state.requestExternalAction', actionType: 'save_draft', company: 'Acme', role: 'Engineer', reportId: 'r-7', packetId: 'packet-7', artifactIdentity: { id: 'resume-7', fingerprint: 'sha-7' }, sensitiveFields: ['salary', 'work_authorization'], ...overrides });
const ready = { ok: true, status: 'ready_for_review' };
const approval = (state, input = {}, now = '2026-08-11T10:00:00Z') => { const approvalId = Object.keys(state.approvals)[0]; return approveApproval(state, approvalId, { ...base({ id: approvalId }), packetReview: ready, reviewer: 'reviewer-1', approver: 'candidate-1', sensitiveConfirmations: ['salary', 'work_authorization'], ...input }, { now }); };

let state = requestApproval(createApprovalLedgerState({ now: '2026-08-11T09:00:00Z' }), base(), { now: '2026-08-11T09:00:00Z' });
assert.equal(state.approvals['a-1'].status, 'requested');
state = approval(state); assert.equal(state.approvals['a-1'].status, 'approved');
assert.throws(() => consumeApproval(state, 'a-1', base({ packetId: 'wrong-packet', packetReview: ready }), { now: '2026-08-11T10:01:00Z' }), /identity|exactly match/); // artifact identity must match the approved packet
state = consumeApproval(state, 'a-1', base(), { now: '2026-08-11T10:01:00Z' });
assert.equal(state.approvals['a-1'].status, 'consumed');
assert.throws(() => consumeApproval(state, 'a-1', base()), /cannot transition/);

assert.throws(() => approval(requestApproval(createApprovalLedgerState(), base({ id: 'a-2' })), { packetReview: { ok: false, status: 'blocked' } }), /readiness/);
assert.throws(() => approval(requestApproval(createApprovalLedgerState(), base({ id: 'a-3' })), { company: 'Other' }), /exactly match/);
assert.throws(() => approval(requestApproval(createApprovalLedgerState(), base({ id: 'a-4' })), { sensitiveConfirmations: ['salary'] }), /sensitive/);
assert.throws(() => requestApproval(createApprovalLedgerState(), base({ id: 'a-5', actionType: 'final_submit' })), /final submission/);
assert.throws(() => requestApproval(createApprovalLedgerState(), base({ id: 'a-6', trackerSource: 'applications.md' })), /tracker source/);

let exp = requestApproval(createApprovalLedgerState(), base({ id: 'a-7', expiresAt: '2026-08-11T10:00:00Z' }), { now: '2026-08-11T09:00:00Z' });
assert.throws(() => approval(exp, {}, '2026-08-11T10:00:00Z'), /expired/);
exp = revokeApproval(exp, 'a-7', { reason: 'changed packet' }, { now: '2026-08-11T09:30:00Z' });
assert.equal(exp.approvals['a-7'].status, 'revoked');
assert.throws(() => approveApproval(exp, 'a-7', { ...base({ id: 'a-7' }), packetReview: ready, reviewer: 'r', approver: 'a', sensitiveConfirmations: ['salary', 'work_authorization'] }), /cannot transition/);

const root = mkdtempSync(join(tmpdir(), 'approval-ledger-'));
assert.throws(() => new ApprovalLedger({ rootPath: root, statePath: join(root, '..', 'escape-state.json') }), /remain under/);
assert.throws(() => new ApprovalLedger({ rootPath: root, journalPath: join(root, '..', 'escape-journal.jsonl') }), /remain under/);
const ledger = new ApprovalLedger({ rootPath: root });
ledger.request(base({ id: 'persisted' }), { now: '2026-08-11T09:00:00Z' });
ledger.approve('persisted', { ...base({ id: 'persisted' }), packetReview: ready, reviewer: 'reviewer', approver: 'candidate', sensitiveConfirmations: ['salary', 'work_authorization'] }, { now: '2026-08-11T09:01:00Z' });
const lines = readFileSync(join(root, 'approval-journal.jsonl'), 'utf8').trim().split('\n');
assert.equal(lines.length, 2); assert.equal(JSON.parse(lines[0]).type, 'approval_requested'); assert.equal(JSON.parse(lines[1]).type, 'approval_approved');
assert.equal(ledger.load().approvals.persisted.callerPath, 'campaign-state.requestExternalAction');
assert.equal(ledger.load().approvals.persisted.status, 'approved');
console.log('approval-state tests passed');
