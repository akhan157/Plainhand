// Opt-in real CLI planner on a synthetic application page, never an employer.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ApplicationBrowser } from './plainhand/jobs.mjs';
import { executeAgent } from './plainhand/agents.mjs';
import { NAVIGATION_INSTRUCTION } from './plainhand/browser-driver.mjs';

const index = process.argv.indexOf('--provider');
if (index < 0) { console.log('Opt-in: node test-plainhand-driver-live.mjs --provider claude'); process.exit(0); }
const provider = process.argv[index + 1];
const directory = path.join('output', 'navigation-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
let page;
const runtime = new ApplicationBrowser({ launch: async options => {
  const browser = await chromium.launch(options), newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await newContext(options), newPage = context.newPage.bind(context);
    context.newPage = async () => {
      page = await newPage();
      await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: `<h1>SYNTHETIC Graduate Engineer</h1><p>Local acceptance fixture, not an employer.</p><button type="button" id="start">Start application</button><form hidden><label>Full name<input name="name"></label><label>Email<input name="email"></label><button type="submit">Submit application</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};document.querySelector('#start').onclick=()=>{document.querySelector('form').hidden=false;document.querySelector('#start').remove()};</script>` }));
      return page;
    };
    return context;
  };
  return browser;
} });
const job = { id: 'live-navigation', url: 'https://jobs.lever.co/synthetic/123' };
const proof = { at: new Date().toISOString(), provider, model: 'real installed CLI', employer: 'explicit synthetic local browser fixture', success: false, employerSubmissions: 0 };
try {
  await runtime.open(job, true);
  await page.screenshot({ path: path.join(directory, 'before.png') });
  const result = await runtime.navigate(job, data => executeAgent(provider, NAVIGATION_INSTRUCTION, data));
  assert.equal(result.state, 'ready', JSON.stringify(result));
  const fields = await runtime.inspect(job);
  await runtime.fill(job, { [fields.find(f => f.name === 'name').key]: 'Fictional Candidate', [fields.find(f => f.name === 'email').key]: 'candidate@example.invalid' });
  assert.equal(await page.locator('[name=name]').inputValue(), 'Fictional Candidate');
  assert.equal(await page.evaluate(() => window.submits), 0);
  proof.trace = result.trace; proof.success = true;
  await page.screenshot({ path: path.join(directory, 'after.png') });
} catch (error) { proof.error = error.message; process.exitCode = 1; }
finally {
  await runtime.closeAll();
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ ...proof, evidence: directory }, null, 2));
}
