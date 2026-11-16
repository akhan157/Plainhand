#!/usr/bin/env node
// U14 quota accounting. Three modes:
//
//   node scripts/cost-breakdown.mjs --results output/evaluation-codex-.../results.json
//     Calls and Plainhand prompt characters per application path from an evidence run.
//
//   node scripts/cost-breakdown.mjs --ledger <workspace root> [--ledger <root> ...]
//     Call purposes from saved usage records (data/plainhand/usage/*.json).
//
//   node scripts/cost-breakdown.mjs --reproduce [--scenarios id,id] [--keep]
//     Runs the controlled fixture harness, retains each workspace, and prints the
//     per-purpose call sequence for the selected application scenarios.
//
// Nothing here calls a provider: --reproduce uses the deterministic fixture agent.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const option = (argv, name) => { const i = argv.indexOf('--' + name); return i < 0 ? null : argv[i + 1]; };
const has = (argv, name) => argv.includes('--' + name);
const round = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function ledgerRecords(root) {
  const dir = path.join(root, 'data', 'plainhand', 'usage');
  const names = await readdir(dir).catch(() => []);
  const records = [];
  for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const record = await readJson(path.join(dir, name));
    if (record) records.push(record);
  }
  return records;
}

const mean = (total, count) => count ? Math.round(total / count) : null;
const tokenMean = records => {
  const known = records.filter(r => Number.isFinite(r.inputTokens));
  const total = known.reduce((sum, r) => sum + r.inputTokens, 0);
  return { calls: known.length, mean: mean(total, known.length), total: known.length ? total : null };
};

function purposeTable(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.purpose)) groups.set(record.purpose, []);
    groups.get(record.purpose).push(record);
  }
  return [...groups.entries()].map(([purpose, entries]) => {
    const promptChars = entries.reduce((sum, r) => sum + (Number.isFinite(r.promptChars) ? r.promptChars : 0), 0);
    const tokens = tokenMean(entries);
    return {
      purpose,
      calls: entries.length,
      failed: entries.filter(r => r.status === 'failed').length,
      retried: entries.filter(r => r.attempt > 1).length,
      promptChars: entries.some(r => Number.isFinite(r.promptChars)) ? promptChars : null,
      promptCharsPerCall: entries.some(r => Number.isFinite(r.promptChars)) ? mean(promptChars, entries.length) : null,
      inputTokens: tokens.total,
      inputTokensPerCall: tokens.mean,
    };
  }).sort((a, b) => b.calls - a.calls);
}

const table = (headers, rows) => {
  const cells = [headers, ...rows].map(row => row.map(value => String(value ?? '—')));
  const width = cells[0].map((_, i) => Math.max(...cells.map(row => row[i].length)));
  return cells.map(row => row.map((cell, j) => cell.padEnd(width[j])).join('  ')).join('\n');
};

async function fromResults(file) {
  const resolved = file.endsWith('.json') ? file : path.join(file, 'results.json');
  const report = await readJson(resolved);
  if (!report) throw new Error(`No results.json at ${resolved}`);
  const paths = new Map(), scenarios = [];
  for (const result of report.results || []) {
    const usage = result.usage;
    if (!usage) continue;
    const family = result.scenario?.family || 'unknown';
    // Only journey/profile-effect/application/submission run the whole application
    // path. A resume run stops at the master and an evaluation run at the judgment.
    const application = ['journey', 'profile-effect', 'application', 'submission'].includes(family);
    const mode = result.profileMode || (result.scenario?.profileMode === 'conversation' || family === 'journey' ? 'conversation' : result.scenario?.profileMode || 'seeded');
    const group = family === 'profile' ? 'profile conversation'
      : family === 'resume' ? 'master resume'
        : family === 'evaluation' ? 'evaluation only'
          : mode === 'conversation' ? 'conversation-built' : mode === 'minimal' ? 'minimal profile' : 'seeded profile';
    if (!paths.has(group)) paths.set(group, []);
    paths.get(group).push({ result, usage, application });
    scenarios.push({
      id: result.scenario?.id || '?',
      path: group,
      calls: usage.calls ?? 0,
      promptCharsPerCall: usage.promptCharsPerCall ?? null,
      inputTokens: usage.inputTokens ?? null,
      inputTokensPerCall: usage.inputTokens && usage.calls ? round(usage.inputTokens / usage.calls) : null,
      durationMs: result.durationMs ?? null,
    });
  }
  const summary = [...paths.entries()].map(([group, entries]) => {
    const calls = entries.reduce((sum, e) => sum + (e.usage.calls || 0), 0);
    const promptChars = entries.reduce((sum, e) => sum + (e.usage.promptChars || 0), 0);
    const tokens = tokenMean(entries.map(e => ({ inputTokens: e.usage.inputTokens, calls: e.usage.calls })));
    return {
      path: group,
      applications: entries.some(e => e.application) ? entries.filter(e => e.application).length : null,
      scenarios: entries.length,
      calls: entries.length ? round(calls / entries.length) : null,
      callsTotal: calls,
      promptCharsPerCall: entries.length ? round(promptChars / Math.max(calls, 1)) : null,
      inputTokensPerCall: tokens.mean,
      inputTokensReportedCalls: tokens.calls,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { resolved, report, summary, scenarios };
}

async function reproduce(argv) {
  const ids = (option(argv, 'scenarios') || 'profile-effect-fin-seeded,profile-effect-fin-built,journey-sci').split(',').map(v => v.trim()).filter(Boolean);
  const scratch = await mkdtemp(path.join(tmpdir(), 'plainhand-u14-cost-'));
  const evidence = path.join(scratch, 'evidence');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    const { runEvaluation } = await import('../plainhand/evaluation/runner.mjs');
    await runEvaluation(['--scenarios', ids.join(','), '--concurrency', '2', '--retain', '--out', evidence]);
    const roots = (await readdir(scratch, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith('plainhand-eval-'))
      .map(entry => path.join(scratch, entry.name));
    const runs = [];
    for (const root of roots) {
      const records = await ledgerRecords(root);
      if (!records.length) continue;
      const state = await readJson(path.join(root, 'data', 'plainhand', 'workspace.json'));
      const jobs = state?.jobs || [];
      runs.push({
        root,
        job: jobs[0] ? `${jobs[0].company} / ${jobs[0].title}` : 'master resume',
        calls: records.length,
        purposes: purposeTable(records),
      });
    }
    const retained = has(argv, 'keep');
    if (!retained) for (const root of roots) await rm(root, { recursive: true, force: true });
    return { scratch, evidence, runs };
  } finally {
    process.env.TMPDIR = previous;
    if (previous === undefined) delete process.env.TMPDIR;
    if (!has(argv, 'keep')) await rm(evidence, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (has(argv, 'help') || !argv.length) {
    console.log('node scripts/cost-breakdown.mjs --results <results.json|dir>\n       --ledger <workspace root> [--ledger <root> ...]\n       --reproduce [--scenarios id,id] [--keep]');
    return;
  }
  if (has(argv, 'reproduce')) {
    const { runs, evidence, scratch } = await reproduce(argv);
    console.log('# Reproduced call sequence (controlled fixture agent)\n');
    for (const run of runs) {
      console.log(`## ${run.job} — ${run.calls} calls`);
      console.log(table(['purpose', 'calls', 'prompt chars/call', 'input tokens/call'], run.purposes.map(p => [p.purpose, p.calls, p.promptCharsPerCall, p.inputTokensPerCall])));
      console.log('');
    }
    console.log(`evidence: ${evidence}${has(argv, 'keep') ? '' : ' (removed)'}  scratch: ${scratch}`);
    return;
  }
  const results = option(argv, 'results');
  if (results) {
    const { resolved, report, summary, scenarios } = await fromResults(results);
    console.log(`# Calls per application\n\nresults: ${resolved}\nprovider: ${report.provider} (${report.live ? 'live' : 'controlled'}), ${report.date}\n`);
    console.log(table(['path', 'applications', 'calls/app', 'prompt chars/call', 'input tokens/call'], summary.map(s => [s.path, s.applications, s.calls, s.promptCharsPerCall, s.inputTokensPerCall])));
    console.log('\n## Per scenario\n');
    console.log(table(['scenario', 'path', 'calls', 'prompt chars/call', 'input tokens/call'], scenarios.map(s => [s.id, s.path, s.calls, s.promptCharsPerCall, s.inputTokensPerCall])));
  }
  const ledgerArgs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--ledger' && argv[i + 1] && !argv[i + 1].startsWith('--')) ledgerArgs.push(argv[i + 1]);
  if (ledgerArgs.length) {
    const runs = [];
    for (const root of ledgerArgs) {
      const records = await ledgerRecords(root);
      if (records.length) runs.push({ root, records });
    }
    console.log('\n# Call purposes from the usage ledger\n');
    const all = runs.flatMap(run => run.records);
    if (!all.length) console.log('No usage records found.');
    else console.log(table(['purpose', 'calls', 'failed', 'retried', 'prompt chars/call', 'input tokens/call'], purposeTable(all).map(p => [p.purpose, p.calls, p.failed, p.retried, p.promptCharsPerCall, p.inputTokensPerCall])));
    for (const run of runs) {
      console.log(`\n## ${run.root}\n`);
      console.log(table(['purpose', 'calls', 'prompt chars/call'], purposeTable(run.records).map(p => [p.purpose, p.calls, p.promptCharsPerCall])));
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
