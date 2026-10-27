/**
 * System-layer contract for safe, resumable application runs.
 *
 * This module contains no user data, filesystem access, browser operations, or
 * submission behavior. It defines the stable shape shared by the apply engine,
 * portal adapters, and draft/checkpoint reporting.
 */

export const PRECONDITION_IDS = Object.freeze([
  'job_live',
  'identity_unambiguous',
  'role_approved',
  'tracker_ready',
  'referral_known',
  'artifacts_resolved',
  'artifact_metadata_valid',
]);

export const PRECONDITION_OUTCOMES = Object.freeze([
  'passed',
  'blocked',
  'unknown',
]);

export const WORKFLOW_STEPS = Object.freeze([
  'validate',
  'load',
  'resolve',
  'open',
  'inspect',
  'inject',
  'humanize',
  'fill',
  'save',
  'verify_save',
  'pause',
  'report',
  'handoff',
]);

export const STEP_STATES = Object.freeze([
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped',
]);

export const DRAFT_STATUSES = Object.freeze([
  'saved_draft',
  'review_ready',
  'filled_not_saved',
  'blocked_before_save',
  'not_started',
]);

export const BLOCKER_PHASES = Object.freeze([
  'precondition',
  'artifact',
  'portal',
  'field',
  'save',
  'manual_review',
]);

export const HANDOFF_STATES = Object.freeze([
  'not_ready',
  'ready_for_candidate',
  'blocked',
]);

export const SAFE_ACTIONS = Object.freeze([
  'inspect',
  'fill',
  'upload_resume',
  'save_draft',
  'continue_non_final',
  'pause',
  'handoff_review',
]);

const FINALIZATION_ACTIONS = Object.freeze([
  'submit',
  'apply',
  'send',
  'finish',
  'complete',
  'review_and_submit',
]);

export const NO_SUBMIT_INVARIANTS = Object.freeze([
  'The agent may inspect, fill, save, and pause, but never finalize an application.',
  'Any ambiguous or finalizing control is a hard blocker and requires candidate handoff.',
  'The candidate alone may submit, apply, send, finish, or complete the application.',
  'A workflow run must never report Applied before candidate confirmation.',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function assertNonEmpty(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function initialPreconditions() {
  return Object.fromEntries(PRECONDITION_IDS.map((id) => [id, {
    id,
    outcome: 'unknown',
    detail: null,
    checkedAt: null,
  }]));
}

function initialSteps() {
  return Object.fromEntries(WORKFLOW_STEPS.map((id) => [id, {
    id,
    state: 'pending',
    detail: null,
    startedAt: null,
    completedAt: null,
  }]));
}

/**
 * @typedef {object} Precondition
 * @property {string} id
 * @property {'passed'|'blocked'|'unknown'} outcome
 * @property {string|null} detail
 * @property {string|null} checkedAt
 */

/**
 * @typedef {object} WorkflowStep
 * @property {string} id
 * @property {'pending'|'in_progress'|'completed'|'blocked'|'skipped'} state
 * @property {string|null} detail
 * @property {string|null} startedAt
 * @property {string|null} completedAt
 */

/**
 * @typedef {object} WorkflowBlocker
 * @property {string} code
 * @property {string} message
 * @property {'precondition'|'artifact'|'portal'|'field'|'save'|'manual_review'} phase
 * @property {boolean} blocking
 * @property {string|null} manualAction
 */

/**
 * @typedef {object} ResumePairing
 * @property {string} artifactPath
 * @property {string} company
 * @property {string} role
 * @property {string|null} roleUrl
 * @property {string|null} reportPath
 */

/**
 * Create the stable precondition result shape.
 *
 * @param {{id: string, outcome: string, detail?: string, checkedAt?: string}} input
 * @returns {Precondition}
 */
export function createPrecondition(input = {}) {
  const id = assertOneOf(input.id, PRECONDITION_IDS, 'precondition id');
  const outcome = assertOneOf(input.outcome, PRECONDITION_OUTCOMES, 'precondition outcome');
  return {
    id,
    outcome,
    detail: nullableText(input.detail),
    checkedAt: nullableText(input.checkedAt),
  };
}

/**
 * Create a safe application run checkpoint. The returned object contains only
 * operational state; callers must keep PII and reusable answers in user-layer
 * files and must not add them to this object.
 *
 * @param {{company?: string, role?: string, roleUrl?: string, portalFamily?: string}} input
 */
export function createWorkflowRun(input = {}) {
  return {
    contractVersion: 1,
    company: nullableText(input.company),
    role: nullableText(input.role),
    roleUrl: nullableText(input.roleUrl),
    portalFamily: nullableText(input.portalFamily),
    preconditions: initialPreconditions(),
    steps: initialSteps(),
    blockers: [],
    draftStatus: 'not_started',
    resumableUrl: null,
    resumePairing: null,
    handoff: {
      state: 'not_ready',
      reason: null,
      candidateAction: null,
    },
  };
}

function copyRun(run) {
  return {
    ...run,
    preconditions: { ...run.preconditions },
    steps: { ...run.steps },
    blockers: [...run.blockers],
    handoff: { ...run.handoff },
  };
}

/** @param {object} run @param {object} input */
export function withPrecondition(run, input) {
  const next = copyRun(run);
  const result = createPrecondition(input);
  next.preconditions[result.id] = result;
  return next;
}

/**
 * @param {object} run
 * @param {{id: string, state: string, detail?: string, startedAt?: string, completedAt?: string}} input
 */
export function withStep(run, input) {
  const id = assertOneOf(input.id, WORKFLOW_STEPS, 'workflow step id');
  const state = assertOneOf(input.state, STEP_STATES, 'workflow step state');
  const next = copyRun(run);
  next.steps[id] = {
    id,
    state,
    detail: nullableText(input.detail),
    startedAt: nullableText(input.startedAt),
    completedAt: nullableText(input.completedAt),
  };
  return next;
}

/**
 * @param {object} run
 * @param {{code: string, message: string, phase: string, blocking?: boolean, manualAction?: string}} input
 */
export function withBlocker(run, input) {
  const next = copyRun(run);
  const blocker = {
    code: assertNonEmpty(input.code, 'blocker code'),
    message: assertNonEmpty(input.message, 'blocker message'),
    phase: assertOneOf(input.phase, BLOCKER_PHASES, 'blocker phase'),
    blocking: input.blocking !== false,
    manualAction: nullableText(input.manualAction),
  };
  next.blockers.push(blocker);
  return next;
}

/** @param {object} run @param {string} draftStatus */
export function withDraftStatus(run, draftStatus) {
  const next = copyRun(run);
  next.draftStatus = assertOneOf(draftStatus, DRAFT_STATUSES, 'draft status');
  return next;
}

/**
 * Record the exact role/artifact pairing used by the run. A pairing is required
 * before a run can become review-ready.
 *
 * @param {object} run
 * @param {{artifactPath: string, company: string, role: string, roleUrl?: string, reportPath?: string}} input
 */
export function withResumePairing(run, input) {
  const next = copyRun(run);
  next.resumePairing = {
    artifactPath: assertNonEmpty(input.artifactPath, 'resume artifact path'),
    company: assertNonEmpty(input.company, 'resume pairing company'),
    role: assertNonEmpty(input.role, 'resume pairing role'),
    roleUrl: nullableText(input.roleUrl),
    reportPath: nullableText(input.reportPath),
  };
  return next;
}

/** @param {object} run @param {string|null} resumableUrl */
export function withResumableUrl(run, resumableUrl) {
  const next = copyRun(run);
  next.resumableUrl = nullableText(resumableUrl);
  return next;
}

/**
 * Park the run for candidate review. This is the only terminal handoff state
 * exposed by the contract; it never authorizes a submit action.
 *
 * @param {object} run
 * @param {{reason?: string, candidateAction?: string}} input
 */
export function markReviewHandoff(run, input = {}) {
  if (!run.resumePairing) {
    throw new Error('resume pairing is required before candidate review handoff');
  }
  if (!['saved_draft', 'review_ready'].includes(run.draftStatus)) {
    throw new Error('candidate review handoff requires saved_draft or review_ready status');
  }
  const next = copyRun(run);
  next.handoff = {
    state: 'ready_for_candidate',
    reason: nullableText(input.reason) || 'Candidate review required before final submission',
    candidateAction: nullableText(input.candidateAction) || 'Review and submit manually if satisfied',
  };
  return next;
}

/**
 * Reject finalizing controls at the contract boundary. This intentionally
 * catches labels and action identifiers with spaces, dashes, or underscores.
 */
export function assertSafeAction(action) {
  const normalized = text(action).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) throw new Error('action is required');
  if (FINALIZATION_ACTIONS.some((name) => normalized === name || normalized.includes(name))) {
    throw new Error(`unsafe finalizing action rejected: ${action}`);
  }
  if (!SAFE_ACTIONS.includes(normalized)) {
    throw new Error(`unknown action rejected: ${action}`);
  }
  return normalized;
}

/**
 * Return contract violations without mutating the run. This supports callers
 * that need to report blockers instead of throwing while preserving the same
 * required invariants.
 */
export function validateWorkflowRun(run) {
  const errors = [];
  if (run?.contractVersion !== 1) errors.push('unsupported contractVersion');
  for (const id of PRECONDITION_IDS) {
    if (!run?.preconditions?.[id]) errors.push(`missing precondition: ${id}`);
  }
  for (const id of WORKFLOW_STEPS) {
    if (!run?.steps?.[id]) errors.push(`missing workflow step: ${id}`);
  }
  if (!DRAFT_STATUSES.includes(run?.draftStatus)) errors.push('invalid draftStatus');
  if (run?.handoff?.state === 'ready_for_candidate' && !run.resumePairing) {
    errors.push('review handoff requires resumePairing');
  }
  if (run?.handoff?.state === 'ready_for_candidate' && !['saved_draft', 'review_ready'].includes(run.draftStatus)) {
    errors.push('review handoff requires saved_draft or review_ready');
  }
  return errors;
}
