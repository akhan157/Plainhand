#!/usr/bin/env node
// Grades the packets in an evaluation evidence directory with a model judge:
// claim-level fact checking plus an anchored 1-5 rubric. Opt-in and live only;
// it refuses to run without --judge. See docs/internal/EVALUATION-JUDGE.md.
//
//   node benchmarks/benchmark-judge.mjs --evidence output/evaluation-claude-... --judge codex
//   node benchmarks/benchmark-judge.mjs --evidence <dir> --judge codex --samples 3 --scenarios mech-resume,swe-resume
//   node benchmarks/benchmark-judge.mjs --evidence <dir> --calibration-template
//   node benchmarks/benchmark-judge.mjs --evidence <dir> --calibrate ratings.json
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personaById, jobById } from '../plainhand/evaluation/corpus.mjs';
import { DIMENSIONS, RUBRIC, judgePacket, liveJudge, summarizeJudgements } from '../plainhand/evaluation/judge.mjs';

export const RAW_PACKET_FILE = id => `${id}.packet.json`;
export const TEMPLATE_FILE = 'human-ratings.template.json';
const CALIBRATION_DIMENSIONS = [...DIMENSIONS, 'overall'];

export const NO_JUDGE_MESSAGE = 'Refusing to run: --judge <provider> is required (claude, codex or antigravity). The judge makes real model calls; choose a provider that differs from the one under test where possible. Nothing was graded.';

export const MISSING_RAW_MESSAGE = `No raw packet text was found in this evidence directory, so nothing can be judged.
The scenario JSON stores only the packet SCORE (scoreScenario replaces result.packet with scorePacket's output), and the raw packet and sources are discarded.
To make a run judgeable, runner.mjs must persist per packet scenario either a file <out>/<scenarioId>.packet.json or a top-level "packetRaw" field, containing:
  packet  - prepared.packet (headline, resume[{section,heading,text,evidence}], coverLetter, answers[{question,answer,evidence}], questions, suggestions)
  sources - the sources from workspace.context(...) at packet time ([{id,text}]), i.e. packetResult.sources
Persona and job are looked up from scenario.persona and scenario.job in corpus.mjs.`;

const option = (argv, name) => { const index = argv.indexOf('--' + name); return index < 0 ? null : argv[index + 1] ?? null; };
const has = (argv, name) => argv.includes('--' + name);

const isScenarioRecord = value => value && typeof value === 'object' && typeof value.scenario?.id === 'string';
const isRawPacket = raw => raw && typeof raw === 'object' && raw.packet && typeof raw.packet === 'object' && Array.isArray(raw.sources);

// Every scenario record in an evidence dir, each with its raw packet when one was saved.
export async function loadEvidence(dir) {
  if (!existsSync(dir)) throw new Error(`Evidence directory not found: ${dir}`);
  const files = (await readdir(dir)).filter(name => name.endsWith('.json') && !name.endsWith('.trace.json') && !name.endsWith('.packet.json') && !['results.json', 'judge.json', 'calibration.json', TEMPLATE_FILE].includes(name)).sort();
  const records = [];
  for (const name of files) {
    let scored;
    try { scored = JSON.parse(await readFile(path.join(dir, name), 'utf8')); } catch { continue; }
    if (!isScenarioRecord(scored)) continue;
    const id = scored.scenario.id;
    let raw = null;
    const rawFile = path.join(dir, RAW_PACKET_FILE(id));
    if (existsSync(rawFile)) { try { raw = JSON.parse(await readFile(rawFile, 'utf8')); } catch {} }
    if (!isRawPacket(raw)) raw = [scored.packetRaw, scored.raw].find(isRawPacket) || null;
    records.push({ id, scored, raw, hadPacket: Boolean(scored.packet) || Boolean(raw) });
  }
  return records;
}

async function testedProvider(dir) {
  try { return JSON.parse(await readFile(path.join(dir, 'results.json'), 'utf8')).provider || null; } catch {}
  return /evaluation-([a-z]+)-\d{4}/.exec(path.basename(dir))?.[1] || null;
}

export async function runJudge({ dir, judge, judgeProvider = judge?.providerId || 'injected', samples = 1, scenarios = null, log = console.log }) {
  const selected = (await loadEvidence(dir)).filter(record => !scenarios || scenarios.has(record.id) || scenarios.has(record.scored.scenario.baseId));
  const ready = selected.filter(record => record.raw);
  const skipped = selected.filter(record => !record.raw && record.hadPacket).map(record => ({ scenarioId: record.id, reason: 'no raw packet saved (only the packet score)' }));
  if (!ready.length) return { refused: true, message: skipped.length ? MISSING_RAW_MESSAGE : 'No scenario with a packet stage was found in this evidence directory.' };
  const tested = await testedProvider(dir);
  const selfJudged = Boolean(tested && tested === judgeProvider);
  if (selfJudged) log(`Warning: the judge (${judgeProvider}) is the provider under test; expect self-preference in its grades.`);
  const results = [];
  for (const record of ready) {
    const scenario = record.scored.scenario;
    const persona = personaById(scenario.persona ?? record.scored.persona);
    const job = jobById(scenario.job ?? record.scored.job);
    if (!persona || !job) { skipped.push({ scenarioId: record.id, reason: 'persona or job not found in corpus.mjs' }); continue; }
    const started = Date.now();
    const judged = await judgePacket({ packet: record.raw.packet, sources: record.raw.sources, job, persona, judge, samples });
    const result = { scenarioId: record.id, persona: persona.id, job: job.id, ...judged, durationMs: Date.now() - started };
    results.push(result);
    log(`judged ${record.id}${judged.claims.error ? ' (claims failed: ' + judged.claims.error + ')' : ''}${judged.rubric.error ? ' (rubric failed: ' + judged.rubric.error + ')' : ''}`);
  }
  const report = { date: new Date().toISOString(), evidence: dir, judgeProvider, testedProvider: tested, selfJudged, samples, rubric: RUBRIC, summary: summarizeJudgements(results), results, skipped };
  await writeFile(path.join(dir, 'judge.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(dir, 'JUDGE.md'), judgeMarkdown(report));
  return { refused: false, report };
}

const cell = value => value === null || value === undefined ? 'n/a' : String(value);
const pct = value => typeof value === 'number' ? Math.round(value * 100) + '%' : 'n/a';
const md = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function judgeMarkdown(report) {
  const rows = report.results.map(result => {
    const claims = result.claims?.error ? null : result.claims;
    const rubric = result.rubric?.error ? null : result.rubric;
    const dims = DIMENSIONS.map(id => {
      const dim = rubric?.dimensions?.[id];
      if (!dim || dim.mean === null) return 'n/a';
      return report.samples > 1 ? `${dim.mean} ±${dim.sd}` : String(dim.mean);
    });
    return `| ${result.scenarioId} | ${claims ? `${claims.counts.supported} / ${claims.counts.partially_supported} / ${claims.counts.unsupported} / ${claims.counts.not_a_factual_claim}` : 'failed'} | ${pct(claims?.unsupportedRate)} | ${pct(claims?.factCoverageSemantic)} (${pct(claims?.factCoverageOverlap)}) | ${dims.join(' | ')} | ${rubric ? cell(rubric.overall.mean) : 'failed'} |`;
  });
  const unsupported = report.results.flatMap(result => (result.claims?.unsupported || []).map(claim => `- **${result.scenarioId}** \`${claim.id}\` "${md(claim.text)}" — ${md(claim.downgraded ? `judge said ${claim.judgeVerdict}; ${claim.downgradeReason}` : claim.reason)}`));
  const improvements = report.results.flatMap(result => (result.rubric?.improvements || []).map(item => `- **${result.scenarioId}** ${md(item)}`));
  const unverified = report.results.flatMap(result => [
    ...(result.rubric?.unverifiedExcerpts || []).map(item => `- **${result.scenarioId}** rubric ${item.dimension} (sample ${item.sample + 1}): "${md(item.excerpt)}"`),
    ...(result.claims?.unverifiedFactQuotes || []).map(id => `- **${result.scenarioId}** required fact ${id}: packet quote not found`),
  ]);
  const failures = report.results.flatMap(result => [result.claims?.error && `- **${result.scenarioId}** claims: ${md(result.claims.error)}`, result.rubric?.error && `- **${result.scenarioId}** rubric: ${md(result.rubric.error)}`].filter(Boolean));
  const s = report.summary;
  return `# Plainhand packet judge

**Judge:** ${report.judgeProvider}${report.selfJudged ? ' (same as provider under test: self-preference likely)' : ''}
**Provider under test:** ${report.testedProvider || 'unknown'}
**Samples per packet:** ${report.samples}
**Generated:** ${report.date}

A model's judgement, not a human's. Treat these numbers as uncalibrated until they
have been compared with human ratings (\`--calibration-template\`, then \`--calibrate\`).

| Metric | Value |
| --- | --- |
| Packets judged | ${s.packets} |
| Claims supported / partial / unsupported / not factual | ${s.claimCounts.supported} / ${s.claimCounts.partially_supported} / ${s.claimCounts.unsupported} / ${s.claimCounts.not_a_factual_claim} |
| Unsupported rate (of factual claims) | ${pct(s.unsupportedRate)} |
| Supported verdicts downgraded (quote not in sources) | ${s.downgradedQuotes} |
| Required facts conveyed, semantic (word overlap) | ${pct(s.factCoverageSemantic)} (${pct(s.factCoverageOverlap)}) |
${DIMENSIONS.map(id => `| ${RUBRIC.find(item => item.id === id).name} | ${cell(s.dimensions[id])} |`).join('\n')}
| Overall | ${cell(s.overall)} |
| Unverified rubric excerpts | ${s.unverifiedExcerpts} |

## Scenarios

Claims are supported / partial / unsupported / not factual. Coverage is semantic, with word overlap in brackets.${report.samples > 1 ? ' Dimension cells are mean ±standard deviation across samples.' : ''}

| Scenario | Claims | Unsupported | Fact coverage | ${DIMENSIONS.join(' | ')} | Overall |
| --- | --- | --- | --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |
${rows.join('\n')}

## Unsupported claims

${unsupported.length ? unsupported.join('\n') : 'None.'}

## Improvements

${improvements.length ? improvements.join('\n') : 'None.'}

## Unverified quotes

${unverified.length ? unverified.join('\n') : 'None.'}
${failures.length ? `\n## Judge failures\n\n${failures.join('\n')}\n` : ''}${report.skipped.length ? `\n## Skipped\n\n${report.skipped.map(item => `- ${item.scenarioId}: ${item.reason}`).join('\n')}\n` : ''}`;
}

// Empty human ratings for every judgeable scenario and dimension, plus overall.
export async function calibrationTemplate(dir) {
  const ready = (await loadEvidence(dir)).filter(record => record.raw);
  if (!ready.length) return { refused: true, message: MISSING_RAW_MESSAGE };
  const ratings = ready.flatMap(record => CALIBRATION_DIMENSIONS.map(dimension => ({ scenarioId: record.id, dimension, score: null, note: '' })));
  const file = path.join(dir, TEMPLATE_FILE);
  await writeFile(file, JSON.stringify(ratings, null, 2) + '\n');
  return { refused: false, file, ratings };
}

const rounded = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

// Human ratings [{scenarioId, dimension, score}] against judge.json. Mean absolute
// difference uses the judge's mean score; exact and within-1 agreement use the
// judge's mean rounded to the nearest integer.
export function calibrate(judgeReport, ratings) {
  if (!Array.isArray(ratings)) throw new Error('Ratings must be a JSON array of {scenarioId, dimension, score}.');
  const byScenario = new Map((judgeReport?.results || []).map(result => [result.scenarioId, result]));
  const pairs = [], unmatched = [];
  let unrated = 0;
  for (const rating of ratings) {
    const human = typeof rating?.score === 'number' ? rating.score : null;
    if (human === null) { unrated++; continue; }
    const result = byScenario.get(rating.scenarioId);
    const model = !result?.rubric || result.rubric.error ? null : rating.dimension === 'overall' ? result.rubric.overall?.mean : result.rubric.dimensions?.[rating.dimension]?.mean;
    if (typeof model !== 'number') { unmatched.push({ scenarioId: rating.scenarioId, dimension: rating.dimension, reason: result ? 'judge has no score for this dimension' : 'scenario not in judge.json' }); continue; }
    pairs.push({ scenarioId: rating.scenarioId, dimension: rating.dimension, human, model, diff: Math.abs(model - human), roundedDiff: Math.abs(Math.round(model) - human) });
  }
  const stats = list => list.length ? {
    n: list.length,
    meanAbsDiff: rounded(list.reduce((n, pair) => n + pair.diff, 0) / list.length),
    exact: list.filter(pair => pair.roundedDiff === 0).length,
    within1: list.filter(pair => pair.roundedDiff <= 1).length,
    exactRate: rounded(list.filter(pair => pair.roundedDiff === 0).length / list.length),
    within1Rate: rounded(list.filter(pair => pair.roundedDiff <= 1).length / list.length),
  } : { n: 0, meanAbsDiff: null, exact: 0, within1: 0, exactRate: null, within1Rate: null };
  const dimensions = Object.fromEntries(CALIBRATION_DIMENSIONS.map(id => [id, stats(pairs.filter(pair => pair.dimension === id))]));
  return { dimensions, all: stats(pairs), rated: pairs.length, unrated, unmatched, pairs };
}

export const calibrationTable = result => `| Dimension | n | Mean abs diff | Exact | Within 1 |
| --- | --- | --- | --- | --- |
${[...Object.entries(result.dimensions), ['all', result.all]].map(([id, s]) => `| ${id} | ${s.n} | ${cell(s.meanAbsDiff)} | ${s.n ? `${s.exact}/${s.n}` : 'n/a'} | ${s.n ? `${s.within1}/${s.n}` : 'n/a'} |`).join('\n')}`;

const HELP = `Plainhand packet judge

  node benchmarks/benchmark-judge.mjs --evidence <dir> --judge <provider> [options]

  --evidence <dir>         Evaluation evidence directory (output/evaluation-...).
  --judge <provider>       Required to grade: claude, codex or antigravity. Makes real model calls.
                           Prefer a provider different from the one under test.
  --samples <n>            Rubric calls per packet; reports mean and spread (default 1).
  --scenarios <ids>        Comma-separated scenario ids to grade.
  --timeout <s>            Per-call timeout in seconds (default 600).
  --calibration-template   Write ${TEMPLATE_FILE} with empty human ratings and exit.
  --calibrate <file.json>  Compare human ratings with <dir>/judge.json and exit.

Writes <dir>/judge.json and <dir>/JUDGE.md.`;

export async function main(argv = process.argv.slice(2), { judgeFactory = liveJudge, log = console.log, error = console.error } = {}) {
  if (has(argv, 'help')) { log(HELP); return 0; }
  const dir = option(argv, 'evidence');
  if (has(argv, 'calibration-template')) {
    if (!dir) { error('--evidence <dir> is required.'); return 2; }
    const result = await calibrationTemplate(dir);
    if (result.refused) { error(result.message); return 2; }
    log(`Wrote ${result.ratings.length} empty ratings to ${result.file}. Fill each score with 1-5 using the rubric in docs/internal/EVALUATION-JUDGE.md.`);
    return 0;
  }
  const ratingsFile = option(argv, 'calibrate');
  if (has(argv, 'calibrate')) {
    if (!dir || !ratingsFile) { error('--evidence <dir> and --calibrate <ratings.json> are required.'); return 2; }
    const judgeFile = path.join(dir, 'judge.json');
    if (!existsSync(judgeFile)) { error(`No judge.json in ${dir}. Run the judge first.`); return 2; }
    const result = calibrate(JSON.parse(await readFile(judgeFile, 'utf8')), JSON.parse(await readFile(ratingsFile, 'utf8')));
    await writeFile(path.join(dir, 'calibration.json'), JSON.stringify({ date: new Date().toISOString(), ratings: ratingsFile, ...result }, null, 2));
    log(calibrationTable(result));
    log(`\n${result.rated} rated pairs, ${result.unrated} unrated, ${result.unmatched.length} unmatched. Wrote ${path.join(dir, 'calibration.json')}`);
    return 0;
  }
  const provider = option(argv, 'judge');
  if (!provider) { error(NO_JUDGE_MESSAGE); return 2; }
  if (!dir) { error('--evidence <dir> is required.'); return 2; }
  const timeoutMs = Math.max(10, Number(option(argv, 'timeout') || 600)) * 1000;
  const judge = judgeFactory(provider, { timeoutMs });
  const requested = option(argv, 'scenarios');
  const scenarios = requested ? new Set(requested.split(',').map(item => item.trim()).filter(Boolean)) : null;
  const samples = Math.max(1, Number(option(argv, 'samples') || 1));
  const result = await runJudge({ dir, judge, judgeProvider: provider, samples, scenarios, log });
  if (result.refused) { error(result.message); return 2; }
  log(`\nJudged ${result.report.results.length} packets, skipped ${result.report.skipped.length}. Wrote ${path.join(dir, 'judge.json')} and JUDGE.md`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
