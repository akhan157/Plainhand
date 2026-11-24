// E2E swarm #14: `npm run resume:tailor` must explain missing inputs instead of dumping a
// stack, and must count PDF pages without a Windows-only Python launcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { countPdfPages } from '../lib/resume-tailoring-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('the page count is read in JavaScript, with no py or pypdf', async () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'resume-tailoring-lib.mjs'), 'utf8');
  assert.doesNotMatch(source, /execFileSync\(\s*'py'/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<p>one</p><p style="page-break-before:always">two</p><p style="page-break-before:always">three</p>');
    assert.equal(countPdfPages(await page.pdf({ format: 'Letter' })), 3);
    await page.setContent('<p>one</p>');
    assert.equal(countPdfPages(await page.pdf({ format: 'Letter' })), 1);
  } finally { await browser.close(); }
});

test('missing resume inputs give a plain message, not a stack trace', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'lib', 'tailor-resume.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (result.status === 0) return; // this checkout has real resume inputs; nothing to check
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /at .*\.mjs:\d+/, 'no stack trace');
  assert.match(result.stderr, /Resume build failed: .*(missing|exceeds|resume)/);
});
