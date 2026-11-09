#!/usr/bin/env node
// What benchmarks exist, what the latest local run measured, and whether a
// benchmark needs a live provider. Reads output/ only; runs nothing.
//
//   node benchmarks/benchmark-status.mjs [--json]
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'output');

const BENCHMARKS = [
  {
    id: 'eval',
    name: 'End-to-end evaluation',
    command: 'npm run benchmark:eval',
    prefixes: ['evaluation-'],
    live: 'add --provider claude|codex',
    what: 'Profile conversation, resume packet, portal fill and candidate-confirmed submission to an owned sandbox, scored against fictional ground truth.',
    docs: 'docs/internal/EVALUATION-HARNESS.md',
  },
  {
    id: 'architecture',
    name: 'Application workflow architectures',
    command: 'npm run benchmark:architecture',
    prefixes: ['architecture-controlled-', 'architecture-live-'],
    live: 'add --live --provider claude|codex',
    what: 'Correct outcomes, false-ready results and model calls across six to eight designs on 17 controlled cases. Controlled runs use a deterministic agent.',
    docs: 'docs/internal/IMPLEMENTATION-BENCHMARK-RESULTS.md',
  },
  {
    id: 'simulation',
    name: 'Simulated application corpus',
    command: 'npm run benchmark:simulation',
    prefixes: ['simulation-'],
    live: null,
    what: 'Completion, interruptions, recovery and duration on fictional portals with the production browser path.',
    docs: null,
  },
  {
    id: 'invariants',
    name: 'Workflow invariants',
    command: 'npm run benchmark:invariants',
    prefixes: ['architecture-invariants-'],
    live: null,
    what: 'Workspace locking, versioned answer memory, duplicate claims and stale commits.',
    docs: null,
  },
  {
    id: 'profile',
    name: 'Profile building by conversation',
    command: 'npm run benchmark:profile',
    prefixes: ['profile-benchmark-'],
    live: 'add --provider claude',
    what: 'Facts captured verbatim, unsupported updates, one-question turns and provider usage.',
    docs: 'docs/METRICS-INVENTORY.md#5-profile-building-benchmark',
  },
  {
    id: 'calibration',
    name: 'Claim calibration',
    command: 'npm run benchmark:calibration',
    prefixes: ['calibration-benchmark-'],
    live: 'add --provider claude',
    what: 'Undersold, balanced, stretched and unsupported claims; the rules alone, then the reviewer model and their combination.',
    docs: 'docs/METRICS-INVENTORY.md#6-claim-calibration-benchmark',
  },
  {
    id: 'review',
    name: 'Packet review probes',
    command: 'npm run benchmark:review -- --provider claude',
    prefixes: ['architecture-review-'],
    live: 'requires --provider',
    what: 'Whether the factual reviewer catches planted false claims and passes a supported one.',
    docs: null,
  },
  {
    id: 'real-sites',
    name: 'Real employer sites (inspection only)',
    command: 'node benchmarks/benchmark-real-sites.mjs',
    prefixes: ['real-sites-'],
    live: null,
    what: 'Reads current public Greenhouse, Lever, Ashby and Workday pages and reports what would be filled or flagged. Nothing is filled, uploaded or submitted.',
    docs: null,
  },
];

async function latestDirectory(prefix) {
  if (!existsSync(OUTPUT)) return null;
  const entries = await readdir(OUTPUT, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const info = await stat(path.join(OUTPUT, entry.name));
    matches.push({ name: entry.name, path: path.join(OUTPUT, entry.name), at: info.mtime });
  }
  matches.sort((a, b) => b.at - a.at);
  return matches[0] || null;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function summarize(id, directory) {
  if (!directory) return null;
  const report = await readJson(path.join(directory.path, 'report.json'));
  if (id === 'eval') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    if (results?.summary) {
      const s = results.summary;
      return {
        result: `${s.passed}/${s.scenarios} passed · resume ${s.resume?.factCoverage ?? 'n/a'} · form ${s.application?.completionRate ?? 'n/a'} · submissions ${s.application?.submissionsAccepted ?? 0}/${s.application?.submissionsExpected ?? 0}${results.live ? ` · ${results.provider}` : ' · controlled'}`,
        at: results.date || directory.at.toISOString(),
      };
    }
  }
  if (id === 'simulation' && report) {
    return {
      result: `${report.passed}/${report.total} passed · ${report.falseReady} false-ready · ${report.automatedSubmissions} submissions`,
      at: report.generatedAt || directory.at.toISOString(),
    };
  }
  if (id === 'architecture') {
    const summary = await readJson(path.join(directory.path, 'summary.json'));
    if (summary?.summaries) {
      const runs = summary.summaries.reduce((n, s) => n + s.runs, 0);
      const correct = summary.summaries.reduce((n, s) => n + s.correctOutcomes, 0);
      const falseReady = summary.summaries.reduce((n, s) => n + s.falseReady, 0);
      const tokens = summary.summaries.reduce((n, s) => n + (s.inputTokensReported || 0), 0);
      return {
        result: `${correct}/${runs} correct · ${falseReady} false-ready · ${summary.live ? 'live model' : 'controlled agent'}${tokens ? ` · ${tokens.toLocaleString()} reported input tokens` : ''}`,
        at: directory.at.toISOString(),
      };
    }
  }
  if (id === 'invariants') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    if (results?.results) return { result: `${results.results.filter(r => r.passed).length}/${results.results.length} invariants passed`, at: directory.at.toISOString() };
  }
  if (id === 'profile') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    if (results?.aggregate) {
      const a = results.aggregate;
      return {
        result: `${results.provider === 'fixture' ? 'scripted fixture' : results.provider}: capture ${a.captureRate ?? 'n/a'} · unsupported ${a.unsupportedUpdates} · one-question ${a.oneQuestionShare ?? 'n/a'}`,
        at: results.date || directory.at.toISOString(),
      };
    }
  }
  if (id === 'calibration') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    if (results?.rules) {
      const model = results.model ? ` · model ${results.model.exact}/${results.model.graded}` : '';
      return { result: `${results.provider === 'rules-only' ? 'rules only' : results.provider}: exact ${results.rules.exact}/${results.rules.graded}${model}`, at: results.date || directory.at.toISOString() };
    }
  }
  if (id === 'review') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    if (results) {
      const text = JSON.stringify(results);
      const passed = (text.match(/"passed":true/g) || []).length;
      const failed = (text.match(/"passed":false/g) || []).length;
      return { result: `${passed} passed · ${failed} failed probe${failed === 1 ? '' : 's'}`, at: directory.at.toISOString() };
    }
  }
  if (id === 'real-sites') {
    const results = await readJson(path.join(directory.path, 'results.json'));
    const rows = Array.isArray(results) ? results : results?.results;
    if (rows) {
      const opened = rows.filter(row => row.opened !== false).length;
      const fields = rows.reduce((n, row) => n + (row.fields || 0), 0);
      const filled = rows.reduce((n, row) => n + (row.filled || 0), 0);
      return { result: `${opened}/${rows.length} portals opened · ${fields} fields read · ${filled} fillable without a model`, at: results.date || directory.at.toISOString() };
    }
  }
  return { result: 'evidence present; inspect the directory', at: directory.at.toISOString() };
}

const rows = [];
for (const benchmark of BENCHMARKS) {
  let latest = null;
  for (const prefix of benchmark.prefixes) {
    const candidate = await latestDirectory(prefix);
    if (candidate && (!latest || candidate.at > latest.at)) latest = candidate;
  }
  rows.push({ ...benchmark, latest: await summarize(benchmark.id, latest), directory: latest?.name || null });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), benchmarks: rows }, null, 2));
} else {
  console.log(`Benchmark status (${new Date().toISOString()})`);
  console.log('Local evidence is in output/. Documented results may come from another machine or an earlier version.\n');
  for (const row of rows) {
    const live = row.live ? `live option: ${row.live}` : 'no live model calls';
    console.log(`${row.name}`);
    console.log(`  run:      ${row.command}`);
    console.log(`  measures: ${row.what}`);
    console.log(`  live:     ${live}`);
    console.log(`  latest:   ${row.latest ? `${row.latest.result} (${row.latest.at.slice(0, 10)}, ${row.directory})` : 'no local run found'}`);
    if (row.docs) console.log(`  docs:     ${row.docs}`);
    console.log('');
  }
  console.log('Not measured by any of these: real employer acceptance, a real candidate’s voice, or whether a score agrees with a careful human read. Those need the candidate’s own accounts and a real application (see docs/VERIFICATION-MATRIX.md).');
}
