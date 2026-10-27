import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';

const workflowOptions = agent => ({ agent,
  verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
  renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; } });
async function start(agent = fixtureAgent) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-import-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: workflowOptions(agent) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = async (endpoint, input) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${endpoint}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  return { app, root, request, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('an export restores into a fresh workspace; approvals and machine state are reset', async () => {
  const agent = scriptedAgent([{ reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Carry me over' } }] }) }]);
  const a = await start(agent), b = await start();
  try {
    let s = await a.app.workspace.load();
    await a.app.workspace.saveProfile({ ...s.profile, ...candidate }, s.revision);
    await a.app.workspace.mutate(state => { state.provider = 'codex'; });
    const ui = (name, input) => a.app.registry.run(name, input);
    const { result: { id: jobId } } = await ui('jobs.add', { company: 'Acme', title: 'Engineer', url: 'https://jobs.lever.co/acme/import' });
    await ui('tasks.evaluate', { jobId }); await a.app.workflow.queue;
    await ui('jobs.select', { jobId, selected: true });
    await ui('tasks.prepare', { jobId }); await a.app.workflow.queue;
    await ui('packet.approve', { jobId });
    await ui('record.addContact', { jobId, name: 'Dana Lee', email: 'dana@example.invalid' });
    await ui('context.exclude', { fields: ['phone'] });
    const { turnId } = await a.app.agent.message('remind me'); await a.app.agent.running;
    const exported = (await a.request('export')).data;

    const preview = (await b.request('import/preview', { data: exported })).data;
    assert.deepEqual([preview.name, preview.jobs, preview.approvalsReset, preview.conversation], [candidate.name, 1, 1, 2]);
    assert.equal((await b.request('import', { data: exported })).status, 400, 'an import needs explicit confirmation');
    const result = (await b.request('import', { data: exported, confirm: true })).data;
    assert.equal(result.jobs, 1);
    assert.equal(result.approvalsReset, 1);
    assert.equal(result.conversation, 2);
    assert.ok(result.usageReceipts >= 1);

    const restored = await b.app.workspace.load();
    const job = restored.jobs[0];
    assert.equal(job.id, jobId);
    assert.equal(job.approvedHash, null, 'approvals never travel: the PDFs are not in the export');
    assert.equal(job.browserCheckpoint, undefined);
    assert.equal(job.record.contacts[0].email, 'dana@example.invalid');
    assert.deepEqual(restored.contextPrefs.excludedFields, ['phone'], 'sharing choices travel');
    assert.equal(restored.profile.name, candidate.name);
    assert.match(await b.app.workspace.read('config/profile.yml'), new RegExp(candidate.name));
    assert.match(await b.app.workspace.read('cv.md'), /chassis/);
    assert.match(await b.app.workspace.read('data/applications.md'), /\| Acme \| Engineer \|/);
    const history = await b.app.agent.history();
    assert.deepEqual(history.messages.map(m => m.turnId), [turnId, turnId]);
    assert.equal(history.proposals[0].status, 'pending', 'a pending proposal can still be confirmed after moving');
    await b.app.agent.confirm({ proposalId: history.proposals[0].id, accept: true });
    assert.equal((await b.app.workspace.load()).jobs[0].record.nextAction.text, 'Carry me over');
    const backups = await readdir(path.join(b.root, 'data/plainhand/backups'));
    assert.ok(backups.some(name => name.includes('-import-workspace.json')), 'the replaced workspace was backed up first');
  } finally { await a.close(); await b.close(); }
});

test('invalid exports and imports during work are refused without changing anything', async () => {
  const h = await start();
  try {
    const before = await h.app.workspace.read('data/plainhand/workspace.json');
    for (const data of [null, [], { version: 2, profile: {} }, { version: 1 }, { version: 1, profile: {}, jobs: [{ id: 'x' }] }, { version: 1, profile: {}, jobs: [{ id: 'a', company: 'A', title: 'T' }, { id: 'a', company: 'A', title: 'T' }] }, { version: 1, profile: {}, jobs: 'nope' }]) {
      const response = await h.request('import', { data, confirm: true });
      assert.equal(response.status, 400, JSON.stringify(data));
    }
    assert.equal(await h.app.workspace.read('data/plainhand/workspace.json'), before);
    await h.app.workspace.mutate(state => { state.tasks.unshift({ id: 't', kind: 'evaluate', status: 'running', createdAt: new Date().toISOString() }); });
    const busy = await h.request('import', { data: { version: 1, profile: {} }, confirm: true });
    assert.match(busy.data.error, /Wait for the running/);
  } finally { await h.close(); }
});
