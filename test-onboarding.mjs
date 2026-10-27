#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SAFE_SYSTEM_DIRECTORIES,
  USER_LAYER_PREREQUISITES,
  createDemoFixture,
  inspectOnboarding,
  initializeOnboarding,
  validateOnboarding,
} from './onboarding.mjs';

const modulePath = fileURLToPath(new URL('./onboarding.mjs', import.meta.url));
const node = process.execPath;
const tempRoots = [];
const makeRoot = (prefix) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
};
const runCli = (...args) => JSON.parse(execFileSync(node, [modulePath, ...args], { encoding: 'utf8' }));

try {
  // Inspection is read-only and reports the canonical four prerequisites.
  const virgin = makeRoot('career-ops-onboarding-virgin-');
  const before = readdirSync(virgin);
  const status = inspectOnboarding(virgin);
  assert.equal(status.schemaVersion, 'career-ops.onboarding.v1');
  assert.equal(status.lifecycle, 'onboarding');
  assert.equal(status.state, 'incomplete');
  assert.equal(status.onboardingNeeded, true);
  assert.deepEqual(status.missing, USER_LAYER_PREREQUISITES);
  assert.equal(status.nextAction, 'collect_user_prerequisites');
  assert.equal(status.blockers.length, USER_LAYER_PREREQUISITES.length);
  assert.deepEqual(readdirSync(virgin), before);

  // Init creates only the allow-listed empty directories, never user files.
  const initialized = initializeOnboarding(virgin);
  assert.deepEqual(initialized.createdDirectories, [...SAFE_SYSTEM_DIRECTORIES]);
  for (const directory of SAFE_SYSTEM_DIRECTORIES) {
    assert.equal(statSync(join(virgin, directory)).isDirectory(), true);
  }
  for (const prerequisite of USER_LAYER_PREREQUISITES) {
    assert.equal(existsSync(join(virgin, ...prerequisite.split('/'))), false);
  }
  assert.equal(validateOnboarding(virgin).valid, false);

  // A completed state is valid only after all four user-owned paths exist.
  for (const prerequisite of USER_LAYER_PREREQUISITES) {
    const filePath = join(virgin, ...prerequisite.split('/'));
    const parent = filePath.slice(0, filePath.lastIndexOf('/'));
    mkdirSync(parent, { recursive: true });
    writeFileSync(filePath, 'test fixture marker\n');
  }
  const complete = validateOnboarding(virgin);
  assert.equal(complete.valid, true);
  assert.equal(complete.state, 'complete');
  assert.equal(complete.onboardingNeeded, false);
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.nextAction, 'ready_for_first_job');
  assert.deepEqual(complete.blockers, []);

  // Demo requires an explicit path and creates synthetic content only there.
  const demo = makeRoot('career-ops-onboarding-demo-');
  const demoResult = createDemoFixture(demo);
  assert.equal(demoResult.demo, true);
  assert.equal(demoResult.valid, true);
  assert.deepEqual(demoResult.missing, []);
  assert.ok(demoResult.createdFiles.includes('cv.md'));
  assert.match(readFileSync(join(demo, 'cv.md'), 'utf8'), /Synthetic fixture only/);
  assert.match(readFileSync(join(demo, 'config/profile.yml'), 'utf8'), /example\.invalid/);
  assert.equal(existsSync(join(demo, 'data', 'applications.md')), false);

  // Demo is idempotent for its own fixture and refuses to overwrite user data.
  const secondDemo = createDemoFixture(demo);
  assert.deepEqual(secondDemo.createdFiles, []);
  const conflicting = makeRoot('career-ops-onboarding-conflict-');
  writeFileSync(join(conflicting, 'cv.md'), 'user-owned content\n');
  assert.throws(() => createDemoFixture(conflicting), /Refusing to overwrite/);
  assert.equal(readFileSync(join(conflicting, 'cv.md'), 'utf8'), 'user-owned content\n');

  // CLI always emits the same JSON envelope, including a missing demo path error.
  const cliStatus = runCli('--status', '--root', virgin);
  assert.equal(cliStatus.schemaVersion, status.schemaVersion);
  assert.equal(cliStatus.command, 'status');
  const cliDemo = runCli('--demo', '--output', makeRoot('career-ops-onboarding-cli-demo-'));
  assert.equal(cliDemo.command, 'demo');
  assert.equal(cliDemo.valid, true);
  const missingOutput = spawnCli('--demo');
  assert.equal(missingOutput.status, 2);
  assert.equal(JSON.parse(missingOutput.stdout).state, 'error');
  assert.match(JSON.parse(missingOutput.stdout).blockers[0], /explicit --output/);

  console.log('onboarding contract: passed');
} finally {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
}

function spawnCli(...args) {
  const result = spawnSync(node, [modulePath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status, stdout: result.stdout };
}
