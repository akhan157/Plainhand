#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ScanStateStore,
  appendScanJournal,
  buildNotificationPayload,
  createScanState,
  dedupeRoleSummaries,
  filterEligibleRoles,
  getScanHealth,
  loadScanState,
  pauseScan,
  processScanRun,
  readScanJournal,
  resumeScan,
  saveScanState,
} from './scan-state.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-scan-state-'));
const config = {
  id: 'ai-search',
  name: 'High-signal AI roles',
  criteria: { roles: ['engineer'], locations: ['remote'] },
  eligibilityThreshold: 4,
};
const role = {
  id: 'role-1',
  title: 'AI Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://jobs.example.test/role-1?utm_source=feed',
  score: 5,
  liveness: 'live',
  source: 'greenhouse',
  date: '2026-08-10',
  provenance: { provider: 'greenhouse', sourceUrl: 'https://jobs.example.test/role-1', retrievedAt: '2026-08-10T08:00:00Z' },
};

try {
  let state = createScanState(config, { now: '2026-08-11T08:00:00Z' });
  assert.equal(getScanHealth(state).status, 'never_run');

  const duplicates = dedupeRoleSummaries([
    role,
    { ...role, source: 'referral', date: '2026-08-11', provenance: { provider: 'referral', note: 'trusted contact' } },
  ]);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].sources, ['greenhouse', 'referral']);
  assert.deepEqual(duplicates[0].dates, ['2026-08-10', '2026-08-11']);
  assert.equal(duplicates[0].provenance.length, 2);
  assert.equal(filterEligibleRoles(duplicates, config).length, 1);

  let result = processScanRun(state, [role, { ...role, source: 'referral', date: '2026-08-11', provenance: { provider: 'referral', note: 'trusted contact' } }, {
    id: 'expired', title: 'AI Engineer', company: 'Acme', location: 'Remote', score: 5, liveness: 'expired', source: 'feed', date: '2026-08-11', provenance: 'feed:expired',
  }, {
    id: 'uncertain', title: 'AI Engineer', company: 'Acme', location: 'Remote', score: 5, liveness: 'uncertain', source: 'feed', date: '2026-08-11', provenance: 'feed:uncertain',
  }], { now: '2026-08-11T09:00:00Z' });
  state = result.state;
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.newCount, 3);
  assert.equal(result.summary.liveCount, 1);
  assert.equal(result.summary.expiredCount, 1);
  assert.equal(result.summary.uncertainCount, 1);
  assert.equal(result.summary.eligibleCount, 1);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].source, 'greenhouse');
  assert.deepEqual(result.notifications[0].sources, ['greenhouse', 'referral']);
  assert.equal(result.notifications[0].provenance.length, 2);

  const payloadA = buildNotificationPayload({ ...role, source: 'greenhouse', date: '2026-08-10' }, { config });
  const payloadB = buildNotificationPayload({ ...role, source: 'greenhouse', date: '2026-08-10' }, { config });
  assert.deepEqual(payloadA, payloadB);
  assert.match(payloadA.id, /^notification-[a-f0-9]{24}$/);

  result = processScanRun(state, [role], { now: '2026-08-11T10:00:00Z' });
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.notifications.length, 0, 'unchanged eligible roles are suppressed');

  result = processScanRun(state, [{ ...role, score: 3, liveness: 'expired' }], { now: '2026-08-11T11:00:00Z' });
  state = result.state;
  assert.equal(result.notifications.length, 0, 'expired roles are never notified');
  result = processScanRun(state, [{ ...role, score: 5, liveness: 'live' }], { now: '2026-08-11T12:00:00Z' });
  assert.equal(result.notifications.length, 1, 'meaningful liveness/eligibility change is notified once');
  result = processScanRun(result.state, [{ ...role, score: 5, liveness: 'live' }], { now: '2026-08-11T13:00:00Z' });
  assert.equal(result.notifications.length, 0);

  const paused = pauseScan(state, 'provider maintenance', { now: '2026-08-11T14:00:00Z' });
  result = processScanRun(paused, [{ ...role, score: 5, liveness: 'live' }], { now: '2026-08-11T15:00:00Z' });
  assert.equal(result.summary.paused, true);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.summary.health, 'paused');
  state = resumeScan(result.state, { now: '2026-08-11T16:00:00Z' });
  result = processScanRun(state, [{ ...role, score: 5, liveness: 'live' }], { now: '2026-08-11T17:00:00Z' });
  assert.equal(result.notifications.length, 1, 'resume emits a previously suppressed eligible role');

  saveScanState(result.state, { rootPath: root });
  const loaded = loadScanState(root);
  assert.deepEqual(loaded.roles, result.state.roles);
  assert.throws(() => saveScanState(result.state, { rootPath: 'relative-root' }), /absolute rootPath/);
  assert.throws(() => saveScanState(result.state, { rootPath: root, statePath: join(root, '..', 'unsafe.json') }), /under rootPath/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(root, 'scan-state.json')).mode & 0o077, 0, 'state file is private');
  }

  const store = new ScanStateStore({ rootPath: root });
  appendScanJournal({ type: 'focused_test' }, { rootPath: root, now: '2026-08-11T18:00:00Z' });
  const journalBefore = readFileSync(join(root, 'scan-journal.jsonl'), 'utf8');
  appendScanJournal({ type: 'focused_test_2' }, { rootPath: root, now: '2026-08-11T18:01:00Z' });
  const journalAfter = readFileSync(join(root, 'scan-journal.jsonl'), 'utf8');
  assert.ok(journalAfter.startsWith(journalBefore));
  assert.equal(readScanJournal(root).length, 2);
  assert.equal(store.load().scan.id, config.id);
  console.log('scan state fixtures: passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
