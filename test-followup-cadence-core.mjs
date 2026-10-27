#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeFollowupCadence } from './followup-cadence-core.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-cadence-core-'));
const files = {
  tracker: `# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-04-01 | Acme | Platform Engineer | 4.5/5 | Applied |  |  |  |\n| 2 | 2026-03-01 | Beta | Product Engineer | 4/5 | Applied |  |  |  |\n| 3 | 2026-04-08 | Gamma | Applied AI Engineer | 4/5 | Responded |  |  |  |\n| 4 | 2026-03-01 | SameCo | Platform Engineer | 4/5 | Applied |  |  |  |\n| 5 | 2026-03-01 | SameCo | Product Engineer | 4/5 | Applied |  |  |  |\n| 6 | 2026-04-01 | Delta | Data Engineer | 4/5 | Applied |  |  |  |\n`,
  followUps: `| # | Application | Company | Role | Date | Channel | Contact | Note |\n|---|---|---|---|---|---|---|---|\n| 1 | 1 | Acme | Platform Engineer | 2026-04-02 | email | Ada | confirmed sent |\n| 2 | 4 | SameCo | Platform Engineer | 2026-03-03 | email | Sam | exact role |\n| 3 |  | SameCo |  | 2026-04-01 | email | Sam | ambiguous company-only row |\n`,
  drafts: `| Updated | Company | Role | Portal | Draft Status | Resume | Referral | Resume URL | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 2026-04-07 | Acme | Platform Engineer | greenhouse | saved_draft | resume.pdf |  | https://example.test/draft | recommendation only |\n| 2026-04-07 | SameCo | Product Engineer | greenhouse | blocked_before_save | resume.pdf |  |  | missing field |\n`,
};

try {
  writeFileSync(join(root, 'applications.md'), files.tracker);
  writeFileSync(join(root, 'follow-ups.md'), files.followUps);
  writeFileSync(join(root, 'application-drafts.md'), files.drafts);
  const before = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content]));

  assert.throws(() => analyzeFollowupCadence(undefined, { asOf: '2026-04-08' }), /explicit root/);
  const result = analyzeFollowupCadence(root, { asOf: '2026-04-08' });
  assert.equal(result.asOf, '2026-04-08');
  assert.equal(result.sources.contacts.status, 'absent');
  assert.equal(result.sources.interviews.status, 'absent');
  assert.equal(result.sources.followUps.status, 'present');
  assert.equal(result.sources.drafts.status, 'present');

  const byRole = (role) => result.applications.find((entry) => entry.role === role);
  const acme = byRole('Platform Engineer');
  const beta = result.applications.find((entry) => entry.company === 'Beta');
  const gamma = result.applications.find((entry) => entry.company === 'Gamma');
  const sameProduct = result.applications.find((entry) => entry.company === 'SameCo' && entry.role === 'Product Engineer');
  const samePlatform = result.applications.find((entry) => entry.company === 'SameCo' && entry.role === 'Platform Engineer');

  assert.equal(acme.confirmedSentCount, 1);
  assert.equal(acme.lastConfirmedSentDate, '2026-04-02');
  assert.equal(acme.nextFollowupDate, '2026-04-09');
  assert.ok(acme.draftRecommendations.some((item) => item.kind === 'saved-draft' && item.confirmed === false));
  assert.equal(acme.confirmedActivity[0].confirmed, true);
  assert.equal(beta.urgency, 'overdue');
  assert.equal(gamma.urgency, 'urgent');
  assert.equal(gamma.confirmedSentCount, 0);
  assert.equal(samePlatform.confirmedSentCount, 1);
  assert.equal(sameProduct.confirmedSentCount, 0);
  assert.deepEqual(sameProduct.blockers, ['draft status blocked_before_save']);
  assert.equal(sameProduct.sourceProvenance.followUps.matchedRows, 0);

  assert.deepEqual(result.queue.map((entry) => `${entry.urgency}:${entry.company}:${entry.role}`), [
    'urgent:Gamma:Applied AI Engineer',
    'overdue:Beta:Product Engineer',
    'overdue:SameCo:Product Engineer',
    'overdue:SameCo:Platform Engineer',
    'due:Delta:Data Engineer',
    'upcoming:Acme:Platform Engineer',
  ]);
  assert.equal(result.metadata.urgent, 1);
  assert.equal(result.metadata.overdue, 3);
  assert.equal(result.metadata.upcoming, 1);
  assert.equal(result.metadata.due, 1);

  for (const [name, content] of Object.entries(before)) {
    const path = name === 'tracker' ? 'applications.md' : name === 'followUps' ? 'follow-ups.md' : 'application-drafts.md';
    assert.equal(readFileSync(join(root, path), 'utf8'), content, `${name} was mutated`);
  }

  const repeat = analyzeFollowupCadence(root, { asOf: '2026-04-08' });
  assert.deepEqual(repeat, result);
  const objectRootResult = analyzeFollowupCadence({ root, asOf: '2026-04-08' });
  assert.deepEqual(objectRootResult, result);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('followup-cadence-core contract: passed');
