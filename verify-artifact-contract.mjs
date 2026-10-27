#!/usr/bin/env node

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { candidateSlugFromProfile, runArtifactContractSelfTests, verifyRealArtifacts } from './artifact-contract-verifier.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

function loadYaml(filePath) {
  return yaml.load(readFileSync(filePath, 'utf8'));
}

const PROFILE_PATH = resolve(projectRoot, 'config', 'profile.yml');

function loadProfile() {
  try {
    return loadYaml(PROFILE_PATH);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

const profile = loadProfile();
const checks = runArtifactContractSelfTests();

let errors = 0;

console.log('verify-artifact-contract');
console.log('========================\n');

if (profile === null) {
  console.log('❌ config/profile.yml not found. First run? Copy the example and fill it in:');
  console.log('   cp config/profile.example.yml config/profile.yml');
  errors += 1;
} else {
  const candidate = candidateSlugFromProfile(profile);
  const real = verifyRealArtifacts({ projectRoot, candidate });
  errors = real.errors;
  for (const message of real.messages) {
    console.log(`${message.level === 'pass' ? '✅' : '❌'} ${message.text}`);
  }
}

for (const check of checks) {
  if (check.ok) {
    console.log(`✅ ${check.message}`);
  } else {
    console.log(`❌ ${check.message}`);
    errors += 1;
  }
}

console.log('\n' + '='.repeat(50));
console.log(`Artifact Contract Health: ${errors} errors`);

process.exit(errors > 0 ? 1 : 0);
