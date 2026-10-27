import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from './plainhand/store.mjs';
import { AnswerBank, ANSWER_BANK_FILE } from './plainhand/answer-bank.mjs';
import { suggestFormAnswers } from './plainhand/workflow.mjs';

const evidence = [{ sourceId: 'cv', quote: 'I introduced a written handoff checklist' }];

async function bank() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-answer-bank-'));
  const workspace = new Workspace(root);
  return { root, workspace, bank: new AnswerBank(workspace), close: () => rm(root, { recursive: true, force: true }) };
}

test('a reusable answer requires a question, an answer and an exact source quote', async () => {
  const h = await bank();
  try {
    await assert.rejects(() => h.bank.add({ question: '', answer: 'x', evidence }), /question and an answer/);
    await assert.rejects(() => h.bank.add({ question: 'Why this role?', answer: 'x', evidence: [] }), /source quote/);
    await assert.rejects(() => h.bank.add({ question: 'Why this role?', answer: 'x', evidence: [{ sourceId: 'cv', quote: 'short' }] }), /source quote/);
    const record = await h.bank.add({ question: 'Why this role?', answer: 'Because the work matches my evidence.', evidence });
    assert.equal(record.scope, 'global');
    assert.match(record.id, /^answer-/);
    const stored = await h.workspace.read(ANSWER_BANK_FILE);
    assert.match(stored, /Why this role\?/);
  } finally { await h.close(); }
});

test('sensitive and legally meaningful questions are never stored as reusable answers', async () => {
  const h = await bank();
  try {
    for (const question of ['Are you legally authorized to work?', 'Do you require sponsorship?', 'Gender', 'Salary expectations']) {
      await assert.rejects(() => h.bank.add({ question, answer: 'yes', evidence }), /Sensitive or legally meaningful/);
    }
  } finally { await h.close(); }
});

test('matching honours expiry, scope and label sensitivity', async () => {
  const h = await bank();
  try {
    await h.bank.add({ question: 'Describe an improvement you made', answer: 'Checklist.', evidence, scope: 'global' });
    await h.bank.add({ question: 'Why this company?', answer: 'Their mission.', evidence, scope: { companies: ['grip'] } });
    await h.bank.add({ question: 'What is your notice period?', answer: 'Four weeks.', evidence, reviewBy: '2020-01-01' });
    const answers = await h.bank.load();

    assert.equal(AnswerBank.match(answers, { label: 'Describe an improvement you made', asOf: '2026-10-21' }).answer, 'Checklist.');
    assert.equal(AnswerBank.match(answers, { label: 'Why this company?', asOf: '2026-10-21', job: { id: 'j1', company: 'Grip' } }).answer, 'Their mission.');
    assert.equal(AnswerBank.match(answers, { label: 'Why this company?', asOf: '2026-10-21', job: { id: 'j2', company: 'Other' } }), null);
    assert.equal(AnswerBank.match(answers, { label: 'What is your notice period?', asOf: '2026-10-21' }), null, 'expired review date is not reusable');
    assert.equal(AnswerBank.match(answers, { label: 'Are you authorized to work?', asOf: '2026-10-21' }), null);
    assert.equal(AnswerBank.match(answers, { label: 'Unrelated question', asOf: '2026-10-21' }), null);
  } finally { await h.close(); }
});

test('the reviewed packet wins over the reusable bank, which fills only unanswered fields', async () => {
  const fields = [
    { key: 'a', label: 'Why this role?', type: 'text' },
    { key: 'b', label: 'Describe an improvement you made', type: 'text' },
  ];
  const packet = { answers: [{ question: 'Why this role?', answer: 'Packet answer.', evidence }] };
  const bankAnswers = [
    { id: 'x', question: 'Why this role?', answer: 'Bank answer.', evidence, scope: 'global' },
    { id: 'y', question: 'Describe an improvement you made', answer: 'Bank reuse.', evidence, scope: 'global' },
  ];
  const answers = suggestFormAnswers(fields, { name: 'Test Candidate', email: 'a@example.invalid', phone: '+1 202 555 0189' }, packet, { bank: bankAnswers, asOf: '2026-10-21' });
  assert.equal(answers.a, 'Packet answer.');
  assert.equal(answers.b, 'Bank reuse.');
});
