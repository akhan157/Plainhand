import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ApplicationBrowser } from './plainhand/jobs.mjs';
import { navigationSnapshot, executeNavigation } from './plainhand/browser-driver.mjs';

const valid = value => { try { return new URL(value).hostname === 'jobs.lever.co'; } catch { return false; } };
async function fixture(html, extra = {}) {
  let page;
  const runtime = new ApplicationBrowser({ ...extra, launch: async options => {
    const browser = await chromium.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options), newPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await newPage();
        await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: typeof html === 'function' ? html(route.request().url()) : html }));
        return page;
      };
      return context;
    };
    return browser;
  } });
  const job = { id: 'driver-test', url: 'https://jobs.lever.co/synthetic/123' };
  await runtime.open(job, true);
  return { runtime, job, get page() { return page; } };
}
const gated = `<h1>Graduate engineer</h1><button type="button" id="start">Start application</button><section id="application" hidden><fieldset class="question"><legend>Full name</legend><input name="name" required></fieldset><input type="password" name="password" hidden><div class="field-entry"><h3>Project experience</h3><div contenteditable="true" aria-labelledby="project-title" id="project"></div><span id="project-title">Describe your project</span></div><form><button>Submit application</button></form></section><script>document.querySelector('#start').onclick=()=>{document.querySelector('#application').hidden=false;document.querySelector('#start').remove()};</script>`;

test('observe/action fallback reveals a gated SPA form; richer extraction resolves labels and excludes passwords', async () => {
  const h = await fixture(gated);
  try {
    assert.equal((await h.runtime.status(h.job.id)).state, 'navigating', 'A gated application remains navigable during status checks.');
    const result = await h.runtime.navigate(h.job, async snapshot => ({ action: 'click', ref: snapshot.controls.find(c => c.label === 'Start application').ref }));
    assert.equal(result.state, 'ready');
    assert.equal(result.trace.length, 1);
    const fields = await h.runtime.inspect(h.job);
    assert.ok(fields.some(f => f.label === 'Full name'));
    assert.ok(fields.some(f => f.label === 'Describe your project'));
    assert.ok(fields.every(f => f.name !== 'password'));
    const project = fields.find(f => f.label === 'Describe your project');
    const resultFill = await h.runtime.fill(h.job, { [fields.find(f => f.name === 'name').key]: 'Fictional candidate', [project.key]: 'I designed and tested the chassis.' });
    assert.equal(resultFill.failed.length, 0);
    assert.equal(resultFill.filled.length, 2);
    assert.equal(await h.page.locator('#project').innerText(), 'I designed and tested the chassis.');
  } finally { await h.runtime.closeAll(); }
});

test('fresh snapshots invalidate old refs, and changed submit labels are refused', async () => {
  const h = await fixture(gated);
  try {
    const first = await navigationSnapshot(h.page, valid), second = await navigationSnapshot(h.page, valid);
    assert.equal((await executeNavigation(h.page, first, { action: 'click', ref: first.controls[0].ref }, valid)).refused, true);
    await h.page.locator('#start').evaluate(el => el.setAttribute('aria-label', 'Submit application'));
    assert.equal((await executeNavigation(h.page, second, { action: 'click', ref: second.controls[0].ref }, valid)).refused, true);
    assert.equal(await h.page.locator('#application').isVisible(), false);
  } finally { await h.runtime.closeAll(); }
});

test('planner cannot navigate to external links, invent refs, type credentials or execute page code', async () => {
  const h = await fixture(gated + '<a href="https://attacker.invalid/apply">Apply now</a>');
  try {
    const snapshot = await navigationSnapshot(h.page, valid);
    assert.ok(snapshot.controls.every(c => c.label !== 'Apply now'));
    for (const action of [{ action: 'click', ref: 'made-up' }, { action: 'type', ref: snapshot.controls[0].ref, text: 'secret' }, { action: 'evaluate', code: 'window.location="https://attacker.invalid"' }]) assert.equal((await executeNavigation(h.page, snapshot, action, valid)).refused, true);
    assert.equal(await h.page.locator('#application').isVisible(), false);
  } finally { await h.runtime.closeAll(); }
});

test('submission interlock blocks a next-looking handler calling requestSubmit; explicit handoff restores human control', async () => {
  const h = await fixture(`<h1>Application</h1><form><label>Full name<input name="name"></label><button type="button" id="next">Next</button><button type="submit">Submit application</button></form><script>window.submitted=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted++};document.querySelector('#next').onclick=()=>document.querySelector('form').requestSubmit();</script>`);
  try {
    await h.runtime.advance(h.job);
    assert.equal(await h.page.evaluate(() => window.submitted), 0);
    await h.runtime.handoff(h.job.id);
    // An explicit simulated human click on the local fixture only.
    await h.page.getByRole('button', { name: 'Submit application', exact: true }).click();
    assert.equal(await h.page.evaluate(() => window.submitted), 1);
  } finally { await h.runtime.closeAll(); }
});

test('fill readback detects a custom handler discarding the proposed answer', async () => {
  const h = await fixture('<h1>Application</h1><label>Email<input name="email" oninput="this.value=\'\'"></label>');
  try {
    const fields = await h.runtime.inspect(h.job);
    const result = await h.runtime.fill(h.job, { [fields[0].key]: 'candidate@example.invalid' });
    assert.equal(result.filled.length, 0); assert.equal(result.failed.length, 1);
  } finally { await h.runtime.closeAll(); }
});

test('unchanging pages stop the drive loop rather than repeatedly clicking or spending quota', async () => {
  const h = await fixture('<h1>Graduate engineer</h1><button type="button">Start application</button>');
  let calls = 0;
  try {
    const result = await h.runtime.navigate(h.job, async snapshot => { calls++; return { action: 'click', ref: snapshot.controls[0].ref }; });
    assert.equal(result.state, 'paused'); assert.equal(calls, 1);
  } finally { await h.runtime.closeAll(); }
});


test('hidden uploads on inactive steps are excluded, but active hidden resume inputs can receive the approved file', async () => {
  const h = await fixture('<h1>Application</h1><button type="button" id="start">Start application</button><form hidden><label>Email<input name="email"></label><input type="file" hidden aria-label="Resume"></form><script>document.querySelector("#start").onclick=()=>{document.querySelector("form").hidden=false;document.querySelector("#start").remove()};</script>');
  const directory = await mkdtemp(path.join(tmpdir(), 'plainhand-hidden-upload-'));
  try {
    assert.equal((await h.runtime.inspect(h.job)).length, 0);
    assert.equal((await h.runtime.navigate(h.job, async snapshot => ({ action: 'click', ref: snapshot.controls[0].ref }))).state, 'ready');
    const fields = await h.runtime.inspect(h.job);
    const upload = fields.find(f => f.type === 'file');
    assert.ok(upload);
    const pdf = path.join(directory, 'approved.pdf'); await writeFile(pdf, '%PDF-1.4 synthetic local test');
    const result = await h.runtime.fill(h.job, { [upload.key]: '__resume__' }, pdf);
    assert.equal(result.failed.length, 0);
    assert.equal(await h.page.locator('input[type=file]').evaluate(el => el.files[0].name), 'approved.pdf');
  } finally { await h.runtime.closeAll(); await rm(directory, { recursive: true, force: true }); }
});

test('agent navigation and extraction use the supported embedded frame rather than unrelated main-page controls', async () => {
  const h = await fixture(url => new URL(url).pathname === '/embedded' ? '<button type="button" id="start">Start application</button><label hidden id="entry">Email<input name="email"></label><script>document.querySelector("#start").onclick=()=>{document.querySelector("#entry").hidden=false;document.querySelector("#start").remove()};</script>' : '<h1>Graduate Engineer</h1><a href="https://unrelated.invalid">Unrelated</a><iframe src="https://jobs.lever.co/embedded"></iframe>');
  try {
    const result = await h.runtime.navigate(h.job, async snapshot => ({ action: 'click', ref: snapshot.controls.find(c => c.label === 'Start application').ref }));
    assert.equal(result.state, 'ready');
    const fields = await h.runtime.inspect(h.job);
    assert.equal(fields[0].frameIndex, 1);
    await h.runtime.fill(h.job, { [fields[0].key]: 'candidate@example.invalid' });
    assert.equal(await h.page.frames()[1].locator('input').inputValue(), 'candidate@example.invalid');
  } finally { await h.runtime.closeAll(); }
});
