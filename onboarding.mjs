#!/usr/bin/env node

/**
 * Small, deterministic first-run primitive for career-ops.
 *
 * Status/validate only inspect user-layer prerequisites. Init creates empty
 * runtime directories only. Demo is the sole operation that writes files, and
 * it writes synthetic fixtures only beneath its explicit output path.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

export const ONBOARDING_SCHEMA_VERSION = 'career-ops.onboarding.v1';

// Keep this list aligned with the First Run contract in AGENTS.md and doctor.mjs.
export const USER_LAYER_PREREQUISITES = Object.freeze([
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
]);

// These are empty runtime/artifact directories. No user-layer file is created
// by init, and arbitrary caller-provided directory names are never accepted.
export const SAFE_SYSTEM_DIRECTORIES = Object.freeze([
  'data',
  'output',
  'reports',
]);

const DEMO_FILES = Object.freeze({
  'cv.md': `# Demo Candidate\n\nSynthetic fixture only. No personal data.\n\n## Experience\n- Demonstration project experience for contract tests.\n`,
  'config/profile.yml': `candidate:\n  full_name: Demo Candidate\n  email: demo@example.invalid\nlocation:\n  city: Demo City\n  country: ZZ\ntargets:\n  roles:\n    - Demonstration Role\n  compensation:\n    minimum: 0\n    currency: XXX\n`,
  'modes/_profile.md': `# Demo Candidate Profile\n\nThis synthetic profile exists only to exercise onboarding.\n\n- Target: Demonstration Role\n- Location: Demo City\n- Deal-breakers: None recorded in this fixture\n`,
  'portals.yml': `portals:\n  - name: Demo Portal\n    url: https://demo.example.invalid/jobs\n    enabled: false\n`,
});

const NEXT_ACTION = Object.freeze({
  COLLECT: 'collect_user_prerequisites',
  READY: 'ready_for_first_job',
  FIX: 'fix_onboarding_blockers',
});

function pathExists(root, relativePath) {
  return existsSync(join(root, ...relativePath.split('/')));
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('root must be a non-empty path');
  }
  return resolve(root);
}

function missingForRoot(root) {
  return USER_LAYER_PREREQUISITES.filter((path) => !pathExists(root, path));
}

function blockersFor(missing) {
  return missing.map((path) => `Missing user-layer prerequisite: ${path}`);
}

function envelope({ command, root, missing, createdDirectories = [], extra = {} }) {
  const ready = missing.length === 0;
  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    lifecycle: 'onboarding',
    command,
    root,
    state: ready ? 'complete' : 'incomplete',
    onboardingNeeded: !ready,
    missing: [...missing],
    createdDirectories: [...createdDirectories],
    nextAction: ready ? NEXT_ACTION.READY : NEXT_ACTION.COLLECT,
    blockers: blockersFor(missing),
    ...extra,
  };
}

/** Inspect prerequisite presence without creating or changing anything. */
export function inspectOnboarding(root = PROJECT_ROOT) {
  const normalizedRoot = normalizeRoot(root);
  return envelope({
    command: 'status',
    root: normalizedRoot,
    missing: missingForRoot(normalizedRoot),
  });
}

export const getOnboardingStatus = inspectOnboarding;
export const getOnboardingState = inspectOnboarding;

/** Return the canonical missing-prerequisite list without mutation. */
export const detectMissingPrerequisites = (root = PROJECT_ROOT) =>
  inspectOnboarding(root).missing;

/**
 * Validate all four user-layer prerequisites. Presence follows doctor.mjs
 * semantics: existence is the contract; contents remain user-owned and are
 * never read or modified by validation.
 */
export function validateOnboarding(root = PROJECT_ROOT) {
  const normalizedRoot = normalizeRoot(root);
  const missing = missingForRoot(normalizedRoot);
  return envelope({
    command: 'validate',
    root: normalizedRoot,
    missing,
    extra: { valid: missing.length === 0 },
  });
}

export const validateCompletedOnboarding = validateOnboarding;

function assertNotSymlink(path, label) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to follow symbolic link for ${label}`);
  }
}

/**
 * Create only allow-listed empty runtime directories. Existing files or
 * symbolic links at a directory path are blockers; user-layer prerequisites
 * are never created.
 */
export function ensureSafeSystemDirectories(root = PROJECT_ROOT) {
  const normalizedRoot = normalizeRoot(root);
  const createdDirectories = [];
  assertNotSymlink(normalizedRoot, 'onboarding root');
  mkdirSync(normalizedRoot, { recursive: true });

  for (const relativePath of SAFE_SYSTEM_DIRECTORIES) {
    const directoryPath = join(normalizedRoot, relativePath);
    if (existsSync(directoryPath)) {
      const metadata = lstatSync(directoryPath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Cannot create safe system directory; path is not a directory: ${relativePath}`);
      }
      continue;
    }
    mkdirSync(directoryPath, { recursive: true });
    createdDirectories.push(relativePath);
  }

  return createdDirectories;
}

export const ensureSystemDirectories = ensureSafeSystemDirectories;

export const initializeOnboarding = (root = PROJECT_ROOT) => {
  const normalizedRoot = normalizeRoot(root);
  const createdDirectories = ensureSafeSystemDirectories(normalizedRoot);
  const missing = missingForRoot(normalizedRoot);
  return envelope({
    command: 'init',
    root: normalizedRoot,
    missing,
    createdDirectories,
  });
};

function writeSyntheticFixture(root, relativePath, contents) {
  const filePath = join(root, ...relativePath.split('/'));
  if (existsSync(filePath)) {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite existing path in demo output: ${relativePath}`);
    }
    let existing;
    try {
      existing = readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`Demo fixture path is not readable: ${relativePath}`);
    }
    if (existing !== contents) {
      throw new Error(`Refusing to overwrite existing path in demo output: ${relativePath}`);
    }
    return false;
  }
  const parent = dirname(filePath);
  assertNotSymlink(parent, `demo fixture parent ${relativePath}`);
  mkdirSync(parent, { recursive: true });
  assertNotSymlink(parent, `demo fixture parent ${relativePath}`);
  writeFileSync(filePath, contents, { encoding: 'utf8', flag: 'wx' });
  return true;
}

/** Materialize a personal-data-free fixture beneath an explicit output path. */
export function createDemoFixture(outputPath) {
  const normalizedRoot = normalizeRoot(outputPath);
  const createdDirectories = ensureSafeSystemDirectories(normalizedRoot);
  const createdFiles = [];

  for (const [relativePath, contents] of Object.entries(DEMO_FILES)) {
    if (writeSyntheticFixture(normalizedRoot, relativePath, contents)) {
      createdFiles.push(relativePath);
    }
  }

  const missing = missingForRoot(normalizedRoot);
  return envelope({
    command: 'demo',
    root: normalizedRoot,
    missing,
    createdDirectories,
    extra: {
      demo: true,
      createdFiles,
      fixturePath: normalizedRoot,
      valid: missing.length === 0,
    },
  });
}

export const createDemo = createDemoFixture;

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  return value;
}

function parseCommand(args) {
  const commands = ['--status', '--init', '--validate', '--demo'];
  const selected = commands.filter((command) => args.includes(command));
  if (selected.length > 1) throw new Error('Choose only one of --status, --init, --validate, or --demo');
  if (args.includes('--help')) return 'help';
  return selected[0] ?? '--status';
}

function helpEnvelope() {
  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    lifecycle: 'onboarding',
    command: 'help',
    state: 'complete',
    onboardingNeeded: false,
    missing: [],
    createdDirectories: [],
    nextAction: NEXT_ACTION.READY,
    blockers: [],
    usage: [
      'node onboarding.mjs --status [--root <path>]',
      'node onboarding.mjs --init [--root <path>]',
      'node onboarding.mjs --validate [--root <path>]',
      'node onboarding.mjs --demo --output <explicit-temp-or-output-path>',
    ],
  };
}

export function runCli(args = process.argv.slice(2)) {
  const command = parseCommand(args);
  if (command === 'help') return helpEnvelope();
  const root = valueAfter(args, '--root') ?? valueAfter(args, '--target');

  if (command === '--demo') {
    const outputPath = valueAfter(args, '--output');
    if (!outputPath) throw new Error('--demo requires an explicit --output path');
    return createDemoFixture(outputPath);
  }
  if (args.includes('--output')) throw new Error('--output is supported only with --demo');
  if (command === '--init') return initializeOnboarding(root ?? PROJECT_ROOT);
  if (command === '--validate') return validateOnboarding(root ?? PROJECT_ROOT);
  return inspectOnboarding(root ?? PROJECT_ROOT);
}

function errorEnvelope(error) {
  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    lifecycle: 'onboarding',
    command: 'error',
    state: 'error',
    onboardingNeeded: true,
    missing: [],
    createdDirectories: [],
    nextAction: NEXT_ACTION.FIX,
    blockers: [error instanceof Error ? error.message : String(error)],
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    console.log(JSON.stringify(runCli()));
  } catch (error) {
    console.log(JSON.stringify(errorEnvelope(error)));
    process.exitCode = 2;
  }
}
