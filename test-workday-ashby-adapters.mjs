#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import ashbyAdapter from './portal-adapters/ashby.mjs';
import workdayAdapter from './portal-adapters/workday.mjs';

const tempDir = mkdtempSync(join(tmpdir(), 'career-ops-portal-adapter-'));
const resumePath = join(tempDir, 'exact-resume.pdf');
writeFileSync(resumePath, '%PDF-1.4 fixture');
const browser = await chromium.launch({ headless: true });

const fixture = ({ final = '', auth = '', extra = '' } = {}) => `<!doctype html>
  <main><p>Step 1 of 2</p>${auth}
    <label for="name">Full name</label><input id="name" name="fullName" required>
    <label for="email">Email address</label><input id="email" type="email" required>
    <label for="status">Country</label><select id="status" role="combobox"><option>United States</option></select>
    <label for="resume">Resume / CV</label><input id="resume" type="file">
    ${extra}
    <button type="button" id="save">Save draft</button>
    <button type="button" id="continue">Continue</button>${final}
  </main>`;

try {
  const page = await browser.newPage();
  await page.setContent(fixture());
  const context = { page, url: 'https://acme.myworkdayjobs.com/en-US/jobs/123', values: {
    fullName: 'Test Candidate', email: 'candidate@example.test', country: 'United States',
  }, resumePath };
  assert.equal(workdayAdapter.matches(context), true);
  assert.equal(ashbyAdapter.matches({ url: 'https://jobs.ashbyhq.com/acme/123' }), true);
  assert.equal(await workdayAdapter.inspect(context).then((result) => result.step), 'Step 1 of 2');
  const filled = await workdayAdapter.fill(context);
  assert.equal(filled.ok, true);
  assert.equal(await page.locator('#name').inputValue(), 'Test Candidate');
  assert.equal(await page.locator('#resume').evaluate((input) => input.files[0].name), 'exact-resume.pdf');
  assert.equal((await workdayAdapter.saveDraft(context)).saved, true);
  assert.equal((await workdayAdapter.continue(context)).status, 'review_ready');

  await page.setContent(fixture({ final: '<button type="submit">Submit application</button>' }));
  const finalBlocked = await ashbyAdapter.fill({
    page, url: 'https://jobs.ashbyhq.com/acme/123', values: { fullName: 'Candidate' }, resumePath,
  });
  assert.equal(finalBlocked.ok, false);
  assert.match(finalBlocked.blockers.join(' '), /Final-submit control/);
  assert.equal(await page.locator('#name').inputValue(), '');

  await page.setContent(fixture({ auth: '<p>Enter your one-time passcode to continue.</p>' }));
  const authBlocked = await workdayAdapter.inspect({ page, url: 'https://acme.myworkdayjobs.com/en-US/jobs/123' });
  assert.equal(authBlocked.ok, false);
  assert.match(authBlocked.blockers.join(' '), /OTP/);

  await page.setContent(fixture({ extra: '<button type="button">Save application</button>' }));
  const ambiguousSave = await ashbyAdapter.saveDraft({ page, url: 'https://jobs.ashbyhq.com/acme/123' });
  assert.equal(ambiguousSave.ok, false);
  assert.match(ambiguousSave.blockers.join(' '), /Ambiguous/);

  console.log('portal adapter fixtures: passed');
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
