#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPacketManifest } from './application-packet-review.mjs';
import { LIFECYCLE_STAGES, runLifecycle } from './lifecycle-runner.mjs';

function completeOnboardingRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-lifecycle-'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'modes'));
  writeFileSync(join(root, 'cv.md'), '# Synthetic CV\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: Synthetic Candidate\n');
  writeFileSync(join(root, 'modes', '_profile.md'), '# Synthetic Profile\n');
  writeFileSync(join(root, 'portals.yml'), 'portals: []\n');
  return root;
}

const validJob = Object.freeze({
  url: 'https://jobs.example.invalid/roles/42',
  company: 'Example Co',
  role: 'Senior Systems Engineer',
});

const lifecycleRequirements = Object.freeze([
  { id: 'python', text: 'Python', required: true },
  { id: 'systems', text: 'Systems design', priority: 'preferred' },
]);
const lifecycleEvidence = Object.freeze([
  { id: 'python-evidence', requirementIds: ['python'], claim: 'Built Python services', source: { ref: 'cv.md#skills' }, verified: true, confidence: 'high' },
  { id: 'systems-evidence', requirementIds: ['systems'], claim: 'Designed distributed systems', source: { ref: 'cv.md#systems' }, verified: true, confidence: 'high' },
]);

function lifecycleFacts(overrides = {}) {
  return {
    requirements: structuredClone(lifecycleRequirements),
    evidence: structuredClone(lifecycleEvidence),
    score: 4.5,
    ...overrides,
  };
}

function validPacket(overrides = {}) {
  const target = {
    company: validJob.company,
    role: validJob.role,
    companySlug: 'example-co',
    roleSlug: 'senior-systems-engineer',
    roleUrl: validJob.url,
  };
  const report = { path: 'reports/42-example-co-senior-systems-engineer.md', id: '42-example-co-senior-systems-engineer' };
  const metadata = (artifactType) => ({
    artifact_type: artifactType,
    candidate: 'candidate',
    company: target.company,
    company_slug: target.companySlug,
    role: target.role,
    role_slug: target.roleSlug,
    artifact_date: '2026-08-11',
    generated_at: '2026-08-11T12:00:00.000Z',
    source_baseline: 'output/Resume-latest.pdf',
    job_source: target.roleUrl,
    job_source_type: 'url',
    report_path: report.path,
    report_id: report.id,
    jd_fingerprint: 'jd-123',
    content_fingerprint: `${artifactType}-123`,
    generator: 'test-fixture',
    generator_version: '1',
    status: 'ready',
    ...(artifactType === 'resume' ? { page_count: 2, template_id: 'test', format: 'pdf' } : {}),
    ...(artifactType === 'cover_letter' ? { variants: ['pdf'] } : {}),
    ...(artifactType === 'answers' ? { answer_sources: ['report Section G'] } : {}),
  });
  const artifacts = {
    resume: { path: 'output/cv-candidate-example-co-senior-systems-engineer-2026-08-11.pdf', metadata: metadata('resume') },
    cover_letter: { path: 'output/cover-letter-candidate-example-co-senior-systems-engineer-2026-08-11.pdf', metadata: metadata('cover_letter') },
    answers: { path: 'output/answers-candidate-example-co-senior-systems-engineer-2026-08-11.md', metadata: metadata('answers') },
  };
  return createPacketManifest({ target, report, artifacts, ...overrides });
}

test('blocks before providers when onboarding is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-lifecycle-missing-'));
  try {
    const result = runLifecycle({ root, job: validJob });
    assert.equal(result.currentStage, 'discover');
    assert.equal(result.nextAction, 'complete_onboarding');
    assert.ok(result.blockerCodes.includes('onboarding_incomplete'));
    assert.equal(result.auditEvents.at(-1).detail, 'Stopped before any provider or browser action');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid job input and does not infer identity', () => {
  const root = completeOnboardingRoot();
  try {
    const result = runLifecycle({ root, job: 'not a URL' });
    assert.equal(result.currentStage, 'discover');
    assert.ok(result.blockerCodes.includes('job_input_invalid'));
    assert.ok(result.blockerCodes.includes('job_identity_required'));
    assert.equal(result.job.company, null);
    assert.equal(result.job.role, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evaluate requires explicit evidence inputs and preserves the assessment gate', () => {
  const root = completeOnboardingRoot();
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      targetStage: 'evaluate',
      results: { verify: { status: 'verified' } },
      requirements: lifecycleRequirements,
    });
    assert.equal(result.currentStage, 'evaluate');
    assert.equal(result.state, 'blocked');
    assert.ok(result.blockerCodes.includes('evidence_inputs_required'));
    assert.equal(result.gateResults.evaluate.status, 'blocked');
    assert.ok(result.gateResults.evaluate.missingInputs.includes('evidence'));
    assert.deepEqual(result.gates, result.gateResults);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evaluate stops on an uncovered hard requirement', () => {
  const root = completeOnboardingRoot();
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      targetStage: 'evaluate',
      results: { verify: { status: 'verified' } },
      requirements: lifecycleRequirements,
      evidence: [{ id: 'unverified', requirementIds: ['python'], source: { ref: 'cv.md#skills' }, verified: false }],
    });
    assert.equal(result.currentStage, 'evaluate');
    assert.ok(result.blockerCodes.includes('requirement_unverified'));
    assert.equal(result.gateResults.evaluate.evidenceAssessment.ok, false);
    assert.equal(result.stages.find(({ stage }) => stage === 'decide').state, 'pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decide preserves investigate recommendation without authorizing apply', () => {
  const root = completeOnboardingRoot();
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      targetStage: 'decide',
      results: { verify: { status: 'verified' } },
      requirements: lifecycleRequirements,
      evidence: [lifecycleEvidence[0]],
      score: 4.5,
    });
    assert.equal(result.currentStage, 'decide');
    assert.equal(result.gateResults.decide.recommendation, 'investigate');
    assert.equal(result.gateResults.decide.applyAuthorized, false);
    assert.ok(result.gateResults.decide.reasons.length > 0);
    assert.ok(result.gateResults.decide.evidenceCoverage < 70);
    assert.ok(result.blockerCodes.includes('application_investigation_required'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review requires and preserves blocking packet checks', () => {
  const root = completeOnboardingRoot();
  const malformedPacket = validPacket({
    artifacts: {
      ...validPacket().artifacts,
      resume: {
        ...validPacket().artifacts.resume,
        metadata: { ...validPacket().artifacts.resume.metadata, role: 'Wrong Role', role_slug: 'wrong-role', artifact_date: '2026-99-99' },
      },
    },
  });
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      targetStage: 'review',
      results: { verify: { status: 'verified' }, tailor: { status: 'ready' } },
      ...lifecycleFacts(),
      packetManifest: malformedPacket,
      claims: [{ id: 'unsupported', text: 'Uncited claim', evidenceIds: [] }],
      packetEvidence: [],
    });
    assert.equal(result.currentStage, 'review');
    assert.equal(result.state, 'blocked');
    assert.ok(result.blockerCodes.includes('wrong_role_or_company'));
    assert.ok(result.blockerCodes.includes('metadata_date_invalid'));
    assert.ok(result.blockerCodes.includes('unsupported_claim'));
    assert.equal(result.gateResults.review.reviewerOutput.checks.length > 0, true);
    assert.equal(result.gateResults.review.packetReview.submissionPerformed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review passes an exact packet and preserves reviewer output', () => {
  const root = completeOnboardingRoot();
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      targetStage: 'review',
      ...lifecycleFacts(),
      packetManifest: validPacket(),
      claims: [{ id: 'claim-1', text: 'Built Python services', evidenceIds: ['python-evidence'] }],
      results: { verify: { status: 'verified' }, tailor: { status: 'ready' } },
      packetEvidence: [{ id: 'python-evidence', source: { ref: 'cv.md#skills' }, verified: true }],
    });
    assert.equal(result.currentStage, 'review');
    assert.equal(result.state, 'ready');
    assert.equal(result.gateResults.review.ok, true);
    assert.equal(result.gateResults.review.reviewerOutput.claims[0].status, 'supported');
    assert.equal(result.gateResults.review.packetReview.preservesMasterCv, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lifecycle gates do not mutate caller-supplied facts', () => {
  const root = completeOnboardingRoot();
  const input = {
    root,
    job: validJob,
    targetStage: 'evaluate',
    results: { verify: { status: 'verified' } },
    ...lifecycleFacts(),
  };
  const original = structuredClone(input);
  try {
    runLifecycle(input);
    assert.deepEqual(input, original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run advances deterministically without claiming runtime work', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-lifecycle-demo-'));
  const job = { jd: 'Own reliable systems, improve delivery, and partner with product teams.', company: 'Demo Co', role: 'Platform Lead' };
  try {
    const first = runLifecycle({ root, job, mode: 'dry-run' });
    const second = runLifecycle({ root, job, mode: 'dry-run' });
    assert.deepEqual(first, second);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(first.currentStage, 'apply');
    assert.deepEqual(first.stages.map(({ stage }) => stage), LIFECYCLE_STAGES);
    assert.ok(first.stages.slice(0, 7).every(({ state }) => state === 'simulated'));
    assert.equal(first.stages[7].state, 'blocked');
    assert.ok(first.blockerCodes.includes('submission_forbidden'));
    assert.ok(first.auditEvents.every(({ detail }) => !detail.includes('generated')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('never crosses the apply boundary even with positive runtime results', () => {
  const root = completeOnboardingRoot();
  const pass = { status: 'verified' };
  try {
    const result = runLifecycle({
      root,
      job: validJob,
      ...lifecycleFacts(),
      packetManifest: validPacket(),
      claims: [{ id: 'claim-1', text: 'Built Python services', evidenceIds: ['python-evidence'] }],
      packetEvidence: [{ id: 'python-evidence', source: { ref: 'cv.md#skills' }, verified: true }],
      results: {
        verify: pass,
        tailor: { status: 'ready' },
        track: { status: 'ready' },
      },
    });
    assert.equal(result.currentStage, 'apply');
    assert.equal(result.submissionAllowed, false);
    assert.deepEqual(result.externalActions, []);
    assert.ok(result.blockerCodes.includes('submission_forbidden'));
    assert.equal(result.stages.find(({ stage }) => stage === 'follow-up').state, 'pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('target stage is a deterministic state-machine checkpoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-lifecycle-target-'));
  try {
    const result = runLifecycle({ root, job: validJob, mode: 'demo', targetStage: 'decide' });
    assert.equal(result.currentStage, 'decide');
    assert.equal(result.state, 'simulated');
    assert.equal(result.nextAction, 'advance_to_tailor');
    assert.deepEqual(result.auditEvents.map(({ id }) => id), ['event-001', 'event-002', 'event-003', 'event-004', 'event-005', 'event-006']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('lifecycle runner focused tests loaded');
