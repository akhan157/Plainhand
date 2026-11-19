import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from '../plainhand/store.mjs';
import { Corrections, offerTypedAnswers } from '../plainhand/corrections.mjs';
import { AnswerBank } from '../plainhand/answer-bank.mjs';
import { suggestFormAnswers } from '../plainhand/workflow.mjs';

const evidence = [{ sourceId: 'cv', quote: 'I introduced a written handoff checklist' }];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-corrections-'));
  const workspace = new Workspace(root);
  return { root, workspace, corrections: new Corrections(workspace), close: () => rm(root, { recursive: true, force: true }) };
}

test('a correction stays a proposal until it is approved', async () => {
  const h = await fixture();
  try {
    const record = await h.corrections.propose({ jobId: 'job-1', question: 'Describe an improvement you made', previous: 'Draft text.', answer: 'Checklist text.', evidence });
    assert.equal(record.status, 'proposed');
    assert.deepEqual(record.scope, { jobs: ['job-1'] });
    assert.equal((await new AnswerBank(h.workspace).load()).length, 0, 'nothing is reusable before approval');

    const approved = await h.corrections.approve(record.id);
    assert.equal(approved.status, 'approved');
    const answers = await new AnswerBank(h.workspace).load();
    assert.equal(answers.length, 1);
    assert.equal(answers[0].answer, 'Checklist text.');
    assert.equal(answers[0].sourceKind, 'factual');
    assert.equal(answers[0].verifiedAt, answers[0].reviewedAt);
    assert.deepEqual(answers[0].scope.jobs, ['job-1']);
    assert.equal(AnswerBank.match(answers, { label: 'Describe an improvement you made', asOf: '2026-10-21', job: { id: 'job-1' } }).answer, 'Checklist text.');
    assert.equal(AnswerBank.match(answers, { label: 'Describe an improvement you made', asOf: '2026-10-21', job: { id: 'job-2' } }), null, 'a job-scoped correction stays scoped');
  } finally { await h.close(); }
});

test('approving twice does not duplicate the reusable answer', async () => {
  const h = await fixture();
  try {
    const record = await h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Grounded reason.', evidence });
    await h.corrections.approve(record.id);
    await h.corrections.approve(record.id);
    assert.equal((await new AnswerBank(h.workspace).load()).length, 1);
  } finally { await h.close(); }
});

test('rejected corrections never reach the answer bank', async () => {
  const h = await fixture();
  try {
    const record = await h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Grounded reason.', evidence });
    await h.corrections.reject(record.id);
    assert.equal((await h.corrections.list())[0].status, 'rejected');
    assert.equal((await new AnswerBank(h.workspace).load()).length, 0);
    await assert.rejects(() => h.corrections.approve('missing-id'), /not found/);
  } finally { await h.close(); }
});

test('a correction cannot cite voice or the agent summary, including when an old entry is approved', async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Because.', evidence: [{ sourceId: 'writing-samples', quote: 'Hi team, quick update: the upright passed the load test this morning.' }] }), /not a writing sample/);
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Because.', evidence: [{ sourceId: 'reviewed-understanding', quote: 'The candidate has designed and tested hardware.' }] }), /not the reviewed understanding/);
    assert.equal((await h.corrections.list()).length, 0);
    // A proposal saved before this gate still cannot become reusable evidence.
    await h.corrections.save([{ id: 'legacy', jobId: 'job-1', question: 'Why this role?', answer: 'Because.', evidence: [{ sourceId: 'writing-samples', quote: 'Hi team, quick update: the upright passed the load test this morning.' }], scope: 'global', status: 'proposed', proposedAt: new Date().toISOString() }]);
    await assert.rejects(() => h.corrections.approve('legacy'), /not a writing sample/);
    assert.equal((await new AnswerBank(h.workspace).load()).length, 0);
  } finally { await h.close(); }
});

test('sensitive answers and unsupported claims are refused', async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Do you require sponsorship?', answer: 'No.', evidence }), /Sensitive answers/);
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Because.', evidence: [{ sourceId: 'cv', quote: 'short' }] }), /source quote/);
    assert.equal((await h.corrections.list()).length, 0);
  } finally { await h.close(); }
});

test('a typed form answer is offered as a job- and company-scoped assertion, never global or sensitive', async () => {
  const h = await fixture();
  try {
    const job = { id: 'job-1', company: 'Grip' };
    const fields = [
      { key: 'a', label: 'Describe a hands-on project', type: 'textarea' },
      { key: 'b', label: 'Do you require sponsorship?', type: 'text' },
      { key: 'c', label: 'Notice period', type: 'text' },
      { key: 'd', label: 'Why this company?', type: 'text' },
    ];
    const answers = { a: 'I rebuilt the test rig and rewrote the checklist.', b: 'No, I am authorized to work.', c: 'short', d: 'The plan answer stays.' };
    assert.equal(await offerTypedAnswers(h.corrections, { job, fields, answers, planned: { d: 'The plan answer stays.' } }), 1);
    const proposals = await h.corrections.list();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].question, 'Describe a hands-on project');
    assert.equal(proposals[0].sourceKind, 'assertion');
    assert.deepEqual(proposals[0].scope, { jobs: ['job-1'], companies: ['grip'] });
    assert.notEqual(proposals[0].scope, 'global', 'a typed answer is never global by default');
    // The same offer again is not a new proposal; a sensitive field is never stored.
    assert.equal(await offerTypedAnswers(h.corrections, { job, fields, answers, planned: { d: 'The plan answer stays.' } }), 0);
    assert.equal((await h.corrections.list()).some(item => /sponsorship/i.test(item.question)), false);
    // The store refuses a typed sensitive answer even when a caller skips the offer filter.
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Do you require sponsorship?', answer: 'No, I do not.', evidence: [{ sourceId: 'candidate-answer', quote: 'No, I do not.' }] }), /Sensitive answers/);
  } finally { await h.close(); }
});

test('an approved typed answer fills later form fields but never grounds a packet answer', async () => {
  const h = await fixture();
  try {
    const job = { id: 'job-1', company: 'Grip' };
    const fields = [{ key: 'a', label: 'Describe a hands-on project', type: 'textarea' }];
    const answers = { a: 'I rebuilt the test rig and rewrote the checklist.' };
    await offerTypedAnswers(h.corrections, { job, fields, answers });
    const [proposal] = await h.corrections.list();
    await h.corrections.approve(proposal.id);
    const bank = await new AnswerBank(h.workspace).load();
    assert.equal(bank.length, 1);
    assert.equal(bank[0].sourceKind, 'assertion');
    const filled = suggestFormAnswers(fields, { name: 'Test Candidate', email: 'a@example.invalid', phone: '' }, { answers: [] }, { bank, job });
    assert.equal(filled.a, 'I rebuilt the test rig and rewrote the checklist.');
    const reuse = AnswerBank.reuse(bank, { label: 'Describe a hands-on project', job, sources: [{ id: 'cv', text: 'I rebuilt the test rig and rewrote the checklist.' }] });
    assert.equal(reuse.entry, null);
    assert.match(reuse.reason, /assertion/);
  } finally { await h.close(); }
});
