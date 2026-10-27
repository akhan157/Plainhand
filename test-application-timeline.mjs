#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ApplicationTimelineInputError,
  buildApplicationTimeline,
} from './application-timeline.mjs';

const readFile = (path) => readFileSync(path, 'utf8');
const root = mkdtempSync(join(tmpdir(), 'career-ops-timeline-'));
try {
  writeFileSync(join(root, 'applications.md'), `# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 2 | 2026-02-02 | Acme | Platform Engineer | 4.5/5 | Applied | resume.pdf | [2](reports/acme.md) | packet complete |\n| 1 | 2026-01-01 | Acme | Platform Engineer | 4.5/5 | Evaluated | resume-old.pdf | [1](reports/old.md) | decided to apply |\n| 3 | 2026-03-01 | Beta | Product Engineer | 3.0/5 | Rejected |  |  | closed |\n`);
  writeFileSync(join(root, 'contacts.md'), `| Company | Role | Name | Email | Type | Notes |\n|---|---|---|---|---|---|\n| Acme | Platform Engineer | Ada Lovelace | ada@example.test | recruiter | warm intro |\n`);
  writeFileSync(join(root, 'follow-ups.md'), `| # | Application | Company | Role | Date | Channel | Contact | Note | Next Date | Next Action |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | 2 | Acme | Platform Engineer | 2026-02-10 | email | Ada | checking in | 2026-02-17 | Ask for interview timing |\n`);
  writeFileSync(join(root, 'application-drafts.md'), `| Updated | Company | Role | Portal | Draft Status | Resume | Referral | Resume URL | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 2026-02-05 | Acme | Platform Engineer | greenhouse | saved_draft | resume.pdf | none | https://example.test/draft | pending review |\n`);
  writeFileSync(join(root, 'interviews.md'), `| Date | Company | Role | Stage | Interviewer | Prep Link | Notes |\n|---|---|---|---|---|---|---|\n| 2026-02-20 | Acme | Platform Engineer | recruiter-screen | Ada | prep.md | confirm scope |\n`);

  const before = {
    tracker: readFile(join(root, 'applications.md')),
    contacts: readFile(join(root, 'contacts.md')),
  };
  const result = buildApplicationTimeline(root);
  assert.deepEqual(result.sources.contacts.status, 'present');
  assert.deepEqual(result.sources.interviews.status, 'present');
  assert.equal(result.sources.followUps.rows, 1);
  assert.equal(result.sources.drafts.rows, 1);
  assert.equal(result.applications.length, 2);

  const acme = result.applications[0];
  assert.equal(acme.company, 'Acme');
  assert.equal(acme.role, 'Platform Engineer');
  assert.equal(acme.currentStatus, 'Applied');
  assert.deepEqual(acme.statusHistory.map((entry) => entry.status), ['Evaluated', 'Applied']);
  assert.deepEqual(acme.statusHistory.map((entry) => entry.date), ['2026-01-01', '2026-02-02']);
  assert.ok(acme.artifacts.some((artifact) => artifact.kind === 'report' && artifact.path === 'reports/acme.md'));
  assert.ok(acme.artifacts.some((artifact) => artifact.kind === 'draft' && artifact.status === 'saved_draft'));
  assert.equal(acme.contacts[0].email, 'ada@example.test');
  assert.equal(acme.interviews[0].stage, 'recruiter-screen');
  assert.equal(acme.followUp.last.contact, 'Ada');
  assert.equal(acme.nextAction, 'Ask for interview timing');

  assert.equal(readFile(join(root, 'applications.md')), before.tracker);
  assert.equal(readFile(join(root, 'contacts.md')), before.contacts);

  const repeat = buildApplicationTimeline(root);
  assert.deepEqual(repeat, result);

  const absentRoot = mkdtempSync(join(tmpdir(), 'career-ops-timeline-absent-'));
  try {
    writeFileSync(join(absentRoot, 'applications.md'), '| Company | Role | Status |\n|---|---|---|\n| Solo | Engineer | Evaluated |\n');
    const absent = buildApplicationTimeline(absentRoot);
    assert.equal(absent.sources.contacts.status, 'absent');
    assert.equal(absent.sources.followUps.status, 'absent');
    assert.deepEqual(absent.applications[0].contacts, []);
  } finally {
    rmSync(absentRoot, { recursive: true, force: true });
  }

  const malformedRoot = mkdtempSync(join(tmpdir(), 'career-ops-timeline-malformed-'));
  try {
    writeFileSync(join(malformedRoot, 'applications.md'), '| Company | Role | Status |\n|---|---|---|\n| Solo | Engineer | Evaluated |\n');
    writeFileSync(join(malformedRoot, 'contacts.md'), 'not a markdown table');
    assert.throws(() => buildApplicationTimeline(malformedRoot), (error) => {
      assert.ok(error instanceof ApplicationTimelineInputError);
      assert.equal(error.source, 'contacts');
      assert.equal(error.required, false);
      return true;
    });
  } finally {
    rmSync(malformedRoot, { recursive: true, force: true });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}


console.log('application-timeline fixture contract: passed');
