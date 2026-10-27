import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { digest } from './plainhand/store.mjs';
import { packetIdentity } from './plainhand/workflow.mjs';
import { AnswerBank } from './plainhand/answer-bank.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-brain-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent: fixtureAgent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate, eligibility: 'Authorized to work in the US', compensation: '$85k' }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; s.conversation.push({ role: 'user', text: 'I ran the physical load tests myself.', at: new Date().toISOString() }); });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const approvedJob = async () => {
    const { result: { id } } = await ui('jobs.add', { company: 'Acme', title: 'Engineer', url: 'https://jobs.lever.co/acme/brain' });
    await ui('tasks.evaluate', { jobId: id }); await app.workflow.queue;
    await ui('jobs.select', { jobId: id, selected: true });
    await ui('tasks.prepare', { jobId: id }); await app.workflow.queue;
    await ui('packet.approve', { jobId: id });
    return id;
  };
  return { app, ui, approvedJob, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('excluding a source or field removes it from the provider context and invalidates approvals', async () => {
  const h = await harness();
  try {
    const jobId = await h.approvedJob();
    let job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.approvedHash, packetIdentity(job));
    const before = await h.app.workspace.context(await h.app.workspace.load());
    assert.ok(before.sources.some(s => s.id === 'interview'));
    assert.match(before.sources.find(s => s.id === 'profile').text, /Authorized to work/);

    await h.ui('context.exclude', { sources: ['interview'], fields: ['eligibility', 'compensation'] });
    const after = await h.app.workspace.context(await h.app.workspace.load());
    assert.ok(!after.sources.some(s => s.id === 'interview'));
    const profileText = after.sources.find(s => s.id === 'profile').text;
    assert.doesNotMatch(profileText, /Authorized to work|\$85k/);
    assert.match(profileText, /Test Graduate|graduate/i, 'the rest of the profile is still shared');
    assert.notEqual(after.hash, before.hash);

    await assert.rejects(h.ui('packet.approve', { jobId }), /regenerated/, 'an approval made with the old context cannot be renewed');
    const state = (await (await fetch(`http://127.0.0.1:${h.app.server.address().port}/api/state`, { headers: { 'X-Plainhand-Token': h.app.token } })).json());
    assert.equal(state.jobs.find(j => j.id === jobId).stale, true, 'the packet shows as needing a refresh');
    assert.ok(!state.sourceManifest.some(s => s.id === 'interview'));

    const view = (await h.ui('context.get', {})).result;
    assert.deepEqual(view.sources.find(s => s.id === 'interview').included, false);
    assert.equal(view.sources.find(s => s.id === 'profile').excludable, false);
    assert.deepEqual(view.fields.filter(f => !f.included).map(f => f.name).sort(), ['compensation', 'eligibility']);
    await assert.rejects(h.ui('context.exclude', { sources: ['profile'] }), /individual fields/);
    await assert.rejects(h.ui('context.exclude', { fields: ['name'] }), /not an excludable/);
  } finally { await h.close(); }
});

test('the agent can narrow what is shared, never widen it', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.app.registry.run('context.exclude', { fields: ['phone'] }, { actor: 'agent' }), /needs your confirmation/);
    const narrowed = await h.app.registry.run('context.exclude', { fields: ['phone'] }, { actor: 'agent', confirmed: true });
    assert.deepEqual((await h.app.workspace.load()).contextPrefs.excludedFields, ['phone']);
    for (const actor of ['agent', 'mcp']) {
      const refused = await h.app.registry.run('context.include', { fields: ['phone'] }, { actor, confirmed: true }).catch(error => error);
      assert.equal(refused.code, 'candidate_only', actor);
    }
    assert.deepEqual((await h.app.workspace.load()).contextPrefs.excludedFields, ['phone']);
    await h.app.registry.undo(narrowed.undoToken);
    assert.deepEqual((await h.app.workspace.load()).contextPrefs.excludedFields, []);
    await h.ui('context.exclude', { sources: ['cv'] });
    await h.ui('context.include', { sources: ['cv'] });
    assert.deepEqual((await h.app.workspace.load()).contextPrefs.excludedSources, []);
  } finally { await h.close(); }
});

test('reusable answers are edited and removed only by the candidate, keeping their source quote', async () => {
  const h = await harness();
  try {
    const bank = new AnswerBank(h.app.workspace);
    const entry = await bank.add({ question: 'Describe a hands-on project', answer: 'I designed and tested a chassis.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis' }] });
    assert.deepEqual((await h.app.registry.run('answers.list', {}, { actor: 'agent' })).result.map(a => a.id), [entry.id]);
    assert.equal((await h.app.registry.run('answers.update', { id: entry.id, answer: 'x' }, { actor: 'agent', confirmed: true }).catch(e => e)).code, 'candidate_only');
    await h.ui('answers.update', { id: entry.id, answer: 'I designed and load-tested a lightweight chassis.', reviewBy: '2027-06-01' });
    const [updated] = await bank.load();
    assert.equal(updated.answer, 'I designed and load-tested a lightweight chassis.');
    assert.equal(updated.reviewBy, '2027-06-01');
    assert.deepEqual(updated.evidence, entry.evidence);
    assert.equal((await h.app.registry.run('answers.remove', { id: entry.id }, { actor: 'mcp' }).catch(e => e)).code, 'candidate_only');
    await h.ui('answers.remove', { id: entry.id });
    assert.deepEqual(await bank.load(), []);
  } finally { await h.close(); }
});

test('switching the AI provider keeps memory, approvals and the context fingerprint', async () => {
  const h = await harness();
  try {
    const jobId = await h.approvedJob();
    await h.ui('record.setNextAction', { jobId, text: 'Follow up' });
    const before = await h.app.workspace.load();
    const contextBefore = await h.app.workspace.context(before);
    const response = await fetch(`http://127.0.0.1:${h.app.server.address().port}/api/provider`, { method: 'POST', headers: { 'X-Plainhand-Token': h.app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'codex' }) });
    assert.equal(response.status, 200);
    await h.app.workspace.mutate(s => { s.provider = 'claude'; });
    const after = await h.app.workspace.load();
    assert.equal((await h.app.workspace.context(after)).hash, contextBefore.hash);
    const job = after.jobs.find(j => j.id === jobId);
    assert.equal(job.approvedHash, packetIdentity(job), 'the approval still matches');
    assert.deepEqual(after.conversation, before.conversation);
    assert.deepEqual(job.record, before.jobs.find(j => j.id === jobId).record);
    assert.deepEqual(after.understanding, before.understanding);
  } finally { await h.close(); }
});
