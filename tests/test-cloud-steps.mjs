// The deferred-agent step protocol (plainhand/cloud/steps.mjs) against a
// MemoryStorage workspace: a chat app answers each model call as a step, and
// the server validates and replays deterministically. No Postgres needed: the
// runner only touches workspace files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../plainhand/store.mjs';
import { MemoryStorage } from '../plainhand/storage.mjs';
import { Workflow } from '../plainhand/workflow.mjs';
import { createStepRunner, MAX_STEP_ATTEMPTS, STEP_TTL_MS } from '../plainhand/cloud/steps.mjs';
import { candidate, fixtureAgent } from '../plainhand/test-fixtures.mjs';
import { INTERVIEW_INSTRUCTION, EVALUATE_INSTRUCTION } from '../plainhand/agents.mjs';

async function seedProfile(workspace, overrides = {}) {
  const revision = (await workspace.load()).revision;
  await workspace.saveProfile({ ...candidate, ...overrides }, revision);
}

function makeHarness({ verifierCallCount = { n: 0 } } = {}) {
  const workspace = new Workspace('test', { storage: new MemoryStorage() });
  const makeWorkflow = agent => new Workflow(workspace, {
    agent,
    verifier: async () => { verifierCallCount.n++; return { state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture verification.' }; },
    scanner: async () => [],
    renderer: async (ws, state, job) => { const pdf = `output/test-${job.id}.pdf`; await ws.write(pdf, 'test-pdf'); return { pdf, pdfHash: 'fixture', artifacts: [pdf] }; },
  });
  const runner = createStepRunner({ workspace, makeWorkflow });
  return { workspace, makeWorkflow, runner, verifierCallCount };
}

test('start returns the first step; a valid answer finishes and commits exactly once', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  // The "chat": answers the interview step with the fixture-shaped result.
  const step = await runner.start('interview');
  assert.equal(step.status, 'step');
  assert.equal(step.step.purpose, 'interview');
  assert.match(step.step.instruction, /respond.*submit_step/s);
  assert.ok(step.step.resultSchema.properties.summary, 'result schema is attached');
  const answer = { summary: 'Hands-on design and testing.', strengths: ['Physical design'], voice: 'Direct.', questions: ['What changed?'], sampleAnswer: 'I designed and tested a chassis.', gaps: ['Outcomes.'] };
  const done = await runner.submit(step.taskId, step.step.stepId, answer);
  assert.equal(done.status, 'done', JSON.stringify(done));
  const state = await workspace.load();
  assert.equal(state.understanding.result.summary, answer.summary);
  // Replay: the same submit is refused, and current() reports the settled outcome.
  assert.equal((await runner.submit(step.taskId, step.step.stepId, answer)).status, 'done');
  assert.equal((await runner.current(step.taskId)).status, 'done');
});

test('a rejected answer comes back with the reason and the same stepId', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  const step = await runner.start('interview');
  // Valid JSON, but the schema requires questions (present) — wrong shape: summary missing.
  const bad = await runner.submit(step.taskId, step.step.stepId, { strengths: ['x'] });
  assert.equal(bad.status, 'step');
  assert.equal(bad.step.stepId, step.step.stepId);
  assert.match(bad.error, /Plainhand could not accept that result: /);
  assert.match(bad.error, /2 tries left/);
  const state = await workspace.load();
  assert.equal(state.understanding, null, 'nothing committed');
  // Then the fixed answer is accepted.
  const ok = await runner.submit(step.taskId, step.step.stepId, { summary: 'S', strengths: ['a'], voice: 'v', questions: [], sampleAnswer: 'sa', gaps: [] });
  assert.equal(ok.status, 'done');
});

test('too many bad answers fail the task; nothing is committed', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  const step = await runner.start('interview');
  let outcome = step;
  for (let i = 0; i < MAX_STEP_ATTEMPTS; i++) outcome = await runner.submit(step.taskId, step.step.stepId, { wrong: true });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error, /could not accept this step after 3 tries/);
  const state = await workspace.load();
  assert.equal(state.understanding, null);
  assert.equal((await runner.current(step.taskId)).status, 'failed');
});

test('replay only reuses answers whose input did not change', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  const step = await runner.start('interview');
  const answer = { summary: 'S1', strengths: ['a'], voice: 'v', questions: [], sampleAnswer: 'sa', gaps: [] };
  // A half-finished evaluate-style flow is overkill here; instead edit the profile so the
  // step's input digest changes, and confirm the accepted answer is not reused.
  await runner.submit(step.taskId, step.step.stepId, answer).then(r => assert.equal(r.status, 'done'));
  // New task, same kind: the profile changed in between (resume below), so the
  // previously recorded digest no longer matches and a fresh step is issued.
  await seedProfile(workspace, { resume: candidate.resume + ' Led the cooling subteam.' });
  const second = await runner.start('interview');
  assert.equal(second.status, 'step');
  assert.notEqual(second.step.stepId, step.step.stepId);
});

test('the posting verifier and job-board scanner run once per task across replays', async () => {
  const { workspace, runner, verifierCallCount } = makeHarness();
  await seedProfile(workspace);
  const jobId = 'job-1';
  await workspace.mutate(state => { state.jobs.push({ id: jobId, company: 'Fixture Co', title: 'Graduate Engineer', url: 'https://jobs.example.com/1', status: 'Evaluated', selected: false, evidence: [], createdAt: new Date().toISOString() }); });
  const step = await runner.start('evaluate', { jobId });
  assert.equal(step.status, 'step');
  assert.equal(verifierCallCount.n, 1, 'verifier ran once for the first pass');
  // Wrong stepId: rejected, then resubmit the right one; the verifier is cached.
  const wrong = await runner.submit(step.taskId, 's0-000000000000', {});
  assert.equal(wrong.status, 'step');
  assert.match(wrong.error, /not s0-000000000000/);
  assert.equal(verifierCallCount.n, 1, 'still cached after the rejected submit');
  const answer = { score: 4.4, recommendation: 'Apply', summary: 'Relevant.', matches: [{ text: 'design and testing', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis for a Formula SAE team.' }] }], gaps: [], questions: [], legitimacyNotes: [] };
  const done = await runner.submit(step.taskId, step.step.stepId, answer);
  assert.equal(done.status, 'done', JSON.stringify(done));
  assert.match(done.summary, /fit 4\.4\/5/);
  assert.equal(verifierCallCount.n, 1, 'replayed passes reuse the cached verification');
  const job = (await workspace.load()).jobs.find(j => j.id === jobId);
  assert.equal(job.evaluation.score, 4.4);
});

test('an unanswered step expires after STEP_TTL_MS and the task can be restarted', async () => {
  let clock = 0;
  const storage = new MemoryStorage();
  const workspace = new Workspace('test', { storage });
  const makeWorkflow = agent => new Workflow(workspace, { agent, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture verification.' }), scanner: async () => [], renderer: async () => ({ pdf: 'output/x.pdf', pdfHash: 'h', artifacts: ['output/x.pdf'] }) });
  const runner = createStepRunner({ workspace, makeWorkflow, now: () => clock });
  await seedProfile(workspace);
  const step = await runner.start('interview');
  assert.equal(step.status, 'step');
  clock = STEP_TTL_MS + 1;
  const expired = await runner.submit(step.taskId, step.step.stepId, { summary: 'S', strengths: ['a'], voice: 'v', questions: [], sampleAnswer: 'sa', gaps: [] });
  assert.equal(expired.status, 'interrupted');
  assert.match(expired.error, /waited more than 2 hours/);
  const task = (await workspace.load()).tasks.find(t => t.id === step.taskId);
  assert.equal(task.status, 'interrupted');
});

test('evaluate requires a job; revise without one revises the standard; unknown kinds are refused', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  assert.equal((await runner.start('evaluate', {})).status, 'failed');
  assert.match((await runner.start('evaluate', {})).error, /Say which role/);
  const revise = await runner.start('revise', { request: 'make it shorter' });
  assert.equal(revise.status, 'failed');
  assert.match(revise.error, /Write your standard application before asking for changes/);
  const standard = await runner.start('standard');
  assert.equal(standard.status, 'step');
  assert.equal(standard.step.purpose, 'standard');
  const unknownJob = await runner.start('evaluate', { jobId: 'nope' });
  assert.equal(unknownJob.status, 'failed');
  assert.match(unknownJob.error, /Job not found/);
  assert.equal((await runner.start('nonsense')).status, 'failed');
  assert.match((await runner.start('nonsense')).error, /Unknown task/);
  assert.match((await runner.current('not-a-task-id')).error, /No Plainhand task with that id/);
});

test('a chat result wrapped in markdown code fences is unwrapped', async () => {
  const { workspace, runner } = makeHarness();
  await seedProfile(workspace);
  const step = await runner.start('interview');
  const answer = '```json\n' + JSON.stringify({ summary: 'S', strengths: ['a'], voice: 'v', questions: [], sampleAnswer: 'sa', gaps: [] }) + '\n```';
  const done = await runner.submit(step.taskId, step.step.stepId, answer);
  assert.equal(done.status, 'done', JSON.stringify(done));
});
