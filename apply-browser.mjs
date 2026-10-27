#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { resolveResumeArtifact } from './apply-artifact-resolver.mjs';
import { upsertRow } from './application-drafts.mjs';
import { assertApplicationGates } from './application-gates.mjs';
import { ApprovalLedger } from './approval-state.mjs';
import { BrowserCheckpointStore } from './browser-checkpoints.mjs';
import { detectPortalAdapter, portalFamilyForAdapter } from './portal-adapters/index.mjs';
import {
  advanceApplicationPage,
  inspectNavigation,
  isFinalizingControl,
  isReviewControl,
} from './application-navigation.mjs';
import {
  assertSafeAction,
  markReviewHandoff,
  withBlocker,
  withDraftStatus,
  withResumableUrl,
  withResumePairing,
  withStep,
} from './workflow-contract.mjs';

export const APPLY_CALLER_PATH = 'apply-browser.main';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_ANSWERS_PATH = resolve(PROJECT_ROOT, 'data', 'application-answers.md');
const SAVE_CONTROL_RE = /\b(save(?:\s+draft|\s+application)?|save\s*&\s*continue|save\s+and\s+continue)\b/i;

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}


function blockerCode(phase, message, index = 0) {
  const slug = normalize(message).replace(/\s+/g, '_').slice(0, 48) || 'unknown';
  return `${phase}_${index + 1}_${slug}`;
}

function addWorkflowBlockers(run, messages, phase, manualAction) {
  let next = run;
  const seen = new Set(next.blockers.map(({ message }) => message));
  messages.filter(Boolean).forEach((message, index) => {
    if (seen.has(message)) return;
    next = withBlocker(next, {
      code: blockerCode(phase, message, index),
      message,
      phase,
      manualAction,
    });
    seen.add(message);
  });
  return next;
}

function blockerMessages(error) {
  if (Array.isArray(error?.blockers) && error.blockers.length) {
    return error.blockers.map((blocker) => {
      if (typeof blocker === 'string') return blocker;
      const action = blocker.manualAction ? `; next=${blocker.manualAction}` : '';
      return `${blocker.code || 'blocker'}: ${blocker.message || 'unspecified blocker'}${action}`;
    }).filter(Boolean);
  }
  return [error?.message || 'application run failed before a safe draft checkpoint'];
}

function persistBlockedDraft(args, resumePath, messages, draftStatus = 'blocked_before_save', resumeUrl = args.url, draftUpsert = upsertRow) {
  draftUpsert({
    company: args.company,
    role: args.role,
    roleUrl: args.url,
    draftStatus,
    resume: resumePath ? relative(PROJECT_ROOT, resumePath) : '',
    resumeUrl,
    referral: args.referral,
    notes: messages.join(' ; '),
    silent: true,
  });
}

function compact(value) {
  return normalize(value).replace(/\s+/g, ' ');
}

function flattenObject(value, prefix = '', output = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenObject(child, path, output);
    } else if (child !== undefined && child !== null && child !== '') {
      output[path] = child;
    }
  }
  return output;
}

function valueForProfileField(label, profile) {
  const text = compact(label);
  const flat = flattenObject(profile);
  const aliases = [
    [['full name', 'legal name', 'first and last name'], 'candidate.full_name'],
    [['first name', 'given name'], 'candidate.first_name'],
    [['last name', 'surname', 'family name'], 'candidate.last_name'],
    [['email', 'email address'], 'candidate.email'],
    [['phone', 'phone number', 'mobile', 'telephone'], 'candidate.phone'],
    [['linkedin', 'linkedin url', 'linkedin profile'], 'candidate.linkedin'],
    [['github', 'github url', 'github profile'], 'candidate.github'],
    [['portfolio', 'portfolio url', 'website', 'personal website'], 'candidate.portfolio_url'],
    [['address', 'street address', 'address line 1'], 'address.line1'],
    [['city', 'town'], 'address.city'],
    [['state', 'province', 'region'], 'address.state'],
    [['zip', 'zip code', 'postal code'], 'address.zip'],
    [['country', 'country of residence'], 'location.country'],
    [['timezone', 'time zone'], 'location.timezone'],
    [['minimum salary', 'salary minimum'], 'compensation.minimum'],
    [['salary', 'salary expectation', 'desired salary', 'compensation'], 'compensation.target_range'],
    [['authorized to work', 'work authorization', 'legally authorized'], 'eeo.us_citizen'],
    [['sponsorship', 'require sponsorship', 'visa sponsorship'], 'eeo.sponsorship_required'],
    [['relocate', 'willing to relocate', 'relocation'], 'location.willing_to_relocate'],
  ];

  for (const [names, key] of aliases) {
    if (names.some((name) => text === name || text.includes(name))) {
      return flat[key];
    }
  }
  return undefined;
}
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

function approvalBlocker(message, code = 'APPROVAL_BLOCKED') {
  const error = new Error(message);
  error.code = code;
  error.blockers = [{ code, message, phase: 'precondition', blocking: true, manualAction: 'Resolve the exact approval and retry' }];
  return error;
}

function exactApplyIdentity(args, artifactMetadata = null) {
  const reportId = String(args.reportId || args.report_id || artifactMetadata?.report_id || '').trim();
  const packetId = String(args.packetId || args.packet_id || args.packet?.id || args.packet?.packetId || '').trim();
  const identity = {
    company: String(args.company || '').trim(),
    role: String(args.role || '').trim(),
    reportId,
    packetId,
  };
  if (Object.values(identity).some((value) => !value)) {
    throw approvalBlocker('exact company, role, report ID, and packet ID are required for approval verification', 'APPROVAL_IDENTITY_REQUIRED');
  }
  return identity;
}

function exactApplyArtifact(args, resumePath, artifactMetadata = null) {
  if (args.artifactIdentity && typeof args.artifactIdentity === 'object') return stable(args.artifactIdentity);
  const artifact = {};
  if (args.artifactId || args.artifact_id) artifact.id = String(args.artifactId || args.artifact_id).trim();
  if (args.artifactFingerprint || args.artifact_fingerprint) artifact.fingerprint = String(args.artifactFingerprint || args.artifact_fingerprint).trim();
  if (artifactMetadata?.content_fingerprint) artifact.contentFingerprint = String(artifactMetadata.content_fingerprint).trim();
  if (!Object.keys(artifact).length && resumePath) artifact.path = relative(PROJECT_ROOT, resumePath);
  if (!Object.keys(artifact).length) throw approvalBlocker('exact packet/artifact identity is required for approval verification', 'APPROVAL_ARTIFACT_REQUIRED');
  return stable(artifact);
}

function approvalRecord(ledger, approvalId) {
  const state = typeof ledger?.load === 'function' ? ledger.load() : ledger?.state || ledger;
  return state?.approvals?.[approvalId] || null;
}

/**
 * Verify the single approval authorizing a draft-save operation. This check is
 * intentionally independent from the boolean role gate: a requested,
 * revoked, expired, consumed, mismatched, or not-ready approval never opens a
 * browser.
 */
export function verifyDraftSaveApproval({
  approvalId,
  approvalLedger,
  identity,
  artifactIdentity,
  callerPath = APPLY_CALLER_PATH,
  packetReview,
  now = new Date().toISOString(),
} = {}) {
  if (!identity || ['company', 'role', 'reportId', 'packetId'].some((key) => !String(identity[key] || '').trim())) {
    throw approvalBlocker('exact company, role, report ID, and packet ID are required for approval verification', 'APPROVAL_IDENTITY_REQUIRED');
  }
  if (!artifactIdentity || typeof artifactIdentity !== 'object' || !Object.keys(artifactIdentity).length) {
    throw approvalBlocker('exact packet/artifact identity is required for approval verification', 'APPROVAL_ARTIFACT_REQUIRED');
  }
  if (!approvalId) throw approvalBlocker('an approval ID is required before opening the application form', 'APPROVAL_REQUIRED');
  if (!approvalLedger) throw approvalBlocker('an approval ledger is required before opening the application form', 'APPROVAL_LEDGER_REQUIRED');
  const record = approvalRecord(approvalLedger, approvalId);
  if (!record) throw approvalBlocker(`approval ${approvalId} was not found`, 'APPROVAL_NOT_FOUND');
  if (record.callerPath !== callerPath) throw approvalBlocker('approval caller path does not exactly match apply-browser', 'APPROVAL_CALLER_MISMATCH');
  if (record.status !== 'approved') {
    const code = record.status === 'revoked' ? 'APPROVAL_REVOKED'
      : record.status === 'expired' ? 'APPROVAL_EXPIRED'
        : record.status === 'consumed' ? 'APPROVAL_CONSUMED' : 'APPROVAL_NOT_READY';
    throw approvalBlocker(`approval ${approvalId} is ${record.status || 'not ready'}`, code);
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now)) {
    throw approvalBlocker(`approval ${approvalId} has expired`, 'APPROVAL_EXPIRED');
  }
  if (stableJson(record.identity) !== stableJson(identity)) {
    throw approvalBlocker('approval identity does not exactly match company, role, report, and packet', 'APPROVAL_IDENTITY_MISMATCH');
  }
  if (stableJson(record.artifactIdentity) !== stableJson(artifactIdentity)) {
    throw approvalBlocker('packet/artifact identity does not exactly match approval', 'APPROVAL_ARTIFACT_MISMATCH');
  }
  const required = Array.isArray(record.sensitiveFields) ? record.sensitiveFields : [];
  const confirmed = Array.isArray(record.sensitiveConfirmations)
    ? record.sensitiveConfirmations
    : Object.entries(record.sensitiveConfirmations || {}).filter(([, value]) => value === true).map(([field]) => field);
  if (required.some((field) => !confirmed.includes(field))) {
    throw approvalBlocker('all required sensitive-field confirmations must be explicit', 'SENSITIVE_CONFIRMATION_REQUIRED');
  }
  if (record.packetReady === false || (record.packetStatus && record.packetStatus !== 'ready_for_review')) {
    throw approvalBlocker('the approved packet is not ready for review', 'PACKET_NOT_READY');
  }
  if (packetReview && (packetReview.ok !== true || packetReview.status !== 'ready_for_review')) {
    throw approvalBlocker('packet/reviewer readiness is required before draft-save approval', 'PACKET_NOT_READY');
  }
  if (record.packetReview && (record.packetReview.ok !== true || record.packetReview.status !== 'ready_for_review')) {
    throw approvalBlocker('the approved packet is not ready for review', 'PACKET_NOT_READY');
  }
  return { ok: true, approvalId, record };
}

function verifiedSaveResult(save) {
  return save?.status === 'verified'
    || save?.status === 'saved'
    || save?.adapter?.saved === true;
}

export function consumeVerifiedDraftSave({
  approval,
  approvalLedger,
  identity,
  artifactIdentity,
  save,
  now = new Date().toISOString(),
} = {}) {
  if (!verifiedSaveResult(save)) throw approvalBlocker('approval may be consumed only after verified draft-save', 'DRAFT_SAVE_UNVERIFIED');
  if (!approval?.approvalId || typeof approvalLedger?.consume !== 'function') {
    throw approvalBlocker('approval ledger consume operation is required after verified draft-save', 'APPROVAL_CONSUME_UNAVAILABLE');
  }
  return approvalLedger.consume(approval.approvalId, {
    ...identity,
    artifactIdentity,
  }, { now });
}

function checkpointIdentity(args, resumePath, artifactMetadata) {
  return {
    callerPath: args.callerPath || APPLY_CALLER_PATH,
    identity: exactApplyIdentity(args, artifactMetadata),
    artifactIdentity: exactApplyArtifact(args, resumePath, artifactMetadata),
  };
}

function persistCheckpoint(store, args, resumePath, artifactMetadata, step, saveState, portalUrl, fieldState = {}) {
  if (!store) return null;
  const key = checkpointIdentity(args, resumePath, artifactMetadata);
  return store.save({
    ...key,
    portalUrl: portalUrl || args.url,
    currentStep: step,
    saveState: { status: saveState },
    fieldState: {
      filledCount: Number(fieldState.filledCount || 0),
      skippedCount: Number(fieldState.skippedCount || 0),
      blockerCount: Number(fieldState.blockerCount || 0),
      forbiddenCount: Number(fieldState.forbiddenCount || 0),
    },
    submissionAllowed: false,
  }, { now: new Date().toISOString() });
}

export function parseAnswerBank(markdown) {
  const answers = [];
  const matches = String(markdown || '').matchAll(/^##\s+Q(\d+)\s*([^\n]*)\n([\s\S]*?)(?=^##\s+Q\d+\b|(?![\s\S]))/gim);
  for (const match of matches) {
    const body = match[3].trim();
    if (body) {
      const answer = { number: Number(match[1]), text: body };
      Object.defineProperty(answer, 'label', { value: match[2].trim(), enumerable: false });
      answers.push(answer);
    }
  }
  return answers;
}

function answerForLabel(label, answers) {
  const text = compact(label);
  const questionMap = [
    [['tell me about yourself', 'about you', 'introduce yourself'], 1],
    [['why this role', 'why are you interested'], 2],
    [['why this company', 'why us', 'why our company'], 3],
    [['challenging project', 'difficult project', 'proudest project'], 4],
    [['leadership', 'led a team', 'team leadership'], 5],
    [['weakness', 'area for improvement'], 6],
    [['five year', '5 year', 'career goals'], 7],
    [['why engineering', 'why did you choose'], 8],
    [['cad', 'software experience'], 9],
    [['multiple deadlines', 'prioritize'], 10],
    [['relocation', 'relocate'], 11],
    [['salary', 'compensation expectation'], 12],
    [['work authorization', 'sponsorship'], 13],
    [['how did you hear', 'referral'], 14],
    [['cover letter', 'additional information'], 15],
  ];
  const match = questionMap.find(([names]) => names.some((name) => text.includes(name)));
  if (!match) return undefined;
  return answers.find((answer) => answer.number === match[1])?.text;
}

async function controlLabel(page, locator) {
  return locator.evaluate((element) => {
    const labels = [];
    if (element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicit) labels.push(explicit.innerText);
    }
    const parent = element.closest('label');
    if (parent) labels.push(parent.innerText);
    for (const attr of ['aria-label', 'placeholder', 'name']) {
      if (element.getAttribute(attr)) labels.push(element.getAttribute(attr));
    }
    return labels.filter(Boolean).join(' | ');
  });
}

function isFinalControl(label, type = '') {
  return isFinalizingControl(label, type) || isReviewControl(label);
}

async function fillControl(page, locator, label, value) {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  const type = (await locator.getAttribute('type')) || '';
  if (type === 'file') return { action: 'upload', label };
  if (tag === 'select') {
    const options = await locator.locator('option').allTextContents();
    const normalizedValue = compact(value);
    const option = options.find((candidate) => compact(candidate) === normalizedValue)
      || options.find((candidate) => compact(candidate).includes(normalizedValue));
    if (!option) return { action: 'blocked', label, reason: `no option matches ${value}` };
    await locator.selectOption({ label: option });
    return { action: 'filled', label, value: option };
  }
  if (type === 'checkbox' || type === 'radio') {
    const bool = value === true || compact(value) === 'yes' || compact(value) === 'true';
    if (bool) await locator.check();
    else if (type === 'checkbox') await locator.uncheck();
    return { action: 'filled', label, value: bool };
  }
  await locator.fill(String(value));
  return { action: 'filled', label, value: String(value) };
}

export async function inspectApplicationPage(page) {
  const controls = [];
  const locator = page.locator('input, textarea, select');
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const control = locator.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    const label = await controlLabel(page, control);
    const type = (await control.getAttribute('type')) || 'text';
    controls.push({ index, label, type, required: await control.getAttribute('required') !== null });
  }
  return controls;
}

export async function fillApplicationPage(page, { profile, answers = [], resumePath, dryRun = false } = {}) {
  const result = { filled: [], skipped: [], blockers: [], forbiddenControls: [], navigation: null };
  const controls = await inspectApplicationPage(page);
  const navigation = await inspectNavigation(page);
  result.navigation = {
    status: navigation.status,
    manualAuthentication: navigation.manualAuthentication,
    finalControls: navigation.finalControls.map(({ label }) => label),
    reviewControls: navigation.reviewControls.map(({ label }) => label),
  };
  for (const control of [...navigation.finalControls, ...navigation.reviewControls]) {
    result.forbiddenControls.push(control.label || `unnamed ${control.type || 'button'} control`);
  }

  const locator = page.locator('input, textarea, select');

  for (const control of controls) {
    const element = locator.nth(control.index);
    const label = control.label || `unnamed ${control.type} field`;
    if (isFinalControl(label, control.type)) {
      result.forbiddenControls.push(label);
      continue;
    }

    if (control.type === 'file') {
      if (!/resume|cv|curriculum vitae|upload/i.test(label)) {
        result.skipped.push({ label, reason: 'non-resume upload requires candidate review' });
      } else if (!resumePath) {
        result.blockers.push(`resume upload field found but no resume artifact was supplied (${label})`);
      } else if (!existsSync(resumePath)) {
        result.blockers.push(`resume artifact does not exist: ${resumePath}`);
      } else if (!dryRun) {
        await element.setInputFiles(resumePath);
        result.filled.push({ label, action: 'upload', value: relative(PROJECT_ROOT, resumePath) });
      } else {
        result.filled.push({ label, action: 'upload', value: relative(PROJECT_ROOT, resumePath), dryRun: true });
      }
      continue;
    }

    const profileValue = valueForProfileField(label, profile);
    const answerValue = answerForLabel(label, answers);
    const value = profileValue ?? answerValue;
    if (value === undefined) {
      result.skipped.push({ label, reason: 'no approved profile or answer-bank value' });
      if (control.required) result.blockers.push(`required field has no approved value: ${label}`);
      continue;
    }
    if (dryRun) {
      result.filled.push({ label, action: 'fill', value: String(value), dryRun: true });
    } else {
      result.filled.push(await fillControl(page, element, label, value));
    }
  }

  if (result.forbiddenControls.length) {
    result.blockers.push(`finalizing controls detected and intentionally untouched: ${result.forbiddenControls.join(', ')}`);
  }
  return result;
}

export async function saveDraft(page) {
  const buttons = page.locator('button, input[type="button"], input[type="submit"]');
  const count = await buttons.count();
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const label = ((await button.innerText().catch(() => '')) || (await button.getAttribute('aria-label')) || (await button.getAttribute('value')) || '').trim();
    if (isFinalControl(label, await button.getAttribute('type') || '')) continue;
    if (SAVE_CONTROL_RE.test(label)) candidates.push({ button, label });
  }
  if (candidates.length === 0) return { status: 'not_available', label: null };
  if (candidates.length > 1) return { status: 'ambiguous', label: candidates.map(({ label }) => label) };
  assertSafeAction('save_draft');
  await candidates[0].button.click();
  return { status: 'clicked', label: candidates[0].label };
}

function printHelp() {
  console.log(`Usage:
  npm run apply:browser -- --url <application-url> --company <name> --role <role>
    --resume <exact-tailored-pdf> --approval-id <id> --approval-root <root>
    --checkpoint-root <root> --packet-id <id> --report-id <id>
    --referral <name-or-none> [--portal custom] [--answers <markdown>]
    [--tracker-ready] [--pause]

The engine requires an approved save_draft ledger entry whose caller,
company/role/report/packet, artifact identity, and sensitive confirmations
match exactly. It fills approved values, saves and verifies explicit drafts,
advances only through an unambiguous non-final Continue/Next control, and
hands off at authentication, review, or final controls. It never submits.
`);
}

function parseArgs(argv) {
  const args = { headed: true };
  const valueOptions = new Set([
    '--url', '--company', '--role', '--report', '--report-id', '--resume',
    '--answers', '--candidate', '--referral', '--approval', '--approval-id',
    '--approval-root', '--checkpoint-root', '--packet-id', '--artifact-id',
    '--artifact-fingerprint', '--caller-path', '--portal',
  ]);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return { help: true };
  }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--headless') { args.headed = false; continue; }
    if (key === '--dry-run') { args.dryRun = true; continue; }
    if (key === '--pause') { args.pause = true; continue; }
    if (key === '--tracker-ready') { args.trackerReady = true; continue; }
    if (key === '--no-referral') { args.referral = 'none'; continue; }
    if (!valueOptions.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (args.approval && !args.approvalId) args.approvalId = args.approval;
  return args;
}


function readYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

function portalAdapterContext(page, args, profile, answers, resumePath, adapter) {
  const url = page.url() || args.url;
  return {
    page,
    url,
    roleUrl: args.url,
    role: { company: args.company, title: args.role, url: args.url },
    profile,
    answers,
    values: profile,
    resumePath,
    artifacts: { resumePath, resume: { path: resumePath } },
    portalFamily: args.portal || portalFamilyForAdapter(adapter, { url, roleUrl: args.url }),
  };
}

function adapterFillResult(result) {
  return {
    filled: result.filledFields.map((label) => ({
      label,
      action: /resume|curriculum vitae|\bcv\b/i.test(label) ? 'upload' : 'fill',
    })),
    skipped: result.missingFields.map((label) => ({
      label,
      reason: 'no approved profile or answer-bank value',
    })),
    blockers: result.blockers,
    forbiddenControls: result.blockers.filter((message) => /final|submit|apply|review/i.test(message)),
    navigation: null,
    adapter: result,
  };
}

function adapterSaveResult(result) {
  if (result.saved) {
    return { status: 'verified', label: null, adapter: result };
  }
  return {
    status: result.blockers.length ? 'blocked' : 'not_available',
    label: null,
    adapter: result,
  };
}

function adapterNavigationResult(result) {
  if (['ready', 'review_ready'].includes(result.status)) {
    return {
      status: 'clicked',
      action: 'continue_non_final',
      reason: result.message || 'safe portal continuation completed',
      adapter: result,
    };
  }

  const text = result.blockers.join(' ; ');
  const status = /authentication|otp|captcha|verification/i.test(text)
    ? 'manual_authentication'
    : /final|submit|apply|review/i.test(text)
      ? 'review_required'
      : /ambiguous|multiple/i.test(text)
        ? 'ambiguous'
        : 'blocked';
  return {
    status,
    action: 'handoff_review',
    reason: result.blockers[0] || result.message || 'safe portal continuation was unavailable',
    controls: [],
    adapter: result,
  };
}

async function continuePortalAdapter(adapter, context) {
  if (typeof adapter.continue === 'function') return adapter.continue(context);
  return {
    status: 'blocked',
    blockers: ['This portal adapter does not expose a safe continuation action.'],
    message: 'The candidate must review this portal step manually.',
  };
}
export async function main(suppliedArgs = null, dependencies = {}) {
  const args = suppliedArgs || parseArgs(process.argv.slice(2));
  const draftUpsert = dependencies.upsertRow || upsertRow;
  const resolveArtifact = dependencies.resolveResumeArtifact || resolveResumeArtifact;
  const gateApplication = dependencies.assertApplicationGates || assertApplicationGates;
  const launchBrowser = dependencies.launchBrowser || ((options) => chromium.launch(options));
  const now = dependencies.now || (() => new Date().toISOString());
  const approvalLedger = dependencies.approvalLedger
    || (args.approvalRoot ? new ApprovalLedger({ rootPath: resolve(args.approvalRoot) }) : null);
  const checkpointStore = dependencies.checkpointStore
    || (args.checkpointRoot ? new BrowserCheckpointStore({ rootPath: resolve(args.checkpointRoot) }) : null);
  for (const key of ['url', 'company', 'role']) if (!args[key]) throw new Error(`--${key} required`);
  const safety = rejectPrivateOrInvalid(args.url);
  if (safety) throw new Error(`unsafe application URL: ${safety.reason}`);

  const profilePath = resolve(PROJECT_ROOT, 'config', 'profile.yml');
  const profile = existsSync(profilePath) ? readYaml(profilePath) : null;
  let resumePath = args.resume ? resolve(PROJECT_ROOT, args.resume) : null;
  let artifactResolution = null;
  if (!resumePath && args.report) {
    artifactResolution = resolveArtifact({ projectRoot: PROJECT_ROOT, company: args.company, role: args.role, reportPath: args.report, candidate: args.candidate, reportId: args.reportId });
    if (artifactResolution.ok) resumePath = artifactResolution.artifact.pdfPath;
  }

  const artifactMetadata = artifactResolution?.artifact?.metadata || null;
  const approvalIdentity = exactApplyIdentity(args, artifactMetadata);
  const approvalArtifact = exactApplyArtifact(args, resumePath, artifactMetadata);
  const approval = verifyDraftSaveApproval({
    approvalId: args.approvalId || args.approval,
    approvalLedger,
    identity: approvalIdentity,
    artifactIdentity: approvalArtifact,
    callerPath: args.callerPath || APPLY_CALLER_PATH,
    packetReview: args.packetReview,
    now: now(),
  });
  if (!checkpointStore) throw approvalBlocker('an explicit checkpoint store/root is required before opening the application form', 'CHECKPOINT_STORE_REQUIRED');
  const checkpointKey = {
    callerPath: args.callerPath || APPLY_CALLER_PATH,
    identity: approvalIdentity,
    artifactIdentity: approvalArtifact,
  };
  const resumedCheckpoint = typeof checkpointStore.resume === 'function'
    ? checkpointStore.resume({ ...checkpointKey, portalUrl: args.url }, { now: now() })
    : null;
  const answersPath = args.answers ? resolve(PROJECT_ROOT, args.answers) : DEFAULT_ANSWERS_PATH;
  const answers = existsSync(answersPath) ? parseAnswerBank(readFileSync(answersPath, 'utf8')) : [];
  let gate;
  const launchUrl = resumedCheckpoint?.ok && resumedCheckpoint.checkpoint?.portalUrl
    ? resumedCheckpoint.checkpoint.portalUrl
    : args.url;
  try {
    gate = gateApplication({
      url: args.url,
      company: args.company,
      role: args.role,
      portalFamily: args.portal,
      jobLive: true,
      profile,
      answers,
      resumePath,
      resumeExists: Boolean(resumePath && existsSync(resumePath)),
      artifactMetadataValid: Boolean(args.report || args.resume),
      approved: true,
      trackerReady: args.trackerReady,
      referral: args.referral,
    });
  } catch (error) {
    persistBlockedDraft(args, resumePath, blockerMessages(error), 'blocked_before_save', args.url, draftUpsert);
    error.draftStatus = 'blocked_before_save';
    throw error;
  }
  let workflow = gate.run;
  workflow = withStep(workflow, {
    id: 'validate',
    state: 'completed',
    detail: 'all application preconditions passed before browser launch',
    completedAt: new Date().toISOString(),
  });
  const browser = await launchBrowser({ headless: !args.headed });
  const page = await browser.newPage();
  const pages = [];
  const fillBlockers = [];
  let navigation = null;
  let lastSave = { status: 'not_available', label: null };
  let approvalConsumed = false;
  try {
    workflow = withStep(workflow, { id: 'open', state: 'in_progress', startedAt: new Date().toISOString(), detail: 'visible browser form opened' });
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const adapter = detectPortalAdapter({ url: page.url(), roleUrl: args.url, portalFamily: args.portal });
    workflow = withStep(workflow, { id: 'open', state: 'completed', completedAt: new Date().toISOString(), detail: `portal adapter selected: ${adapter.id}` });
    persistCheckpoint(checkpointStore, args, resumePath, artifactMetadata, 'open', 'pending', page.url() || args.url);

    for (let step = 0; step < 20; step += 1) {
      const context = portalAdapterContext(page, args, profile, answers, resumePath, adapter);
      const genericFallbackBlocked = adapter.id === 'generic-portal'
        && String(args.portal || '').trim().toLowerCase() !== 'custom';
      const result = args.dryRun && !genericFallbackBlocked
        ? await fillApplicationPage(page, { profile, answers, resumePath, dryRun: true })
        : adapterFillResult(await adapter.fill(context));
      fillBlockers.push(...result.blockers);
      persistCheckpoint(
        checkpointStore,
        args,
        resumePath,
        artifactMetadata,
        'fill',
        'unsaved',
        page.url() || args.url,
        {
          filledCount: result.filled?.length,
          skippedCount: result.skipped?.length,
          blockerCount: result.blockers?.length,
          forbiddenCount: result.forbiddenControls?.length,
        },
      );
      persistCheckpoint(checkpointStore, args, resumePath, artifactMetadata, 'save', 'pending', page.url() || args.url, {
        filledCount: result.filled?.length,
        skippedCount: result.skipped?.length,
        blockerCount: result.blockers?.length,
        forbiddenCount: result.forbiddenControls?.length,
      });
      const save = args.dryRun && !genericFallbackBlocked
        ? { status: 'dry_run' }
        : adapterSaveResult(await adapter.saveDraft(context));
      lastSave = save;
      const saveState = verifiedSaveResult(save) ? 'verified' : (save.status === 'clicked' ? 'pending' : save.status);
      persistCheckpoint(checkpointStore, args, resumePath, artifactMetadata, 'verify_save', saveState, page.url() || args.url, {
        filledCount: result.filled?.length,
        skippedCount: result.skipped?.length,
        blockerCount: result.blockers?.length,
        forbiddenCount: result.forbiddenControls?.length,
      });
      if (!approvalConsumed && verifiedSaveResult(save)) {
        consumeVerifiedDraftSave({
          approval,
          approvalLedger,
          identity: approvalIdentity,
          artifactIdentity: approvalArtifact,
          save,
          now: now(),
        });
        approvalConsumed = true;
      }
      pages.push({ step: step + 1, adapter: adapter.id, result, save });

      navigation = args.dryRun && !genericFallbackBlocked
        ? await advanceApplicationPage(page, { dryRun: true })
        : adapterNavigationResult(await continuePortalAdapter(adapter, {
          ...context,
          url: page.url() || args.url,
        }));
      if (navigation.status !== 'clicked') break;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    if (navigation?.status === 'clicked') {
      navigation = {
        status: 'blocked',
        action: 'handoff_review',
        reason: 'navigation limit reached before a safe checkpoint',
      };
    }

    const navigationBlockers = ['ambiguous', 'blocked', 'manual_authentication'].includes(navigation?.status)
      ? [navigation.reason]
      : [];
    const saveBlockers = !args.dryRun && !verifiedSaveResult(lastSave)
      ? [`draft save ${lastSave.status.replace(/_/g, ' ')}; values may not be persisted`]
      : [];
    workflow = addWorkflowBlockers(workflow, fillBlockers, 'field', 'Complete or review the blocked fields manually');
    workflow = addWorkflowBlockers(workflow, navigationBlockers, 'manual_review', 'Resolve the checkpoint manually without submitting');
    workflow = addWorkflowBlockers(workflow, saveBlockers, 'save', 'Save the draft manually before leaving this application');

    const blockedBeforeSave = !args.dryRun
      && (lastSave.status === 'ambiguous'
        || lastSave.status === 'blocked'
        || (lastSave.status === 'not_available' && fillBlockers.length > 0));
    const draftStatus = blockedBeforeSave
      ? 'blocked_before_save'
      : navigation?.status === 'review_required'
        ? (verifiedSaveResult(lastSave) ? 'review_ready' : 'filled_not_saved')
        : verifiedSaveResult(lastSave) ? 'saved_draft' : 'filled_not_saved';
    workflow = withDraftStatus(workflow, draftStatus);
    workflow = withResumePairing(workflow, {
      artifactPath: relative(PROJECT_ROOT, resumePath),
      company: args.company,
      role: args.role,
      roleUrl: args.url,
      reportPath: args.report,
    });
    workflow = withResumableUrl(workflow, page.url());
    workflow = withStep(workflow, { id: 'fill', state: 'completed', completedAt: new Date().toISOString() });
    workflow = withStep(workflow, { id: 'save', state: verifiedSaveResult(lastSave) ? 'completed' : 'blocked', detail: lastSave.status });
    persistCheckpoint(checkpointStore, args, resumePath, artifactMetadata, 'pause', verifiedSaveResult(lastSave) ? 'verified' : 'unsaved', page.url() || args.url, {
      filledCount: pages.at(-1)?.result?.filled?.length,
      skippedCount: pages.at(-1)?.result?.skipped?.length,
      blockerCount: fillBlockers.length,
      forbiddenCount: pages.at(-1)?.result?.forbiddenControls?.length,
    });
    workflow = withStep(workflow, { id: 'pause', state: 'completed', detail: navigation?.reason || 'safe checkpoint reached', completedAt: new Date().toISOString() });
    if (['saved_draft', 'review_ready'].includes(draftStatus)) {
      workflow = markReviewHandoff(workflow, {
        reason: navigation?.reason || 'Candidate review required before final submission',
        candidateAction: 'Review the visible application and submit manually if satisfied',
      });
    }

    const notes = [
      ...workflow.blockers.map(({ message }) => message),
      navigation?.reason,
    ].filter(Boolean);
    draftUpsert({
      company: args.company,
      role: args.role,
      roleUrl: args.url,
      portal: portalFamilyForAdapter(adapter, { url: page.url(), roleUrl: args.url, portalFamily: args.portal }),
      draftStatus,
      resume: relative(PROJECT_ROOT, resumePath),
      resumeUrl: page.url() || args.url,
      referral: args.referral,
      notes: notes.join(' ; ') || 'Final review required; no submit control clicked.',
    });
    console.log(JSON.stringify({
      company: args.company,
      role: args.role,
      url: args.url,
      resume: relative(PROJECT_ROOT, resumePath),
      pages,
      navigation,
      workflow,
      draftStatus,
    }, null, 2));
    const shouldPause = args.pause
      || (args.headed && navigation?.status === 'manual_authentication' && process.stdin.isTTY);
    if (shouldPause) {
      process.stderr.write('Application is paused before final submission. Press Enter to close the browser.');
      await new Promise((resolvePromise) => process.stdin.once('data', resolvePromise));
    }
  } catch (error) {
    if (typeof checkpointStore?.recoverFailure === 'function') {
      try {
        checkpointStore.recoverFailure({
          ...checkpointKey,
          currentStep: 'pause',
          saveState: { status: verifiedSaveResult(lastSave) ? 'verified' : 'failed' },
          code: error.code || 'BROWSER_CHECKPOINT_FAILURE',
          message: error.message,
          at: now(),
        }, { now: now() });
      } catch {}
    }
    const messages = [
      ...blockerMessages(error),
      ...workflow.blockers.map(({ message }) => message),
    ];
    try {
      persistBlockedDraft(
        args,
        resumePath,
        [...new Set(messages)],
        verifiedSaveResult(lastSave) ? 'saved_draft' : 'blocked_before_save',
        page.url() || args.url,
        draftUpsert,
      );
    } catch (ledgerError) {
      error.message = `${error.message}; draft ledger recovery failed: ${ledgerError.message}`;
    }
    throw error;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (Array.isArray(error.blockers) && error.blockers.length) {
      console.error(JSON.stringify({
        status: error.draftStatus || 'blocked_before_save',
        blockers: error.blockers,
        nextAction: 'Resolve the reported blockers before retrying the application',
      }, null, 2));
    }
    console.error(`apply-browser failed: ${error.message}`);
    process.exitCode = 1;
  });
}
