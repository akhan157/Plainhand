// Packet judge: claim checking, rubric grading and the judge CLI. Fake judges only;
// this file never makes a live model call and never passes a real --judge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractClaims, checkClaims, splitSentences, JOB_SOURCE_ID } from '../plainhand/evaluation/claims.mjs';
import { gradePacket, liveJudge, DIMENSIONS, RUBRIC, RUBRIC_INSTRUCTION, summarizeJudgements } from '../plainhand/evaluation/judge.mjs';
import { CLAIMS_INSTRUCTION } from '../plainhand/evaluation/claims.mjs';
import { main, calibrate, runJudge, MISSING_RAW_MESSAGE, NO_JUDGE_MESSAGE, TEMPLATE_FILE } from '../benchmarks/benchmark-judge.mjs';
import { personaById, jobById } from '../plainhand/evaluation/corpus.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const persona = personaById('mech-grad');
const job = jobById('grad-mech');
const sources = [{ id: 'resume', text: persona.profile.resume }];

const packet = {
  headline: 'Mechanical engineering student, B.S. Mechanical Engineering, Example University, 2027.',
  resume: [
    { section: 'Projects', heading: { org: 'Formula SAE', title: 'Suspension sub-team', location: '', dates: '2024 to 2026' }, text: 'Redesigned the rear upright in SolidWorks, cutting weight by 18% while passing the same load tests.' },
    { section: 'Experience', heading: { org: 'Example Pumps', title: 'Engineering Intern', location: '', dates: 'Jun 2026 to Aug 2026' }, text: 'Wrote an impeller-wear test procedure the lab still uses. Ran 40 bench tests on it.' },
    { section: 'Experience', heading: { org: 'Example Pumps', title: 'Engineering Intern', location: '', dates: 'Jun 2026 to Aug 2026' }, text: 'Led a team of 10 engineers on a production GD&T audit.' },
  ],
  answers: [{ question: 'Why this role?', answer: 'I want a hands-on design role. I like building robots.' }],
  coverLetter: 'Dear Hiring Manager,\n\nI am applying for the Junior Mechanical Design Engineer role at Fictional Robotics Co. Your team designs mechanical assemblies for mobile robots. I would welcome the chance to talk.\n\nSincerely,\nRiley Chen',
};

// A fake judge that returns canned replies keyed by instruction and records calls.
function fakeJudge({ claims = () => ({ claims: [], requiredFacts: [] }), rubric = () => ({ dimensions: [], overall: 3, improvements: [] }) } = {}) {
  const calls = [];
  const judge = async (instruction, data) => {
    calls.push({ instruction, data });
    if (instruction === CLAIMS_INSTRUCTION) return claims(data, calls.length);
    if (instruction === RUBRIC_INSTRUCTION) return rubric(data, calls.filter(call => call.instruction === RUBRIC_INSTRUCTION).length);
    throw new Error('unexpected instruction');
  };
  judge.calls = calls;
  return judge;
}

test('splitSentences keeps abbreviations and splits on sentence ends', () => {
  assert.deepEqual(splitSentences('B.S. Mechanical Engineering, 2027. I ran 40 tests. Dr. Lee approved it!'), ['B.S. Mechanical Engineering, 2027.', 'I ran 40 tests.', 'Dr. Lee approved it!']);
  assert.deepEqual(splitSentences('- First bullet\n- Second bullet. Third.'), ['First bullet', 'Second bullet.', 'Third.']);
  assert.deepEqual(splitSentences('Cut weight by 18.5% using v2.1 tooling.'), ['Cut weight by 18.5% using v2.1 tooling.']);
});

test('extractClaims splits resume, answers and cover letter deterministically', () => {
  const claims = extractClaims(packet);
  assert.deepEqual(claims, extractClaims(packet), 'deterministic');
  assert.ok(claims.every(claim => ['resume', 'answer', 'cover'].includes(claim.part) && claim.id && claim.text));
  const ids = claims.map(claim => claim.id);
  assert.ok(ids.includes('resume:1.0') && ids.includes('resume:1.1'), 'two sentences in one entry become two claims');
  assert.equal(claims.find(claim => claim.id === 'resume:1.1').text, 'Ran 40 bench tests on it.');
  assert.equal(claims.filter(claim => claim.kind === 'heading').length, 2, 'repeated headings are one claim');
  assert.deepEqual(claims.filter(claim => claim.part === 'answer').map(claim => claim.text), ['I want a hands-on design role.', 'I like building robots.']);
  const cover = claims.filter(claim => claim.part === 'cover').map(claim => claim.text);
  assert.equal(cover.length, 3, 'salutation, sign-off and name line are not claims');
  assert.equal(cover[0], 'I am applying for the Junior Mechanical Design Engineer role at Fictional Robotics Co.');
  assert.equal(claims.find(claim => claim.id === 'headline:0').text, packet.headline, 'B.S. does not split the headline');
});

test('a supported verdict whose quote is not in the sources is downgraded; an invented claim is unsupported', async () => {
  const claims = extractClaims(packet);
  const judge = fakeJudge({
    claims: data => {
      assert.ok(data.sources.some(source => source.id === JOB_SOURCE_ID && source.text.includes('mobile robots')), 'job posting is a source');
      return {
        claims: data.claims.map(claim => {
          if (claim.id === 'resume:0.0') return { id: claim.id, verdict: 'supported', sourceId: 'resume', quote: 'redesigned the rear upright in SolidWorks', reason: 'Matches.' };
          // Fabricated quote: the judge says supported but the words are not in any source.
          if (claim.id === 'resume:1.1') return { id: claim.id, verdict: 'supported', sourceId: 'resume', quote: 'ran 40 bench tests over two summers', reason: 'Matches.' };
          if (claim.id === 'resume:2.0') return { id: claim.id, verdict: 'unsupported', sourceId: '', quote: '', reason: 'No source mentions leading 10 engineers or GD&T audits.' };
          // Right quote, wrong source id: accepted and corrected.
          if (claim.id === 'cover:1') return { id: claim.id, verdict: 'supported', sourceId: 'resume', quote: 'mechanical assemblies for mobile robots', reason: 'The posting says this.' };
          if (claim.part === 'cover' || claim.part === 'answer') return { id: claim.id, verdict: 'not_a_factual_claim', sourceId: '', quote: '', reason: 'Intent.' };
          return { id: claim.id, verdict: 'supported', sourceId: 'resume', quote: claim.text.slice(0, 3), reason: 'Too short.' };
        }),
        requiredFacts: [],
      };
    },
  });
  const result = await checkClaims({ claims, sources, job, persona, judge, packet });
  const get = id => result.claims.find(claim => claim.id === id);
  assert.equal(get('resume:0.0').verdict, 'supported');
  assert.equal(get('resume:0.0').quoteMatch, 'exact');
  assert.equal(get('resume:1.1').verdict, 'unsupported');
  assert.equal(get('resume:1.1').judgeVerdict, 'supported');
  assert.equal(get('resume:1.1').downgraded, true);
  assert.equal(get('resume:2.0').verdict, 'unsupported');
  assert.equal(get('resume:2.0').downgraded, false);
  assert.equal(get('cover:1').verdict, 'supported');
  assert.equal(get('cover:1').sourceId, JOB_SOURCE_ID);
  assert.equal(get('cover:1').sourceIdCorrected, true);
  assert.ok(result.unsupported.some(claim => claim.id === 'resume:2.0' && /10 engineers/.test(claim.text)));
  assert.equal(result.counts.unsupported, result.unsupported.length);
  assert.equal(result.unsupportedRate, Math.round(result.counts.unsupported / result.factual * 1000) / 1000);
  assert.equal(judge.calls.length, 1, 'one batched call per packet');
});

test('claims the judge omits are unjudged, not silently supported', async () => {
  const claims = extractClaims(packet);
  const result = await checkClaims({ claims, sources, job, persona, judge: fakeJudge(), packet });
  assert.equal(result.counts.unjudged, claims.length);
  assert.equal(result.factual, 0);
  assert.equal(result.unsupportedRate, null);
});

test('a paraphrased required fact counts as covered only when the judge says so and its quote is in the packet', async () => {
  const claims = extractClaims(packet);
  const judge = fakeJudge({
    claims: data => {
      assert.deepEqual(data.requiredFacts.map(fact => fact.id), job.requiredFactIds);
      return {
        claims: [],
        requiredFacts: [
          { id: 'fsae', conveyed: true, packetQuote: 'Redesigned the rear upright in SolidWorks, cutting weight by 18%', reason: 'Paraphrase of the upright redesign.' },
          { id: 'pumps', conveyed: true, packetQuote: 'Wrote a test procedure for impeller wear and ran 40 bench tests', reason: 'Quote not in the packet.' },
          { id: 'tools', conveyed: false, packetQuote: '', reason: 'ANSYS and MATLAB are not mentioned.' },
        ],
      };
    },
  });
  const result = await checkClaims({ claims, sources, job, persona, judge, packet });
  const fact = id => result.requiredFacts.find(item => item.id === id);
  assert.equal(fact('fsae').conveyed, true);
  assert.equal(fact('fsae').quoteVerified, true);
  assert.equal(fact('pumps').judgeConveyed, true);
  assert.equal(fact('pumps').conveyed, false, 'unverifiable packet quote does not count');
  assert.equal(fact('pumps').quoteVerified, false);
  assert.equal(fact('tools').conveyed, false);
  assert.equal(result.factCoverageSemantic, 0.333);
  assert.deepEqual(result.unverifiedFactQuotes, ['pumps']);
  assert.equal(typeof fact('fsae').overlapCovered, 'boolean', 'word-overlap result is reported beside it');
});

const rubricReply = (scores, overrides = {}) => ({
  dimensions: DIMENSIONS.map(id => ({ id, score: scores[id] ?? 3, excerpt: overrides[id] ?? 'Ran 40 bench tests on it.', reason: 'Because.' })),
  overall: scores.overall ?? 3,
  improvements: ['Move the Formula SAE upright line first.', 'Name ANSYS and MATLAB.', 'Drop the unsupported GD&T line.', 'A fourth one is dropped.'],
});

test('rubric excerpts are verified against the packet and unverified ones are flagged', async () => {
  const judge = fakeJudge({ rubric: () => rubricReply({ relevance: 4 }, { specificity: 'Led a team of 40 engineers across three plants', voice: 'Ran  40 bench tests on it.' }) });
  const result = await gradePacket({ packet, sources, job, persona, judge });
  assert.equal(result.dimensions.relevance.mean, 4);
  assert.equal(result.dimensions.relevance.excerpts[0].verified, true);
  assert.equal(result.dimensions.specificity.excerpts[0].verified, false);
  assert.equal(result.dimensions.voice.excerpts[0].verified, true, 'whitespace differences are tolerated');
  assert.deepEqual(result.unverifiedExcerpts.map(item => item.dimension), ['specificity']);
  assert.equal(result.improvements.length, 3);
  const data = judge.calls[0].data;
  assert.equal(data.voice.description, persona.profile.voice);
  assert.deepEqual(data.voice.bannedWords, persona.voice.banned);
  assert.deepEqual(data.rubric.map(item => item.id), DIMENSIONS);
});

test('cover dimension is not applicable without a cover letter', async () => {
  const judge = fakeJudge({ rubric: () => rubricReply({ cover: 5 }) });
  const result = await gradePacket({ packet: { ...packet, coverLetter: '' }, sources, job, persona, judge });
  assert.equal(result.dimensions.cover.mean, null);
  assert.equal(result.dimensions.cover.notApplicable, true);
});

test('samples report mean and spread per dimension', async () => {
  const sequence = [{ relevance: 2, overall: 2 }, { relevance: 4, overall: 3 }, { relevance: 3, overall: 4 }];
  const judge = fakeJudge({ rubric: (data, n) => rubricReply(sequence[n - 1]) });
  const result = await gradePacket({ packet, sources, job, persona, judge, samples: 3 });
  assert.equal(judge.calls.length, 3);
  assert.deepEqual(result.dimensions.relevance.scores, [2, 4, 3]);
  assert.equal(result.dimensions.relevance.mean, 3);
  assert.equal(result.dimensions.relevance.min, 2);
  assert.equal(result.dimensions.relevance.max, 4);
  assert.equal(result.dimensions.relevance.sd, 0.82);
  assert.equal(result.dimensions.specificity.sd, 0);
  assert.equal(result.overall.mean, 3);
});

test('a failing sample is recorded and the rest still count; all failing throws', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 2) throw new Error('timed out'); return rubricReply({ relevance: 5 }); };
  const result = await gradePacket({ packet, sources, job, persona, judge: flaky, samples: 3 });
  assert.equal(result.succeeded, 2);
  assert.deepEqual(result.failed, ['timed out']);
  await assert.rejects(gradePacket({ packet, sources, job, persona, judge: async () => { throw new Error('down'); } }), /Every rubric sample failed/);
});

test('instructions state the grading role, length neutrality and unsupported penalty', () => {
  for (const text of [RUBRIC_INSTRUCTION, CLAIMS_INSTRUCTION]) assert.match(text, /grading another system's output/);
  assert.match(RUBRIC_INSTRUCTION, /do not reward length/i);
  assert.match(RUBRIC_INSTRUCTION, /Penalise any claim the sources do not support/);
  for (const item of RUBRIC) for (const level of [1, 3, 5]) assert.ok(item.anchors[level].length > 20, `${item.id} anchor ${level}`);
});

test('liveJudge routes through executeAgent with the timeout and refuses the in-app provider', async () => {
  const seen = [];
  const judge = liveJudge('codex', { timeoutMs: 1234, execute: async (...args) => { seen.push(args); return { ok: true }; } });
  assert.deepEqual(await judge('do it', { a: 1 }), { ok: true });
  assert.deepEqual(seen[0], ['codex', 'do it', { a: 1 }, { timeout: 1234 }]);
  assert.equal(judge.providerId, 'codex');
  assert.throws(() => liveJudge('chatgpt'), /cannot be used as a judge/);
  assert.throws(() => liveJudge('nope'));
});

test('CLI refuses without --judge, in process and as a script', async () => {
  const errors = [];
  let factoryCalled = false;
  const code = await main(['--evidence', 'output/does-not-matter'], { judgeFactory: () => { factoryCalled = true; }, log: () => {}, error: message => errors.push(message) });
  assert.equal(code, 2);
  assert.equal(errors[0], NO_JUDGE_MESSAGE);
  assert.equal(factoryCalled, false);
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, [path.join(ROOT, 'benchmarks/benchmark-judge.mjs'), '--evidence', tmpdir()]), error => error.code === 2 && error.stderr.includes('--judge <provider> is required'));
});

test('calibration agreement math', () => {
  const report = { results: [
    { scenarioId: 'a', rubric: { dimensions: { relevance: { mean: 4 }, honesty: { mean: 2.6 } }, overall: { mean: 3 } } },
    { scenarioId: 'b', rubric: { dimensions: { relevance: { mean: 2 }, honesty: { mean: 5 } }, overall: { mean: 4 } } },
  ] };
  const ratings = [
    { scenarioId: 'a', dimension: 'relevance', score: 4 },
    { scenarioId: 'b', dimension: 'relevance', score: 4 },
    { scenarioId: 'a', dimension: 'honesty', score: 2 },
    { scenarioId: 'b', dimension: 'honesty', score: 5 },
    { scenarioId: 'a', dimension: 'overall', score: 3 },
    { scenarioId: 'b', dimension: 'overall', score: null },
    { scenarioId: 'zzz', dimension: 'relevance', score: 3 },
  ];
  const result = calibrate(report, ratings);
  assert.deepEqual(result.dimensions.relevance, { n: 2, meanAbsDiff: 1, exact: 1, within1: 1, exactRate: 0.5, within1Rate: 0.5 });
  // 2.6 rounds to 3: off by one, mean absolute difference uses the unrounded mean.
  assert.deepEqual(result.dimensions.honesty, { n: 2, meanAbsDiff: 0.3, exact: 1, within1: 2, exactRate: 0.5, within1Rate: 1 });
  assert.equal(result.dimensions.overall.n, 1);
  assert.equal(result.dimensions.cover.n, 0);
  assert.equal(result.all.n, 5);
  assert.equal(result.all.exact, 3);
  assert.equal(result.all.within1, 4);
  assert.equal(result.unrated, 1);
  assert.deepEqual(result.unmatched.map(item => item.scenarioId), ['zzz']);
});

async function evidenceDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'plainhand-judge-test-'));
  const scored = (id, extra = {}) => ({ scenario: { id, family: 'resume', persona: 'mech-grad', job: 'grad-mech' }, persona: 'mech-grad', job: 'grad-mech', packet: { required: 3, covered: 2, factCoverage: 0.67 }, pass: false, ...extra });
  await writeFile(path.join(dir, 'mech-resume.json'), JSON.stringify(scored('mech-resume')));
  await writeFile(path.join(dir, 'results.json'), JSON.stringify({ provider: 'claude', results: [] }));
  return { dir, scored };
}

test('evidence without a raw packet is refused with the fields runner.mjs must persist', async () => {
  const { dir } = await evidenceDir();
  try {
    const result = await runJudge({ dir, judge: fakeJudge(), judgeProvider: 'codex', log: () => {} });
    assert.equal(result.refused, true);
    assert.equal(result.message, MISSING_RAW_MESSAGE);
    assert.match(result.message, /packet\.json/);
    assert.match(result.message, /packetRaw/);
    assert.match(result.message, /sources/);
    assert.equal(existsSync(path.join(dir, 'judge.json')), false, 'nothing is written');
    const errors = [];
    assert.equal(await main(['--evidence', dir, '--judge', 'codex'], { judgeFactory: () => fakeJudge(), log: () => {}, error: message => errors.push(message) }), 2);
    assert.match(errors[0], /No raw packet text was found/);
    assert.equal(await main(['--evidence', dir, '--calibration-template'], { log: () => {}, error: () => {} }), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('judges scenarios with a raw packet, skips the rest, writes judge.json, JUDGE.md and a calibration template', async () => {
  const { dir, scored } = await evidenceDir();
  try {
    await writeFile(path.join(dir, 'swe-resume.json'), JSON.stringify(scored('swe-resume', { scenario: { id: 'swe-resume', family: 'resume', persona: 'mech-grad', job: 'grad-mech' } })));
    await writeFile(path.join(dir, 'swe-resume.packet.json'), JSON.stringify({ packet, sources }));
    await writeFile(path.join(dir, 'designer-resume.json'), JSON.stringify(scored('designer-resume', { packetRaw: { packet, sources } })));
    const judge = fakeJudge({
      claims: data => ({ claims: data.claims.map(claim => ({ id: claim.id, verdict: claim.id === 'resume:2.0' ? 'unsupported' : 'not_a_factual_claim', reason: 'Fake.' })), requiredFacts: [] }),
      rubric: () => rubricReply({ relevance: 4, overall: 4 }),
    });
    const logs = [];
    const code = await main(['--evidence', dir, '--judge', 'claude', '--samples', '2'], { judgeFactory: (provider, options) => { assert.equal(provider, 'claude'); assert.equal(options.timeoutMs, 600000); return judge; }, log: message => logs.push(message), error: message => logs.push(message) });
    assert.equal(code, 0);
    assert.ok(logs.some(line => /self-preference/.test(line)), 'warns when the judge is the provider under test');
    const report = JSON.parse(await readFile(path.join(dir, 'judge.json'), 'utf8'));
    assert.deepEqual(report.results.map(result => result.scenarioId).sort(), ['designer-resume', 'swe-resume']);
    assert.deepEqual(report.skipped, [{ scenarioId: 'mech-resume', reason: 'no raw packet saved (only the packet score)' }]);
    assert.equal(report.selfJudged, true);
    assert.equal(report.samples, 2);
    assert.equal(report.summary.claimCounts.unsupported, 2);
    assert.equal(report.summary.dimensions.relevance, 4);
    assert.equal(judge.calls.length, 2 * (1 + 2), 'one claim call and two rubric samples per packet');
    const markdown = await readFile(path.join(dir, 'JUDGE.md'), 'utf8');
    assert.match(markdown, /\| swe-resume \|/);
    assert.match(markdown, /## Unsupported claims[\s\S]*Led a team of 10 engineers/);
    assert.match(markdown, /## Improvements[\s\S]*Move the Formula SAE upright line first/);
    assert.match(markdown, /## Skipped[\s\S]*mech-resume/);

    assert.equal(await main(['--evidence', dir, '--calibration-template'], { log: () => {}, error: () => {} }), 0);
    const template = JSON.parse(await readFile(path.join(dir, TEMPLATE_FILE), 'utf8'));
    assert.equal(template.length, 2 * (DIMENSIONS.length + 1));
    assert.ok(template.every(item => item.score === null && ['designer-resume', 'swe-resume'].includes(item.scenarioId)));
    // A filled template calibrates against judge.json; the template itself is not mistaken for a scenario.
    const ratingsFile = path.join(dir, 'ratings.json');
    await writeFile(ratingsFile, JSON.stringify(template.map(item => ({ ...item, score: 4 }))));
    const out = [];
    assert.equal(await main(['--evidence', dir, '--calibrate', ratingsFile], { log: message => out.push(message), error: message => out.push(message) }), 0);
    const calibration = JSON.parse(await readFile(path.join(dir, 'calibration.json'), 'utf8'));
    assert.equal(calibration.dimensions.relevance.exact, 2);
    assert.equal(calibration.dimensions.cover.n, 2);
    assert.match(out[0], /\| relevance \| 2 \|/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('summarizeJudgements pools claim counts and averages dimensions', () => {
  const summary = summarizeJudgements([
    { claims: { counts: { supported: 3, partially_supported: 1, unsupported: 1, not_a_factual_claim: 2, unjudged: 0 }, downgraded: 1, factCoverageSemantic: 1, factCoverageOverlap: 0.5 }, rubric: { dimensions: { relevance: { mean: 4 } }, overall: { mean: 4 }, unverifiedExcerpts: [] } },
    { claims: { counts: { supported: 4, partially_supported: 0, unsupported: 0, not_a_factual_claim: 1, unjudged: 0 }, downgraded: 0, factCoverageSemantic: 0.5, factCoverageOverlap: 0.5 }, rubric: { error: 'down' } },
  ]);
  assert.equal(summary.unsupportedRate, 0.111);
  assert.equal(summary.factCoverageSemantic, 0.75);
  assert.equal(summary.dimensions.relevance, 4);
  assert.equal(summary.rubricRuns, 1);
  assert.equal(summary.downgradedQuotes, 1);
});
