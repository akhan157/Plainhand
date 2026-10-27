#!/usr/bin/env node

import assert from 'node:assert/strict';
import { assertApplicationPacket, createPacketManifest, reviewApplicationPacket } from './application-packet-review.mjs';

const target = { company: 'Acme AI', role: 'Senior AI Engineer', companySlug: 'acme-ai', roleSlug: 'senior-ai-engineer', roleUrl: 'https://jobs.example.test/acme/123' };
const report = { path: 'reports/42-acme-ai-senior-ai-engineer.md', id: '42-acme-ai-senior-ai-engineer' };
const baseMetadata = (artifact_type) => ({
  artifact_type,
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
  status: 'ready',
  page_count: artifact_type === 'resume' ? 2 : undefined,
  template_id: artifact_type === 'resume' ? 'template-test' : undefined,
  format: artifact_type === 'resume' ? 'pdf' : undefined,
  variants: artifact_type === 'cover_letter' ? ['pdf'] : undefined,
  answer_sources: artifact_type === 'answers' ? ['report Section G'] : undefined,
  report_id: report.id,
  jd_fingerprint: 'jd-123',
  content_fingerprint: `${artifact_type}-123`,
  generator: 'test-fixture',
  generator_version: '1',
  report_path: report.path,
  status: 'ready',
});
const artifacts = {
  resume: { path: 'output/cv-candidate-acme-ai-senior-ai-engineer-2026-08-11.pdf', metadataPath: 'output/resume.meta.md', metadata: baseMetadata('resume') },
  cover_letter: { path: 'output/cover-letter-candidate-acme-ai-senior-ai-engineer-2026-08-11.pdf', metadataPath: 'output/cover.meta.md', metadata: baseMetadata('cover_letter') },
  answers: { path: 'output/answers-candidate-acme-ai-senior-ai-engineer-2026-08-11.md', metadataPath: 'output/answers.meta.md', metadata: baseMetadata('answers') },
};

const manifest = createPacketManifest({ target, report, artifacts, sourceBaseline: 'output/Resume-latest.pdf' });
assert.equal(manifest.manifestVersion, 1);
assert.equal(manifest.identity.companySlug, 'acme-ai');
assert.equal(manifest.report.path, report.path);
assert.equal(manifest.artifacts.resume.metadata.report_id, report.id);

const input = structuredClone({ target, report, artifacts });
const reviewed = reviewApplicationPacket({
  manifest,
  claims: [{ id: 'claim-1', text: 'Built Python services', evidenceIds: ['e1'] }],
  evidence: [{ id: 'e1', claim: 'Python services', source: { ref: 'cv.md#skills' }, verified: true }],
});
assert.equal(reviewed.ok, true);
assert.equal(reviewed.status, 'ready_for_review');
assert.equal(reviewed.claims[0].status, 'supported');
assert.equal(reviewed.submissionPerformed, false);
assert.equal(reviewed.preservesMasterCv, true);
assert.deepEqual({ target, report, artifacts }, input, 'review must not mutate caller data');

const unsupported = reviewApplicationPacket({
  manifest,
  claims: [{ id: 'claim-unsupported', text: 'Managed a 100-person team', evidenceIds: [] }],
  evidence: [],
});
assert.equal(unsupported.ok, false);
assert.equal(unsupported.checks.some((check) => check.code === 'unsupported_claim'), true);
assert.equal(unsupported.reviewerOutput.claims[0].status, 'blocked');

const wrongRoleManifest = createPacketManifest({
  target,
  report,
  artifacts: { ...artifacts, resume: { ...artifacts.resume, metadata: { ...artifacts.resume.metadata, role: 'Staff AI Engineer', role_slug: 'staff-ai-engineer' } } },
});
const wrongRole = reviewApplicationPacket({ manifest: wrongRoleManifest });
assert.equal(wrongRole.ok, false);
assert.equal(wrongRole.checks.some((check) => check.code === 'wrong_role_or_company'), true);

const staleManifest = createPacketManifest({
  target,
  report,
  artifacts: { ...artifacts, answers: { ...artifacts.answers, metadata: { ...artifacts.answers.metadata, status: 'stale' } } },
});
const stale = reviewApplicationPacket({ manifest: staleManifest });
assert.equal(stale.checks.some((check) => check.code === 'artifact_not_ready'), true);

const malformedManifest = createPacketManifest({
  target,
  report,
  artifacts: { ...artifacts, resume: { ...artifacts.resume, metadata: { ...artifacts.resume.metadata, artifact_date: '2026-99-99' } } },
});
assert.equal(reviewApplicationPacket({ manifest: malformedManifest }).ok, false);

assert.throws(() => assertApplicationPacket({ manifest: wrongRoleManifest }), (error) => {
  assert.equal(error.code, 'APPLICATION_PACKET_REVIEW_BLOCKED');
  assert.equal(Array.isArray(error.checks), true);
  return true;
});

console.log('application-packet-review: all checks passed');
