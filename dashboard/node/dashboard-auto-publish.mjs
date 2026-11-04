#!/usr/bin/env node
// Cross-platform dashboard publishing. The old wrapper called PowerShell and
// a globally installed `vercel` binary; this one runs the same Node publisher
// used by Plainhand's Workspace screen, so Windows, macOS and Linux behave
// the same and account connection happens through `vercel login`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../../plainhand/store.mjs';
import { publishDashboard } from '../../plainhand/remote.mjs';

const ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function autoPublishDashboard({
  reason = 'dashboard data updated',
  changedPaths = [],
  dryRun = false,
  strict = false,
  root = ROOT,
} = {}) {
  if (dryRun) {
    console.log('Dashboard publish skipped (dry-run).');
    return false;
  }

  if (!isEnabled()) {
    console.log('Dashboard publish skipped (PLAINHAND_AUTO_PUBLISH=0).');
    return false;
  }

  const suffix = changedPaths.length > 0 ? ` [${changedPaths.join(', ')}]` : '';
  console.log(`Publishing dashboard: ${reason}${suffix}`);

  try {
    const published = await publishDashboard(new Workspace(root), { reason, log: console.log });
    console.log(`Published ${published.url} (${published.apps} applications).`);
    return true;
  } catch (error) {
    if (strict) throw new Error(`Dashboard publish failed: ${error.message}`);
    console.warn(`Dashboard publish failed: ${error.message}`);
    return false;
  }
}

export function shouldPublishForReport(reportPath) {
  const relative = toRelativeProjectPath(reportPath);
  if (!relative || !relative.startsWith('reports/')) return false;
  const reportLink = relative.replace(/\\/g, '/');
  const appsContent = safeRead(path.join(ROOT, 'data', 'applications.md'));
  if (appsContent.includes(`](${reportLink})`)) return true;
  const additionsDir = path.join(ROOT, 'batch', 'tracker-additions');
  if (!existsSync(additionsDir)) return false;
  for (const file of readdirSync(additionsDir)) {
    if (!file.endsWith('.tsv')) continue;
    const content = safeRead(path.join(additionsDir, file));
    if (content.includes(`](${reportLink})`) || content.includes(reportLink)) return true;
  }
  return false;
}

export function shouldPublishForOutput(outputPath) {
  const relative = toRelativeProjectPath(outputPath);
  return Boolean(relative && relative.startsWith('output/'));
}

function isEnabled() {
  const raw = String(process.env.PLAINHAND_AUTO_PUBLISH ?? process.env.CAREER_OPS_AUTO_PUBLISH ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function toRelativeProjectPath(targetPath) {
  if (!targetPath) return null;
  const absolute = path.resolve(ROOT, targetPath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

function safeRead(filePath) {
  try { return readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function parseArgs(argv) {
  const out = { reason: 'manual dashboard publish', changedPaths: [], strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reason' && argv[i + 1]) { out.reason = argv[i + 1]; i += 1; continue; }
    if (arg === '--changed' && argv[i + 1]) { out.changedPaths.push(argv[i + 1]); i += 1; continue; }
    if (arg === '--root' && argv[i + 1]) { out.root = path.resolve(argv[i + 1]); i += 1; continue; }
    if (arg === '--strict') { out.strict = true; continue; }
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    console.error(`Unknown arg: ${arg}`);
    console.error('Usage: node dashboard/node/dashboard-auto-publish.mjs [--reason <text>] [--changed <path>]... [--root <dir>] [--strict] [--dry-run]');
    process.exit(2);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  const ok = await autoPublishDashboard(args);
  if (!ok && args.strict) process.exitCode = 1;
}
