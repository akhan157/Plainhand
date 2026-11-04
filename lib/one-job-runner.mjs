#!/usr/bin/env node

/**
 * Safe system-layer bridge for the first live one-job integration wave.
 *
 * This module only consumes explicit runtime results or caller-supplied
 * adapters. It delegates provider/liveness/evaluation/decision/review/track
 * gates to one-job-coordinator, then writes a staged tracker addition and a
 * JSONL journal below the caller's absolute root. It never writes the
 * canonical applications tracker, user-layer files, artifacts, or submits.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { normalizeJobInput } from './lifecycle-runner.mjs';
import {
  COORDINATOR_SCHEMA_VERSION,
  NO_SUBMISSION_POLICY,
  createOneJobCoordinator,
  exactRoleKey,
} from './one-job-coordinator.mjs';

export const RUNNER_SCHEMA_VERSION = 'career-ops.one-job-runner.v1';
export const TRACKER_ADDITION_COLUMNS = Object.freeze([
  'num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes',
]);
const SAFE_NOTE = 'Prepared only; no tracker file was modified and no application was submitted.';
const PASS_STATUSES = new Set(['passed', 'verified', 'complete', 'completed', 'ready', 'approved', 'reviewed', 'active']);

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
    error.code = 'ONE_JOB_RUNNER_ROOT_REQUIRED';
    throw error;
  }
  return resolve(root);
}

function underRoot(root, candidate, label) {
  const normalized = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const rel = relative(root, normalized);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    const error = new TypeError(`${label} must remain under root`);
    error.code = 'ONE_JOB_RUNNER_PATH_INVALID';
    throw error;
  }
  return normalized;
}

function readJournal(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      const item = JSON.parse(line);
      return item && typeof item === 'object' ? [item] : [];
    } catch {
      return [];
    }
  });
}

function appendJournal(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function resultInput(input, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) return input[key];
  }
  return undefined;
}

function adapterFor(adapters, names) {
  for (const name of names) {
    const candidate = adapters?.[name];
    if (typeof candidate === 'function') return candidate;
    if (candidate && typeof candidate === 'object') {
      for (const method of ['run', 'prepare', 'review', 'tailor', 'fetch', 'evaluate', 'decide', 'check']) {
        if (typeof candidate[method] === 'function') return candidate[method].bind(candidate);
      }
    }
  }
  return null;
}

function providerAvailable(adapters) {
  const value = adapters?.provider || adapters?.providerAdapter;
  return typeof value === 'function' || Boolean(value && typeof value.fetch === 'function')
    || typeof adapters?.providerFetch === 'function';
}

function passed(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.ok === true || result.valid === true || result.ready === true || result.verified === true) return true;
  return PASS_STATUSES.has(text(result.status).toLowerCase());
}

function blocker(code, message, stage, extra = {}) {
  return {
    ok: false,
    schemaVersion: RUNNER_SCHEMA_VERSION,
    lifecycle: 'career-ops',
    state: 'blocked',
    stage,
    blockers: [{ code, message, stage }],
    nextAction: `provide_${stage}_dependency`,
    ...NO_SUBMISSION_POLICY,
    ...extra,
  };
}

function jobIdentity(job, sourceInput) {
  const source = typeof sourceInput === 'string'
    ? sourceInput
    : sourceInput?.url ?? sourceInput?.jd ?? sourceInput?.text ?? sourceInput?.input ?? sourceInput?.value ?? '';
  return {
    company: text(job.company),
    role: text(job.role),
    sourceType: job.sourceType,
    source: text(job.sourceType === 'url' ? job.url : source),
  };
}

function normalizeDate(value) {
  const date = text(value);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return date;
  return new Date().toISOString().slice(0, 10);
}

function packetManifest(packetResult, input) {
  return packetResult?.manifest
    || packetResult?.packetManifest
    || input.packetManifest
    || input.packet?.manifest
    || (input.packet && typeof input.packet === 'object' ? input.packet : null);
}

function reportPathFromManifest(manifest) {
  const raw = text(manifest?.report?.path || manifest?.report?.reportPath);
  if (!raw) return '';
  const match = raw.match(/^(?:\.\.\/)*(reports\/[^?#]+)$/);
  return match ? match[1] : '';
}

function reportNumber(manifest, addition) {
  const explicit = addition?.num ?? addition?.number ?? addition?.entryNum;
  if (Number.isInteger(explicit) && explicit > 0) return String(explicit);
  const id = text(manifest?.report?.id);
  const idMatch = id.match(/^(\d+)/);
  if (idMatch) return String(Number(idMatch[1]));
  const pathMatch = reportPathFromManifest(manifest).match(/^reports\/(\d+)/);
  return pathMatch ? String(Number(pathMatch[1])) : '';
}

function safeField(value, field) {
  const normalized = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!normalized) return '';
  return normalized;
}

function scoreValue(addition, decision, evaluation) {
  const value = addition?.score ?? decision?.score ?? evaluation?.score ?? evaluation?.assessment?.score;
  if (value === undefined || value === null || value === '') return 'N/A';
  const clean = safeField(value, 'score');
  return /\/5$/.test(clean) || clean === 'N/A' ? clean : `${clean}/5`;
}

function buildTrackerTsv({ job, packet, evaluation, decision, trackerAddition, runDate }) {
  const manifest = packet?.manifest || packet?.packetManifest || {};
  const reportPath = reportPathFromManifest(manifest);
  const number = reportNumber(manifest, trackerAddition);
  if (!reportPath) return { error: blocker('tracker_report_link_required', 'Packet review must provide a root-relative reports/... path for the staged tracker link', 'track') };
  if (!number) return { error: blocker('tracker_report_number_required', 'Packet report id or tracker addition number must begin with a positive integer', 'track') };

  const suppliedNotes = safeField(trackerAddition?.notes, 'notes');
  const notes = suppliedNotes ? `${suppliedNotes} ${SAFE_NOTE}` : SAFE_NOTE;
  const resumePath = text(manifest.artifacts?.resume?.path || trackerAddition?.pdf) || '❌';
  const status = safeField(trackerAddition?.status || 'Evaluated', 'status') || 'Evaluated';
  const fields = [
    number,
    safeField(trackerAddition?.date || runDate, 'date'),
    safeField(job.company, 'company'),
    safeField(job.role, 'role'),
    status,
    scoreValue(trackerAddition, decision, evaluation),
    safeField(resumePath, 'pdf'),
    `[${safeField(number, 'report number')}](${reportPath})`,
    notes,
  ];
  if (fields.length !== TRACKER_ADDITION_COLUMNS.length || fields.some((field) => !field)) {
    return { error: blocker('tracker_addition_invalid', 'Tracker preparation did not produce all nine non-empty TSV columns', 'track') };
  }
  return { fields, content: `${fields.join('\t')}\n`, reportPath, number };
}

function withMetadata(result, { root, journalPath, roleKey, runId, stages, stageResults, blockers = [] }) {
  return {
    ...clone(result),
    schemaVersion: RUNNER_SCHEMA_VERSION,
    coordinatorSchemaVersion: COORDINATOR_SCHEMA_VERSION,
    journalPath,
    roleKey,
    runId,
    stages,
    stageResults,
    blockers: clone(blockers),
    ...NO_SUBMISSION_POLICY,
  };
}

/**
 * Create a safe bridge around one-job-coordinator. The coordinator factory is
 * injectable for focused tests but defaults to the existing system module.
 */
export function createOneJobRunner({
  root,
  journalPath,
  stagingDir,
  adapters = {},
  coordinatorFactory = createOneJobCoordinator,
  ...injectedAdapters
} = {}) {
  const normalizedRoot = requireAbsoluteRoot(root);
  const effectiveAdapters = { ...injectedAdapters, ...adapters };
  const normalizedJournal = underRoot(normalizedRoot, journalPath || join('data', 'one-job-runner.jsonl'), 'journalPath');
  const normalizedStaging = underRoot(normalizedRoot, stagingDir || join('batch', 'tracker-additions'), 'stagingDir');

  async function run(input = {}) {
    const config = input && typeof input === 'object' ? input : {};
    const candidate = config.job ?? config.jobInput ?? config;
    const job = normalizeJobInput(candidate);
    const roleKey = exactRoleKey(job);
    const identity = jobIdentity(job, candidate);
    const runId = `${roleKey || 'invalid'}-${hash(identity).slice(0, 16)}`;
    const common = { root: normalizedRoot, journalPath: normalizedJournal, roleKey, runId };
    const explicitSource = config.job && (config.url ?? config.jd ?? config.text);
    if (explicitSource !== undefined) {
      const normalizedExplicitSource = text(explicitSource);
      const normalizedJobSource = text(job.sourceType === 'url' ? job.url : candidate.jd ?? candidate.text);
      if (normalizedExplicitSource && normalizedJobSource && normalizedExplicitSource !== normalizedJobSource) {
        return blocker('job_identity_mismatch', 'Job source fields disagree; provide one exact URL/JD source for the explicit company and role', 'discover', {
          ...common,
          job: clone(job),
        });
      }
    }

    if (!job.valid || !roleKey) {
      return blocker('job_identity_required', 'Explicit valid job URL/JD, company, and role are required; identity must not be inferred', 'discover', {
        ...common,
        job: clone(job),
        stages: { provider: 'pending', liveness: 'pending', evaluate: 'pending', decide: 'pending', tailor: 'pending', review: 'pending', track: 'pending' },
        stageResults: {},
      });
    }

    const records = readJournal(normalizedJournal);
    const priorCompleted = [...records].reverse().find((record) => record.event === 'runner_completed' && record.runId === runId);
    if (priorCompleted?.result?.stagedTrackerAddition?.path && existsSync(priorCompleted.result.stagedTrackerAddition.path)) {
      return clone(priorCompleted.result);
    }
    if (!records.some((record) => record.event === 'runner_started' && record.runId === runId)) {
      appendJournal(normalizedJournal, {
        schemaVersion: RUNNER_SCHEMA_VERSION,
        event: 'runner_started',
        runId,
        roleKey,
        identity,
        runDate: normalizeDate(config.runDate),
        at: new Date().toISOString(),
      });
    }

    const providerResult = resultInput(config, ['providerResult', 'providerOutput']);
    if (providerResult === undefined && !providerAvailable(effectiveAdapters)) {
      const result = blocker('provider_adapter_required', 'A real provider adapter or explicit provider result is required; no network/browser default is enabled', 'provider', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    const livenessResult = resultInput(config, ['livenessResult', 'liveness']);
    const livenessAdapter = adapterFor(effectiveAdapters, ['liveness', 'livenessAdapter', 'checkLiveness']);
    if (livenessResult === undefined && !livenessAdapter) {
      const result = blocker('liveness_adapter_required', 'An explicit liveness result or injected liveness adapter is required; browser/network defaults are disabled', 'liveness', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    const evaluationResult = resultInput(config, ['evaluationResult', 'evaluation']);
    const evaluationAdapter = adapterFor(effectiveAdapters, ['evaluate', 'evaluation', 'evaluationAdapter']);
    const hasEvidenceInputs = Array.isArray(config.requirements) && Array.isArray(config.evidence);
    if (evaluationResult === undefined && !evaluationAdapter && !hasEvidenceInputs) {
      const result = blocker('evaluation_adapter_required', 'An explicit evaluation result/adapter or requirements plus evidence is required; no evaluator is invented', 'evaluate', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    const decisionResult = resultInput(config, ['decisionResult', 'decision']);
    const decisionAdapter = adapterFor(effectiveAdapters, ['decide', 'decision', 'decisionAdapter']);
    if (decisionResult === undefined && !decisionAdapter) {
      const result = blocker('decision_result_or_adapter_required', 'An explicit decision result or decision adapter is required; recommendation inference is disabled in the live bridge', 'decide', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    let packetReviewResult = resultInput(config, ['packetReviewResult', 'packetReview']);
    const packetManifest = config.packetManifest ?? config.packet?.manifest;
    const packetAdapter = adapterFor(effectiveAdapters, ['packetReview', 'packetReviewAdapter', 'reviewPacket', 'packet']);
    if (packetReviewResult === undefined && !packetManifest && !config.packet && !packetAdapter) {
      const result = blocker('packet_review_required', 'An explicit packet manifest/review result or packet review adapter is required; no artifact/PDF is generated', 'review', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }
    if (packetReviewResult === undefined && packetAdapter) {
      try {
        packetReviewResult = await packetAdapter({
          root: normalizedRoot,
          job: clone(job),
          roleKey,
          provider: clone(providerResult),
          liveness: clone(livenessResult),
          evaluation: clone(evaluationResult),
          decision: clone(decisionResult),
        });
      } catch (error) {
        const result = blocker('packet_review_adapter_failed', `packet review adapter failed: ${error?.message || String(error)}`, 'review', { ...common, job: clone(job) });
        appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
        return result;
      }
      if (packetReviewResult === undefined || packetReviewResult === null) {
        const result = blocker('packet_review_result_required', 'Packet review adapter must return an explicit review result or manifest', 'review', { ...common, job: clone(job) });
        appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
        return result;
      }
      if (packetReviewResult && packetReviewResult.manifestVersion !== undefined && !packetReviewResult.manifest) {
        packetReviewResult = { manifest: packetReviewResult };
      }
    }

    let tailorResult = resultInput(config, ['tailorResult', 'tailoringResult', 'tailoring']);
    const tailorAdapter = adapterFor(effectiveAdapters, ['tailor', 'tailoring', 'tailorAdapter']);
    const priorTailor = [...records].reverse().find((record) => record.event === 'runner_stage_completed' && record.stage === 'tailor' && record.runId === runId);
    if (tailorResult === undefined && priorTailor?.result !== undefined) tailorResult = priorTailor.result;
    if (tailorResult === undefined && !tailorAdapter) {
      const result = blocker('tailor_adapter_required', 'A real tailor adapter or explicit tailor result is required; master-CV and artifact defaults are disabled', 'tailor', { ...common, job: clone(job) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }
    if (tailorResult === undefined && tailorAdapter) {
      try {
        tailorResult = await tailorAdapter({
          root: normalizedRoot,
          job: clone(job),
          roleKey,
          provider: clone(providerResult),
          liveness: clone(livenessResult),
          evaluation: clone(evaluationResult),
          decision: clone(decisionResult),
          packet: clone(packetReviewResult || packetManifest || config.packet),
        });
      } catch (error) {
        const result = blocker('tailor_adapter_failed', `tailor adapter failed: ${error?.message || String(error)}`, 'tailor', { ...common, job: clone(job) });
        appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
        return result;
      }
    }
    if (!passed(tailorResult)) {
      const result = blocker('tailor_result_not_ready', 'Tailor adapter/result must explicitly pass before packet review and tracker staging', 'tailor', { ...common, job: clone(job), tailorResult: clone(tailorResult) });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }
    if (!priorTailor || !priorTailor.result) appendJournal(normalizedJournal, { schemaVersion: RUNNER_SCHEMA_VERSION, event: 'runner_stage_completed', stage: 'tailor', runId, roleKey, result: clone(tailorResult), at: new Date().toISOString() });

    const trackerResult = resultInput(config, ['trackerAddition', 'trackerResult']);
    const trackerAdapter = adapterFor(effectiveAdapters, ['prepareTrackerAddition', 'trackerPreparation', 'tracker', 'trackerAdapter']);
    const coordinatorAdapters = { ...effectiveAdapters };
    if (trackerAdapter) {
      coordinatorAdapters.prepareTrackerAddition = async (context) => trackerAdapter({ ...context, tailor: clone(tailorResult) });
    }
    const coordinator = coordinatorFactory({ root: normalizedRoot, journalPath: normalizedJournal, adapters: coordinatorAdapters });
    const coordinatorResult = await coordinator.run({
      ...config,
      job: clone(candidate),
      ...(providerResult === undefined ? {} : { providerResult }),
      ...(livenessResult === undefined ? {} : { livenessResult }),
      ...(evaluationResult === undefined ? {} : { evaluationResult }),
      ...(decisionResult === undefined ? {} : { decisionResult }),
      ...(packetReviewResult === undefined ? {} : { packetReviewResult }),
      ...(trackerResult === undefined ? {} : { trackerAddition: trackerResult }),
      packetManifest: packetManifest || (packetReviewResult?.manifest ? undefined : config.packetManifest),
    });
    const stages = { ...coordinatorResult.stages, tailor: 'completed' };
    const stageResults = { ...coordinatorResult.stageResults, tailor: clone(tailorResult) };
    if (coordinatorResult.state !== 'ready') {
      const result = withMetadata(coordinatorResult, { ...common, stages, stageResults, blockers: coordinatorResult.blockers || [] });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    const addition = trackerResult || coordinatorResult.stageResults.track || {};
    const packet = coordinatorResult.stageResults.review;
    const built = buildTrackerTsv({
      job,
      packet,
      evaluation: coordinatorResult.stageResults.evaluate,
      decision: coordinatorResult.stageResults.decide,
      trackerAddition: addition,
      runDate: normalizeDate([...records].find((record) => record.event === 'runner_started' && record.runId === runId)?.runDate || config.runDate),
    });
    if (built.error) {
      const result = withMetadata(built.error, { ...common, stages: { ...stages, track: 'blocked' }, stageResults, blockers: built.error.blockers });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }

    const stagedPath = join(normalizedStaging, `${roleKey.replaceAll(':', '-')}-${runId.slice(-16)}.tsv`);
    mkdirSync(normalizedStaging, { recursive: true });
    if (existsSync(stagedPath) && readFileSync(stagedPath, 'utf8') !== built.content) {
      const result = withMetadata(blocker('tracker_staging_conflict', 'A staged TSV already exists for this exact job but has different content; no file was overwritten', 'track'), { ...common, stages: { ...stages, track: 'blocked' }, stageResults, blockers: [{ code: 'tracker_staging_conflict', message: 'A staged TSV already exists for this exact job but has different content; no file was overwritten', stage: 'track' }] });
      appendJournal(normalizedJournal, { ...result, event: 'runner_blocked', at: new Date().toISOString(), runId });
      return result;
    }
    if (!existsSync(stagedPath)) writeFileSync(stagedPath, built.content, 'utf8');

    const result = withMetadata({
      ...coordinatorResult,
      state: 'ready',
      nextAction: 'candidate_must_submit_manually',
      stagedTrackerAddition: {
        path: stagedPath,
        columns: [...TRACKER_ADDITION_COLUMNS],
        content: built.content,
        reportPath: built.reportPath,
        number: built.number,
      },
    }, { ...common, stages, stageResults, blockers: [] });
    appendJournal(normalizedJournal, { schemaVersion: RUNNER_SCHEMA_VERSION, event: 'runner_completed', runId, roleKey, at: new Date().toISOString(), result: clone(result) });
    return result;
  }

  return Object.freeze({ root: normalizedRoot, journalPath: normalizedJournal, stagingDir: normalizedStaging, run });
}

export async function runOneJob(input = {}) {
  const { root, journalPath, stagingDir, adapters, ...runInput } = input;
  return createOneJobRunner({ root, journalPath, stagingDir, adapters }).run(runInput);
}
export const runOneJobLive = runOneJob;
export const coordinateOneJobLive = runOneJob;
export default createOneJobRunner;
