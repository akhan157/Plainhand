#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLISH_SCRIPT = join(ROOT, 'publish-dashboard.ps1');

export async function autoPublishDashboard({
  reason = 'career-ops data updated',
  changedPaths = [],
  dryRun = false,
  strict = false,
} = {}) {
  if (dryRun) {
    console.log('ℹ️  Dashboard auto-publish skipped (dry-run)');
    return false;
  }

  if (!isEnabled()) {
    console.log('ℹ️  Dashboard auto-publish skipped (CAREER_OPS_AUTO_PUBLISH=0)');
    return false;
  }

  if (!existsSync(PUBLISH_SCRIPT)) {
    console.warn('⚠️  Dashboard auto-publish skipped: publish-dashboard.ps1 not found');
    return false;
  }

  const auth = hasDeployAuth();
  if (!auth.ok) {
    console.warn(`⚠️  Dashboard auto-publish skipped: ${auth.message}`);
    return false;
  }

  const suffix = changedPaths.length > 0 ? ` [${changedPaths.join(', ')}]` : '';
  console.log(`🚀 Auto-publishing dashboard: ${reason}${suffix}`);

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PUBLISH_SCRIPT],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    const message = result.error?.message || `publish exited with code ${result.status}`;
    if (strict) {
      throw new Error(`Dashboard auto-publish failed: ${message}`);
    }
    console.warn(`⚠️  Dashboard auto-publish failed: ${message}`);
    return false;
  }

  console.log('✅ Dashboard auto-publish complete');
  return true;
}

export function shouldPublishForReport(reportPath) {
  const relative = toRelativeProjectPath(reportPath);
  if (!relative || !relative.startsWith('reports/')) {
    return false;
  }

  const reportLink = relative.replace(/\\/g, '/');
  const appsContent = safeRead(join(ROOT, 'data', 'applications.md'));
  if (appsContent.includes(`](${reportLink})`)) {
    return true;
  }

  const additionsDir = join(ROOT, 'batch', 'tracker-additions');
  if (!existsSync(additionsDir)) {
    return false;
  }

  for (const file of readdirSync(additionsDir)) {
    if (!file.endsWith('.tsv')) continue;
    const content = safeRead(join(additionsDir, file));
    if (content.includes(`](${reportLink})`) || content.includes(reportLink)) {
      return true;
    }
  }

  return false;
}

export function shouldPublishForOutput(outputPath) {
  const relative = toRelativeProjectPath(outputPath);
  return Boolean(relative && relative.startsWith('output/'));
}

function isEnabled() {
  const raw = String(process.env.CAREER_OPS_AUTO_PUBLISH || '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function hasDeployAuth() {
  if (process.env.VERCEL_TOKEN) {
    return { ok: true };
  }

  const result = spawnSync('vercel', ['whoami'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  if (result.status === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    message: 'no Vercel auth detected (set VERCEL_TOKEN or run `vercel login` on the home machine)',
  };
}

function toRelativeProjectPath(targetPath) {
  if (!targetPath) return null;
  const absolute = path.resolve(ROOT, targetPath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.replace(/\\/g, '/');
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const out = { reason: 'manual dashboard publish', changedPaths: [], strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reason' && argv[i + 1]) {
      out.reason = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--changed' && argv[i + 1]) {
      out.changedPaths.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--strict') {
      out.strict = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    // Unknown flags must fail loudly — silently eating --dry-run here once
    // caused a real production deploy.
    console.error(`Unknown arg: ${arg}`);
    console.error('Usage: node dashboard-auto-publish.mjs [--reason <text>] [--changed <path>]... [--strict] [--dry-run]');
    process.exit(2);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  await autoPublishDashboard(args);
}
