import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from '../plainhand/store.mjs';
import { AnswerBank, ANSWER_BANK_FILE } from '../plainhand/answer-bank.mjs';
import { suggestFormAnswers } from '../plainhand/workflow.mjs';

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

test('a reusable answer cannot cite a writing sample or the reviewed understanding', async () => {
  const h = await bank();
  try {
    await assert.rejects(() => h.bank.add({ question: 'Describe an improvement you made', answer: 'Checklist.', evidence: [{ sourceId: 'writing-samples', quote: 'Hi team, quick update: the upright passed the load test this morning.' }] }), /not a writing sample/);
    await assert.rejects(() => h.bank.add({ question: 'Describe an improvement you made', answer: 'Checklist.', evidence: [{ sourceId: 'reviewed-understanding', quote: 'The candidate has designed and tested hardware.' }] }), /not the reviewed understanding/);
    assert.equal((await h.bank.load()).length, 0, 'nothing is stored');
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
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'text' },
  ];
  const packet = { answers: [{ question: 'Why this role?', answer: 'Packet answer.', evidence }] };
  const bankAnswers = [
    { id: 'x', question: 'Why this role?', answer: 'Bank answer.', evidence, scope: 'global' },
    { id: 'y', question: 'Describe an improvement you made', answer: 'Bank reuse.', evidence, scope: 'global' },
  ];
  const answers = suggestFormAnswers(fields, { name: 'Test Candidate', email: 'a@example.invalid', phone: '+1 202 555 0189' }, packet, { bank: bankAnswers, asOf: '2026-10-21' });
  assert.equal(answers.a, 'Packet answer.');
  assert.equal(answers.b, 'Bank reuse.');
  assert.equal(answers.email, 'a@example.invalid', 'contact details still fill forms locally');
  assert.equal(answers.phone, '+1 202 555 0189', 'contact details still fill forms locally');
});

const SOURCES = [{ id: 'cv', text: 'Designed and tested a lightweight chassis for a Formula SAE team.' }];
const chassisEvidence = [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis for a Formula SAE team.' }];
const JOB = { id: 'job-1', company: 'Grip' };

test('provenance follows the evidence: a typed answer is an assertion, never packet grounding', async () => {
  const h = await bank();
  try {
    const typed = await h.bank.add({ question: 'Describe a hands-on project', answer: 'I rebuilt the test rig myself.', evidence: [{ sourceId: 'candidate-answer', quote: 'I rebuilt the test rig myself.' }] });
    assert.equal(typed.sourceKind, 'assertion');
    assert.match(typed.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    // The candidate's own approved assertion may fill a later form field.
    assert.equal(AnswerBank.match([typed], { label: 'Describe a hands-on project', job: JOB }).answer, 'I rebuilt the test rig myself.');
    // It can never replace a packet answer, even when a source happens to repeat it.
    const { entry, reason } = AnswerBank.reuse([typed], { label: 'Describe a hands-on project', job: JOB, sources: [{ id: 'cv', text: 'I rebuilt the test rig myself.' }] });
    assert.equal(entry, null);
    assert.match(reason, /assertion/);
    await assert.rejects(() => h.bank.add({ question: 'Why us?', answer: 'Because.', evidence: [{ sourceId: 'candidate-answer', quote: 'Because.' }], sourceKind: 'factual' }), /provenance follows its evidence/);
  } finally { await h.close(); }
});

test('packet reuse needs the exact normalized label, a factual quote still in the shared sources, scope and no expiry', async () => {
  const h = await bank();
  try {
    const base = { question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: chassisEvidence, scope: { jobs: ['job-1'], companies: [] } };
    const entry = await h.bank.add(base);
    const options = { label: '  describe   A HANDS-ON   project ', job: JOB, asOf: '2026-11-15', sources: SOURCES };
    assert.equal(AnswerBank.reuse([entry], options).entry.id, entry.id, 'case and spacing normalize, the label is otherwise exact');
    assert.equal(AnswerBank.reuse([entry], { ...options, label: 'Describe a hands-on project you led' }).entry, null, 'aliases are not matched');
    assert.match(AnswerBank.reuse([entry], { ...options, sources: [] }).reason, /quote is not in the current sources/);
    assert.match(AnswerBank.reuse([entry], { ...options, sources: [{ id: 'writing-samples', text: 'I designed and tested a lightweight chassis for a Formula SAE team.' }] }).reason, /quote is not in the current sources/);
    assert.match(AnswerBank.reuse([entry], { ...options, job: { id: 'job-2', company: 'Other' } }).reason, /scope does not match/);
    const byCompany = await h.bank.add({ ...base, scope: { jobs: [], companies: ['Grip'] } });
    assert.equal(AnswerBank.reuse([byCompany], { ...options, job: { id: 'job-9', company: 'grip' } }).entry.id, byCompany.id, 'company scope matches case-insensitively');
    const expired = await h.bank.add({ ...base, reviewBy: '2020-01-01' });
    assert.match(AnswerBank.reuse([expired], options).reason, /expired/);
    const held = await h.bank.add({ ...base, status: 'needs-review' });
    assert.match(AnswerBank.reuse([held], options).reason, /needs review/);
  } finally { await h.close(); }
});

test('an edited answer loses its verification; an expiry-only change keeps it', async () => {
  const h = await bank();
  try {
    const entry = await h.bank.add({ question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: chassisEvidence, scope: 'global' });
    const verified = entry.verifiedAt;
    const edited = await h.bank.add({ ...entry, answer: 'I led a team of twelve engineers.', verifiedAt: null, needsReview: true });
    assert.equal(edited.verifiedAt, null);
    assert.equal(edited.needsReview, true);
    assert.deepEqual(edited.evidence, entry.evidence, 'the old quote is kept for display only');
    assert.match(AnswerBank.reuse([edited], { label: entry.question, job: JOB, sources: SOURCES }).reason, /needs review/);
    const expiryOnly = await h.bank.add({ ...entry, reviewBy: '2030-01-01' });
    assert.equal(expiryOnly.verifiedAt, verified, 'changing the expiry does not re-verify the content');
    assert.equal(expiryOnly.needsReview, undefined);
    assert.equal(AnswerBank.reuse([expiryOnly], { label: entry.question, job: JOB, sources: SOURCES }).entry.answer, 'I designed and tested a lightweight chassis.');
  } finally { await h.close(); }
});
