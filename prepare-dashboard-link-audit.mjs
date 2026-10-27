#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildDashboardPayload } from './dashboard-data.mjs';

const STATUS_PRIORITY = new Map([
  ['apply', 0],
  ['applied', 1],
  ['interview', 2],
  ['responded', 3],
  ['evaluated', 4],
  ['offer', 5],
  ['rejected', 6],
  ['discarded', 7],
  ['skip', 8],
]);

const DEFAULT_STATUSES = ['apply', 'applied', 'interview', 'responded', 'evaluated'];

const args = parseArgs(process.argv.slice(2));
const rootPath = path.resolve(args.path || process.cwd());
const outDir = path.resolve(args.out || path.join(rootPath, 'tmp', 'link-audit'));
const agentCount = clampPositiveInt(args.agents, 3);
const statuses = normalizeStatuses(args.statuses);

const payload = await buildDashboardPayload({ rootPath, linkMode: 'local' });
const rows = selectRows(payload.apps, statuses);
const batches = partitionRows(rows, agentCount);

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    rootPath,
    trackerPath: path.join(rootPath, 'data', 'applications.md'),
  },
  filters: {
    statuses,
    totalApps: payload.apps.length,
    selectedRows: rows.length,
    agents: agentCount,
  },
  batches: [],
};

for (let index = 0; index < batches.length; index += 1) {
  const batchRows = batches[index];
  const batchNumber = String(index + 1).padStart(2, '0');
  const batchName = `batch-${batchNumber}`;
  const batchPath = path.join(outDir, `${batchName}.json`);
  const promptPath = path.join(outDir, `${batchName}.prompt.md`);
  const urlsPath = path.join(outDir, `${batchName}.urls.txt`);

  await fs.writeFile(batchPath, `${JSON.stringify(batchRows, null, 2)}\n`, 'utf8');
  await fs.writeFile(promptPath, buildWorkerPrompt(batchName, batchRows), 'utf8');
  await fs.writeFile(urlsPath, `${batchRows.map((row) => row.url).join('\n')}\n`, 'utf8');

  manifest.batches.push({
    batch: batchName,
    path: batchPath,
    promptPath,
    urlsPath,
    count: batchRows.length,
    statuses: summarizeStatuses(batchRows),
    ids: batchRows.map((row) => row.id),
  });
}

await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Prepared ${rows.length} dashboard link(s) across ${batches.length} batch(es) in ${outDir}`);
for (const batch of manifest.batches) {
  console.log(`${batch.batch}: ${batch.count} row(s)`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function normalizeStatuses(rawValue) {
  if (!rawValue || rawValue === 'default') {
    return [...DEFAULT_STATUSES];
  }
  if (rawValue === 'all') {
    return null;
  }
  return String(rawValue)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function selectRows(apps, statuses) {
  return apps
    .filter((app) => app.reportSummary?.url)
    .filter((app) => !statuses || statuses.includes(app.statusId))
    .sort(compareRows)
    .map((app) => ({
      id: app.id,
      company: app.company,
      role: app.role,
      statusId: app.statusId,
      status: app.status,
      score: app.score,
      date: app.date,
      url: app.reportSummary.url,
      reportPath: app.reportPath,
      notes: app.notes,
      verdict: app.reportSummary.verdict || '',
      tldr: app.reportSummary.tldr || '',
    }));
}

function compareRows(a, b) {
  const aRank = STATUS_PRIORITY.get(a.statusId) ?? 99;
  const bRank = STATUS_PRIORITY.get(b.statusId) ?? 99;
  if (aRank !== bRank) return aRank - bRank;
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  return b.id - a.id;
}

function partitionRows(rows, agentCount) {
  const batches = Array.from({ length: agentCount }, () => []);
  rows.forEach((row, index) => {
    batches[index % agentCount].push(row);
  });
  return batches.filter((batch) => batch.length > 0);
}

function summarizeStatuses(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.statusId] = (counts[row.statusId] || 0) + 1;
  }
  return counts;
}

function clampPositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function buildWorkerPrompt(batchName, rows) {
  return `# ${batchName}

Scope: ${rows.length} dashboard links

Process:
1. Run \`node run-dashboard-link-audit-batch.mjs --batch tmp/link-audit/${batchName}.json --out tmp/link-audit/${batchName}.results.json --mode http\`
2. Review the JSON output.
3. For any rows with \`result=uncertain\` and status in \`Apply/Applied/Interview/Responded\`, rerun that single row with browser mode:
   \`node run-dashboard-link-audit-batch.mjs --batch <single-row-json> --out <single-row-results.json> --mode browser\`
4. Report:
   - definite_dead: ids where the posting is clearly expired/gone/invalid
   - keep: ids where apply controls or a clearly live page were found
   - escalate: ids still uncertain and why

Rules:
- Do not edit tracker files.
- Do not mark a row dead on uncertainty alone.
- Treat anti-bot / login / timeout / access-blocked states as escalation, not dead.
`;
}

function printHelp() {
  console.log('Usage: node prepare-dashboard-link-audit.mjs [--path <career-ops-dir>] [--out <dir>] [--agents <n>] [--statuses default|all|comma,list>]');
}
