#!/usr/bin/env node

/**
 * Local-first onboarding planning.
 *
 * This module only prepares a reviewable plan. It never reads file contents and
 * has no write operation. A caller may apply an approved plan separately.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export const ONBOARDING_PLAN_SCHEMA_VERSION = 'career-ops.onboarding-plan.v1';

const CHECKLIST = [
  { id: 'cv', path: 'cv.md', label: 'CV', answerKey: 'cv', owner: 'user', required: true },
  { id: 'profile', path: 'config/profile.yml', label: 'Profile and targeting', answerKey: 'profile', owner: 'user', required: true },
  { id: 'narrative', path: 'modes/_profile.md', label: 'Narrative and proof points', answerKey: 'narrative', owner: 'user', required: true },
  { id: 'portals', path: 'portals.yml', label: 'Job portals', answerKey: 'portals', owner: 'user', required: true },
];

const BY_KEY = new Map(CHECKLIST.flatMap((item) => [
  [item.id, item],
  [item.path, item],
  [item.answerKey, item],
]));
const ALLOWED_PATHS = new Set(CHECKLIST.map(({ path }) => path));
function cloneChecklist() {
  return CHECKLIST.map((item) => ({ ...item }));
}

export function getOnboardingChecklist() {
  return cloneChecklist();
}

export const listOnboardingPrerequisites = getOnboardingChecklist;
export const getPrerequisiteChecklist = getOnboardingChecklist;

function normalizeRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') throw new TypeError('root must be a non-empty path');
  return resolve(root);
}

function answerValue(answer) {
  if (typeof answer === 'string') return answer.trim();
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && typeof answer.value === 'string') {
    return answer.value.trim();
  }
  return '';
}

/** Normalize explicit caller answers without consulting the filesystem. */
export function normalizeOnboardingAnswers(answers = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new TypeError('answers must be an object');
  }
  const unknown = Object.keys(answers).filter((key) => !BY_KEY.has(key));
  if (unknown.length) {
    const field = unknown[0];
    if (field.includes('/') || field.includes('\\') || field.startsWith('.')) {
      throw new Error(`Path is outside the user-layer ownership contract: ${field}`);
    }
    throw new Error(`Unknown onboarding answer field: ${field}`);
  }

  return CHECKLIST.map((item) => {
    const supplied = Object.prototype.hasOwnProperty.call(answers, item.answerKey)
      ? answers[item.answerKey]
      : Object.prototype.hasOwnProperty.call(answers, item.path)
        ? answers[item.path]
        : answers[item.id];
    const value = answerValue(supplied);
    const invalid = supplied !== undefined && value === '';
    return {
      id: item.id,
      path: item.path,
      provided: value.length > 0,
      valid: supplied === undefined || !invalid,
      value,
      valueLength: value.length,
    };
  });
}
export const collectOnboardingAnswers = normalizeOnboardingAnswers;
export const normalizeAnswers = normalizeOnboardingAnswers;

export const ONBOARDING_CHECKLIST = Object.freeze(CHECKLIST.map((item) => Object.freeze({ ...item })));

export function safeOnboardingPatch(input = {}) {
  const plan = input?.schemaVersion === ONBOARDING_PLAN_SCHEMA_VERSION
    ? input
    : buildOnboardingPlan(input);
  return previewOnboardingPatch(plan);
}

export const generateOnboardingPatch = safeOnboardingPatch;
export const generateOnboardingPreview = safeOnboardingPatch;


function safeRelativePath(path) {
  if (typeof path !== 'string' || !ALLOWED_PATHS.has(path) || isAbsolute(path)) return false;
  const normalized = normalize(path).replaceAll(sep, '/');
  return normalized === path && !normalized.startsWith('../') && normalized !== '..';
}

function missingFields(answers, present) {
  return CHECKLIST.filter((item, index) => !present.has(item.path) && (!answers[index].provided || !answers[index].valid)).map((item) => item.id);
}

function buildPatch(answers, present) {
  const writes = answers
    .filter((answer) => answer.provided && answer.valid && !present.has(answer.path))
    .map((answer) => ({
      path: answer.path,
      operation: 'create-user-layer-file',
      contentSource: 'caller-provided-answer',
      contentIncluded: false,
      requiresExplicitCallerApproval: true,
    }));
  return {
    kind: 'preview-only',
    writes,
    writesFiles: false,
    readsFileContents: false,
    apply: 'Caller must explicitly apply approved writes; this module does not write.',
  };
}

/**
 * Build a deterministic plan from caller answers and optional caller-supplied
 * presence metadata. Files are only stat-ed for existence; contents are never read.
 */
export function buildOnboardingPlan({ root = process.cwd(), answers = {}, presentPaths = [] } = {}) {
  const normalizedRoot = normalizeRoot(root);
  if (!Array.isArray(presentPaths)) throw new TypeError('presentPaths must be an array');
  const invalidPaths = presentPaths.filter((path) => !safeRelativePath(path));
  if (invalidPaths.length) throw new Error(`Path is outside the user-layer ownership contract: ${invalidPaths[0]}`);
  const present = new Set(presentPaths);
  const answersList = normalizeOnboardingAnswers(answers);
  // Existence checks reveal only metadata and remain read-only.
  for (const item of CHECKLIST) if (existsSync(join(normalizedRoot, ...item.path.split('/')))) present.add(item.path);

  const missing = missingFields(answersList, present);
  const invalid = answersList.filter((answer) => !answer.valid).map((answer) => answer.id);
  const blockers = [
    ...invalid.map((id) => `Invalid answer: ${id}`),
    ...missing.map((id) => `Missing prerequisite answer or file: ${id}`),
  ];
  const ready = missing.length === 0 && invalid.length === 0;
  return {
    schemaVersion: ONBOARDING_PLAN_SCHEMA_VERSION,
    lifecycle: 'onboarding-plan',
    root: normalizedRoot,
    checklist: getOnboardingChecklist(),
    answers: answersList.map(({ value, ...answer }) => answer),
    presentPaths: CHECKLIST.filter((item) => present.has(item.path)).map((item) => item.path),
    missing,
    invalid,
    blockers,
    state: ready ? 'ready' : 'blocked',
    nextAction: ready ? 'review_and_apply_explicitly' : 'collect_missing_answers',
    patch: buildPatch(answersList, present),
    demoSafe: true,
    mutates: false,
  };
}

export const createOnboardingPlan = buildOnboardingPlan;
export const previewOnboardingPlan = buildOnboardingPlan;

export function previewOnboardingPatch(plan) {
  if (!plan || plan.schemaVersion !== ONBOARDING_PLAN_SCHEMA_VERSION || !plan.patch) {
    throw new TypeError('plan must be an onboarding plan');
  }
  return structuredClone(plan.patch);
}

export function assertUserLayerPath(path) {
  if (!safeRelativePath(path)) throw new Error(`Path is outside the user-layer ownership contract: ${path}`);
  return path;
}
