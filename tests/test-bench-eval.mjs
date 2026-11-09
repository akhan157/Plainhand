import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSubmission } from '../plainhand/evaluation/sandbox.mjs';
import { scorePacket, scoreApplication, aggregate } from '../plainhand/evaluation/score.mjs';
import { personaById, jobById, portalById, scenarios } from '../plainhand/evaluation/corpus.mjs';
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
