#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserCheckpointStore,
  createBrowserCheckpoint,
  recoverBrowserCheckpoint,
  resumeBrowserCheckpoint,
  validateBrowserCheckpoint,
} from './browser-checkpoints.mjs';
const NOW = '2026-08-11T10:00:00.000Z';
const base = (overrides = {}) => ({
  callerPath: 'apply-browser.main',
  company: 'Acme Systems',
  role: 'Staff Engineer',
  reportId: 'report-42',
  packetId: 'packet-42',
  artifactIdentity: { id: 'resume-42', contentFingerprint: 'sha-42' },
  portalUrl: 'https://jobs.example.test/acme/staff-engineer',
  currentStep: 'fill',
  fieldState: { resume: { status: 'filled' }, location: { status: 'pending' } },
  saveState: { status: 'saved', savedAt: NOW },
  ...overrides,
});

// Pure creation is deterministic with an explicit clock, never authorizes submit,
// and rejects finalizing controls or persisted field values.
const created = createBrowserCheckpoint(base(), { now: NOW });
assert.equal(created.submissionAllowed, false);
assert.equal(created.currentStep, 'fill');
assert.equal(created.timestamps.createdAt, NOW);
assert.equal(created.resumability.resumable, true);
assert.throws(() => createBrowserCheckpoint(base({ controls: ['Save draft', 'Submit application'] }), { now: NOW }), /finalizing control rejected/);
assert.ok(validateBrowserCheckpoint({ ...created, fieldState: { email: { value: 'candidate@example.test' } } }).some((error) => /user value/.test(error)));
assert.throws(() => createBrowserCheckpoint(base({ fieldState: { email: { value: 'candidate@example.test' } } }), { now: NOW }), /user value/);
assert.throws(() => createBrowserCheckpoint(base({ submissionAllowed: true }), { now: NOW }), /submission is never allowed/);

// Create/save/load/resume uses only an explicit checkpoint root and preserves
// caller-path plus exact artifact identity.
const root = mkdtempSync(join(tmpdir(), 'browser-checkpoints-'));
const store = new BrowserCheckpointStore({ rootPath: root });
const saved = store.save(created, { now: NOW });
assert.equal(saved.submissionAllowed, false);
const loaded = store.load();
assert.deepEqual(loaded.identity, created.identity);
assert.deepEqual(loaded.artifactIdentity, created.artifactIdentity);
const resumed = store.resume(base(), { now: '2026-08-11T10:05:00.000Z' });
assert.equal(resumed.ok, true);
assert.equal(resumed.status, 'resumable');
assert.equal(resumed.submissionAllowed, false);
assert.equal(resumed.checkpoint.timestamps.lastResumedAt, '2026-08-11T10:05:00.000Z');
assert.equal(resumeBrowserCheckpoint(resumed.checkpoint, base()).ok, true);

// A mismatch invalidates the persisted checkpoint and cannot be resumed.
const mismatch = store.resume(base({ role: 'Principal Engineer' }), { now: '2026-08-11T10:06:00.000Z' });
assert.equal(mismatch.ok, false);
assert.equal(mismatch.status, 'invalidated');
assert.equal(mismatch.checkpoint.invalidated, true);
assert.equal(store.load().resumability.resumable, false);
assert.throws(() => recoverBrowserCheckpoint(store.load(), base({ packetId: 'packet-wrong' }), { now: NOW }), /exactly match/);

// Saving a new exact identity replaces the old caller-path checkpoint only after
// recording invalidation, so recovery cannot silently cross roles or artifacts.
const replacement = store.save(createBrowserCheckpoint(base({ role: 'Principal Engineer', packetId: 'packet-43', artifactIdentity: { id: 'resume-43' } }), { now: '2026-08-11T10:07:00.000Z' }), { now: '2026-08-11T10:07:00.000Z' });
assert.equal(replacement.identity.role, 'Principal Engineer');
assert.equal(store.load().identity.packetId, 'packet-43');

// Failure recovery records a durable, safe checkpoint and never turns on submit.
const failure = store.recoverFailure({
  ...base({ role: 'Principal Engineer', packetId: 'packet-43', artifactIdentity: { id: 'resume-43' } }),
  code: 'PORTAL_TIMEOUT',
  message: 'portal stopped responding after save',
}, { now: '2026-08-11T10:08:00.000Z' });
assert.equal(failure.ok, true);
assert.equal(failure.status, 'failure_recorded');
assert.equal(failure.checkpoint.failure.code, 'PORTAL_TIMEOUT');
assert.equal(failure.checkpoint.submissionAllowed, false);
assert.equal(failure.checkpoint.resumability.resumable, true);

// The journal is append-only and contains durable save, invalidation, resume,
// replacement, and failure events in order.
const journalPath = join(root, 'browser-checkpoint-journal.jsonl');
const lines = readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
assert.ok(lines.length >= 6);
assert.equal(lines[0].type, 'checkpoint_saved');
assert.ok(lines.some((entry) => entry.type === 'checkpoint_invalidated'));
assert.ok(lines.some((entry) => entry.type === 'checkpoint_resumed'));
assert.equal(lines.at(-1).type, 'checkpoint_failure_recovered');
assert.equal(store.journal().length, lines.length);

console.log('browser-checkpoints tests passed');
