#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildOnboardingPlan,
  getOnboardingChecklist,
  normalizeOnboardingAnswers,
  previewOnboardingPatch,
} from './onboarding-plan.mjs';

const roots = [];
const root = mkdtempSync(join(tmpdir(), 'career-ops-onboarding-plan-'));
roots.push(root);
try {
  const checklist = getOnboardingChecklist();
  assert.deepEqual(checklist.map(({ path }) => path), ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']);
  assert.equal(checklist.every((item) => item.owner === 'user' && item.required), true);

  const normalized = normalizeOnboardingAnswers({ cv: '  CV answer  ', 'config/profile.yml': 'profile' });
  assert.equal(normalized[0].provided, true);
  assert.equal(normalized[0].value, 'CV answer');
  assert.equal(normalized[1].provided, true);
  assert.equal(normalized[2].provided, false);
  assert.throws(() => normalizeOnboardingAnswers({ unexpected: 'x' }), /Unknown onboarding answer/);
  assert.equal(normalizeOnboardingAnswers({ cv: '   ' })[0].valid, false);

  const before = readdirSync(root);
  const blocked = buildOnboardingPlan({ root, answers: { cv: 'CV', profile: 'Profile', narrative: '', portals: 42 } });
  assert.equal(blocked.state, 'blocked');
  assert.deepEqual(blocked.missing, ['narrative', 'portals']);
  assert.deepEqual(blocked.invalid, ['narrative', 'portals']);
  assert.equal(blocked.nextAction, 'collect_missing_answers');
  assert.equal(blocked.mutates, false);
  assert.equal(blocked.patch.writesFiles, false);
  assert.deepEqual(readdirSync(root), before);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'modes'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), 'caller-owned content\n');
  writeFileSync(join(root, 'config/profile.yml'), 'caller-owned content\n');
  writeFileSync(join(root, 'modes/_profile.md'), 'caller-owned content\n');
  writeFileSync(join(root, 'portals.yml'), 'caller-owned content\n');
  const ready = buildOnboardingPlan({ root, answers: {} });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.missing, []);
  assert.deepEqual(ready.patch.writes, []);
  assert.deepEqual(ready, buildOnboardingPlan({ root, answers: {} }));

  assert.throws(() => buildOnboardingPlan({ root, presentPaths: ['../cv.md'] }), /outside the user-layer/);
  assert.throws(() => buildOnboardingPlan({ root, presentPaths: ['data/private.md'] }), /outside the user-layer/);
  assert.deepEqual(previewOnboardingPatch(ready), ready.patch);
  assert.equal(previewOnboardingPatch(ready).writesFiles, false);
} finally {
  for (const path of roots) rmSync(path, { recursive: true, force: true });
}

console.log('onboarding plan tests passed');
