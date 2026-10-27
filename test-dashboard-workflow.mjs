import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowProjection } from './dashboard-workflow.mjs';

function fixture() {
  return {
    sources: {
      contacts: { name: 'contacts', status: 'present', rows: 2, path: 'contacts.md' },
      followUps: { name: 'followUps', status: 'present', rows: 3, path: 'follow-ups.md' },
      interviews: { name: 'interviews', status: 'absent', rows: 0, path: null },
    },
    applications: [
      {
        key: 'acme::platform engineer', company: 'Acme', role: 'Platform Engineer', status: 'Applied',
        nextAction: 'Ask for interview timing',
        followUp: { history: [
          { date: '2026-08-09', nextDate: '2026-08-10', nextAction: 'Send reminder', contact: 'Ada' },
          { date: '2026-08-11', nextAction: 'Check response', contact: 'Ada' },
          { date: '2026-08-12', nextAction: 'Follow up', contact: 'Ada' },
        ] },
      },
      {
        key: 'acme::data engineer', company: 'Acme', role: 'Data Engineer', status: 'Evaluated',
        followUp: { history: [{ nextAction: 'Clarify scope' }] },
      },
    ],
  };
}

test('classifies due, overdue, upcoming, and undated using explicit asOf', () => {
  const result = buildWorkflowProjection(fixture(), { asOf: '2026-08-11' });
  assert.deepEqual(result.health, {
    applications: 2, applicationsWithNextAction: 1, overdue: 1, due: 1, upcoming: 1,
    undated: 1, missingIdentity: 0, ambiguousIdentity: 0,
  });
  const platform = result.followUpQueue.find((group) => group.role === 'Platform Engineer');
  assert.deepEqual(platform.items.map((item) => item.classification), ['overdue', 'due', 'upcoming']);
  assert.equal(buildWorkflowProjection(fixture()).followUpQueue[0].items[0].classification, 'undated');
});

test('tolerates absent ledgers and reports source availability', () => {
  const result = buildWorkflowProjection({ applications: [{ company: 'Acme', role: 'Platform Engineer', key: 'acme::platform engineer' }] });
  assert.deepEqual(result.availability, {
    contacts: { status: 'absent', rows: 0, available: false },
    interviews: { status: 'absent', rows: 0, available: false },
    followUps: { status: 'absent', rows: 0, available: false },
  });
  assert.deepEqual(result.followUpQueue, []);
});

test('flags missing or ambiguous role identity instead of company-only leakage', () => {
  const result = buildWorkflowProjection({ applications: [
    { key: 'Acme', company: 'Acme', nextAction: 'Investigate' },
    { key: 'wrong', company: 'Acme', role: 'Platform Engineer', nextAction: 'Verify' },
  ] });
  assert.equal(result.health.missingIdentity, 1);
  assert.equal(result.health.ambiguousIdentity, 1);
  assert.equal(result.nextActions[0].role, null);
  assert.equal(result.nextActions[0].identityStatus, 'missing');
  assert.equal(result.nextActions[1].identityStatus, 'ambiguous');
});

test('orders applications and actions deterministically', () => {
  const payload = fixture();
  const reversed = { ...payload, applications: [...payload.applications].reverse() };
  assert.deepEqual(buildWorkflowProjection(payload, { asOf: '2026-08-11' }), buildWorkflowProjection(reversed, { asOf: '2026-08-11' }));
});

test('does not mutate supplied timeline payload', () => {
  const payload = fixture();
  const before = structuredClone(payload);
  buildWorkflowProjection(payload, { asOf: '2026-08-11' });
  assert.deepEqual(payload, before);
});

console.log('dashboard workflow projection fixture contract: passed');
