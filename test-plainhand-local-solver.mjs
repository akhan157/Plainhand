import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { LocalAudioSolver, recaptchaFrame, recaptchaAudioUrl } from './plainhand/solvers/local-audio.mjs';
import { ApplicationBrowser, solveTurnstile } from './plainhand/jobs.mjs';

const anchorUrl = 'https://www.google.com/recaptcha/api2/anchor?k=synthetic';
const challengeUrl = 'https://www.google.com/recaptcha/api2/bframe?k=synthetic';
const audioUrl = 'https://www.google.com/recaptcha/api2/payload?p=synthetic';
async function fixture({ accepted = true, malicious = false, solver, audio, expected = 'hello world' } = {}) {
  let page, submitted = 0, downloads = 0;
  const job = { id: 'local-solver-test', url: 'https://jobs.lever.co/synthetic/123' };
  const runtime = new ApplicationBrowser({ solver, launch: async options => {
    const browser = await chromium.launch(options);
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await createContext(options);
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await createPage();
        await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: `<h1>Synthetic application</h1><label>Email<input name="email" type="email"></label><iframe id="anchor" src="${anchorUrl}"></iframe><iframe id="challenge" hidden src="${challengeUrl}"></iframe><button id="submit">Submit application</button><script>window.submitted=0;document.querySelector('#submit').onclick=()=>window.submitted++;window.addEventListener('message',e=>{if(e.data==='show')document.querySelector('#challenge').hidden=false;if(e.data==='solved'){document.querySelector('#challenge').hidden=true;document.querySelector('#anchor').contentWindow.postMessage('solved','*')}});</script>` }));
        await page.route('https://www.google.com/recaptcha/**', route => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('/payload')) { downloads++; return route.fulfill({ contentType: 'audio/mpeg', body: audio || Buffer.from('SYNTHETIC AUDIO; transcription stub is explicitly injected') }); }
          const body = url.pathname.endsWith('/anchor') ? `<div id="recaptcha-anchor" role="checkbox" aria-checked="false" tabindex="0">Verify</div><script>document.querySelector('#recaptcha-anchor').onclick=()=>parent.postMessage('show','*');window.addEventListener('message',e=>{if(e.data==='solved')document.querySelector('#recaptcha-anchor').setAttribute('aria-checked','true')});</script>` : `<button id="recaptcha-audio-button" type="button">Audio</button><div id="audio" hidden><a class="rc-audiochallenge-tdownload-link" href="${malicious ? 'http://127.0.0.1/private-audio' : audioUrl}">Audio file</a><input id="audio-response"><button id="recaptcha-verify-button" type="button">Verify</button></div><script>document.querySelector('#recaptcha-audio-button').onclick=()=>document.querySelector('#audio').hidden=false;document.querySelector('#recaptcha-verify-button').onclick=()=>{if(${accepted} && document.querySelector('#audio-response').value===${JSON.stringify(expected)})parent.postMessage('solved','*')};</script>`;
          return route.fulfill({ contentType: 'text/html', body });
        });
        return page;
      };
      return context;
    };
    return browser;
  } });
  await runtime.open(job, true);
  return { runtime, job, get page() { return page; }, get downloads() { return downloads; } };
}

test('solver accepts only verified reCAPTCHA frame/audio origins and paths', () => {
  assert.equal(recaptchaFrame(anchorUrl, 'anchor'), true);
  assert.equal(recaptchaFrame('https://employer.invalid/recaptcha/api2/anchor', 'anchor'), false);
  assert.equal(recaptchaFrame('https://www.google.com.attacker.invalid/recaptcha/api2/anchor', 'anchor'), false);
  assert.equal(recaptchaAudioUrl(audioUrl), true);
  for (const url of ['http://127.0.0.1/private', 'https://www.google.com/private', 'https://user:secret@www.google.com/recaptcha/api2/payload', 'https://www.google.com:444/recaptcha/api2/payload']) assert.equal(recaptchaAudioUrl(url), false);
});

test('same-page local solver resolves an explicit fixture challenge and resumes filling without employer submission', async () => {
  const solver = new LocalAudioSolver({ root: '/tmp/unused-local-solver-fixture', transcribe: async audio => { assert.match(audio.toString(), /SYNTHETIC AUDIO/); return 'Hello, World!'; } });
  const h = await fixture({ solver });
  try {
    assert.equal((await h.runtime.status(h.job.id)).state, 'challenge');
    const result = await h.runtime.resolveChallenge(h.job);
    assert.equal(result.solver.state, 'solved');
    assert.equal(result.state, 'ready');
    assert.equal(h.downloads, 1);
    const fields = await h.runtime.inspect(h.job);
    await h.runtime.fill(h.job, { [fields[0].key]: 'test@example.invalid' });
    assert.equal(await h.page.locator('input').inputValue(), 'test@example.invalid');
    assert.equal(await h.page.evaluate(() => window.submitted), 0);
    assert.equal(await h.page.frames().find(f => recaptchaFrame(f.url(), 'anchor')).locator('#recaptcha-anchor').getAttribute('aria-checked'), 'true');
  } finally { await h.runtime.closeAll(); }
});

test('audio link cannot redirect local transcription to a private or employer URL', async () => {
  let transcribed = false;
  const h = await fixture({ malicious: true, solver: new LocalAudioSolver({ root: '/tmp/unused-local-solver-fixture', transcribe: async () => { transcribed = true; return 'hello world'; } }) });
  try {
    const result = await h.runtime.resolveChallenge(h.job);
    assert.equal(result.solver.state, 'blocked'); assert.equal(result.state, 'challenge');
    assert.equal(transcribed, false); assert.equal(h.downloads, 0);
    assert.equal(await h.page.evaluate(() => window.submitted), 0);
  } finally { await h.runtime.closeAll(); }
});

test('unavailable local model never selects a paid fallback or pretends to solve', async () => {
  const h = await fixture({ solver: new LocalAudioSolver({ root: '/tmp/does-not-exist-plainhand-solver' }) });
  try {
    const result = await h.runtime.resolveChallenge(h.job);
    assert.equal(result.solver.state, 'unavailable'); assert.equal(result.state, 'challenge');
    assert.equal(h.downloads, 0);
  } finally { await h.runtime.closeAll(); }
});


test('installed CPU model transcribes real audio inside the complete fixture flow', { skip: !process.env.PLAINHAND_TEST_AUDIO }, async () => {
  const solver = new LocalAudioSolver({ root: process.cwd() });
  assert.equal(await solver.ready(), true);
  const audio = await readFile(process.env.PLAINHAND_TEST_AUDIO);
  const expected = 'and so my fellow americans ask not what your country can do for you ask what you can do for your country';
  const h = await fixture({ solver, audio, expected });
  try {
    const result = await h.runtime.resolveChallenge(h.job);
    assert.equal(result.solver.state, 'solved', JSON.stringify(result));
    assert.equal(result.state, 'ready');
    assert.equal(await h.page.evaluate(() => window.submitted), 0);
  } finally { await h.runtime.closeAll(); }
});

test('solveTurnstile detects and resolves an interactive Turnstile fixture challenge', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://jobs.lever.co/test', route => route.fulfill({
      contentType: 'text/html',
      body: `<html><body><input name="cf-turnstile-response" value=""><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/test" style="width:300px;height:65px;display:block;"></iframe><script>window.addEventListener('message',e=>{if(e.data==='solved')document.querySelector('[name=cf-turnstile-response]').value='synthetic-turnstile-pass-token-verified-12345'});</script></body></html>`
    }));
    await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: `<html><body style="margin:0;padding:0;width:300px;height:65px;"><button id="box" style="width:100%;height:100%;">Verify</button><script>window.addEventListener('click',()=>parent.postMessage('solved','*'));</script></body></html>`
    }));
    await page.goto('https://jobs.lever.co/test');
    const outcome = await solveTurnstile(page);
    assert.equal(outcome.state, 'solved');
    assert.match(outcome.message, /Turnstile/);
    assert.equal(await page.locator('[name="cf-turnstile-response"]').inputValue(), 'synthetic-turnstile-pass-token-verified-12345');
  } finally { await browser.close(); }
});

// The classifier is a locally installed model, like the Whisper check above; without it there is nothing to measure.
const gridSolver = new LocalAudioSolver({ root: process.cwd() });
const gridModelInstalled = existsSync(`${gridSolver.directory}/model/recaptcha_classifier.onnx`) && existsSync(gridSolver.python);
test('visual grid classifier identifies challenge categories on local ONNX model', { skip: !gridModelInstalled && 'local ONNX grid classifier is not installed' }, async () => {
  const solver = gridSolver;
  const buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const result = await solver.classifyGrid(buffer, 'Select all images with traffic lights');
  assert.ok(result);
  assert.equal(result.status, 'success');
  assert.equal(result.targetClass, 'traffic light');
  assert.ok(Array.isArray(result.matchingTiles));
});
