import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { deliverNotifications } from './notification-delivery.mjs';
import { createDesktopAdapter, createStdoutAdapter, notificationPayload } from './plainhand/notification-channels.mjs';

const job = { company: 'Acme', title: 'Graduate Engineer', location: 'Boston', url: 'https://jobs.lever.co/acme/1' };

test('a notification carries its source, campaign, date and reason', () => {
  const payload = notificationPayload({ job, source: 'Acme board', campaign: 'grad-mech', foundAt: '2026-10-21T12:00:00.000Z', reason: 'matched the campaign criteria' });
  assert.equal(payload.title, 'Acme — Graduate Engineer');
  assert.match(payload.body, /Location: Boston/);
  assert.match(payload.body, /Source: Acme board/);
  assert.match(payload.body, /Campaign: grad-mech/);
  assert.match(payload.body, /Found: 2026-10-21/);
  assert.match(payload.body, /https:\/\/jobs\.lever\.co\/acme\/1/);
  assert.equal(payload.provenance.company, 'Acme');
  assert.equal(payload.provenance.source, 'Acme board');
});

test('the desktop adapter passes title and body positionally, never through a shell', async () => {
  const calls = [];
  const adapter = createDesktopAdapter({ runner: async (command, args, options) => { calls.push({ command, args, options }); } });
  const result = await adapter.deliver({ title: 'Acme — Graduate Engineer', body: 'Location: Boston\nSource: Acme board' });
  assert.deepEqual(result, { accepted: true, channel: 'desktop' });
  assert.equal(calls[0].command, 'notify-send');
  assert.ok(calls[0].args.includes('Acme — Graduate Engineer'));
  assert.ok(calls[0].args.some(arg => arg.includes('Source: Acme board')));
  assert.equal(calls[0].options.timeout, 10000);
});

test('the same notification is delivered once across repeated scans', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-notify-'));
  const options = { rootPath: root, statePath: path.join(root, 'state.json'), journalPath: path.join(root, 'journal.jsonl'), outboxPath: path.join(root, 'outbox.jsonl') };
  const delivered = [];
  const channels = [{ name: 'test', async deliver(payload) { delivered.push(payload.id); return { accepted: true }; } }];
  try {
    const payload = notificationPayload({ job, source: 'Acme board' });
    const first = await deliverNotifications({ ...options, notifications: [payload], channels });
    assert.equal(first.results[0].status, 'delivered');
    const second = await deliverNotifications({ ...options, notifications: [payload], channels });
    assert.equal(second.results[0].status, 'duplicate');
    assert.deepEqual(delivered, [payload.id]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a paused delivery state suppresses notifications instead of queueing noise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-notify-paused-'));
  const options = { rootPath: root, statePath: path.join(root, 'state.json'), journalPath: path.join(root, 'journal.jsonl'), outboxPath: path.join(root, 'outbox.jsonl') };
  try {
    const result = await deliverNotifications({ ...options, state: { version: 1, paused: true, pauseReason: 'candidate paused scans', deliveries: {}, health: {} }, notifications: [notificationPayload({ job })], channels: [createStdoutAdapter({ write: () => { throw new Error('must not deliver'); } })] });
    assert.equal(result.health.status, 'paused');
    assert.deepEqual(result.results, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
