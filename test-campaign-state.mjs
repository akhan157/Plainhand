#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CampaignStateStore,
  appendJournalEvent,
  createCampaignState,
  dedupeRoles,
  filterEligibleRoles,
  getReviewQueue,
  ingestRoles,
  loadCampaignState,
  markRoleReviewCompleted,
  markRoleReviewFailed,
  markRoleReviewStarted,
  pauseCampaign,
  requestExternalAction,
  resumeCampaign,
  retryRole,
  saveCampaignState,
  readJournal,
  validateCampaignConfig,
} from './campaign-state.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-campaign-state-'));
const campaign = {
  id: 'high-signal',
  name: 'High Signal AI Roles',
  criteria: { roles: ['engineer'], companies: ['Acme'], locations: ['Remote'] },
  eligibilityThreshold: 4,
  dailyReviewLimit: 1,
};

try {
  assert.equal(validateCampaignConfig({}).valid, false);
  assert.equal(validateCampaignConfig(campaign).valid, true);

  const duplicateRoles = dedupeRoles([
    {
      id: 'role-1', title: 'AI Engineer', company: 'Acme', url: 'https://jobs.test/1?utm_source=feed',
      source: 'greenhouse', date: '2026-08-10', provenance: { scan: 'nightly', artifact: 'scan-1' },
      score: 4.5, liveness: 'live', location: 'Remote',
    },
    {
      id: 'role-1', title: 'AI Engineer', company: 'Acme', url: 'https://jobs.test/1',
      source: 'referral', date: '2026-08-11', provenance: { scan: 'manual', artifact: 'scan-2' },
      score: 4.5, liveness: 'live', location: 'Remote',
    },
  ]);
  assert.equal(duplicateRoles.length, 1);
  assert.deepEqual(duplicateRoles[0].sources, ['greenhouse', 'referral']);
  assert.deepEqual(duplicateRoles[0].dates, ['2026-08-10', '2026-08-11']);
  assert.equal(duplicateRoles[0].provenance.length, 2);
  assert.deepEqual(filterEligibleRoles(duplicateRoles, campaign).map((role) => role.id), ['role-1']);
  assert.equal(filterEligibleRoles([{ id: 'expired', title: 'AI Engineer', company: 'Acme', score: 5, liveness: 'expired' }], campaign).length, 0);
  assert.equal(filterEligibleRoles([{ id: 'low', title: 'AI Engineer', company: 'Acme', score: 3, liveness: 'live' }], campaign).length, 0);

  let state = ingestRoles(createCampaignState(campaign, { now: '2026-08-11T08:00:00Z' }), [
    ...duplicateRoles,
    { id: 'role-2', title: 'AI Engineer', company: 'Acme', score: 4.8, liveness: 'live', location: 'Remote', source: 'ashby', date: '2026-08-11' },
  ], { now: '2026-08-11T08:01:00Z' });
  assert.equal(state.roles.length, 2);
  assert.equal(getReviewQueue(state, { date: '2026-08-11' }).length, 1);

  state = markRoleReviewStarted(state, 'role-1', { date: '2026-08-11', now: '2026-08-11T09:00:00Z' });
  assert.equal(getReviewQueue(state, { date: '2026-08-11' }).length, 0);
  state = markRoleReviewCompleted(state, 'role-1', { now: '2026-08-11T09:02:00Z' });
  assert.equal(state.reviewStates['role-1'].status, 'completed');

  state = markRoleReviewStarted(state, 'role-2', { date: '2026-08-12', now: '2026-08-12T09:00:00Z' });
  state = markRoleReviewFailed(state, 'role-2', 'provider timeout', { now: '2026-08-12T09:01:00Z' });
  const retried = retryRole(state, 'role-2', { now: '2026-08-12T09:02:00Z' });
  assert.equal(retried.reviewStates['role-2'].status, 'pending');
  assert.equal(retried.reviewStates['role-2'].retryCount, 1);
  assert.equal(retried.reviewStates['role-1'].status, 'completed');

  const paused = pauseCampaign(retried, 'waiting for profile update');
  assert.equal(getReviewQueue(paused, { date: '2026-08-13' }).length, 0);
  assert.equal(resumeCampaign(paused).paused, false);

  const actionState = requestExternalAction(retried, {
    id: 'action-1', type: 'save-draft', roleId: 'role-2', reason: 'Candidate must inspect generated answers', artifactReference: 'reports/2.md',
  });
  assert.equal(actionState.externalActions['action-1'].status, 'human_approval_required');
  assert.equal(actionState.externalActions['action-1'].artifactReference, 'reports/2.md');

  saveCampaignState(actionState, { rootPath: root });
  const loaded = loadCampaignState(root);
  assert.deepEqual(loaded.externalActions, actionState.externalActions);
  const store = new CampaignStateStore({ rootPath: root });
  appendJournalEvent({ type: 'test_event', reason: 'append-only check' }, { rootPath: root, now: '2026-08-11T10:00:00Z' });
  const journalBefore = readFileSync(join(root, 'campaign-journal.jsonl'), 'utf8');
  appendJournalEvent({ type: 'test_event_2' }, { rootPath: root, now: '2026-08-11T10:01:00Z' });
  const journalAfter = readFileSync(join(root, 'campaign-journal.jsonl'), 'utf8');
  assert.ok(journalAfter.startsWith(journalBefore));
  assert.equal(readJournal(root).length, 2);
  assert.equal(store.load().campaign.name, campaign.name);

  assert.throws(() => saveCampaignState(actionState, { rootPath: 'relative-root' }), /absolute rootPath/);
  console.log('campaign state fixtures: passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
