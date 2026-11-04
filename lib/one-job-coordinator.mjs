#!/usr/bin/env node

/**
 * Dependency-injected, local-first coordinator for one job.
 *
 * This module is deliberately not a scanner, evaluator, PDF generator, browser,
 * network client, tracker writer, or submitter. Callers provide runtime adapters
 * and explicit results. The only file it writes is an append-only stage journal.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { normalizeJobInput } from './lifecycle-runner.mjs';
import { assessRequirementEvidence, recommendApplication } from './requirement-evidence.mjs';
import { reviewApplicationPacket, slugify } from './application-packet-review.mjs';

export const COORDINATOR_SCHEMA_VERSION = 'career-ops.one-job-coordinator.v1';
export const COORDINATOR_STAGES = Object.freeze([
  'provider',
  'liveness',
  'evaluate',
  'decide',
  'review',
  'track',
]);
export const NO_SUBMISSION_POLICY = Object.freeze({
  submissionPerformed: false,
  submissionAllowed: false,
  masterCvMutated: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requireAbsoluteRoot(root) {
  if (typeof root !== 'string' || !text(root) || !isAbsolute(root)) {
    const error = new TypeError('an explicit absolute root directory is required');
    error.code = 'COORDINATOR_ROOT_REQUIRED';
    throw error;
  }
  return resolve(root);
}

/** Stable identity key. Identity is explicit; this function never parses or guesses it. */
export function exactRoleKey(job) {
  const company = text(job?.company);
  const role = text(job?.role ?? job?.title);
  const companySlug = slugify(company);
  const roleSlug = slugify(role);
  if (!companySlug || !roleSlug) return '';
  return `${companySlug}::${roleSlug}`;
}
export const stableExactRoleKey = exactRoleKey;
export const makeExactRoleKey = exactRoleKey;

function normalizeJob(jobInput) {
  const job = normalizeJobInput(jobInput);
  const key = exactRoleKey(job);
  if (!job.valid || !key) {
    const error = new Error('explicit valid job URL/JD, company, and role are required; identity must not be inferred');
    error.code = 'COORDINATOR_JOB_IDENTITY_REQUIRED';
    error.job = job;
    throw error;
  }
  return job;
}

function stageRecord(stage, status, roleKey, result, detail, error) {
  return {
    schemaVersion: COORDINATOR_SCHEMA_VERSION,
    event: `stage_${status}`,
    stage,
    status,
    roleKey,
    at: new Date().toISOString(),
    ...(result === undefined ? {} : { result: clone(result) }),
    ...(detail ? { detail } : {}),
    ...(error ? { error: clone(error) } : {}),
  };
}

function parseJournal(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && text(record.roleKey)) records.push(record);
    } catch {
      // A truncated final line cannot be used as state and is left untouched.
    }
  }
  return records;
}

export function readStageJournal(journalPath) {
  if (typeof journalPath !== 'string' || !isAbsolute(journalPath)) {
    throw new TypeError('journalPath must be an absolute path');
  }
  return parseJournal(journalPath).map(clone);
}

function appendRecord(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

function latestState(records, roleKey, cacheIdentity) {
  const state = new Map();
  let completedRun;
  for (const record of records) {
    if (record.roleKey !== roleKey || !sameJobIdentity(record.cacheIdentity, cacheIdentity)) continue;
    if (record.event === 'run_completed') completedRun = record;
    if (COORDINATOR_STAGES.includes(record.stage)) {
      const prior = state.get(record.stage) || {};
      state.set(record.stage, { ...prior, ...record });
    }
  }
  return { state, completedRun };
}

function adapterFor(adapters, names) {
  for (const name of names) {
    const value = adapters?.[name];
    if (typeof value === 'function') return value;
    if (value && typeof value === 'object') {
      if (typeof value.run === 'function') return value.run.bind(value);
      if (typeof value.check === 'function') return value.check.bind(value);
      if (typeof value.prepare === 'function') return value.prepare.bind(value);
      if (typeof value.evaluate === 'function') return value.evaluate.bind(value);
      if (typeof value.decide === 'function') return value.decide.bind(value);
      if (typeof value.fetch === 'function') return value.fetch.bind(value);
    }
  }
  return null;
}

function providerAdapter(adapters) {
  const provider = adapters?.provider || adapters?.providerAdapter;
  if (typeof provider === 'function') return { fetch: provider };
  if (provider && typeof provider === 'object') return provider;
  if (typeof adapters?.providerFetch === 'function') {
    return {
      fetch: adapters.providerFetch,
      ...(typeof adapters.providerParse === 'function' ? { parse: adapters.providerParse } : {}),
    };
  }
  return null;
}

function blocker(code, message, stage, result) {
  return {
    ok: false,
    state: 'blocked',
    stage,
    blockers: [{ code, message }],
    ...(result === undefined ? {} : { result: clone(result) }),
  };
}

function passed(result, kind) {
  if (!result || typeof result !== 'object') return false;
  if (result.ok === true || result.valid === true || result.ready === true || result.verified === true) return true;
  const status = text(result.status).toLowerCase();
  if (['passed', 'verified', 'complete', 'completed', 'ready', 'approved', 'reviewed', 'active'].includes(status)) return true;
  if (kind === 'liveness' && result.result === 'active') return true;
  if (kind === 'decision' && result.recommendation === 'apply' && result.allowed !== false) return true;
  return false;
}

function packetIdentityMatches(manifest, job, input = {}) {
  const identity = manifest?.identity || {};
  if (text(identity.company) !== text(job.company)
    || text(identity.role) !== text(job.role)
    || exactRoleKey(identity) !== exactRoleKey(job)) return false;
  const sourceUrl = text(input.job?.url || input.jobInput?.url || input.url);
  if (sourceUrl && text(identity.roleUrl) && text(identity.roleUrl) !== sourceUrl) return false;

  const report = manifest?.report || {};
  const expectedReport = input.reportIdentity || input.report || {};
  const identityInput = input.job || input.jobInput || input;
  const expectedReportId = text(identityInput.reportId || identityInput.report_id || input.reportId || input.report_id || (typeof expectedReport === 'object' ? expectedReport.id || expectedReport.reportId : ''));
  const expectedReportPath = text(identityInput.reportPath || identityInput.report_path || input.reportPath || input.report_path || (typeof expectedReport === 'object' ? expectedReport.path || expectedReport.reportPath : expectedReport));
  if (expectedReportId && text(report.id) !== expectedReportId) return false;
  if (expectedReportPath && text(report.path) !== expectedReportPath) return false;

  const expectedPacketId = text(identityInput.packetId || identityInput.packet_id || input.packetId || input.packet_id || input.packet?.id);
  const actualPacketId = text(manifest.packetId || manifest.packet_id || identity.packetId || manifest.provenance?.packetId);
  if (expectedPacketId && actualPacketId && actualPacketId !== expectedPacketId) return false;
  if (expectedPacketId && !actualPacketId) return false;

  const expectedArtifacts = identityInput.artifactIdentity || identityInput.artifact || input.artifactIdentity || input.artifact || input.artifacts;
  if (expectedArtifacts && typeof expectedArtifacts === 'object' && !Array.isArray(expectedArtifacts)) {
    const actualIdentity = manifest.artifactIdentity || manifest.artifact || {};
    const actualArtifacts = manifest.artifacts || {};
    const flatIdentity = ['id', 'path', 'fingerprint', 'contentFingerprint', 'content_fingerprint'].some((key) => text(expectedArtifacts[key]));
    if (flatIdentity) {
      for (const key of ['id', 'path', 'fingerprint', 'contentFingerprint', 'content_fingerprint']) {
        if (text(expectedArtifacts[key]) && text(actualIdentity[key] || actualArtifacts.resume?.[key] || actualArtifacts.resume?.metadata?.[key]) !== text(expectedArtifacts[key])) return false;
      }
    } else {
      for (const [name, expectedValue] of Object.entries(expectedArtifacts)) {
        const expected = typeof expectedValue === 'string' ? { path: expectedValue } : expectedValue;
        const actual = actualArtifacts[name] || {};
        for (const key of ['id', 'path', 'fingerprint', 'contentFingerprint', 'content_fingerprint']) {
          if (text(expected?.[key]) && text(actual?.[key] || actual.metadata?.[key]) !== text(expected[key])) return false;
        }
      }
    }
  }
  return true;
}

function exactJobIdentity(input, job) {
  const source = typeof input === 'string'
    ? input
    : input?.url ?? input?.jd ?? input?.text ?? input?.input ?? input?.value ?? '';
  return {
    company: text(job.company),
    role: text(job.role),
    sourceType: job.sourceType,
    source: text(job.sourceType === 'url' ? job.url : source),
  };
}

function sameJobIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resultFromInput(input, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) return input[key];
  }
  return undefined;
}

function defaultTrackerAddition({ job, roleKey, evaluation, decision, packet }) {
  const report = packet?.manifest?.report || {};
  const artifacts = packet?.manifest?.artifacts || {};
  const score = decision?.score ?? evaluation?.score ?? evaluation?.assessment?.score ?? '';
  return {
    roleKey,
    company: job.company,
    role: job.role,
    date: new Date().toISOString().slice(0, 10),
    status: 'Evaluated',
    score,
    pdf: artifacts.resume?.path || '',
    report: report.path || '',
    notes: 'Prepared only; no tracker file was modified and no application was submitted.',
    submissionPerformed: false,
  };
}

/**
 * Create a coordinator. Every adapter is optional at construction time so a
 * missing dependency becomes a serializable blocker instead of an invented result.
 */
export function createOneJobCoordinator({ root, journalPath, adapters = {}, ...injectedAdapters } = {}) {
  const effectiveAdapters = { ...injectedAdapters, ...adapters };
  const normalizedRoot = requireAbsoluteRoot(root);
  const normalizedJournal = journalPath
    ? (isAbsolute(journalPath) ? resolve(journalPath) : resolve(normalizedRoot, journalPath))
    : join(normalizedRoot, 'data', 'one-job-coordinator.jsonl');
  const journalRelative = relative(normalizedRoot, normalizedJournal);
  if (!journalRelative || journalRelative.startsWith('..') || isAbsolute(journalRelative)) {
    const error = new TypeError('journalPath must remain under root');
    error.code = 'COORDINATOR_JOURNAL_PATH_INVALID';
    throw error;
  }

  async function run(input = {}) {
    const candidate = input && typeof input === 'object'
      ? (input.job ?? input.jobInput ?? input)
      : input;
    let job;
    try {
      job = normalizeJob(candidate);
    } catch (error) {
      return {
        schemaVersion: COORDINATOR_SCHEMA_VERSION,
        lifecycle: 'career-ops',
        root: normalizedRoot,
        roleKey: '',
        job: clone(error.job || normalizeJobInput(candidate)),
        state: 'blocked',
        stages: Object.fromEntries(COORDINATOR_STAGES.map((stage) => [stage, 'pending'])),
        stageResults: {},
        blockers: [{ code: error.code || 'COORDINATOR_JOB_IDENTITY_REQUIRED', message: error.message }],
        nextAction: 'provide_explicit_company_role_and_job_source',
        ...NO_SUBMISSION_POLICY,
      };
    }
    const roleKey = exactRoleKey(job);
    const cacheIdentity = exactJobIdentity(candidate, job);
    const records = parseJournal(normalizedJournal);
    const prior = latestState(records, roleKey, cacheIdentity);
    const stageResults = {};
    const blockers = [];
    const stages = Object.fromEntries(COORDINATOR_STAGES.map((stage) => [stage, 'pending']));
    const journal = (record) => appendRecord(normalizedJournal, { ...record, cacheIdentity });

    if (prior.completedRun?.result) return clone(prior.completedRun.result);

    const context = Object.freeze({ root: normalizedRoot, job: clone(job), roleKey });
    const execute = async (stage, fn) => {
      const previous = prior.state.get(stage);
      if (previous?.status === 'completed' && previous.result !== undefined) {
        stages[stage] = 'completed';
        stageResults[stage] = clone(previous.result);
        return { ok: true, result: clone(previous.result), resumed: true };
      }
      if (previous?.status === 'blocked') {
        journal(stageRecord(stage, 'retrying', roleKey, previous.result, 'Retrying a previously blocked stage'));
      }
      journal(stageRecord(stage, 'started', roleKey));
      try {
        const result = await fn();
        if (result === undefined || result === null) {
          const failure = blocker(`${stage}_result_required`, `A supplied or injected ${stage} result is required; no result was inferred`, stage);
          stages[stage] = 'blocked';
          blockers.push(...failure.blockers);
          journal(stageRecord(stage, 'blocked', roleKey, undefined, failure.blockers[0].message));
          return failure;
        }
        stageResults[stage] = clone(result);
        stages[stage] = 'completed';
        journal(stageRecord(stage, 'completed', roleKey, result));
        return { ok: true, result: clone(result) };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const failure = blocker(`${stage}_failed`, `${stage} failed: ${detail}`, stage);
        stages[stage] = 'blocked';
        blockers.push(...failure.blockers);
        journal(stageRecord(stage, 'blocked', roleKey, undefined, detail, { name: error?.name, message: detail }));
        return failure;
      }
    };

    const provider = providerAdapter(effectiveAdapters);
    const providerInput = resultFromInput(input, ['providerResult', 'providerOutput']);
    const providerStage = await execute('provider', async () => {
      if (providerInput !== undefined) return providerInput;
      if (!provider || typeof provider.fetch !== 'function') throw new Error('provider adapter with fetch() is required');
      const fetched = await provider.fetch(clone(job), context);
      if (typeof provider.parse === 'function') return provider.parse(fetched, context);
      return fetched;
    });
    if (!providerStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, providerStage);

    const livenessInput = resultFromInput(input, ['livenessResult', 'liveness']);
    const livenessStage = await execute('liveness', async () => {
      if (livenessInput !== undefined) return livenessInput;
      const check = adapterFor(effectiveAdapters, ['liveness', 'livenessAdapter', 'checkLiveness']);
      if (!check) throw new Error('liveness result or injected liveness adapter is required; browser/network are disabled by default');
      return check(clone(job), { ...context, provider: clone(providerStage.result) });
    });
    if (!livenessStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, livenessStage);
    if (!passed(livenessStage.result, 'liveness')) {
      const failure = blocker('liveness_not_active', 'Supplied liveness result is not active; verify the posting before continuing', 'liveness', livenessStage.result);
      blockers.push(...failure.blockers);
      stages.liveness = 'blocked';
      journal(stageRecord('liveness', 'blocked', roleKey, livenessStage.result, failure.blockers[0].message));
      return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, failure);
    }

    const evaluationInput = resultFromInput(input, ['evaluationResult', 'evaluation']);
    const evaluationStage = await execute('evaluate', async () => {
      if (evaluationInput !== undefined) return evaluationInput;
      const evaluate = adapterFor(effectiveAdapters, ['evaluate', 'evaluation', 'evaluationAdapter']);
      if (evaluate) return evaluate({ ...context, provider: clone(providerStage.result), liveness: clone(livenessStage.result), requirements: clone(input.requirements), evidence: clone(input.evidence) });
      if (Array.isArray(input.requirements) && Array.isArray(input.evidence)) {
        return assessRequirementEvidence({ requirements: clone(input.requirements), evidence: clone(input.evidence) });
      }
      throw new Error('evaluation result/adapter or explicit requirements and evidence are required; no evaluator was invented');
    });
    if (!evaluationStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, evaluationStage);
    if (!passed(evaluationStage.result, 'evaluation') && evaluationStage.result.ok !== true) {
      const failure = blocker('evaluation_not_passed', 'Supplied evaluation did not pass its contract; preserve and correct the evaluation', 'evaluate', evaluationStage.result);
      blockers.push(...failure.blockers);
      stages.evaluate = 'blocked';
      journal(stageRecord('evaluate', 'blocked', roleKey, evaluationStage.result, failure.blockers[0].message));
      return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, failure);
    }

    const decisionInput = resultFromInput(input, ['decisionResult', 'decision']);
    const decisionStage = await execute('decide', async () => {
      if (decisionInput !== undefined) return decisionInput;
      const decide = adapterFor(effectiveAdapters, ['decide', 'decision', 'decisionAdapter']);
      if (decide) return decide({ ...context, evaluation: clone(evaluationStage.result) });
      const assessment = evaluationStage.result.assessment || evaluationStage.result.evidenceAssessment || evaluationStage.result;
      if (!assessment || typeof assessment !== 'object') throw new Error('decision result or decision adapter is required; no recommendation was inferred');
      return recommendApplication({ assessment, score: input.score, override: input.override });
    });
    if (!decisionStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, decisionStage);
    if (!passed(decisionStage.result, 'decision')) {
      const failure = blocker('decision_not_authorized', 'Decision did not authorize an application; do not continue to tracker preparation', 'decide', decisionStage.result);
      blockers.push(...failure.blockers);
      stages.decide = 'blocked';
      journal(stageRecord('decide', 'blocked', roleKey, decisionStage.result, failure.blockers[0].message));
      return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, failure);
    }

    const packetInput = resultFromInput(input, ['packetReviewResult', 'packetReview']);
    const packetManifest = input.packetManifest ?? input.packet?.manifest ?? input.packet;
    const reviewStage = await execute('review', async () => {
      if (packetInput !== undefined) return packetInput;
      if (!packetManifest || typeof packetManifest !== 'object') throw new Error('supplied packet manifest or packet review result is required; no PDF/artifact was generated');
      return reviewApplicationPacket({ manifest: clone(packetManifest), claims: clone(input.claims), evidence: clone(input.packetEvidence) });
    });
    if (!reviewStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, reviewStage);
    const packet = reviewStage.result;
    const manifest = packet.manifest || packet.packetManifest || packetInput?.manifest || packetManifest;
    if (!packetIdentityMatches(manifest, job, input)) {
      const failure = blocker('packet_wrong_role', 'Packet manifest identity does not exactly match the explicit company and role', 'review', packet);
      blockers.push(...failure.blockers);
      stages.review = 'blocked';
      journal(stageRecord('review', 'blocked', roleKey, packet, failure.blockers[0].message));
      return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, failure);
    }
    if (packet.ok !== true && !passed(packet, 'review')) {
      const failure = blocker('packet_review_not_passed', 'Supplied packet review is blocked; correct the packet before tracker preparation', 'review', packet);
      blockers.push(...failure.blockers);
      stages.review = 'blocked';
      journal(stageRecord('review', 'blocked', roleKey, packet, failure.blockers[0].message));
      return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, failure);
    }

    const trackerInput = resultFromInput(input, ['trackerAddition', 'trackerResult']);
    const trackStage = await execute('track', async () => {
      if (trackerInput !== undefined) return trackerInput;
      const prepare = adapterFor(effectiveAdapters, ['prepareTrackerAddition', 'tracker', 'trackerAdapter']);
      if (prepare) return prepare({ ...context, provider: clone(providerStage.result), liveness: clone(livenessStage.result), evaluation: clone(evaluationStage.result), decision: clone(decisionStage.result), packet: clone(packet) });
      return defaultTrackerAddition({ job, roleKey, evaluation: evaluationStage.result, decision: decisionStage.result, packet });
    });
    if (!trackStage.ok) return finishBlocked(normalizedRoot, roleKey, job, stages, stageResults, blockers, normalizedJournal, trackStage);

    const result = {
      schemaVersion: COORDINATOR_SCHEMA_VERSION,
      lifecycle: 'career-ops',
      root: normalizedRoot,
      roleKey,
      job: clone(job),
      state: 'ready',
      stages,
      stageResults,
      blockers: [],
      nextAction: 'candidate_must_submit_manually',
      ...NO_SUBMISSION_POLICY,
    };
    journal({
      schemaVersion: COORDINATOR_SCHEMA_VERSION,
      event: 'run_completed',
      roleKey,
      at: new Date().toISOString(),
      result: clone(result),
    });
    return result;
  }

  return Object.freeze({ root: normalizedRoot, journalPath: normalizedJournal, run });
}

function finishBlocked(root, roleKey, job, stages, stageResults, blockers, journalPath, failure) {
  return {
    schemaVersion: COORDINATOR_SCHEMA_VERSION,
    lifecycle: 'career-ops',
    root,
    roleKey,
    job: clone(job),
    state: 'blocked',
    stages,
    stageResults,
    blockers: clone(blockers.length ? blockers : failure.blockers),
    nextAction: `provide_${failure.stage}_dependency`,
    ...NO_SUBMISSION_POLICY,
  };
}

export async function coordinateOneJob(input = {}) {
  const { root, journalPath, adapters, ...runInput } = input;
  return createOneJobCoordinator({ root, journalPath, adapters }).run(runInput);
}
export const runOneJob = coordinateOneJob;
export const coordinateSingleJob = coordinateOneJob;
export default createOneJobCoordinator;
