import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startHostedFixture } from './helpers/hosted-onboarding.mjs';
import { candidate } from '../plainhand/test-fixtures.mjs';
let app;
test.beforeAll(async () => { app = await startHostedFixture({ transfer: true }); });
test.afterAll(async () => { await app.close(); });
test.beforeEach(async ({ context }) => {
  for (const w of app.workspaces.values()) w.storage.files.clear();
  await context.setExtraHTTPHeaders({ Cookie: '__Host-plainhand_session=alice' });
});
const sample = { version: 1, profile: candidate, jobs: [{ id: 'fixture', title: 'Engineer', company: 'Synthetic', approvedHash: 'old' }], sources: [] };
async function choose(page, data = sample) {
  await page.getByLabel('Upload a workspace export').setInputFiles({ name: 'sample.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
}
test('upload preview, keyboard cancel, explicit replacement and refresh; accessible controls', async ({ page }) => {
  await page.goto(app.base + '/#workspace');
  await choose(page);
  const dialog = page.getByRole('dialog', { name: 'Import this workspace?' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText('1 role, 0 submitted')).toBeVisible();
  await expect(dialog.getByText(/pending proposals/)).toBeVisible();
  expect((await app.workspaces.get('alice').load()).jobs).toHaveLength(0);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map(v => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0); expect((await app.workspaces.get('alice').load()).jobs).toHaveLength(0);
  await choose(page);
  await dialog.getByRole('button', { name: 'Replace and import' }).focus(); await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await app.workspaces.get('alice').load()).jobs.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Export workspace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Delete my account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get help', exact: true }).last()).toBeVisible();
});
test('invalid JSON and stale replacement keep the current workspace', async ({ page }) => {
  await page.goto(app.base + '/#workspace'); await choose(page, '{invalid');
  await expect(page.getByText(/not valid JSON/)).toBeVisible();
  await choose(page);
  await expect(page.getByRole('dialog', { name: 'Import this workspace?' })).toBeVisible();
  await app.workspaces.get('alice').mutate(s => { s.profile.name = 'Newer edit'; });
  await page.getByRole('button', { name: 'Replace and import' }).click();
  await expect(page.getByText('Your workspace changed. Preview the replacement again.')).toBeVisible();
  expect((await app.workspaces.get('alice').load()).profile.name).toBe('Newer edit');
  expect((await app.workspaces.get('alice').load()).jobs).toHaveLength(0);
});
