import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startHostedFixture, textPdf } from './helpers/hosted-onboarding.mjs';
import { setupCoverage } from '../plainhand/web/ui/connect-data.mjs';
import { CONNECTION_CHECK_PATH } from '../plainhand/cloud/connection-check.mjs';
import { createPlainhand } from '../plainhand-server.mjs';
import { fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let app;
test.beforeAll(async () => { app = await startHostedFixture(); });
test.afterAll(async () => { await app.close(); });
test.beforeEach(async ({ context }) => { for (const workspace of app.workspaces.values()) workspace.storage.files.clear(); await context.setExtraHTTPHeaders({ Cookie: '__Host-plainhand_session=alice' }); });
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true });
const cleanAxe = async page => { const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]); };
test('first run: PDF preview, explicit save, targets, AI plan, actionable route; keyboard and axe', async ({ page }) => {
  let events = 0; page.on('request', r => { if (r.url().includes('/api/events')) events++; });
  await page.goto(app.base);
  await page.getByRole('heading', { name: 'Get started', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue setup' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '1. Review your resume' })).toBeFocused();
  await page.getByLabel('Full name', { exact: true }).fill('Candidate Example');
  const importResponse = page.waitForResponse(r => r.url().endsWith('/api/resume/import'));
  await page.getByLabel('Upload a PDF').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: textPdf() });
  const imported = await importResponse; expect(imported.status(), await imported.text()).toBe(200);
  await expect(page.getByLabel('Resume text')).toHaveValue(/Candidate supplied resume/);
  expect((await app.workspaces.get('alice').load()).profile.resume).toBe('');
  await cleanAxe(page);
  await page.getByRole('button', { name: 'Save resume', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '2. Choose your target roles' })).toBeFocused();
  await page.getByLabel('Target roles', { exact: true }).fill('Mechanical engineer, Manufacturing engineer');
  await page.getByRole('button', { name: 'Save target roles' }).click();
  await page.getByLabel('Your plan', { exact: true }).selectOption('Plus');
  await page.getByRole('button', { name: 'Continue with this plan' }).click();
  await expect(page.getByText('A packaged desktop installer has not been released.', { exact: false })).toBeVisible();
  expect(await page.getByRole('link', { name: /Download/ }).count()).toBe(0);
  await cleanAxe(page);
  await nav(page, 'Home').click();
  await expect(page.getByText('3 of 4 steps complete', { exact: true })).toBeVisible();
  await page.waitForTimeout(5200); expect(events).toBe(0);
  expect((await app.workspaces.get('alice').load()).profile.roles).toContain('Mechanical engineer');
});
test('cloud hides local features and offers copyable requests; export/delete/help stay accessible', async ({ page }) => {
  await page.goto(app.base);
  await expect(nav(page, 'Get started')).toBeVisible();
  for (const name of ['Campaigns', 'Insights', 'AI usage']) await expect(nav(page, name)).toHaveCount(0);
  await nav(page, 'Connections').click();
  await expect(page.getByLabel('AI provider')).toBeVisible();
  await expect(page.getByText('Checking your installed agents…')).toHaveCount(0);
  await nav(page, 'Workspace').click();
  await expect(page.getByRole('button', { name: 'Export workspace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Delete my account' })).toBeVisible();
  await expect(page.getByText('Local CAPTCHA handling', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Open from anywhere' })).toHaveCount(0);
  await nav(page, 'Jobs').click();
  await page.getByRole('button', { name: 'Add a job', exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill('Test Company');
  await page.getByLabel('Role', { exact: true }).fill('Engineer');
  await page.getByLabel('Job posting URL', { exact: true }).fill('https://example.com/jobs/1');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await page.getByRole('button', { name: 'Evaluate fit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ask your connected chat' })).toBeVisible();
  await expect(page.getByText(/@Plainhand Evaluate this job/)).toBeVisible();
  await expect(page.getByText(/Plainhand job ID:/)).toBeVisible();
  expect((await app.workspaces.get('alice').load()).tasks.length).toBe(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await nav(page, 'Get help').click();
  await page.getByLabel('What were you trying to do?').fill('I need help connecting my AI.');
  await page.getByRole('button', { name: 'Send help request' }).click();
  await expect(page.getByText(/Help request saved/)).toBeVisible();
  const files = await app.workspaces.get('alice').list('data/plainhand/help');
  const help = JSON.parse(await app.workspaces.get('alice').read('data/plainhand/help/' + files[0]));
  expect(Object.keys(help).sort()).toEqual(['at', 'email', 'errorIds', 'id', 'message', 'screen', 'status']);
});
test('walkthrough keyboard focus, old/wrong/read-only marker isolation, successful live check and timeout', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(app.base + '/#connections');
  await page.getByLabel('AI provider').selectOption('claude');
  await page.getByLabel('Your plan', { exact: true }).selectOption('Free');
  await expect(page.getByText(/Claude Free allows one custom connector/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue with this plan' }).click();
  await expect(page.getByRole('heading', { name: 'Open Customize', exact: true })).toBeFocused();
  for (let i = 0; i < 9; i++) {
    await expect(page.getByRole('heading', { name: setupCoverage.claude.steps[i].title, exact: true })).toBeFocused();
    if (i === 4) {
      await page.getByRole('button', { name: 'Copy Plainhand link', exact: true }).focus(); await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(app.base + '/mcp');
    }
    await page.getByRole('button', { name: 'Next', exact: true }).focus(); await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Check your connection' })).toBeFocused();
  await cleanAxe(page);
  let checkRequests = 0; page.on('request', r => { if (r.url().endsWith('/api/connection-check')) checkRequests++; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const beforeHidden = checkRequests;
  await page.waitForTimeout(2200); expect(checkRequests).toBe(beforeHidden);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => checkRequests).toBeGreaterThan(beforeHidden);
  const marker = { checkedAt: '2020-01-01T00:00:00Z', read: true, write: true, provider: 'claude', clientId: 'test' };
  await app.workspaces.get('alice').write(CONNECTION_CHECK_PATH, JSON.stringify(marker));
  await page.waitForTimeout(2200); await expect(page.getByText('Connected. Plainhand can read and save.', { exact: true })).toHaveCount(0);
  await app.workspaces.get('alice').write(CONNECTION_CHECK_PATH, JSON.stringify({ ...marker, checkedAt: new Date().toISOString(), provider: 'chatgpt' }));
  await page.waitForTimeout(2200); await expect(page.getByText('Connected. Plainhand can read and save.', { exact: true })).toHaveCount(0);
  await app.workspaces.get('alice').write(CONNECTION_CHECK_PATH, JSON.stringify({ ...marker, checkedAt: new Date().toISOString(), write: false }));
  await expect(page.getByText(/Plainhand can read, but its save test was refused/)).toBeVisible();
  await page.getByRole('button', { name: 'Start a new check' }).click();
  await page.waitForTimeout(20);
  await app.workspaces.get('alice').write(CONNECTION_CHECK_PATH, JSON.stringify({ ...marker, checkedAt: new Date().toISOString() }));
  await expect(page.getByText('Connected. Plainhand can read and save.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change AI or plan' }).click();
  await page.getByRole('button', { name: 'Continue with this plan' }).click();
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.clock.install(); await page.clock.fastForward(121000);
  await expect(page.getByText('No successful read and save check arrived within two minutes.')).toBeVisible();
});
test('phone guidance and work/school admin fallback remain honest', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.base + '/#connections');
  await expect(page.getByText(/Use a computer for initial connector setup/)).toBeVisible();
  await page.getByLabel('AI provider').selectOption('chatgpt');
  await page.getByLabel('Your plan', { exact: true }).selectOption('Work or school');
  await page.getByRole('button', { name: 'Continue with this plan' }).click();
  await page.getByText('I cannot find this option', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy message for admin' })).toBeVisible();
  await cleanAxe(page);
});
test('local app keeps EventSource, local navigation and CLI connections', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-onboarding-local-'));
  const local = await createPlainhand({ root, providers: fixtureProviders });
  await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
  try {
    let events = 0; page.on('request', r => { if (r.url().includes('/api/events')) events++; });
    await page.goto(`http://127.0.0.1:${local.server.address().port}`);
    await expect(nav(page, 'Campaigns')).toBeVisible(); await expect(nav(page, 'Insights')).toBeVisible();
    await nav(page, 'Connections').click();
    await expect(page.getByRole('button', { name: 'Check and use', exact: true })).toBeVisible();
    expect(events).toBeGreaterThan(0); await expect(page.getByText('Local workspace', { exact: true })).toBeVisible();
  } finally { await page.close(); await local.close(); await rm(root, { recursive: true, force: true }); }
});
test('public privacy, terms, support and sign-in links work without a session and pass axe', async ({page,context}) => {
  await context.setExtraHTTPHeaders({});
  for (const [route,title] of [['/privacy','Privacy'],['/terms','Terms'],['/support','Support'],['/signin','Sign in to Plainhand']]) {
    const response=await page.goto(app.base+route);expect(response.status()).toBe(200);
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await cleanAxe(page);
    for(const name of ['Privacy','Terms','Support'])await expect(page.getByRole('link',{name,exact:true})).toBeVisible();
  }
});
