import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { DEFAULT_ROLE_ORDER, roleOrderOf } from '../plainhand/standard.mjs';
import { PACKET_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
import { groupEntries, renderResumeHtml, DEFAULT_FORMAT } from '../plainhand/resume-format.mjs';

async function harness({ wrap = out => out } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-role-order-'));
  const inputs = [];
  const agent = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return wrap(await fixtureAgent(id, instruction, data, options), instruction); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; } } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 5; i++) await app.workflow.queue; };
  await ui('tasks.standard', {}); await settle(); await ui('standard.approve', {});
  let n = 0;
  const addJob = async () => { n++; return (await ui('jobs.add', { company: 'Test Company', title: `Graduate Engineer ${n}`, url: `https://jobs.lever.co/test/order-${n}` })).result.id; };
  const prepared = async jobId => {
    await ui('tasks.evaluate', { jobId }); await settle();
    await ui('jobs.select', { jobId, selected: true });
    await ui('tasks.prepare', { jobId }); await settle();
    return inputs.filter(i => i.instruction === PACKET_INSTRUCTION).at(-1).data;
  };
  return { app, ui, settle, addJob, prepared, inputs, lastTask: async () => (await app.workspace.load()).tasks[0], close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('the order of experience defaults to most recent first, and the resolver only accepts the two choices', () => {
  assert.equal(DEFAULT_ROLE_ORDER, 'recent');
  assert.equal(roleOrderOf({}), 'recent');
  assert.equal(roleOrderOf({ settings: {} }), 'recent');
  assert.equal(roleOrderOf({ settings: { roleOrder: 'match' } }), 'match');
  assert.equal(roleOrderOf({ settings: { roleOrder: 'recent' } }), 'recent');
  assert.equal(roleOrderOf({ settings: { roleOrder: 'alphabetical' } }), 'recent', 'an unknown value falls back to the default');
  assert.equal(roleOrderOf({ settings: { roleOrder: null } }), 'recent');
});

test('the candidate saves the order, and it reaches every packet as INPUT.roleOrder', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    const byDefault = await h.prepared(jobId);
    assert.equal(byDefault.roleOrder, 'recent', 'unset means most recent first');
    assert.ok(byDefault.master, 'the packet is prepared from the approved master resume');

    await assert.rejects(h.app.registry.run('settings.roleOrder', { order: 'match' }, { actor: 'agent', confirmed: true }), e => e.code === 'candidate_only');
    await assert.rejects(h.ui('settings.roleOrder', { order: 'best' }), /one of recent, match/);
    await h.ui('settings.roleOrder', { order: 'match' });
    assert.equal(roleOrderOf(await h.app.workspace.load()), 'match');

    const job2 = await h.addJob();
    const byMatch = await h.prepared(job2);
    assert.equal(byMatch.roleOrder, 'match', 'the candidate’s choice reaches the packet');

    // A revision keeps the setting, and the candidate's own request travels with it.
    await h.ui('jobs.select', { jobId: job2, selected: true });
    await h.ui('tasks.revise', { jobId: job2, request: 'Put the chassis project first.' }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const revised = h.inputs.filter(i => i.instruction === PACKET_INSTRUCTION).at(-1).data;
    assert.equal(revised.roleOrder, 'match');
    assert.equal(revised.revisionRequest, 'Put the chassis project first.', 'the request is passed for the model to follow over roleOrder');
  } finally { await h.close(); }
});

test('the order is its own setting: re-deriving the resume format leaves it in place', async () => {
  const h = await harness();
  try {
    await h.ui('settings.roleOrder', { order: 'match' });
    // What saving a freshly derived format does: resumeFormat is replaced whole.
    await h.ui('format.save', { format: { source: 'derived', page: 'a4', font: { family: 'serif', name: 'Georgia', size: 11 }, sections: ['Experience', 'Education'] } });
    let state = await h.app.workspace.load();
    assert.equal(state.resumeFormat.font.name, 'Georgia');
    assert.equal(state.resumeFormat.roleOrder, undefined, 'the order never lives inside the resume format');
    assert.equal(roleOrderOf(state), 'match', 're-deriving the format cannot reset the order');

    const jobId = await h.addJob();
    assert.equal((await h.prepared(jobId)).roleOrder, 'match', 'and it still reaches the packet');

    await h.ui('format.save', { reset: true });
    state = await h.app.workspace.load();
    assert.equal(state.resumeFormat, undefined);
    assert.equal(roleOrderOf(state), 'match', 'resetting the format leaves the order alone');
  } finally { await h.close(); }
});

test('both instructions carry the new rules, and the replaced wording is gone', () => {
  // Tailored resume: select, curate, order.
  assert.match(PACKET_INSTRUCTION, /Order the kept roles by INPUT\.roleOrder/);
  assert.match(PACKET_INSTRUCTION, /"recent" \(the default when absent\) puts the newest first/);
  assert.match(PACKET_INSTRUCTION, /"match" puts the role that best matches this job first, then the rest newest first/);
  assert.match(PACKET_INSTRUCTION, /Keep a role only when at least one of its lines matches a requirement the posting states/);
  assert.match(PACKET_INSTRUCTION, /when in doubt, keep it/);
  assert.match(PACKET_INSTRUCTION, /never leave out experience that matches one/);
  assert.match(PACKET_INSTRUCTION, /keep that role with its heading \(org, title and dates\) and exactly one short line/);
  assert.match(PACKET_INSTRUCTION, /In suggestions, name every role you left out, with the reason/);
  assert.ok(!PACKET_INSTRUCTION.includes('Relevant Experience'), 'the “Relevant Experience” grouping advice is replaced');
  assert.ok(!PACKET_INSTRUCTION.includes('keep each recent role with at least one line'), 'the old gap rule is replaced');

  assert.match(PACKET_INSTRUCTION, /On a revision the candidate's request wins over INPUT\.roleOrder/);

  // Cover letter: a short case for fit, not a restatement.
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) {
    assert.match(instruction, /not a line-by-line restatement of the resume/);
    assert.match(instruction, /one page in three or four short paragraphs/);
    assert.match(instruction, /without a stock closing|no stock closings/);
  }
  assert.match(PACKET_INSTRUCTION, /pick the top two or three qualifications this posting asks for/);
  assert.match(STANDARD_INSTRUCTION, /pick the candidate's strongest two or three qualifications overall/);
  assert.match(STANDARD_INSTRUCTION, /\{company\} and \{role\}/, 'the base letter keeps its slots');

  // Resume structure.
  assert.match(PACKET_INSTRUCTION, /Every line of one role carries one identical heading object/);
  assert.match(PACKET_INSTRUCTION, /An education entry's text must not repeat the school, degree or dates/);
  assert.match(PACKET_INSTRUCTION, /A summary line must name the candidate's field, their level, and one or two concrete strengths this job asks for/);
});

test('one role written with differently typed headings groups as one entry; different roles never merge', () => {
  const heading = { org: 'Example Pumps', title: 'Engineering Intern', location: 'Boston, MA', dates: 'Summer 2026' };
  const retyped = { org: ' example  pumps', title: 'Engineering Intern ', location: 'BOSTON, MA', dates: 'Summer  2026' };
  const otherRole = { ...heading, title: 'Design Engineer' };
  const blank = { org: '', title: '', location: '', dates: '' };
  const resume = [
    { section: 'Experience', heading, text: 'Wrote a test procedure' },
    { section: 'Experience', heading: retyped, text: 'Ran 40 bench tests' },
    { section: 'Experience', heading: blank, text: 'A summary line with no heading' },
    { section: 'Experience', heading: null, text: 'A skills line with no heading' },
    { section: 'Experience', heading: otherRole, text: 'Ran the design review' },
    { section: 'Experience', heading: retyped, text: 'Trained two interns' },
  ];
  const [section] = groupEntries(resume);
  assert.deepEqual(section.blocks.map(block => block.lines.length), [2, 2, 1, 1], 'case and spacing only: one entry each way');
  assert.deepEqual(section.blocks[0].lines, ['Wrote a test procedure', 'Ran 40 bench tests']);
  assert.deepEqual(section.blocks[1].lines, ['A summary line with no heading', 'A skills line with no heading'], 'a blank heading is no heading');
  assert.equal(section.blocks[1].heading, null);
  assert.equal(section.blocks[2].lines[0], 'Ran the design review', 'a different title stays a different entry');
  assert.equal(section.blocks[3].lines[0], 'Trained two interns', 'only consecutive lines of one role merge');

  const html = renderResumeHtml(DEFAULT_FORMAT, { name: 'Riley Example' }, { resume });
  assert.equal((html.match(/<li>/g) || []).length, 6, 'every line is still rendered');
  assert.equal((html.match(/Engineering Intern/g) || []).length, 2, 'the re-typed heading renders once, not twice');
});

test('a heading-only resume row from the model is dropped, not a failed application', async () => {
  const wrap = (out, instruction) => {
    if (instruction !== PACKET_INSTRUCTION || !Array.isArray(out?.resume)) return out;
    const first = out.resume.find(item => item.heading) || out.resume[0];
    return { ...out, resume: [...out.resume, { section: first.section, heading: first.heading, text: '', evidence: [] }] };
  };
  const h = await harness({ wrap });
  try {
    const jobId = await h.addJob();
    await h.prepared(jobId);
    const job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.ok(job.packet, `the packet was prepared: ${JSON.stringify({ keys: Object.keys(job), tasks: (await h.app.workspace.load()).tasks.slice(0, 3) }).slice(0, 1500)}`);
    assert.ok(job.packet.resume.every(item => item.text.trim()), 'no empty line survives');
  } finally { await h.close(); }
});
