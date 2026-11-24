// Regressions found by reading live Lever and Workday postings (2026-11-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ApplicationBrowser, defaultFieldAnswers } from '../plainhand/jobs.mjs';

async function setup(html, captchaBody = '<p>captcha</p>') {
  const runtime = new ApplicationBrowser({ launch: async options => {
    const browser = await chromium.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async contextOptions => {
      const context = await newContext(contextOptions);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        await page.route('https://jobs.lever.co/**', route => route.request().method() === 'GET' ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
        await page.route('https://newassets.hcaptcha.com/**', route => route.fulfill({ contentType: 'text/html', body: captchaBody }));
        return page;
      };
      return context;
    };
    return browser;
  } });
  const job = { id: 'regression', url: 'https://jobs.lever.co/synthetic/123/apply' };
  const fields = await runtime.open(job, true);
  return { runtime, job, fields };
}

const form = extra => `<!doctype html><h1>Engineer</h1><form>
<label><div class="application-label">Resume/CV <span class="required">✱</span></div><div class="application-field">
<a href="#"><span class="default-label">ATTACH RESUME/CV</span><input type="file" name="resume"></a>
<span style="display:none"><div>Couldn't auto-read resume.</div></span><span hidden><div>Analyzing resume...</div></span></div></label>
<label>Full name<input name="name"></label>${extra}</form>`;

test('invisible preloaded hCaptcha frames are not a challenge (Lever)', async () => {
  const { runtime, job } = await setup(form(`
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="position:absolute;top:-9999px;width:300px;height:150px"></iframe>
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="width:1px;height:1px;border:0"></iframe>
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="display:none"></iframe>`));
  try { assert.equal((await runtime.status(job.id)).state, 'ready'); } finally { await runtime.closeAll(); }
});

// E2E swarm run 2 (SITE-06): Lever's hidden hCaptcha asset frames contain the words
// "sign in with email", which made a public form read as a sign-in wall.
test('text inside an invisible frame is not a sign-in wall (Lever)', async () => {
  const { runtime, job } = await setup(form(`
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="position:absolute;top:-9999px;width:300px;height:150px"></iframe>
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="display:none"></iframe>`),
    '<pre>{"i18n":{"login":"Sign in with email","create":"Create an account to continue"}}</pre>');
  try { assert.equal((await runtime.status(job.id)).state, 'ready'); } finally { await runtime.closeAll(); }
});

test('a visible hCaptcha frame is still a challenge', async () => {
  const { runtime, job } = await setup(form(`<iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/" style="width:300px;height:150px"></iframe>`));
  try { assert.equal((await runtime.status(job.id)).state, 'challenge'); } finally { await runtime.closeAll(); }
});

test('hidden status text is not part of a field label (Lever resume)', async () => {
  const { runtime, fields } = await setup(form(''));
  try {
    const resume = fields.find(f => f.type === 'file');
    assert.ok(resume, 'resume field found');
    assert.doesNotMatch(resume.label, /auto-read|Analyzing/);
    assert.match(resume.label, /^Resume\/CV/);
  } finally { await runtime.closeAll(); }
});

test('navigation waits for a sign-in wall that renders after the click (Workday)', async () => {
  const { runtime, job } = await setup(`<!doctype html><h1>Engineer</h1><button id="go">Apply</button>
    <script>document.getElementById('go').onclick = () => { document.body.innerHTML = '<h1>Loading</h1>'; setTimeout(() => { document.body.innerHTML = '<h1>Create Account/Sign In</h1><p>Sign in with Google</p><p>Sign in with email</p>'; }, 1800); };</script>`);
  try {
    const result = await runtime.navigate(job, async ({ controls }) => {
      const apply = controls.find(c => /^apply$/i.test(c.label));
      return apply ? { action: 'click', ref: apply.ref, reason: 'test' } : { action: 'stop', reason: 'none' };
    });
    assert.equal(result.state, 'login', result.message);
  } finally { await runtime.closeAll(); }
});

test('an embedded form whose Submit button paints before its fields is still read (careers.airbnb.com)', async () => {
  const { runtime, job, fields } = await setup(`<!doctype html><h1>Engineer</h1><form id="f"><button type="submit">Submit application</button></form>
    <script>setTimeout(() => { document.getElementById('f').insertAdjacentHTML('afterbegin', '<label>First Name<input name="first_name"></label><label>Email<input type="email" name="email"></label>'); }, 2000);</script>`);
  try {
    assert.ok(fields.length >= 2, `expected fields, got ${fields.length}`);
    assert.equal((await runtime.status(job.id)).state, 'ready');
  } finally { await runtime.closeAll(); }
});

test('Greenhouse bare "Attach" file inputs map to resume/cover letter only when nativeId or name identifies them (#21)', () => {
  const answers = defaultFieldAnswers([
    { key: '0:9', type: 'file', label: 'Attach', nativeId: 'resume', name: '' },
    { key: '0:10', type: 'file', label: 'Attach', nativeId: 'cover_letter', name: '' },
    { key: '0:29', type: 'file', label: 'Attach', nativeId: 'question_8623138006', name: '' },
  ], { name: 'Riley Chen', email: 'riley@example.invalid', phone: '555-0100', location: 'Austin, TX' });
  assert.equal(answers['0:9'], '__resume__');
  assert.equal(answers['0:10'], '__cover_letter__');
  assert.equal(answers['0:29'], undefined);
});
