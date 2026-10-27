#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import greenhouse, { isGreenhouseUrl } from './adapters/greenhouse.mjs';
import lever, { isLeverUrl } from './adapters/lever.mjs';

assert.equal(isGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/123'), true);
assert.equal(isGreenhouseUrl('https://job-boards.eu.greenhouse.io/acme/jobs/123'), true);
assert.equal(isGreenhouseUrl('https://example.com/jobs/123'), false);
assert.equal(isLeverUrl('https://jobs.lever.co/acme/123/apply'), true);
assert.equal(isLeverUrl('https://jobs.eu.lever.co/acme/123/apply'), true);
assert.equal(isLeverUrl('https://api.lever.co/v0/postings/acme'), false);
assert.equal(greenhouse.matches({ url: 'https://boards.greenhouse.io/acme/jobs/123' }), true);
assert.equal(lever.matches({ url: 'https://jobs.lever.co/acme/123/apply' }), true);

const tempDir = mkdtempSync(join(tmpdir(), 'career-ops-portal-adapter-'));
const resumePath = join(tempDir, 'tailored-resume.pdf');
writeFileSync(resumePath, '%PDF-1.4 adapter fixture');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <form>
      <label for="given">Given name</label><input id="given" name="first_name" required>
      <label for="email">Email address</label><input id="email" name="email" type="email" required>
      <label for="cv">Resume / CV</label><input id="cv" name="resume" type="file" required>
      <button type="button" id="save" onclick="window.saved = true">Save &amp; Continue</button>
      <button type="button" id="next" onclick="window.next = true">Continue</button>
      <button type="submit" id="submit">Submit application</button>
    </form>`);

  const context = {
    page,
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    profile: { candidate: { first_name: 'Ada', email: 'ada@example.test' } },
    artifacts: { resumePath },
  };
  const inspected = await greenhouse.inspect(context);
  assert.equal(inspected.status, 'ready');
  assert.match(inspected.blockers[0], /final submission control/);

  const filled = await greenhouse.fill(context);
  assert.equal(await page.locator('#given').inputValue(), 'Ada');
  assert.equal(await page.locator('#email').inputValue(), 'ada@example.test');
  assert.equal(await page.locator('#cv').evaluate((input) => input.files[0].name), 'tailored-resume.pdf');
  assert.equal(filled.status, 'filled');
  assert.match(filled.blockers.join(' '), /final submission control/);

  const draft = await greenhouse.saveDraft(context);
  assert.equal(draft.status, 'saved_draft');
  assert.match(draft.blockers.join(' '), /final submission control/);
  assert.equal(await page.evaluate(() => window.saved), true);

  await page.locator('#submit').evaluate((element) => element.remove());

  await page.locator('#save').evaluate((element) => element.remove());
  const continued = await greenhouse.continue({ ...context, url: 'https://jobs.lever.co/acme/123/apply' });
  assert.equal(continued.status, 'ready');
  assert.equal(await page.evaluate(() => window.next), true);

  console.log('portal adapter contract: passed');
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
