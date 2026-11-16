// Reusable answers in a new packet: approved text, bank quote, review on the injected
// packet, and every gate that must stop reuse (edit, expiry, excluded source).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { AnswerBank } from '../plainhand/answer-bank.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';

const QUESTION = 'Describe a hands-on project';
const DRAFT = 'I helped out on a chassis project for our student team.';
const APPROVED = 'I designed and tested a lightweight chassis for a Formula SAE team, then wrote the handoff checklist for the next build.';
const EDITED = 'I led a team of twelve engineers through a chassis redesign.';
const BANK_QUOTE = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const PROFILE_QUOTE = 'I owned the design and testing work.';
const EVIDENCE = [{ sourceId: 'profile', quote: PROFILE_QUOTE }];

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-reuse-'));
  const calls = [];
  const agent = async (provider, instruction, data, options) => {
    calls.push({ instruction, data: JSON.parse(JSON.stringify(data ?? null)) });
    const result = await fixtureAgent(provider, instruction, data, options);
    // Every claim in this fixture stays grounded in the profile source, so excluding the
    // cv is a clean test of the bank quote rather than of the draft's own evidence.
    if (instruction.includes('Evaluate this')) result.matches = [{ text: 'Hands-on engineering design and testing', evidence: EVIDENCE }];
    if (instruction.includes('Prepare a')) {
      result.resume = [{ section: 'Projects', text: 'Hands-on chassis design and testing.', evidence: EVIDENCE }];
      result.answers = [{ question: QUESTION, answer: DRAFT, evidence: EVIDENCE }];
      result.coverLetter = 'I would like to bring my design and testing experience to this engineering role.';
      result.questions = [];
    }
    return result;
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture verification.' }),
    scanner: async () => [],
    renderer: async (workspace, state, job) => {
      const pdf = `output/test-${job.id}.pdf`;
      await workspace.write(pdf, 'test-pdf');
      return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] };
    },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const configure = async () => {
    const state = (await request('state')).data;
    assert.equal((await request('profile', { profile: candidate, revision: state.revision })).status, 200);
    assert.equal((await request('provider', { id: 'codex' })).status, 200);
  };
  const task = async (kind, jobId) => {
    const result = await request('tasks', { kind, jobId });
    assert.equal(result.status, 202, JSON.stringify(result.data));
    await app.workflow.queue;
    const record = (await app.workspace.load()).tasks.find(t => t.id === result.data.taskId);
    assert.equal(record.status, 'complete', record.message);
    return record;
  };
  const addJob = async (company, title, suffix) => {
    const result = await request('jobs', { company, title, url: `https://jobs.lever.co/test/${suffix}` });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const id = result.data.id;
    await task('evaluate', id);
    assert.equal((await request('jobs/update', { id, selected: true })).status, 200);
    return id;
  };
  const packet = async jobId => (await app.workspace.load()).jobs.find(job => job.id === jobId).packet;
  const close = async () => { await app.close(); await rm(root, { recursive: true, force: true }); };
  return { app, request, configure, task, addJob, packet, calls, close };
}

test('an approved answer is reused in a later packet with its quote, then reviewed and approvable', async () => {
  const h = await harness();
  try {
    await h.configure();
    const first = await h.addJob('Northwind', 'Design Engineer', 1);
    await h.task('prepare', first);
    assert.equal((await h.packet(first)).answers[0].answer, DRAFT);

    // The candidate corrects the drafted answer and approves it for global reuse.
    const proposed = await h.request('corrections/propose', { jobId: first, question: QUESTION, answer: APPROVED, evidence: [{ sourceId: 'cv', quote: BANK_QUOTE }], scope: 'global' });
    assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
    assert.equal((await h.request('corrections/approve', { id: proposed.data.correction.id })).status, 200);

    const second = await h.addJob('Northwind', 'Test Engineer', 2);
    await h.task('prepare', second);
    const draft = await h.packet(second);
    assert.equal(draft.answers.length, 1);
    assert.equal(draft.answers[0].answer, APPROVED, 'the approved text replaces the draft');
    assert.deepEqual(draft.answers[0].evidence, [{ sourceId: 'cv', quote: BANK_QUOTE }], 'the bank quote is the evidence');
    assert.equal(draft.answers[0].reuse.kind, 'reusable-answer');
    assert.match(draft.answers[0].reuse.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);

    // Review ran on the injected packet, not on the draft.
    const review = h.calls.filter(call => call.instruction.includes('Review this')).at(-1);
    assert.equal(review.data.packet.answers[0].answer, APPROVED);
    assert.deepEqual(review.data.packet.answers[0].evidence, [{ sourceId: 'cv', quote: BANK_QUOTE }]);
    assert.equal((await h.request('packet/approve', { id: second })).status, 200, 'the candidate can still approve the packet');
  } finally { await h.close(); }
});

test('an edited answer stops matching until re-approval, and expiry or an excluded source stops it too', async () => {
  const h = await harness();
  try {
    await h.configure();
    const first = await h.addJob('Northwind', 'Design Engineer', 1);
    await h.task('prepare', first);
    const proposed = await h.request('corrections/propose', { jobId: first, question: QUESTION, answer: APPROVED, evidence: [{ sourceId: 'cv', quote: BANK_QUOTE }], scope: 'global' });
    await h.request('corrections/approve', { id: proposed.data.correction.id });
    const entry = (await new AnswerBank(h.app.workspace).load())[0];

    const third = await h.addJob('Northwind', 'Systems Engineer', 3);
    await h.task('prepare', third);
    assert.equal((await h.packet(third)).answers[0].answer, APPROVED, 'a second job reuses the approved answer');

    // Edit the text while keeping the old quote: it is no longer verified.
    assert.equal((await h.request('action', { name: 'answers.update', input: { id: entry.id, answer: EDITED } })).status, 200);
    const edited = (await new AnswerBank(h.app.workspace).load())[0];
    assert.equal(edited.verifiedAt, null);
    assert.equal(edited.needsReview, true);
    assert.deepEqual(edited.evidence, [{ sourceId: 'cv', quote: BANK_QUOTE }], 'the old quote stays for display only');

    await h.task('prepare', third);
    const blocked = await h.packet(third);
    assert.equal(blocked.answers[0].answer, DRAFT, 'an edited answer is not reused');
    assert.equal(blocked.answers[0].reuse, undefined);
    assert.match(blocked.answers[0].notReused.reason, /needs review/);
    assert.equal(h.calls.filter(call => call.instruction.includes('Review this')).at(-1).data.packet.answers[0].answer, DRAFT, 'review sees the draft that ships');

    // The candidate re-approves the edited answer: reuse resumes with the new text.
    assert.equal((await h.request('action', { name: 'answers.approve', input: { id: entry.id } })).status, 200);
    await h.task('prepare', third);
    const restored = await h.packet(third);
    assert.equal(restored.answers[0].answer, EDITED);
    assert.deepEqual(restored.answers[0].evidence, [{ sourceId: 'cv', quote: BANK_QUOTE }]);

    // Changing only the expiry does not re-verify the content, and an expired entry is not reused.
    const verifiedAt = (await new AnswerBank(h.app.workspace).load())[0].verifiedAt;
    assert.equal((await h.request('action', { name: 'answers.update', input: { id: entry.id, reviewBy: '2020-01-01' } })).status, 200);
    assert.equal((await new AnswerBank(h.app.workspace).load())[0].verifiedAt, verifiedAt, 'an expiry change keeps the verification date');
    await h.task('prepare', third);
    const expired = await h.packet(third);
    assert.equal(expired.answers[0].answer, DRAFT);
    assert.match(expired.answers[0].notReused.reason, /expired/);

    // Clear the expiry, then exclude the cv that holds the quote: no quote reaches the model.
    const bank = new AnswerBank(h.app.workspace);
    await bank.save((await bank.load()).map(item => ({ ...item, reviewBy: null })));
    assert.equal((await h.request('action', { name: 'context.exclude', input: { sources: ['cv'] } })).status, 200);
    const fourth = await h.addJob('Grip', 'Mechanical Engineer', 4);
    const before = h.calls.length;
    await h.task('prepare', fourth);
    const excluded = await h.packet(fourth);
    assert.equal(excluded.answers[0].answer, DRAFT, 'an excluded source stops reuse');
    assert.equal(excluded.answers[0].reuse, undefined);
    assert.match(excluded.answers[0].notReused.reason, /quote is not in the current sources/);
    const inputs = h.calls.slice(before).map(call => JSON.stringify(call.data)).join('\n');
    assert.equal(inputs.includes(BANK_QUOTE), false, 'no excluded quote reaches the provider');
    assert.equal(inputs.includes(APPROVED), false, 'the ungrounded approved text is not injected');
  } finally { await h.close(); }
});
