import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { candidate, fixtureAgent, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';

function fakeFeature(log) {
  return {
    name: 'fake',
    register({ define, workspace }) {
      define({ name: 'fake.note', tier: 'write', title: 'Fake note', description: 'Test write.', input: { text: 'string' },
        run: async (ctx, input) => { await workspace.mutate(state => { state.fakeNotes = [...(state.fakeNotes || []), input.text]; }); return { result: { ok: true } }; } });
      define({ name: 'fake.start', tier: 'task', title: 'Fake task', description: 'Test task.', input: {}, run: async () => ({ result: { taskId: await this.workflow.enqueue('fake-task', null) } }) });
    },
    tasks: { 'fake-task': { needsProfile: false, handler: async ({ progress, check, workspace }) => { await progress('Doing the fake thing'); check(); await workspace.mutate(state => { state.fakeRan = true; }); log.push('ran'); } } },
    attention: state => (state.fakeNotes || []).map(text => ({ kind: 'fake', text: `Fake: ${text}` })),
    start: async ({ registry }) => { log.push('started:' + Boolean(registry.get('fake.note'))); return async () => { log.push('stopped'); }; },
  };
}

test('a feature module adds actions, task kinds, briefing items and background work without touching the core', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-features-'));
  const log = [];
  const feature = fakeFeature(log);
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: fixtureAgent }, features: [feature] });
  feature.workflow = app.workflow;
  try {
    assert.deepEqual(log, ['started:true']);
    await app.registry.run('fake.note', { text: 'hello' });
    assert.deepEqual((await app.registry.run('workspace.digest', {})).result.attention.find(a => a.kind === 'fake'), { kind: 'fake', jobId: null, text: 'Fake: hello' });
    await assert.rejects(app.registry.run('fake.note', { text: 'x' }, { actor: 'agent' }), /needs your confirmation/, 'feature actions get the same tier rules');
    const { result } = await app.registry.run('fake.start', {});
    await app.workflow.queue;
    const state = await app.workspace.load();
    assert.equal(state.fakeRan, true);
    assert.equal(state.tasks.find(t => t.id === result.taskId).status, 'complete');
    await assert.rejects(app.workflow.enqueue('nope', null), /Unknown task type/);
    assert.throws(() => app.workflow.registerTask('evaluate', { handler() {} }), /already registered/);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(log, ['started:true', 'ran', 'stopped']);
});

test('a feature whose briefing hook throws cannot break the digest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-features-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, features: [{ name: 'broken', attention: () => { throw new Error('boom'); } }] });
  try {
    await app.workspace.mutate(state => { Object.assign(state.profile, candidate); });
    assert.ok(Array.isArray((await app.registry.run('workspace.digest', {})).result.attention));
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('a task commit keeps feature data and choices changed while it ran', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-features-'));
  let release;
  const agent = (id, instruction, data, options) => instruction.includes('Evaluate this') && !release
    ? new Promise(resolve => { release = () => resolve(fixtureAgent(id, instruction, data, options)); })
    : fixtureAgent(id, instruction, data, options);
  const app = await createPlainhand({ root, providers: fixtureProviders, features: [], workflowOptions: { agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }) } });
  try {
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
    await app.workspace.mutate(s => { s.provider = 'codex'; });
    const { result: { id: jobId } } = await app.registry.run('jobs.add', { company: 'Acme', title: 'Engineer', url: 'https://jobs.lever.co/acme/commit' });
    await app.workspace.mutate(s => { const job = s.jobs.find(j => j.id === jobId); job.followups = [{ id: 'f0', status: 'draft' }]; job.overrideReason = 'Initial reason'; });
    await app.registry.run('tasks.evaluate', { jobId });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    await app.workspace.mutate(s => { const job = s.jobs.find(j => j.id === jobId); job.followups = [{ id: 'f1', status: 'sent' }]; job.overrideReason = 'Set while evaluating'; });
    release();
    await app.workflow.queue;
    const job = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.ok(job.evaluation, 'the evaluation was committed');
    assert.deepEqual(job.followups, [{ id: 'f1', status: 'sent' }], 'feature data written mid-task survives');
    assert.equal(job.overrideReason, 'Set while evaluating');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('feature briefing items reach Home, failed feature tasks retry, and the agent can open feature pages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-features-'));
  let failNext = true;
  const feature = {
    name: 'demo',
    tasks: { 'demo-scan': { needsProfile: false, handler: async ({ workspace, task }) => { if (failNext) { failNext = false; throw new Error('Source down'); } await workspace.mutate(s => { s.demoRuns = (s.demoRuns || 0) + 1; s.demoInput = task.input.note; }); } } },
    attention: () => [{ kind: 'demo-new', text: 'Demo: 2 new roles' }],
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, features: [feature], workflowOptions: { agent: scriptedAgent([{ reply: { say: 'Opening it.', actions: [{ name: 'ui.openPanel', input: { type: 'insights' } }, { name: 'ui.openPanel', input: { type: 'campaigns' } }] } }]) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = async (endpoint, input) => (await fetch(`http://127.0.0.1:${app.server.address().port}/api/${endpoint}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })).json();
  try {
    const state = await request('state');
    assert.deepEqual(state.featureAttention, [{ kind: 'demo-new', jobId: null, text: 'Demo: 2 new roles' }], 'only feature items; core items are computed by Home itself');

    const failedId = await app.workflow.enqueue('demo-scan', null, { note: 'first try' });
    await app.workflow.queue;
    assert.equal((await app.workspace.load()).tasks.find(t => t.id === failedId).status, 'failed');
    assert.match((await request('tasks', { kind: 'demo-scan' })).error, /Unknown task type/, 'feature tasks start through their own actions, not this route');
    const { taskId } = await request('tasks', { kind: 'demo-scan', retryOf: failedId });
    await app.workflow.queue;
    const after = await app.workspace.load();
    assert.equal(after.tasks.find(t => t.id === taskId).status, 'complete');
    assert.equal(after.demoInput, 'first try', 'the retry reuses the failed task input');

    await app.workspace.mutate(s => { Object.assign(s.profile, candidate); s.provider = 'codex'; });
    const events = [];
    const emit = app.agent.emit; app.agent.emit = (event, data) => { events.push({ event, data }); emit(event, data); };
    await app.agent.message('show me insights'); await app.agent.running;
    assert.deepEqual(events.filter(e => e.event === 'agent.panel').map(e => e.data.panel.type), ['campaigns'], 'the last requested page wins, and both are valid');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
