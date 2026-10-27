#!/usr/bin/env node

import assert from 'node:assert/strict';
import { assessRequirementEvidence, mapRequirementsToEvidence, recommendApplication } from './requirement-evidence.mjs';

const requirements = [
  { id: 'python', text: 'Python', required: true, weight: 2 },
  { id: 'kubernetes', text: 'Kubernetes', priority: 'preferred' },
];
const evidence = [
  { id: 'cv-python', requirementIds: ['python'], claim: 'Built Python services', source: { ref: 'cv.md#skills' }, verified: true, confidence: 'high' },
  { id: 'draft-k8s', requirementIds: ['kubernetes'], claim: 'Worked near Kubernetes', source: { ref: 'cv.md#platform' }, verified: false, confidence: 'medium' },
];

const original = structuredClone({ requirements, evidence });
const mapped = mapRequirementsToEvidence({ requirements, evidence });
assert.equal(mapped.length, 2);
assert.equal(mapped[0].status, 'supported');
assert.equal(mapped[0].supportingEvidence[0].id, 'cv-python');
assert.equal(mapped[1].status, 'unverified');
assert.deepEqual({ requirements, evidence }, original, 'mapping must not mutate caller data');

const assessment = assessRequirementEvidence({ requirements, evidence });
assert.equal(assessment.evidenceCoverage, 67, 'weighted coverage is machine-readable percentage');
assert.equal(assessment.evidenceCoverageRatio, 0.67);
assert.equal(assessment.confidence, 'high');
assert.deepEqual(assessment.unverifiedRequirements.map((item) => item.id), ['kubernetes']);
assert.deepEqual(assessment.hardBlockers, []);

const investigate = recommendApplication({ assessment, score: 4.5 });
assert.equal(investigate.recommendation, 'investigate');
assert.match(investigate.reasons.join(' '), /coverage|confidence/i);

const blockedAssessment = assessRequirementEvidence({
  requirements,
  evidence: [evidence[1]],
});
const skip = recommendApplication({ assessment: blockedAssessment, score: 4.8 });
assert.equal(skip.recommendation, 'skip');
assert.equal(skip.hardBlockers[0].requirementId, 'python');

const strongAssessment = assessRequirementEvidence({
  requirements: [{ id: 'python', text: 'Python', required: true }],
  evidence: [{ id: 'e1', requirementIds: ['python'], claim: 'Python', source: { ref: 'cv.md#skills' }, verified: true, confidence: 'high' }],
});
const apply = recommendApplication({ assessment: strongAssessment, score: 4.2 });
assert.equal(apply.recommendation, 'apply');
assert.equal(apply.allowed, true);

const lowScore = recommendApplication({ assessment: strongAssessment, score: 3.2 });
assert.equal(lowScore.recommendation, 'skip');
const overridden = recommendApplication({
  assessment: strongAssessment,
  score: 3.2,
  override: { recommendation: 'apply', reason: 'Candidate reviewed the role and accepts the gap.' },
});
assert.equal(overridden.recommendation, 'apply');
assert.equal(overridden.overrideAccepted, true);
assert.equal(overridden.override.reason, 'Candidate reviewed the role and accepts the gap.');

console.log('requirement-evidence: all checks passed');
