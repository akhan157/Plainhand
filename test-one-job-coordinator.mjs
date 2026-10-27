#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  coordinateOneJob,
  createOneJobCoordinator,
  exactRoleKey,
  readStageJournal,
} from './one-job-coordinator.mjs';
import { createPacketManifest } from './application-packet-review.mjs';

const job = Object.freeze({
  url: 'https://jobs.example.test/42',
  company: 'Example Co',
  role: 'Senior Systems Engineer',
});

function packetManifest(target = job) {
  const companySlug = exactRoleKey(target).split('::')[0];
  const roleSlug = exactRoleKey(target).split('::')[1];
  const report = { path: 'reports/42-example.md', id: '42-example' };
  const metadata = (type) => ({
    artifact_type: type,
    candidate: 'candidate',
    company: target.company,
    company_slug: companySlug,
    role: target.role,
    role_slug: roleSlug,
    artifact_date: '2026-08-11',
    generated_at: '2026-08-11T12:00:00.000Z',
    source_baseline: 'output/Resume-latest.pdf',
    job_source: target.url,
    job_source_type: 'url',
    report_path: report.path,
    report_id: report.id,
    jd_fingerprint: 'jd',
    content_fingerprint: type,
    generator: 'test',
    generator_version: '1',
    status: 'ready',
    ...(type === 'resume' ? { page_count: 1, template_id: 'test', format: 'pdf' } : {}),
    ...(type === 'cover_letter' ? { variants: ['pdf'] } : {}),
    ...(type === 'answers' ? { answer_sources: ['report'] } : {}),
  });
  return createPacketManifest({
    target: { ...target, companySlug, roleSlug, roleUrl: target.url },
    report,
    artifacts: {
      resume: { path: `output/cv-candidate-${companySlug}-${roleSlug}-2026-08-11.pdf`, metadata: metadata('resume') },
      cover_letter: { path: `output/cover-letter-candidate-${companySlug}-${roleSlug}-2026-08-11.pdf`, metadata: metadata('cover_letter') },
      answers: { path: `output/answers-candidate-${companySlug}-${roleSlug}-2026-08-11.md`, metadata: metadata('answers') },
    },
  });
}

function baseAdapters(calls = {}) {
  return {
    provider: {
      async fetch() { calls.fetch = (calls.fetch || 0) + 1; return '<job html>'; },
      parse(raw) { calls.parse = (calls.parse || 0) + 1; return { raw, title: job.role }; },
    },
    liveness: async () => ({ result: 'active', code: 'apply_control_visible' }),
  };
}

function completeInput(overrides = {}) {
  return {
    job,
    evaluationResult: { ok: true, score: 4.5, assessment: { hardBlockers: [], evidenceCoverage: 100, confidence: 'high', unverifiedRequirements: [] } },
    decisionResult: { ok: true, recommendation: 'apply', allowed: true, score: 4.5 },
    packetManifest: packetManifest(),
    ...overrides,
  };
}

function rootFixture() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-'));
  writeFileSync(join(root, 'cv.md'), 'user owned cv\n');
  writeFileSync(join(root, 'portals.yml'), 'user owned portals\n');
  return root;
}

test('injected provider, liveness, supplied gates, and packet review succeed without submission', async () => {
  const root = rootFixture();
  try {
    const calls = {};
    const result = await coordinateOneJob({ root, adapters: baseAdapters(calls), ...completeInput() });
    assert.equal(result.state, 'ready');
    assert.equal(result.roleKey, 'example-co::senior-systems-engineer');
    assert.deepEqual(result.stages, { provider: 'completed', liveness: 'completed', evaluate: 'completed', decide: 'completed', review: 'completed', track: 'completed' });
    assert.equal(calls.fetch, 1);
    assert.equal(calls.parse, 1);
    assert.equal(result.submissionPerformed, false);
    assert.equal(result.masterCvMutated, false);
    assert.equal(result.stageResults.track.company, job.company);
    assert.equal(readStageJournal(join(root, 'data/one-job-coordinator.jsonl')).filter((entry) => entry.event === 'run_completed').length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid identity is blocked without guessing company or role', async () => {
  const root = rootFixture();
  try {
    const result = await coordinateOneJob({ root, adapters: baseAdapters(), job: { url: job.url } });
    assert.equal(result.state, 'blocked');
    assert.equal(result.job.company, null);
    assert.equal(result.job.role, null);
    assert.equal(result.nextAction, 'provide_explicit_company_role_and_job_source');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing provider dependency is an actionable blocker and does not use network/browser defaults', async () => {
  const root = rootFixture();
  try {
    const result = await coordinateOneJob({ root, job });
    assert.equal(result.state, 'blocked');
    assert.equal(result.blockers[0].code, 'provider_failed');
    assert.match(result.blockers[0].message, /provider adapter/);
    assert.deepEqual(Object.keys(result.stageResults), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('liveness failure is preserved and stops downstream stages', async () => {
  const root = rootFixture();
  try {
    const result = await coordinateOneJob({ root, adapters: baseAdapters(), livenessResult: { result: 'expired', code: 'http_gone' }, ...completeInput() });
    assert.equal(result.blockers[0].code, 'liveness_not_active');
    assert.deepEqual(result.stageResults.liveness, { result: 'expired', code: 'http_gone' });
    assert.equal(result.stages.evaluate, 'pending');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('wrong-role packet is blocked even when its own metadata review is valid', async () => {
  const root = rootFixture();
  try {
    const wrong = { ...job, role: 'Principal Researcher' };
    const result = await coordinateOneJob({ root, adapters: baseAdapters(), ...completeInput({ packetManifest: packetManifest(wrong) }) });
    assert.equal(result.blockers[0].code, 'packet_wrong_role');
    assert.equal(result.stageResults.review.manifest.identity.role, wrong.role);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('retry/resume preserves completed results and rerun is idempotent', async () => {
  const root = rootFixture();
  try {
    const calls = {};
    const coordinator = createOneJobCoordinator({ root, adapters: baseAdapters(calls) });
    const first = await coordinator.run({ ...completeInput(), livenessResult: { result: 'expired', code: 'http_gone' } });
    assert.equal(first.state, 'blocked');
    const second = await coordinator.run(completeInput());
    assert.equal(second.state, 'ready');
    assert.equal(calls.fetch, 1);
    const preservedProvider = second.stageResults.provider;
    const third = await coordinator.run(completeInput());
    assert.deepEqual(third, second);
    assert.deepEqual(third.stageResults.provider, preservedProvider);
    const journal = readFileSync(join(root, 'data/one-job-coordinator.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(journal.filter((entry) => entry.event === 'run_completed').length, 1);
    assert.ok(journal.some((entry) => entry.event === 'stage_retrying' && entry.stage === 'liveness'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('custom journal paths stay under root and exact source identity prevents slug-cache reuse', async () => {
  const root = rootFixture();
  try {
    assert.throws(() => createOneJobCoordinator({ root, journalPath: join(root, '..', 'escape.jsonl') }), /journalPath/);
    const calls = {};
    const coordinator = createOneJobCoordinator({ root, adapters: baseAdapters(calls) });
    const first = await coordinator.run(completeInput());
    const distinct = { ...job, company: 'Example-Co', url: 'https://jobs.example.test/43' };
    assert.equal(exactRoleKey(distinct), exactRoleKey(job), 'fixture retains the same slug');
    const second = await coordinator.run(completeInput({ job: distinct, packetManifest: packetManifest(distinct) }));
    assert.equal(first.state, 'ready');
    assert.equal(second.state, 'ready');
    assert.equal(second.job.company, distinct.company);
    assert.equal(calls.fetch, 2, 'same slug does not reuse a different exact company/source result');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('only the coordinator journal is created; user-layer files remain byte-identical', async () => {
  const root = rootFixture();
  try {
    const before = Object.fromEntries(['cv.md', 'portals.yml'].map((name) => [name, readFileSync(join(root, name), 'utf8')]));
    await coordinateOneJob({ root, adapters: baseAdapters(), ...completeInput() });
    assert.deepEqual(Object.fromEntries(['cv.md', 'portals.yml'].map((name) => [name, readFileSync(join(root, name), 'utf8')])), before);
    assert.deepEqual(readdirSync(root).sort(), ['cv.md', 'data', 'portals.yml']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

console.log('one-job coordinator focused tests loaded');
