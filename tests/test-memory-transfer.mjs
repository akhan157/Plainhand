// Workspace transfer preserves the candidate's memory and never transfers authority.
// The export shape below is the documented one (version 1, state, reusable answers,
// corrections and the four bounded user-layer source files). These tests are the M1
// falsifiers: an imported workspace must keep every memory, arrive with no approval,
// no enabled autonomy, no connection check, no browser checkpoint and no credential,
// and an interrupted import must leave the old workspace or the new one, never a mix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as transfer from '../plainhand/workspace-import.mjs';
import { Workspace, digest, hasEvidence, claimEvidenceProblem } from '../plainhand/store.mjs';
import { AnswerBank, ANSWER_BANK_FILE } from '../plainhand/answer-bank.mjs';
import { Corrections } from '../plainhand/corrections.mjs';
import { standardInput, standardStatus, autonomyOf, autoPrepareDecision } from '../plainhand/standard.mjs';
import { cleanFormat } from '../plainhand/resume-format.mjs';
import { suggestFormAnswers } from '../plainhand/workflow.mjs';
import { candidate } from '../plainhand/test-fixtures.mjs';

const SOURCE_PATHS = ['modes/_profile.md', 'article-digest.md', 'interview-prep/story-bank.md', 'data/resume-source.yml'];
const MARKER = 'data/plainhand/backups/import-marker.json';
const CORRECTIONS_FILE = 'data/plainhand/corrections.json';
const NARRATIVE = '# Candidate narrative\n\nI build lightweight hardware and test it until it holds.\n';
const PROOF_POINTS = 'Proof: the Formula SAE chassis carried 20% less mass at the same stiffness.\n';
const STORY_BANK = 'STAR: I built a lightweight chassis for the test team and ran the load tests myself.\n';
const CV_QUOTE = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const DEGREE_QUOTE = 'B.S. Mechanical Engineering, Example University, 2027.';
const THIRD_TEAM_QUOTE = 'I built a lightweight chassis for the test team and ran the load tests myself.';
const AT = '2026-02-01T00:00:00.000Z';
const EXPORTED_AT = '2026-11-15T00:00:00.000Z';

async function tempWorkspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new Workspace(root);
}

// The export format: whole state, reusable answers, corrections and the bounded user-layer
// sources. Built from the documented shape so this test can measure an import on any build.
async function exportOf(workspace, extra = {}) {
  const state = await workspace.load();
  const files = {};
  for (const file of SOURCE_PATHS) { const text = await workspace.read(file); if (text) files[file] = text; }
  return { ...state, files, answerBank: await new AnswerBank(workspace).load(), corrections: await new Corrections(workspace).list(), exportedAt: EXPORTED_AT, ...extra };
}

const STANDARD_DRAFT = {
  headline: 'Mechanical engineering graduate',
  resume: [
    { section: 'Projects', heading: null, text: 'Built a lightweight chassis for the test team.', evidence: [{ sourceId: 'stories', quote: THIRD_TEAM_QUOTE }] },
    { section: 'Education', heading: { org: 'Example University', title: '', location: 'Boston, US', dates: '2023–2027' }, text: DEGREE_QUOTE, evidence: [{ sourceId: 'cv', quote: DEGREE_QUOTE }] },
  ],
  coverLetter: 'I build lightweight hardware and test it until it holds.',
  suggestions: ['Add the load-test numbers.'],
};
const FORMAT = { ...cleanFormat({ page: 'a4', margins: { top: 0.5, right: 0.6, bottom: 0.5, left: 0.6 }, font: { family: 'serif', name: 'Georgia', size: 11, lineHeight: 1.4 }, sections: ['Projects', 'Education'] }), savedAt: '2026-02-04T00:00:00.000Z' };
const STATEMENTS = [{ text: 'Say "led" only when I owned it.', at: '2026-02-05T00:00:00.000Z' }];
const DECISIONS = [{ at: '2026-02-06T00:00:00.000Z', jobId: 'job-1', claimId: 'resume:0', rating: 'stretched', kind: 'level', text: 'Led the chassis team', suggestion: 'Owned the chassis project', decision: 'keep-mine' }];

async function richWorkspace(t) {
  const workspace = await tempWorkspace(t);
  await workspace.write('modes/_profile.md', NARRATIVE);
  await workspace.write('article-digest.md', PROOF_POINTS);
  await workspace.write('interview-prep/story-bank.md', STORY_BANK);
  await workspace.saveProfile({ ...candidate }, 0);
  await workspace.mutate(state => {
    state.conversation.push({ role: 'user', text: THIRD_TEAM_QUOTE, at: AT });
    state.writingSamples = [{ id: 'sample-1', title: 'Launch note', text: 'I shipped the chassis programme with the test team.', at: '2026-01-02T03:04:05.000Z' }];
    state.claimLine = { statements: STATEMENTS, decisions: DECISIONS };
    state.standard = {
      kind: 'master', draft: STANDARD_DRAFT, review: { passed: true, issues: [] },
      contextHash: 'exported-context-hash', createdAt: AT,
      approvedHash: digest('standard-hash-1'), approvedAt: '2026-02-02T00:00:00.000Z',
      coverage: { covered: 2, lines: 2, missing: [] },
      calibration: { counts: { balanced: 2, stretched: 0, undersold: 0, unsupported: 0 }, total: 2, claims: [] },
    };
    state.resumeFormat = FORMAT;
    state.settings = { autonomy: { enabled: true, perDay: 4, minScore: 4.5 }, todo: 'drop me' };
    state.understanding = { result: { summary: 'A mechanical engineering graduate with hands-on design and testing work.', voice: 'Direct.', sampleAnswer: 'I designed and tested a lightweight chassis.', strengths: ['Physical design and testing'], questions: ['What did the testing change?'], gaps: ['Testing outcomes need more detail.'] }, contextHash: 'exported-base-hash', approved: true, createdAt: AT };
    state.connectionChecks = { codex: { verified: true, verifiedAt: '2026-02-07T00:00:00.000Z', note: 'sk-live-connection-check' } };
    state.contextPrefs = { excludedSources: ['proof-points'], excludedFields: ['phone'] };
    state.events.unshift({ at: AT, text: 'Master resume approved.' });
    state.jobs.push({
      id: 'job-1', company: 'Northwind', title: 'Hardware Engineer', url: 'https://jobs.example.invalid/northwind',
      createdAt: AT, stage: 'approved', status: 'Evaluated', approvedHash: digest('packet-hash-1'),
      browserCheckpoint: { packetHash: digest('packet-hash-1'), at: '2026-02-03T04:05:06.000Z', result: { filled: ['email'], skipped: [] }, note: 'sk-live-browser-checkpoint' },
      packet: { headline: 'Hardware Engineer', resume: [], answers: [], questions: [] },
      evaluation: { score: 4.4, recommendation: 'Apply', matches: [] },
    });
  });
  await new AnswerBank(workspace).save([
    { id: 'answer-valid-project', question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: 'global', reviewedAt: '2026-01-02', reviewBy: '2027-06-01' },
    { id: 'answer-held-travel', question: 'How do you handle travel?', answer: 'I plan travel around delivery dates.', evidence: [{ sourceId: 'cv', quote: 'I regularly travelled to supplier sites across three states.' }], scope: 'global', reviewedAt: '2026-01-02', reviewBy: null },
    { id: 'answer-held-voice', question: 'How would you lead a team?', answer: 'I lead by writing the plan down.', evidence: [{ sourceId: 'writing-samples', quote: 'I shipped the chassis programme with the test team.' }], scope: 'global', reviewedAt: '2026-01-02', reviewBy: null },
    { id: 'answer-sensitive', question: 'Are you authorized to work in the United States?', answer: 'Yes.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: 'global', reviewedAt: '2026-01-02', reviewBy: null },
    { id: 'answer-invalid', question: 'Missing answer', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: 'global', reviewedAt: '2026-01-02', reviewBy: null },
  ]);
  await new Corrections(workspace).save([
    { id: 'correction-valid', jobId: 'job-1', question: 'Describe a hands-on project', previous: 'A project.', answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: 'global', status: 'approved', proposedAt: '2026-02-01T00:00:00.000Z', approvedAt: '2026-02-02T00:00:00.000Z', answerId: 'answer-valid-project' },
    { id: 'correction-held', jobId: 'job-1', question: 'How do you handle travel?', previous: null, answer: 'I plan travel around delivery dates.', evidence: [{ sourceId: 'cv', quote: 'I regularly travelled to supplier sites across three states.' }], scope: 'global', status: 'approved', proposedAt: '2026-02-01T00:00:00.000Z', approvedAt: '2026-02-02T00:00:00.000Z', answerId: 'answer-held-travel' },
    { id: 'correction-proposed', jobId: 'job-1', question: 'What tools have you used?', previous: null, answer: 'CAD and a load-test rig.', evidence: [{ sourceId: 'cv', quote: CV_QUOTE }], scope: { jobs: ['job-1'], companies: [] }, status: 'proposed', proposedAt: '2026-02-01T00:00:00.000Z' },
  ]);
  return workspace;
}

test('a rich workspace moves with every memory intact and no authority', async t => {
  const source = await richWorkspace(t), target = await tempWorkspace(t);
  await target.saveProfile({ ...candidate, name: 'Existing Candidate', resume: 'Existing resume text, unrelated to the export.' }, 0);
  await new AnswerBank(target).save([{ id: 'answer-old', question: 'An old answer', answer: 'Old target answer.', evidence: [{ sourceId: 'cv', quote: 'Existing resume text' }], scope: 'global', reviewedAt: '2025-01-01', reviewBy: null }]);
  const exported = await exportOf(source);
  const preview = transfer.preview(exported);
  assert.deepEqual([preview.answerBank, preview.corrections, preview.approvalsReset], [5, 3, 1]);

  const result = await transfer.importWorkspace({ workspace: target, data: exported });
  const state = await target.load();
  const context = await target.context(state);
  const job = state.jobs.find(item => item.id === 'job-1');

  // Memory: voice, wording, master resume, format, sharing choices.
  assert.deepEqual(state.writingSamples, exported.writingSamples);
  assert.deepEqual(state.claimLine, { statements: STATEMENTS, decisions: DECISIONS });
  assert.deepEqual(state.standard.draft, STANDARD_DRAFT);
  assert.deepEqual(state.standard.coverage, { covered: 2, lines: 2, missing: [] });
  assert.equal(state.standard.contextHash, 'exported-context-hash');
  assert.deepEqual(state.resumeFormat, FORMAT);
  assert.deepEqual(state.contextPrefs, { excludedSources: ['proof-points'], excludedFields: ['phone'] });
  assert.deepEqual(state.understanding.result, exported.understanding.result);
  assert.equal(await target.read('modes/_profile.md'), NARRATIVE);
  assert.equal(await target.read('article-digest.md'), PROOF_POINTS);
  assert.equal(await target.read('interview-prep/story-bank.md'), STORY_BANK);
  assert.equal(state.conversation.some(message => message.text === THIRD_TEAM_QUOTE), true);

  // No authority: the master resume is a draft, the summary unapproved, autonomy off.
  assert.equal(state.standard.approvedHash, null);
  assert.equal(state.standard.approvedAt, null);
  assert.notEqual(standardStatus(state, context.hash), 'approved');
  assert.equal(standardInput(state, context.hash), null, 'an imported master resume never reaches the drafter');
  assert.equal(state.understanding.approved, false);
  assert.equal(context.sources.some(item => item.id === 'reviewed-understanding'), false);
  assert.equal(autonomyOf(state).enabled, false);
  assert.deepEqual(state.settings, { autonomy: { enabled: false, perDay: 4, minScore: 4.5 } });
  assert.equal(autoPrepareDecision(state, job, context.hash, '2026-11-15').prepare, false);

  // No machine state: job approval, checkpoint and connection check never travel.
  assert.equal(job.approvedHash, null);
  assert.equal(job.browserCheckpoint, undefined);
  assert.equal(job.stage, 'needs-refresh');
  assert.equal(state.connectionChecks, undefined);
  const everything = JSON.stringify(state) + JSON.stringify(await target.load());
  assert.equal(everything.includes('sk-live-connection-check'), false);
  assert.equal(everything.includes('sk-live-browser-checkpoint'), false);

  // Reusable answers arrive usable when their quote travelled, held when it did not.
  const bank = await new AnswerBank(target).load();
  assert.equal(bank.length, 3);
  assert.equal(result.answerBank.stored, 3);
  assert.equal(result.answerBank.held, 2);
  assert.equal(result.answerBank.sensitiveDropped, 1);
  assert.equal(result.answerBank.invalidDropped, 1);
  assert.equal(bank.some(entry => /authorized to work/i.test(entry.question)), false, 'a sensitive question is never stored');
  assert.equal(bank.find(entry => entry.id === 'answer-valid-project').status, undefined);
  assert.equal(bank.find(entry => entry.id === 'answer-held-travel').status, 'needs-review');
  assert.equal(bank.find(entry => entry.id === 'answer-held-voice').status, 'needs-review');
  assert.equal(AnswerBank.match(bank, { label: 'Describe a hands-on project', job, asOf: '2026-11-15' }).answer, 'I designed and tested a lightweight chassis.');
  assert.equal(AnswerBank.match(bank, { label: 'How do you handle travel?', job, asOf: '2026-11-15' }), null);
  assert.equal(AnswerBank.match(bank, { label: 'How would you lead a team?', job, asOf: '2026-11-15' }), null);
  const fields = [{ key: 'q1', label: 'Describe a hands-on project', type: 'textarea' }, { key: 'q2', label: 'How do you handle travel?', type: 'textarea' }];
  assert.deepEqual(suggestFormAnswers(fields, state.profile, { answers: [] }, { bank, job, asOf: '2026-11-15' }), { q1: 'I designed and tested a lightweight chassis.' });

  // Corrections are retained with their timestamps; an approval whose bank entry is
  // held no longer counts as approved.
  const corrections = await new Corrections(target).list();
  assert.equal(corrections.length, 3);
  assert.equal(result.corrections.stored, 3);
  assert.equal(result.corrections.held, 1);
  assert.equal(corrections.find(entry => entry.id === 'correction-valid').status, 'approved');
  assert.equal(corrections.find(entry => entry.id === 'correction-held').status, 'needs-review');
  assert.equal(corrections.find(entry => entry.id === 'correction-proposed').status, 'proposed');
  assert.equal(corrections.find(entry => entry.id === 'correction-valid').proposedAt, '2026-02-01T00:00:00.000Z');

  // The story-backed claim still resolves against the imported story bank.
  const standardClaim = state.standard.draft.resume[0];
  assert.equal(hasEvidence(standardClaim, context), true, String(claimEvidenceProblem(standardClaim, context)));
  assert.equal(result.unresolvedClaims, 0);

  // One import event with counts and no secrets.
  const events = state.events.filter(event => /Workspace imported/i.test(event.text));
  assert.equal(events.length, 1);
  assert.match(events[0].text, /1 role/);
  assert.match(events[0].text, /1 packet approval reset/);
  assert.match(events[0].text, /2 reusable answers held for review/);
  assert.match(events[0].text, /1 sensitive answer dropped/);
  assert.match(events[0].text, /1 correction held for review/);
  assert.match(events[0].text, /Your master resume arrived as a draft/);
  assert.match(events[0].text, /profile understanding needs review/);
  assert.equal(/sk-live|@example\.invalid/.test(events[0].text), false);
  assert.ok(result.backup.startsWith('data/plainhand/backups/'));
});

test('an export is built from the allow-list and carries no connection check, checkpoint or credential', async t => {
  const source = await richWorkspace(t);
  assert.equal(typeof transfer.exportWorkspace, 'function');
  const exported = await transfer.exportWorkspace(source, { exportedAt: EXPORTED_AT });
  assert.deepEqual(Object.keys(exported.files).sort(), ['article-digest.md', 'interview-prep/story-bank.md', 'modes/_profile.md']);
  assert.equal(exported.files['modes/_profile.md'], NARRATIVE);
  assert.equal(exported.connectionChecks, undefined);
  assert.equal(exported.jobs[0].browserCheckpoint, undefined);
  assert.equal(exported.answerBank.length, 5);
  assert.equal(exported.corrections.length, 3);
  assert.equal(exported.exportedAt, EXPORTED_AT);
  const text = JSON.stringify(exported);
  assert.equal(text.includes('sk-live-connection-check'), false);
  assert.equal(text.includes('sk-live-browser-checkpoint'), false);
});

test('an export without the source files is imported honestly, counting claims whose sources did not travel', async t => {
  const source = await richWorkspace(t), target = await tempWorkspace(t);
  const exported = await exportOf(source);
  delete exported.files;
  const result = await transfer.importWorkspace({ workspace: target, data: exported });
  assert.equal(result.unresolvedClaims, 1, 'the story-backed master resume line has no imported source');
  assert.equal(await target.read('interview-prep/story-bank.md'), '');
  assert.equal((await target.read('modes/_profile.md')).includes('lightweight hardware'), false, 'an older export does not invent the narrative it never carried');
});

test('a source file too large for the export is reported and never deleted from the destination', async t => {
  const source = await richWorkspace(t), target = await tempWorkspace(t);
  const keptNarrative = '# Candidate narrative\n\nA different narrative already in this workspace.\n';
  await target.write('modes/_profile.md', keptNarrative);
  await target.saveProfile({ ...candidate, name: 'Existing Candidate' }, 0);
  const exported = await exportOf(source);
  delete exported.files['modes/_profile.md'];
  exported.filesOmitted = ['modes/_profile.md'];
  const result = await transfer.importWorkspace({ workspace: target, data: exported });
  assert.equal(await target.read('modes/_profile.md'), keptNarrative, 'the destination copy is not deleted for a source that never travelled');
  assert.equal(result.unresolvedClaims, 0, 'the story-bank source still travelled, so the story-backed claim resolves');
  assert.deepEqual(result.filesOmitted, ['modes/_profile.md']);
  assert.match((await target.load()).events[0].text, /1 source file too large to include/);
});

test('an older export without a bank keeps the destination answers, held when their quote did not travel', async t => {
  const source = await richWorkspace(t), target = await tempWorkspace(t);
  await target.saveProfile({ ...candidate, name: 'Existing Candidate', resume: 'Reconciled supplier ledgers at Example Co.' }, 0);
  const cvQuote = 'Reconciled supplier ledgers at Example Co.';
  await new AnswerBank(target).save([{ id: 'answer-target', question: 'Describe your reconciliation work', answer: 'I reconciled supplier ledgers.', evidence: [{ sourceId: 'cv', quote: cvQuote }], scope: 'global', reviewedAt: '2026-01-01', reviewBy: null }]);
  const exported = await exportOf(source);
  delete exported.answerBank;
  delete exported.corrections;
  const result = await transfer.importWorkspace({ workspace: target, data: exported });
  const bank = await new AnswerBank(target).load();
  assert.deepEqual(bank.map(entry => [entry.id, entry.status || 'usable']), [['answer-target', 'needs-review']]);
  assert.equal(result.answerBank.stored, 1);
  assert.equal(result.answerBank.held, 1);
  assert.equal(AnswerBank.match(bank, { label: 'Describe your reconciliation work', asOf: '2026-11-15' }), null);
});

test('an injected write failure leaves the previous workspace byte-identical, then the import completes', async t => {
  const source = await richWorkspace(t), target = await tempWorkspace(t);
  await target.saveProfile({ ...candidate, name: 'Existing Candidate', resume: 'Existing resume text, unrelated to the export.' }, 0);
  await new AnswerBank(target).save([{ id: 'answer-old', question: 'An old answer', answer: 'Old target answer.', evidence: [{ sourceId: 'cv', quote: 'Existing resume text' }], scope: 'global', reviewedAt: '2025-01-01', reviewBy: null }]);
  const exported = await exportOf(source);
  const before = {
    state: await target.read(target.file),
    bank: await target.read(ANSWER_BANK_FILE),
    cv: await target.read('cv.md'),
    narrative: await target.read('modes/_profile.md'),
    tracker: await target.read('data/applications.md'),
  };
  assert.notEqual(before.bank, '', 'the replaced bank is a real file');
  const write = target.storage.write.bind(target.storage);
  let injected = false;
  target.storage.write = async (file, data) => {
    if (file === 'data/plainhand/corrections.json' && !injected) { injected = true; throw new Error(`Injected disk failure writing ${file}`); }
    return write(file, data);
  };
  await assert.rejects(transfer.importWorkspace({ workspace: target, data: exported }), /Injected disk failure/);
  target.storage.write = write;
  assert.equal(await target.read(target.file), before.state, 'the state commit never happened');
  assert.equal(await target.read(ANSWER_BANK_FILE), before.bank, 'the old bank was restored');
  assert.equal(await target.read('cv.md'), before.cv);
  assert.equal(await target.read('modes/_profile.md'), before.narrative);
  assert.equal(await target.read('data/applications.md'), before.tracker);
  assert.equal(await target.read(MARKER), '', 'the interruption marker was cleared');
  assert.equal((await new AnswerBank(target).load())[0].id, 'answer-old');

  const result = await transfer.importWorkspace({ workspace: target, data: exported });
  assert.equal(result.jobs, 1);
  const state = await target.load();
  assert.equal(state.profile.name, candidate.name);
  assert.equal((await new AnswerBank(target).load()).length, 3);
  assert.equal((await new Corrections(target).list()).length, 3);
  assert.equal(state.standard.draft.headline, STANDARD_DRAFT.headline);
  assert.equal(state.settings.autonomy.enabled, false);
});

test('a crashed import is rolled back or finished by the marker on the next load', async t => {
  const target = await tempWorkspace(t);
  await target.saveProfile({ ...candidate, name: 'Existing Candidate', resume: 'Existing resume text, unrelated to the export.' }, 0);
  const cv = await target.read('cv.md');
  assert.equal(typeof transfer.recoverInterruptedImport, 'function');
  await target.write('data/plainhand/backups/crash-import-cv.md', cv);
  await target.write(MARKER, JSON.stringify({ phase: 'prepared', stamp: 'crash', at: AT, backups: { 'cv.md': 'data/plainhand/backups/crash-import-cv.md', [ANSWER_BANK_FILE]: null } }));
  await target.write('cv.md', 'HALF-WRITTEN IMPORT');
  await target.write(ANSWER_BANK_FILE, 'answers:\n  - question: leaked\n');
  assert.deepEqual(await transfer.recoverInterruptedImport(target), { recovered: true, phase: 'prepared' });
  assert.equal(await target.read('cv.md'), cv);
  assert.equal(await target.read(ANSWER_BANK_FILE), '');
  assert.equal(await target.read(MARKER), '');

  // The state was committed before the crash: the next load finishes derived writes.
  await target.write(MARKER, JSON.stringify({ phase: 'state-committed', stamp: 'crash-2', at: AT, backups: {} }));
  assert.deepEqual(await transfer.recoverInterruptedImport(target), { recovered: true, phase: 'state-committed' });
  assert.equal(await target.read(MARKER), '');
  assert.match(await target.read('data/applications.md'), /\| # \| Date \| Company \| Role \| Score \| Status \| PDF \| Report \| Notes \|/);
});

test('a structured resume travels with its mirror or the import is refused', async t => {
  const source = await tempWorkspace(t);
  await source.write('modes/_profile.md', NARRATIVE);
  await source.write('article-digest.md', PROOF_POINTS);
  await source.write('interview-prep/story-bank.md', STORY_BANK);
  await source.saveProfile({ ...candidate }, 0);
  await source.write('data/resume-source.yml', 'basics:\n  name: Test Graduate\nroles:\n  - title: Hardware Engineer\n');
  const structured = await exportOf(source);
  const target = await tempWorkspace(t);
  const imported = await transfer.importWorkspace({ workspace: target, data: structured });
  assert.equal(imported.sourceFiles, 4);
  assert.match(await target.read('data/resume-source.yml'), /Hardware Engineer/);

  // A workspace that has a structured resume cannot be replaced by an export without one.
  const owning = await tempWorkspace(t);
  await owning.saveProfile({ ...candidate }, 0);
  await owning.write('data/resume-source.yml', 'basics:\n  name: Existing Candidate\n');
  const legacy = await exportOf(source);
  delete legacy.files;
  const before = await owning.read(owning.file);
  await assert.rejects(transfer.importWorkspace({ workspace: owning, data: legacy }), /structured resume/);
  assert.equal(await owning.read(owning.file), before);
  assert.equal(await owning.read('data/resume-source.yml'), 'basics:\n  name: Existing Candidate\n');

  // A structured source without its resume mirror is refused, not half-written.
  const broken = await exportOf(source);
  broken.profile = { ...broken.profile, resume: '' };
  await assert.rejects(transfer.importWorkspace({ workspace: await tempWorkspace(t), data: broken }), /structured resume/);
});
