// Opt-in installed CLI inference plus a real background browser, fictional records only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ApplicationBrowser } from './plainhand/jobs.mjs';
import { executeAgent, FORM_INSTRUCTION } from './plainhand/agents.mjs';
import { hasEvidence } from './plainhand/store.mjs';
const index = process.argv.indexOf('--provider');
if (index < 0) { console.log('Opt-in: node test-plainhand-records-live.mjs --provider claude'); process.exit(0); }
const provider = process.argv[index + 1];
const directory = path.join('output', 'records-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
let page;
const runtime = new ApplicationBrowser({ launch: async options => {
  const engine = await chromium.launch(options), createContext = engine.newContext.bind(engine);
  engine.newContext = async options => {
    const context = await createContext(options), createPage = context.newPage.bind(context);
    context.newPage = async () => {
      page = await createPage();
      await page.route('https://jobs.lever.co/**', route => route.request().method() === 'GET' ? route.fulfill({ contentType: 'text/html', body: `<h1>SYNTHETIC employment history</h1><p>Fictional fixture; not a real employer.</p><form><fieldset><legend>Employment</legend><label>Employer<input name="employer1"></label><label>Job title<input name="title1"></label></fieldset><fieldset><legend>Employment</legend><label>Employer<input name="employer2"></label><label>Job title<input name="title2"></label></fieldset><button type="submit">Submit application</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}</script>` }) : route.fallback());
      return page;
    };
    return context;
  };
  return engine;
} });
const job = { id: 'records-live', url: 'https://jobs.lever.co/synthetic/records' };
const context = { sources: [{ id: 'cv', text: 'FICTIONAL TEST CANDIDATE\nEmployment, newest first:\n1. Synthetic Engineering — Mechanical Engineering Intern — June 2026 to August 2026.\n2. Example Robotics — Research Assistant — September 2025 to May 2026.' }] };
const proof = { at: new Date().toISOString(), provider, model: 'real installed CLI', employer: 'controlled synthetic fixture', success: false, employerSubmissions: 0 };
try {
  const fields = await runtime.open(job, true);
  const result = await executeAgent(provider, FORM_INSTRUCTION, { context, job: { company: 'Fictional employer', title: 'Graduate engineer' }, packet: { answers: [] }, fields });
  assert.deepEqual(result.questions, [], 'All record facts exist in the fictional source.');
  const expected = { employer1: 'Synthetic Engineering', title1: 'Mechanical Engineering Intern', employer2: 'Example Robotics', title2: 'Research Assistant' };
  const answers = {};
  for (const field of fields) {
    const suggestion = result.suggestions.find(s => s.key === field.key);
    assert.ok(suggestion && hasEvidence(suggestion, context), `Grounded answer required for ${field.name}`);
    assert.equal(suggestion.answer.toLowerCase(), expected[field.name].toLowerCase(), `Correct record association for ${field.name}`);
    answers[field.key] = suggestion.answer;
  }
  const filled = await runtime.fill(job, answers);
  assert.equal(filled.filled.length, 4);
  assert.deepEqual(filled.failed, []);
  assert.equal((await runtime.advance(job)).state, 'review');
  assert.equal(await page.evaluate(() => window.submits), 0);
  proof.fields = fields; proof.suggestions = result.suggestions; proof.fill = filled; proof.success = true;
  await page.screenshot({ path: path.join(directory, 'review.png'), fullPage: true });
} catch (error) { proof.error = error.message; process.exitCode = 1; }
finally {
  await runtime.closeAll();
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ success: proof.success, error: proof.error, provider, evidence: directory }));
}
