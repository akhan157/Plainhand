import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPlainhand } from './plainhand-server.mjs';
import { Workspace, digest, hasEvidence } from './plainhand/store.mjs';
import { parseAgentJson, parseAntigravityStream, executeAgent, runProcess } from './plainhand/agents.mjs';
import { jobUrl, supportedUrl, defaultFieldAnswers, ApplicationBrowser, privateHost } from './plainhand/jobs.mjs';
import { chromium } from 'playwright';
import { packetIdentity, renderPacket, suggestFormAnswers } from './plainhand/workflow.mjs';
import { verifyRealArtifacts } from './artifact-contract-verifier.mjs';

import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

async function harness(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-test-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: fixtureAgent, verifier: async job => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }), scanner: async () => [{ title: 'Graduate Engineer', company: 'Test Company', location: 'Boston', url: 'https://jobs.lever.co/test/123' }], renderer: async (workspace, state, job) => {
    const pdf = `output/test-${job.id}.pdf`;
    await workspace.write(pdf, 'test-pdf');
    return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] };
  } }, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input, extra = {}) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const configure = async () => {
    const state = (await request('state')).data;
    assert.equal((await request('profile', { profile: candidate, revision: state.revision })).status, 200);
    assert.equal((await request('provider', { id: 'codex' })).status, 200);
  };
  const run = async (kind, jobId = null) => {
    const result = await request('tasks', { kind, jobId });
    assert.equal(result.status, 202, JSON.stringify(result.data));
    await app.workflow.queue;
    return (await app.workspace.load()).tasks.find(t => t.id === result.data.taskId);
  };
  const close = async () => { await app.close(); await rm(root, { recursive: true, force: true }); };
  return { app, root, base, request, configure, run, close };
}

test('request boundaries reject missing tokens, hostile origins, and arbitrary file paths', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(h.base + '/api/state')).status, 403);
    assert.equal((await h.request('state', undefined, { Origin: 'https://evil.invalid' })).status, 403);
    const hostileHost = await new Promise(resolve => { const req = http.get(h.base + '/api/state', { headers: { Host: 'evil.invalid', 'X-Plainhand-Token': h.app.token } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', () => resolve(0)); });
    assert.equal(hostileHost, 403);
    assert.equal((await h.request('artifact?path=package.json')).status, 404);
    const page = await fetch(h.base);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(h.app.token));
    assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  } finally { await h.close(); }
});

test('profile saves preserve legacy settings, reject stale edits, and persist on reload', async () => {
  const h = await harness();
  try {
    await mkdir(path.join(h.root, 'config'), { recursive: true });
    await writeFile(path.join(h.root, 'config/profile.yml'), 'custom_setting: keep-me\ncandidate:\n  github: https://example.invalid/test\n');
    await h.configure();
    const state = await h.app.workspace.load();
    assert.equal(state.profile.name, candidate.name);
    const config = await readFile(path.join(h.root, 'config/profile.yml'), 'utf8');
    assert.match(config, /keep-me/); assert.match(config, /github/);
    assert.equal((await h.request('profile', { profile: candidate, revision: 0 })).status, 400);
    const reloaded = await new Workspace(h.root).load();
    assert.equal(reloaded.profile.resume, candidate.resume);
    await writeFile(path.join(h.root, 'data/resume-source.yml'), 'candidate: test\n');
    assert.equal((await h.request('profile', { profile: { ...candidate, resume: 'New text' }, revision: reloaded.revision })).status, 400);
  } finally { await h.close(); }
});

test('full candidate-selected workflow validates evidence, approval, tracker, and confirmed submission', async () => {
  const h = await harness();
  try {
    await h.configure();
    assert.equal((await h.run('interview')).status, 'complete');
    assert.equal((await h.request('understanding/approve', {})).status, 200);
    const added = await h.request('jobs', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/123' });
    const id = added.data.id;
    assert.equal((await h.request('jobs', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/456' })).status, 400);
    assert.equal((await h.run('prepare', id)).status, 'failed');
    assert.equal((await h.run('evaluate', id)).status, 'complete');
    const report = (await h.app.workspace.load()).jobs[0].reportPath;
    assert.match(await h.app.workspace.read(report), /## G\. Posting legitimacy/);
    await h.request('jobs/update', { id, selected: true });
    assert.equal((await h.run('prepare', id)).status, 'complete');
    assert.equal((await h.request('packet/approve', { id })).status, 200);
    let job = (await h.app.workspace.load()).jobs[0];
    assert.equal(job.approvedHash, packetIdentity(job));
    assert.equal(job.calibration.total, job.packet.resume.length + job.packet.answers.length, 'every resume entry and answer is graded');
    assert.equal(job.calibration.modelRated, false, 'the fixture reviewer gives no ratings, so rule checks alone grade it');
    assert.equal((await h.request('jobs/update', { id, status: 'Applied' })).status, 400);
    assert.equal((await h.request('jobs/update', { id, status: 'Applied', confirmSubmitted: true })).status, 200);
    assert.match(await h.app.workspace.read('data/applications.md'), /Applied/);
    assert.equal((await h.app.workspace.load()).jobs[0].status, 'Applied');
    assert.equal((await h.run('prepare', id)).status, 'failed');
    assert.equal((await h.request('browser/open', { id })).status, 400);
    assert.equal((await fetch(`${h.base}/api/artifact?path=${encodeURIComponent(job.pdf)}`, { headers: { 'X-Plainhand-Token': h.app.token } })).status, 200);
  } finally { await h.close(); }
});

test('changing candidate evidence invalidates packets and exact approvals', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id);
    await h.request('packet/approve', { id });
    await h.request('jobs/update', { id, roleAnswers: 'My availability starts in June 2027.' });
    assert.equal((await h.request('packet/approve', { id })).status, 400);
    assert.equal((await h.request('browser/open', { id })).status, 400);
    const task = await h.run('prepare', id);
    assert.equal(task.status, 'failed'); assert.match(task.message, /profile changed/i);
  } finally { await h.close(); }
});

test('unsupported quotes fail factual gates instead of producing an approved packet', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    h.app.workflow.agent = (provider, instruction, data) => {
      const result = fixtureAgent(provider, instruction, data);
      if (result.matches) result.matches[0].evidence[0].quote = 'Invented result that does not exist';
      return result;
    };
    const task = await h.run('evaluate', id);
    assert.equal(task.status, 'failed'); assert.match(task.message, /valid source evidence/);
    assert.equal((await h.app.workspace.load()).jobs[0].evaluation, undefined);
  } finally { await h.close(); }
});

test('external canonical resume edits invalidate browser and packet approval', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id);
    await h.request('packet/approve', { id });
    await writeFile(path.join(h.root, 'cv.md'), candidate.resume + '\nUpdated project experience.\n');
    assert.equal((await h.request('state')).data.jobs[0].stale, true);
    assert.equal((await h.request('packet/approve', { id })).status, 400);
    assert.equal((await h.request('browser/open', { id })).status, 400);
  } finally { await h.close(); }
});

test('the drafter corrects factual review findings once, then preserves the successful review history', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true });
    let reviews = 0, drafts = 0;
    h.app.workflow.agent = (provider, instruction, data) => {
      if (instruction.includes('Prepare a')) { drafts++; if (drafts === 2) { assert.ok(data.previousPacket); assert.deepEqual(data.reviewFeedback, ['Remove unsupported inference.']); } }
      if (instruction.includes('Review this')) { reviews++; if (reviews === 1) return { passed: false, issues: ['Remove unsupported inference.'] }; }
      return fixtureAgent(provider, instruction, data);
    };
    assert.equal((await h.run('prepare', id)).status, 'complete');
    const job = (await h.app.workspace.load()).jobs[0];
    assert.equal(drafts, 2); assert.equal(job.reviewAttempts.length, 2); assert.equal(job.review.passed, true);
    assert.equal(job.approvedHash, null, 'Successful repair still needs candidate approval.');
  } finally { await h.close(); }
});

test('unresolved reviewer findings block document rendering and approval after the bounded correction', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true });
    h.app.workflow.agent = (provider, instruction, data) => instruction.includes('Review this') ? { passed: false, issues: ['Unsupported factual claim.'] } : fixtureAgent(provider, instruction, data);
    assert.equal((await h.run('prepare', id)).status, 'failed');
    const job = (await h.app.workspace.load()).jobs[0];
    assert.equal(job.reviewAttempts.length, 2); assert.equal(job.stage, 'review-blocked'); assert.equal(job.packet, undefined);
    assert.equal((await h.request('packet/approve', { id })).status, 400);
  } finally { await h.close(); }
});

test('required questions block approval while optional suggestions remain nonblocking', async () => {
  const h = await harness();
  try {
    await h.configure();
    assert.equal((await h.request('provider/test', { id: 'codex' })).status, 200);
    assert.ok((await h.request('providers')).data[0].lastVerifiedAt);
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true });
    let missing = true;
    h.app.workflow.agent = (provider, instruction, data) => {
      const result = fixtureAgent(provider, instruction, data);
      if (instruction.includes('Prepare a')) { result.questions = missing ? ['When are you available?'] : []; result.suggestions = ['Optionally add another project example.']; }
      return result;
    };
    assert.equal((await h.run('prepare', id)).status, 'complete');
    assert.equal((await h.request('packet/approve', { id })).status, 400);
    missing = false;
    assert.equal((await h.run('prepare', id)).status, 'complete');
    assert.equal((await h.request('packet/approve', { id })).status, 200);
    assert.equal((await h.app.workspace.load()).jobs[0].packet.suggestions.length, 1);
  } finally { await h.close(); }
});

test('an in-flight evaluation never overwrites a candidate job-description correction', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    let resolveAgent;
    h.app.workflow.agent = () => new Promise(resolve => { resolveAgent = resolve; });
    const result = await h.request('tasks', { kind: 'evaluate', jobId: id });
    while (!resolveAgent) await new Promise(resolve => setTimeout(resolve, 5));
    const corrected = 'Candidate-provided updated description. '.repeat(10);
    await h.request('jobs/update', { id, description: corrected });
    resolveAgent(fixtureAgent('codex', 'Evaluate this', {}));
    await h.app.workflow.queue;
    const state = await h.app.workspace.load();
    assert.equal(state.jobs[0].description, corrected.trim());
    assert.equal(state.tasks.find(t => t.id === result.data.taskId).status, 'failed');
    assert.equal(state.jobs[0].evaluation, null);
  } finally { await h.close(); }
});

test('discovery deduplicates roles and persists isolated source errors', async () => {
  const h = await harness();
  try {
    await h.request('sources', { name: 'Test Company', url: 'https://jobs.lever.co/test' });
    assert.equal((await h.run('discover')).status, 'complete');
    assert.equal((await h.run('discover')).status, 'complete');
    assert.equal((await h.app.workspace.load()).jobs.length, 1);
    assert.equal((await h.request('sources', { name: 'No', url: 'https://127.0.0.1/' })).status, 400);
  } finally { await h.close(); }
});

test('interrupted tasks recover visibly; cancellation prevents late model result writes', async () => {
  const h = await harness();
  try {
    await h.configure();
    await h.app.workspace.mutate(state => state.tasks.push({ id: 'interrupted', status: 'running', kind: 'interview' }));
    await h.app.workflow.recover();
    assert.equal((await h.app.workspace.load()).tasks[0].status, 'interrupted');
    let resolveAgent;
    h.app.workflow.agent = () => new Promise(resolve => { resolveAgent = resolve; });
    const result = await h.request('tasks', { kind: 'interview' });
    while (!resolveAgent) await new Promise(resolve => setTimeout(resolve, 5));
    await h.request('tasks/cancel', { id: result.data.taskId });
    resolveAgent(fixtureAgent('codex', 'Interview a', {}));
    await h.app.workflow.queue;
    const state = await h.app.workspace.load();
    assert.equal(state.tasks[0].status, 'canceled');
    assert.equal(state.understanding, null);
  } finally { await h.close(); }
});

test('CLI parsing, provider restrictions, prompt transport and process cancellation', async () => {
  assert.deepEqual(parseAgentJson('{"result":"```json\\n{\\"ok\\":true}\\n```"}'), { ok: true });
  assert.deepEqual(parseAgentJson('{"structured_output":{"ok":true}}'), { ok: true });
  assert.throws(() => parseAgentJson('{"is_error":true}'), /did not finish/);
  assert.throws(() => parseAgentJson('not json'), /unreadable/);
  assert.deepEqual(parseAntigravityStream('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"{\\"ok\\":true}"}}\n'), { ok: true });
  assert.throws(() => parseAntigravityStream('{"event":"result","result":{"status":"ERROR","response":""}}'), /did not finish/);
  for (const id of ['codex', 'claude', 'antigravity']) {
    const value = await executeAgent(id, 'Return ok', { private: 'candidate evidence' }, { runner: async (cmd, args, opts) => {
      assert.ok(opts.input.includes('candidate evidence'));
      assert.ok(!args.join(' ').includes('candidate evidence'));
      assert.ok(!args.some(a => /dangerously/.test(a)));
      if (id === 'antigravity') { assert.equal(JSON.parse(opts.input).event, 'user'); assert.equal(args.includes('-p'), false); }
      return { stdout: '{"ok":true}' };
    } });
    assert.equal(value.ok, true);
  }
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, /canceled/);
});

test('the application browser refuses loopback, private and link-local addresses', async () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '100.70.1.1', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', 'printer.local', 'router.home.arpa']) assert.equal(await privateHost(host), true, host);
  assert.equal(await privateHost('8.8.8.8'), false);
  assert.throws(() => jobUrl('https://[fe80::1]/jobs'));
});

test('URL and sensitive-field policies are conservative', () => {
  assert.throws(() => jobUrl('http://localhost/a'));
  assert.throws(() => jobUrl('https://user:pass@example.com/a'));
  assert.equal(supportedUrl('https://jobs.lever.co/test/1'), true);
  assert.equal(supportedUrl('https://jobs.lever.co.evil.invalid/test'), false);
  assert.equal(jobUrl('https://jobs.lever.co/test/1?utm_source=x#apply'), 'https://jobs.lever.co/test/1');
  const fields = [{ key: '1', label: 'Full name', type: 'text' }, { key: '2', label: 'Work authorization email', type: 'text' }, { key: '3', label: 'Phone', type: 'text' }];
  const values = defaultFieldAnswers(fields, candidate);
  assert.equal(values['1'], candidate.name); assert.equal(values['2'], undefined);
  const upload = suggestFormAnswers([{ key: 'resume', label: 'Resume', type: 'file' }, { key: 'name', label: 'Full name', type: 'text' }], candidate, { answers: [{ question: 'Resume', answer: 'Here is my resume.' }, { question: 'Full name', answer: 'Generated contact paragraph.' }] });
  assert.equal(upload.resume, '__resume__', 'Generated prose must never replace an upload instruction.');
  assert.equal(upload.name, candidate.name, 'Generated prose must never replace canonical identity.');
  assert.equal(hasEvidence({ evidence: [{ sourceId: 'cv', quote: 'not in evidence' }] }, { sources: [{ id: 'cv', text: 'something else' }] }), false);
});

test('browser API grounds novel field suggestions and binds fills to exact packet approval', async () => {
  let filled, handoff = false;
  const h = await harness({ browser: {
    open: async () => [{ key: '0:0', label: 'Full name', type: 'text' }, { key: '0:3', label: 'Describe an engineering project.', type: 'textarea' }, { key: '0:4', label: 'Will you need sponsorship?', type: 'text' }],
    fill: async (job, answers) => { filled = answers; return { filled: Object.keys(answers), skipped: [], note: 'No submission.' }; },
    handoff: async () => { handoff = true; }, closeAll: async () => {},
  } });
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id);
    assert.equal((await h.request('browser/open', { id })).status, 400);
    await h.request('packet/approve', { id });
    const plan = await h.request('browser/open', { id });
    assert.equal(plan.status, 200);
    assert.match(plan.data.answers['0:3'], /lightweight chassis/);
    assert.equal(plan.data.answers['0:4'], undefined);
    assert.equal((await h.request('browser/fill', { id, answers: plan.data.answers })).status, 200);
    assert.equal(filled['0:0'], candidate.name);
    assert.equal((await h.request('browser/handoff', { id })).status, 200);
    assert.equal(handoff, true);
    assert.equal((await h.app.workspace.load()).jobs[0].status, 'Apply');
  } finally { await h.close(); }
});

test('real PDF renderer produces downloadable documents and valid artifact metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-pdf-'));
  try {
    const workspace = new Workspace(root);
    const state = { profile: candidate };
    const job = { id: 'pdf-test', company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/123', reportPath: 'reports/001-test-company-2026-10-17.md', description: 'Engineering design and testing.' };
    await workspace.write(job.reportPath, `# Test Company — Graduate Engineer\n\n**Score:** 4.4/5\n**URL:** ${job.url}\n**PDF:** pending\n**Legitimacy:** unconfirmed\n`);
    const packet = fixtureAgent('codex', 'Prepare a', {});
    const result = await renderPacket(workspace, state, job, packet);
    const pdf = await readFile(path.join(root, result.pdf));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(result.artifacts.length, 3);
    const verified = verifyRealArtifacts({ projectRoot: root, candidate: 'test-graduate' });
    assert.equal(verified.errors, 0, JSON.stringify(verified.messages));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser assistance fills only reviewed fields, rejects changed forms, and never clicks submit', async () => {
  let page, blockedWrites = 0;
  const application = new ApplicationBrowser({ launch: async options => {
    const browser = await chromium.launch(options);
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await createContext(config);
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await createPage();
        await page.route('https://jobs.lever.co/**', async route => {
          if (route.request().method() !== 'GET') { blockedWrites++; return route.abort(); }
          return route.fulfill({ contentType: 'text/html', body: '<h1>Graduate Engineer</h1><form><label>Full name<input name="name"></label><label>Email<input name="email" type="email"></label><label>Work authorization<select name="authorization"><option value="">Choose</option><option value="yes">Yes</option></select></label><label>I agree<input type="checkbox" name="agree"></label><button type="submit">Submit application</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++};</script>' });
        });
        return page;
      };
      return context;
    };
    return browser;
  } });
  const job = { id: 'browser-test', url: 'https://jobs.lever.co/test/123' };
  try {
    const fields = await application.open(job, true);
    assert.equal(fields.length, 3);
    assert.equal(fields.find(f => f.type === 'select-one').label, 'Work authorization', 'Select option text must not leak into the field label.');
    const answers = defaultFieldAnswers(fields, candidate);
    assert.equal(Object.keys(answers).length, 2);
    const result = await application.fill(job, answers);
    assert.equal(result.filled.length, 2);
    assert.equal(await page.locator('[name=name]').inputValue(), candidate.name);
    assert.equal(await page.locator('[name=authorization]').inputValue(), '');
    assert.equal(await page.locator('[name=agree]').isChecked(), false);
    assert.equal(await page.evaluate(() => window.submits), 0);
    await page.locator('[name=name]').evaluate(el => el.name = 'changed-name');
    await assert.rejects(application.fill(job, answers), /form changed/);
    await application.handoff(job.id);
    await assert.rejects(application.fill(job, answers), /inspect/);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(blockedWrites, 0);
  } finally { await application.closeAll(); }
});

test('autofill processes grounded steps, journals checkpoints and stops for final review', async () => {
  let step = 0, filled = [];
  const fields = () => step === 0 ? [{ key: '0:0', label: 'Full name', type: 'text', required: true }] : [{ key: '0:0', label: 'Email', type: 'email', required: true }];
  const h = await harness({ browser: {
    open: async () => fields(), inspect: async () => fields(), status: async () => ({ state: 'ready' }),
    fill: async (job, answers) => { filled.push(answers); return { filled: Object.keys(answers), skipped: [], note: 'Synthetic test; no submission.' }; },
    advance: async job => {
      const recovered = await new Workspace(h.root).load();
      assert.equal(recovered.jobs.find(j => j.id === job.id).browserCheckpoint.steps.length, step + 1, 'Each page is durable before navigation, while the request is still running.');
      return step++ === 0 ? { advanced: true, state: 'ready' } : { advanced: false, state: 'review', message: 'Final review.' };
    },
    closeAll: async () => {},
  } });
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id);
    assert.equal((await h.request('browser/autofill', { id })).status, 400);
    await h.request('packet/approve', { id });
    const response = await h.request('browser/autofill', { id });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.observation.state, 'review');
    assert.equal(response.data.steps.length, 2);
    assert.equal(filled[0]['0:0'], candidate.name);
    assert.equal(filled[1]['0:0'], candidate.email);
    const state = await h.app.workspace.load();
    assert.equal(state.jobs[0].browserCheckpoint.steps.length, 2);
    assert.equal(state.jobs[0].status, 'Apply');
  } finally { await h.close(); }
});

test('native select answers require both source evidence and an actual option value', async () => {
  const fields = [{ key: '0:0', label: 'Highest degree', type: 'select-one', options: [{ value: '', label: 'Choose' }, { value: 'bachelor', label: "Bachelor's degree" }] }];
  const h = await harness({ browser: { open: async () => fields, closeAll: async () => {} } });
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id); await h.request('packet/approve', { id });
    const original = h.app.workflow.agent;
    h.app.workflow.agent = (provider, instruction, data) => instruction.includes('Draft answers for these actual') ? { suggestions: [{ key: '0:0', answer: 'bachelor', evidence: [{ sourceId: 'cv', quote: 'B.S. Mechanical Engineering, Example University, 2027.' }] }], questions: [] } : original(provider, instruction, data);
    assert.equal((await h.request('browser/open', { id })).data.answers['0:0'], 'bachelor');
    h.app.workflow.agent = () => ({ suggestions: [{ key: '0:0', answer: 'invented-option', evidence: [{ sourceId: 'cv', quote: 'B.S. Mechanical Engineering, Example University, 2027.' }] }], questions: [] });
    assert.equal((await h.request('browser/open', { id })).data.answers['0:0'], undefined);
  } finally { await h.close(); }
});

test('checkpoint recovery ignores journals from a different approved packet', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-checkpoint-'));
  const workspace = new Workspace(root);
  try {
    await workspace.mutate(state => state.jobs.push({ id: 'checkpoint-test', company: 'Synthetic', title: 'Engineer', approvedHash: 'packet-one' }));
    const job = { id: 'checkpoint-test', approvedHash: 'packet-one', browserCheckpoint: { at: new Date().toISOString(), packetHash: 'packet-one', result: { filled: ['Full name'], skipped: [], note: 'Synthetic evidence only.' }, steps: [{ filled: ['Full name'] }] } };
    await workspace.saveBrowserCheckpoint(job);
    assert.equal((await new Workspace(root).load()).jobs[0].browserCheckpoint.steps.length, 1);
    await workspace.mutate(state => { state.jobs[0].approvedHash = 'packet-two'; delete state.jobs[0].browserCheckpoint; });
    assert.equal((await new Workspace(root).load()).jobs[0].browserCheckpoint, undefined);
    await assert.rejects(workspace.saveBrowserCheckpoint({ ...job, approvedHash: 'packet-two' }), /exact packet approval/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('autofill reinspects conditional questions before attempting next-step navigation', async () => {
  let changed = false, advances = 0;
  const fields = () => [{ key: '0:0', label: changed ? 'Email' : 'Full name', type: changed ? 'email' : 'text', required: true }];
  const fills = [];
  const h = await harness({ browser: {
    open: async () => fields(), inspect: async () => fields(), status: async () => ({ state: 'ready' }),
    fill: async (job, answers) => {
      fills.push(answers['0:0']); const formChanged = !changed; changed = true;
      return { filled: ['Synthetic field'], skipped: [], failed: [], validation: [], formChanged, note: 'Synthetic conditional form.' };
    },
    advance: async () => { advances++; return { advanced: false, state: 'review', message: 'Final review.' }; },
    closeAll: async () => {},
  } });
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id); await h.request('packet/approve', { id });
    const response = await h.request('browser/autofill', { id });
    assert.equal(response.status, 200);
    assert.deepEqual(fills, [candidate.name, candidate.email]);
    assert.equal(advances, 1);
    assert.equal(response.data.observation.state, 'review');
    assert.equal((await h.app.workspace.load()).jobs[0].browserCheckpoint.steps.length, 2);
  } finally { await h.close(); }
});

test('usage API attributes calls to jobs and exports metadata without inventing token counts', async () => {
  const h = await harness();
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1' })).data.id;
    await h.run('evaluate', id); await h.request('jobs/update', { id, selected: true }); await h.run('prepare', id);
    const state = (await h.request('state')).data;
    assert.equal(state.usage.totals.calls, 4, 'evaluate, draft, humanizer pass, review');
    assert.equal(state.usage.totals.inputTokens.value, null);
    assert.equal(state.usage.byJob.find(j => j.id === id).calls, 4);
    assert.equal(state.usage.recent.some(r => r.purpose === 'humanize'), true);
    assert.equal(state.usage.impact.preparedPackets, 1);
    assert.equal(state.usage.recent.some(r => r.purpose === 'review'), true);
    const exported = (await h.request('export')).data;
    assert.equal(exported.agentUsage.length, 4);
    assert.equal(JSON.stringify(exported.agentUsage).includes(candidate.resume), false);
  } finally { await h.close(); }
});

test('explicit task retries are linked and counted separately from normal agent steps', async () => {
  let attempts = 0;
  const h = await harness({ workflowOptions: { agent: (...args) => { if (++attempts === 1) throw Error('Synthetic provider failure'); return fixtureAgent(...args); }, verifier: async () => ({ state: 'active', legitimacy: 'unconfirmed' }) } });
  try {
    await h.configure();
    const id = (await h.request('jobs', { company: 'Test', title: 'Engineer', url: 'https://jobs.lever.co/test/1', description: 'Synthetic engineering design and testing role. '.repeat(8) })).data.id;
    const failed = await h.run('evaluate', id);
    assert.equal(failed.status, 'failed');
    const retry = await h.request('tasks', { kind: 'evaluate', jobId: id, retryOf: failed.id });
    assert.equal(retry.status, 202);
    await h.app.workflow.queue;
    const state = (await h.request('state')).data;
    assert.equal(state.usage.totals.calls, 2);
    assert.equal(state.usage.totals.failed, 1);
    assert.equal(state.usage.totals.retriedCalls, 1);
    assert.equal(state.tasks.find(t => t.id === retry.data.taskId).retryOf, failed.id);
    assert.equal((await h.request('tasks', { kind: 'interview', retryOf: failed.id })).status, 400);
  } finally { await h.close(); }
});
