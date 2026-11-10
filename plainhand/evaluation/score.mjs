// Scores a completed scenario from recorded evidence, never from the model's own
// claim that it did well. Ground truth is the fictional persona and job corpus.
import { hasEvidence } from '../store.mjs';
import { captures, expectedFor, personaById, jobById, portalById } from './corpus.mjs';

const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numberTokens = text => (String(text || '').match(/\d(?:[\d.,]*\d)?%?|\d%?/g) || []);
const hasWord = (text, keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(String(text || '').toLowerCase());

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
};
const numberWordDigits = text => Object.entries(NUMBER_WORDS)
  .filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(text))
  .map(([, digit]) => digit)
  .join(' ');
// Phone numbers are contact details, not evidence. Remove 10+-digit phone sequences
// while keeping hyphenated year ranges such as 2019-2023 intact.
const withoutPhones = text => String(text || '').replace(/\+?\d[\d\s().-]{7,}\d/g, match => match.replace(/\D/g, '').length >= 10 ? ' ' : match);
const numberCheckSource = sources => withoutPhones((sources || []).map(source => {
  const text = String(source.text || '');
  return source.id === 'profile' ? text.replace(/"phone":\s*"[^"]*"/g, '"phone": ""') : text;
}).join('\n'));

export function scorePacket({ packet, persona, job, sources, review, calibration, pdf, packetQuestionsAsked = [], roleAnswered = false }) {
  const sourceText = numberCheckSource(sources);
  const numberWords = numberWordDigits(sourceText);
  const cleanSourceText = sourceText.replace(/,/g, '') + (numberWords ? ' ' + numberWords : '');
  const cleanSourceTokens = new Set([...numberTokens(cleanSourceText), ...numberWords.split(/\s+/).filter(Boolean)]);
  const claims = [...(packet?.resume || []).map(entry => entry.text), ...(packet?.answers || []).map(answer => answer.answer), packet?.coverLetter || ''].filter(Boolean);
  // The candidate's own phone is contact detail, not a claim; any other phone stays checked.
  const ownPhone = String(persona.profile?.phone || '').replace(/\D/g, '').slice(-10);
  const text = claims.join('\n').replace(/\+?\d[\d\s().-]{7,}\d/g, match => ownPhone.length === 10 && match.replace(/\D/g, '').endsWith(ownPhone) ? ' ' : match);
  const required = job.requiredFactIds.map(id => persona.facts.find(fact => fact.id === id)).filter(Boolean);
  const covered = required.filter(fact => captures(fact.text, text));
  const missing = required.filter(fact => !covered.includes(fact));
  const absentClaims = persona.absent.filter(absent => absent.keywords.some(keyword => hasWord(text, keyword)));
  const unsupportedNumbers = [...new Set(numberTokens(text))].filter(number => !cleanSourceText.includes(number) && !cleanSourceTokens.has(number.replace(/,/g, '')));
  const atsCovered = job.atsTerms.filter(term => text.toLowerCase().includes(term.toLowerCase()));
  const bannedWords = persona.voice.banned.filter(word => hasWord(text, word));
  const coverLetter = String(packet?.coverLetter || '');
  const firstPerson = /\bI\b/.test(coverLetter);
  const sentences = coverLetter.match(/[^.!?]+[.!?]?/g) || [];
  const averageSentenceWords = sentences.length ? Math.round(sentences.reduce((n, sentence) => n + sentence.trim().split(/\s+/).filter(Boolean).length, 0) / sentences.length * 10) / 10 : null;
  const reviewPassed = review?.passed === true && (review.issues || []).length === 0;
  const pdfValid = Boolean(pdf?.bytes?.length > 100 && pdf?.head === '%PDF-');
  const coverage = required.length ? Math.round(covered.length / required.length * 100) / 100 : null;
  const atsCoverage = job.atsTerms.length ? Math.round(atsCovered.length / job.atsTerms.length * 100) / 100 : null;
  return {
    required: required.length,
    covered: covered.length,
    missingFacts: missing.map(fact => fact.id),
    factCoverage: coverage,
    absentClaims: absentClaims.map(absent => absent.id),
    unsupportedNumbers,
    atsCoverage,
    atsCovered,
    bannedWords,
    voiceFirstPerson: firstPerson,
    averageSentenceWords,
    reviewPassed,
    questions: Array.isArray(packet?.questions) ? packet.questions.length : null,
    questionsAsked: packetQuestionsAsked,
    roleAnswered,
    calibration: calibration || null,
    pdfValid,
    pdfBytes: pdf?.bytes?.length ?? null,
    pdfHead: pdf?.head ?? null,
    pass: Boolean(coverage !== null && coverage >= 0.66 && !absentClaims.length && !unsupportedNumbers.length && !bannedWords.length && reviewPassed && pdfValid && !(calibration?.counts?.unsupported > 0) && (!persona.voice.firstPerson || firstPerson)),
  };
}

function mergeActual(snapshots) {
  const actual = {};
  for (const snapshot of snapshots || []) for (const [name, entry] of Object.entries(snapshot.values || {})) actual[name] = entry;
  return actual;
}

export function scoreApplication({ scenario, persona, job, snapshots, plan, checkpoint, submission, trackerStatus, submittedAt, pdfSha, coverSha, discardDetected, candidateAnswered = {}, readback }) {
  const portal = portalById(scenario.portal);
  const expectedStop = portal?.expect?.stop || null;
  const actual = mergeActual(snapshots);
  const candidateFills = {};
  for (const field of portal?.steps?.flat() || []) {
    const value = persona.candidateAnswers?.[field.name];
    if (value !== undefined) candidateFills[field.name] = typeof value === 'boolean' ? (value ? 'on' : '') : String(value);
  }
  // Answers the candidate gave to the app's questions are the candidate's, not the app's.
  for (const [name, value] of Object.entries(candidateAnswered)) candidateFills[name] = String(value);
  const fieldResults = [];
  for (const field of portal?.steps?.flat() || []) {
    const expected = expectedFor(field, persona, job);
    const appEntry = actual[field.name] || { value: '', file: '' };
    const byCandidate = Object.hasOwn(candidateAnswered, field.name);
    const appValue = byCandidate ? '' : String(appEntry.value || '').trim();
    const appFile = byCandidate ? '' : String(appEntry.file || '').trim();
    const candidateValue = candidateFills[field.name] ?? '';
    const answerText = appValue || candidateValue;
    let correct = null;
    if (expected.kind === 'exact') correct = norm(answerText) === norm(expected.value);
    else if (expected.kind === 'file') correct = Boolean(appFile);
    else if (expected.kind === 'fact') correct = captures(expected.text, answerText);
    else if (expected.kind === 'anyOf') correct = expected.texts.some(text => captures(text, answerText));
    else if (expected.kind === 'blank') correct = !appValue;
    else if (expected.kind === 'candidate') {
      const receiptValue = submission?.receipt?.fields?.[field.name]?.value;
      correct = candidateValue ? norm(answerText) === norm(candidateValue) : Boolean(candidateValue);
      if (receiptValue !== undefined) correct = correct && norm(receiptValue) === norm(candidateValue);
    }
    fieldResults.push({
      name: field.name,
      label: field.label,
      required: Boolean(field.required),
      kind: expected.kind,
      value: appValue,
      file: appFile,
      candidateSupplied: Boolean(candidateValue) && !appValue,
      correct: Boolean(correct),
    });
  }
  const scored = fieldResults.filter(item => item.kind !== 'none');
  const gating = scored.filter(item => item.required || ['blank', 'candidate'].includes(item.kind));
  const incorrect = scored.filter(item => !item.correct);
  const gatingIncorrect = gating.filter(item => !item.correct);
  const planAnswers = plan?.answers || {};
  const planFields = plan?.fields || [];
  const planAnswerFor = field => {
    const planField = planFields.find(item => item?.name === field.name);
    const value = planField ? planAnswers[planField.key] : planAnswers[field.name];
    return String(value ?? '').trim();
  };
  const sensitiveAppFilled = [...new Set([
    ...fieldResults.filter(item => {
      const field = (portal?.steps?.flat() || []).find(candidate => candidate.name === item.name);
      return field?.sensitive && item.value;
    }).map(item => item.name),
    ...(portal?.steps?.flat() || []).filter(field => field.sensitive && planAnswerFor(field)).map(field => field.name),
  ])];
  const unknownAppFilled = [...new Set([
    ...fieldResults.filter(item => ['blank'].includes(item.kind) && item.value).map(item => item.name),
    ...(portal?.steps?.flat() || []).filter(field => expectedFor(field, persona, job).kind === 'blank' && planAnswerFor(field)).map(field => field.name),
  ])];
  const resume = fieldResults.find(item => item.name === 'resume');
  const receiptResume = submission?.receipt?.fields?.resume?.file || null;
  const summary = checkpoint?.check?.summary || null;
  const planFieldName = key => (plan?.fields || []).find(item => item?.key === key)?.name;
  const openQuestions = (plan?.questions || []).filter(question => !Object.hasOwn(candidateAnswered, planFieldName(question.key)));
  const warning = plan?.warning || null;
  const stop = openQuestions.length ? 'needs-answers' : warning ? 'agent-warning' : plan?.observation?.state || 'unknown';
  const expectedSubmit = Boolean(portal?.expect?.submit);
  const stopCorrect = expectedStop ? stop === expectedStop : null;
  const requiredUnfilledByApp = fieldResults.some(item => item.required && ['candidate', 'blank'].includes(item.kind) && !item.value);
  const falseReady = checkpoint?.check?.ready === true && (gatingIncorrect.length > 0 || requiredUnfilledByApp);
  const coverHashMatches = !coverSha || !submission?.receipt?.fields?.cover?.file || submission.receipt.fields.cover.file.sha256 === coverSha;
  const accepted = submission?.ok === true;
  return {
    portal: scenario.portal,
    expectedSubmit,
    expectedStop,
    stop,
    stopCorrect,
    warning,
    fields: fieldResults,
    scoredFields: scored.length,
    correctFields: scored.filter(item => item.correct).length,
    completionRate: scored.length ? Math.round((scored.length - incorrect.length) / scored.length * 100) / 100 : null,
    incorrect: incorrect.map(item => item.name),
    gatingIncorrect: gatingIncorrect.map(item => item.name),
    sensitiveAppFilled,
    unknownAppFilled,
    resumeAttached: Boolean(resume?.file),
    resumeHashMatches: Boolean(pdfSha && receiptResume?.sha256 === pdfSha),
    coverHashMatches,
    discardDetected: Boolean(discardDetected),
    appQuestions: (plan?.questions || []).length,
    candidateAnswered: Object.keys(candidateAnswered),
    check: summary,
    checkReady: checkpoint?.check?.ready ?? null,
    falseReady,
    submission: {
      expected: expectedSubmit,
      attempted: Boolean(submission),
      accepted,
      errors: submission?.errors || [],
      receipt: submission?.receipt ? { id: submission.receipt.id, receivedAt: submission.receipt.receivedAt, fields: Object.keys(submission.receipt.fields || {}) } : null,
    },
    trackerStatus: trackerStatus || null,
    submittedAt: submittedAt || null,
    readback: readback || null,
    pass: Boolean(expectedStop
      ? stopCorrect && !sensitiveAppFilled.length && !unknownAppFilled.length && !submission
      : gatingIncorrect.length === 0
        && !sensitiveAppFilled.length
        && !unknownAppFilled.length
        && Boolean(resume?.file)
        && accepted
        && trackerStatus === 'Applied'
        && Boolean(submittedAt)
        && !falseReady
        && (!pdfSha || receiptResume?.sha256 === pdfSha)
        && coverHashMatches
        && (!portal?.discardOnce || Boolean(discardDetected))
        && (stop === 'review' || stop === 'ready')),
  };
}

export function scoreEvaluation({ evaluation, sources, job, prepareRefusedWithoutOverride }) {
  const validScore = typeof evaluation?.score === 'number' && evaluation.score >= 0 && evaluation.score <= 5;
  const expectedRec = job?.expectRecommendation || 'Apply';
  const recCorrect = evaluation?.recommendation === expectedRec;
  const scoreBandCorrect = expectedRec === 'Skip' ? evaluation?.score <= (job?.maxScore ?? 3.9) : evaluation?.score >= 4;
  const evidenceValid = Array.isArray(evaluation?.matches) && evaluation.matches.length > 0 && evaluation.matches.every(match => hasEvidence(match, { sources: sources || [] }));
  const guardCorrect = expectedRec === 'Skip' ? prepareRefusedWithoutOverride === true : true;
  const pass = Boolean(validScore && recCorrect && scoreBandCorrect && evidenceValid && guardCorrect);
  return {
    expectedRecommendation: expectedRec,
    score: evaluation?.score ?? null,
    recommendation: evaluation?.recommendation ?? null,
    matches: Array.isArray(evaluation?.matches) ? evaluation.matches.length : null,
    summary: evaluation?.summary ?? null,
    gaps: Array.isArray(evaluation?.gaps) ? evaluation.gaps : [],
    validScore,
    recCorrect,
    scoreBandCorrect,
    evidenceValid,
    guardCorrect,
    prepareRefusedWithoutOverride: prepareRefusedWithoutOverride ?? null,
    pass,
  };
}

export function scoreScenario(result) {
  const packet = result.packet ? scorePacket({ ...result.packet, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job) }) : null;
  const application = result.application ? scoreApplication({ ...result.application, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job) }) : null;
  const evaluation = result.evaluation ? scoreEvaluation({ ...result.evaluation, job: jobById(result.scenario.job) }) : null;
  let pass;
  if (result.scenario.family === 'evaluation') pass = Boolean(evaluation?.pass);
  else if (result.scenario.family === 'journey') pass = Boolean(result.profile?.pass && result.understandingApproved && result.standardApproved && (!evaluation || evaluation.pass) && packet?.pass && application?.pass);
  else if (result.scenario.family === 'profile-effect') pass = Boolean((!result.profile || result.profile.pass) && (!evaluation || evaluation.pass) && packet?.pass && application?.pass);
  else {
    const base = packet && application ? packet.pass && application.pass : packet ? packet.pass : application ? application.pass : result.profile?.pass === true;
    pass = Boolean(base && (!evaluation || evaluation.pass));
  }
  const expectedFail = Boolean(result.scenario.expectFail);
  return { ...result, packet, application, evaluation, expectedFail, unexpected: !pass && !expectedFail, pass: Boolean(pass) };
}

const avg = values => {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length * 1000) / 1000 : null;
};

export function aggregate(results) {
  const byFamily = {};
  for (const result of results) {
    const bucket = byFamily[result.scenario.family] ||= { scenarios: 0, passed: 0 };
    bucket.scenarios++;
    if (result.pass) bucket.passed++;
  }
  const packets = results.filter(result => result.packet).map(result => result.packet);
  const applications = results.filter(result => result.application).map(result => result.application);
  const filling = applications.filter(item => item.submission.expected);
  const profiles = results.filter(result => result.profile).map(result => result.profile);
  const evaluations = results.filter(result => result.evaluation).map(result => result.evaluation);
  const submitted = applications.filter(item => item.submission.expected);
  const profileEffect = (() => {
    const groups = new Map();
    for (const result of results) {
      if (!result.scenario.pairId) continue;
      const runs = groups.get(result.scenario.pairId) || {};
      runs[result.scenario.profileMode || 'seeded'] = result;
      groups.set(result.scenario.pairId, runs);
    }
    const downstream = result => {
      const fields = result.application?.fields || [];
      const fromApp = fields.filter(field => field.correct && !field.candidateSupplied).length;
      return {
        evaluation: result.evaluation?.pass ?? null,
        packetFactCoverage: result.packet?.factCoverage ?? null,
        packetReviewPassed: result.packet?.reviewPassed ?? null,
        applicationCompletion: result.application?.completionRate ?? null,
        applicationFromProfile: fields.length ? Math.round(fromApp / fields.length * 100) / 100 : null,
        candidateRescues: fields.filter(field => field.candidateSupplied).length,
        submissionAccepted: result.application?.submission?.accepted ?? null,
        falseReady: result.application?.falseReady ?? null,
      };
    };
    return [...groups.entries()].flatMap(([pairId, runs]) => {
      if (!runs.conversation || !runs.seeded) return [];
      const built = runs.conversation, seeded = runs.seeded, minimal = runs.minimal || null;
      const builtDown = downstream(built), seededDown = downstream(seeded);
      const minimalDown = minimal ? downstream(minimal) : null;
      const delta = Object.fromEntries(Object.entries(builtDown).map(([key, value]) => [key, typeof value === 'number' && typeof seededDown[key] === 'number' ? Math.round((value - seededDown[key]) * 1000) / 1000 : null]));
      const deltaVsMinimal = minimalDown ? Object.fromEntries(Object.entries(builtDown).map(([key, value]) => [key, typeof value === 'number' && typeof minimalDown[key] === 'number' ? Math.round((value - minimalDown[key]) * 1000) / 1000 : null])) : null;
      return [{
        pairId,
        builtPass: built.pass ?? null,
        seededPass: seeded.pass ?? null,
        minimalPass: minimal?.pass ?? null,
        builtProfilePass: built.profile?.pass ?? null,
        profileCapture: built.profile?.captureRate ?? null,
        profileCoverage: built.profile?.coverageOfAllFacts ?? null,
        profileStrength: built.profileStrength?.summary || null,
        seededStrength: seeded.profileStrength?.summary || null,
        minimalStrength: minimal?.profileStrength?.summary || null,
        profileCalls: built.profile?.calls ?? null,
        profileSeconds: built.profile?.seconds ?? null,
        downstream: { built: builtDown, seeded: seededDown, minimal: minimalDown, delta, deltaVsMinimal },
      }];
    });
  })();
  const repeatGroups = new Map();
  for (const result of results) {
    if (!result.scenario.baseId) continue;
    const runs = repeatGroups.get(result.scenario.baseId) || [];
    runs.push(result);
    repeatGroups.set(result.scenario.baseId, runs);
  }
  let repeats = null;
  if (repeatGroups.size) {
    const byScenario = {}, flakyScenarios = [];
    let passedRuns = 0, totalRuns = 0;
    for (const [id, runs] of repeatGroups) {
      const passed = runs.filter(item => item.pass).length;
      byScenario[id] = { runs: runs.length, passed, passRate: Math.round(passed / runs.length * 100) / 100 };
      if (passed > 0 && passed < runs.length) flakyScenarios.push(id);
      passedRuns += passed;
      totalRuns += runs.length;
    }
    repeats = {
      scenarios: repeatGroups.size,
      runsPerScenario: Math.round(totalRuns / repeatGroups.size * 100) / 100,
      passRate: Math.round(passedRuns / totalRuns * 100) / 100,
      flakyScenarios,
      byScenario,
    };
  }
  return {
    scenarios: results.length,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).map(result => result.scenario.id),
    expectedFailures: results.filter(result => !result.pass && (result.expectedFail ?? result.scenario.expectFail)).map(result => result.scenario.id),
    unexpectedFailures: results.filter(result => !result.pass && !(result.expectedFail ?? result.scenario.expectFail)).map(result => result.scenario.id),
    byFamily,
    profile: profiles.length ? {
      runs: profiles.length,
      captureRate: avg(profiles.map(item => item.captureRate)),
      notVerbatim: profiles.reduce((n, item) => n + (item.notVerbatim || 0), 0),
      unsupportedUpdates: profiles.reduce((n, item) => n + (item.unsupportedUpdates?.length || 0), 0),
      absentClaimsSaved: profiles.reduce((n, item) => n + (item.absentClaimsSaved?.length || 0), 0),
      oneQuestionShare: avg(profiles.map(item => item.turns ? Math.round(item.oneQuestionTurns / item.turns * 100) / 100 : null)),
    } : null,
    resume: packets.length ? {
      runs: packets.length,
      factCoverage: avg(packets.map(item => item.factCoverage)),
      reviewPassed: packets.filter(item => item.reviewPassed).length,
      unsupportedNumbers: packets.reduce((n, item) => n + (item.unsupportedNumbers?.length || 0), 0),
      absentClaims: packets.reduce((n, item) => n + (item.absentClaims?.length || 0), 0),
      bannedWords: packets.reduce((n, item) => n + (item.bannedWords?.length || 0), 0),
      firstPerson: packets.filter(item => item.voiceFirstPerson).length,
      atsCoverage: avg(packets.map(item => item.atsCoverage)),
    } : null,
    application: applications.length ? {
      runs: applications.length,
      fillRuns: filling.length,
      completionRate: avg(filling.map(item => item.completionRate)),
      correctStops: applications.filter(item => item.expectedStop && item.stopCorrect).length,
      expectedStops: applications.filter(item => item.expectedStop).length,
      falseReady: applications.filter(item => item.falseReady).length,
      sensitiveLeaks: applications.reduce((n, item) => n + (item.sensitiveAppFilled?.length || 0), 0),
      unknownAnswered: applications.reduce((n, item) => n + (item.unknownAppFilled?.length || 0), 0),
      submissionsAccepted: submitted.filter(item => item.submission.accepted).length,
      submissionsExpected: submitted.length,
    } : null,
    evaluation: evaluations.length ? {
      runs: evaluations.length,
      passed: evaluations.filter(item => item.pass).length,
    } : null,
    profileEffect: profileEffect.length ? profileEffect : null,
    repeats,
    calls: results.reduce((n, item) => n + (item.usage?.calls || 0), 0),
    durationMs: results.reduce((n, item) => n + (item.durationMs || 0), 0),
  };
}

export function compareToBaseline(summary, baseline, currentResults = []) {
  if (!baseline?.summary) return null;
  const before = baseline.summary, after = summary;
  const delta = (path) => {
    const get = (object, keys) => keys.reduce((value, key) => value == null ? null : value[key], object);
    const a = get(after, path), b = get(before, path);
    return typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 1000) / 1000 : null;
  };
  const baselineResults = Array.isArray(baseline.results) ? baseline.results : [];
  const baselineFailed = new Set(baseline.summary?.failed || baselineResults.filter(item => !item.pass).map(item => item.scenario?.id).filter(Boolean));
  const currentFailed = summary.failed || [];
  const currentById = new Map(currentResults.map(item => [item.scenario?.id, item]));
  const regressions = currentFailed.filter(id => !baselineFailed.has(id));
  const preExistingFailures = currentFailed.filter(id => baselineFailed.has(id));
  const improvements = [...baselineFailed].filter(id => currentResults.length ? currentById.get(id)?.pass === true : summary.scenarios > 0 && !currentFailed.includes(id));
  return {
    scenarios: { before: before.scenarios, after: after.scenarios, delta: delta(['scenarios']) },
    passed: { before: before.passed, after: after.passed, delta: delta(['passed']) },
    factCoverage: { before: before.resume?.factCoverage ?? null, after: after.resume?.factCoverage ?? null, delta: delta(['resume', 'factCoverage']) },
    completionRate: { before: before.application?.completionRate ?? null, after: after.application?.completionRate ?? null, delta: delta(['application', 'completionRate']) },
    falseReady: { before: before.application?.falseReady ?? null, after: after.application?.falseReady ?? null, delta: delta(['application', 'falseReady']) },
    submissionsAccepted: { before: before.application?.submissionsAccepted ?? null, after: after.application?.submissionsAccepted ?? null, delta: delta(['application', 'submissionsAccepted']) },
    captureRate: { before: before.profile?.captureRate ?? null, after: after.profile?.captureRate ?? null, delta: delta(['profile', 'captureRate']) },
    regressions,
    improvements,
    preExistingFailures,
  };
}

export function markdownReport({ evidenceTier, provider, summary, results, comparison }) {
  const line = (result) => {
    const parts = [];
    if (result.evaluation) parts.push(`eval ${result.evaluation.score ?? 'n/a'}/5 ${result.evaluation.recommendation ?? ''}`.trim());
    if (result.packet) parts.push(`resume ${result.packet.factCoverage === null ? 'n/a' : Math.round(result.packet.factCoverage * 100) + '%'}`);
    if (result.application) parts.push(`form ${result.application.completionRate === null ? 'n/a' : Math.round(result.application.completionRate * 100) + '%'}`, `stop ${result.application.stop}`);
    if (result.profile) parts.push(`capture ${Math.round((result.profile.captureRate || 0) * 100)}%`);
    if (result.application?.submission.expected) parts.push(result.application.submission.accepted ? 'submitted' : 'submit-failed');
    return `| ${result.scenario.id} | ${result.pass ? 'PASS' : result.expectedFail ? 'EXPECTED FAIL' : 'FAIL'} | ${parts.join(' · ')} | ${result.error || ''} |`;
  };
  const failures = results.filter(result => !result.pass).map(result => {
    const reasons = [];
    if (result.error) reasons.push(result.error);
    if (result.evaluation && !result.evaluation.pass) reasons.push(`evaluation: score ${result.evaluation.score ?? 'n/a'}, recommendation ${result.evaluation.recommendation ?? 'n/a'}, evidence ${result.evaluation.evidenceValid}, guard ${result.evaluation.guardCorrect}`);
    if (result.packet && !result.packet.pass) reasons.push(`resume: coverage ${result.packet.factCoverage}, unsupported ${result.packet.unsupportedNumbers.length}, absent ${result.packet.absentClaims.length}, review ${result.packet.reviewPassed}`);
    if (result.application && !result.application.pass) reasons.push(`application: incorrect ${result.application.incorrect.join(', ') || 'none'}, sensitive ${result.application.sensitiveAppFilled.join(', ') || 'none'}, stop ${result.application.stop}/${result.application.expectedStop || '-'}${result.application.warning ? `, warning: ${result.application.warning}` : ''}`);
    return `- **${result.scenario.id}**${result.expectedFail ? ' (expected lower-bound control)' : ''} — ${reasons.join('; ')}`;
  });
  return `# Plainhand evaluation

**Evidence tier:** ${evidenceTier}  
**Provider:** ${provider || 'deterministic'}  
**Generated:** ${new Date().toISOString()}

| Metric | Value |
| --- | --- |
| Scenarios passed | ${summary.passed}/${summary.scenarios} |
| Evaluations passed | ${summary.evaluation?.passed ?? 0}/${summary.evaluation?.runs ?? 0} |
| Resume fact coverage | ${summary.resume?.factCoverage ?? 'n/a'} |
| Resume unsupported numbers | ${summary.resume?.unsupportedNumbers ?? 'n/a'} |
| Cover letters first person | ${summary.resume?.firstPerson ?? 0}/${summary.resume?.runs ?? 0} |
| Application completion (fill scenarios) | ${summary.application?.completionRate ?? 'n/a'} |
| Correct stops | ${summary.application?.correctStops ?? 0}/${summary.application?.expectedStops ?? 0} |
| False-ready | ${summary.application?.falseReady ?? 'n/a'} |
| Sensitive fields auto-filled | ${summary.application?.sensitiveLeaks ?? 'n/a'} |
| Submissions accepted | ${summary.application?.submissionsAccepted ?? 0}/${summary.application?.submissionsExpected ?? 0} |
| Profile capture rate | ${summary.profile?.captureRate ?? 'n/a'} |
| Model calls | ${summary.calls} |
| Duration | ${(summary.durationMs / 1000).toFixed(1)}s |

${summary.profileEffect?.length ? `## Profile effectiveness

The built profile is compared with the finished persona as an upper bound on the
same job. A zero delta means the conversation-built profile supports the
downstream stages as well as the full profile; a negative delta means information
the downstream stage needed was not captured or was not used.

| Pair | Built capture | Strength (minimal → built → seeded) | Packet Δ vs minimal | Packet Δ vs seeded | App from profile Δ vs minimal | App from profile Δ vs seeded | Evaluation pass (built/seeded) | Profile cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${summary.profileEffect.map(effect => {
  const strength = summary => summary ? `${summary.strong || 0} strong / ${summary.good || 0} good / ${summary.thin || 0} thin` : 'n/a';
  const delta = effect.downstream.delta, deltaVsMinimal = effect.downstream.deltaVsMinimal || {};
  const percent = value => value === null || value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
  return `| ${effect.pairId} | ${effect.profileCapture === null ? 'n/a' : Math.round(effect.profileCapture * 100) + '%'} | ${strength(effect.minimalStrength)} → ${strength(effect.profileStrength)} → ${strength(effect.seededStrength)} | ${percent(deltaVsMinimal.packetFactCoverage)} | ${percent(delta.packetFactCoverage)} | ${percent(deltaVsMinimal.applicationFromProfile)} | ${percent(delta.applicationFromProfile)} | ${effect.downstream.built.evaluation === null ? 'n/a' : effect.downstream.built.evaluation ? 'pass' : 'fail'} / ${effect.downstream.seeded.evaluation === null ? 'n/a' : effect.downstream.seeded.evaluation ? 'pass' : 'fail'} | ${effect.profileCalls ?? '?'} calls · ${effect.profileSeconds ?? '?'} s |`;
}).join('\n')}
` : ''}
${comparison ? `## Baseline delta\n\n\`\`\`json\n${JSON.stringify(comparison, null, 2)}\n\`\`\`\n` : ''}
## Scenarios

| Scenario | Result | Measures | Error |
| --- | --- | --- | --- |
${results.map(line).join('\n')}

${failures.length ? `## Failures\n\n${failures.join('\n')}\n` : '## Failures\n\nNone.\n'}
## Limits

- Controlled runs use a deterministic agent: they prove the harness, workflow and submission validation, not model quality.
- Live runs measure one provider on fictional material; they are not employer acceptance or a guarantee of real-world outcomes.
- The submission is a simulated candidate confirmation against an owned loopback server. The app's production submit guard stays intact.
`;
}
