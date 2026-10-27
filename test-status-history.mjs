import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace, recordStatusChange, syncTracker } from './plainhand/store.mjs';

test('status changes preserve bounded history instead of overwriting it', () => {
  const job = { status: 'Applied' };
  recordStatusChange(job, 'Interview', '2026-10-21T10:00:00.000Z');
  recordStatusChange(job, 'Offer', '2026-10-25T10:00:00.000Z');
  assert.equal(job.status, 'Offer');
  assert.deepEqual(job.statusHistory.map(entry => [entry.from, entry.to]), [
    ['Applied', 'Interview'],
    ['Interview', 'Offer'],
  ]);
  for (let index = 0; index < 80; index++) recordStatusChange(job, index % 2 ? 'Interview' : 'Offer', '2026-10-26T10:00:00.000Z');
  assert.equal(job.statusHistory.length, 50, 'history stays bounded');
});

test('the canonical tracker shows the current outcome for the exact company and role', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-status-'));
  const workspace = new Workspace(root);
  try {
    const job = {
      id: 'j1', company: 'Example Co', title: 'Graduate Engineer', status: 'Interview',
      createdAt: '2026-10-01T00:00:00.000Z', evaluation: { score: 4.5 }, stage: 'ready', note: 'interview scheduled',
    };
    await syncTracker(workspace, { jobs: [job] });
    const afterInterview = await workspace.read('data/applications.md');
    assert.match(afterInterview, /\| Example Co \| Graduate Engineer \| 4\.5\/5 \| Interview \|/);

    recordStatusChange(job, 'Offer');
    await syncTracker(workspace, { jobs: [job] });
    const afterOffer = await workspace.read('data/applications.md');
    assert.match(afterOffer, /\| Example Co \| Graduate Engineer \| 4\.5\/5 \| Offer \|/);
    assert.equal(afterOffer.trim().split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line)).length, 1, 'one canonical row per role');
  } finally { await rm(root, { recursive: true, force: true }); }
});
