import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ApplicationBrowser, defaultFieldAnswers } from './plainhand/jobs.mjs';
import { Workspace } from './plainhand/store.mjs';

async function setup(html, storage) {
  let page, launches = 0;
  const runtime = new ApplicationBrowser({ storage, launch: async options => {
    launches++;
    const browser = await chromium.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await newPage();
        await page.route('https://jobs.lever.co/**', route => route.request().method() === 'GET' ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
        return page;
      };
      return context;
    };
    return browser;
  } });
  const job = { id: 'runtime', url: 'https://jobs.lever.co/synthetic/123' };
  await runtime.open(job, true);
  return { runtime, job, get page() { return page; }, get launches() { return launches; } };
}

test('session cookies survive browser restart; inspection preserves current form edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-session-test-'));
  const storage = new Workspace(root);
  const h = await setup('<h1>Test application</h1><label>Full name<input name="name"></label>', storage);
  try {
    await h.page.context().addCookies([{ name: 'synthetic-session', value: 'not-a-real-secret', url: h.job.url }]);
    await h.page.locator('input').fill('Fictional candidate');
    const fields = await h.runtime.open(h.job, true);
    assert.equal(fields[0].value, 'Fictional candidate');
    assert.equal(h.launches, 1);
    await h.runtime.close(h.job.id);
    assert.equal((await stat(path.join(root, h.runtime.stateFile(h.job)))).mode & 0o777, 0o600);
    await h.runtime.open(h.job, true);
    assert.equal((await h.page.context().cookies()).find(c => c.name === 'synthetic-session').value, 'not-a-real-secret');
    assert.equal(h.launches, 2);
  } finally { await h.runtime.closeAll(); await rm(root, { recursive: true, force: true }); }
});

test('visible challenge pauses filling; resume keeps the same browser and cleared challenge', async () => {
  const h = await setup('<h1>Complete the CAPTCHA</h1><div data-plainhand-challenge>Verification</div><label>Email<input name="email"></label>');
  try {
    assert.equal((await h.runtime.status(h.job.id)).state, 'challenge');
    await assert.rejects(h.runtime.fill(h.job, { '0:0': 'test@example.invalid' }), /verification needs attention/);
    await h.page.locator('[data-plainhand-challenge]').evaluate(e => e.remove());
    await h.page.locator('h1').evaluate(e => e.textContent = 'Test application');
    const fields = await h.runtime.inspect(h.job);
    assert.equal((await h.runtime.status(h.job.id)).state, 'ready');
    await h.runtime.fill(h.job, { [fields[0].key]: 'test@example.invalid' });
    assert.equal(await h.page.locator('input').inputValue(), 'test@example.invalid');
    assert.equal(h.launches, 1);
  } finally { await h.runtime.closeAll(); }
});

test('multi-step automation advances explicit next buttons and stops before submission', async () => {
  const h = await setup(`<h1>Test application</h1><div id="step"><label>Full name<input name="name" required></label><button type="button" id="next">Next</button></div><script>window.submits=0;document.querySelector('#next').onclick=()=>{document.querySelector('#step').innerHTML='<form><label>Email<input name="email" type="email" required></label><button type="submit">Submit application</button></form>';document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}};</script>`);
  try {
    assert.equal((await h.runtime.advance(h.job)).state, 'needs-answers');
    await h.runtime.fill(h.job, { '0:0': 'Fictional Candidate' });
    assert.equal((await h.runtime.advance(h.job)).advanced, true);
    const fields = await h.runtime.inspect(h.job);
    await h.runtime.fill(h.job, { [fields[0].key]: 'test@example.invalid' });
    assert.equal((await h.runtime.advance(h.job)).state, 'review');
    assert.equal(await h.page.evaluate(() => window.submits), 0);
  } finally { await h.runtime.closeAll(); }
});

test('login walls are distinguished from empty forms and default submit buttons are never advanced', async () => {
  const h = await setup('<h1>Portal login</h1><label>Password<input type="password"></label><form><button>Continue</button></form>');
  try {
    assert.equal((await h.runtime.status(h.job.id)).state, 'login');
    assert.equal((await h.runtime.advance(h.job)).advanced, false);
    await h.page.locator('input').evaluate(e => { e.type = 'text'; e.setAttribute('aria-label', 'Full name'); });
    await h.runtime.inspect(h.job);
    assert.equal((await h.runtime.advance(h.job)).advanced, false);
  } finally { await h.runtime.closeAll(); }
});

test('custom dropdown chooses a real matching option and refuses substring confusion', async () => {
  const h = await setup(`<h1>Test application</h1><label id="place">Preferred office</label><div role="combobox" aria-labelledby="place" aria-label="Preferred office" tabindex="0">Choose</div><div id="menu" hidden><div role="option">Australia</div><div role="option">US</div></div><script>document.querySelector('[role=combobox]').onclick=()=>document.querySelector('#menu').hidden=false;for(const e of document.querySelectorAll('[role=option]'))e.onclick=()=>{document.querySelector('[role=combobox]').textContent=e.textContent;document.querySelector('#menu').hidden=true};</script>`);
  try {
    const fields = await h.runtime.inspect(h.job);
    assert.equal(fields[0].type, 'combobox');
    const result = await h.runtime.fill(h.job, { [fields[0].key]: 'US' });
    assert.equal(result.filled.length, 1);
    assert.equal(await h.page.getByRole('combobox').innerText(), 'US');
    const unmatched = await h.runtime.fill(h.job, { [fields[0].key]: 'Aus' });
    assert.equal(unmatched.filled.length, 0);
    assert.equal(unmatched.skipped.length, 1);
  } finally { await h.runtime.closeAll(); }
});

test('next-looking controls with submit accessible names cannot be advanced', async () => {
  const h = await setup('<h1>Test application</h1><input aria-label="Full name"><button type="button" aria-label="Submit application">Next</button><script>window.clicked=0;document.querySelector("button").onclick=()=>window.clicked++;</script>');
  try {
    assert.equal((await h.runtime.advance(h.job)).advanced, false);
    assert.equal(await h.page.evaluate(() => window.clicked), 0);
  } finally { await h.runtime.closeAll(); }
});

test('embedded multi-step form validates its own fields and stops at final review', async () => {
  const h = await setup('<h1>Embedded application</h1><label id=placeholder>Full name<input></label>');
  try {
    await h.page.route('https://jobs.lever.co/synthetic/embedded', route => route.fulfill({ contentType: 'text/html', body: `<h1>Contact details</h1><div id="step"><label>Full name<input name="name" required></label><button type="button" id="next">Next</button></div><script>document.querySelector('#next').onclick=()=>document.querySelector('#step').innerHTML='<form><label>Email<input name="email" type="email" required></label><button type="submit">Submit application</button></form>';</script>` }));
    await h.page.evaluate(() => { document.querySelector('#placeholder').remove(); const frame = document.createElement('iframe'); frame.src = '/synthetic/embedded'; document.body.append(frame); });
    await h.page.frameLocator('iframe').getByRole('button', { name: 'Next' }).waitFor();
    let fields = await h.runtime.inspect(h.job);
    assert.equal(fields.length, 1);
    assert.ok(fields[0].frameIndex > 0);
    assert.equal((await h.runtime.advance(h.job)).state, 'needs-answers');
    await h.runtime.fill(h.job, { [fields[0].key]: 'Fictional Candidate' });
    assert.equal((await h.runtime.advance(h.job)).advanced, true);
    fields = await h.runtime.inspect(h.job);
    assert.equal(fields[0].name, 'email');
    await h.runtime.fill(h.job, { [fields[0].key]: 'candidate@example.invalid' });
    assert.equal((await h.runtime.advance(h.job)).state, 'review');
    assert.equal(await h.page.frameLocator('iframe').locator('input').inputValue(), 'candidate@example.invalid');
  } finally { await h.runtime.closeAll(); }
});

test('portal validation errors stop advancement even when HTML constraints pass', async () => {
  const h = await setup('<h1>Test application</h1><label>Full name<input aria-invalid="true" value="Candidate"></label><button type="button">Next</button><script>window.clicked=0;document.querySelector("button").onclick=()=>window.clicked++</script>');
  try {
    assert.equal((await h.runtime.advance(h.job)).state, 'needs-answers');
    assert.equal(await h.page.evaluate(() => window.clicked), 0);
  } finally { await h.runtime.closeAll(); }
});

test('embedded review-only page is recognized without offering submission', async () => {
  const h = await setup('<h1>Application</h1><label id=placeholder>Full name<input></label>');
  try {
    await h.page.route('https://jobs.lever.co/synthetic/review', route => route.fulfill({ contentType: 'text/html', body: '<h1>Review your application</h1><form><p>Fictional candidate</p><button type="submit">Submit application</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++}</script>' }));
    await h.page.evaluate(() => { document.querySelector('#placeholder').remove(); const frame = document.createElement('iframe'); frame.src = '/synthetic/review'; document.body.append(frame); });
    await h.page.frameLocator('iframe').getByRole('button', { name: 'Submit application' }).waitFor();
    assert.deepEqual(await h.runtime.inspect(h.job), []);
    assert.equal((await h.runtime.status(h.job.id)).state, 'review');
    assert.equal((await h.runtime.advance(h.job)).advanced, false);
    assert.equal(await h.page.frames()[1].evaluate(() => window.submits), 0);
  } finally { await h.runtime.closeAll(); }
});

test('conditional questions force replanning before stale field keys can be filled', async () => {
  const h = await setup(`<h1>Application</h1><label>Experience level<select name="level"><option value="">Choose</option><option value="professional">Professional</option></select></label><label>Email<input name="email"></label><script>document.querySelector('select').onchange=()=>{if(!document.querySelector('[name=employer]'))document.querySelector('select').parentElement.insertAdjacentHTML('afterend','<label>Employer<input name="employer" required></label>')};</script>`);
  try {
    let fields = await h.runtime.inspect(h.job);
    const result = await h.runtime.fill(h.job, { [fields[0].key]: 'professional', [fields[1].key]: 'candidate@example.invalid' });
    assert.equal(result.formChanged, true);
    assert.deepEqual(result.failed, []);
    assert.equal(await h.page.locator('[name=employer]').inputValue(), '', 'Email answer never lands in the newly inserted employer field.');
    assert.equal(await h.page.locator('[name=email]').inputValue(), '');
    fields = await h.runtime.inspect(h.job);
    const answers = Object.fromEntries(fields.map(f => [f.key, ({ level: 'professional', employer: 'Synthetic Engineering', email: 'candidate@example.invalid' })[f.name]]));
    assert.equal((await h.runtime.fill(h.job, answers)).formChanged, false);
    assert.equal(await h.page.locator('[name=employer]').inputValue(), 'Synthetic Engineering');
    assert.equal(await h.page.locator('[name=email]').inputValue(), 'candidate@example.invalid');
  } finally { await h.runtime.closeAll(); }
});

test('repeated employment fields retain record context and distinct reviewed answers', async () => {
  const h = await setup('<h1>Application</h1><fieldset><legend>Employment</legend><label>Full name<input name="company1"></label><label>Title<input name="title1"></label></fieldset><fieldset><legend>Employment</legend><label>Full name<input name="company2"></label><label>Title<input name="title2"></label></fieldset>');
  try {
    const fields = await h.runtime.inspect(h.job);
    assert.deepEqual(fields.map(f => f.sectionContext), [{ label: 'Employment', index: 0, count: 2 }, { label: 'Employment', index: 0, count: 2 }, { label: 'Employment', index: 1, count: 2 }, { label: 'Employment', index: 1, count: 2 }]);
    assert.deepEqual(defaultFieldAnswers(fields, { name: 'Candidate Person' }), {}, 'Contact identity is never substituted into an employment record.');
    const values = ['Synthetic Engineering', 'Intern', 'Example Robotics', 'Research assistant'];
    const result = await h.runtime.fill(h.job, Object.fromEntries(fields.map((f, i) => [f.key, values[i]])));
    assert.equal(result.filled.length, 4);
    assert.deepEqual(await h.page.locator('input').evaluateAll(nodes => nodes.map(n => n.value)), values);
  } finally { await h.runtime.closeAll(); }
});
