import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { validateInput, ActionError, TIERS } from './plainhand/actions.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-actions-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent: fixtureAgent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const state = (await request('state')).data;
  await request('profile', { profile: candidate, revision: state.revision });
  await request('provider', { id: 'codex' });
  const { registry } = app;
  const addJob = async (n = 1) => (await registry.run('jobs.add', { company: `Company ${n}`, title: 'Graduate Engineer', url: `https://jobs.lever.co/test/${n}` })).result.id;
  const evaluate = async jobId => { await registry.run('tasks.evaluate', { jobId }); await app.workflow.queue; };
  return { app, registry, request, addJob, evaluate, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
const code = expected => error => error instanceof ActionError && error.code === expected;

test('lite schemas reject unknown keys and wrong types, and treat empty strings as clearing text only', () => {
  const schema = { jobId: 'string', text: 'string?', due: 'date?', status: 'enum:scheduled|completed?', tags: 'string[]?', evidence: 'array?' };
  assert.throws(() => validateInput(schema, { jobId: 'j', extra: 1 }), code('invalid_input'));
  assert.throws(() => validateInput(schema, {}), /Missing input "jobId"/);
  assert.throws(() => validateInput(schema, { jobId: 3 }), /must be a string/);
  assert.throws(() => validateInput(schema, { jobId: 'j', due: '10/30/2026' }), /must be a date/);
  assert.throws(() => validateInput(schema, { jobId: 'j', status: 'maybe' }), /one of scheduled, completed/);
  assert.throws(() => validateInput(schema, { jobId: 'j', tags: ['a', 2] }), /string\[\]/);
  assert.throws(() => validateInput(schema, []), /must be an object/);
  assert.deepEqual(validateInput(schema, { jobId: 'j', text: '', due: '' }), { jobId: 'j', text: '' }, 'empty text is a value; an empty date is absent');
  const original = { jobId: 'j', due: '' };
  validateInput(schema, original);
  assert.equal(original.due, '', 'the caller input is not mutated');
});

test('every action declares a valid tier, and the registry never exposes handlers', async () => {
  const h = await harness();
  try {
    const listed = h.registry.list();
    const names = new Set(listed.map(d => d.name));
    // The initial action names from docs/AGENT-CONTRACTS.md §2.
    for (const name of ['workspace.digest', 'jobs.list', 'jobs.get', 'followups.list', 'audit.list', 'usage.summary',
      'record.addContact', 'record.removeContact', 'record.addInterview', 'record.setInterviewStatus', 'record.removeInterview', 'record.setNextAction',
      'jobs.add', 'jobs.select', 'jobs.setContext', 'jobs.setStatus', 'sources.add', 'sources.remove', 'corrections.propose',
      'tasks.interview', 'tasks.discover', 'tasks.evaluate', 'tasks.prepare', 'tasks.cancel',
      'understanding.approve', 'packet.approve', 'corrections.approve', 'corrections.reject', 'jobs.confirmSubmitted']) assert.ok(names.has(name), name);
    for (const definition of listed) {
      assert.ok(TIERS.includes(definition.tier), definition.name);
      assert.equal(typeof definition.description, 'string');
      assert.equal(definition.run, undefined);
      assert.equal(definition.undo, undefined);
    }
    assert.deepEqual(h.registry.list({ tiers: ['candidate'] }).map(d => d.name).sort(), ['answers.remove', 'answers.update', 'calibration.decide', 'context.include', 'corrections.approve', 'corrections.reject', 'followups.markSent', 'format.save', 'insights.approve', 'insights.defer', 'insights.reject', 'jobs.confirmSubmitted', 'jobs.setApplyLink', 'line.removeStatement', 'packet.approve', 'profile.removeWritingSample', 'settings.autonomy', 'standard.approve', 'understanding.approve']);
    await assert.rejects(h.registry.run('jobs.delete', {}), code('unknown_action'));
    await assert.rejects(h.registry.run('workspace.digest', {}, { actor: 'robot' }), /Unknown actor/);
  } finally { await h.close(); }
});

test('tiers are enforced per actor: agents need confirmation, external agents cannot run tasks, nobody but the candidate approves', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    await h.evaluate(jobId);
    const write = { jobId, text: 'Send references', due: '2026-10-31' };
    await assert.rejects(h.registry.run('record.setNextAction', write, { actor: 'agent' }), code('confirmation_required'));
    assert.equal((await h.app.workspace.load()).jobs[0].record?.nextAction ?? null, null, 'nothing was written without confirmation');
    await h.registry.run('record.setNextAction', write, { actor: 'agent', confirmed: true });
    assert.equal((await h.app.workspace.load()).jobs[0].record.nextAction.text, 'Send references');
    await h.registry.run('record.addContact', { jobId, name: 'Dana Lee' }, { actor: 'mcp' });
    await assert.rejects(h.registry.run('tasks.evaluate', { jobId }, { actor: 'mcp' }), code('confirmation_required'));
    await assert.rejects(h.registry.run('tasks.evaluate', { jobId }, { actor: 'agent' }), code('confirmation_required'));

    for (const actor of ['agent', 'mcp']) {
      for (const confirmed of [false, true]) {
        const refused = await h.registry.run('packet.approve', { jobId }, { actor, confirmed }).catch(error => error);
        assert.equal(refused.code, 'candidate_only', `${actor} confirmed=${confirmed}`);
        assert.deepEqual(refused.panel, { type: 'packet', id: jobId });
        assert.equal((await h.registry.run('jobs.confirmSubmitted', { jobId }, { actor, confirmed }).catch(error => error)).code, 'candidate_only');
      }
    }
    const applied = await h.registry.run('jobs.setStatus', { jobId, status: 'Applied' }, { actor: 'agent', confirmed: true }).catch(error => error);
    assert.equal(applied.code, 'candidate_only', 'Applied cannot be reached through the ordinary status action');
    assert.notEqual((await h.app.workspace.load()).jobs[0].status, 'Applied');

    const audit = await h.registry.run('audit.list', {}, { actor: 'agent' });
    assert.deepEqual(audit.result.map(entry => entry.action).sort(), ['agent-write', 'mcp-write']);
    assert.match(audit.result.find(entry => entry.action === 'agent-write').reason, /record\.setNextAction: Next action: Send references, due 2026-10-31/);
  } finally { await h.close(); }
});

test('undo restores the previous state once, and refuses when the record changed since', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    await h.registry.run('record.setNextAction', { jobId, text: 'First step' });
    const second = await h.registry.run('record.setNextAction', { jobId, text: 'Second step' });
    await h.registry.undo(second.undoToken);
    assert.equal((await h.app.workspace.load()).jobs[0].record.nextAction.text, 'First step');
    await assert.rejects(h.registry.undo(second.undoToken), /can no longer be undone/, 'tokens are single use');

    const added = await h.registry.run('record.addContact', { jobId, name: 'Dana Lee' });
    await h.registry.run('record.addContact', { jobId, name: 'Sam Ortiz' });
    await assert.rejects(h.registry.undo(added.undoToken), /changed since/);
    assert.equal((await h.app.workspace.load()).jobs[0].record.contacts.length, 2, 'a refused undo changes nothing');

    const source = await h.registry.run('sources.add', { name: 'Acme', url: 'https://boards.greenhouse.io/acme' });
    await h.registry.undo(source.undoToken);
    assert.equal((await h.app.workspace.load()).sources.length, 0);

    const another = await h.addJob(2);
    const state = await h.app.workspace.load();
    assert.equal(state.jobs.length, 2);
    const fresh = await h.registry.run('jobs.add', { company: 'Undo Co', title: 'Engineer', url: 'https://jobs.lever.co/test/undo' });
    await h.registry.undo(fresh.undoToken);
    assert.deepEqual((await h.app.workspace.load()).jobs.map(j => j.id).sort(), [another, jobId].sort());
    await assert.rejects(h.registry.undo('not-a-token'), /can no longer be undone/);
  } finally { await h.close(); }
});

test('the digest summarises what needs attention without private notes or job text', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    const unevaluated = await h.addJob(2);
    await h.evaluate(jobId);
    await h.registry.run('record.addContact', { jobId, name: 'Dana Lee', email: 'dana@example.invalid', notes: 'Private note about Dana' });
    await h.registry.run('record.addInterview', { jobId, stage: 'Recruiter screen', date: '2099-01-05', notes: 'Asked about salary' });
    await h.registry.run('record.setNextAction', { jobId, text: 'Send references', due: '2020-01-01' });
    const { result } = await h.registry.run('workspace.digest', {}, { actor: 'agent' });
    const text = JSON.stringify(result);
    for (const secret of ['Dana Lee', 'dana@example.invalid', 'Private note', 'Asked about salary', 'designing and testing hardware']) assert.ok(!text.includes(secret), secret);
    const job = result.jobs.find(j => j.id === jobId);
    assert.deepEqual(job.nextAction, { text: 'Send references', due: '2020-01-01' });
    assert.deepEqual(job.upcomingInterview, { stage: 'Recruiter screen', date: '2099-01-05' });
    assert.equal(job.score, 4.4);
    const kinds = result.attention.map(item => item.kind);
    assert.ok(kinds.includes('overdue'));
    assert.ok(kinds.includes('interview'));
    assert.ok(result.attention.some(item => item.kind === 'evaluate' && item.jobId === unevaluated));
    assert.deepEqual(result.counts, { jobs: 2, selected: 0, prepared: 0, applied: 0 });
    assert.equal(result.profile.ready, true);
  } finally { await h.close(); }
});

test('reading a job description marks the result as untrusted employer content', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    const plain = await h.registry.run('jobs.get', { jobId }, { actor: 'agent' });
    assert.deepEqual(plain.taintSources, []);
    assert.equal(plain.result.description, undefined);
    const full = await h.registry.run('jobs.get', { jobId, include: ['description', 'record'] }, { actor: 'agent' });
    assert.deepEqual(full.taintSources, [{ kind: 'job', id: jobId, label: 'Company 1 — Graduate Engineer' }]);
    assert.ok('record' in full.result);
  } finally { await h.close(); }
});

test('choosing a role below 4/5 needs the recorded reason, whoever asks', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    await assert.rejects(h.registry.run('jobs.select', { jobId, selected: true }), /Evaluate this role/);
    await h.evaluate(jobId);
    await h.app.workspace.mutate(state => { state.jobs[0].evaluation.score = 3.6; });
    await assert.rejects(h.registry.run('jobs.select', { jobId, selected: true }), /below 4\/5/);
    await h.registry.run('jobs.setContext', { jobId, overrideReason: 'Team works on the exact robotics platform I built.' });
    const chosen = await h.registry.run('jobs.select', { jobId, selected: true });
    assert.equal((await h.app.workspace.load()).jobs[0].selected, true);
    await h.registry.undo(chosen.undoToken);
    assert.equal((await h.app.workspace.load()).jobs[0].selected, false);
  } finally { await h.close(); }
});

test('the UI action endpoint runs registry actions and returns error codes', async () => {
  const h = await harness();
  try {
    const added = await h.request('action', { name: 'jobs.add', input: { company: 'Endpoint Co', title: 'Engineer', url: 'https://jobs.lever.co/test/e' } });
    assert.equal(added.status, 200);
    assert.ok(added.data.undoToken);
    const jobId = added.data.result.id;
    assert.equal((await h.request('action/undo', { undoToken: added.data.undoToken })).status, 200);
    assert.equal((await h.app.workspace.load()).jobs.some(j => j.id === jobId), false);
    const bad = await h.request('action', { name: 'jobs.add', input: { company: 'X' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'invalid_input');
    assert.equal((await h.request('action', { name: 'nope', input: {} })).data.code, 'unknown_action');
    const digestResult = await h.request('action', { name: 'workspace.digest' });
    assert.equal(digestResult.status, 200);
    assert.ok(Array.isArray(digestResult.data.result.attention));
  } finally { await h.close(); }
});

test('review fixes: prototype keys, undo invariants, legacy routes and taint', async () => {
  assert.throws(() => validateInput({ jobId: 'string' }, { jobId: 'a', constructor: 'x' }), code('invalid_input'));
  assert.throws(() => validateInput({ jobId: 'string' }, JSON.parse('{"jobId":"a","__proto__":{"x":1}}')), code('invalid_input'));
  const h = await harness();
  try {
    const jobId = await h.addJob();
    const other = await h.addJob(2);
    await h.evaluate(jobId);

    // A rejected legacy update saves nothing.
    for (const body of [{ id: jobId, selected: true, status: 'Applied' }, { id: jobId, description: 'Replaced posting text. '.repeat(10), status: 'Bogus' }]) {
      assert.equal((await h.request('jobs/update', body)).status, 400);
      const job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
      assert.equal(job.selected, false);
      assert.ok(job.evaluation, 'evaluation survives a rejected request');
    }

    // Undoing a deselect re-checks the choice rules.
    const chosen = await h.registry.run('jobs.select', { jobId, selected: true });
    const dropped = await h.registry.run('jobs.select', { jobId, selected: false });
    await h.registry.run('jobs.setContext', { jobId, description: 'Changed posting text that clears the evaluation. '.repeat(5) });
    await assert.rejects(h.registry.undo(dropped.undoToken), /Evaluate this role/);
    assert.equal((await h.app.workspace.load()).jobs.find(j => j.id === jobId).selected, false);
    assert.ok(chosen.undoToken);

    // Undoing an add refuses once the role has been touched.
    const fresh = await h.registry.run('jobs.add', { company: 'Touched Co', title: 'Engineer', url: 'https://jobs.lever.co/test/t' });
    await h.registry.run('record.addContact', { jobId: fresh.result.id, name: 'Pat' });
    await assert.rejects(h.registry.undo(fresh.undoToken), /worked on since/);

    // The legacy route's job id wins over a nested one; unknown nested fields are ignored.
    assert.equal((await h.request('jobs/record/contact', { id: jobId, contact: { name: 'Dana', jobId: other, date: '2026-01-01' } })).status, 200);
    const state = await h.app.workspace.load();
    assert.equal(state.jobs.find(j => j.id === jobId).record.contacts[0].name, 'Dana');
    assert.equal(state.jobs.find(j => j.id === other).record, undefined);

    // Model output derived from the posting is untrusted too.
    const evaluated = await h.addJob(3);
    await h.evaluate(evaluated);
    const read = await h.registry.run('jobs.get', { jobId: evaluated }, { actor: 'agent' });
    assert.deepEqual(read.taintSources.map(item => item.kind), ['evaluation']);

    // Undoing an agent change is audited.
    const agentWrite = await h.registry.run('record.setNextAction', { jobId, text: 'Agent step' }, { actor: 'agent', confirmed: true });
    await h.registry.undo(agentWrite.undoToken);
    const audit = (await h.registry.run('audit.list', {})).result.map(entry => entry.action);
    assert.ok(audit.includes('ui-undo'));
  } finally { await h.close(); }
});


test('the local MCP bridge uses its own token, keeps MCP tier rules and is announced in an owner-only file', async () => {
  const { stat, readFile } = await import('node:fs/promises');
  const { LOCAL_API_FILE } = await import('./plainhand-server.mjs');
  const h = await harness();
  const file = path.join(h.app.workspace.root, LOCAL_API_FILE);
  try {
    let info;
    for (let i = 0; i < 100 && !info; i++) { try { info = JSON.parse(await readFile(file, 'utf8')); } catch { await new Promise(r => setTimeout(r, 10)); } }
    assert.ok(info, 'handoff file written after listening');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(info.port, h.app.server.address().port);
    const call = async (route, input, token = info.mcpToken) => {
      const response = await fetch(`http://127.0.0.1:${info.port}/api/mcp/${route}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-MCP-Token': token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await call('actions', undefined, 'wrong')).status, 403);
    assert.equal((await call('actions', undefined, h.app.token)).status, 403, 'the UI session token is not an MCP token');
    const listed = (await call('actions')).data.actions;
    assert.ok(listed.some(a => a.name === 'record.setNextAction'));
    assert.ok(!listed.some(a => a.tier === 'task'), 'tasks are not offered to external agents');
    const jobId = await h.addJob();
    const write = await call('action', { name: 'record.setNextAction', input: { jobId, text: 'From my own agent' }, reason: 'asked in Claude Code' });
    assert.equal(write.status, 200);
    assert.equal((await h.app.workspace.load()).jobs[0].record.nextAction.text, 'From my own agent');
    assert.equal((await call('action', { name: 'tasks.evaluate', input: { jobId } })).data.code, 'confirmation_required');
    const approve = await call('action', { name: 'packet.approve', input: { jobId } });
    assert.equal(approve.data.code, 'candidate_only');
    assert.equal((await call('undo', { undoToken: write.data.undoToken })).status, 200);
    const audit = (await h.registry.run('audit.list', {})).result;
    assert.ok(audit.some(entry => entry.action === 'mcp-write' && /asked in Claude Code/.test(entry.reason)));
    assert.ok(audit.some(entry => entry.action === 'mcp-undo'));
    await h.app.close();
    await assert.rejects(stat(file), 'handoff file removed on shutdown, before the workspace folder is deleted');
  } finally { await h.close().catch(() => {}); }
});
