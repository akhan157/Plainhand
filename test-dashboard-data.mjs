#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDashboardPayload } from './dashboard-data.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-dashboard-'));
mkdirSync(join(root, 'templates'));
mkdirSync(join(root, 'data'));
try {
  writeFileSync(join(root, 'templates', 'states.yml'), `states:
  - id: apply
    label: Apply
    aliases: [ready]
    description: Ready
  - id: evaluated
    label: Evaluated
    aliases: []
    description: Evaluated
  - id: applied
    label: Applied
    aliases: []
    description: Applied
  - id: interview
    label: Interview
    aliases: []
    description: Interview
`);
  writeFileSync(join(root, 'data', 'applications.md'), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 2 | 2026-02-02 | Acme | Platform Engineer | 4.5/5 | Applied | resume.pdf | [2](reports/acme.md) | packet complete |
| 1 | 2026-01-01 | Acme | Platform Engineer | 4.5/5 | Evaluated | resume-old.pdf | [1](reports/old.md) | decided to apply |
`);
  writeFileSync(join(root, 'contacts.md'), `| Company | Role | Name | Email | Type | Notes |
|---|---|---|---|---|---|
| Acme | Platform Engineer | Ada Lovelace | ada@example.test | recruiter | warm intro |
`);
  writeFileSync(join(root, 'follow-ups.md'), `| Application | Company | Role | Date | Channel | Contact | Note | Next Date | Next Action |
|---|---|---|---|---|---|---|---|---|
| 2 | Acme | Platform Engineer | 2026-02-10 | email | Ada | checking in | 2026-02-17 | Ask for interview timing |
`);
  writeFileSync(join(root, 'application-drafts.md'), `| Updated | Company | Role | Draft Status | Resume |
|---|---|---|---|---|
| 2026-02-05 | Acme | Platform Engineer | saved_draft | resume.pdf |
`);
  writeFileSync(join(root, 'interviews.md'), `| Date | Company | Role | Stage | Interviewer | Prep Link |
|---|---|---|---|---|---|
| 2026-02-20 | Acme | Platform Engineer | recruiter-screen | Ada | prep.md |
`);

  const payload = await buildDashboardPayload({ rootPath: root, asOf: '2026-02-17' });
  assert.equal(payload.apps.length, 2, 'existing dashboard rows remain intact');
  assert.equal(payload.workflow.contractVersion, 1);
  assert.equal(payload.workflow.asOf, '2026-02-17');
  assert.equal(payload.workflow.health.applications, 1);
  assert.equal(payload.workflow.health.due, 1);
  assert.equal(payload.workflow.followUpQueue[0].items[0].classification, 'due');
  assert.equal(payload.workflow.availability.followUps.available, true);
  assert.deepEqual(payload.timelineSources, {
    tracker: { status: 'present', rows: 2 },
    contacts: { status: 'present', rows: 1 },
    followUps: { status: 'present', rows: 1 },
    drafts: { status: 'present', rows: 1 },
    interviews: { status: 'present', rows: 1 },
  });
  const current = payload.apps.find((app) => app.id === 2);
  assert.equal(current.timeline.currentStatus, 'Applied');
  assert.deepEqual(current.timeline.statusHistory.map((entry) => entry.status), ['Evaluated', 'Applied']);
  assert.ok(current.timeline.artifacts.some((artifact) => artifact.kind === 'draft'));
  assert.equal(current.timeline.contacts[0].email, 'ada@example.test');
  assert.equal(current.timeline.interviews[0].stage, 'recruiter-screen');
  assert.equal(current.timeline.nextAction, 'Ask for interview timing');
  assert.equal(current.timeline.artifacts.find((artifact) => artifact.kind === 'report').url, '/file/reports/acme.md');
  assert.equal(current.timeline.followUp.last.contact, 'Ada');
  const absentRoot = mkdtempSync(join(tmpdir(), 'career-ops-dashboard-absent-'));
  try {
    mkdirSync(join(absentRoot, 'templates'));
    mkdirSync(join(absentRoot, 'data'));
    writeFileSync(join(absentRoot, 'templates', 'states.yml'), `states:
  - id: evaluated
    label: Evaluated
    aliases: []
    description: Evaluated
`);
    writeFileSync(join(absentRoot, 'data', 'applications.md'), '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-01 | Solo | Engineer | 4.0/5 | Evaluated |  |  |  |\n');
    const absent = await buildDashboardPayload({ rootPath: absentRoot });
    assert.equal(absent.timelineSources.contacts.status, 'absent');
    assert.equal(absent.workflow.availability.contacts.available, false);
    assert.equal(absent.workflow.availability.followUps.available, false);
    assert.deepEqual(absent.workflow.followUpQueue, []);
    assert.deepEqual(absent.apps[0].timeline.contacts, []);
    assert.deepEqual(absent.apps[0].timeline.followUp.history, []);
  } finally {
    rmSync(absentRoot, { recursive: true, force: true });
  }
  const emptyRoot = mkdtempSync(join(tmpdir(), 'career-ops-dashboard-empty-'));
  try {
    mkdirSync(join(emptyRoot, 'templates'));
    writeFileSync(join(emptyRoot, 'templates', 'states.yml'), `states:
  - id: evaluated
    label: Evaluated
    aliases: []
    description: Evaluated
`);
    const empty = await buildDashboardPayload({ rootPath: emptyRoot });
    assert.deepEqual(empty.apps, []);
    assert.equal(empty.timelineSources.tracker.status, 'absent');
    assert.equal(empty.timelineSources.contacts.status, 'absent');
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('dashboard timeline projection fixture contract: passed');
