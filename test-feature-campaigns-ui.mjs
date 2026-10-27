// Browser test of the Campaigns page (milestone N1): create, run now, results
// with reasons and links to the saved roles, a failing source, pause/resume,
// edit, delete with undo, the Home briefing, light/dark/mobile screenshots.
// Real server and front end; synthetic job boards and liveness; no network.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPlainhand } from './plainhand-server.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-campaigns-ui-'));
const shots = process.env.PLAINHAND_CAMPAIGNS_UI_OUTPUT || (process.env.PLAINHAND_UI_OUTPUT ? path.join(process.env.PLAINHAND_UI_OUTPUT, 'campaigns') : await mkdtemp(path.join(tmpdir(), 'plainhand-campaigns-ui-evidence-')));
await mkdir(shots, { recursive: true });
console.log(`Campaigns evidence: ${shots}`);

const ACME = 'https://boards.greenhouse.io/acme', GLOBEX = 'https://jobs.lever.co/globex';
const boards = new Map([
  [ACME, [
    { company: 'Acme Robotics', title: 'Mechanical Engineer', location: 'Boston, MA', url: 'https://jobs.example.com/acme/1' },
    { company: 'Acme Robotics', title: 'Design Engineer', location: 'Remote (US)', url: 'https://jobs.example.com/acme/2' },
    { company: 'Acme Robotics', title: 'Mechanical Engineer Intern', location: 'Boston, MA', url: 'https://jobs.example.com/acme/3' },
    { company: 'Acme Robotics', title: 'Test Engineer', location: 'Boston, MA', url: 'https://jobs.example.com/acme/4' },
  ]],
  [GLOBEX, new Error('The job source returned HTTP 503. Retry later.')],
]);
const closed = new Set(['https://jobs.example.com/acme/4']);
const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
  agent: fixtureAgent,
  scanner: async source => { const value = boards.get(source.url); if (value instanceof Error) throw value; return structuredClone(value || []); },
  verifier: async job => ({ state: closed.has(job.url) ? 'closed' : 'active', legitimacy: 'unconfirmed', reason: 'Fixture.', checkedAt: new Date().toISOString(), description: 'This is an engineering role designing and testing hardware. '.repeat(10) }),
} });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}/`;
{
  const state = await app.workspace.load();
  await app.workspace.saveProfile(candidate, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  await app.registry.run('sources.add', { name: 'Acme Robotics', url: ACME });
  await app.registry.run('sources.add', { name: 'Globex', url: GLOBEX });
}

let browser;
const errors = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'light' });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' && !/400 \(Bad Request\)/.test(message.text())) errors.push(message.text()); });
  const shot = async name => {
    const size = page.viewportSize();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.min(height, 12000) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(shots, name) });
    await page.setViewportSize(size);
  };

  // Empty state, reached from the navigation.
  await page.goto(base + '#home');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('heading', { name: 'No campaigns yet.' }).waitFor();
  await shot('01-campaigns-empty-light.png');

  // Create a campaign from the form.
  await page.getByRole('button', { name: 'New campaign' }).first().click();
  const form = page.getByRole('form', { name: 'New campaign' });
  await form.getByLabel('Campaign name').fill('Boston mechanical');
  await form.getByLabel('Role keywords').fill('Mechanical Engineer, Design Engineer, Test Engineer');
  await form.getByLabel('Locations').fill('Boston, Remote');
  await form.getByLabel('Leave out').fill('Intern');
  await form.getByLabel('Schedule').selectOption('manual');
  await form.getByLabel('Evaluate automatically per day').fill('1');
  await shot('02-campaign-form-light.png');
  await form.getByRole('button', { name: 'Create campaign' }).click();
  const card = page.locator('article.campaign').filter({ has: page.getByRole('heading', { name: 'Boston mechanical' }) });
  await card.waitFor();
  assert.match(await card.innerText(), /Manual only/);
  assert.match(await card.innerText(), /Not run yet/);
  const stored = JSON.parse(await app.workspace.read('data/plainhand/campaigns.json')).campaigns[0];
  assert.deepEqual([stored.terms, stored.locations, stored.exclusions, stored.schedule, stored.dailyEvaluationLimit, stored.liveness], [['Mechanical Engineer', 'Design Engineer', 'Test Engineer'], ['Boston', 'Remote'], ['Intern'], 'manual', 1, true]);

  // Run now: results with reasons, the failing source in health.
  await card.getByRole('button', { name: 'Run now' }).click();
  await card.getByText('Matched "Mechanical Engineer" in the title').waitFor({ timeout: 20000 });
  const text = await card.innerText();
  assert.match(text, /in Remote \(US\); source Acme Robotics board/);
  const results = await card.locator('.campaign-results').innerText();
  assert.doesNotMatch(results, /Intern/, 'excluded role not shown');
  assert.doesNotMatch(results, /Test Engineer/, 'closed posting not surfaced');
  await card.getByText('A source could not be checked').waitFor();
  assert.match(text, /Globex: The job source returned HTTP 503/);
  assert.match(text, /2 new roles/);
  await shot('03-campaign-results-light.png');
  // A result links to the saved role.
  // Let the queued evaluation settle first, so a workspace refresh cannot race the click.
  for (let i = 0; i < 100 && (await app.workspace.load()).tasks.some(t => ['queued', 'running'].includes(t.status)); i++) await new Promise(resolve => setTimeout(resolve, 100));
  const panel = page.locator('aside.context.has-focus').getByRole('heading', { name: 'Design Engineer' });
  for (let attempt = 0; attempt < 3 && !(await panel.isVisible()); attempt++) {
    await card.getByRole('button', { name: 'Design Engineer', exact: true }).click();
    await panel.waitFor({ timeout: 5000 }).catch(() => {});
  }
  await panel.waitFor({ timeout: 1000 });
  const saved = (await app.workspace.load()).jobs.filter(j => j.campaign);
  assert.deepEqual(saved.map(j => j.stage).sort(), ['evaluated', 'inbox'], 'the daily limit of one evaluated exactly one role');
  assert.ok(saved.every(j => !j.packet && !j.selected));
  await page.keyboard.press('Escape');

  // Dark theme.
  await page.evaluate(() => window.plainhandTheme.set('dark'));
  await shot('04-campaign-results-dark.png');
  await page.evaluate(() => window.plainhandTheme.set('light'));

  // The briefing (workspace.digest, read by the assistant and MCP) shows the failing source;
  // new roles were cleared by opening the page.
  const attention = (await app.registry.run('workspace.digest', {})).result.attention;
  assert.ok(attention.some(a => a.kind === 'campaign-failing' && /Globex could not be checked/.test(a.text)));
  assert.ok(!attention.some(a => a.kind === 'campaign-new'), 'viewing the Campaigns page marks new roles as seen');

  // Feature briefing items reach Home too, with a way to act on them.
  await page.goto(base + '#home');
  const failingItem = page.locator('.brief-item').filter({ hasText: 'Globex could not be checked' });
  await failingItem.waitFor();
  await failingItem.getByRole('button', { name: 'Open campaigns' }).click();
  await page.getByRole('heading', { name: 'Campaigns', level: 1 }).waitFor();

  // Pause and resume.
  await page.goto(base + '#campaigns');
  await card.getByRole('button', { name: 'Pause' }).click();
  await card.locator('.pill').filter({ hasText: 'Paused' }).waitFor();
  assert.equal(JSON.parse(await app.workspace.read('data/plainhand/campaigns.json')).campaigns[0].paused, true);
  await card.getByRole('button', { name: 'Resume' }).click();
  await card.getByRole('button', { name: 'Pause' }).waitFor();

  // Edit: one change, one file.
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit Boston mechanical' });
  await edit.getByLabel('Schedule').selectOption('every 12 hours');
  await edit.getByText('Also send a desktop notification').click();
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await card.getByText('Every 12 hours').waitFor();
  const changed = JSON.parse(await app.workspace.read('data/plainhand/campaigns.json')).campaigns[0];
  assert.deepEqual([changed.schedule, changed.notify.desktop], ['every 12 hours', true]);

  // Mobile, light and dark.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await card.waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `no horizontal scroll on mobile (${overflow}px)`);
  await shot('05-campaigns-mobile-light.png');
  await page.evaluate(() => window.plainhandTheme.set('dark'));
  await shot('06-campaigns-mobile-dark.png');
  await page.evaluate(() => window.plainhandTheme.set('light'));
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Delete asks first, then can be undone.
  await card.getByRole('button', { name: 'Delete Boston mechanical' }).click();
  await card.getByRole('button', { name: 'Delete campaign' }).click();
  await page.getByText('Deleted “Boston mechanical”.').waitFor();
  assert.equal(JSON.parse(await app.workspace.read('data/plainhand/campaigns.json')).campaigns.length, 0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await card.waitFor();
  assert.equal(JSON.parse(await app.workspace.read('data/plainhand/campaigns.json')).campaigns.length, 1);

  assert.deepEqual(errors, [], 'No browser or CSP errors');
  await writeFile(path.join(shots, 'campaigns-proof.json'), JSON.stringify({ checkedAt: new Date().toISOString(), items: ['empty state from navigation', 'create from the form (one file)', 'run now: reasons, source error isolated, closed and excluded roles left out, saved roles linked', 'briefing items in workspace.digest', 'pause/resume', 'edit', 'delete with undo', 'light, dark, mobile'], browserErrors: errors }, null, 2));
  console.log('Plainhand campaigns browser test passed.');
} catch (error) {
  const failed = browser?.contexts()[0]?.pages()[0];
  if (failed) { await failed.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(path.join(shots, 'failure.txt'), await failed.locator('body').innerText().catch(() => 'Page unavailable')); }
  throw error;
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
