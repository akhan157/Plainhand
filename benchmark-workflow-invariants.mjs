import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace, digest } from './plainhand/store.mjs';
import { AnswerMemory } from './plainhand/benchmarks/runner.mjs';
import { detachedApplication } from './plainhand/benchmarks/detached-actor.mjs';
import { createPlainhand } from './plainhand-server.mjs';
import { packetIdentity } from './plainhand/workflow.mjs';
import { profiles, oraclePacket } from './plainhand/benchmarks/cases.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'plainhand-invariants-'));
const directory = path.join('output', 'architecture-invariants-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const results = []; let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let release; return { promise: new Promise(resolve => release = resolve), release: () => release() }; };
try {
  const workspace = new Workspace(root);
  const field = { key: '0:0', name: 'degree', label: 'Highest degree', type: 'text', options: [], sectionContext: null };
  const context = { hash: 'version-one', sources: [{ id: 'cv', text: 'Highest degree: Bachelor of Science.' }] };
  const memory = new AnswerMemory(workspace), job = { id: 'memory-job' };
  await memory.put([field], [{ key: field.key, answer: 'Bachelor of Science', evidence: [{ sourceId: 'cv', quote: 'Bachelor of Science' }] }], context, job);
  assert.equal((await new AnswerMemory(workspace).get([field], context, job))[field.key], 'Bachelor of Science');
  assert.deepEqual(await memory.get([field], { ...context, hash: 'version-two' }, job), {});
  assert.deepEqual(await memory.get([{ ...field, sectionContext: { label: 'Education', index: 1, count: 2 } }], context, job), {});
  results.push({ test: 'versioned-memory-restart-source-and-record-isolation', passed: true });

  let entered = gate(), held = gate();
  const fakeBrowser = {
    open: async () => [{ key: '0:0', name: 'name', label: 'Full name', type: 'text' }],
    status: async () => ({ state: 'ready' }),
    fill: async () => { entered.release(); await held.promise; return { filled: ['Full name'], skipped: [], failed: [], validation: [], note: 'Controlled delayed browser, no employer.' }; },
    advance: async () => ({ advanced: false, state: 'review' }), closeAll: async () => {},
  };
  app = await createPlainhand({ root, browser: fakeBrowser });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (name, body) => {
    const response = await fetch(base + '/api/' + name, { method: 'POST', headers: { 'x-plainhand-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  await app.workspace.mutate(async state => {
    state.profile = profiles.engineering; state.provider = 'claude';
    const source = await app.workspace.context(state), packet = oraclePacket(profiles.engineering);
    const bytes = '%PDF-1.4\nControlled scheduling benchmark.';
    await app.workspace.write('output/scheduling.pdf', bytes);
    const job = { id: 'slow-job', title: 'Product Engineer', company: 'Fictional', url: 'https://jobs.lever.co/synthetic/scheduling', description: 'Controlled scheduling benchmark. '.repeat(8), selected: true, evaluation: { score: 4.5 }, verification: { state: 'active' }, createdAt: new Date().toISOString(), status: 'Apply', packet, review: { passed: true, issues: [] }, pdf: 'output/scheduling.pdf', pdfHash: digest(Buffer.from(bytes)), contextHash: source.hash };
    job.packetJobHash = digest([job.url, job.company, job.title, job.description]); job.approvedHash = packetIdentity(job);
    state.jobs = [job, { id: 'other-job', company: 'Other Fictional', title: 'Other role', url: 'https://jobs.lever.co/synthetic/other', description: 'Other job.', createdAt: new Date().toISOString() }];
  });
  const slow = request('browser/autofill', { id: 'slow-job' });
  await Promise.race([entered.promise, slow.then(result => { throw Error('Browser route returned before entering fill: ' + JSON.stringify(result)); })]);
  let editFinished = false;
  const start = Date.now();
  const edit = request('jobs/update', { id: 'other-job', selected: true }).then(r => { editFinished = true; return r; });
  await pause(250);
  assert.equal(editFinished, false, 'Current production HTTP browser route holds the global workspace queue.');
  held.release();
  assert.equal((await slow).status, 200); assert.equal((await edit).status, 200);
  results.push({ test: 'production-http-browser-call-blocks-unrelated-edit', passed: true, blockedAtLeastMs: 250, observedEditMs: Date.now() - start });

  entered = gate(); held = gate();
  const actor = detachedApplication(app.workspace, 'slow-job', async () => { entered.release(); await held.promise; return { prepared: true }; });
  await entered.promise;
  const actorStart = Date.now();
  const otherEdit = await request('jobs/update', { id: 'other-job', selected: false });
  assert.equal(otherEdit.status, 200);
  const actorEditMs = Date.now() - actorStart;
  assert.ok(actorEditMs < 250);
  await assert.rejects(detachedApplication(app.workspace, 'slow-job', async () => ({})), /already running/);
  await app.workspace.mutate(state => { state.profile.story = 'New source information while the application is running.'; });
  held.release();
  assert.equal((await actor).state, 'needs-replan');
  results.push({ test: 'detached-actor-allows-edits-rejects-duplicate-and-stale-commit', passed: true, editMs: actorEditMs });
} catch (error) { results.push({ test: 'benchmark-error', passed: false, error: error.message }); process.exitCode = 1; }
finally {
  await app?.close(); await rm(root, { recursive: true, force: true });
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ results, evidenceTier: 'controlled scheduling and memory invariants; no real model or employer' }, null, 2));
  console.log(JSON.stringify({ results, evidence: directory }, null, 2));
}
