import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSubmission } from '../plainhand/evaluation/sandbox.mjs';
import { scorePacket, scoreApplication, scoreEvaluation, scoreScenario, aggregate, compareToBaseline, markdownReport } from '../plainhand/evaluation/score.mjs';
import { personaById, jobById, portalById, scenarios, expectedFor, fieldOwner, hasWord, absentClaimsIn, personas } from '../plainhand/evaluation/corpus.mjs';
import { renderPortal } from '../plainhand/evaluation/portals.mjs';
import { assertProviderUsable, runEvaluation, exitCodeFor, runMetadata, candidatePayload } from '../plainhand/evaluation/runner.mjs';

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

test('a live preflight failure stops the run before scenarios; built-in providers skip it', async () => {
  await assert.rejects(assertProviderUsable('codex', async () => { throw new Error('usage limit'); }), /Provider codex is not usable: usage limit/);
  let called = false;
  await assertProviderUsable('chatgpt', async () => { called = true; });
  assert.equal(called, false);
});

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

  const phoneScore = scorePacket({
    packet: { headline: 'Content strategist', resume: [], coverLetter: `Reach me at (${returning.profile.phone.replace(/\D/g, '').slice(-10, -7)}) ${returning.profile.phone.replace(/\D/g, '').slice(-7, -4)}-${returning.profile.phone.replace(/\D/g, '').slice(-4)}, or not at 415 555 0199.`, answers: [], questions: [] },
    persona: returning,
    job: returningJob,
    sources: [{ id: 'profile', text: JSON.stringify(returning.profile) }, { id: 'cv', text: returning.profile.resume }],
    review: { passed: true, issues: [] },
    pdf: { bytes: pdf, head: '%PDF-' },
  });
  assert.deepEqual(phoneScore.unsupportedNumbers, ['415', '555', '0199']);
});

test('application scoring treats a required candidate field left blank by the app as false-ready', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const snapshots = [{ values: {
    name: { value: persona.profile.name, file: '', type: 'text' },
    email: { value: persona.profile.email, file: '', type: 'email' },
    phone: { value: persona.profile.phone, file: '', type: 'tel' },
    location: { value: persona.profile.location, file: '', type: 'text' },
    resume: { value: '', file: 'resume.pdf', type: 'file', bytes: pdf.length, sha256: sha },
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

  // A question the candidate answered is the candidate's fill, not the app's, and is not a stop.
  const askedPlan = { fields: [{ name: 'degree', key: '0:5' }], answers: {}, questions: [{ key: '0:5', question: 'Which degree?' }], observation: { state: 'ready' } };
  const asked = scoreApplication({ scenario, persona, job, snapshots, plan: askedPlan, checkpoint: null, submission: null, candidateAnswered: { degree: persona.degree } });
  const degree = asked.fields.find(item => item.name === 'degree');
  assert.equal(degree.value, '');
  assert.equal(degree.candidateSupplied, true);
  assert.equal(degree.correct, true);
  assert.equal(asked.stop, 'ready');
  assert.equal(asked.appQuestions, 1);
  assert.deepEqual(asked.candidateAnswered, ['degree']);
  const unanswered = scoreApplication({ scenario, persona, job, snapshots, plan: askedPlan, checkpoint: null, submission: null });
  assert.equal(unanswered.stop, 'needs-answers');
});

test('profile effectiveness pairs a conversation-built profile with its seeded control', () => {
  const scenario = (mode) => ({ id: `x-${mode}`, family: 'profile-effect', pairId: 'x', profileMode: mode });
  const built = {
    scenario: scenario('conversation'), pass: true,
    profile: { captureRate: 0.8, coverageOfAllFacts: 0.8, pass: true, calls: 5, seconds: 10 },
    profileStrength: { summary: { strong: 2, good: 1, thin: 1 } },
    evaluation: { pass: true },
    packet: { factCoverage: 0.8, reviewPassed: true },
    application: { completionRate: 0.9, fields: [{ correct: true, candidateSupplied: false }, { correct: true, candidateSupplied: false }], submission: { accepted: true }, falseReady: false },
  };
  const seeded = {
    scenario: scenario('seeded'), pass: true,
    profileStrength: { summary: { strong: 3, good: 1, thin: 0 } },
    evaluation: { pass: true },
    packet: { factCoverage: 1, reviewPassed: true },
    application: { completionRate: 1, fields: [{ correct: true, candidateSupplied: false }, { correct: true, candidateSupplied: false }], submission: { accepted: true }, falseReady: false },
  };
  const minimal = {
    scenario: scenario('minimal'), pass: true,
    profileStrength: { summary: { strong: 1, good: 1, thin: 2 } },
    evaluation: { pass: true },
    packet: { factCoverage: 0.5, reviewPassed: true },
    application: { completionRate: 0.5, fields: [{ correct: true, candidateSupplied: false }, { correct: true, candidateSupplied: true }], submission: { accepted: true }, falseReady: false },
  };
  const summary = aggregate([built, seeded, minimal]);
  assert.equal(summary.profileEffect.length, 1);
  assert.equal(summary.profileEffect[0].profileCapture, 0.8);
  assert.equal(summary.profileEffect[0].profileCalls, 5);
  assert.equal(summary.profileEffect[0].downstream.delta.packetFactCoverage, -0.2);
  assert.equal(summary.profileEffect[0].downstream.delta.applicationCompletion, -0.1);
  assert.equal(summary.profileEffect[0].downstream.deltaVsMinimal.packetFactCoverage, 0.3);
  assert.equal(summary.profileEffect[0].downstream.deltaVsMinimal.applicationCompletion, 0.4);
  assert.equal(summary.profileEffect[0].downstream.deltaVsMinimal.applicationFromProfile, 0.5);
  assert.equal(summary.profileEffect[0].downstream.built.candidateRescues, 0);
  assert.equal(summary.profileEffect[0].downstream.minimal.candidateRescues, 1);
});

test('expected lower-bound controls are counted separately from real failures', () => {
  const summary = aggregate([
    { scenario: { id: 'control', family: 'profile-effect', expectFail: true }, pass: false },
    { scenario: { id: 'bad', family: 'resume' }, pass: false },
    { scenario: { id: 'good', family: 'resume' }, pass: true },
  ]);
  assert.deepEqual(summary.expectedFailures, ['control']);
  assert.deepEqual(summary.unexpectedFailures, ['bad']);
  assert.equal(summary.passed, 1);
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
    resume: { value: '', file: 'resume.pdf', type: 'file', bytes: pdf.length, sha256: sha },
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
    assert.match(report.metadata.commit, /^[0-9a-f]{40}$/);
    assert.equal(typeof report.metadata.dirty, 'boolean');
    assert.equal(report.metadata.node, process.version);
    assert.equal(submission.application.resumeUploadMatches, true);
    assert.deepEqual(submission.application.readbackMismatches, []);
    assert.deepEqual(submission.application.appOwedRescued, []);
    assert.equal(aggregate(report.results).passed, 2);
  } finally { await rm(out, { recursive: true, force: true }); }
});

// ---- Planted failures: each of these passed before the scorer was fixed. ----

// A complete, correct application for a portal, in the shape the runner records.
function passingApplication(scenarioId, overrides = {}) {
  const scenario = scenarios.find(item => item.id === scenarioId);
  const persona = personaById(scenario.persona), job = jobById(scenario.job), portal = portalById(scenario.portal);
  const values = {}, readback = {}, receipt = {};
  for (const field of portal.steps.flat()) {
    const owner = fieldOwner(field, persona, job), expected = expectedFor(field, persona, job);
    if (field.type === 'file') {
      if (field.name !== 'resume') continue;
      values.resume = readback.resume = { value: '', file: 'resume.pdf', type: 'file', bytes: pdf.length, sha256: sha };
      receipt.resume = { value: '', source: 'app', file: { name: 'resume.pdf', bytes: pdf.length, sha256: sha } };
      continue;
    }
    if (owner === 'app' || owner === 'askable') {
      const value = expected.kind === 'exact' ? expected.value : expected.texts?.[0] || expected.text || '';
      values[field.name] = { value, file: '', type: field.type };
      readback[field.name] = { value, file: '', type: field.type };
      receipt[field.name] = { value, source: 'app', file: null };
    } else if (owner === 'candidate') {
      const answer = persona.candidateAnswers[field.name];
      const value = typeof answer === 'boolean' ? (answer ? 'on' : '') : String(answer);
      values[field.name] = { value: '', file: '', type: field.type };
      readback[field.name] = { value, file: '', type: field.type };
      receipt[field.name] = { value, source: 'candidate', file: null };
    }
  }
  return {
    scenario, persona, job,
    snapshots: [{ values }],
    plan: { fields: [], answers: {}, questions: [], observation: { state: 'review' } },
    checkpoint: { check: { ready: false, summary: {} } },
    submission: { ok: true, errors: [], receipt: { id: 'r', receivedAt: 'now', fields: receipt } },
    trackerStatus: 'Applied', submittedAt: '2026-11-11T00:00:00.000Z',
    pdfSha: sha, coverSha: null, discardDetected: false, candidateAnswered: {}, readback,
    ...overrides,
  };
}

// A packet that passes on its own, for scenario-level tests.
function passingPacket(personaId, jobId) {
  const persona = personaById(personaId), job = jobById(jobId);
  const facts = job.requiredFactIds.map(id => persona.facts.find(fact => fact.id === id));
  return {
    packet: { headline: 'x', resume: facts.map(fact => ({ section: 'Experience', text: fact.text })), coverLetter: `I am applying. ${facts[0].text}`, answers: [], questions: [] },
    sources: [{ id: 'profile', text: JSON.stringify(persona.profile) }, { id: 'cv', text: persona.profile.resume }],
    review: { passed: true, issues: [] },
    calibration: null,
    pdf: { bytes: pdf, head: '%PDF-' },
  };
}

test('fixture sanity: the hand-built application and packet pass, so each planted failure below is the only cause', () => {
  for (const id of ['mech-lever', 'swe-submit', 'analyst-greenhouse']) {
    const score = scoreApplication(passingApplication(id));
    assert.equal(score.pass, true, `${id}: ${JSON.stringify({ incorrect: score.incorrect, rb: score.readbackMismatches })}`);
    assert.equal(score.appFilledRate, 1);
    assert.equal(score.completionRate, 1);
  }
  const resume = scoreScenario({ scenario: scenarios.find(item => item.id === 'mech-resume'), packet: passingPacket('mech-grad', 'grad-mech') });
  assert.equal(resume.pass, true, JSON.stringify(resume.packet));
});

test('a portal scenario that threw after the packet stage fails; any error fails', () => {
  const lever = scenarios.find(item => item.id === 'mech-lever');
  const crashed = scoreScenario({ scenario: lever, packet: passingPacket('mech-grad', 'grad-mech'), error: 'browser/autofill: page crashed' });
  assert.equal(crashed.packet.pass, true);
  assert.equal(crashed.pass, false);
  assert.equal(crashed.unexpected, true);
  const noApplication = scoreScenario({ scenario: scenarios.find(item => item.id === 'swe-submit'), packet: passingPacket('junior-swe', 'junior-swe') });
  assert.equal(noApplication.pass, false);
  const resumeError = scoreScenario({ scenario: scenarios.find(item => item.id === 'mech-resume'), packet: passingPacket('mech-grad', 'grad-mech'), error: 'late failure' });
  assert.equal(resumeError.pass, false);
  const profileError = scoreScenario({ scenario: { id: 'profile-x', family: 'profile', persona: 'mech-grad' }, profile: { pass: true }, error: 'turn failed' });
  assert.equal(profileError.pass, false);
});

test('a candidate rescue of an app-owed field fails the scenario and is reported apart from askable answers', () => {
  const base = passingApplication('mech-lever');
  const persona = base.persona;
  // The app filled nothing for name and email; the candidate typed them in review.
  const values = { ...base.snapshots[0].values, name: { value: '', file: '', type: 'text' }, email: { value: '', file: '', type: 'email' } };
  const rescued = scoreApplication({ ...base, snapshots: [{ values }], candidateAnswered: { name: persona.profile.name, email: persona.profile.email } });
  assert.deepEqual(rescued.appOwedRescued, ['name', 'email']);
  assert.ok(rescued.gatingIncorrect.includes('name'));
  assert.equal(rescued.fields.find(item => item.name === 'name').answerCorrect, true);
  assert.equal(rescued.fields.find(item => item.name === 'name').correct, false);
  assert.ok(rescued.completionRate < 1);
  assert.equal(rescued.appFilledRate, Math.round((rescued.appOwedFields - 2) / rescued.appOwedFields * 100) / 100);
  assert.equal(rescued.pass, false);

  // The one legitimate question: Riley has not graduated, so the degree is askable.
  assert.equal(fieldOwner(portalById('lever-single').steps[0].find(f => f.name === 'degree'), persona, base.job), 'askable');
  const askedValues = { ...base.snapshots[0].values, degree: { value: '', file: '', type: 'select-one' } };
  const asked = scoreApplication({ ...base, snapshots: [{ values: askedValues }], candidateAnswered: { degree: persona.degree } });
  assert.deepEqual(asked.appOwedRescued, []);
  assert.equal(asked.pass, true, JSON.stringify(asked.gatingIncorrect));
  assert.equal(asked.completionRate, 1);

  // The same degree answer for a graduate whose sources settle it is a rescue.
  const swe = passingApplication('swe-submit');
  const sweValues = { ...swe.snapshots[0].values, degree: { value: '', file: '', type: 'select-one' } };
  const sweRescued = scoreApplication({ ...swe, snapshots: [{ values: sweValues }], candidateAnswered: { degree: swe.persona.degree } });
  assert.deepEqual(sweRescued.appOwedRescued, ['degree']);
  assert.equal(sweRescued.pass, false);

  const summary = aggregate([{ scenario: swe.scenario, pass: false, application: sweRescued }]);
  assert.equal(summary.application.appOwedRescued, 1);
  assert.equal(summary.application.appFilledRate, sweRescued.appFilledRate);
  const report = markdownReport({ evidenceTier: 'test', provider: 'x', summary, results: [{ scenario: swe.scenario, pass: false, application: sweRescued }], comparison: null });
  assert.match(report, /App-filled rate/);
  assert.match(report, /app-owed rescued degree/);
});

test('a wrong or stale uploaded file fails even when the harness sends the approved bytes', () => {
  const base = passingApplication('mech-lever');
  const other = createHash('sha256').update('stale resume').digest('hex');
  const wrong = scoreApplication({ ...base, snapshots: [{ values: { ...base.snapshots[0].values, resume: { value: '', file: 'resume.pdf', type: 'file', bytes: 12, sha256: other } } }] });
  assert.equal(wrong.resumeHashMatches, true, 'the receipt still carries the approved hash');
  assert.equal(wrong.resumeUploadMatches, false);
  assert.equal(wrong.pass, false);
  // A name-only snapshot (no DOM hash) is not proof of an upload.
  const nameOnly = scoreApplication({ ...base, snapshots: [{ values: { ...base.snapshots[0].values, resume: { value: '', file: 'resume.pdf', type: 'file' } } }] });
  assert.equal(nameOnly.resumeUploadMatches, false);
  assert.equal(nameOnly.pass, false);

  const coverSha = createHash('sha256').update('approved cover').digest('hex');
  const ashby = passingApplication('swe-ashby', { coverSha });
  const goodCover = { value: '', file: 'cover.pdf', type: 'file', bytes: 10, sha256: coverSha };
  assert.equal(scoreApplication({ ...ashby, snapshots: [{ values: { ...ashby.snapshots[0].values, cover: goodCover } }] }).pass, true);
  const staleCover = scoreApplication({ ...ashby, snapshots: [{ values: { ...ashby.snapshots[0].values, cover: { ...goodCover, sha256: other } } }] });
  assert.equal(staleCover.coverUploadMatches, false);
  assert.equal(staleCover.pass, false);
});

test('the final DOM must still hold what was submitted for app-owed fields', () => {
  const base = passingApplication('mech-lever');
  const reverted = scoreApplication({ ...base, readback: { ...base.readback, name: { value: '', file: '', type: 'text' } } });
  assert.deepEqual(reverted.readbackMismatches, ['name']);
  assert.equal(reverted.pass, false);
  // Multi-step: only the last page is in the DOM, so absent fields are not mismatches.
  const two = passingApplication('analyst-greenhouse');
  const lastPage = Object.fromEntries(Object.entries(two.readback).filter(([name]) => ['degree', 'achievement', 'authorization', 'attest'].includes(name)));
  assert.deepEqual(scoreApplication({ ...two, readback: lastPage }).readbackMismatches, []);
  const changed = scoreApplication({ ...two, readback: { ...lastPage, degree: { value: 'mba', file: '', type: 'select-one' } } });
  assert.deepEqual(changed.readbackMismatches, ['degree']);
  assert.equal(changed.pass, false);
});

test('packet numbers must match a whole source token; the posting is a source', () => {
  const persona = personaById('mech-grad'), job = jobById('grad-mech');
  const sources = [{ id: 'profile', text: JSON.stringify(persona.profile) }, { id: 'cv', text: persona.profile.resume }];
  const score = text => scorePacket({ packet: { resume: [{ section: 'Experience', text }], coverLetter: '', answers: [], questions: [] }, persona, job, sources, review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } }).unsupportedNumbers;
  // "20" is a substring of "2027" and "2024" but not a token in any source.
  assert.deepEqual(score('I ran 20 design reviews.'), ['20']);
  assert.deepEqual(score('I ran 40 bench tests and cut weight by 18%.'), []);
  assert.deepEqual(score('I cut weight by 18 percent.'), []);
  assert.deepEqual(score('I cut weight by 40%.'), ['40%']);
  const percentSources = [{ id: 'cv', text: 'Load time fell 30 per cent.' }];
  assert.deepEqual(scorePacket({ packet: { resume: [{ text: 'Load time fell 30%.' }] }, persona, job, sources: percentSources, review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } }).unsupportedNumbers, []);
  const mismatch = jobById('mech-mismatch-job');
  const quoted = scorePacket({ packet: { resume: [], coverLetter: 'The posting asks for 10+ years; I have not had that.' }, persona, job: mismatch, sources, review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } });
  assert.deepEqual(quoted.unsupportedNumbers, []);
});

test('no absent-claim keyword collides with a job its persona is paired with', () => {
  const collisions = [];
  for (const scenario of scenarios) {
    if (!scenario.job) continue;
    const persona = personaById(scenario.persona), job = jobById(scenario.job);
    const texts = [job.description, ...job.atsTerms];
    for (const absent of persona.absent) for (const keyword of absent.keywords) {
      if (texts.some(text => hasWord(text, keyword))) collisions.push(`${scenario.id}: ${persona.id} "${keyword}" in ${job.id}`);
    }
  }
  assert.deepEqual(collisions, []);
});

test('absent claims are judged per sentence and honest negations are not claims', () => {
  const check = (personaId, jobId, text) => {
    const persona = personaById(personaId);
    return scorePacket({ packet: { resume: [{ text }] }, persona, job: jobById(jobId), sources: [{ id: 'cv', text: persona.profile.resume }], review: { passed: true, issues: [] }, pdf: { bytes: pdf, head: '%PDF-' } }).absentClaims;
  };
  assert.deepEqual(check('junior-swe', 'junior-swe', "I haven't worked on a production system at a company yet."), []);
  assert.deepEqual(check('junior-swe', 'junior-swe', 'I have not worked on a production system.'), []);
  assert.deepEqual(check('junior-swe', 'junior-swe', 'I am ready to join the on-call rotation after onboarding.'), []);
  assert.deepEqual(check('junior-swe', 'junior-swe', 'I ran production systems at scale.'), ['production']);
  assert.deepEqual(check('career-changer', 'data-analyst', 'I explain findings to non-technical stakeholders.'), []);
  assert.deepEqual(check('career-changer', 'data-analyst', 'I bring corporate analytics experience.'), ['corporate']);
  assert.deepEqual(check('mech-grad', 'grad-mech', "I haven't done production GD&T work, only what we covered in class."), []);
  // A negation in one sentence does not excuse a claim in the next.
  assert.deepEqual(check('mech-grad', 'grad-mech', 'I have never missed a review. I did production GD&T work.'), ['production-gdt']);
});

test('the CLI exits 0 when only expected controls fail', () => {
  assert.equal(exitCodeFor({ failed: ['profile-effect-mech-minimal'], expectedFailures: ['profile-effect-mech-minimal'], unexpectedFailures: [] }), 0);
  assert.equal(exitCodeFor({ failed: ['mech-lever'], expectedFailures: [], unexpectedFailures: ['mech-lever'] }), 1);
});

test('repeated runs compare to the baseline on their base scenario id', () => {
  const baseline = { summary: { scenarios: 2, passed: 1, failed: ['a'] }, results: [{ scenario: { id: 'a' }, pass: false }, { scenario: { id: 'b' }, pass: true }] };
  const current = [
    { scenario: { id: 'a-r1', baseId: 'a' }, pass: false },
    { scenario: { id: 'a-r2', baseId: 'a' }, pass: false },
    { scenario: { id: 'b-r1', baseId: 'b' }, pass: false },
    { scenario: { id: 'b-r2', baseId: 'b' }, pass: true },
  ];
  const comparison = compareToBaseline({ scenarios: 4, passed: 1, failed: ['a-r1', 'a-r2', 'b-r1'] }, baseline, current);
  assert.deepEqual(comparison.preExistingFailures, ['a-r1', 'a-r2']);
  assert.deepEqual(comparison.regressions, ['b-r1']);
  assert.deepEqual(comparison.improvements, []);
});

test('an unknown --scenarios id stops the run and names the id', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'plainhand-eval-unknown-'));
  try {
    await assert.rejects(runEvaluation(['--scenarios', 'mech-resume,no-such-scenario,typo-2', '--out', out]), /Unknown scenario ids: no-such-scenario, typo-2/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('run metadata records the commit, dirty flag and Node version', async () => {
  const metadata = await runMetadata();
  assert.match(metadata.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof metadata.dirty, 'boolean');
  assert.equal(metadata.node, process.version);
  assert.equal(Object.hasOwn(metadata, 'providerVersion'), false);
});

test('a sensitive field the app filled is labelled app in the payload, so the sandbox rejects it', () => {
  const scenario = scenarios.find(item => item.id === 'mech-lever');
  const persona = personaById(scenario.persona), job = jobById(scenario.job);
  const base = passingApplication('mech-lever');
  const appSnapshot = { ...base.snapshots[0].values, authorization: { value: 'yes', file: '', type: 'select-one' } };
  const candidateDom = { ...appSnapshot, attest: { value: 'on', file: '', type: 'checkbox' } };
  const pdfFile = { bytes: pdf, sha };
  const leaked = candidatePayload(scenario, persona, { snapshots: [{ values: appSnapshot }] }, { pdf: 'output/resume.pdf' }, pdfFile, null, candidateDom);
  assert.equal(leaked.fields.authorization.source, 'app');
  assert.equal(leaked.fields.attest.source, 'candidate');
  assert.ok(validateSubmission(scenario, leaked).errors.includes('sensitive:authorization'));

  const clean = candidatePayload(scenario, persona, base, { pdf: 'output/resume.pdf' }, pdfFile, null, { ...base.snapshots[0].values, authorization: { value: 'yes' }, attest: { value: 'on' } });
  assert.equal(clean.fields.authorization.source, 'candidate');
  const check = validateSubmission(scenario, clean);
  assert.equal(check.ok, true, check.errors.join(', '));
});

test('an unrelated negation in the same sentence does not hide an absent claim', () => {
  const persona = personaById('mech-grad');
  const ids = text => absentClaimsIn(text, persona).map(absent => absent.id);
  assert.deepEqual(ids('I did production GD&T work and never missed a deadline.'), ['production-gdt']);
  assert.deepEqual(ids('I did production GD&T work.'), ['production-gdt']);
  assert.deepEqual(ids("I haven't done production GD&T work, only what we covered in class."), []);
  assert.deepEqual(ids('I have not done production GD&T work, but I led the design team.'), []);
  const loss = { absent: [{ id: 'pnl', keywords: ['profit and loss'] }] };
  assert.equal(absentClaimsIn('I owned profit and loss for the region.', loss).length, 1, 'a clause word inside the keyword does not split it');
  assert.equal(absentClaimsIn('I have never owned profit and loss.', loss).length, 0);
  // A negated list shares its negation; an unrelated classroom qualifier does not hide a claim.
  assert.deepEqual(ids('I have no experience with production GD&T work and production tolerancing.'), []);
  assert.deepEqual(ids('Production GD&T work is not something I have done.'), []);
  assert.deepEqual(ids('I did production GD&T work only in class.'), []);
  assert.deepEqual(ids('I did production GD&T work and only used CAD in class.'), ['production-gdt']);
  assert.deepEqual(ids('I never missed a deadline, and I did production GD&T work.'), ['production-gdt']);
  assert.deepEqual(ids('I only did production GD&T work in class.'), [], 'a classroom qualifier around the keyword is honest');
  assert.deepEqual(ids('I never missed a deadline and did production GD&T work.'), ['production-gdt'], 'a negation does not carry into a new predicate');
  assert.equal(absentClaimsIn('I never missed a delivery window and owned profit and loss for our region.', loss).length, 1);
  assert.equal(absentClaimsIn('I have not owned a budget or profit and loss.', loss).length, 0, 'a negated list shares its negation');
  for (const each of personas) for (const absent of each.absent || []) assert.deepEqual(absentClaimsIn(absent.text, each), [], `honest answer stays unflagged: ${absent.text}`);
});

test('profile effectiveness keeps every repetition instead of the last one', () => {
  const run = (mode, rep, completion, evaluation) => ({
    scenario: { id: `x-${mode}-r${rep}`, baseId: `x-${mode}`, family: 'profile-effect', pairId: 'x', profileMode: mode }, pass: true,
    profile: mode === 'conversation' ? { captureRate: completion, pass: true, calls: 4, seconds: 10 } : undefined,
    evaluation: { pass: evaluation },
    packet: { factCoverage: completion, reviewPassed: true },
    application: { completionRate: completion, fields: [], submission: { accepted: true }, falseReady: false },
  });
  const summary = aggregate([run('conversation', 1, 0.5, true), run('conversation', 2, 1, false), run('seeded', 1, 1, true), run('seeded', 2, 1, true)]);
  const effect = summary.profileEffect[0];
  assert.deepEqual(effect.repetitions, { built: 2, seeded: 2, minimal: 0 });
  assert.equal(effect.downstream.built.applicationCompletion, 0.75, 'both repetitions are averaged, not the last one kept');
  assert.equal(effect.profileCapture, 0.75);
  assert.equal(effect.downstream.built.evaluation, 0.5, 'a boolean becomes a pass rate across repetitions');
  assert.equal(effect.downstream.delta.applicationCompletion, -0.25);
  assert.match(markdownReport({ summary, results: [] }), /50% pass/);
});
