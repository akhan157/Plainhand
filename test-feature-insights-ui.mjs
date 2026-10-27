// Browser test of the Insights page (N3) through the real server and registry:
// empty and insufficient states (never 0%), band table with rates, suggestions
// the candidate approves, rejects or defers, and no change to any source file.
// Synthetic outcomes and fictional companies only; no model and no employer.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPlainhand } from './plainhand-server.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';
import { syntheticJob, dateAgo, many, sufficientJobs, TRACKER_HEADER } from './test-feature-insights-fixtures.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-insights-ui-'));
const shots = process.env.PLAINHAND_INSIGHTS_UI_OUTPUT || (process.env.PLAINHAND_UI_OUTPUT ? path.join(process.env.PLAINHAND_UI_OUTPUT, 'insights') : await mkdtemp(path.join(tmpdir(), 'plainhand-insights-ui-evidence-')));
await mkdir(shots, { recursive: true });
console.log(`Insights evidence: ${shots}`);

const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: fixtureAgent } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
await app.workspace.saveProfile(candidate, (await app.workspace.load()).revision);
await app.workspace.mutate(s => { s.provider = 'codex'; });
const sources = async () => Object.fromEntries(await Promise.all(['config/profile.yml', 'cv.md', 'data/applications.md', 'modes/_profile.md', 'portals.yml'].map(async f => [f, await app.workspace.read(f)])));

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
  const main = page.locator('main');

  // (1) New user: an empty state that says missing data is not 0%.
  await page.goto(base + '#insights');
  await page.getByRole('heading', { level: 1, name: 'Insights' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Insights' }).getAttribute('aria-current'), 'page');
  await main.getByRole('heading', { name: 'No applications to learn from yet.' }).waitFor();
  assert.match(await main.innerText(), /not the same as 0%/);
  await main.getByRole('heading', { name: 'Observed and assumed' }).waitFor();
  await shot('01-insights-empty-light.png');

  // (2) A few outcomes: bands without enough data say so instead of showing 0%.
  await app.workspace.mutate(s => { s.jobs.push(...many(3, { score: 4.6, outcome: 'rejected' }), ...many(2, { score: 4.1, outcome: 'interview' }), syntheticJob({ score: 4.1, outcome: 'silent', applied: 30 })); });
  await page.reload();
  const bands = main.getByRole('table', { name: 'Applications and outcomes by fit score band' });
  await bands.waitFor();
  await main.getByText('Not enough outcomes yet').first().waitFor();
  const bandText = await bands.innerText();
  assert.ok(!/\b0%/.test(bandText), 'no band shows 0% when it lacks outcomes');
  assert.ok((await bands.getByText('Not enough data').count()) >= 5);
  assert.equal(await main.getByRole('button', { name: 'Look for suggestions' }).isDisabled(), true, 'nothing to suggest yet');
  assert.match(await main.innerText(), /Not enough outcomes yet: 5 of 8 observed outcomes/);
  await shot('02-insights-insufficient-light.png');

  // (3) Enough outcomes, with legacy tracker rows: rates, a correlation statement, suggestions.
  await app.workspace.mutate(s => { s.jobs = sufficientJobs(); });
  await app.workspace.write('data/applications.md', TRACKER_HEADER + [
    `| 1 | ${dateAgo(80)} | Legacy Labs | Test Engineer | 3.8/5 | Interview | ✅ | | |`,
    `| 2 | ${dateAgo(80)} | Old Works | Test Engineer | 4.8/5 | Rejected | ✅ | | |`,
  ].join('\n') + '\n');
  const before = await sources();
  assert.ok((await app.registry.run('workspace.digest', {})).result.attention.some(a => a.kind === 'insights' && /20 outcomes recorded/.test(a.text)), 'the briefing digest mentions it once a suggestion is possible');
  await page.goto(base + '#insights');
  await main.getByText('What your outcomes show').waitFor();
  assert.match(await main.innerText(), /Higher scores did not go with more interviews/);
  assert.match(await main.innerText(), /Includes 2 tracker rows from before Plainhand/);
  const midRow = bands.getByRole('row', { name: /3\.5–3\.9/ });
  assert.match(await midRow.innerText(), /45%/, '5 interviews of 11 observed outcomes');
  await main.getByRole('button', { name: 'Look for suggestions' }).click();
  await page.getByRole('status').filter({ hasText: 'new suggestions to review in Insights' }).waitFor();
  const pending = main.getByRole('list', { name: 'Suggestions waiting for your decision' });
  await pending.waitFor();
  assert.equal(await pending.getByRole('listitem').count(), 2);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main .table-wrap')].map(w => [w.querySelector('caption')?.textContent, w.scrollWidth, w.clientWidth]).filter(([, s, c]) => s > c + 1));
  assert.deepEqual(overflow, [], 'tables fit beside the docked panel');
  await shot('03-insights-suggestions-light.png');

  // Approve records the decision only.
  await pending.getByRole('listitem').first().getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('status').filter({ hasText: 'Approved. Nothing was changed' }).waitFor();
  // Reject asks for a reason first.
  await pending.getByRole('listitem').first().getByRole('button', { name: 'Reject' }).click();
  const confirm = main.getByRole('button', { name: 'Reject suggestion' });
  assert.equal(await confirm.isDisabled(), true, 'a reason is required');
  await main.getByRole('textbox', { name: 'Why reject it?' }).fill('I want more interviews before changing this.');
  await confirm.click();
  await page.getByRole('status').filter({ hasText: 'Rejected.' }).waitFor();
  await main.getByText('No suggestions waiting for you.').waitFor();
  await main.getByRole('button', { name: 'Decided (2)' }).click();
  await main.getByText('Your note: I want more interviews before changing this.').waitFor();
  await main.getByRole('button', { name: 'Open Profile' }).waitFor();
  assert.deepEqual(await sources(), before, 'profile, config, tracker and narrative files are byte-for-byte unchanged');
  const ledger = JSON.parse(await app.workspace.read('data/plainhand/insights/outcome-recommendation-state.json'));
  assert.deepEqual(Object.values(ledger.recommendations).map(r => r.status).sort(), ['approved', 'rejected']);
  assert.ok(Object.values(ledger.recommendations).every(r => r.decidedBy === 'candidate'));
  await shot('04-insights-decided-light.png');

  // Dark theme and mobile.
  await page.evaluate(() => window.plainhandTheme.set('dark'));
  await shot('05-insights-dark.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Insights fits a phone screen.');
  await shot('06-insights-mobile-dark.png');
  await page.evaluate(() => window.plainhandTheme.set('light'));
  await shot('07-insights-mobile-light.png');

  assert.deepEqual(errors, [], 'No browser or CSP errors');
  await writeFile(path.join(shots, 'insights-proof.json'), JSON.stringify({ checkedAt: new Date().toISOString(), items: ['empty state, not 0%', 'insufficient bands show "Not enough data"', 'legacy tracker rows counted', 'correlation statement', 'suggest → approve → reject with reason', 'sources byte-for-byte unchanged', 'light, dark, mobile'], browserErrors: errors }, null, 2));
  console.log('Plainhand Insights browser test passed: empty and insufficient states, score bands with legacy rows, suggestions approved and rejected by the candidate, no source changes, light, dark and mobile.');
} catch (error) {
  const failed = browser?.contexts()[0]?.pages()[0];
  if (failed) { await failed.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(path.join(shots, 'failure.txt'), await failed.locator('body').innerText().catch(() => 'Page unavailable')); }
  throw error;
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
