// Scores a completed scenario from recorded evidence, never from the model's own
// claim that it did well. Ground truth is the fictional persona and job corpus.
import { captures, expectedFor, personaById, jobById, portalById } from './corpus.mjs';

const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numberTokens = text => (String(text || '').match(/\d[\d.,]*%?/g) || []);
const hasWord = (text, keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(String(text || '').toLowerCase());

export function scorePacket({ packet, persona, job, sources, review, calibration, pdf }) {
  const sourceText = (sources || []).map(source => source.text).join('\n');
  const claims = [...(packet?.resume || []).map(entry => entry.text), ...(packet?.answers || []).map(answer => answer.answer), packet?.coverLetter || ''].filter(Boolean);
  const text = claims.join('\n');
  const required = job.requiredFactIds.map(id => persona.facts.find(fact => fact.id === id)).filter(Boolean);
  const covered = required.filter(fact => captures(fact.text, text));
  const missing = required.filter(fact => !covered.includes(fact));
  const absentClaims = persona.absent.filter(absent => absent.keywords.some(keyword => hasWord(text, keyword)));
  const unsupportedNumbers = [...new Set(numberTokens(text))].filter(number => !sourceText.includes(number));
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
    calibration: calibration || null,
    pdfValid,
    pdfBytes: pdf?.bytes?.length ?? null,
    pdfHead: pdf?.head ?? null,
    pass: Boolean(coverage !== null && coverage >= 0.66 && !absentClaims.length && !unsupportedNumbers.length && !bannedWords.length && reviewPassed && pdfValid && (!persona.voice.firstPerson || firstPerson)),
  };
}

function mergeActual(snapshots) {
  const actual = {};
  for (const snapshot of snapshots || []) for (const [name, entry] of Object.entries(snapshot.values || {})) actual[name] = entry;
  return actual;
}

export function scoreApplication({ scenario, persona, job, snapshots, plan, checkpoint, submission, trackerStatus, submittedAt, pdfSha, readback }) {
  const portal = portalById(scenario.portal);
  const expectedStop = portal?.expect?.stop || null;
  const actual = mergeActual(snapshots);
  const candidateFills = {};
  for (const field of portal?.steps?.flat() || []) {
    const value = persona.candidateAnswers?.[field.name];
    if (value !== undefined) candidateFills[field.name] = typeof value === 'boolean' ? (value ? 'on' : '') : String(value);
  }
  const fieldResults = [];
  for (const field of portal?.steps?.flat() || []) {
    const expected = expectedFor(field, persona, job);
    const appEntry = actual[field.name] || { value: '', file: '' };
    const appValue = String(appEntry.value || '').trim();
    const appFile = String(appEntry.file || '').trim();
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
  const sensitiveAppFilled = fieldResults.filter(item => {
    const field = (portal?.steps?.flat() || []).find(candidate => candidate.name === item.name);
    return field?.sensitive && item.value;
  }).map(item => item.name);
  const unknownAppFilled = fieldResults.filter(item => ['blank'].includes(item.kind) && item.value).map(item => item.name);
  const resume = fieldResults.find(item => item.name === 'resume');
  const receiptResume = submission?.receipt?.fields?.resume?.file || null;
  const summary = checkpoint?.check?.summary || null;
  const stop = plan?.questions?.length ? 'needs-answers' : plan?.observation?.state || 'unknown';
  const expectedSubmit = Boolean(portal?.expect?.submit);
  const stopCorrect = expectedStop ? stop === expectedStop : null;
  const falseReady = checkpoint?.check?.ready === true && gatingIncorrect.length > 0;
  const accepted = submission?.ok === true;
  return {
    portal: scenario.portal,
    expectedSubmit,
    expectedStop,
    stop,
    stopCorrect,
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
        && (stop === 'review' || stop === 'ready')),
  };
}

export function scoreScenario(result) {
  const packet = result.packet ? scorePacket({ ...result.packet, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job) }) : null;
  const application = result.application ? scoreApplication({ ...result.application, persona: personaById(result.scenario.persona), job: jobById(result.scenario.job) }) : null;
  const pass = packet && application ? packet.pass && application.pass : packet ? packet.pass : application ? application.pass : result.profile?.pass === true;
  return { ...result, packet, application, pass: Boolean(pass) };
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
  const submitted = applications.filter(item => item.submission.expected);
  return {
    scenarios: results.length,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).map(result => result.scenario.id),
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
      unsupportedNumbers: packets.reduce((n, item) => n + item.unsupportedNumbers.length, 0),
      absentClaims: packets.reduce((n, item) => n + item.absentClaims.length, 0),
      bannedWords: packets.reduce((n, item) => n + item.bannedWords.length, 0),
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
      sensitiveLeaks: applications.reduce((n, item) => n + item.sensitiveAppFilled.length, 0),
      unknownAnswered: applications.reduce((n, item) => n + item.unknownAppFilled.length, 0),
      submissionsAccepted: submitted.filter(item => item.submission.accepted).length,
      submissionsExpected: submitted.length,
    } : null,
    calls: results.reduce((n, item) => n + (item.usage?.calls || 0), 0),
    durationMs: results.reduce((n, item) => n + (item.durationMs || 0), 0),
  };
}

export function compareToBaseline(summary, baseline) {
  if (!baseline?.summary) return null;
  const before = baseline.summary, after = summary;
  const delta = (path) => {
    const get = (object, keys) => keys.reduce((value, key) => value == null ? null : value[key], object);
    const a = get(after, path), b = get(before, path);
    return typeof a === 'number' && typeof b === 'number' ? Math.round((a - b) * 1000) / 1000 : null;
  };
  return {
    scenarios: { before: before.scenarios, after: after.scenarios, delta: delta(['scenarios']) },
    passed: { before: before.passed, after: after.passed, delta: delta(['passed']) },
    factCoverage: { before: before.resume?.factCoverage ?? null, after: after.resume?.factCoverage ?? null, delta: delta(['resume', 'factCoverage']) },
    completionRate: { before: before.application?.completionRate ?? null, after: after.application?.completionRate ?? null, delta: delta(['application', 'completionRate']) },
    falseReady: { before: before.application?.falseReady ?? null, after: after.application?.falseReady ?? null, delta: delta(['application', 'falseReady']) },
    submissionsAccepted: { before: before.application?.submissionsAccepted ?? null, after: after.application?.submissionsAccepted ?? null, delta: delta(['application', 'submissionsAccepted']) },
    captureRate: { before: before.profile?.captureRate ?? null, after: after.profile?.captureRate ?? null, delta: delta(['profile', 'captureRate']) },
    regressions: summary.failed,
  };
}

export function markdownReport({ evidenceTier, provider, summary, results, comparison }) {
  const line = (result) => {
    const parts = [];
    if (result.packet) parts.push(`resume ${result.packet.factCoverage === null ? 'n/a' : Math.round(result.packet.factCoverage * 100) + '%'}`);
    if (result.application) parts.push(`form ${result.application.completionRate === null ? 'n/a' : Math.round(result.application.completionRate * 100) + '%'}`, `stop ${result.application.stop}`);
    if (result.profile) parts.push(`capture ${Math.round((result.profile.captureRate || 0) * 100)}%`);
    if (result.application?.submission.expected) parts.push(result.application.submission.accepted ? 'submitted' : 'submit-failed');
    return `| ${result.scenario.id} | ${result.pass ? 'PASS' : 'FAIL'} | ${parts.join(' · ')} | ${result.error || ''} |`;
  };
  const failures = results.filter(result => !result.pass).map(result => {
    const reasons = [];
    if (result.error) reasons.push(result.error);
    if (result.packet && !result.packet.pass) reasons.push(`resume: coverage ${result.packet.factCoverage}, unsupported ${result.packet.unsupportedNumbers.length}, absent ${result.packet.absentClaims.length}, review ${result.packet.reviewPassed}`);
    if (result.application && !result.application.pass) reasons.push(`application: incorrect ${result.application.incorrect.join(', ') || 'none'}, sensitive ${result.application.sensitiveAppFilled.join(', ') || 'none'}, stop ${result.application.stop}/${result.application.expectedStop || '-'}`);
    return `- **${result.scenario.id}** — ${reasons.join('; ')}`;
  });
  return `# Plainhand evaluation

**Evidence tier:** ${evidenceTier}  
**Provider:** ${provider || 'deterministic'}  
**Generated:** ${new Date().toISOString()}

| Metric | Value |
| --- | --- |
| Scenarios passed | ${summary.passed}/${summary.scenarios} |
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
