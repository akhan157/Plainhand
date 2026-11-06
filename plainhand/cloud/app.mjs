// Hosted Plainhand: one Node (req, res) handler for the website, sign-in, and the
// optional connector, extension and step modules (docs/HOSTED-CONNECTOR-PLAN.md).
// Stateless between requests: every request resolves its user from the session cookie
// (or a bearer token) and works only on that user's Postgres-backed workspace.
//
// deps: { sql, env, auth, accounts, sessions, now,
//         oauth?, handleMcp?, handleExtensionApi?, stepRunner?, makeAgent?, features?, limits? }
//   stepRunner(options) builds a runner for one workspace (createStepRunner from steps.mjs).
//   makeAgent({ userId, workspace }) returns the workflow agent; without it model calls
//   fail with a plain "connect your AI" message.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { digest, now as isoNow, requireText, cleanText } from '../store.mjs';
import { Workflow } from '../workflow.mjs';
import { AnswerBank } from '../answer-bank.mjs';
import { Corrections } from '../corrections.mjs';
import { AuditLog } from '../audit.mjs';
import { followUpQueue } from '../application-record.mjs';
import { createRegistry, STATUS_VALUES, CORE_ATTENTION } from '../actions.mjs';
import { profileStrength } from '../profile-strength.mjs';
import { currentCalibration } from '../claim-calibration.mjs';
import { candidateLine } from '../claim-line.mjs';
import { standardStatus, autonomyOf } from '../standard.mjs';
import { FEATURES } from '../features/index.mjs';
import { StorageError } from '../storage.mjs';
import { newCodeVerifier } from './supabase-auth.mjs';
import { importResume } from './resume-import.mjs';
import { readConnectionCheck } from './connection-check.mjs';
import { renderCloudPacket, verifyCloudJob } from './runtime.mjs';
import { publicPage } from './public-pages.mjs';
import { reportServerError } from './diagnostics.mjs';
import { setupCoverage } from '../web/ui/connect-data.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const ASSET_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
export const SESSION_COOKIE = '__Host-plainhand_session';
export const PKCE_COOKIE = '__Host-plainhand_pkce';
const MAX_BODY = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB
const SESSION_SECONDS = 30 * 24 * 60 * 60;
// Features hidden in the cloud (plan §5). Follow-ups stay.
const CLOUD_FEATURES = FEATURES.filter(feature => !['campaigns', 'insights'].includes(feature.name));
const LOCAL_ONLY = new Set(['/api/provider', '/api/provider/setup', '/api/provider/login', '/api/provider/test', '/api/import', '/api/import/preview', '/api/format/derive', '/api/format/preview', '/api/agent/history', '/api/agent/message', '/api/agent/confirm', '/api/agent/undo', '/api/agent/cancel', '/api/agent/clear']);
export const DEFAULT_LIMITS = {
  ip: { limit: 300, seconds: 60 }, // every non-asset request
  user: { limit: 120, seconds: 60 }, // state-changing requests per signed-in user
  signinIp: { limit: 20, seconds: 3600 },
  signinEmail: { limit: 5, seconds: 3600 },
  help: { limit: 10, seconds: 3600 },
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { out[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return out;
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// For oauth.mjs: who is signed in to the website on this request.
export function sessionUserReader(sessions) {
  return async req => (await sessions.resolve(parseCookies(req.headers.cookie)[SESSION_COOKIE]))?.userId || null;
}

const safeEqual = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y) && String(a).length === String(b).length;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Fixed-window counters in plainhand.rate_limits. Keys are hashed before storage.
export function createRateLimiter({ sql, now = () => new Date(), salt = '' }) {
  return {
    async hit(key, { limit, seconds }) {
      const windowMs = seconds * 1000, start = new Date(Math.floor(now().getTime() / windowMs) * windowMs);
      const hashed = createHash('sha256').update(salt + ':' + key).digest('hex');
      const [row] = await sql`insert into plainhand.rate_limits (key, window_start, count) values (${hashed}, ${start}, 1)
        on conflict (key, window_start) do update set count = plainhand.rate_limits.count + 1 returning count`;
      if (row.count > limit) throw new HttpError(429, 'Too many requests. Wait a minute and try again.', { retryAfter: Math.ceil((start.getTime() + windowMs - now().getTime()) / 1000) });
    },
    async purge() { await sql`delete from plainhand.rate_limits where window_start < ${new Date(now().getTime() - 24 * 60 * 60 * 1000)}`; },
  };
}

function clientIp(req) {
  return String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
}

async function readBody(req, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Upload is too large. Maximum request size is 4 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function jsonBody(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send application/json.');
  const text = await readBody(req);
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new HttpError(400, 'Invalid JSON request.'); }
}

// Short pages for signing in. Styles come from /css/tokens.css and /auth.css (CSP: no inline).
const AUTH_CSS = `body{margin:0;font-family:system-ui,sans-serif;background:var(--bg,#f5f6f1);color:var(--text,#1d1f1a)}
main{max-width:26rem;margin:12vh auto;padding:0 16px}
h1{font-size:1.6rem;margin:0 0 .5rem}p{line-height:1.5}
.button,button{display:block;box-sizing:border-box;width:100%;padding:.8rem 1rem;margin:.6rem 0;border-radius:.6rem;border:1px solid #c9ccc0;background:#fff;color:inherit;font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.primary{background:#1d1f1a;color:#fff;border-color:#1d1f1a}
input{box-sizing:border-box;width:100%;padding:.75rem;border-radius:.6rem;border:1px solid #c9ccc0;font:inherit}
label{display:block;margin-top:1.4rem;font-weight:600}.note{color:#5b5f54;font-size:.9rem}.error{color:#a3261b}.ok{color:#2d6a2f}
@media (prefers-color-scheme:dark){body{background:#151612;color:#ecede6}.button,button,input{background:#22241e;color:#ecede6;border-color:#44473d}.primary{background:#ecede6;color:#151612}.note{color:#a9ad9f}}`;
function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Plainhand</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/auth.css"></head>
<body><main>${inner}</main></body></html>`;
}
function signInPage({ message = '', error = '' } = {}) {
  return page('Sign in', `<h1>Sign in to Plainhand</h1>
<p>Your job search workspace, online.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}${message ? `<p class="ok" role="status">${escapeHtml(message)}</p>` : ''}
<a class="button primary" href="/auth/google">Continue with Google</a>
<form method="post" action="/auth/email">
<label for="email">Or get a sign-in link by email</label>
<input id="email" name="email" type="email" autocomplete="email" required maxlength="320">
<button type="submit">Email me a sign-in link</button>
</form>
<p class="note">No password needed. Your workspace is stored online.</p><nav aria-label="Information"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></nav>`);
}
function deletePage(csrf) {
  return page('Delete account', `<h1>Delete your account?</h1>
<p>This removes your profile, roles, applications, files and connected apps. It cannot be undone. Export your workspace first if you want a copy.</p>
<form method="post" action="/account/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="confirm" value="yes">
<button type="submit" class="primary">Delete my account</button></form>
<a class="button" href="/">Cancel</a>`);
}

export function createCloudApp(deps) {
  const { sql, env = {}, auth, accounts, sessions, oauth, handleMcp, handleExtensionApi, stepRunner, makeAgent, features = CLOUD_FEATURES } = deps;
  const now = deps.now || (() => new Date());
  const limits = { ...DEFAULT_LIMITS, ...(deps.limits || {}) };
  if (!env.SITE_URL) throw new Error('SITE_URL is not set.');
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  const site = new URL(env.SITE_URL), siteOrigin = site.origin, siteUrl = siteOrigin;
  const callbackUrl = siteOrigin + '/auth/callback';
  const limiter = createRateLimiter({ sql, now, salt: env.SESSION_SECRET });
  // The page's anti-forgery token: tied to the session, never stored.
  const csrfFor = cookieValue => createHmac('sha256', env.SESSION_SECRET).update('csrf:' + cookieValue).digest('base64url');
  let indexHtml = null;

  // One Workspace/Workflow/registry per user, reused while this instance is warm so
  // short-lived undo tokens keep working between requests. Storage is always Postgres,
  // so a cold instance simply starts fresh.
  const contexts = new Map();
  function contextFor(userId) {
    const cached = contexts.get(userId);
    if (cached && cached.expires > Date.now()) { contexts.delete(userId); contexts.set(userId, cached); return cached; }
    const workspace = accounts.workspaceFor(userId);
    const agent = makeAgent ? makeAgent({ userId, workspace }) : async () => { throw new Error('Connect your AI first. Open Connect your AI to set it up.'); };
    const makeWorkflow = agentImpl => {
      const workflow = new Workflow(workspace, { agent: agentImpl, renderer: deps.renderer || renderCloudPacket, verifier: deps.verifier || verifyCloudJob });
      for (const feature of features) for (const [kind, task] of Object.entries(feature.tasks || {})) workflow.registerTask(kind, task);
      return workflow;
    };
    const workflow = makeWorkflow(agent);
    const registry = createRegistry({ workspace, workflow, features });
    const context = { userId, workspace, workflow, registry, makeWorkflow, expires: Date.now() + 10 * 60 * 1000 };
    context.steps = stepRunner ? stepRunner({ workspace, makeWorkflow }) : null;
    contexts.set(userId, context);
    while (contexts.size > 100) contexts.delete(contexts.keys().next().value);
    return context;
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, headers);
    res.end(body);
  }
  const json = (res, status, data, headers = {}) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  const html = (res, status, body, headers = {}) => send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  const redirect = (res, location, cookies = [], status = 303) => send(res, status, '', { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin) return origin === siteOrigin;
    return req.headers['sec-fetch-site'] === 'same-origin';
  }
  const bearer = req => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1] || null;
  // audience: 'mcp' for chat connectors, 'extension' for the browser extension. A token
  // for one never works on the other, so a chat app can never use the extension's
  // candidate actions (such as recording a submission).
  async function bearerUser(req, res, audience) {
    const token = bearer(req), grant = token && oauth ? await oauth.verifyAccessToken(token) : null;
    if (grant?.userId && (grant.audience || 'mcp') === audience) return grant;
    const metadataPath = audience === 'extension' ? '/.well-known/oauth-protected-resource/api/extension' : '/.well-known/oauth-protected-resource';
    json(res, 401, { error: 'Sign in to Plainhand again.' }, { 'WWW-Authenticate': `Bearer resource_metadata="${siteOrigin}${metadataPath}"` });
    return null;
  }

  // The URL constructor resolves .. segments in req.url, including percent-encoded
  // ones, so url.pathname is normalized before it is ever decoded. Decode the raw
  // path first: a %2e%2e segment in the raw request is an escape attempt, not a
  // route, and is refused with 404 instead of being served or redirected.
  function rawPathIsTraversal(rawUrl) {
    let decoded;
    try { decoded = decodeURIComponent(rawUrl || ''); } catch { return true; }
    return decoded.split(/[\\/]/).some(part => part === '..' || part === '.');
  }
  async function serveAsset(res, pathname) {
    let relative;
    try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return false; }
    if (!relative || relative === 'index.html' || relative.split('/').some(part => !part || part.startsWith('.'))) return false;
    const file = path.resolve(WEB_ROOT, relative), type = ASSET_TYPES[path.extname(file)];
    if (!file.startsWith(WEB_ROOT + path.sep) || !type) return false;
    let content;
    try { content = await readFile(file); } catch { return false; }
    send(res, 200, content, { 'Content-Type': type + (/^text\/|json|svg/.test(type) ? '; charset=utf-8' : ''), 'Cache-Control': 'public, max-age=300' });
    return true;
  }

  async function signIn(res, user) {
    const account = await accounts.upsert(user);
    const value = await sessions.create(account.userId);
    redirect(res, '/', [cookie(SESSION_COOKIE, value, SESSION_SECONDS), cookie(PKCE_COOKIE, '', 0)]);
  }

  async function deleteAccount(userId) {
    await sessions.destroyAll(userId);
    await auth.deleteUser(userId); // first, so a failure leaves the account intact to retry
    await accounts.remove(userId); // cascades to workspace files, sessions, OAuth grants and tokens
    contexts.delete(userId);
  }

  async function stateFor({ workspace, workflow, registry }) {
    const state = await workspace.load();
    const context = await workspace.context(state);
    for (const job of state.jobs) job.stale = !!job.packet && (job.contextHash !== context.hash || job.packetJobHash !== digest([job.url, job.company, job.title, job.description]));
    for (const job of state.jobs) if (job.calibration) job.calibration = currentCalibration(state, job);
    return { ...state,
      cloud: true,
      connectionCheck: await readConnectionCheck(workspace),
      onboarding: JSON.parse(await workspace.read('data/plainhand/onboarding.json') || 'null'),
      answerBank: await new AnswerBank(workspace).load(),
      corrections: await new Corrections(workspace).list(),
      audit: await new AuditLog(workspace).list({ limit: 20 }),
      followUps: followUpQueue(state.jobs).map(({ job, ...item }) => ({ ...item, jobId: job.id })),
      agent: { available: false, running: null },
      profileStrength: profileStrength(state),
      claimLineView: candidateLine(state),
      resumeFormat: state.resumeFormat || null,
      standardStatus: standardStatus(state, context.hash),
      autonomy: autonomyOf(state),
      featureAttention: registry.digest(state).attention.filter(item => !CORE_ATTENTION.includes(item.kind)),
      usage: await workflow.usage.summary(state), contextHash: context.hash, sourceManifest: context.sources.map(s => ({ id: s.id, characters: s.text.length })),
      tracker: await workspace.read('data/applications.md'), loginSessions: [], applicationSessions: [] };
  }

  // The website API, ported from plainhand-server.mjs without local-only features.
  async function api(req, res, url, ctx, account) {
    const { workspace, workflow, registry } = ctx;
    const ui = async (name, input) => (await registry.run(name, input, { actor: 'ui' })).result;
    const p = url.pathname;
    if (LOCAL_ONLY.has(p) || p.startsWith('/api/remote/') || p.startsWith('/api/browser/')) return json(res, 404, { error: 'This works only in the Plainhand desktop app.' });
    if (req.method === 'GET') {
      if (p === '/api/connection-check') return json(res, 200, await readConnectionCheck(workspace));
      if (p === '/api/state') return json(res, 200, await stateFor(ctx));
      if (p === '/api/account') return json(res, 200, { email: account.email, createdAt: account.createdAt, usage: await workspace.storage.usage?.() });
      if (p === '/api/events') {
        // Compatibility for older clients. The hosted UI now polls /api/state while
        // visible; the local app keeps its separate persistent event stream.
        const state = await workspace.load();
        return send(res, 200, `retry: 5000\nevent: state\ndata: ${JSON.stringify({ revision: state.revision })}\n\n`, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      }
      if (p === '/api/providers') return json(res, 200, []);
      if (p === '/api/export') {
        return json(res, 200, { ...(await workspace.load()), agentUsage: await workflow.usage.records(), exportedAt: isoNow() }, { 'Content-Disposition': 'attachment; filename="plainhand-workspace.json"' });
      }
      if (p === '/api/artifact') {
        const requested = url.searchParams.get('path');
        const state = await workspace.load();
        if (!requested || !state.jobs.some(j => j.artifacts?.includes(requested) || j.reportPath === requested)) return json(res, 404, { error: 'Artifact not found.' });
        const data = await workspace.readBinary(requested);
        if (!data) return json(res, 404, { error: 'Artifact not found.' });
        return send(res, 200, data, { 'Content-Disposition': `attachment; filename="${path.basename(requested).replace(/[^\w.-]/g, '_')}"`, 'Content-Type': requested.endsWith('.pdf') ? 'application/pdf' : 'text/markdown; charset=utf-8' });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    if (req.method === 'DELETE' && p === '/api/account') {
      const input = await jsonBody(req);
      if (input.confirm !== true) throw new HttpError(400, 'Confirm that you want to delete your account.');
      await deleteAccount(ctx.userId);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Not allowed.' });
    const input = await jsonBody(req);
    if (p === '/api/help') {
      await limiter.hit('help:' + ctx.userId, limits.help);
      const id = randomUUID();
      const errorIds = Array.isArray(input.errorIds) ? input.errorIds.filter(e => typeof e === 'string' && /^[0-9a-f-]{36}$/.test(e)).slice(0, 10) : [];
      const request = { id, at: isoNow(), message: requireText(input.message, 'Your message', 4000), screen: cleanText(input.screen, 100), errorIds, email: account.email, status: 'new' };
      await workspace.write(`data/plainhand/help/${id}.json`, JSON.stringify(request, null, 2) + '\n');
      return json(res, 200, { ok: true, id });
    }
    if (p === '/api/onboarding') {
      if (!['chatgpt', 'claude'].includes(input.provider) || !setupCoverage[input.provider].plans.includes(input.plan)) throw new HttpError(400, 'Choose an AI and a valid plan.');
      await workspace.write('data/plainhand/onboarding.json', JSON.stringify({ provider: input.provider, plan: input.plan }));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/profile') { await workspace.saveProfile(input.profile || {}, input.revision); return json(res, 200, { ok: true }); }
    if (p === '/api/resume/import') {
      return json(res, 200, await importResume(input));
    }
    if (p === '/api/conversation') {
      return json(res, 409, { error: 'Use your connected chat to build your story.', code: 'CHAT_REQUIRED' });
    }
    if (p === '/api/action') {
      if (String(input.name).startsWith('tasks.') && input.name !== 'tasks.cancel') return json(res, 409, { error: 'Ask your connected chat to run this task.', code: 'CHAT_REQUIRED' });
      const { result, undoToken } = await registry.run(cleanText(input.name, 100), input.input ?? {}, { actor: 'ui' });
      return json(res, 200, { ok: true, result, undoToken });
    }
    if (p === '/api/action/undo') return json(res, 200, await registry.undo(cleanText(input.undoToken, 100)));
    if (p === '/api/understanding/approve') { await ui('understanding.approve'); return json(res, 200, { ok: true }); }
    if (p === '/api/sources') { await ui('sources.add', { name: input.name, url: input.url }); return json(res, 200, { ok: true }); }
    if (p === '/api/sources/remove') { await ui('sources.remove', { sourceId: input.id }); return json(res, 200, { ok: true }); }
    if (p === '/api/jobs') {
      const { id } = await ui('jobs.add', { company: input.company, title: input.title, url: input.url, description: input.description, location: input.location });
      return json(res, 201, { id });
    }
    if (p === '/api/jobs/update') {
      const jobId = input.id;
      if (input.status && !STATUS_VALUES.has(input.status)) throw new Error('Invalid application status.');
      if (input.status === 'Applied' && input.confirmSubmitted !== true) throw new Error('Confirm that you personally submitted this application.');
      const context = Object.fromEntries(['description', 'roleAnswers', 'overrideReason'].filter(key => typeof input[key] === 'string').map(key => [key, input[key]]));
      if (Object.keys(context).length) await ui('jobs.setContext', { jobId, ...context });
      if (typeof input.selected === 'boolean') await ui('jobs.select', { jobId, selected: input.selected });
      if (input.status) await ui(input.status === 'Applied' ? 'jobs.confirmSubmitted' : 'jobs.setStatus', input.status === 'Applied' ? { jobId } : { jobId, status: input.status });
      if (!Object.keys(context).length && typeof input.selected !== 'boolean' && !input.status) await ui('jobs.get', { jobId });
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/jobs/record/')) {
      const action = p.slice('/api/jobs/record/'.length), jobId = input.id;
      const fields = (name, value) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key]) => key !== 'jobId' && Object.hasOwn(registry.get(name).input, key)));
      const calls = {
        contact: () => ui('record.addContact', { ...fields('record.addContact', input.contact), jobId }),
        interview: () => ui('record.addInterview', { ...fields('record.addInterview', input.interview), jobId }),
        'interview-status': () => ui('record.setInterviewStatus', { jobId, entryId: input.entryId, status: input.status }),
        'remove-contact': () => ui('record.removeContact', { jobId, entryId: input.entryId }),
        'remove-interview': () => ui('record.removeInterview', { jobId, entryId: input.entryId }),
        'next-action': () => ui('record.setNextAction', { jobId, text: input.text, due: input.due }),
      };
      if (!Object.hasOwn(calls, action)) throw new Error('Unknown application record action.');
      return json(res, 200, { ok: true, entry: (await calls[action]()) ?? null });
    }
    if (p === '/api/answer-bank/remove') {
      if (!await new AnswerBank(workspace).remove(cleanText(input.id, 100))) throw new Error('Reusable answer not found.');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/corrections') return json(res, 200, { corrections: await new Corrections(workspace).list() });
    if (p === '/api/corrections/propose') return json(res, 201, { correction: await ui('corrections.propose', { jobId: input.jobId, question: input.question, previous: input.previous, answer: input.answer, evidence: input.evidence, scope: input.scope === 'global' ? 'global' : undefined }) });
    if (p === '/api/corrections/approve' || p === '/api/corrections/reject') return json(res, 200, { correction: await ui(p.endsWith('/approve') ? 'corrections.approve' : 'corrections.reject', { id: input.id }) });
    if (p === '/api/tasks') {
      return json(res, 409, { error: 'Ask your connected chat to run this task.', code: 'CHAT_REQUIRED' });
    }
    if (p === '/api/tasks/cancel') { await ui('tasks.cancel', { taskId: input.id }); return json(res, 200, { ok: true }); }
    if (p === '/api/jobs/apply-link') return json(res, 200, await ui('jobs.setApplyLink', { jobId: input.id, applyUrl: input.applyUrl }));
    if (p === '/api/format/save') return json(res, 200, await ui('format.save', input.reset ? { reset: true } : { format: input.format }));
    if (p === '/api/standard/approve') { await ui('standard.approve', {}); return json(res, 200, { ok: true }); }
    if (p === '/api/settings/autonomy') return json(res, 200, await ui('settings.autonomy', { enabled: input.enabled === true, ...(input.perDay != null ? { perDay: Number(input.perDay) } : {}), ...(input.minScore != null ? { minScore: Number(input.minScore) } : {}) }));
    if (p === '/api/samples/add') return json(res, 200, await ui('profile.addWritingSample', { title: input.title || '', text: input.text }));
    if (p === '/api/samples/remove') { await ui('profile.removeWritingSample', { id: input.id }); return json(res, 200, { ok: true }); }
    if (p === '/api/calibration/decide') return json(res, 200, (await ui('calibration.decide', { jobId: input.id, claimId: input.claimId, decision: input.decision })) || { ok: true });
    if (p === '/api/line/remove') { await ui('line.removeStatement', { index: input.index }); return json(res, 200, { ok: true }); }
    if (p === '/api/packet/approve') { await ui('packet.approve', { jobId: input.id }); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Not found.' });
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', siteOrigin), p = url.pathname, method = req.method || 'GET';
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (rawPathIsTraversal((req.url || '').split('?')[0].split('#')[0])) return json(res, 404, { error: 'Not found.' });

    // Static front-end files are public (no user data) and not rate limited.
    if (method === 'GET' && p === '/auth.css') return send(res, 200, AUTH_CSS, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    if (method === 'GET' && p !== '/' && !p.startsWith('/api/') && !p.startsWith('/auth/') && !p.startsWith('/oauth/') && !p.startsWith('/.well-known/') && await serveAsset(res, p)) return;

    if (method === 'GET' && ['/privacy', '/terms', '/support'].includes(p)) return html(res, 200, publicPage(p, env.SUPPORT_URL));

    if (p === '/api/cron/daily') {
      if (method !== 'GET') return json(res, 405, { error: 'Not allowed.' });
      if (!env.CRON_SECRET || !safeEqual(bearer(req) || '', env.CRON_SECRET)) return json(res, 401, { error: 'Not allowed.' });
      await sql`select 1`; // also keeps the Supabase project awake
      await sessions.purgeExpired?.();
      await limiter.purge();
      return json(res, 200, { ok: true, job: 'maintenance', dailyJobChecks: 'pending' });
    }

    const ip = clientIp(req);
    await limiter.hit('ip:' + ip, limits.ip);

    if (oauth && await oauth.handle(req, res)) return;
    if (p === '/mcp') {
      if (!handleMcp) return json(res, 404, { error: 'Not found.' });
      const grant = await bearerUser(req, res, 'mcp');
      if (!grant) return;
      const ctx = contextFor(grant.userId);
      return handleMcp(req, res, { userId: grant.userId, grant, workspace: ctx.workspace, registry: ctx.registry, stepRunner: ctx.steps, siteUrl });
    }
    if (p.startsWith('/api/extension/')) {
      if (!handleExtensionApi) return json(res, 404, { error: 'Not found.' });
      const grant = await bearerUser(req, res, 'extension');
      if (!grant) return;
      await limiter.hit('user:' + grant.userId, limits.user);
      const ctx = contextFor(grant.userId);
      return handleExtensionApi(req, res, { userId: grant.userId, grant, workspace: ctx.workspace, registry: ctx.registry, stepRunner: ctx.steps });
    }

    // Everything below uses the session cookie, so state changes must come from our own pages.
    if (unsafe && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site requests are not allowed.' });
    const cookies = parseCookies(req.headers.cookie);
    const cookieValue = cookies[SESSION_COOKIE];
    const session = cookieValue ? await sessions.resolve(cookieValue) : null;

    if (p === '/signin' && method === 'GET') {
      if (session) return redirect(res, '/', [], 302);
      const message = url.searchParams.get('sent') ? 'Check your email for a sign-in link. It works once, for one hour.' : '';
      const error = url.searchParams.get('error') ? 'Sign-in did not finish. Try again.' : '';
      return html(res, 200, signInPage({ message, error }));
    }
    if (p === '/auth/google' && method === 'GET') {
      await limiter.hit('signin-ip:' + ip, limits.signinIp);
      const verifier = newCodeVerifier();
      return redirect(res, auth.googleUrl(callbackUrl, verifier), [cookie(PKCE_COOKIE, verifier, 600)], 302);
    }
    if (p === '/auth/email' && method === 'POST') {
      const form = new URLSearchParams(await readBody(req, 4096));
      const email = String(form.get('email') || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return html(res, 400, signInPage({ error: 'Enter a valid email address.' }));
      await limiter.hit('signin-ip:' + ip, limits.signinIp);
      await limiter.hit('signin-email:' + email, limits.signinEmail);
      const verifier = newCodeVerifier();
      await auth.sendEmailLink(email, callbackUrl, verifier);
      return redirect(res, '/signin?sent=1', [cookie(PKCE_COOKIE, verifier, 3600)]);
    }
    if (p === '/auth/callback' && method === 'GET') {
      await limiter.hit('signin-ip:' + ip, limits.signinIp);
      const code = url.searchParams.get('code'), tokenHash = url.searchParams.get('token_hash');
      if (url.searchParams.get('error') || (!code && !tokenHash)) return redirect(res, '/signin?error=1', [cookie(PKCE_COOKIE, '', 0)], 302);
      try {
        if (tokenHash) return await signIn(res, await auth.verifyEmailToken(tokenHash, url.searchParams.get('type') || 'email'));
        if (!cookies[PKCE_COOKIE]) return html(res, 400, signInPage({ error: 'Open the sign-in link in the same browser you used to ask for it, or start again.' }));
        return await signIn(res, await auth.exchangeCode(code, cookies[PKCE_COOKIE]));
      } catch (error) {
        if (error.name !== 'AuthError') throw error;
        return html(res, 400, signInPage({ error: error.message }), { 'Set-Cookie': cookie(PKCE_COOKIE, '', 0) });
      }
    }
    if (p === '/auth/signout' && method === 'POST') {
      if (cookieValue) await sessions.destroy(cookieValue);
      return redirect(res, '/signin', [cookie(SESSION_COOKIE, '', 0)]);
    }

    if (!session) {
      if (p.startsWith('/api/')) return json(res, 401, { error: 'Sign in to continue.' });
      return redirect(res, '/signin', [], 302);
    }
    const account = await accounts.get(session.userId);
    if (!account) return redirect(res, '/signin', [cookie(SESSION_COOKIE, '', 0)], 302);
    const csrf = csrfFor(cookieValue);
    if (unsafe) await limiter.hit('user:' + session.userId, limits.user);

    if (p === '/account/delete') {
      if (method === 'GET') return html(res, 200, deletePage(csrf));
      if (method !== 'POST') return json(res, 405, { error: 'Not allowed.' });
      const form = new URLSearchParams(await readBody(req, 4096));
      if (!safeEqual(form.get('csrf') || '', csrf) || form.get('confirm') !== 'yes') return html(res, 403, page('Delete account', '<h1>Try again</h1><p>Your page expired. <a href="/account/delete">Start again</a>.</p>'));
      await deleteAccount(session.userId);
      return html(res, 200, page('Account deleted', '<h1>Your account is deleted</h1><p>Everything you saved in Plainhand is gone.</p><a class="button" href="/signin">Back to sign in</a>'), { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
    }
    if (p === '/' || p === '/index.html') {
      if (method !== 'GET') return json(res, 405, { error: 'Not allowed.' });
      indexHtml ??= await readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
      return html(res, 200, indexHtml.replace('__SESSION_TOKEN__', csrf));
    }
    if (p.startsWith('/api/')) {
      // The page sends its token on every call (header, or ?token= on download links).
      const supplied = req.headers['x-plainhand-token'] || (method === 'GET' ? url.searchParams.get('token') : '') || '';
      if (!safeEqual(supplied, csrf)) return json(res, 403, { error: 'Your session expired. Reload Plainhand.' });
      return api(req, res, url, contextFor(session.userId), account);
    }
    return json(res, 404, { error: 'Not found.' });
  }

  return async function handler(req, res) {
    const errorId = randomUUID();
    res.setHeader('X-Request-ID', errorId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try { await route(req, res); }
    catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) return json(res, error.status, { error: error.message, errorId }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
      // Postgres, network and programming errors are not shown to the candidate.
      // Log only scrubbed request metadata; messages can contain workspace data.
      const internal = error?.name === 'PostgresError' || /^E[A-Z_]+$/.test(String(error?.code || '')) || error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError;
      if (internal && !(error instanceof StorageError)) {
        reportServerError({ errorId, status: 500, method: req.method });
        return json(res, 500, { error: 'Something went wrong. Try again in a minute.', errorId });
      }
      return json(res, 400, { error: error.message, errorId, ...(error.code && !/^E[A-Z_]+$/.test(error.code) ? { code: error.code } : {}), ...(error.panel ? { panel: error.panel } : {}) });
    }
  };
}
