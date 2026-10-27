import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runChecks } from './plainhand-setup.mjs';

async function fakeRoot({ deps = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-setup-'));
  if (deps) for (const name of ['playwright', 'js-yaml']) await mkdir(path.join(root, 'node_modules', name), { recursive: true });
  return root;
}
const level = (results, prefix) => results.find(r => r.label.startsWith(prefix))?.level;

test('a complete machine is ready, and optional extras only warn', async () => {
  const root = await fakeRoot();
  const browser = path.join(root, 'chrome'); await writeFile(browser, '');
  try {
    const results = await runChecks({ root, nodeVersion: '22.4.0', has: command => command === 'claude', chromium: { executablePath: () => browser } });
    assert.ok(results.every(r => r.level !== 'fail'), JSON.stringify(results));
    assert.equal(level(results, 'PDF resume import'), 'warn', 'pdftotext is optional');
    assert.match(results.find(r => r.label.startsWith('AI account')).label, /Claude/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing requirements fail with the exact fix to run', async () => {
  const root = await fakeRoot({ deps: false });
  try {
    const results = await runChecks({ root, nodeVersion: '20.11.0', has: () => false });
    assert.equal(level(results, 'Node.js'), 'fail');
    assert.match(results.find(r => r.label.startsWith('Node.js')).fix, /Node\.js 22/);
    assert.equal(results.find(r => r.label === 'Dependencies missing').fix, 'npm ci');
    assert.equal(results.find(r => r.label === 'Chromium not installed').fix, 'npx playwright install chromium');
    assert.equal(level(results, 'No AI account CLI'), 'warn', 'Plainhand starts without an AI CLI; Connections explains the next step');
  } finally { await rm(root, { recursive: true, force: true }); }
});
