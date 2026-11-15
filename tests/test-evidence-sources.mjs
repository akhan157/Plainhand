import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest, hasEvidence, identityProblem, claimEvidenceProblem, FACTUAL_SOURCE_IDS } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';

// Fictional fixture text only. No candidate or employer data.
const CHASSIS = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const CV = `${CHASSIS} B.S. Mechanical Engineering, Example University, 2027.`;
const SAMPLE = 'Hi team, quick update: the upright passed the load test this morning. I will send the numbers tonight.';
const SUMMARY = 'The candidate has designed and tested hardware.';
const evidence = quote => [{ sourceId: 'cv', quote }];
const contextOf = text => ({ sources: [{ id: 'cv', text }, { id: 'writing-samples', text: SAMPLE }] });

test('claim evidence must come from a factual source allow-list', () => {
  const context = contextOf(CV);
  assert.deepEqual([...FACTUAL_SOURCE_IDS], ['profile', 'cv', 'structured-resume', 'narrative', 'proof-points', 'stories', 'interview']);
  assert.equal(hasEvidence({ answer: 'I designed and tested a lightweight chassis.', evidence: evidence(CHASSIS) }, context), true);

  const sampleContext = { sources: [{ id: 'cv', text: CV }, { id: 'writing-samples', text: SAMPLE }] };
  assert.equal(hasEvidence({ answer: 'I sent the test numbers tonight.', evidence: [{ sourceId: 'writing-samples', quote: SAMPLE }] }, sampleContext), false, 'a writing sample is voice, never evidence');
  assert.match(claimEvidenceProblem({ answer: 'I sent the test numbers tonight.', evidence: [{ sourceId: 'writing-samples', quote: SAMPLE }] }, sampleContext), /not a writing sample/);

  const summaryContext = { sources: [{ id: 'cv', text: CV }, { id: 'reviewed-understanding', text: SUMMARY }] };
  assert.equal(hasEvidence({ answer: 'I have designed and tested hardware.', evidence: [{ sourceId: 'reviewed-understanding', quote: SUMMARY }] }, summaryContext), false, 'the agent summary is never evidence');
  assert.match(claimEvidenceProblem({ answer: 'I have designed and tested hardware.', evidence: [{ sourceId: 'reviewed-understanding', quote: SUMMARY }] }, summaryContext), /not the reviewed understanding/);

  assert.equal(hasEvidence({ answer: 'I sent the test numbers tonight.', evidence: [{ sourceId: 'candidate-answer', quote: SAMPLE }] }, sampleContext), false, 'only factual source ids pass, not arbitrary ones');
  assert.equal(hasEvidence({ answer: 'I designed and tested a lightweight chassis.', evidence: [] }, context), false);
  assert.equal(hasEvidence({ answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: 'short' }] }, context), false);
});

test('an answer cannot introduce an employer, title or date absent from the sources', () => {
  const context = contextOf(CV);
  const planted = `Director at Northwind, 2019–2021. ${CHASSIS}`;
  assert.equal(hasEvidence({ answer: planted, evidence: evidence(CHASSIS) }, context), false, 'unsourced employer, title and dates fail');
  assert.equal(hasEvidence({ key: 'q1', answer: planted, evidence: evidence(CHASSIS) }, context), false, 'form values use the same gate');
  const problem = identityProblem(planted, context.sources);
  assert.match(problem, /date 2019, 2021/);
  assert.match(problem, /title Director/);
  assert.match(problem, /employer northwind/);

  assert.equal(hasEvidence({ answer: `I designed and tested a lightweight chassis for a Formula SAE team in 2027.`, evidence: evidence(CHASSIS) }, context), true, 'a source date is allowed');

  const raisedTitle = { sources: [{ id: 'cv', text: `${CHASSIS} Engineer at Northwind, 2019–2021.` }] };
  assert.equal(hasEvidence({ answer: planted, evidence: evidence(CHASSIS) }, raisedTitle), false, 'a raised title still fails');
  const otherEmployer = { sources: [{ id: 'cv', text: `${CHASSIS} Director at Beacon Labs, 2019–2021.` }] };
  assert.equal(hasEvidence({ answer: planted, evidence: evidence(CHASSIS) }, otherEmployer), false, 'a different employer still fails');
  const sourcedIdentity = { sources: [{ id: 'cv', text: `${CHASSIS} Director at Beacon Labs, 2019–2021.` }] };
  assert.equal(hasEvidence({ answer: `Director at Beacon Labs, 2019–2021. ${CHASSIS}`, evidence: evidence(CHASSIS) }, sourcedIdentity), true, 'identity facts the sources state are allowed');

  const named = { sources: [{ id: 'profile', text: JSON.stringify({ name: 'Test Graduate' }) }, { id: 'cv', text: CV }] };
  assert.equal(hasEvidence({ answer: 'My name is Test Graduate and I designed and tested a lightweight chassis.', evidence: evidence(CHASSIS) }, named), true);
  assert.equal(hasEvidence({ answer: 'My name is Dana Smith and I designed and tested a lightweight chassis.', evidence: evidence(CHASSIS) }, named), false, 'a name variant absent from the sources fails');
});

async function harness(agent) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-evidence-'));
  const inputs = [];
  const spy = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return agent(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: spy,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; } } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
  const prepare = async () => {
    const { result } = await ui('jobs.add', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/evidence' });
    await ui('tasks.evaluate', { jobId: result.id }); await settle();
    await ui('jobs.select', { jobId: result.id, selected: true });
    await ui('tasks.prepare', { jobId: result.id }); await settle();
    const after = await app.workspace.load();
    return { job: after.jobs.find(j => j.id === result.id), task: after.tasks[0] };
  };
  return { app, prepare, inputs, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('preparing a packet with an unsourced identity answer fails evidence; a cv-quoted packet still passes', async () => {
  const planted = async (id, instruction, data, options) => {
    if (!instruction.startsWith('Prepare a')) return fixtureAgent(id, instruction, data, options);
    return { headline: 'Mechanical Engineering Graduate', resume: [{ section: 'Projects', text: CHASSIS, evidence: evidence(CHASSIS) }], coverLetter: 'I would like to bring my design and testing experience to this engineering role.', answers: [{ question: 'Describe a relevant project.', answer: `Director at Northwind, 2019–2021. ${CHASSIS}`, evidence: evidence(CHASSIS) }], questions: [] };
  };
  const rejected = await harness(planted);
  try {
    const run = await rejected.prepare();
    assert.equal(run.task.status, 'failed', run.task.message);
    assert.match(run.task.message, /claim without an exact source reference/);
    assert.equal(run.job.packet, undefined, 'no packet is saved');
    assert.equal(run.job.approvedHash, null);
  } finally { await rejected.close(); }

  const accepted = await harness(fixtureAgent);
  try {
    const run = await accepted.prepare();
    assert.equal(run.task.status, 'complete', run.task.message);
    assert.equal(run.job.packet.answers[0].answer, 'I designed and tested a lightweight chassis for a Formula SAE team.');
    assert.equal(run.job.approvedHash, null, 'preparation never approves on its own');
  } finally { await accepted.close(); }
});
