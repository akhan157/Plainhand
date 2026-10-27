#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createPacketManifest } from './application-packet-review.mjs';
import { exactRoleKey } from './one-job-coordinator.mjs';
import { createOneJobRunner } from './one-job-runner.mjs';

const job = Object.freeze({
  url: 'https://jobs.example.test/42',
  company: 'Example Co',
  role: 'Senior Systems Engineer',
});

function manifest() {
  const [companySlug, roleSlug] = exactRoleKey(job).split('::');
  const report = { path: 'reports/42-example.md', id: '42-example' };
  const metadata = (type) => ({
    artifact_type: type,
    candidate: 'candidate',
    company: job.company,
    company_slug: companySlug,
    role: job.role,
    role_slug: roleSlug,
    artifact_date: '2026-08-11',
    generated_at: '2026-08-11T12:00:00.000Z',
    source_baseline: 'output/Resume-latest.pdf',
    job_source: job.url,
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
    target: { ...job, companySlug, roleSlug, roleUrl: job.url },
    report,
    artifacts: {
      resume: { path: `output/cv-candidate-${companySlug}-${roleSlug}-2026-08-11.pdf`, metadata: metadata('resume') },
      cover_letter: { path: `output/cover-letter-candidate-${companySlug}-${roleSlug}-2026-08-11.pdf`, metadata: metadata('cover_letter') },
      answers: { path: `output/answers-candidate-${companySlug}-${roleSlug}-2026-08-11.md`, metadata: metadata('answers') },
    },
  });
}

function completeInput() {
  return {
    job,
    providerResult: { ok: true, source: 'fixture' },
    livenessResult: { result: 'active', ok: true },
    evaluationResult: { ok: true, score: 4.5, assessment: { hardBlockers: [], evidenceCoverage: 100 } },
    decisionResult: { ok: true, recommendation: 'apply', allowed: true, score: 4.5 },
    tailorResult: { ok: true, status: 'ready', artifactPaths: ['output/cv.pdf'] },
    packetManifest: manifest(),
  };
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-runner-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), 'canonical tracker before\n');
  writeFileSync(join(root, 'master-cv.md'), 'user-owned master CV\n');
  return root;
}

test('stages a nine-column TSV without mutating canonical or user-layer files', async () => {
  const root = fixtureRoot();
  try {
    const canonicalPath = join(root, 'data/applications.md');
    const beforeCanonical = readFileSync(canonicalPath);
    const calls = { tracker: 0 };
    const runner = createOneJobRunner({
      root,
      adapters: {
        prepareTrackerAddition(context) {
          calls.tracker += 1;
          assert.equal(context.tailor.status, 'ready');
          return { num: 42, status: 'Evaluated', notes: 'Fixture evaluation.' };
        },
      },
    });
    const first = await runner.run({ ...completeInput(), runDate: '2026-08-11' });
    assert.equal(first.state, 'ready');
    assert.equal(first.submissionPerformed, false);
    assert.equal(first.submissionAllowed, false);
    assert.equal(first.masterCvMutated, false);
    const staged = readFileSync(first.stagedTrackerAddition.path, 'utf8');
    assert.equal(staged.trim().split('\t').length, 9);
    assert.match(staged, /\[42\]\(reports\/42-example\.md\)/);
    assert.match(staged, /Prepared only; no tracker file was modified and no application was submitted\./);
    assert.equal(calls.tracker, 1);
    assert.deepEqual(readFileSync(canonicalPath), beforeCanonical);
    assert.deepEqual(readdirSync(root).sort(), ['batch', 'data', 'master-cv.md']);

    const second = await runner.run({ ...completeInput(), runDate: '2026-08-12' });
    assert.deepEqual(second, first);
    assert.equal(calls.tracker, 1, 'completed run resumes without invoking adapters');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks clearly when provider or tailor adapters/results are absent', async () => {
  const root = fixtureRoot();
  try {
    const runner = createOneJobRunner({ root });
    const noProvider = await runner.run({ job });
    assert.equal(noProvider.state, 'blocked');
    assert.equal(noProvider.blockers[0].code, 'provider_adapter_required');

    const noTailor = await runner.run({
      ...completeInput(),
      tailorResult: undefined,
    });
    assert.equal(noTailor.state, 'blocked');
    assert.equal(noTailor.blockers[0].code, 'tailor_adapter_required');
    assert.equal(readdirSync(root).includes('batch'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('one-job runner focused tests loaded');
