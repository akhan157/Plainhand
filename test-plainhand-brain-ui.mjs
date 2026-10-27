// Browser test of the candidate-brain controls in Workspace: what the agent sees
// (switching sources and fields off and on) and editing reusable answers.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPlainhand } from './plainhand-server.mjs';
import { AnswerBank } from './plainhand/answer-bank.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-brain-ui-'));
const shots = process.env.PLAINHAND_UI_OUTPUT ? path.join(process.env.PLAINHAND_UI_OUTPUT, 'brain') : await mkdtemp(path.join(tmpdir(), 'plainhand-brain-ui-evidence-'));
await mkdir(shots, { recursive: true });
const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: fixtureAgent } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const state = await app.workspace.load();
await app.workspace.saveProfile({ ...state.profile, ...candidate, eligibility: 'Authorized to work in the US', compensation: '$85k' }, state.revision);
await app.workspace.mutate(s => { s.provider = 'codex'; s.conversation.push({ role: 'user', text: 'I ran the physical load tests myself.', at: new Date().toISOString() }); });
await new AnswerBank(app.workspace).add({ question: 'Describe a hands-on project', answer: 'I designed and tested a chassis.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis' }] });

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const [scheme, viewport] of [['light', { width: 1440, height: 1000 }], ['dark', { width: 1440, height: 1000 }], ['light', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, colorScheme: scheme });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/#settings');
    await page.getByRole('heading', { name: 'What your agent sees' }).waitFor();
    const profileSwitch = page.getByRole('switch', { name: /Profile details/ });
    assert.equal(await profileSwitch.isDisabled(), true, 'profile details are always shared');
    const tag = `${scheme}-${viewport.width}`;
    if (tag === 'light-1440') {
      const eligibility = page.getByRole('switch', { name: /Work authorization/ });
      assert.equal(await eligibility.isChecked(), true);
      await eligibility.uncheck();
      await page.getByRole('status').filter({ hasText: 'No longer shared' }).waitFor();
      assert.deepEqual((await app.workspace.load()).contextPrefs.excludedFields, ['eligibility']);
      const context = await app.workspace.context(await app.workspace.load());
      assert.doesNotMatch(context.sources.find(s => s.id === 'profile').text, /Authorized to work/);
      const interview = page.getByRole('switch', { name: /interview answers/ });
      await interview.uncheck();
      await page.waitForFunction(async () => true);
      for (let i = 0; i < 50 && !(await app.workspace.load()).contextPrefs.excludedSources?.includes('interview'); i++) await new Promise(r => setTimeout(r, 50));
      assert.deepEqual((await app.workspace.load()).contextPrefs.excludedSources, ['interview']);
      await interview.check();
      for (let i = 0; i < 50 && (await app.workspace.load()).contextPrefs.excludedSources?.length; i++) await new Promise(r => setTimeout(r, 50));
      assert.deepEqual((await app.workspace.load()).contextPrefs.excludedSources, [], 'the candidate can share again');

      await page.getByRole('button', { name: 'Edit answer: Describe a hands-on project' }).click();
      await page.getByRole('textbox', { name: 'Answer' }).fill('I designed and load-tested a lightweight chassis.');
      await page.getByLabel('Stop reusing after').fill('2027-06-01');
      await page.getByRole('button', { name: 'Save answer' }).click();
      await page.getByRole('status').filter({ hasText: 'Reusable answer updated.' }).waitFor();
      const [saved] = await new AnswerBank(app.workspace).load();
      assert.deepEqual([saved.answer, saved.reviewBy], ['I designed and load-tested a lightweight chassis.', '2027-06-01']);

      // Import: preview dialog, explicit confirmation, backup, approvals reset.
      const exported = await (await fetch(base + '/api/export', { headers: { 'X-Plainhand-Token': app.token } })).json();
      exported.jobs = [{ id: 'imported-1', company: 'Imported Co', title: 'Test Engineer', url: 'https://jobs.lever.co/imported/1', createdAt: new Date().toISOString(), stage: 'approved', approvedHash: 'old', evaluation: { score: 4.2 }, packet: { headline: 'x', resume: [], answers: [], questions: [] } }];
      const file = path.join(shots, 'export.json');
      await (await import('node:fs/promises')).writeFile(file, JSON.stringify(exported));
      await page.getByLabel('Import a workspace export').setInputFiles(file);
      await page.getByRole('heading', { name: 'Import this workspace?' }).waitFor();
      await page.getByText('1 packet approval is reset', { exact: false }).waitFor();
      await page.waitForTimeout(500); // let the dialog finish fading in
      await page.screenshot({ path: path.join(shots, 'import-dialog.png') });
      await page.getByRole('button', { name: 'Replace and import' }).click();
      await page.getByRole('status').filter({ hasText: 'Workspace imported: 1 role' }).waitFor();
      const imported = (await app.workspace.load()).jobs;
      assert.deepEqual(imported.map(j => [j.company, j.approvedHash]), [['Imported Co', null]]);
      await rm(file, { force: true });
    }
    await page.getByRole('heading', { name: 'What your agent sees' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, `brain-${tag}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll (${tag})`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Candidate brain controls browser test passed. Screenshots: ${shots}`);
} finally {
  await browser.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
