#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { chromium } from 'playwright';
import {
  consumeVerifiedDraftSave,
  fillApplicationPage,
  parseAnswerBank,
  saveDraft,
  verifyDraftSaveApproval,
} from './apply-browser.mjs';
import { BrowserCheckpointStore, createBrowserCheckpoint } from './browser-checkpoints.mjs';

const tempDir = mkdtempSync(join(tmpdir(), 'career-ops-apply-fixture-'));
const resumePath = join(tempDir, 'cv-test-candidate-acme-mechanical-engineer-2026-08-11.pdf');
writeFileSync(resumePath, '%PDF-1.4 deterministic fixture');

const profile = {
  candidate: {
    full_name: 'Test Candidate',
    email: 'candidate@example.test',
  },
  address: { city: 'New York' },
};
const answers = parseAnswerBank(`
## Q2 Why this role
This role matches my verified experience and interests.
`);

const applicationFixture = ({ extraFields = '', finalLabel = 'Submit application' } = {}) => `<!doctype html>
  <form id="application">
    <label for="full-name">Full name</label>
    <input id="full-name" name="full-name" required>
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" required>
    <label for="city">City</label>
    <input id="city" name="city">
    <label for="why">Why this role?</label>
    <textarea id="why" name="why"></textarea>
    <label for="resume">Exact resume / CV upload</label>
    <input id="resume" name="resume" type="file" required>
    ${extraFields}
    <button type="button" id="save" onclick="window.saved = true">Save draft</button>
    <button type="submit" id="submit" onclick="window.submitted = true">${finalLabel}</button>
  </form>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(applicationFixture());

  const result = await fillApplicationPage(page, { profile, answers, resumePath });
  assert.equal(await page.locator('#full-name').inputValue(), 'Test Candidate');
  assert.equal(await page.locator('#email').inputValue(), 'candidate@example.test');
  assert.equal(await page.locator('#city').inputValue(), 'New York');
  assert.match(await page.locator('#why').inputValue(), /verified experience/);
  assert.equal(
    await page.locator('#resume').evaluate((input) => input.files[0].name),
    'cv-test-candidate-acme-mechanical-engineer-2026-08-11.pdf',
  );
  assert.deepEqual(result.forbiddenControls, ['Submit application']);
  assert.equal(result.filled.find((entry) => entry.label.includes('resume'))?.action, 'upload');

  const save = await saveDraft(page);
  assert.deepEqual(save, { status: 'clicked', label: 'Save draft' });
  assert.equal(await page.evaluate(() => window.saved), true);
  assert.equal(await page.evaluate(() => window.submitted), undefined);

  await page.setContent(applicationFixture({
    extraFields: '<label for="portfolio">Portfolio URL</label><input id="portfolio" name="portfolio" required>',
    finalLabel: 'Review and Submit',
  }));
  const blocked = await fillApplicationPage(page, { profile, answers, resumePath });
  assert.equal(await page.locator('#portfolio').inputValue(), '');
  assert.ok(blocked.skipped.some((entry) => entry.label.startsWith('Portfolio URL')));
  assert.ok(blocked.blockers.some((message) => message.includes('required field has no approved value: Portfolio URL')));
  const approvalIdentity = {
    company: 'Acme',
    role: 'Mechanical Engineer',
    reportId: 'report-7',
    packetId: 'packet-7',
  };
  const artifactIdentity = { id: 'resume-7', fingerprint: 'sha-7' };
  const approvalRecord = (overrides = {}) => ({
    id: 'approval-7',
    status: 'approved',
    actionType: 'save_draft',
    callerPath: 'apply-browser.main',
    identity: approvalIdentity,
    artifactIdentity,
    sensitiveFields: ['salary', 'work_authorization'],
    sensitiveConfirmations: ['salary', 'work_authorization'],
    expiresAt: '2099-08-11T12:00:00.000Z',
    ...overrides,
  });
  const fakeLedger = (record) => {
    let consumed = false;
    return {
      load: () => ({ approvals: { [record.id]: record } }),
      consume: (id, input) => {
        consumed = true;
        return { id, status: 'consumed', input };
      },
      wasConsumed: () => consumed,
    };
  };

  assert.throws(
    () => verifyDraftSaveApproval({ approvalLedger: fakeLedger(approvalRecord()), identity: approvalIdentity, artifactIdentity }),
    /approval ID is required/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord({ identity: { ...approvalIdentity, packetId: 'wrong-packet' } })),
      identity: approvalIdentity,
      artifactIdentity,
    }),
    /exactly match/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord({ status: 'revoked' })),
      identity: approvalIdentity,
      artifactIdentity,
    }),
    /revoked/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord({ expiresAt: '2026-08-11T09:00:00.000Z' })),
      identity: approvalIdentity,
      artifactIdentity,
      now: '2026-08-11T10:00:00.000Z',
    }),
    /expired/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord({ status: 'requested' })),
      identity: approvalIdentity,
      artifactIdentity,
    }),
    /requested|not ready/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord({ sensitiveConfirmations: ['salary'] })),
      identity: approvalIdentity,
      artifactIdentity,
    }),
    /sensitive-field confirmations/,
  );
  assert.throws(
    () => verifyDraftSaveApproval({
      approvalId: 'approval-7',
      approvalLedger: fakeLedger(approvalRecord()),
      identity: approvalIdentity,
      artifactIdentity,
      packetReview: { ok: false, status: 'blocked' },
    }),
    /readiness/,
  );

  const approvedLedger = fakeLedger(approvalRecord());
  const verifiedApproval = verifyDraftSaveApproval({
    approvalId: 'approval-7',
    approvalLedger: approvedLedger,
    identity: approvalIdentity,
    artifactIdentity,
    packetReview: { ok: true, status: 'ready_for_review' },
  });
  assert.throws(
    () => consumeVerifiedDraftSave({
      approval: verifiedApproval,
      approvalLedger: approvedLedger,
      identity: approvalIdentity,
      artifactIdentity,
      save: { status: 'clicked' },
    }),
    /verified draft-save/,
  );
  const consumed = consumeVerifiedDraftSave({
    approval: verifiedApproval,
    approvalLedger: approvedLedger,
    identity: approvalIdentity,
    artifactIdentity,
    save: { status: 'verified' },
    now: '2026-08-11T10:05:00.000Z',
  });
  assert.equal(consumed.status, 'consumed');
  assert.equal(approvedLedger.wasConsumed(), true);

  const checkpointRoot = mkdtempSync(join(tmpdir(), 'career-ops-apply-checkpoint-'));
  try {
    const store = new BrowserCheckpointStore({ rootPath: checkpointRoot });
    const checkpointInput = {
      callerPath: 'apply-browser.main',
      identity: approvalIdentity,
      artifactIdentity,
      portalUrl: 'https://example.test/application',
      currentStep: 'open',
      saveState: { status: 'verified' },
      fieldState: { filledCount: 3, skippedCount: 1, blockerCount: 0, forbiddenCount: 1 },
    };
    store.save(checkpointInput, { now: '2026-08-11T10:00:00.000Z' });
    const resumed = store.resume(checkpointInput, { now: '2026-08-11T10:01:00.000Z' });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.checkpoint.timestamps.lastResumedAt, '2026-08-11T10:01:00.000Z');
    const invalidated = store.resume({
      ...checkpointInput,
      identity: { ...approvalIdentity, role: 'Principal Engineer' },
    }, { now: '2026-08-11T10:02:00.000Z' });
    assert.equal(invalidated.ok, false);
    assert.equal(invalidated.status, 'invalidated');
    assert.equal(store.load().invalidated, true);
    assert.throws(
      () => createBrowserCheckpoint({ ...checkpointInput, controls: ['Submit application'] }),
      /finalizing control rejected/,
    );
  } finally {
    rmSync(checkpointRoot, { recursive: true, force: true });
  }

  assert.ok(blocked.blockers.some((message) => message.includes('finalizing controls')));

  const saveWithFinalControl = await saveDraft(page);
  assert.deepEqual(saveWithFinalControl, { status: 'clicked', label: 'Save draft' });
  assert.equal(await page.evaluate(() => window.submitted), undefined);

  console.log('apply-browser fixture contract: passed');
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
