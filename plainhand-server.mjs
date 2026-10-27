#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Workspace, digest, now, requireText, cleanText, syncTracker, hasEvidence } from './plainhand/store.mjs';
import { Workflow, assertPacketFresh, packetIdentity, suggestFormAnswers } from './plainhand/workflow.mjs';
import { AnswerBank } from './plainhand/answer-bank.mjs';
import { Corrections } from './plainhand/corrections.mjs';
import { AuditLog } from './plainhand/audit.mjs';
import { followUpQueue } from './plainhand/application-record.mjs';
import { createRegistry, STATUS_VALUES, CORE_ATTENTION } from './plainhand/actions.mjs';
import { profileStrength } from './plainhand/profile-strength.mjs';
import { currentCalibration } from './plainhand/claim-calibration.mjs';
import { candidateLine } from './plainhand/claim-line.mjs';
import { presubmitCheck } from './plainhand/presubmit.mjs';
import { deriveFormat, cleanFormat, DEFAULT_FORMAT, renderResumeHtml } from './plainhand/resume-format.mjs';
import { isSensitiveLabel } from './plainhand/field-policy.mjs';
import { standardStatus, autonomyOf } from './plainhand/standard.mjs';
import { AgentEngine } from './plainhand/agent.mjs';
import { FEATURES } from './plainhand/features/index.mjs';
import { importWorkspace, preview as previewImport } from './plainhand/workspace-import.mjs';
import { providerById, inspectProviders, runProcess, FORM_INSTRUCTION } from './plainhand/agents.mjs';
import { NAVIGATION_INSTRUCTION } from './plainhand/browser-driver.mjs';
import { configuredBrowserLaunch } from './plainhand/browser-backends.mjs';
import { ApplicationBrowser, applicationTarget, isBoardUrl } from './plainhand/jobs.mjs';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(APP_ROOT, 'plainhand/web');
const ASSET_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const EVENT_HEARTBEAT_MS = 5000;
export const LOCAL_API_FILE = 'data/plainhand/local-api.json';
// Static front-end files: anything under plainhand/web with a known type, no traversal or dotfiles.
function assetFile(pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (relative.split('/').some(part => !part || part.startsWith('.'))) return null;
  const file = path.resolve(WEB_ROOT, relative);
  if (!file.startsWith(WEB_ROOT + path.sep) || !ASSET_TYPES[path.extname(file)]) return null;
  return file;
}

// Fictional content for previewing a resume format before a standard application exists.
const FORMAT_SAMPLE = {
  profile: { name: 'Riley Example', email: 'riley@example.invalid', phone: '+1 617 555 0100', location: 'Boston, MA', links: '' },
  resume: [
    { section: 'Education', heading: { org: 'Example University', title: 'B.S. Mechanical Engineering', location: 'Boston, MA', dates: 'May 2027' }, text: 'Coursework: Machine Design, Heat Transfer, Controls' },
    { section: 'Experience', heading: { org: 'Example Pumps', title: 'Engineering Intern', location: 'Boston, MA', dates: 'Jun 2026 – Aug 2026' }, text: 'Wrote an impeller-wear test procedure the lab still uses; ran 40 bench tests on it' },
    { section: 'Experience', heading: { org: 'Example Pumps', title: 'Engineering Intern', location: 'Boston, MA', dates: 'Jun 2026 – Aug 2026' }, text: 'Added a clearance check every 10 hours that caught two bad batches' },
    { section: 'Projects', heading: { org: 'Formula SAE', title: 'Suspension Lead', location: '', dates: '2024 – 2026' }, text: 'Redesigned the rear upright in SolidWorks, cutting its weight 18% at the same load rating' },
    { section: 'Skills', heading: null, text: 'SolidWorks, ANSYS, MATLAB, GD&T (coursework), machining' },
  ],
};

export async function createPlainhand({ root = APP_ROOT, workflowOptions = {}, browser, providers = inspectProviders, features = FEATURES, startFeatures = true } = {}) {
  const workspace = new Workspace(root);
  browser ||= new ApplicationBrowser({ storage: workspace, launch: configuredBrowserLaunch() });
  const workflow = new Workflow(workspace, workflowOptions);
  await workflow.recover();
  const token = randomBytes(32).toString('hex');
  // A separate secret for the local MCP bridge, handed over through an owner-only file.
  const mcpToken = randomBytes(32).toString('hex');
  const logins = new Map();
  const loginControllers = new Map();
  for (const feature of features) for (const [kind, task] of Object.entries(feature.tasks || {})) workflow.registerTask(kind, task);
  const registry = createRegistry({ workspace, workflow, features });
  const ui = async (name, input) => (await registry.run(name, input, { actor: 'ui' })).result;
  const streams = new Set();
  const broadcast = (event, data) => { for (const stream of streams) stream.send(event, data); };
  const agent = new AgentEngine({ workspace, workflow, registry, emit: broadcast });
  const stops = [];
  const appBrowserPlans = new Map();
  let providerCache = null;
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 8 * 1024 * 1024) throw new Error('Upload is too large. Maximum request size is 8 MB.'); }
    try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON request.'); }
  }
  // The approved packet's rendered cover letter, when there is one.
  async function coverLetterPath(job) {
    const file = (job.artifacts || []).find(f => /cover-letter.*\.pdf$/.test(f));
    return file ? workspace.safe(file) : null;
  }
  async function formPlan(state, job, fields) {
    const plan = { id: job.id, fields, observation: browser.status ? await browser.status(job.id) : { state: 'ready' }, answers: suggestFormAnswers(fields, state.profile, job.packet, { bank: await new AnswerBank(workspace).load(), job }), approval: job.approvedHash };
    const unanswered = fields.filter(f => !plan.answers[f.key] && f.type !== 'file' && !/sponsor|authoriz|eligible|gender|race|veteran|disabil|salary|compens|consent|agree|legal|citizen|relocat|privacy|country|ethnic/i.test(f.label));
    if (unanswered.length) {
      try {
        const context = await workspace.context(state);
        const result = await workflow.agent(state.provider, FORM_INSTRUCTION, { context, job: { company: job.company, title: job.title, description: job.description }, packet: job.packet, fields: unanswered }, { usageContext: { jobId: job.id, purpose: 'form-answers' } });
        if (!Array.isArray(result.suggestions) || !Array.isArray(result.questions)) throw new Error('Invalid form suggestions.');
        for (const suggestion of result.suggestions) {
          const field = unanswered.find(f => f.key === suggestion.key);
          if (field && hasEvidence(suggestion, context) && typeof suggestion.answer === 'string' && (field.type !== 'select-one' || field.options.some(option => option.value === suggestion.answer))) plan.answers[suggestion.key] = suggestion.answer.slice(0, 15000);
        }
        plan.questions = result.questions.filter(q => unanswered.some(f => f.key === q.key) && typeof q.question === 'string').map(q => ({ key: q.key, question: q.question.slice(0, 2000) }));
      } catch { plan.warning = 'Your agent could not finish the remaining answers. Common fields are ready; add your own answers below or retry inspection.'; }
    }
    plan.check = presubmitCheck({ fields: plan.fields, answers: plan.answers, questions: plan.questions || [], profile: state.profile });
    appBrowserPlans.set(job.id, plan); return plan;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      if (!/^127\.0\.0\.1:\d+$/.test(host || '')) return json(res, 403, { error: 'Open Plainhand using its 127.0.0.1 address.' });
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin requests are not permitted.' });
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return json(res, 403, { error: 'Open Plainhand directly in your browser.' });
      const asset = req.method === 'GET' && !url.pathname.startsWith('/api/') ? assetFile(url.pathname) : null;
      if (asset) {
        let content;
        try { content = await readFile(asset); } catch { return json(res, 404, { error: 'Not found.' }); }
        if (path.basename(asset) === 'index.html') content = Buffer.from(content.toString().replace('__SESSION_TOKEN__', token));
        const type = ASSET_TYPES[path.extname(asset)];
        res.writeHead(200, { 'Content-Type': type + (type.startsWith('text/') || type === 'application/json' || type === 'image/svg+xml' ? '; charset=utf-8' : '') }); return res.end(content);
      }
      if (url.pathname.startsWith('/api/mcp/')) {
        // The MCP server (plainhand-mcp.mjs) forwards its tool calls here so this process
        // stays the only writer of the workspace. Same Host/Origin checks as the UI.
        const suppliedMcp = Buffer.from(req.headers['x-plainhand-mcp-token'] || '');
        if (suppliedMcp.length !== mcpToken.length || !timingSafeEqual(suppliedMcp, Buffer.from(mcpToken))) return json(res, 403, { error: 'Unknown MCP client.' });
        if (req.method === 'GET' && url.pathname === '/api/mcp/actions') return json(res, 200, { actions: registry.list({ tiers: ['read', 'write', 'candidate'] }) });
        if (req.method !== 'POST' || !/^application\/json\b/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send application/json.' });
        const input = await body(req);
        if (url.pathname === '/api/mcp/action') {
          const { result, undoToken, taintSources } = await registry.run(cleanText(input.name, 100), input.input ?? {}, { actor: 'mcp', reason: cleanText(input.reason, 200) || null });
          return json(res, 200, { ok: true, result, undoToken, taintSources });
        }
        if (url.pathname === '/api/mcp/undo') return json(res, 200, await registry.undo(cleanText(input.undoToken, 100), { actor: 'mcp' }));
        return json(res, 404, { error: 'Not found.' });
      }
      const supplied = Buffer.from(req.headers['x-plainhand-token'] || url.searchParams.get('token') || '');
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return json(res, 403, { error: 'Your session expired. Reload Plainhand.' });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = await workspace.load();
        const context = await workspace.context(state);
        for (const job of state.jobs) job.stale = !!job.packet && (job.contextHash !== context.hash || job.packetJobHash !== digest([job.url, job.company, job.title, job.description]));
        // Calibration as seen through the candidate's current line and choices.
        for (const job of state.jobs) if (job.calibration) job.calibration = currentCalibration(state, job);
        return json(res, 200, { ...state,
          answerBank: await new AnswerBank(workspace).load(),
          corrections: await new Corrections(workspace).list(),
          audit: await new AuditLog(workspace).list({ limit: 20 }),
          followUps: followUpQueue(state.jobs).map(({ job, ...item }) => ({ ...item, jobId: job.id })),
          agent: { available: Boolean(state.provider), running: agent.turn?.id || null },
          profileStrength: profileStrength(state),
          claimLineView: candidateLine(state),
          resumeFormat: state.resumeFormat || null,
          standardStatus: standardStatus(state, context.hash),
          autonomy: autonomyOf(state),
          featureAttention: registry.digest(state).attention.filter(item => !CORE_ATTENTION.includes(item.kind)),
          usage: await workflow.usage.summary(state), contextHash: context.hash, sourceManifest: context.sources.map(s => ({ id: s.id, characters: s.text.length })), tracker: await workspace.read('data/applications.md'), loginSessions: [...logins.values()], applicationSessions: [...appBrowserPlans.keys()], localCaptchaSolver: { installed: !!(browser.solver && await browser.solver.ready()), type: 'recaptcha-audio', feePerSolve: 0 } });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        // Live updates: `state` after every workspace change, `tick` as a heartbeat so the
        // page can also notice files edited outside Plainhand (tracker, usage receipts).
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        send('state', { revision: (await workspace.load()).revision });
        const stop = workspace.onChange(revision => send('state', { revision }));
        const heartbeat = setInterval(() => send('tick', { at: now() }), EVENT_HEARTBEAT_MS);
        const stream = { send, end: () => { streams.delete(stream); res.end(); } };
        streams.add(stream);
        req.on('close', () => { stop(); clearInterval(heartbeat); streams.delete(stream); });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/agent/history') return json(res, 200, await agent.history({ limit: Number(url.searchParams.get('limit')) || 50 }));
      if (req.method === 'GET' && url.pathname === '/api/providers') {
        providerCache = await providers();
        const state = await workspace.load();
        return json(res, 200, providerCache.map(p => ({ ...p, lastVerifiedAt: state.connectionChecks?.[p.id]?.verifiedAt || null })));
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="plainhand-workspace.json"');
        const conversation = await agent.history({ limit: 500 });
        return json(res, 200, { ...(await workspace.load()), agentUsage: await workflow.usage.records(), agentConversation: conversation.messages, agentProposals: await agent.proposals(), exportedAt: now() });
      }
      if (req.method === 'GET' && url.pathname === '/api/artifact') {
        const requested = url.searchParams.get('path');
        const state = await workspace.load();
        if (!state.jobs.some(j => j.artifacts?.includes(requested) || j.reportPath === requested)) return json(res, 404, { error: 'Artifact not found.' });
        const data = await readFile(await workspace.safe(requested));
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(requested)}"`);
        res.setHeader('Content-Type', requested.endsWith('.pdf') ? 'application/pdf' : 'text/markdown; charset=utf-8');
        return res.end(data);
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send application/json.' });
      const input = await body(req);
      if (url.pathname === '/api/profile') {
        await workspace.saveProfile(input.profile, input.revision);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/resume/import') {
        const name = requireText(input.name, 'filename', 200);
        if (!/\.(pdf|txt|md)$/i.test(name)) throw new Error('Import a PDF, Markdown, or plain text resume.');
        const buffer = Buffer.from(requireText(input.content, 'file data', 7000000), 'base64');
        if (buffer.length > 5 * 1024 * 1024) throw new Error('Resume files must be under 5 MB.');
        if (!name.toLowerCase().endsWith('.pdf')) return json(res, 200, { text: buffer.toString('utf8').slice(0, 100000) });
        if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('This file is not a PDF.');
        const temp = await mkdtemp(path.join(tmpdir(), 'plainhand-resume-'));
        try {
          await writeFile(path.join(temp, 'resume.pdf'), buffer, { mode: 0o600 });
          const result = await runProcess('pdftotext', ['-layout', path.join(temp, 'resume.pdf'), '-'], { timeout: 15000 });
          if (result.stdout.trim().length < 30) throw new Error('This PDF has no readable text. Paste the resume text instead.');
          return json(res, 200, { text: result.stdout.slice(0, 100000) });
        } catch (error) { if (error.code === 'ENOENT') throw new Error('Install Poppler (pdftotext) to import PDFs, or paste your resume text.'); throw error; }
        finally { await rm(temp, { recursive: true, force: true }); }
      }
      if (url.pathname === '/api/provider') {
        const p = providerById(input.id);
        await workspace.mutate(state => { state.provider = p.id; });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/provider/login') {
        const p = providerById(input.id);
        if (p.id === 'antigravity') return json(res, 200, { manual: true, command: p.login, message: 'Run agy once in your terminal to complete Google sign-in, then test the connection here.' });
        if ([...logins.values()].some(l => l.provider === p.id && l.status === 'running')) throw new Error('Sign-in is already running. Complete it in your browser.');
        const login = { id: randomUUID(), provider: p.id, status: 'running', url: null, message: 'Opening the provider sign-in. If no browser opens, use the terminal command below.' };
        logins.set(login.id, login);
        const controller = new AbortController(); loginControllers.set(login.id, controller);
        runProcess(p.command, p.id === 'codex' ? ['login'] : ['auth', 'login'], { timeout: 180000, signal: controller.signal, onOutput: chunk => {
          for (const match of chunk.matchAll(/https:\/\/[^\s<>"'\x1b]+/g)) {
            try { const target = new URL(match[0]); if (['auth.openai.com', 'chatgpt.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'].includes(target.hostname)) login.url = target.href; } catch {}
          }
        } }).then(() => { login.status = 'complete'; login.message = 'Sign-in completed. Test the connection to confirm access.'; }).catch(() => { login.status = 'failed'; login.message = `Sign-in did not finish. Run ${p.login} in your terminal, then test the connection.`; }).finally(() => loginControllers.delete(login.id));
        return json(res, 202, login);
      }
      if (url.pathname === '/api/provider/test') {
        const p = providerById(input.id);
        const result = await workflow.agent(p.id, 'Return {"ok":true}. This is a connection test; no candidate data is included.', {}, { usageContext: { purpose: 'connection-test' } });
        if (result.ok !== true) throw new Error('The provider did not return a successful connection test.');
        await workspace.mutate(state => { state.provider = p.id; state.connectionChecks ||= {}; state.connectionChecks[p.id] = { verifiedAt: now() }; state.events.unshift({ at: now(), text: `${p.name} connection tested successfully.` }); });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/conversation') {
        const text = requireText(input.text, 'message', 15000);
        await workspace.mutate(state => { state.conversation.push({ role: 'user', text, at: now() }); state.understanding = null; for (const j of state.jobs) j.approvedHash = null; });
        const { taskId } = await ui('tasks.interview', {});
        return json(res, 202, { taskId });
      }
      if (url.pathname === '/api/agent/message') return json(res, 202, await agent.message(input.text));
      if (url.pathname === '/api/agent/confirm') return json(res, 200, await agent.confirm({ proposalId: cleanText(input.proposalId, 100), accept: input.accept === true, edits: input.edits && typeof input.edits === 'object' ? input.edits : {} }));
      if (url.pathname === '/api/agent/undo') return json(res, 200, await agent.undo(cleanText(input.undoToken, 100)));
      if (url.pathname === '/api/agent/cancel') return json(res, 200, agent.cancel(cleanText(input.turnId, 100)));
      if (url.pathname === '/api/agent/clear') { await agent.clear(); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/import/preview') return json(res, 200, previewImport(input.data));
      if (url.pathname === '/api/import') {
        if (input.confirm !== true) throw new Error('Confirm that this export should replace the current workspace.');
        const busy = Boolean(agent.turn) || (await workspace.load()).tasks.some(t => ['queued', 'running'].includes(t.status));
        return json(res, 200, await importWorkspace({ workspace, data: input.data, busy }));
      }
      if (url.pathname === '/api/action') {
        const { result, undoToken } = await registry.run(cleanText(input.name, 100), input.input ?? {}, { actor: 'ui' });
        return json(res, 200, { ok: true, result, undoToken });
      }
      if (url.pathname === '/api/action/undo') return json(res, 200, await registry.undo(cleanText(input.undoToken, 100)));
      if (url.pathname === '/api/understanding/approve') { await ui('understanding.approve'); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/sources') { await ui('sources.add', { name: input.name, url: input.url }); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/sources/remove') { await ui('sources.remove', { sourceId: input.id }); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/jobs') {
        const { id } = await ui('jobs.add', { company: input.company, title: input.title, url: input.url, description: input.description, location: input.location });
        return json(res, 201, { id });
      }
      if (url.pathname === '/api/jobs/update') {
        // One legacy request can carry several changes; apply them in the original order.
        const jobId = input.id;
        // Reject an invalid status before anything is saved, as the single-transaction route did.
        if (input.status && !STATUS_VALUES.has(input.status)) throw new Error('Invalid application status.');
        if (input.status === 'Applied' && input.confirmSubmitted !== true) throw new Error('Confirm that you personally submitted this application.');
        const context = Object.fromEntries(['description', 'roleAnswers', 'overrideReason'].filter(key => typeof input[key] === 'string').map(key => [key, input[key]]));
        if (Object.keys(context).length) await ui('jobs.setContext', { jobId, ...context });
        if (typeof input.selected === 'boolean') await ui('jobs.select', { jobId, selected: input.selected });
        if (input.status) await ui(input.status === 'Applied' ? 'jobs.confirmSubmitted' : 'jobs.setStatus', input.status === 'Applied' ? { jobId } : { jobId, status: input.status });
        if (!Object.keys(context).length && typeof input.selected !== 'boolean' && !input.status) await ui('jobs.get', { jobId });
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/jobs/record/')) {
        const action = url.pathname.slice('/api/jobs/record/'.length), jobId = input.id;
        // The route's job id always wins; unknown nested fields are ignored as before.
        const fields = (name, value) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key]) => key !== 'jobId' && Object.hasOwn(registry.get(name).input, key)));
        const calls = {
          contact: () => ui('record.addContact', { ...fields('record.addContact', input.contact), jobId }),
          interview: () => ui('record.addInterview', { ...fields('record.addInterview', input.interview), jobId }),
          'interview-status': () => ui('record.setInterviewStatus', { jobId, entryId: input.entryId, status: input.status }),
          'remove-contact': () => ui('record.removeContact', { jobId, entryId: input.entryId }),
          'remove-interview': () => ui('record.removeInterview', { jobId, entryId: input.entryId }),
          'next-action': () => ui('record.setNextAction', { jobId, text: input.text, due: input.due }),
        };
        if (!calls[action]) throw new Error('Unknown application record action.');
        return json(res, 200, { ok: true, entry: (await calls[action]()) ?? null });
      }
      if (url.pathname === '/api/answer-bank/remove') {
        const removed = await new AnswerBank(workspace).remove(cleanText(input.id, 100));
        if (!removed) throw new Error('Reusable answer not found.');
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/corrections') {
        return json(res, 200, { corrections: await new Corrections(workspace).list() });
      }
      if (url.pathname === '/api/corrections/propose') {
        return json(res, 201, { correction: await ui('corrections.propose', { jobId: input.jobId, question: input.question, previous: input.previous, answer: input.answer, evidence: input.evidence, scope: input.scope === 'global' ? 'global' : undefined }) });
      }
      if (url.pathname === '/api/corrections/approve' || url.pathname === '/api/corrections/reject') {
        return json(res, 200, { correction: await ui(url.pathname.endsWith('/approve') ? 'corrections.approve' : 'corrections.reject', { id: input.id }) });
      }
      if (url.pathname === '/api/tasks') {
        const inputs = { interview: ['retryOf'], discover: ['filter', 'location', 'retryOf'], evaluate: ['jobId', 'retryOf'], prepare: ['jobId', 'retryOf'], standard: ['retryOf'], revise: ['jobId', 'request', 'retryOf'] };
        // Feature tasks start through their own actions; here they can only be retried, with the
        // failed task's own input (the queue checks the retry matches a failed task of that kind).
        if (!inputs[input.kind] && workflow.handlers.has(input.kind) && input.retryOf) {
          const failed = (await workspace.load()).tasks.find(t => t.id === input.retryOf);
          if (!failed) throw new Error('Only a failed task can be retried.');
          return json(res, 202, { taskId: await workflow.enqueue(input.kind, failed.jobId || null, { ...(failed.input || {}), retryOf: failed.id }) });
        }
        if (!inputs[input.kind]) throw new Error('Unknown task type.');
        // A failed revision is retried with its own request.
        if (['revise', 'standard'].includes(input.kind) && input.retryOf && !input.request) { const failed = (await workspace.load()).tasks.find(t => t.id === input.retryOf); if (failed?.input?.request) input.request = failed.input.request; }
        if (input.kind === 'standard' && input.request) input.kind = 'revise';
        const { taskId } = await ui('tasks.' + input.kind, Object.fromEntries(inputs[input.kind].filter(key => input[key] != null && input[key] !== '').map(key => [key, String(input[key])])));
        return json(res, 202, { taskId });
      }
      if (url.pathname === '/api/tasks/cancel') { await ui('tasks.cancel', { taskId: input.id }); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/jobs/apply-link') return json(res, 200, await ui('jobs.setApplyLink', { jobId: input.id, applyUrl: input.applyUrl }));
      if (url.pathname === '/api/format/derive') {
        // Reads layout from the candidate's own resume PDF; nothing is saved until they choose to.
        const pdf = Buffer.from(String(input.content || ''), 'base64');
        if (pdf.length < 100 || pdf.length > 5 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Choose a PDF of your resume under 5 MB.');
        return json(res, 200, { format: await deriveFormat(pdf) });
      }
      if (url.pathname === '/api/format/save') return json(res, 200, await ui('format.save', input.reset ? { reset: true } : { format: input.format }));
      if (url.pathname === '/api/format/preview') {
        // A first-page image of the standard application (or a fictional sample) in this format.
        const state = await workspace.load(), format = cleanFormat(input.format || state.resumeFormat || DEFAULT_FORMAT);
        const sample = state.standard?.draft?.resume?.length ? state.standard.draft : FORMAT_SAMPLE;
        const profile = sample === FORMAT_SAMPLE ? FORMAT_SAMPLE.profile : state.profile;
        const { chromium } = await import('playwright');
        const browserInstance = await chromium.launch({ headless: true });
        try {
          const page = await browserInstance.newPage({ viewport: format.page === 'a4' ? { width: 794, height: 1123 } : { width: 816, height: 1056 } });
          const html = renderResumeHtml(format, profile, sample).replace(/@page\{[^}]*\}/, '').replace('<body>', `<body style="padding:${format.margins.top}in ${format.margins.right}in ${format.margins.bottom}in ${format.margins.left}in">`);
          await page.setContent(html);
          const png = await page.screenshot({ type: 'png' });
          return json(res, 200, { image: 'data:image/png;base64,' + png.toString('base64') });
        } finally { await browserInstance.close(); }
      }
      if (url.pathname === '/api/standard/approve') { await ui('standard.approve', {}); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/settings/autonomy') return json(res, 200, await ui('settings.autonomy', { enabled: input.enabled === true, ...(input.perDay != null ? { perDay: Number(input.perDay) } : {}), ...(input.minScore != null ? { minScore: Number(input.minScore) } : {}) }));
      if (url.pathname === '/api/samples/add') return json(res, 200, await ui('profile.addWritingSample', { title: input.title || '', text: input.text }));
      if (url.pathname === '/api/samples/remove') { await ui('profile.removeWritingSample', { id: input.id }); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/calibration/decide') { return json(res, 200, (await ui('calibration.decide', { jobId: input.id, claimId: input.claimId, decision: input.decision })) || { ok: true }); }
      if (url.pathname === '/api/line/remove') { await ui('line.removeStatement', { index: input.index }); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/packet/approve') { await ui('packet.approve', { jobId: input.id }); return json(res, 200, { ok: true }); }
      if (url.pathname.startsWith('/api/browser/')) {
        const result = await workspace.mutate(async state => {
          const job = state.jobs.find(j => j.id === input.id);
          assertPacketFresh(job, await workspace.context(state));
          if (job.approvedHash !== packetIdentity(job)) throw new Error('Review and approve this exact application packet first.');
          if (!job.selected) throw new Error('Select this job before continuing.');
          if (job.evaluation?.score < 4 && !job.overrideReason) throw new Error('Record a specific reason for pursuing this role below 4/5.');
          if (job.submittedAt || ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(job.status)) throw new Error('This application was already submitted. Browser assistance cannot start a duplicate.');
          applicationTarget(job);
          if (job.verification?.state !== 'active') throw new Error('This posting is not verified active. Re-evaluate it or apply manually.');
          if (url.pathname === '/api/browser/attention') return browser.attention(job.id);
          if (url.pathname === '/api/browser/autofill') {
            if (digest(await readFile(await workspace.safe(job.pdf))) !== job.pdfHash) throw new Error('The resume file changed. Regenerate and review the packet.');
            const steps = [], navigation = job.browserCheckpoint?.packetHash === job.approvedHash ? [...job.browserCheckpoint.navigation || []].slice(-30) : [];
            let navigationCalls = 0;
            const planner = data => ++navigationCalls <= 10 ? workflow.agent(state.provider, NAVIGATION_INSTRUCTION, data, { usageContext: { jobId: job.id, purpose: 'navigation' } }) : { action: 'stop', reason: 'Navigation model-call budget reached.' };
            let fields = await browser.open(job);
            if (!fields.length && browser.navigate) {
              const result = await browser.navigate(job, planner); navigation.push(...result.trace);
              fields = await browser.inspect(job);
              if (result.state !== 'ready') return { id: job.id, fields, answers: {}, observation: result, steps, navigation };
            }
            try {
            for (let i = 0; i < 6; i++) {
              let plan = await formPlan(state, job, fields);
              if (plan.observation.state === 'challenge') {
                const resolution = await browser.resolveChallenge(job);
                fields = await browser.inspect(job);
                plan = await formPlan(state, job, fields);
                if (resolution.solver) plan.observation.solver = resolution.solver;
              }
              if (plan.observation.state !== 'ready' || plan.warning || plan.questions?.length) return { ...plan, steps, navigation };
              const result = await browser.fill(job, plan.answers, await workspace.safe(job.pdf), await coverLetterPath(job));
              steps.push({ at: now(), filled: result.filled, skipped: result.skipped });
              job.browserCheckpoint = { at: now(), packetHash: job.approvedHash, result, steps, navigation, check: presubmitCheck({ fields, answers: plan.answers, questions: plan.questions || [], fill: result, profile: state.profile }) };
              // Persist each finished page before navigating; a process interruption
              // must not erase evidence just because this request has not returned.
              await workspace.saveBrowserCheckpoint(job);
              if (result.failed?.length || result.validation?.length) return { ...plan, steps, navigation, observation: { state: 'needs-answers', message: 'Some fields did not retain their answers or reported validation errors. Review them before continuing.' } };
              if (result.formChanged) { fields = await browser.inspect(job); continue; }
              job.stage = 'awaiting-user-submit';
              await syncTracker(workspace, state);
              const next = await browser.advance(job);
              if (!next.advanced) {
                if (next.state === 'review' && browser.navigate) {
                  const driven = await browser.navigate(job, planner, { requireTransition: true }); navigation.push(...driven.trace);
                  if (driven.state === 'ready') { fields = await browser.inspect(job); continue; }
                  return { ...plan, observation: driven, steps, navigation };
                }
                return { ...plan, observation: next, steps, navigation };
              }
              fields = await browser.inspect(job);
            }
            return { ...await formPlan(state, job, fields), steps, observation: { state: 'paused', message: 'Six form steps processed. Review progress or run autofill again to continue.' } };
            } catch {
              return { id: job.id, fields: [], answers: {}, steps, observation: { state: 'paused', message: 'Automatic filling stopped. Completed steps are saved; resume inspection to check the current page.' } };
            }
          }
          if (['/api/browser/open', '/api/browser/resume', '/api/browser/advance'].includes(url.pathname)) {
            if (url.pathname === '/api/browser/advance') {
              const result = await browser.advance(job);
              if (!result.advanced) return { id: job.id, fields: [], answers: {}, observation: result };
            }
            const fields = url.pathname === '/api/browser/open' ? await browser.open(job) : await browser.inspect(job);
            return formPlan(state, job, fields);
          }
          const plan = appBrowserPlans.get(job.id);
          if (!plan || plan.approval !== job.approvedHash) throw new Error('Inspect the form again. Your packet or browser session changed.');
          if (url.pathname === '/api/browser/fill') {
            if (digest(await readFile(await workspace.safe(job.pdf))) !== job.pdfHash) throw new Error('The resume file changed. Regenerate and review the packet.');
            if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) throw new Error('Review the form answers first.');
            const result = await browser.fill(job, input.answers, await workspace.safe(job.pdf), await coverLetterPath(job));
            const plan = appBrowserPlans.get(job.id);
            const check = presubmitCheck({ fields: plan?.fields || [], answers: input.answers, questions: plan?.questions || [], fill: result, profile: state.profile });
            job.browserCheckpoint = { at: now(), packetHash: job.approvedHash, result, check, navigation: job.browserCheckpoint?.navigation || [] }; job.stage = 'awaiting-user-submit'; await syncTracker(workspace, state);
            await workspace.saveBrowserCheckpoint(job);
            // Answers the candidate typed are offered for reuse; they reach the answer bank only after approval.
            const corrections = new Corrections(workspace), known = await corrections.list();
            let offered = 0;
            for (const field of plan?.fields || []) {
              const typed = typeof input.answers[field.key] === 'string' ? input.answers[field.key].trim() : '';
              if (typed.length < 8 || field.type === 'file' || isSensitiveLabel(field.label) || typed === (plan.answers[field.key] || '').trim()) continue;
              if (known.some(c => c.question === field.label && c.answer === typed && c.status !== 'rejected')) continue;
              try { await corrections.propose({ jobId: job.id, question: field.label, previous: plan.answers[field.key] || null, answer: typed, evidence: [{ sourceId: 'candidate-answer', quote: typed.slice(0, 500) }], scope: 'global' }); offered++; } catch {}
            }
            return { ...result, check, offered };
          }
          if (url.pathname === '/api/browser/handoff') {
            if (!job.browserCheckpoint || job.browserCheckpoint.packetHash !== job.approvedHash) throw new Error('Fill and review the current form before taking over the browser.');
            await browser.handoff(job.id); appBrowserPlans.delete(job.id);
            return { ok: true, message: 'The browser is yours. Review the form and submit it yourself, then confirm submission in Plainhand.' };
          }
          throw new Error('Unknown browser action.');
        });
        return json(res, 200, result);
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) { return json(res, 400, { error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.panel ? { panel: error.panel } : {}) }); }
  });
  server.requestTimeout = 240000;
  // Tell a local MCP bridge where this server is. Owner-only, removed on shutdown.
  server.on('listening', () => { workspace.write(LOCAL_API_FILE, JSON.stringify({ port: server.address().port, mcpToken, pid: process.pid, startedAt: now() }) + '\n').catch(() => {}); });
  server.headersTimeout = 15000;
  const close = async () => {
    for (const controller of workflow.controllers.values()) controller.abort();
    agent.turn?.controller.abort();
    for (const controller of loginControllers.values()) controller.abort();
    for (const stop of stops.splice(0)) await stop?.().catch?.(() => {});
    for (const stream of streams) stream.end();
    await rm(path.join(workspace.root, LOCAL_API_FILE), { force: true }).catch(() => {});
    await browser.closeAll();
    await new Promise(resolve => server.close(resolve));
  };
  // Background feature work (e.g. scheduled scans) starts once the app is assembled.
  if (startFeatures) for (const feature of features) { const stop = await feature.start?.({ workspace, workflow, registry, emit: broadcast }); if (stop) stops.push(stop); }
  return { server, workspace, workflow, registry, agent, token, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf('--port');
  const rootIndex = process.argv.indexOf('--data-root');
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : Number(process.env.PLAINHAND_PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port between 1 and 65535.');
  const app = await createPlainhand({ root: rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : APP_ROOT });
  app.server.on('error', error => { console.error(`Plainhand could not start: ${error.message}`); process.exit(1); });
  app.server.listen(port, '127.0.0.1', () => console.log(`\n  Plainhand is ready → http://127.0.0.1:${port}\n  Workspace files are saved locally. Ctrl+C to stop.\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
