// The extension's content script (extension/content/fill.js) in a real Chromium
// page, with the vendored helpers (scripts/build-extension.mjs output) loaded
// before it — the same order chrome.scripting injects them.
//
// What is proven here: the form read matches the server's field model; filling
// writes text, selects, radios, checkboxes and comboboxes the way React listens
// for; sensitive fields are skipped; files attach the approved PDFs; fields the
// candidate already filled are kept; and no click the script makes can ever
// reach a submit control (the shared submit guard refuses it).
//
// The extractor stamps its own data-co-field ids on the live DOM; read and fill
// share those ids, so the test never hand-writes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = await readFile(path.join(ROOT, 'extension/vendor/plainhand-vendor.js'), 'utf8');
const FILL = await readFile(path.join(ROOT, 'extension/content/fill.js'), 'utf8');
const RESUME = '%PDF-1.4 approved resume\n%%EOF\n';
const b64 = s => Buffer.from(s).toString('base64');

// A Greenhouse-shaped application form: text, email, textarea, a sensitive
// salary field, a select, radios, a checkbox, a file input, an ARIA combobox
// whose options appear when it is opened, and submit/next buttons.
const FORM = `
<form id="app">
  <label for="name">Full name</label><input id="name">
  <label for="email">Email address</label><input id="email" type="email">
  <label for="why">Why do you want to work here?</label><textarea id="why"></textarea>
  <label for="salary">Desired salary</label><input id="salary">
  <label for="state">State</label>
  <select id="state">
    <option value="">Select a state</option>
    <option value="MA">Massachusetts</option><option value="CA">California</option>
  </select>
  <fieldset><legend>Work authorization</legend>
    <label><input type="radio" name="auth" value="yes"> Yes, I am authorized</label>
    <label><input type="radio" name="auth" value="no"> No</label>
  </fieldset>
  <label><input type="checkbox" id="relocate"> I am willing to relocate</label>
  <label for="resume-file">Resume/CV</label><input type="file" id="resume-file">
  <label for="combo">Education level</label>
  <div class="select__container" id="combo-wrap">
    <input id="combo" role="combobox" aria-controls="combo-list" aria-expanded="false" autocomplete="off">
    <ul id="combo-list" role="listbox" style="display:none">
      <li role="option">Bachelor's degree</li><li role="option">Master's degree</li>
    </ul>
  </div>
  <button type="submit" id="submit-btn">Submit application</button>
  <button type="button" id="next-btn">Next</button>
</form>
<iframe src="/frame.html" title="application frame"></iframe>`;

// A combobox that behaves like React Select: opening it shows its options.
const COMBO_SCRIPT = `
document.getElementById('combo').addEventListener('click', () => {
  const list = document.getElementById('combo-list');
  list.style.display = 'block';
});
window.__submitted = 0;
document.getElementById('app').addEventListener('submit', e => { e.preventDefault(); window.__submitted++; });`;

async function pageWith(browser, body = FORM, script = COMBO_SCRIPT) {
  const page = await browser.newPage();
  await page.route('**/frame.html', route => route.fulfill({ contentType: 'text/html', body: '<div>frame content</div>' }));
  await page.route('**/page.html', route => route.fulfill({ contentType: 'text/html', body: `<html><body>${body}<script>${script}</script></body></html>` }));
  await page.goto('https://employer.example/page.html');
  await page.addScriptTag({ content: VENDOR });
  await page.addScriptTag({ content: FILL });
  return page;
}

const label = (read, text) => { const f = read.fields.find(f => f.label.toLowerCase().includes(text.toLowerCase())); assert.ok(f, `field "${text}" in ${JSON.stringify(read.fields.map(f => f.label))}`); return f; };

test('read returns the server field model, never page content beyond labels and options', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await pageWith(browser);
    const read = await page.evaluate(() => globalThis.__plainhand.read());
    assert.equal(read.url, 'https://employer.example/page.html');
    assert.ok(read.top);
    assert.ok(read.frames.includes('https://employer.example/frame.html'));
    assert.equal(label(read, 'Full name').type, 'text');
    assert.equal(label(read, 'Email address').type, 'email');
    assert.equal(label(read, 'Why do you want').type, 'textarea');
    assert.equal(label(read, 'Resume/CV').type, 'file');
    assert.equal(label(read, 'State').type, 'select-one');
    assert.equal(label(read, 'Desired salary').type, 'text');
    assert.equal(label(read, 'Work authorization').type, 'radio');
    assert.ok(label(read, 'Work authorization').options.join(' ').includes('Yes, I am authorized'));
    assert.equal(label(read, 'Education level').type, 'combobox');
    assert.equal(read.fields.some(f => /Select a state/.test(f.label)), false, 'placeholder options are not fields');
    assert.equal(read.fields.some(f => /Submit|Next/.test(f.label)), false, 'buttons are not fields');
    assert.equal(JSON.stringify(read).includes('frame content'), false, 'no page text beyond labels');
  } finally { await browser.close(); }
});

test('fill enters answers the way the page listens for, and never submits', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await pageWith(browser);
    const read = await page.evaluate(() => globalThis.__plainhand.read());
    const answers = {
      [label(read, 'Full name').id]: 'Riley Example',
      [label(read, 'Email address').id]: 'riley@example.invalid',
      [label(read, 'Why do you want').id]: 'I led the Formula SAE suspension redesign.',
      [label(read, 'State').id]: 'Massachusetts',
      [label(read, 'Work authorization').id]: 'Yes, I am authorized',
      [label(read, 'I am willing to relocate').id]: 'yes',
      [label(read, 'Resume/CV').id]: '__resume__',
      [label(read, 'Education level').id]: "Bachelor's degree",
    };
    const result = await page.evaluate(req => globalThis.__plainhand.fill(req), {
      fields: read.fields, answers, identity: [],
      files: { resume: { name: 'riley-example.pdf', base64: b64(RESUME) } },
    });
    assert.deepEqual(result.filled.map(f => f.label).sort(), ['Education level', 'Email address', 'Full name', 'Resume/CV', 'State', 'Why do you want to work here?'], JSON.stringify(result));
    // Sensitive questions (salary, work authorization, relocation) are always the
    // candidate's own to answer, whatever the plan contains.
    assert.deepEqual(result.skipped.map(s => s.label), ['Desired salary', 'Work authorization', 'I am willing to relocate']);
    assert.ok(result.skipped.every(s => s.reason === 'sensitive'), JSON.stringify(result.skipped));
    assert.deepEqual(result.failed, []);
    assert.equal(await page.evaluate(() => window.__submitted), 0, 'the form was never submitted');
    const values = await page.evaluate(() => ({
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      why: document.getElementById('why').value,
      state: document.getElementById('state').value,
      auth: [...document.querySelectorAll('input[name=auth]')].find(r => r.checked)?.value,
      relocate: document.getElementById('relocate').checked,
      salary: document.getElementById('salary').value,
      resume: document.getElementById('resume-file').files[0]?.name,
      combo: document.getElementById('combo').getAttribute('aria-expanded'),
    }));
    assert.equal(values.name, 'Riley Example');
    assert.equal(values.email, 'riley@example.invalid');
    assert.equal(values.why, 'I led the Formula SAE suspension redesign.');
    assert.equal(values.state, 'MA');
    assert.equal(values.auth, undefined, 'authorization is left for the candidate');
    assert.equal(values.relocate, false, 'relocation is left for the candidate');
    assert.equal(values.salary, '', 'sensitive fields are left for the candidate');
    assert.equal(values.resume, 'riley-example.pdf');
    assert.equal(await page.inputValue('#name'), 'Riley Example', 'the DOM sees the value');
  } finally { await browser.close(); }
});

test('the candidate’s own values are kept, and submit-shaped controls are refused', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await pageWith(browser);
    await page.evaluate(() => { document.getElementById('name').value = 'Riley Q. Candidate'; document.getElementById('email').value = 'mine@example.invalid'; });
    const read = await page.evaluate(() => globalThis.__plainhand.read());
    const result = await page.evaluate(req => globalThis.__plainhand.fill(req), {
      fields: read.fields,
      answers: { [label(read, 'Full name').id]: 'Riley Example', [label(read, 'Email address').id]: 'riley@example.invalid' },
      identity: [], files: {},
    });
    assert.ok(result.skipped.some(s => s.reason === 'sensitive'), JSON.stringify(result.skipped));
    assert.deepEqual(result.skipped.filter(s => s.reason === 'kept-yours').map(s => s.label).sort(), ['Email address', 'Full name'], JSON.stringify(result.skipped));
    assert.equal(await page.evaluate(() => document.getElementById('name').value), 'Riley Q. Candidate', 'kept the candidate’s own text');
    assert.equal(await page.evaluate(() => document.getElementById('email').value), 'mine@example.invalid');
    // Never submits, by construction: the only clicks the filler can make are
    // combobox openers and their options, each screened by the shared submit
    // guard; the form's submit button records zero clicks, zero submissions.
    const tracked = await page.evaluate(async req => {
      window.__submitClicks = 0;
      document.getElementById('submit-btn').addEventListener('click', () => { window.__submitClicks++; });
      await globalThis.__plainhand.fill(req);
      return { submitClicks: window.__submitClicks, submitted: window.__submitted };
    }, { fields: read.fields, answers: { [label(read, 'Education level').id]: "Bachelor's degree" }, identity: [], files: {} });
    assert.equal(tracked.submitClicks, 0, 'the submit button is never clicked');
    assert.equal(tracked.submitted, 0, 'the form is never submitted');
  } finally { await browser.close(); }
});

test('posting reads the JobPosting structured data, not the page chrome', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await pageWith(browser, `
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Mechanical Engineer', description: '<p>Design and test robot drive trains.</p>', hiringOrganization: { name: 'Acme Robotics' } })}</script>
<nav>Acme Robotics nav menu</nav><main><h1>Mechanical Engineer</h1>Design and test robot drive trains. Apply now.</main>`, '');
    const posting = await page.evaluate(() => globalThis.__plainhand.posting());
    assert.equal(posting.company, 'Acme Robotics');
    assert.equal(posting.title, 'Mechanical Engineer');
    assert.equal(posting.url, 'https://employer.example/page.html');
    assert.match(posting.description, /Design and test robot drive trains\./);
    assert.equal(posting.description.includes('nav menu'), false, 'page chrome is not the description');
  } finally { await browser.close(); }
});
