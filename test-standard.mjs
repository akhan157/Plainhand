import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';
import { compareToStandard, autoPrepareDecision, standardStatus } from './plainhand/standard.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-standard-'));
  const inputs = [];
  const agent = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return fixtureAgent(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; } } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 5; i++) await app.workflow.queue; };
  let n = 0;
  const addJob = async () => { n++; return (await ui('jobs.add', { company: 'Test Company', title: `Graduate Engineer ${n}`, url: `https://jobs.lever.co/test/std-${n}` })).result.id; };
  const lastTask = async () => (await app.workspace.load()).tasks[0];
  return { app, ui, settle, addJob, inputs, lastTask, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('the standard is written, fact-checked and graded, and approved only by the candidate', async () => {
  const h = await harness();
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    let state = await h.app.workspace.load();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.match(state.standard.draft.coverLetter, /\{company\}/);
    assert.ok(state.standard.calibration.total >= 2);
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'draft');
    await assert.rejects(h.app.registry.run('standard.approve', {}, { actor: 'agent', confirmed: true }), e => e.code === 'candidate_only');
    await h.ui('standard.approve', {});
    state = await h.app.workspace.load();
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'approved');
    await h.ui('profile.addStory', { text: 'I also ran the brake test rig for two seasons.' });
    state = await h.app.workspace.load();
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'stale', 'a profile change makes it out of date');
    await assert.rejects(h.ui('standard.approve', {}), /profile changed/);
  } finally { await h.close(); }
});

test('applications start from the approved standard and show what changed; revisions use the candidate’s request', async () => {
  const h = await harness();
  try {
    await h.ui('tasks.standard', {}); await h.settle(); await h.ui('standard.approve', {});
    const jobId = await h.addJob();
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    const prepareInput = h.inputs.filter(i => i.instruction.startsWith('Prepare a')).at(-1).data;
    assert.match(prepareInput.standard.coverLetter, /\{role\}/, 'the drafter receives the approved standard');
    let job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.deepEqual(job.fromStandard, { kept: 2, changed: 0, added: 0, removed: 0 });
    assert.equal(typeof job.humanizer.changed, 'number', 'every packet goes through the humanizer pass');
    assert.ok(h.inputs.some(i => i.instruction.startsWith('Apply the humanizer rules')));
    await h.ui('packet.approve', { jobId });
    await h.ui('tasks.revise', { jobId, request: 'Make the cover letter shorter.' }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const reviseInput = h.inputs.filter(i => i.instruction.startsWith('Prepare a')).at(-1).data;
    assert.equal(reviseInput.revisionRequest, 'Make the cover letter shorter.');
    assert.ok(reviseInput.previousPacket && !reviseInput.standard, 'a revision works on the packet, not the standard');
    const state = await h.app.workspace.load();
    job = state.jobs.find(j => j.id === jobId);
    assert.equal(job.approvedHash, null, 'a revision clears approval');
    assert.deepEqual(state.revisions.map(r => r.request), ['Make the cover letter shorter.']);
    await h.ui('tasks.revise', { request: 'Lead with the chassis project.' }); await h.settle();
    const std = (await h.app.workspace.load()).standard;
    assert.match(std.draft.resume[0].text, /^Formula SAE:/, 'without a job, the standard is revised');
    assert.equal(std.approvedHash, null, 'a revised standard needs approval again');
  } finally { await h.close(); }
});

test('revising needs a packet; an agent’s revision request must be the candidate’s words', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    await h.ui('tasks.revise', { jobId, request: 'Shorter please.' }); await h.settle();
    assert.equal((await h.lastTask()).status, 'failed');
    assert.ok(h.app.registry.get('tasks.revise').candidateWords === 'request');
  } finally { await h.close(); }
});

test('autonomy is off by default; when on, strong matches are prepared from the standard within the daily limit', async () => {
  const h = await harness();
  try {
    await h.ui('tasks.standard', {}); await h.settle(); await h.ui('standard.approve', {});
    const first = await h.addJob();
    await h.ui('tasks.evaluate', { jobId: first }); await h.settle();
    assert.ok(!(await h.app.workspace.load()).jobs.find(j => j.id === first).packet, 'off by default: nothing is prepared');
    await assert.rejects(h.app.registry.run('settings.autonomy', { enabled: true }, { actor: 'agent', confirmed: true }), e => e.code === 'candidate_only');
    await assert.rejects(h.ui('settings.autonomy', { enabled: true, perDay: 50 }), /1 to 10/);
    await h.ui('settings.autonomy', { enabled: true, perDay: 1 });
    const second = await h.addJob(), third = await h.addJob();
    await h.ui('tasks.evaluate', { jobId: second }); await h.settle();
    await h.ui('tasks.evaluate', { jobId: third }); await h.settle();
    const state = await h.app.workspace.load();
    const auto = state.jobs.filter(j => j.autoSelectedAt);
    assert.equal(auto.length, 1, 'one a day');
    assert.ok(auto[0].packet && !auto[0].approvedHash && !auto[0].submittedAt, 'prepared, never approved or submitted');
    assert.ok(!state.jobs.find(j => j.id === third).packet);
  } finally { await h.close(); }
});

test('compareToStandard and autoPrepareDecision', () => {
  const standard = { resume: [{ text: 'Designed and tested a lightweight chassis for Formula SAE.' }, { text: 'B.S. Mechanical Engineering, 2027.' }, { text: 'Tutored physics.' }] };
  assert.deepEqual(compareToStandard({ resume: [{ text: 'B.S. Mechanical Engineering, 2027.' }, { text: 'Designed and tested a lightweight Formula SAE chassis in SolidWorks.' }, { text: 'Machined test parts.' }] }, standard), { kept: 1, changed: 1, added: 1, removed: 1 });
  assert.equal(compareToStandard({ resume: [] }, null), null);
  const base = { settings: { autonomy: { enabled: true, perDay: 2, minScore: 4 } }, standard: { draft: { headline: 'h', resume: [{ section: 's', text: 't' }], coverLetter: 'c' }, contextHash: 'x', approvedHash: null }, jobs: [] };
  const job = { evaluation: { score: 4.5, recommendation: 'Apply' } };
  assert.equal(autoPrepareDecision(base, job, 'x', '2026-10-26').reason, 'no approved standard');
});
