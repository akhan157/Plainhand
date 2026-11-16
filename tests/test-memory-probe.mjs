// The M6 probe runs as a separate process on a temp root, with no live model and no
// browser. This test keeps it in the suite: a probe that stops proving one of its
// falsifiers fails the suite, not only a manual run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUN = promisify(execFile);

test('the durable-memory probe passes every falsifier', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plainhand-probe-report-'));
  const out = path.join(dir, 'memory-probe.json');
  let failure = null;
  try {
    await RUN(process.execPath, [path.join(ROOT, 'scripts/memory-probe.mjs'), '--out', out], { cwd: ROOT, timeout: 120000 });
  } catch (error) {
    failure = error;
  }
  let report;
  try {
    report = JSON.parse(await readFile(out, 'utf8'));
  } catch {
    report = { ok: false, failures: ['the probe wrote no report'], checks: [] };
  }
  await rm(dir, { recursive: true, force: true });
  assert.equal(report.ok, true, [failure?.stdout, failure?.stderr].filter(Boolean).join('\n'));
  assert.ok(Array.isArray(report.checks) && report.checks.length >= 30, `expected a substantive probe, got ${report.checks?.length || 0} checks`);
  assert.deepEqual(report.checks.filter(check => !check.ok), []);
  assert.deepEqual(report.failures, []);
});
