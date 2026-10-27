#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createScanState, pauseScan, processScanRun, resumeScan } from './scan-state.mjs';
import { createDeliveryState, createLocalJsonlAdapter, deliverNotifications, deliveryPaths, getDeliveryHealth, readDeliveryJournal } from './notification-delivery.mjs';
import { scheduleNotificationRun } from './notification-scheduler.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-notification-'));
const role = { id: 'r1', title: 'Engineer', company: 'Acme', location: 'Remote', url: 'https://example.test/r1', score: 5, liveness: 'live', source: 'feed', date: '2026-08-11', provenance: { provider: 'fixture' } };
const config = { id: 'test', eligibilityThreshold: 4 };
try {
  let scanState = createScanState(config, { now: '2026-08-11T08:00:00Z' });
  let first = processScanRun(scanState, [role], { now: '2026-08-11T09:00:00Z' });
  assert.equal(first.notifications.length, 1, 'new eligible role emits');
  scanState = first.state;
  assert.equal(processScanRun(scanState, [role], { now: '2026-08-11T10:00:00Z' }).notifications.length, 0, 'duplicate suppressed');
  const changed = processScanRun(scanState, [{ ...role, score: 6 }], { now: '2026-08-11T11:00:00Z' });
  assert.equal(changed.notifications.length, 1, 'meaningful eligibility/state change emits');

  const paused = pauseScan(scanState, 'maintenance', { now: '2026-08-11T12:00:00Z' });
  assert.equal(processScanRun(paused, [{ ...role, score: 6 }], { now: '2026-08-11T13:00:00Z' }).notifications.length, 0, 'pause suppresses');
  const resumed = resumeScan(paused, { now: '2026-08-11T14:00:00Z' });
  assert.equal(processScanRun(resumed, [{ ...role, score: 6 }], { now: '2026-08-11T15:00:00Z' }).notifications.length, 1, 'resume releases suppressed candidate');

  assert.throws(() => deliveryPaths({ rootPath: root, statePath: join(root, '..', 'escape-state.json') }), /under rootPath/);
  assert.throws(() => createLocalJsonlAdapter(), /absolute rootPath/);
  await assert.rejects(deliverNotifications({ notifications: first.notifications }), /absolute rootPath/);
  await assert.rejects(scheduleNotificationRun({ scanState: createScanState(config), roles: [role], force: true }), /absolute rootPath/);

  const callerOwned = { ...first.notifications[0], nested: { untouched: true } };
  const mutating = { name: 'mutating', async deliver(payload) { payload.nested.untouched = false; return { accepted: true }; } };
  await deliverNotifications({ rootPath: root, state: createDeliveryState(), notifications: [callerOwned], channels: [mutating], persist: false, now: '2026-08-11T15:30:00Z' });
  assert.deepEqual(callerOwned.nested, { untouched: true }, 'adapters receive cloned notification payloads');

  const local = createLocalJsonlAdapter({ rootPath: root });
  const delivered = await deliverNotifications({ rootPath: root, notifications: first.notifications, channels: [local], now: '2026-08-11T16:00:00Z' });
  assert.equal(delivered.results[0].status, 'delivered');
  assert.equal(readFileSync(join(root, 'notification-outbox.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1, 'outbox durable');
  const duplicate = await deliverNotifications({ rootPath: root, state: delivered.state, notifications: first.notifications, channels: [local], now: '2026-08-11T17:00:00Z' });
  assert.equal(duplicate.results[0].status, 'duplicate');

  let attempts = 0;
  const flaky = { name: 'flaky', async deliver() { attempts++; if (attempts < 2) throw new Error('temporary'); return { accepted: true }; } };
  const retried = await deliverNotifications({ rootPath: root, state: createDeliveryState({ now: '2026-08-11T18:00:00Z' }), notifications: first.notifications, channels: [flaky], maxAttempts: 2, now: '2026-08-11T18:01:00Z' });
  assert.equal(retried.results[0].status, 'delivered'); assert.equal(attempts, 2, 'retry is bounded and deterministic');
  const failed = await deliverNotifications({ rootPath: root, state: createDeliveryState(), notifications: first.notifications, channels: [{ name: 'broken', async deliver() { throw new Error('broken'); } }], maxAttempts: 2, now: '2026-08-11T19:00:00Z' });
  assert.equal(failed.results[0].status, 'failed'); assert.equal(getDeliveryHealth(failed.state).status, 'degraded');

  const noChannel = await deliverNotifications({ rootPath: root, state: createDeliveryState(), notifications: first.notifications, now: '2026-08-11T20:00:00Z' });
  assert.equal(noChannel.results[0].status, 'pending', 'no implicit channel/network');
  const scheduled = await scheduleNotificationRun({ rootPath: root, scanState: createScanState(config), roles: [role], channels: [local], now: '2026-08-11T21:00:00Z', force: true });
  assert.equal(scheduled.delivery.results[0].status, 'delivered');
  assert.ok(readDeliveryJournal({ rootPath: root }).length >= 4, 'append-only journal persists events');
  console.log('notification delivery fixtures: passed');
} finally { rmSync(root, { recursive: true, force: true }); }
