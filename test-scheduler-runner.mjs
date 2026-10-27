#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createScanState } from './scan-state.mjs';
import { runScheduler, schedulerPaths } from './scheduler-runner.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-scheduler-'));
const role = { id: 'runner-1', title: 'Engineer', company: 'Fixture Co', location: 'Remote', url: 'https://fixture.test/runner-1', score: 5, liveness: 'live', source: 'fixture', date: '2026-08-11', provenance: { provider: 'fixture' } };
const scanState = createScanState({ id: 'runner', eligibilityThreshold: 4 }, { now: '2026-08-11T08:00:00Z' });
try {
  assert.throws(() => schedulerPaths({ rootPath: root, outboxPath: join(root, '..', 'escape.jsonl') }), /under rootPath/);
  const first = await runScheduler({ rootPath: root, scanState, roles: [role], channel: 'local-jsonl', force: true, now: '2026-08-11T09:00:00Z' });
  assert.equal(first.delivery.results[0].status, 'delivered');
  const second = await runScheduler({ rootPath: root, scanState, roles: [role], channel: 'local-jsonl', force: true, now: '2026-08-11T10:00:00Z' });
  assert.equal(second.delivery.results[0].status, 'duplicate', 'repeated run is deduplicated by persisted delivery state');
  assert.equal(readFileSync(join(root, 'notification-outbox.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.ok(existsSync(join(root, 'notification-schedule-state.json')));
  assert.ok(existsSync(join(root, 'notification-delivery-state.json')));
  assert.ok(existsSync(join(root, 'notification-delivery-journal.jsonl')));

  const paused = await runScheduler({ rootPath: root, scanState, roles: [role], channel: 'local-jsonl', paused: true, force: true, now: '2026-08-11T11:00:00Z' });
  assert.equal(paused.skipped, true, 'paused run skips even when forced');
  const notDue = await runScheduler({ rootPath: root, scanState, roles: [role], channel: 'local-jsonl', intervalMs: 86400000, now: '2026-08-11T11:01:00Z' });
  assert.equal(notDue.skipped, true, 'interval prevents an early run');

  const noChannel = await runScheduler({ rootPath: root, scanState, roles: [{ ...role, id: 'runner-2', url: 'https://fixture.test/runner-2' }], force: true, now: '2026-08-12T09:00:00Z' });
  assert.equal(noChannel.delivery.results[0].status, 'pending');
  const customOutbox = join(root, 'sub', 'outbox.jsonl');
  const custom = await runScheduler({ rootPath: root, scanState, roles: [{ ...role, id: 'runner-3', url: 'https://fixture.test/runner-3' }], channel: 'local-jsonl', outboxPath: customOutbox, force: true, now: '2026-08-13T09:00:00Z' });
  assert.equal(custom.paths.outbox, customOutbox);
  assert.ok(existsSync(customOutbox));

  const cliRoot = mkdtempSync(join(tmpdir(), 'career-ops-scheduler-cli-'));
  try {
    const output = execFileSync(process.execPath, ['./scheduler-runner.mjs', '--root', cliRoot, '--roles', JSON.stringify([role]), '--scan-state', JSON.stringify(scanState), '--channel', 'local-jsonl', '--force', '--now', '2026-08-14T09:00:00Z'], { encoding: 'utf8' });
    const parsed = JSON.parse(output);
    assert.equal(parsed.delivery.results[0].status, 'delivered');
  } finally { rmSync(cliRoot, { recursive: true, force: true }); }
  console.log('scheduler runner fixtures: passed');
} finally { rmSync(root, { recursive: true, force: true }); }
