#!/usr/bin/env node

/**
 * Local-first lifecycle preflight for a single Career-Ops job.
 *
 * This module only inspects local onboarding paths and consumes explicit
 * provider/runtime results. It never opens a browser, performs network I/O,
 * writes user-layer files, generates artifacts, or submits an application.
 */
import { resolve } from 'node:path';
import { inspectOnboarding } from './onboarding.mjs';
import { assessRequirementEvidence, recommendApplication } from './requirement-evidence.mjs';
import { reviewApplicationPacket } from './application-packet-review.mjs';

export const LIFECYCLE_SCHEMA_VERSION = 'career-ops.lifecycle.v1';
export const LIFECYCLE_STAGES = Object.freeze([
  'discover',
  'verify',
  'evaluate',
  'decide',
  'tailor',
  'review',
  'track',
  'apply',
  'follow-up',
  'learn',
]);
export const STAGES = LIFECYCLE_STAGES;

export const LIFECYCLE_MODES = Object.freeze(['live', 'demo']);

export const NO_SUBMIT_POLICY = Object.freeze({
  submissionAllowed: false,
  finalizingActions: Object.freeze(['submit', 'apply', 'send', 'finish', 'complete']),
});

const STAGE_ACTIONS = Object.freeze({
  discover: 'provide_valid_job_input',
  verify: 'provide_verification_runtime_result',
  evaluate: 'provide_evaluation_runtime_result',
  decide: 'provide_decision_runtime_result',
  tailor: 'provide_tailoring_runtime_result',
  review: 'provide_review_result',
  track: 'provide_tracker_runtime_result',
  apply: 'candidate_must_submit_manually',
  'follow-up': 'provide_post_application_result',
  learn: 'provide_outcome_feedback',
});
const PASSED_STATUSES = new Set(['passed', 'verified', 'complete', 'completed', 'ready', 'approved', 'reviewed']);
const STAGE_RESULT_KEYS = Object.freeze({
  verify: ['verify', 'verification', 'liveness'],
  evaluate: ['evaluate', 'evaluation'],
  decide: ['decide', 'decision'],
  tailor: ['tailor', 'tailoring', 'artifacts'],
  review: ['review'],
  track: ['track', 'tracking'],
  'follow-up': ['followUp', 'followup', 'follow-up'],
  learn: ['learn', 'learning'],
});

const DEMO_MODES = new Set(['demo', 'dry-run', 'dry_run']);
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export class LifecycleInputError extends Error {
  constructor(message, code = 'LIFECYCLE_INPUT_INVALID') {
    super(message);
    this.name = 'LifecycleInputError';
    this.code = code;
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asMode(input) {
  if (input?.demo === true || input?.dryRun === true) return 'demo';
  const mode = text(input?.mode).toLowerCase();
  return DEMO_MODES.has(mode) ? 'demo' : 'live';
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || !text(root)) {
    throw new LifecycleInputError('an explicit root directory is required', 'LIFECYCLE_ROOT_REQUIRED');
  }
  return resolve(root);
}

function isUrl(value) {
  return URL_PATTERN.test(text(value));
}

function validUrl(value) {
  if (!isUrl(value)) return false;
  try {
    const parsed = new URL(text(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize a URL or pasted JD without retaining JD content in the result.
 * Company and role are intentionally explicit: guessing identity is unsafe.
 */
export function normalizeJobInput(input) {
  const source = typeof input === 'string' ? { value: input } : (input ?? {});
  const rawValue = text(source.value ?? source.input ?? source.url ?? source.jd ?? source.text);
  const explicitJd = source.jd !== undefined || source.text !== undefined;
  const url = text(source.url) || (isUrl(rawValue) ? rawValue : '');
  const jdText = text(source.jd ?? source.text) || (!url ? rawValue : '');
  const sourceType = url ? 'url' : jdText ? 'jd_text' : null;
  const company = text(source.company ?? source.employer ?? source.organization);
  const role = text(source.role ?? source.title ?? source.position);
  const sourceValid = sourceType === 'url'
    ? validUrl(url)
    : sourceType === 'jd_text' && (explicitJd ? jdText.length > 0 : jdText.length >= 20);
  const identityValid = Boolean(company && role);
  const valid = Boolean(sourceValid && identityValid);
  const errors = [];
  if (!sourceType || !sourceValid) errors.push('job_input_invalid');
  if (!identityValid) errors.push('job_identity_required');

  return Object.freeze({
    sourceType,
    url: url || null,
    company: company || null,
    role: role || null,
    identityValid,
    valid,
    errors: Object.freeze(errors),
  });
}

function pickResult(input, stage) {
  const containers = [input.results, input.runtimeResults, input.providerResults, input.runtimeResult, input.providerResult, input.runtime, input.provider];
  const keys = STAGE_RESULT_KEYS[stage] || [];
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const key of keys) {
      if (container[key] !== undefined) return container[key];
    }
  }
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  return null;
}

function resultPassed(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.ok === true || result.valid === true || result.ready === true || result.verified === true) return true;
  const status = text(result.status).toLowerCase();
  return PASSED_STATUSES.has(status);
}

function resultAvailable(result) {
  return Boolean(result && typeof result === 'object' && Object.keys(result).length > 0);
}
function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function runEvidenceGate(config, envelope, entry) {
  const requirementsProvided = Array.isArray(config.requirements) && config.requirements.length > 0;
  const evidenceProvided = Array.isArray(config.evidence) && config.evidence.length > 0;
  const assessment = assessRequirementEvidence({
    requirements: Array.isArray(config.requirements) ? config.requirements : [],
    evidence: Array.isArray(config.evidence) ? config.evidence : [],
  });
  const missingInputs = [];
  if (!requirementsProvided) missingInputs.push('requirements');
  if (!evidenceProvided) missingInputs.push('evidence');
  const gate = {
    ok: missingInputs.length === 0 && assessment.ok,
    status: missingInputs.length || !assessment.ok ? 'blocked' : 'ready',
    inputProvided: { requirements: requirementsProvided, evidence: evidenceProvided },
    missingInputs,
    evidenceAssessment: assessment,
    assessment,
    hardBlockers: assessment.hardBlockers,
  };
  envelope.gateResults.evaluate = gate;
  if (missingInputs.length) {
    entry.state = 'blocked';
    blocker(envelope.blockers, envelope.blockerCodes, 'evidence_inputs_required', 'Provide explicit non-empty requirements and evidence arrays before evaluation');
    envelope.nextAction = STAGE_ACTIONS.evaluate;
    event(envelope.auditEvents, 'evaluate', 'blocked', 'evidence_inputs_required', 'Evidence assessment was not authorized without explicit caller-supplied inputs');
    envelope.state = 'blocked';
    return false;
  }
  if (!assessment.ok) {
    entry.state = 'blocked';
    for (const hardBlocker of assessment.hardBlockers) {
      blocker(envelope.blockers, envelope.blockerCodes, hardBlocker.code, hardBlocker.message);
    }
    envelope.nextAction = STAGE_ACTIONS.evaluate;
    event(envelope.auditEvents, 'evaluate', 'blocked', 'evidence_hard_blocker', 'Verified evidence is required for every hard requirement');
    envelope.state = 'blocked';
    return false;
  }
  entry.state = 'completed';
  event(envelope.auditEvents, 'evaluate', 'completed', 'evidence_assessment_completed', 'Explicit requirements and candidate evidence were assessed locally');
  return true;
}

function runDecisionGate(config, envelope, entry) {
  const assessment = envelope.gateResults.evaluate?.evidenceAssessment;
  const recommendation = recommendApplication({
    assessment,
    score: config.score,
    override: config.override,
  });
  const gate = {
    ...recommendation,
    recommendation: recommendation.recommendation,
    applyAuthorized: recommendation.recommendation === 'apply' && recommendation.allowed === true,
  };
  envelope.gateResults.decide = gate;
  if (recommendation.recommendation !== 'apply') {
    entry.state = 'blocked';
    const code = recommendation.recommendation === 'investigate'
      ? 'application_investigation_required'
      : 'application_not_recommended';
    const message = recommendation.recommendation === 'investigate'
      ? 'Investigate evidence gaps before tailoring or applying; investigate never authorizes apply'
      : 'Application recommendation is skip; do not proceed to tailoring or apply';
    blocker(envelope.blockers, envelope.blockerCodes, code, message);
    envelope.nextAction = STAGE_ACTIONS.decide;
    event(envelope.auditEvents, 'decide', 'blocked', code, recommendation.reasons.join('; '));
    envelope.state = 'blocked';
    return false;
  }
  entry.state = 'completed';
  event(envelope.auditEvents, 'decide', 'completed', 'application_recommendation_computed', 'Explicit score, evidence coverage, and override facts produced an apply recommendation');
  return true;
}

function runPacketGate(config, envelope, entry) {
  const packetPresent = hasOwn(config, 'packetManifest') || hasOwn(config, 'packet');
  const packetValue = hasOwn(config, 'packetManifest') ? config.packetManifest : config.packet;
  const isManifest = packetValue && typeof packetValue === 'object'
    && (packetValue.manifestVersion !== undefined || packetValue.identity || packetValue.artifacts);
  const reviewInput = hasOwn(config, 'packetManifest')
    ? { manifest: packetValue }
    : packetValue?.manifest
      ? { manifest: packetValue.manifest }
      : isManifest
        ? { manifest: packetValue }
        : { ...(packetValue || {}) };
  if (hasOwn(config, 'claims')) reviewInput.claims = config.claims;
  if (hasOwn(config, 'packetEvidence')) reviewInput.evidence = config.packetEvidence;
  const packetReview = reviewApplicationPacket(reviewInput);
  const gate = {
    ...packetReview,
    packetReview,
    packetPresent,
    reviewerOutput: packetReview.reviewerOutput,
    checks: packetReview.checks,
  };
  envelope.gateResults.review = gate;
  if (!packetPresent || !packetReview.ok) {
    entry.state = 'blocked';
    if (!packetPresent) {
      blocker(envelope.blockers, envelope.blockerCodes, 'application_packet_required', 'Provide an explicit packet or packetManifest before review');
    }
    for (const check of packetReview.checks) {
      blocker(envelope.blockers, envelope.blockerCodes, check.code, check.message);
    }
    envelope.nextAction = STAGE_ACTIONS.review;
    event(envelope.auditEvents, 'review', 'blocked', 'application_packet_review_blocked', 'Packet review retained every blocking check and performed no external action');
    envelope.state = 'blocked';
    return false;
  }
  entry.state = 'completed';
  event(envelope.auditEvents, 'review', 'completed', 'application_packet_reviewed', 'Exact-role artifacts and claims passed the local packet reviewer');
  return true;
}


function stageList() {
  return LIFECYCLE_STAGES.map((stage) => ({ stage, state: 'pending' }));
}

function stageAt(stages, stage) {
  return stages.find((entry) => entry.stage === stage);
}

function event(auditEvents, stage, type, code, detail) {
  auditEvents.push({
    id: `event-${String(auditEvents.length + 1).padStart(3, '0')}`,
    stage,
    type,
    code,
    detail,
  });
}

function blocker(blockers, blockerCodes, code, message) {
  if (blockerCodes.includes(code)) return;
  blockerCodes.push(code);
  blockers.push(message);
}

function targetIndex(value) {
  if (value == null || value === '') return LIFECYCLE_STAGES.length - 1;
  const stage = text(value).toLowerCase();
  const index = LIFECYCLE_STAGES.indexOf(stage);
  if (index < 0) throw new LifecycleInputError(`unknown lifecycle stage: ${value}`, 'LIFECYCLE_STAGE_INVALID');
  return index;
}

function baseEnvelope(root, mode, job) {
  const gateResults = {
    evaluate: null,
    decide: null,
    review: null,
  };
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    lifecycle: 'career-ops',
    root,
    mode,
    currentStage: 'discover',
    state: 'blocked',
    blockers: [],
    blockerCodes: [],
    nextAction: STAGE_ACTIONS.discover,
    job,
    onboarding: null,
    stages: stageList(),
    auditEvents: [],
    gateResults,
    gates: gateResults,
    externalActions: [],
    submissionAllowed: false,
  };
}

function finishTarget(envelope, stage, mode, target) {
  if (stage === 'apply') return false;
  if (LIFECYCLE_STAGES.indexOf(stage) >= target) {
    envelope.currentStage = stage;
    envelope.state = mode === 'demo' ? 'simulated' : 'ready';
    envelope.nextAction = stage === 'learn' ? 'await_next_job_or_outcome' : `advance_to_${LIFECYCLE_STAGES[LIFECYCLE_STAGES.indexOf(stage) + 1]}`;
    return true;
  }
  return false;
}

/**
 * Run deterministic local preflight. The object form is preferred:
 * `runLifecycle({ root, job, mode, targetStage, results })`.
 * A `(root, job, options)` form is also accepted for simple integrations.
 */
export function runLifecycle(input, jobInput, options = {}) {
  const config = typeof input === 'string'
    ? { ...options, root: input, job: jobInput }
    : { ...(input || {}) };
  const root = normalizeRoot(config.root);
  const mode = asMode(config);
  const job = normalizeJobInput(config.job ?? config.jobInput ?? config.jobData);
  const envelope = baseEnvelope(root, mode, job);
  const target = targetIndex(config.targetStage ?? config.until ?? config.stage);
  const demo = mode === 'demo';

  event(envelope.auditEvents, 'discover', 'lifecycle_started', 'preflight_local_only', 'No browser, network, or submission action is performed');
  const onboarding = inspectOnboarding(root);
  envelope.onboarding = {
    valid: onboarding.state === 'complete',
    missing: [...onboarding.missing],
    checked: true,
    bypassed: demo && onboarding.state !== 'complete',
  };
  event(envelope.auditEvents, 'discover', 'onboarding_checked', envelope.onboarding.valid ? 'onboarding_ready' : 'onboarding_incomplete', envelope.onboarding.valid ? 'Required onboarding paths are present' : 'Required onboarding paths are missing');

  if (!envelope.onboarding.valid && !demo) {
    stageAt(envelope.stages, 'discover').state = 'blocked';
    blocker(envelope.blockers, envelope.blockerCodes, 'onboarding_incomplete', 'Complete onboarding before running a non-demo lifecycle');
    envelope.nextAction = 'complete_onboarding';
    event(envelope.auditEvents, 'discover', 'blocked', 'onboarding_incomplete', 'Stopped before any provider or browser action');
    return envelope;
  }

  if (!job.valid) {
    stageAt(envelope.stages, 'discover').state = 'blocked';
    for (const code of job.errors) {
      const message = code === 'job_identity_required'
        ? 'Explicit company and role are required; identity must not be guessed'
        : 'Provide a valid HTTP(S) job URL or at least 20 characters of JD text';
      blocker(envelope.blockers, envelope.blockerCodes, code, message);
    }
    envelope.nextAction = STAGE_ACTIONS.discover;
    event(envelope.auditEvents, 'discover', 'blocked', 'job_input_invalid', 'Stopped before any provider or browser action');
    return envelope;
  }

  stageAt(envelope.stages, 'discover').state = demo ? 'simulated' : 'completed';
  event(envelope.auditEvents, 'discover', demo ? 'simulated' : 'completed', 'job_identity_validated', 'Job source and explicit company/role identity validated');
  if (finishTarget(envelope, 'discover', mode, target)) return envelope;

  for (let index = 1; index < LIFECYCLE_STAGES.length; index += 1) {
    const stage = LIFECYCLE_STAGES[index];
    const entry = stageAt(envelope.stages, stage);
    envelope.currentStage = stage;

    if (stage === 'apply') {
      entry.state = 'blocked';
      blocker(envelope.blockers, envelope.blockerCodes, 'submission_forbidden', 'Application submission is never performed by Career-Ops; candidate must submit manually');
      envelope.nextAction = STAGE_ACTIONS.apply;
      event(envelope.auditEvents, stage, 'blocked', 'submission_forbidden', 'Safe boundary reached before any finalizing control');
      envelope.state = 'blocked';
      break;
    }

    if (demo) {
      entry.state = 'simulated';
      event(envelope.auditEvents, stage, 'simulated', 'demo_no_runtime_result', 'Dry-run transition only; no evaluation, artifact, tracker, or outcome result was claimed');
      if (finishTarget(envelope, stage, mode, target)) return envelope;
      continue;
    }

    if (stage === 'evaluate') {
      if (!runEvidenceGate(config, envelope, entry)) break;
      if (finishTarget(envelope, stage, mode, target)) return envelope;
      continue;
    }

    if (stage === 'decide') {
      if (!runDecisionGate(config, envelope, entry)) break;
      if (finishTarget(envelope, stage, mode, target)) return envelope;
      continue;
    }

    if (stage === 'review') {
      if (!runPacketGate(config, envelope, entry)) break;
      if (finishTarget(envelope, stage, mode, target)) return envelope;
      continue;
    }

    const result = pickResult(config, stage);
    if (!resultAvailable(result)) {
      entry.state = 'blocked';
      const code = `${stage.replace('-', '_')}_runtime_result_required`;
      blocker(envelope.blockers, envelope.blockerCodes, code, `A provider/runtime result is required before ${stage}`);
      envelope.nextAction = STAGE_ACTIONS[stage];
      event(envelope.auditEvents, stage, 'blocked', code, 'No external action was attempted and no result was inferred');
      envelope.state = 'blocked';
      break;
    }
    if (!resultPassed(result)) {
      entry.state = 'blocked';
      const code = `${stage.replace('-', '_')}_result_not_passed`;
      blocker(envelope.blockers, envelope.blockerCodes, code, `The supplied ${stage} result did not pass its contract`);
      envelope.nextAction = STAGE_ACTIONS[stage];
      event(envelope.auditEvents, stage, 'blocked', code, 'The supplied result was preserved as evidence but not overridden');
      envelope.state = 'blocked';
      break;
    }
    entry.state = 'completed';
    event(envelope.auditEvents, stage, 'completed', `${stage.replace('-', '_')}_runtime_result_accepted`, 'Explicit provider/runtime result accepted; no action was executed by this module');
    if (finishTarget(envelope, stage, mode, target)) return envelope;
  }

  return envelope;
}

export const runPreflight = runLifecycle;
export const runLifecyclePreflight = runLifecycle;
export const createLifecycleState = runLifecycle;

export default runLifecycle;

function cliArguments(argv) {
  const get = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    root: get('--root'),
    job: {
      url: get('--url'),
      jd: get('--jd'),
      company: get('--company'),
      role: get('--role'),
    },
    mode: argv.includes('--demo') || argv.includes('--dry-run') ? 'demo' : 'live',
    targetStage: get('--until'),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log('Usage: node lifecycle-runner.mjs --root <directory> (--url <url> | --jd <text>) --company <name> --role <role> [--demo] [--until <stage>]');
    } else {
      console.log(JSON.stringify(runLifecycle(cliArguments(process.argv.slice(2))), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code || 'LIFECYCLE_ERROR', message: error.message } }, null, 2));
    process.exitCode = 1;
  }
}
