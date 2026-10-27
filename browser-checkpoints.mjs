#!/usr/bin/env node
/**
 * Durable, local-only checkpoints for safe browser application runs.
 *
 * This module stores operational state only. It does not read user-layer files,
 * open a browser, make network requests, or authorize a submission. A caller
 * must provide an explicit absolute checkpoint root before any filesystem I/O.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_STEPS = Object.freeze([
  'validate', 'load', 'resolve', 'open', 'inspect', 'inject', 'humanize',
  'fill', 'save', 'verify_save', 'pause', 'report', 'handoff',
]);
export const SAVE_STATES = Object.freeze([
  'pending', 'saved', 'verified', 'failed', 'blocked', 'ambiguous',
  'not_available', 'unsaved',
]);
export const FINALIZING_CONTROL_RE = /\b(?:submit|apply|send|finish|complete|finali[sz]e|review\s*(?:and|&)\s*submit)\b/i;

const FORBIDDEN_FIELD_KEYS = /^(?:value|answer|content|secret|password|token|ssn|phone|email_address)$/i;
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === 'string' ? value.trim() : '';
const nowIso = (value) => {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid checkpoint timestamp: ${value}`);
  return date.toISOString();
};
const fail = (message, code = 'CHECKPOINT_INVALID') => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function ensureJson(value, label) {
  try {
    return stable(JSON.parse(JSON.stringify(value)));
  } catch {
    fail(`${label} must be JSON-serializable`);
  }
}

function artifactIdentity(input = {}) {
  const source = input.artifactIdentity ?? input.artifact ?? input.artifacts;
  if (typeof source === 'string') return { id: source };
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('exact artifact identity is required', 'CHECKPOINT_ARTIFACT_REQUIRED');
  }
  const result = ensureJson(source, 'artifact identity');
  if (!Object.keys(result).length) fail('exact artifact identity is required', 'CHECKPOINT_ARTIFACT_REQUIRED');
  return result;
}

function exactIdentity(input = {}) {
  const source = input.identity || input.target || input;
  const report = source.report ?? input.report;
  const packet = source.packet ?? input.packet;
  const reportId = text(source.reportId || source.report_id || (typeof report === 'string' ? report : report?.id));
  const packetId = text(source.packetId || source.packet_id || (typeof packet === 'string' ? packet : packet?.id));
  const identity = {
    company: text(source.company),
    role: text(source.role),
    reportId,
    packetId,
  };
  for (const [key, value] of Object.entries(identity)) {
    if (!value) fail(`exact ${key} identity is required`, 'CHECKPOINT_IDENTITY_REQUIRED');
  }
  return identity;
}

function callerPath(input = {}) {
  const value = text(input.callerPath || input.caller_path || input.sourcePath || input.source_path);
  if (!value) fail('caller path is required', 'CHECKPOINT_CALLER_REQUIRED');
  return value;
}

function portalUrl(input = {}) {
  const value = text(input.portalUrl || input.portal_url || input.url || input.resumableUrl);
  if (!value) fail('portal URL is required', 'CHECKPOINT_PORTAL_REQUIRED');
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    fail('portal URL must be an absolute HTTP(S) URL', 'CHECKPOINT_PORTAL_INVALID');
  }
  return value;
}

function rejectFinalizingControls(input = {}) {
  const controls = input.controls || input.visibleControls || input.navigationControls || [];
  if (!Array.isArray(controls)) fail('controls must be an array');
  const labels = controls.map((control) => typeof control === 'string'
    ? control
    : [
      control?.label,
      control?.type,
      control?.action,
      control?.name,
      control?.id,
      control?.value,
      control?.title,
      control?.ariaLabel,
      control?.['aria-label'],
    ].filter(Boolean).join(' '));
  const forbidden = labels.filter((label) => FINALIZING_CONTROL_RE.test(label));
  if (forbidden.length) {
    fail(`finalizing control rejected: ${[...new Set(forbidden)].join(', ')}`, 'CHECKPOINT_SUBMIT_REJECTED');
  }
}

function safeStep(value) {
  const step = text(value || 'inspect').toLowerCase().replace(/[\s-]+/g, '_');
  if (!CHECKPOINT_STEPS.includes(step)) fail(`unsafe or unknown checkpoint step: ${value}`, 'CHECKPOINT_STEP_REJECTED');
  return step;
}

function normalizeSaveState(input = {}, timestamp) {
  const source = input.saveState ?? input.save_status ?? input.save ?? {};
  const raw = typeof source === 'string' ? { status: source } : (source || {});
  const status = text(raw.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    saved_draft: 'saved',
    filled_not_saved: 'unsaved',
    blocked_before_save: 'blocked',
    save_failed: 'failed',
  };
  const normalizedStatus = aliases[status] || status;
  if (!SAVE_STATES.includes(normalizedStatus)) fail(`invalid save state: ${status}`, 'CHECKPOINT_SAVE_STATE_INVALID');
  return {
    status: normalizedStatus,
    detail: text(raw.detail) || null,
    attemptedAt: raw.attemptedAt ? nowIso(raw.attemptedAt) : null,
    savedAt: raw.savedAt ? nowIso(raw.savedAt) : (['saved', 'verified'].includes(normalizedStatus) ? timestamp : null),
    verifiedAt: raw.verifiedAt ? nowIso(raw.verifiedAt) : (normalizedStatus === 'verified' ? timestamp : null),
  };
}

function normalizeFieldState(value) {
  const state = ensureJson(value ?? {}, 'field state');
  const scan = (node, path = []) => {
    if (Array.isArray(node)) return node.forEach((item, index) => scan(item, [...path, index]));
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_FIELD_KEYS.test(key)) fail(`field state cannot persist user value at ${[...path, key].join('.')}`, 'CHECKPOINT_USER_DATA_REJECTED');
      scan(child, [...path, key]);
    }
  };
  scan(state);
  return state;
}

function resumability(saveState, input = {}) {
  const requested = input.resumability && typeof input.resumability === 'object'
    ? input.resumability
    : {};
  const canResume = ['saved', 'verified'].includes(saveState.status);
  return {
    resumable: canResume && requested.resumable !== false && input.invalidated !== true,
    reason: text(requested.reason) || (canResume ? null : `save state is ${saveState.status}`),
  };
}

function identityMatches(checkpoint, input) {
  return checkpoint.callerPath === callerPath(input)
    && stableJson(checkpoint.identity) === stableJson(exactIdentity(input))
    && stableJson(checkpoint.artifactIdentity) === stableJson(artifactIdentity(input));
}

function queryFor(input = {}) {
  return {
    callerPath: callerPath(input),
    identity: exactIdentity(input),
    artifactIdentity: artifactIdentity(input),
  };
}

export function createBrowserCheckpoint(input = {}, options = {}) {
  rejectFinalizingControls(input);
  if (input.submissionAllowed === true) fail('submission is never allowed by browser checkpoints', 'CHECKPOINT_SUBMIT_REJECTED');
  const createdAt = nowIso(options.now ?? input.createdAt);
  const saveState = normalizeSaveState(input, createdAt);
  const checkpoint = {
    version: CHECKPOINT_VERSION,
    callerPath: callerPath(input),
    identity: exactIdentity(input),
    artifactIdentity: artifactIdentity(input),
    portalUrl: portalUrl(input),
    currentStep: safeStep(input.currentStep || input.step),
    fieldState: normalizeFieldState(input.fieldState),
    saveState,
    createdAt,
    updatedAt: createdAt,
    resumedAt: null,
    failedAt: null,
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      lastResumedAt: null,
      resumedAt: null,
      failedAt: null,
    },
    resumability: resumability(saveState, input),
    invalidated: false,
    invalidation: null,
    failure: null,
    submissionAllowed: false,
  };
  return checkpoint;
}

export function validateBrowserCheckpoint(checkpoint) {
  const errors = [];
  try {
    if (checkpoint?.version !== CHECKPOINT_VERSION) errors.push('unsupported checkpoint version');
    callerPath(checkpoint);
    exactIdentity(checkpoint);
    artifactIdentity(checkpoint);
    portalUrl(checkpoint);
    safeStep(checkpoint.currentStep);
    normalizeFieldState(checkpoint?.fieldState);
    if (checkpoint?.submissionAllowed !== false) errors.push('submissionAllowed must remain false');
    if (!checkpoint?.timestamps?.createdAt || !checkpoint?.timestamps?.updatedAt) errors.push('timestamps are required');
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

function assertCheckpoint(checkpoint) {
  const errors = validateBrowserCheckpoint(checkpoint);
  if (errors.length) fail(`invalid browser checkpoint: ${errors.join('; ')}`);
}

function transitionCheckpoint(checkpoint, input = {}, options = {}) {
  assertCheckpoint(checkpoint);
  rejectFinalizingControls(input);
  if (input.submissionAllowed === true) fail('submission is never allowed by browser checkpoints', 'CHECKPOINT_SUBMIT_REJECTED');
  if (input.identity || input.target || input.company || input.role || input.reportId || input.packetId || input.artifactIdentity || input.artifact) {
    if (!identityMatches(checkpoint, input)) fail('checkpoint identity or artifact does not exactly match', 'CHECKPOINT_IDENTITY_MISMATCH');
  }
  const at = nowIso(options.now ?? input.at);
  const next = clone(checkpoint);
  if (input.currentStep || input.step) next.currentStep = safeStep(input.currentStep || input.step);
  if (input.fieldState !== undefined) next.fieldState = normalizeFieldState(input.fieldState);
  if (input.saveState !== undefined || input.save_status !== undefined || input.save !== undefined) next.saveState = normalizeSaveState(input, at);
  next.timestamps.updatedAt = at;
  next.updatedAt = at;
  next.resumability = resumability(next.saveState, { ...input, invalidated: next.invalidated });
  return next;
}


export function resumeBrowserCheckpoint(checkpoint, input = {}, options = {}) {
  if (options.rootPath || options.root) return new BrowserCheckpointStore(options).resume(checkpoint, input);
  assertCheckpoint(checkpoint);
  const query = Object.keys(input).length ? input : checkpoint;
  if (!identityMatches(checkpoint, query)) return { ok: false, status: 'invalidated', reason: 'checkpoint identity or artifact does not exactly match', submissionAllowed: false };
  if (checkpoint.invalidated || !checkpoint.resumability.resumable) {
    return { ok: false, status: 'not_resumable', reason: checkpoint.invalidation?.reason || checkpoint.resumability.reason, submissionAllowed: false };
  }
  return { ok: true, status: 'resumable', currentStep: checkpoint.currentStep, checkpoint: clone(checkpoint), submissionAllowed: false };
}

export function recoverBrowserCheckpoint(checkpoint, input = {}, options = {}) {
  assertCheckpoint(checkpoint);
  const query = Object.keys(input).some((key) => ['callerPath', 'caller_path', 'company', 'role', 'reportId', 'report_id', 'packetId', 'packet_id', 'artifactIdentity', 'artifact'].includes(key))
    ? input
    : checkpoint;
  if (!identityMatches(checkpoint, query)) fail('checkpoint identity or artifact does not exactly match', 'CHECKPOINT_IDENTITY_MISMATCH');
  const at = nowIso(options.now ?? input.at);
  const next = transitionCheckpoint(checkpoint, { ...query, ...input, at });
  next.failure = {
    code: text(input.code || input.failure?.code) || 'BROWSER_CHECKPOINT_FAILURE',
    message: text(input.message || input.failure?.message) || 'browser application run failed at a safe checkpoint',
    at,
  };
  next.timestamps.failedAt = at;
  next.failedAt = at;
  next.resumability = resumability(next.saveState, { invalidated: next.invalidated, resumability: { reason: 'failure recorded; review the safe checkpoint before retrying' } });
  return next;
}

export const invalidateBrowserCheckpoint = (checkpoint, options = {}) => {
  const rootPath = options.rootPath || options.root;
  if (rootPath) return new BrowserCheckpointStore(options).invalidate(checkpoint, options);
  assertCheckpoint(checkpoint);
  const at = nowIso(options.now);
  const next = clone(checkpoint);
  next.invalidated = true;
  next.invalidation = { reason: text(options.reason) || 'checkpoint invalidated', at };
  next.resumability = { resumable: false, reason: next.invalidation.reason };
  next.timestamps.updatedAt = at;
  next.updatedAt = at;
  return next;
};

/*
 * The filesystem wrappers intentionally require the root in `options`, rather
 * than falling back to the project directory or a user-data path.
 */
export function loadBrowserCheckpoint(input = {}, options = {}) {
  const rootOptions = options.rootPath || options.root
    ? options
    : (input.rootPath || input.root ? input : options);
  const query = rootOptions === input ? { ...input } : input;
  if (rootOptions === input) {
    delete query.rootPath;
    delete query.root;
  }
  return new BrowserCheckpointStore(rootOptions).load(query);
}

export function saveBrowserCheckpoint(checkpoint, options = {}) {
  if (!options.rootPath && !options.root) fail('an explicit absolute checkpoint rootPath is required', 'CHECKPOINT_ROOT_REQUIRED');
  const store = new BrowserCheckpointStore(options);
  return store.save(checkpoint, options);
}


function paths(options = {}) {
  const root = options.rootPath || options.root;
  if (!isAbsolute(root || '')) fail('an explicit absolute checkpoint rootPath is required', 'CHECKPOINT_ROOT_REQUIRED');
  const rootPath = resolve(root);
  const state = resolve(options.statePath || join(rootPath, 'browser-checkpoint.json'));
  const journal = resolve(options.journalPath || join(rootPath, 'browser-checkpoint-journal.jsonl'));
  for (const path of [state, journal]) {
    const rel = relative(rootPath, path);
    if (rel.startsWith('..') || isAbsolute(rel)) fail('checkpoint files must remain under the explicit checkpoint root', 'CHECKPOINT_PATH_INVALID');
  }
  return { root: rootPath, state, journal };
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    const fd = openSync(temp, 'w');
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
}

function appendJournal(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'a');
  try {
    appendFileSync(fd, `${JSON.stringify(stable(event))}\n`, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export class BrowserCheckpointStore {
  constructor(options = {}) {
    this.paths = paths(options);
  }

  load(input = {}) {
    if (!existsSync(this.paths.state)) return null;
    const checkpoint = JSON.parse(readFileSync(this.paths.state, 'utf8'));
    assertCheckpoint(checkpoint);
    if (!Object.keys(input).length) return checkpoint;
    const query = queryFor(input);
    if (checkpoint.callerPath !== query.callerPath
      || stableJson(checkpoint.identity) !== stableJson(query.identity)
      || stableJson(checkpoint.artifactIdentity) !== stableJson(query.artifactIdentity)) {
      const invalidated = this.invalidate(checkpoint, {
        reason: 'caller path, company, role, report, packet, or artifact identity mismatch',
        now: input.now,
      });
      return invalidated;
    }
    return checkpoint;
  }

  journal() {
    if (!existsSync(this.paths.journal)) return [];
    return readFileSync(this.paths.journal, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }

  persist(checkpoint, event, options = {}) {
    assertCheckpoint(checkpoint);
    atomicWrite(this.paths.state, checkpoint);
    appendJournal(this.paths.journal, {
      type: event.type,
      callerPath: checkpoint.callerPath,
      identity: checkpoint.identity,
      artifactIdentity: checkpoint.artifactIdentity,
      at: event.at || checkpoint.timestamps.updatedAt,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.failure ? { failure: event.failure } : {}),
    });
    return checkpoint;
  }

  save(input, options = {}) {
    const previous = this.load();
    let checkpoint = input?.version === CHECKPOINT_VERSION
      ? transitionCheckpoint(input, options, options)
      : createBrowserCheckpoint(input, options);
    if (previous && (previous.callerPath !== checkpoint.callerPath
      || stableJson(previous.identity) !== stableJson(checkpoint.identity)
      || stableJson(previous.artifactIdentity) !== stableJson(checkpoint.artifactIdentity))) {
      const invalidated = this.invalidate(previous, {
        reason: 'replaced by a different caller-path identity or artifact',
        now: options.now,
      });
      void invalidated;
    }
    return this.persist(checkpoint, { type: 'checkpoint_saved', at: checkpoint.timestamps.updatedAt });
  }

  resume(input, options = {}) {
    const checkpoint = this.load(input);
    if (!checkpoint) return { ok: false, status: 'not_found', submissionAllowed: false };
    if (checkpoint.invalidated) return { ok: false, status: 'invalidated', checkpoint, submissionAllowed: false };
    const result = resumeBrowserCheckpoint(checkpoint, input);
    if (!result.ok) return { ...result, checkpoint };
    const resumed = transitionCheckpoint(checkpoint, { ...input, at: options.now ?? input.now }, options);
    resumed.timestamps.lastResumedAt = resumed.timestamps.updatedAt;
    resumed.resumedAt = resumed.timestamps.lastResumedAt;
    resumed.timestamps.resumedAt = resumed.timestamps.lastResumedAt;
    this.persist(resumed, { type: 'checkpoint_resumed', at: resumed.timestamps.updatedAt });
    return { ...resumeBrowserCheckpoint(resumed, input), checkpoint: resumed };
  }

  recoverFailure(input, options = {}) {
    const checkpoint = this.load(input);
    if (!checkpoint || checkpoint.invalidated) return { ok: false, status: checkpoint?.invalidated ? 'invalidated' : 'not_found', checkpoint, submissionAllowed: false };
    const recovered = recoverBrowserCheckpoint(checkpoint, input, options);
    this.persist(recovered, {
      type: 'checkpoint_failure_recovered',
      at: recovered.timestamps.updatedAt,
      failure: recovered.failure,
    });
    return { ok: true, status: 'failure_recorded', checkpoint: recovered, submissionAllowed: false };
  }

  invalidate(checkpointOrInput, options = {}) {
    const checkpoint = checkpointOrInput?.version === CHECKPOINT_VERSION
      ? checkpointOrInput
      : this.load();
    if (!checkpoint) return null;
    const at = nowIso(options.now);
    const next = clone(checkpoint);
    next.invalidated = true;
    next.invalidation = { reason: text(options.reason) || 'checkpoint invalidated', at };
    next.resumability = { resumable: false, reason: next.invalidation.reason };
    next.timestamps.updatedAt = at;
    next.updatedAt = at;
    return this.persist(next, { type: 'checkpoint_invalidated', at, reason: next.invalidation.reason });
  }
}
export const BrowserCheckpointLedger = BrowserCheckpointStore;

export default {
  BrowserCheckpointStore,
  CHECKPOINT_VERSION,
  CHECKPOINT_STEPS,
  SAVE_STATES,
  createBrowserCheckpoint,
  saveBrowserCheckpoint,
  loadBrowserCheckpoint,
  resumeBrowserCheckpoint,
  recoverBrowserCheckpoint,
  validateBrowserCheckpoint,
};
