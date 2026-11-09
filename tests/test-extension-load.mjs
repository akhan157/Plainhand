// Loads the real unpacked extension in Chromium: the manifest is accepted, the
// background service worker starts without errors, and the toolbar popup renders.
// Catches packaging mistakes (missing action, wrong icon types, bad permissions)
// that tests of the fill logic alone cannot see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const EXTENSION = new URL('../extension/', import.meta.url).pathname;

test('manifest is store-ready: PNG icons, toolbar popup, no unused permissions', async () => {
  const manifest = JSON.parse(await readFile(path.join(EXTENSION, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.description.length <= 132, 'Chrome Web Store limit is 132 characters');
  for (const icon of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) assert.match(icon, /\.png$/);
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'identity', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'site access is optional and requested when needed');
});

test('the extension installs, its service worker starts and the popup renders', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'plainhand-ext-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium', // the headless shell does not run extensions
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    assert.match(id, /^[a-p]{32}$/);
    // Without an "action" in the manifest chrome.action is undefined and the toolbar button does nothing.
    assert.equal(await worker.evaluate(() => typeof chrome.action?.setBadgeText), 'function');
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    assert.deepEqual(errors, []);
    assert.match(await page.locator('body').innerText(), /Plainhand|Sign in/i);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
