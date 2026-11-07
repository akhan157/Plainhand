// The browser extension's side of hosted Plainhand (docs/internal/HOSTED-CONNECTOR-PLAN.md §6).
//
//   POST /api/extension/match      { url }                        → the saved role for this page
//   POST /api/extension/plan       { jobId, fields }              → answers for the page's form
//   GET  /api/extension/file?jobId=&kind=resume|cover             → the approved PDF
//   POST /api/extension/save-job   { company, title, url, description, location? }
//   POST /api/extension/submitted  { jobId }                      → records Applied
//
// The caller (app.mjs) has already verified the extension's OAuth access token and
// passes the one userId and workspace it belongs to. Every route reads and writes only
// that workspace. The extension is the candidate acting in their own signed-in
// browser, so its actions run as the candidate ('ui'), exactly like the local app's
// buttons; chat connectors never reach these routes.
//
// Only field labels, types, options and the page URL arrive here, never page contents
// beyond what "Save this job" sends on purpose. Nothing here fills or submits a form:
// the extension does the filling and the candidate submits.
import { digest } from '../store.mjs';
import { assertPacketFresh, packetIdentity, suggestFormAnswers } from '../workflow.mjs';
import { AnswerBank } from '../answer-bank.mjs';
import { presubmitCheck } from '../presubmit.mjs';
import { isSensitiveLabel } from '../field-policy.mjs';
import { jobUrl, isBoardUrl } from '../jobs.mjs';

export const EXTENSION_PREFIX = '/api/extension/';
const SMALL = 16 * 1024;
const LIMITS = { match: SMALL, plan: 512 * 1024, 'save-job': 256 * 1024, submitted: SMALL };
const MAX_FIELDS = 300;
const FIELD_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'checkbox', 'file', 'select-one', 'combobox', 'radio']);
const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url']);
const SUBMITTED = ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'];
const RESUME = '__resume__';
const COVER = '__cover_letter__';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Browser extensions call from their own origin with a bearer token, never a cookie,
// so echoing an extension origin is safe. Web pages get no CORS access.
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+$/i;
export function extensionCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && EXTENSION_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readJson(req, limit) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (JSON.stringify(req.body).length > limit) throw new HttpError(413, 'That request is too large.');
    return req.body;
  }
  const declared = Number(req.headers?.['content-length'] || 0);
  if (declared > limit) throw new HttpError(413, 'That request is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let value;
  try { value = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'The request was not valid JSON.');
  return value;
}

const str = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `Missing ${name}.`);
  if (value.length > max) throw new HttpError(400, `The ${name} is too long.`);
  return value.trim();
};

// Two URLs are the same posting when they normalise to the same page, ignoring a
// trailing slash and the /apply step (Lever, Ashby), or carry the same Greenhouse
// job id (employer pages embed Greenhouse with ?gh_jid=).
function urlKeys(value) {
  let href;
  try { href = jobUrl(value); } catch { return { keys: [], ghId: null }; }
  const url = new URL(href);
  const path = url.pathname.replace(/\/+$/, '');
  const base = url.origin + path.replace(/\/(apply|application)$/i, '');
  const ghId = url.searchParams.get('gh_jid') || url.pathname.match(/\/jobs\/(\d{4,})(?:\/|$)/)?.[1] || null;
  return { keys: [href, url.origin + path, base], ghId };
}
export function matchJob(jobs, pageUrl) {
  const page = urlKeys(pageUrl);
  if (!page.keys.length) return null;
  const hits = jobs.filter(job => [job.url, job.applyUrl].filter(Boolean).some(saved => {
    const known = urlKeys(saved);
    return known.keys.some(key => page.keys.includes(key)) || (page.ghId && known.ghId === page.ghId);
  }));
  // Prefer the role that is ready to fill, then the most recent.
  return hits.find(job => job.approvedHash && job.approvedHash === packetIdentity(job)) || hits[0] || null;
}

async function packetState(workspace, state, job) {
  if (job.submittedAt || SUBMITTED.includes(job.status)) return { packet: 'submitted', text: 'You marked this application as submitted.' };
  if (!job.packet) return { packet: 'none', text: 'No application written yet. Ask Plainhand to write it first.' };
  try { assertPacketFresh(job, await workspace.context(state)); } catch { return { packet: 'stale', text: 'Your profile or this job changed. Ask Plainhand to write the application again.' }; }
  if (!job.approvedHash || job.approvedHash !== packetIdentity(job)) return { packet: 'needs-approval', text: 'Read and approve your application on the Plainhand website first.' };
  return { packet: 'approved', text: 'Approved and ready to fill.' };
}

function findJob(state, jobId) {
  if (typeof jobId !== 'string' || !jobId || jobId.length > 100) throw new HttpError(400, 'Missing jobId.');
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) throw new HttpError(404, 'That role is not in your Plainhand workspace.');
  return job;
}

// The same gate as the local app's form filling: an approved, current packet whose
// resume file is the one approved, for a role not already submitted.
async function approvedJob(workspace, state, jobId) {
  const job = findJob(state, jobId);
  const status = await packetState(workspace, state, job);
  if (status.packet !== 'approved') throw new HttpError(409, status.text);
  if (!job.selected) throw new HttpError(409, 'Choose this role for application on the Plainhand website first.');
  if (job.evaluation?.score < 4 && !job.overrideReason) throw new HttpError(409, 'Record your reason for pursuing this role below 4/5 first.');
  const pdf = job.pdf ? await workspace.readBinary(job.pdf) : null;
  if (!pdf || digest(pdf) !== job.pdfHash) throw new HttpError(409, 'The resume file changed. Ask Plainhand to write the application again, then approve it.');
  return job;
}

const coverFile = job => (job.artifacts || []).find(file => /cover-letter.*\.pdf$/.test(file)) || null;

function cleanFields(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'No form fields were found on this page.');
  if (raw.length > MAX_FIELDS) throw new HttpError(413, 'This page has too many fields to fill at once.');
  const seen = new Set();
  return raw.map(field => {
    if (!field || typeof field !== 'object') throw new HttpError(400, 'A form field was not readable.');
    const key = typeof field.key === 'string' && /^[\w:.-]{1,80}$/.test(field.key) ? field.key : null;
    if (!key || seen.has(key)) throw new HttpError(400, 'A form field was not readable.');
    seen.add(key);
    if (!FIELD_TYPES.has(field.type)) throw new HttpError(400, 'A form field had an unknown type.');
    const label = typeof field.label === 'string' ? field.label.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const options = Array.isArray(field.options) ? field.options.filter(o => typeof o === 'string').slice(0, 200).map(o => o.slice(0, 200)) : [];
    const maxLength = Number.isInteger(field.maxLength) && field.maxLength > 0 ? field.maxLength : undefined;
    return { key, label: label || 'Unlabelled field', type: field.type, required: field.required === true, options: field.type === 'select-one' ? options.map(o => ({ value: o, label: o })) : options, maxLength };
  });
}

async function plan(workspace, input) {
  const state = await workspace.load();
  const job = await approvedJob(workspace, state, input.jobId);
  const fields = cleanFields(input.fields);
  const suggested = suggestFormAnswers(fields, state.profile, job.packet, { bank: await new AnswerBank(workspace).load(), job });
  const cover = coverFile(job);
  const answers = {}, identity = [];
  for (const field of fields) {
    let value = suggested[field.key];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value === COVER && !cover) continue;
    if ((value === RESUME || value === COVER) !== (field.type === 'file')) continue;
    if (isSensitiveLabel(field.label)) {
      // Only the name rules answer a field whose label has a sensitive word
      // ("Legal name"); every choice and every other answer is the candidate's.
      if (!TEXT_TYPES.has(field.type)) continue;
      identity.push(field.key);
    }
    if (field.type !== 'file') value = value.slice(0, field.maxLength ? Math.min(field.maxLength, 20000) : 20000);
    answers[field.key] = value;
  }
  const check = presubmitCheck({ fields, answers, questions: [], profile: state.profile });
  const left = check.items.filter(item => item.status !== 'filled').map(({ key, label, required, reason, text }) => ({ key, label, required, reason, text }));
  return {
    jobId: job.id, company: job.company, title: job.title,
    answers, identity,
    files: { resume: Object.values(answers).includes(RESUME), cover: Object.values(answers).includes(COVER) },
    check, left,
    note: 'Check every answer on the page, answer what is left, then submit it yourself.',
  };
}

async function file(workspace, url) {
  const kind = url.searchParams.get('kind');
  if (!['resume', 'cover'].includes(kind)) throw new HttpError(400, 'Ask for the resume or the cover letter.');
  const state = await workspace.load();
  const job = await approvedJob(workspace, state, url.searchParams.get('jobId') || '');
  const path = kind === 'resume' ? job.pdf : coverFile(job);
  if (!path) throw new HttpError(404, 'This application has no cover letter.');
  const bytes = await workspace.readBinary(path);
  if (!bytes) throw new HttpError(404, 'That file is missing. Ask Plainhand to write the application again.');
  return { bytes, name: path.split('/').pop() };
}

async function saveJob(workspace, registry, input) {
  const company = str(input.company, 200, 'company');
  const title = str(input.title, 300, 'job title');
  const url = str(input.url, 2000, 'page address');
  const description = typeof input.description === 'string' ? input.description.slice(0, 45000) : '';
  const location = typeof input.location === 'string' ? input.location.slice(0, 300) : undefined;
  let normalised;
  try { normalised = jobUrl(url); } catch (error) { throw new HttpError(400, error.message); }
  const state = await workspace.load();
  const existing = matchJob(state.jobs, normalised);
  if (existing) return { status: 200, body: { saved: false, jobId: existing.id, message: 'This job is already in Plainhand.' } };
  try {
    const { result } = await registry.run('jobs.add', { company, title, url: normalised, description, ...(location ? { location } : {}) }, { actor: 'ui' });
    const message = isBoardUrl(normalised) ? 'Saved. Add the employer’s own application link in Plainhand before applying.' : 'Saved to Plainhand.';
    return { status: 201, body: { saved: true, jobId: result.id, message } };
  } catch (error) {
    throw new HttpError(409, error.message || 'Plainhand could not save this job.');
  }
}

async function submitted(workspace, registry, input) {
  const state = await workspace.load();
  const job = findJob(state, input.jobId);
  if (job.submittedAt) return { status: 'Applied', already: true };
  try { await registry.run('jobs.confirmSubmitted', { jobId: job.id }, { actor: 'ui' }); }
  catch (error) { throw new HttpError(409, error.message || 'Plainhand could not record this.'); }
  return { status: 'Applied', already: false };
}

// Returns true when it served the request (any path under /api/extension/).
export async function handleExtensionApi(req, res, { userId, workspace, registry } = {}) {
  const url = new URL(req.url, 'http://extension.invalid');
  if (!url.pathname.startsWith(EXTENSION_PREFIX)) return false;
  extensionCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const route = url.pathname.slice(EXTENSION_PREFIX.length);
  try {
    if (!userId || !workspace) throw new HttpError(401, 'Sign in to Plainhand in the extension.');
    if (route === 'file') {
      if (req.method !== 'GET') throw new HttpError(405, 'Use GET for files.');
      const { bytes, name } = await file(workspace, url);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(bytes);
      return true;
    }
    if (!Object.hasOwn(LIMITS, route)) throw new HttpError(404, 'Unknown extension request.');
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST for this request.');
    const input = await readJson(req, LIMITS[route]);
    if (route === 'match') {
      const pageUrl = str(input.url, 4000, 'page address');
      const state = await workspace.load();
      const job = matchJob(state.jobs, pageUrl);
      if (!job) { send(res, 200, { match: null, text: 'This page is not one of your saved roles.' }); return true; }
      const status = await packetState(workspace, state, job);
      send(res, 200, { match: { jobId: job.id, company: job.company, title: job.title, status: job.status || null, submittedAt: job.submittedAt || null, ...status } });
      return true;
    }
    if (route === 'plan') { send(res, 200, await plan(workspace, input)); return true; }
    if (route === 'save-job') { const { status, body } = await saveJob(workspace, registry, input); send(res, status, body); return true; }
    if (route === 'submitted') { send(res, 200, await submitted(workspace, registry, input)); return true; }
  } catch (error) {
    if (error instanceof HttpError) { send(res, error.status, { error: error.message }); return true; }
    send(res, 500, { error: 'Something went wrong in Plainhand. Try again.' });
    return true;
  }
  return true;
}
