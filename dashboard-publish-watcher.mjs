#!/usr/bin/env node
// Debounced dashboard publish trigger.
//
// Hashes everything the dashboard payload is built from; if the hash differs
// from the last successful publish, runs the auto-publish and records the new
// hash. Designed to run on a schedule (Windows scheduled task, every 15 min)
// so a publish happens no matter which agent or editor changed the data —
// Claude Code, Codex, Antigravity, or a manual edit.
//
// State marker: .dashboard-last-publish.json (gitignored).
// Manual run:   node dashboard-publish-watcher.mjs [--force] [--dry-run]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoPublishDashboard } from './dashboard-auto-publish.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARKER = join(ROOT, '.dashboard-last-publish.json');

// Files whose CONTENT feeds the dashboard payload — including the builder
// code itself, so a toolchain change also triggers a republish.
const CONTENT_INPUTS = [
  'data/applications.md',
  'data/pipeline.md',
  'data/follow-ups.md',
  'templates/states.yml',
  'dashboard-auth-middleware.js',
  'build-dashboard-static.mjs',
  'dashboard-data.mjs',
  'publish-dashboard.ps1',
];

// Directories where a file list + mtime change means the payload changes.
// (output/ is indexed for artifact links; dashboard-web/ is the UI itself.)
const DIR_INPUTS = ['output', 'reports', 'dashboard-web', 'fonts'];

function computeStateHash() {
  const hash = createHash('sha256');

  for (const rel of CONTENT_INPUTS) {
    const file = join(ROOT, rel);
    hash.update(rel);
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('<missing>');
    }
  }

  for (const rel of DIR_INPUTS) {
    const dir = join(ROOT, rel);
    hash.update(rel);
    if (!existsSync(dir)) {
      hash.update('<missing>');
      continue;
    }
    for (const name of readdirSync(dir, { recursive: true }).sort()) {
      try {
        const st = statSync(join(dir, String(name)));
        if (st.isFile()) {
          hash.update(`${name}:${st.size}:${st.mtimeMs}`);
        }
      } catch {
        // file vanished mid-scan — ignore, next run picks it up
      }
    }
  }

  return hash.digest('hex');
}

function readMarker() {
  try {
    return JSON.parse(readFileSync(MARKER, 'utf8'));
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const unknown = args.filter((a) => !['--force', '--dry-run'].includes(a));
if (unknown.length > 0) {
  console.error(`Unknown arg(s): ${unknown.join(', ')}`);
  console.error('Usage: node dashboard-publish-watcher.mjs [--force] [--dry-run]');
  process.exit(2);
}

// Single-flight lock: a publish takes 1-2 minutes; the scheduled task fires
// every 15. Without this, a manual run + scheduled run can deploy different
// snapshots concurrently and the OLDER one may win production.
const LOCK = join(ROOT, '.dashboard-publish.lock');
const LOCK_STALE_MS = 30 * 60 * 1000;
try {
  const lockStat = statSync(LOCK);
  if (Date.now() - lockStat.mtimeMs < LOCK_STALE_MS) {
    console.log('ℹ️  Another publish is in progress — skipping this run');
    process.exit(0);
  }
  // stale lock from a crashed run — take over
} catch {
  // no lock — proceed
}
writeFileSync(LOCK, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
process.on('exit', () => {
  try { rmSync(LOCK, { force: true }); } catch { /* best effort */ }
});

const currentHash = computeStateHash();
const marker = readMarker();

if (!force && marker?.hash === currentHash) {
  console.log('ℹ️  Dashboard up to date — nothing to publish');
  process.exit(0);
}

const reason = force
  ? 'forced publish'
  : marker
    ? 'data changed since last publish'
    : 'no publish marker found (first run)';

if (dryRun) {
  console.log(`ℹ️  Would publish: ${reason}`);
  process.exit(0);
}

const ok = await autoPublishDashboard({ reason });

if (ok) {
  writeFileSync(
    MARKER,
    `${JSON.stringify({ hash: currentHash, publishedAt: new Date().toISOString(), reason }, null, 2)}\n`,
    'utf8',
  );
  console.log('✅ Publish marker updated');
} else {
  // Marker NOT updated → hash still differs → next scheduled run retries.
  console.warn('⚠️  Publish did not complete; will retry on next run');
  process.exit(1);
}
