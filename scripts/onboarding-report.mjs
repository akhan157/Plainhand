#!/usr/bin/env node
// How much work a new candidate had to do.
//
// Reads one or more evaluation evidence directories (results.json plus the
// per-scenario JSON the runner writes) and reports, per run and by mode:
//   - user turns and assistant questions in the profile conversation;
//   - questions asked again even though the sources already answered them
//     (M5's repeat-question ledger when the evidence has it, otherwise a
//     question repeated in the transcript);
//   - manual edits and rescues (the benchmark's "rescued by candidate" and the
//     app-filled fields), from the application stage;
//   - calls, tokens and wall time to the first reviewed master and the first
//     prepared packet.
//
// The live evidence records one duration and one usage total per scenario, not
// per-stage timestamps. The stage markers are reported exactly; wall time and
// calls are whole-run figures, and the conversation's own seconds/calls are the
// only lower bounds the evidence carries. The controlled onboarding proof
// (scripts/onboarding-proof.mjs) is where exact stage times are measured.
//
// Usage: node scripts/onboarding-report.mjs <evidence-dir> [...]
//        node scripts/onboarding-report.mjs --json <evidence-dir> [...]

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const directories = argv.filter(value => !value.startsWith('--'));
if (!directories.length) {
  console.error('Usage: node scripts/onboarding-report.mjs [--json] <evidence-dir> [...]');
  process.exit(1);
}

const sum = values => values.every(value => value === null || value === undefined) ? null : values.reduce((a, b) => a + (b ?? 0), 0);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const sd = values => {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1));
};
const round = (value, places = 1) => value === null || value === undefined ? null : Math.round(value * 10 ** places) / 10 ** places;
const fmt = (value, suffix = '') => value === null || value === undefined ? '—' : `${round(value)}${suffix}`;
const spread = (values, suffix = '') => {
  const list = values.filter(value => value !== null && value !== undefined);
  if (!list.length) return '—';
  const average = mean(list), deviation = sd(list);
  return deviation === null ? `${round(average)}${suffix}` : `${round(average)} ± ${round(deviation)}${suffix}`;
};

const questionSentences = text => (String(text || '').match(/[^.!?\n]*\?/g) || []).map(question => question.toLowerCase().replace(/[^a-z0-9%$]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
function repeatedQuestions(transcript) {
  const counts = new Map();
  for (const turn of transcript) for (const question of questionSentences(turn.assistant)) counts.set(question, (counts.get(question) || 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}
function ledgerRepeats(state) {
  const checks = Array.isArray(state?.conflictReview?.questionChecks) ? state.conflictReview.questionChecks : null;
  if (!checks) return null;
  const counts = new Map();
  for (const check of checks) if (check?.digest) counts.set(check.digest, (counts.get(check.digest) || 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

const tokensOf = usage => usage ? sum([usage.inputTokens, usage.outputTokens]) : null;
const seconds = ms => ms === null || ms === undefined ? null : Math.round(ms / 100) / 10;

function runMetrics(result, directory) {
  const scenario = result.scenario || {};
  const profile = result.profile || null;
  const strength = result.profileStrength || profile?.strength || null;
  const transcript = Array.isArray(profile?.transcript) ? profile.transcript : [];
  const assistant = transcript.map(turn => String(turn.assistant || ''));
  const conversation = scenario.profileMode === 'conversation' || profile?.turns > 0;
  const ledger = Number.isInteger(result.profileStrength?.questions?.repeated) ? result.profileStrength.questions.repeated
    : Number.isInteger(strength?.questions?.repeated) ? strength.questions.repeated
      : ledgerRepeats(result.profileStrength) ?? ledgerRepeats(strength);
  const repeated = ledger !== null ? ledger : transcript.length ? repeatedQuestions(transcript) : null;
  const application = result.application || null;
  const rescues = Array.isArray(application?.appOwedRescued) ? application.appOwedRescued.length : null;
  const answered = Array.isArray(application?.candidateAnswered) ? application.candidateAnswered.length : null;
  const manualEdits = answered === null ? null : Math.max(0, answered - (rescues || 0));
  const appFilledFields = application ? Math.max(0, (application.appOwedFields ?? 0) - (rescues || 0)) : null;
  const usage = result.usage || null;
  const standardReached = result.standardApproved === true;
  const packetReached = Boolean(result.packet);
  const masterApplicable = Boolean(scenario.withStandard) || scenario.family === 'journey';
  return {
    directory,
    id: scenario.id || '(unknown)',
    baseId: scenario.baseId || scenario.id || '(unknown)',
    family: scenario.family || null,
    mode: scenario.profileMode || (scenario.family === 'journey' ? 'journey' : scenario.family || 'other'),
    persona: scenario.persona || null,
    job: scenario.job || null,
    passed: result.pass === true,
    error: result.error || result.blocked?.stage || null,
    conversation,
    userTurns: conversation ? profile?.turns ?? transcript.length : null,
    assistantQuestions: conversation ? (transcript.length ? assistant.reduce((total, text) => total + (text.match(/\?/g) || []).length, 0) : null) : null,
    askingTurns: conversation ? profile?.turnsAsking ?? null : null,
    repeatedKnownFactQuestions: conversation ? repeated : null,
    repeatedBasis: ledger !== null ? 'ledger' : 'transcript',
    manualEdits,
    rescues,
    appFilledFields,
    calls: usage?.calls ?? null,
    tokens: tokensOf(usage),
    promptChars: usage?.promptChars ?? null,
    wallMs: result.durationMs ?? null,
    conversationSeconds: profile?.seconds ?? null,
    understandingReached: result.understandingApproved === true,
    masterApplicable,
    masterReached: standardReached,
    packetReached,
    masterStage: {
      reached: standardReached,
      wallMs: null,
      calls: null,
      tokens: null,
      lowerBound: { wallMs: conversation && profile?.seconds ? Math.round(profile.seconds * 1000) : null, calls: conversation ? profile?.calls ?? null : null },
      basis: 'Stage timestamps are not recorded in live evidence; whole-run figures below are the upper bound.',
    },
    packetStage: {
      reached: packetReached,
      wallMs: null,
      calls: null,
      tokens: null,
      upperBound: { wallMs: result.durationMs ?? null, calls: usage?.calls ?? null, tokens: tokensOf(usage) },
      basis: 'Stage timestamps are not recorded in live evidence; whole-run figures are the upper bound.',
    },
  };
}

async function loadDirectory(directory) {
  const report = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  const rows = [];
  for (const entry of report.results || []) {
    let result = entry;
    const id = entry.scenario?.id;
    if (id) {
      try { result = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')); }
      catch { result = entry; }
    }
    rows.push({ result, metrics: runMetrics(result, directory) });
  }
  return { directory, report, rows };
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

const metricKeys = ['userTurns', 'assistantQuestions', 'repeatedKnownFactQuestions', 'manualEdits', 'rescues', 'appFilledFields', 'calls', 'tokens', 'wallMs'];
function aggregate(rows) {
  const values = key => rows.map(row => row[key]).filter(value => value !== null && value !== undefined);
  return {
    runs: rows.length,
    passed: rows.filter(row => row.passed).length,
    conversationRuns: rows.filter(row => row.conversation).length,
    masterRuns: rows.filter(row => row.masterApplicable).length,
    masterReached: rows.filter(row => row.masterApplicable && row.masterReached).length,
    packetReached: rows.filter(row => row.packetReached).length,
    ...Object.fromEntries(metricKeys.map(key => [key, { mean: mean(values(key)), sd: sd(values(key)), n: values(key).length }])),
  };
}

function table(rows, { showAggregate = true, title = '' } = {}) {
  if (!rows.length) return `### ${title}\n\nNo runs.\n`;
  const header = '| run | mode | turns | questions | repeat Q | manual | rescues | app-filled | calls | tokens | wall s | master | packet | pass |';
  const lines = rows.map(row => `| ${row.id} | ${row.mode} | ${fmt(row.userTurns)} | ${fmt(row.assistantQuestions)} | ${fmt(row.repeatedKnownFactQuestions)} | ${fmt(row.manualEdits)} | ${fmt(row.rescues)} | ${fmt(row.appFilledFields)} | ${fmt(row.calls)} | ${fmt(row.tokens)} | ${fmt(seconds(row.wallMs))} | ${row.masterApplicable ? (row.masterReached ? 'yes' : 'no') : 'n/a'} | ${row.packetReached ? 'yes' : 'no'} | ${row.passed ? 'PASS' : 'fail'} |`);
  const groups = [...groupBy(rows, row => row.mode).entries()];
  const aggregateLines = showAggregate ? groups.map(([mode, group]) => {
    const stat = aggregate(group);
    return `| ${mode} (${stat.runs}) | ${mode} | ${spread(group.map(r => r.userTurns))} | ${spread(group.map(r => r.assistantQuestions))} | ${spread(group.map(r => r.repeatedKnownFactQuestions))} | ${spread(group.map(r => r.manualEdits))} | ${spread(group.map(r => r.rescues))} | ${spread(group.map(r => r.appFilledFields))} | ${spread(group.map(r => r.calls))} | ${spread(group.map(r => r.tokens))} | ${spread(group.map(r => seconds(r.wallMs)))} | ${stat.masterReached}/${stat.masterRuns} | ${stat.packetReached}/${stat.runs} | ${stat.passed}/${stat.runs} |`;
  }) : [];
  return [`### ${title}`, '', header, '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...lines, ...(aggregateLines.length ? ['', '| group (runs) | mode | turns | questions | repeat Q | manual | rescues | app-filled | calls | tokens | wall s | master | packet | pass |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...aggregateLines] : []), ''].join('\n');
}

const loaded = [];
for (const directory of directories) {
  try { loaded.push(await loadDirectory(path.resolve(directory))); }
  catch (error) { console.error(`Skipped ${directory}: ${error.message}`); }
}
if (!loaded.length) { console.error('No evidence directories could be read.'); process.exit(1); }
const allRows = loaded.flatMap(item => item.rows.map(row => row.metrics));

if (json) {
  console.log(JSON.stringify({
    directories: loaded.map(item => ({ directory: item.directory, date: item.report.date, provider: item.report.provider, live: item.report.live, tier: item.report.evidenceTier, runs: item.rows.length })),
    runs: allRows,
    aggregate: Object.fromEntries([...groupBy(allRows, row => row.mode)].map(([mode, rows]) => [mode, aggregate(rows)])),
    byDirectory: Object.fromEntries(loaded.map(item => [item.directory, aggregate(item.rows.map(row => row.metrics))])),
    stageTiming: 'Live evidence records whole-scenario duration and usage only. masterStage/packetStage carry exact reach markers; their wallMs/calls/tokens are null. onboarding-proof.mjs measures exact stage times on a controlled install.',
  }, null, 2));
  process.exit(0);
}

const conversationRows = allRows.filter(row => row.mode === 'conversation');
const journeyRows = allRows.filter(row => row.family === 'journey');
const lines = [
  '# Onboarding report',
  '',
  `Evidence: ${loaded.length} directories, ${allRows.length} scenario runs (${allRows.filter(row => row.passed).length} passed).`,
  '',
  ...loaded.map(item => `- ${item.directory} — ${item.report.provider || 'controlled'}${item.report.live ? ' (live)' : ''}, ${item.report.date || 'no date'}, ${item.rows.length} runs`),
  '',
  'Stage timing note: the runner records one duration and one usage total per scenario, not per-stage timestamps. `master` and `packet` below are exact reach markers; wall/calls/tokens are whole-run figures. `masterStage`/`packetStage` in `--json` carry the lower/upper bounds the evidence supports. Exact stage times come from `scripts/onboarding-proof.mjs`.',
  '',
  table(conversationRows, { title: 'Conversation-built runs (mode = conversation)' }),
  table(journeyRows, { title: 'Journey runs (first conversation to prepared packet or submission)' }),
  table(allRows, { title: 'All runs' }),
];
console.log(lines.join('\n'));
