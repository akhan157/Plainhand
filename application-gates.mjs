/**
 * Pure precondition gates for safe application runs.
 *
 * This module deliberately has no browser or filesystem side effects. Callers
 * provide facts gathered before opening an application form; a run is allowed
 * to open the form only when every gate is passed.
 */

import {
  PRECONDITION_IDS,
  createPrecondition,
  createWorkflowRun,
  withBlocker,
  withPrecondition,
} from './workflow-contract.mjs';

const REQUIRED_PROFILE_FIELDS = Object.freeze([
  ['candidate', 'full_name'],
  ['candidate', 'email'],
]);

const KNOWN_NO_REFERRAL = new Set(['no', 'none', 'no referral', 'not referred', 'n/a']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nestedValue(source, path) {
  return path.reduce((value, key) => value?.[key], source);
}

function asBoolean(value) {
  return value === true || value === false ? value : null;
}

function gate(run, id, outcome, detail, blockers) {
  const result = createPrecondition({ id, outcome, detail, checkedAt: new Date().toISOString() });
  return {
    run: withPrecondition(run, result),
    result,
    blockers,
  };
}

function addBlocker(blockers, code, message, manualAction = null) {
  blockers.push({ code, message, phase: 'precondition', blocking: true, manualAction });
}

/**
 * Evaluate all facts needed before a browser form is opened.
 *
 * Required input facts are intentionally explicit. Missing approval and
 * referral state are blocked rather than interpreted as negative answers.
 * `resumeExists` and `answers` are accepted separately so callers can report
 * missing artifacts without touching the browser.
 */
export function evaluateApplicationGates(input = {}) {
  let run = createWorkflowRun({
    company: input.company,
    role: input.role,
    roleUrl: input.roleUrl || input.url,
    portalFamily: input.portalFamily,
  });
  const blockers = [];
  const results = {};

  const jobLive = asBoolean(input.jobLive);
  let checked = gate(run, 'job_live', jobLive === true ? 'passed' : 'blocked',
    jobLive === true ? 'job liveness was verified before opening the form' : 'job liveness has not been verified', blockers);
  run = checked.run;
  results.job_live = checked.result;
  if (jobLive !== true) addBlocker(blockers, 'job_not_live', 'job liveness must be verified before opening the application form', 'Verify the job URL and retry');

  const company = text(input.company);
  const role = text(input.role);
  const roleUrl = text(input.roleUrl || input.url);
  const identityPassed = Boolean(company && role && roleUrl);
  checked = gate(run, 'identity_unambiguous', identityPassed ? 'passed' : 'blocked',
    identityPassed ? 'company, role, and role URL are present' : 'company, role, and role URL are required', blockers);
  run = checked.run;
  results.identity_unambiguous = checked.result;
  if (!identityPassed) addBlocker(blockers, 'identity_missing', 'company, role, and role URL must be unambiguous', 'Provide the exact company, role, and application URL');

  const approved = asBoolean(input.approved);
  checked = gate(run, 'role_approved', approved === true ? 'passed' : 'blocked',
    approved === true ? 'explicit application approval was provided' : 'explicit application approval is missing', blockers);
  run = checked.run;
  results.role_approved = checked.result;
  if (approved !== true) addBlocker(blockers, 'approval_required', 'explicit approval is required before opening an application form', 'Approve this exact role and retry');

  const trackerReady = asBoolean(input.trackerReady);
  checked = gate(run, 'tracker_ready', trackerReady === true ? 'passed' : 'blocked',
    trackerReady === true ? 'tracker state is ready' : 'tracker state is unknown', blockers);
  run = checked.run;
  results.tracker_ready = checked.result;
  if (trackerReady !== true) addBlocker(blockers, 'tracker_required', 'tracker/referral workflow state must be known before opening the form', 'Create or verify the exact company and role tracker row');

  const referral = text(input.referral);
  const referralKnown = asBoolean(input.referralKnown) === true || Boolean(referral && (KNOWN_NO_REFERRAL.has(referral.toLowerCase()) || referral.length > 0));
  checked = gate(run, 'referral_known', referralKnown ? 'passed' : 'blocked',
    referralKnown ? 'referral state is known' : 'referral state is missing', blockers);
  run = checked.run;
  results.referral_known = checked.result;
  if (!referralKnown) addBlocker(blockers, 'referral_required', 'referral state must be explicit, including an explicit no-referral answer', 'Provide a referrer or declare no referral');

  const profileMissing = !input.profile || typeof input.profile !== 'object'
    ? ['profile']
    : REQUIRED_PROFILE_FIELDS.filter((path) => !text(nestedValue(input.profile, path))).map((path) => path.join('.'));
  const profilePassed = profileMissing.length === 0;
  if (!profilePassed) addBlocker(blockers, 'profile_required', `profile is missing required fields: ${profileMissing.join(', ')}`, 'Complete config/profile.yml before retrying');

  const answers = Array.isArray(input.answers) ? input.answers : [];
  const answersPassed = answers.some((answer) => text(answer?.text));
  if (!answersPassed) addBlocker(blockers, 'answers_required', 'approved answer-bank content is missing', 'Provide data/application-answers.md with at least one approved answer');

  const resumeExists = asBoolean(input.resumeExists);
  const resumePath = text(input.resumePath);
  const resumePassed = Boolean(resumePath) && resumeExists === true;
  if (!resumePassed) addBlocker(blockers, 'resume_required', 'an exact existing tailored resume artifact is required before opening the form', 'Resolve the exact per-role resume artifact');

  const artifactsResolved = resumePassed && input.artifactsResolved !== false;
  checked = gate(run, 'artifacts_resolved', artifactsResolved ? 'passed' : 'blocked',
    artifactsResolved ? 'required application artifacts are resolved' : 'required application artifacts are unresolved', blockers);
  run = checked.run;
  results.artifacts_resolved = checked.result;
  if (!artifactsResolved && !blockers.some(({ code }) => code === 'resume_required')) {
    addBlocker(blockers, 'artifacts_unresolved', 'required application artifacts are unresolved', 'Resolve the exact per-role artifact set');
  }

  const metadataValid = asBoolean(input.artifactMetadataValid);
  const metadataPassed = metadataValid === true;
  checked = gate(run, 'artifact_metadata_valid', metadataPassed ? 'passed' : 'blocked',
    metadataPassed ? 'artifact metadata passed validation' : 'artifact metadata has not passed validation', blockers);
  run = checked.run;
  results.artifact_metadata_valid = checked.result;
  if (!metadataPassed) addBlocker(blockers, 'artifact_metadata_invalid', 'resume artifact metadata must be validated before opening the form', 'Validate the exact role/company artifact metadata');

  // Profile and answer checks are represented as blockers on the stable run
  // shape even though they are inputs to the broader artifact gate contract.
  for (const blocker of blockers) run = withBlocker(run, blocker);

  return {
    ok: blockers.length === 0,
    blockers,
    preconditions: results,
    run,
    missing: {
      profile: profileMissing,
      answers: !answersPassed,
      resume: !resumePassed,
      approval: approved !== true,
      referral: !referralKnown,
    },
    requiredPreconditions: [...PRECONDITION_IDS],
  };
}

export function assertApplicationGates(input = {}) {
  const result = evaluateApplicationGates(input);
  if (result.ok) return result;
  const error = new Error(result.blockers.map(({ message }) => message).join('; '));
  error.code = 'APPLICATION_PRECONDITION_BLOCKED';
  error.blockers = result.blockers;
  error.preconditions = result.preconditions;
  error.run = result.run;
  throw error;
}

// Explicit aliases make the gate contract easy to consume from adapters.
export const evaluatePreconditions = evaluateApplicationGates;
export const assertPreconditions = assertApplicationGates;
