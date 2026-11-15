import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { compareToStandard, autoPrepareDecision, standardStatus } from '../plainhand/standard.mjs';

async function harness(base = fixtureAgent, verify = null) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-standard-'));
  const inputs = [];
  const agent = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return base(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent,
    verifier: async job => verify ? verify(job) : ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
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
    assert.equal(state.standard.kind, 'master');
    assert.ok(state.standard.coverage.lines >= 0 && Array.isArray(state.standard.coverage.missing));
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
    assert.match(prepareInput.master.coverLetter, /\{role\}/, 'the drafter receives the approved master resume');
    let job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.deepEqual(job.fromStandard, { kept: 2, changed: 0, added: 0, removed: 0, total: 2 });
    assert.equal(typeof job.humanizer.changed, 'number', 'every packet goes through the humanizer pass');
    assert.ok(h.inputs.some(i => i.instruction.startsWith('Apply the humanizer rules')));
    await h.ui('packet.approve', { jobId });
    await h.ui('tasks.revise', { jobId, request: 'Make the cover letter shorter.' }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const reviseInput = h.inputs.filter(i => i.instruction.startsWith('Prepare a')).at(-1).data;
    assert.equal(reviseInput.revisionRequest, 'Make the cover letter shorter.');
    assert.ok(reviseInput.previousPacket && !reviseInput.master, 'a revision works on the packet, not the master resume');
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
  assert.deepEqual(compareToStandard({ resume: [{ text: 'B.S. Mechanical Engineering, 2027.' }, { text: 'Designed and tested a lightweight Formula SAE chassis in SolidWorks.' }, { text: 'Machined test parts.' }] }, standard), { kept: 1, changed: 1, added: 1, removed: 1, total: 3 });
  assert.equal(compareToStandard({ resume: [] }, null), null);
  const base = { settings: { autonomy: { enabled: true, perDay: 2, minScore: 4 } }, standard: { draft: { headline: 'h', resume: [{ section: 's', text: 't' }], coverLetter: 'c' }, contextHash: 'x', approvedHash: null }, jobs: [] };
  const job = { evaluation: { score: 4.5, recommendation: 'Apply' } };
  assert.equal(autoPrepareDecision(base, job, 'x', '2026-10-26').reason, 'no approved standard');
});

test('master coverage names resume lines the master left out and ignores contact lines', async () => {
  const { masterCoverage, standardStatus } = await import('../plainhand/standard.mjs');
  const resume = ['Priya Raman', 'Boston, US | priya@example.invalid | +1 617 555 0107', '', 'Experience', 'Example Manufacturing Corp — Financial Analyst — 2023 to 2026',
    '• I built and maintain the three-statement forecast model for a $240 million business unit in Excel.',
    '• I rebuilt the monthly reporting pack in Power Query, which cut its preparation from 3 days to 1.',
    '• I trained two new analysts on the forecast model and wrote its user guide.'].join('\n');
  const heading = { org: 'Example Manufacturing Corp', title: 'Financial Analyst', location: '', dates: '2023 to 2026' };
  const partial = masterCoverage(resume, [{ section: 'Experience', heading, text: 'Built and maintain the three-statement forecast model for a $240 million business unit in Excel.' }]);
  assert.equal(partial.lines, 4, 'three bullets and the role line; name and contact lines are not counted');
  assert.equal(partial.covered, 2, 'the reworded bullet and the role line, which the heading covers');
  assert.deepEqual(partial.missing.map(line => line.slice(0, 22)), ['I rebuilt the monthly ', 'I trained two new anal']);
  const full = masterCoverage(resume, [
    { section: 'Experience', heading, text: 'Built and maintain the three-statement forecast model for a $240 million business unit in Excel.' },
    { section: 'Experience', heading, text: 'Rebuilt the monthly reporting pack in Power Query, cutting preparation from 3 days to 1.' },
    { section: 'Experience', heading, text: 'Trained two new analysts on the forecast model and wrote its user guide.' }]);
  assert.deepEqual(full.missing, []);
  // A curated standard resume from before the master resume existed is out of date.
  assert.equal(standardStatus({ standard: { draft: { headline: 'x', resume: [], coverLetter: '' }, approvedHash: 'h' } }, null), 'stale');
});

test('a master resume that leaves out resume lines is redrafted once, and a failed redraft keeps the reviewed first draft', async () => {
  let masters = 0, reviews = 0;
  const agent = (id, instruction, data, options) => {
    if (instruction.startsWith("Write the candidate's master resume")) {
      masters++;
      const full = fixtureAgent(id, instruction, data, options);
      // The first draft drops the project line; the redraft restores it.
      return masters === 1 ? { ...full, resume: full.resume.filter(e => e.section !== 'Projects') } : full;
    }
    if (instruction.startsWith('Review this')) { reviews++; return reviews === 2 ? { passed: false, issues: ['An unsupported claim.'] } : { passed: true, issues: [] }; }
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness(agent);
  try {
    await h.app.workspace.mutate(s => { s.profile.resume = 'Designed and tested a lightweight chassis for a Formula SAE team.\nB.S. Mechanical Engineering, Example University, 2027.'; });
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const second = h.inputs.filter(i => i.instruction.startsWith("Write the candidate's master resume"))[1]?.data;
    assert.ok(second, 'a draft missing resume lines gets a second pass');
    assert.match(second.missingFromResume.join(' '), /Formula SAE/);
    const std = (await h.app.workspace.load()).standard;
    assert.equal(std.review.passed, true, 'the reviewed first draft is kept when the redraft fails review');
    assert.equal(std.draft.resume.length, 1);
    assert.equal(std.coverage.missing.length, 1, 'the card still shows what is missing');
  } finally { await h.close(); }
});

test('a LinkedIn posting without the employer link is evaluated, prepared, approved and confirmed by hand', async () => {
  const { verifyJob } = await import('../plainhand/jobs.mjs');
  const h = await harness(fixtureAgent, verifyJob);
  try {
    const description = 'Graduate engineer role designing and testing hardware with CAD and prototypes. '.repeat(6);
    const jobId = (await h.ui('jobs.add', { company: 'Board Company', title: 'Graduate Engineer', url: 'https://www.linkedin.com/jobs/view/4012345678/', description })).result.id;
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    let job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.verification.state, 'unverified', 'Plainhand never opens the board page');
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('packet.approve', { jobId });
    await h.app.registry.run('jobs.confirmSubmitted', { jobId }, { actor: 'ui', confirmed: true });
    job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.status, 'Applied');
    assert.equal(job.submissionSource, 'candidate-confirmed');
  } finally { await h.close(); }
});
