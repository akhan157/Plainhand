import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSubmission } from '../plainhand/evaluation/sandbox.mjs';
import { scorePacket, scoreApplication, scoreEvaluation, aggregate, compareToBaseline } from '../plainhand/evaluation/score.mjs';
import { personaById, jobById, portalById, scenarios } from '../plainhand/evaluation/corpus.mjs';
import { renderPortal } from '../plainhand/evaluation/portals.mjs';
import { runEvaluation } from '../plainhand/evaluation/runner.mjs';

const pdf = Buffer.from('%PDF-1.4\n' + 'evaluation fixture '.repeat(20));
const sha = createHash('sha256').update(pdf).digest('hex');
const file = { name: 'resume.pdf', base64: pdf.toString('base64'), sha256: sha };

function validPayload(scenario) {
  const persona = personaById(scenario.persona), job = jobById(scenario.job), portal = portalById(scenario.portal);
  const fields = {};
  for (const field of portal.steps.flat()) {
    const candidate = persona.candidateAnswers?.[field.name];
    if (field.type === 'file') fields[field.name] = { value: '', source: 'app', file };
    else if (candidate !== undefined) fields[field.name] = { value: typeof candidate === 'boolean' ? (candidate ? 'on' : '') : String(candidate), source: 'candidate' };
    else if (field.name === 'degree') fields[field.name] = { value: persona.degree, source: 'app' };
    else if (field.name === 'achievement') fields[field.name] = { value: persona.facts[0].text, source: 'app' };
    else if (field.name === 'level') fields[field.name] = { value: 'professional', source: 'app' };
    else if (field.name === 'employer') fields[field.name] = { value: persona.employer, source: 'app' };
    else if (field.expect?.kind === 'profile') fields[field.name] = { value: persona.profile[field.expect.key], source: 'app' };
  }
  return { scenarioId: scenario.id, candidateConfirmed: true, fields };
}

test('sandbox accepts a complete submission and records the approved PDF hash', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const check = validateSubmission(scenario, validPayload(scenario));
  assert.equal(check.ok, true, check.errors.join(', '));
  assert.equal(file.sha256, sha);
});

test('sandbox rejects app-filled sensitive fields, invented unknown answers and missing files', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const payload = validPayload(scenario);
  payload.fields.authorization = { value: 'yes', source: 'app' };
  assert.ok(validateSubmission(scenario, payload).errors.includes('sensitive:authorization'));

  const unknown = scenarios.find(item => item.id === 'content-unknown');
  const unknownPayload = validPayload(unknown);
  unknownPayload.fields.start = { value: '2026-12-01', source: 'app' };
  assert.ok(validateSubmission(unknown, unknownPayload).errors.includes('unexpected-answer:start'));

  const missing = validPayload(scenario);
  delete missing.fields.name;
  assert.ok(validateSubmission(scenario, missing).errors.includes('required:name'));
  const noFile = validPayload(scenario);
  delete noFile.fields.resume.file;
  assert.ok(validateSubmission(scenario, noFile).errors.includes('file:resume'));
  const badPdf = validPayload(scenario);
  badPdf.fields.resume.file = { name: 'resume.pdf', base64: Buffer.from('not a pdf').toString('base64'), sha256: 'x' };
  assert.ok(validateSubmission(scenario, badPdf).errors.includes('not-pdf:resume'));
});

test('sandbox rejects wrong ground truth for name, degree and repeating employment records', () => {
  const lever = scenarios.find(item => item.id === 'mech-lever');
  const wrongName = validPayload(lever);
  wrongName.fields.name = { value: 'Jordan Patel', source: 'app' };
  assert.ok(validateSubmission(lever, wrongName).errors.includes('mismatch:name'));

  const wrongDegree = validPayload(lever);
  wrongDegree.fields.degree = { value: 'mba', source: 'app' };
  assert.ok(validateSubmission(lever, wrongDegree).errors.includes('mismatch:degree'));

  const records = scenarios.find(item => item.id === 'ops-records');
  const persona = personaById(records.persona);
  const payload = validPayload(records);
  payload.fields.employer0 = { value: persona.records[0].employer, source: 'app' };
  payload.fields.title0 = { value: persona.records[0].title, source: 'app' };
  payload.fields.employer1 = { value: persona.records[1].employer, source: 'app' };
  payload.fields.title1 = { value: persona.records[1].title, source: 'app' };
  const accepted = validateSubmission(records, payload);
  assert.equal(accepted.ok, true, accepted.errors.join(', '));
  payload.fields.employer1 = { value: 'Wrong Employer', source: 'app' };
  assert.ok(validateSubmission(records, payload).errors.includes('mismatch:employer1'));
  payload.fields.employer1 = { value: persona.records[1].employer, source: 'app' };
  payload.fields.title0 = { value: 'Wrong Title', source: 'app' };
  assert.ok(validateSubmission(records, payload).errors.includes('mismatch:title0'));
});

test('packet scoring normalizes number words, preserves year ranges and ignores phone digits', () => {
  const scenario = scenarios.find(item => item.id === 'analyst-resume');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const sources = [
    { id: 'profile', text: JSON.stringify({ name: 'Sam Okafor', phone: '+1 617 555 0100', location: 'Chicago, US' }) },
    { id: 'cv', text: 'Sam Okafor | +1 617 555 0100\nTaught algebra for six years (2019-2023).' },
  ];
  const packet = {
    headline: 'Data analyst',
    resume: [
      { section: 'Experience', text: 'I taught for 6 years from 2019 to 2023 and led 55 projects across 617 classrooms.' },
      { section: 'Projects', text: 'I improved results by 70%.' },
    ],
    coverLetter: '', answers: [], questions: [],
  };
  const score = scorePacket({ packet, persona, job, sources, review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } });
  assert.ok(!score.unsupportedNumbers.includes('6'), JSON.stringify(score.unsupportedNumbers));
  assert.ok(!score.unsupportedNumbers.includes('2019'), JSON.stringify(score.unsupportedNumbers));
  assert.ok(!score.unsupportedNumbers.includes('2023'), JSON.stringify(score.unsupportedNumbers));
  assert.ok(score.unsupportedNumbers.includes('55'), JSON.stringify(score.unsupportedNumbers));
  assert.ok(score.unsupportedNumbers.includes('617'), JSON.stringify(score.unsupportedNumbers));
  assert.ok(score.unsupportedNumbers.includes('70%'), JSON.stringify(score.unsupportedNumbers));

  const returning = personaById('returning'), returningJob = jobById('content-strategist');
  const commaScore = scorePacket({
    packet: { headline: 'Content strategist', resume: [{ section: 'Experience', text: 'I brought 4,000 new readers.' }], coverLetter: '', answers: [], questions: [] },
    persona: returning,
    job: returningJob,
    sources: [{ id: 'profile', text: JSON.stringify(returning.profile) }, { id: 'cv', text: returning.profile.resume }],
    review: { passed: true, issues: [] },
    pdf: { bytes: pdf, head: '%PDF-' },
  });
  assert.ok(!commaScore.unsupportedNumbers.includes('4,000'), JSON.stringify(commaScore.unsupportedNumbers));
});

test('application scoring treats a required candidate field left blank by the app as false-ready', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const snapshots = [{ values: {
    name: { value: persona.profile.name, file: '', type: 'text' },
    email: { value: persona.profile.email, file: '', type: 'email' },
    phone: { value: persona.profile.phone, file: '', type: 'tel' },
    location: { value: persona.profile.location, file: '', type: 'text' },
    resume: { value: '', file: 'resume.pdf', type: 'file' },
    degree: { value: persona.degree, file: '', type: 'select-one' },
    achievement: { value: persona.facts[0].text, file: '', type: 'textarea' },
    authorization: { value: '', file: '', type: 'select-one' },
    attest: { value: '', file: '', type: 'checkbox' },
  } }];
  const plan = { fields: [], answers: {}, questions: [], observation: { state: 'review' } };
  const checkpoint = { check: { ready: true, summary: { requiredFlagged: 0, mismatched: 0 } } };
  const submission = { ok: true, errors: [], receipt: { fields: { resume: { file: { sha256: sha } } } } };
  const score = scoreApplication({ scenario, persona, job, snapshots, plan, checkpoint, submission, pdfSha: sha });
  assert.equal(score.gatingIncorrect.length, 0);
  assert.equal(score.falseReady, true);
  assert.equal(score.pass, false);

  const leakPlan = { fields: [{ name: 'authorization', key: '0:0' }], answers: { '0:0': 'yes' }, questions: [], observation: { state: 'review' } };
  const leak = scoreApplication({ scenario, persona, job, snapshots: [], plan: leakPlan, checkpoint: null, submission: null });
  assert.ok(leak.sensitiveAppFilled.includes('authorization'));
});

test('baseline comparison separates regressions from pre-existing failures and repeats report flakiness', () => {
  const result = (id, baseId, pass, family = 'resume') => ({ scenario: { id, baseId, family }, pass });
  const summary = aggregate([
    result('a-r1', 'a', true),
    result('a-r2', 'a', false),
    result('b-r1', 'b', true),
    result('b-r2', 'b', true),
  ]);
  assert.equal(summary.repeats.scenarios, 2);
  assert.equal(summary.repeats.runsPerScenario, 2);
  assert.equal(summary.repeats.passRate, 0.75);
  assert.deepEqual(summary.repeats.flakyScenarios, ['a']);
  assert.deepEqual(summary.repeats.byScenario.a, { runs: 2, passed: 1, passRate: 0.5 });
  assert.deepEqual(summary.repeats.byScenario.b, { runs: 2, passed: 2, passRate: 1 });

  const baseline = {
    summary: { scenarios: 3, passed: 1, failed: ['b', 'c'] },
    results: [{ scenario: { id: 'a' }, pass: true }, { scenario: { id: 'b' }, pass: false }, { scenario: { id: 'c' }, pass: false }],
  };
  const currentResults = [{ scenario: { id: 'a' }, pass: false }, { scenario: { id: 'b' }, pass: true }, { scenario: { id: 'c' }, pass: false }, { scenario: { id: 'new-broken' }, pass: false }];
  const comparison = compareToBaseline({ scenarios: 4, passed: 1, failed: ['a', 'c', 'new-broken'] }, baseline, currentResults);
  assert.deepEqual(comparison.regressions, ['a', 'new-broken']);
  assert.deepEqual(comparison.preExistingFailures, ['c']);
  assert.deepEqual(comparison.improvements, ['b']);
});

test('records portal renders both employment fieldsets before achievement and a Skip evaluation is guarded', () => {
  const scenario = scenarios.find(item => item.id === 'ops-records');
  const html = renderPortal({ scenario, step: 1 });
  assert.equal((html.match(/<fieldset><legend>Employment<\/legend>/g) || []).length, 2);
  assert.ok(html.lastIndexOf('<legend>Employment</legend>') < html.indexOf('name="achievement"'));
  assert.ok(html.indexOf('name="employer0"') < html.indexOf('name="employer1"'));
  assert.ok(html.indexOf('name="title0"') < html.indexOf('name="title1"'));

  const persona = personaById('mech-grad'), job = jobById('mech-mismatch-job');
  const sources = [{ id: 'cv', text: persona.profile.resume }];
  const evaluation = {
    score: 2.2,
    recommendation: 'Skip',
    matches: [{ text: 'General background documented in sources.', evidence: [{ sourceId: 'cv', quote: persona.facts[0].text }] }],
  };
  const guarded = scoreEvaluation({ evaluation, sources, job, prepareRefusedWithoutOverride: true });
  assert.equal(guarded.pass, true, JSON.stringify(guarded));
  const unguarded = scoreEvaluation({ evaluation, sources, job, prepareRefusedWithoutOverride: false });
  assert.equal(unguarded.guardCorrect, false);
  assert.equal(unguarded.pass, false);
});

test('packet scoring detects unsupported numbers, absent claims and banned voice', () => {
  const scenario = scenarios.find(item => item.id === 'mech-resume');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const sources = [
    { id: 'profile', text: JSON.stringify(persona.profile) },
    { id: 'cv', text: persona.profile.resume },
  ];
  const packet = {
    headline: 'Mechanical engineer',
    resume: [{ section: 'Projects', text: 'I redesigned the rear upright and cut its weight by 70%.' }],
    coverLetter: 'I did production GD&T work and I am passionate about it.',
    answers: [], questions: [],
  };
  const score = scorePacket({ packet, persona, job, sources, review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } });
  assert.equal(score.pass, false);
  assert.ok(score.unsupportedNumbers.includes('70%'));
  assert.ok(score.absentClaims.includes('production-gdt'));
  assert.ok(score.bannedWords.includes('passionate'));
});

test('application scoring refuses a sensitive auto-fill and a false-ready review', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const snapshots = [{ values: {
    name: { value: persona.profile.name, file: '', type: 'text' },
    email: { value: persona.profile.email, file: '', type: 'email' },
    phone: { value: persona.profile.phone, file: '', type: 'tel' },
    location: { value: persona.profile.location, file: '', type: 'text' },
    resume: { value: '', file: 'resume.pdf', type: 'file' },
    degree: { value: 'mba', file: '', type: 'select-one' },
    achievement: { value: persona.facts[0].text, file: '', type: 'textarea' },
    authorization: { value: 'yes', file: '', type: 'select-one' },
  } }];
  const plan = { questions: [], observation: { state: 'review' } };
  const checkpoint = { check: { ready: true, summary: { requiredFlagged: 0, mismatched: 0 } } };
  const submission = { ok: true, errors: [], receipt: { fields: { resume: { file: { sha256: sha } } } } };
  const score = scoreApplication({ scenario, persona, job, snapshots, plan, checkpoint, submission, pdfSha: sha });
  assert.ok(score.sensitiveAppFilled.includes('authorization'));
  assert.equal(score.falseReady, true);
  assert.equal(score.pass, false);
});

test('controlled end-to-end evaluation runs a resume and a submitted application', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'plainhand-eval-test-'));
  try {
    const { report } = await runEvaluation(['--scenarios', 'mech-resume,swe-submit', '--concurrency', '1', '--out', out]);
    assert.equal(report.summary.scenarios, 2);
    assert.equal(report.summary.passed, 2, JSON.stringify(report.summary.failed));
    const submission = report.results.find(item => item.scenario.id === 'swe-submit');
    assert.equal(submission.application.submission.accepted, true);
    assert.equal(submission.application.sensitiveAppFilled.length, 0);
    assert.equal(submission.application.unknownAppFilled.length, 0);
    assert.ok((await readFile(path.join(out, 'SUMMARY.md'), 'utf8')).includes('Scenarios passed'));
    assert.equal(aggregate(report.results).passed, 2);
  } finally { await rm(out, { recursive: true, force: true }); }
});
