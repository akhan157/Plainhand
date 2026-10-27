import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from './plainhand/store.mjs';
import { Corrections } from './plainhand/corrections.mjs';
import { AnswerBank } from './plainhand/answer-bank.mjs';

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

test('sensitive answers and unsupported claims are refused', async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Do you require sponsorship?', answer: 'No.', evidence }), /Sensitive answers/);
    await assert.rejects(() => h.corrections.propose({ jobId: 'job-1', question: 'Why this role?', answer: 'Because.', evidence: [{ sourceId: 'cv', quote: 'short' }] }), /source quote/);
    assert.equal((await h.corrections.list()).length, 0);
  } finally { await h.close(); }
});
