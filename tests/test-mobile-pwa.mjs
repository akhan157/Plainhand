// Mobile browser & PWA end-to-end verification (iPhone & Android).
// Checks manifests, raster/maskable/Apple PNG icons, privacy-first service workers,
// local + hosted + remote-dashboard delivery, responsive mobile tab bar, iOS anti-zoom,
// Android Share Target, install prompt / iOS Add-to-Home-Screen guide, offline fallback,
// and WCAG 2.1 AA accessibility via axe-core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createPlainhand } from '../plainhand-server.mjs';
import { fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { buildStaticDashboard } from '../dashboard/node/build-dashboard-static.mjs';
import { startHostedFixture } from './helpers/hosted-onboarding.mjs';
import { detectPlatform, extractLaunchAction } from '../plainhand/web/ui/pwa-helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.PLAINHAND_MOBILE_SHOTS || path.join(ROOT, 'tmp', 'mobile-pwa-evidence');

function pngDimensions(buf) {
  assert.ok(buf.length >= 24, 'PNG buffer too short');
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('PWA manifests, icons and privacy-first service workers are valid and complete', async () => {
  for (const baseDir of ['plainhand/web', 'dashboard-web']) {
    const manifestPath = path.join(ROOT, baseDir, 'manifest.webmanifest');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.name && manifest.short_name);
    assert.ok(manifest.start_url.startsWith('/'));
    assert.equal(manifest.scope, '/');

    const iconPurposes = new Set();
    for (const icon of manifest.icons) {
      if (icon.type === 'image/png') {
        const rel = icon.src.replace(/^\/+/, '');
        const buf = await readFile(path.join(ROOT, baseDir, rel));
        const { width, height } = pngDimensions(buf);
        const [expectedW, expectedH] = icon.sizes.split('x').map(Number);
        assert.equal(width, expectedW, `${baseDir}/${rel} width`);
        assert.equal(height, expectedH, `${baseDir}/${rel} height`);
        iconPurposes.add(`${icon.sizes}:${icon.purpose}`);
      }
    }
    assert.ok(iconPurposes.has('192x192:any'), `${baseDir} needs 192x192 any icon`);
    assert.ok(iconPurposes.has('512x512:any'), `${baseDir} needs 512x512 any icon`);
    assert.ok(iconPurposes.has('192x192:maskable'), `${baseDir} needs 192x192 maskable icon`);
    assert.ok(iconPurposes.has('512x512:maskable'), `${baseDir} needs 512x512 maskable icon`);

    const appleTouch = await readFile(path.join(ROOT, baseDir, 'apple-touch-icon.png'));
    assert.deepEqual(pngDimensions(appleTouch), { width: 180, height: 180 }, `${baseDir} apple-touch-icon 180x180`);

    const sw = await readFile(path.join(ROOT, baseDir, 'sw.js'), 'utf8');
    assert.doesNotMatch(sw, /^\s*(import|export)\s/m, `${baseDir}/sw.js must be plain JS (no ES module syntax)`);
    assert.match(sw, /\/api\//, `${baseDir}/sw.js must bypass /api/`);
    assert.match(sw, /\/auth\//, `${baseDir}/sw.js must bypass /auth/`);
    assert.match(sw, /\/offline\.html/, `${baseDir}/sw.js must fall back to /offline.html`);

    const offline = await readFile(path.join(ROOT, baseDir, 'offline.html'), 'utf8');
    assert.doesNotMatch(offline, /<style\b/i, `${baseDir}/offline.html must not use inline <style>`);
    assert.doesNotMatch(offline, /<script(?![^>]*\bsrc=)[^>]*>/i, `${baseDir}/offline.html must not use inline <script>`);
  }

  const appManifest = JSON.parse(await readFile(path.join(ROOT, 'plainhand/web/manifest.webmanifest'), 'utf8'));
  assert.ok(Array.isArray(appManifest.shortcuts) && appManifest.shortcuts.length >= 3, 'PWA shortcuts present');
  assert.equal(appManifest.share_target?.method, 'GET');
  assert.equal(appManifest.share_target?.params?.url, 'share_url');

  const appSw = await readFile(path.join(ROOT, 'plainhand/web/sw.js'), 'utf8');
  for (const sensitive of ['/api/', '/auth/', '/oauth/', '/account/', '/signin', '/mcp']) {
    assert.ok(appSw.includes(`'${sensitive}'`), `app sw.js must bypass ${sensitive}`);
  }
  const dashSw = await readFile(path.join(ROOT, 'dashboard-web/sw.js'), 'utf8');
  for (const sensitive of ['/dashboard-data.json', '/reports/', '/output/', '/auth/', '/login']) {
    assert.ok(dashSw.includes(`'${sensitive}'`), `dashboard sw.js must bypass ${sensitive}`);
  }
});

test('platform detection and launch/share-target parsing handle iPhone, iPad, Android and share intents', () => {
  const iphoneSafari = detectPlatform({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: false,
  });
  assert.deepEqual(iphoneSafari, { ios: true, android: false, mobile: true, safari: true, standalone: false });

  const iphoneChrome = detectPlatform({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: false,
  });
  assert.equal(iphoneChrome.ios, true);
  assert.equal(iphoneChrome.safari, false);

  const ipadDesktopUa = detectPlatform({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    maxTouchPoints: 5,
    standalone: true,
  });
  assert.equal(ipadDesktopUa.ios, true);
  assert.equal(ipadDesktopUa.standalone, true);

  const android = detectPlatform({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
    standalone: false,
  });
  assert.deepEqual(android, { ios: false, android: true, mobile: true, safari: false, standalone: false });

  const shared = extractLaunchAction('?share_title=Robotics+Engineer+at+Northstar&share_text=Check+out+this+role+https%3A%2F%2Fjobs.lever.co%2Fnorthstar%2F42');
  assert.equal(shared.openAddJob, true);
  assert.equal(shared.prefill.company, 'Northstar');
  assert.equal(shared.prefill.title, 'Robotics Engineer');
  assert.equal(shared.prefill.url, 'https://jobs.lever.co/northstar/42');
  assert.equal(shared.prefill.description, 'Check out this role');

  const shortcut = extractLaunchAction('?action=add-job');
  assert.equal(shortcut.openAddJob, true);
  assert.equal(shortcut.prefill, null);

  assert.equal(extractLaunchAction(''), null);
});

test('local server, hosted cloud app, and static remote dashboard serve PWA assets with proper headers', async () => {
  const localRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-pwa-local-'));
  const dashOut = path.join(localRoot, 'dashboard-static');
  const local = await createPlainhand({ root: localRoot, providers: fixtureProviders });
  const hosted = await startHostedFixture();
  await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
  const localBase = `http://127.0.0.1:${local.server.address().port}`;
  try {
    for (const [label, base] of [['local', localBase], ['hosted', hosted.base]]) {
      const manifest = await fetch(base + '/manifest.webmanifest');
      assert.equal(manifest.status, 200, `${label} manifest 200`);
      assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);

      const sw = await fetch(base + '/sw.js');
      assert.equal(sw.status, 200, `${label} sw.js 200`);
      assert.match(sw.headers.get('content-type'), /text\/javascript/);
      assert.equal(sw.headers.get('cache-control'), 'no-cache');
      assert.equal(sw.headers.get('service-worker-allowed'), '/');
      assert.match(sw.headers.get('content-security-policy'), /worker-src 'self'/);
      assert.match(sw.headers.get('content-security-policy'), /manifest-src 'self'/);

      for (const asset of ['/offline.html', '/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png']) {
        const res = await fetch(base + asset);
        assert.equal(res.status, 200, `${label} ${asset} should be 200`);
      }
    }

    // Hosted signed-out pages include mobile PWA metadata.
    for (const route of ['/', '/signin', '/privacy', '/terms', '/support']) {
      const html = await (await fetch(hosted.base + route)).text();
      assert.match(html, /viewport-fit=cover/, `hosted ${route} sets viewport-fit=cover`);
      assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/, `hosted ${route} links manifest`);
      assert.match(html, /rel="apple-touch-icon"/, `hosted ${route} links apple-touch-icon`);
    }

    // Remote static dashboard build ships all PWA files and SW headers.
    await buildStaticDashboard({ rootPath: localRoot, outDir: dashOut, log: () => {} });
    const builtVercel = JSON.parse(await readFile(path.join(dashOut, 'vercel.json'), 'utf8'));
    const swHeaderRule = builtVercel.headers.find(h => h.source === '/sw\\.js');
    assert.ok(swHeaderRule, 'static dashboard vercel.json configures /sw.js headers');
    const builtIndex = await readFile(path.join(dashOut, 'index.html'), 'utf8');
    assert.match(builtIndex, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(builtIndex, /viewport-fit=cover/);
    await readFile(path.join(dashOut, 'manifest.webmanifest'));
    await readFile(path.join(dashOut, 'sw.js'));
    await readFile(path.join(dashOut, 'offline.html'));
    await readFile(path.join(dashOut, 'apple-touch-icon.png'));
    await readFile(path.join(dashOut, 'icons/icon-maskable-512.png'));
  } finally {
    await local.close();
    await hosted.close();
    await rm(localRoot, { recursive: true, force: true });
  }
});

test('Playwright mobile & PWA workflows: iPhone, Android, Share Target, install UI, offline fallback, and axe', async () => {
  await mkdir(SHOTS, { recursive: true });
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-pwa-browser-'));
  const local = await createPlainhand({ root, providers: fixtureProviders });
  const hosted = await startHostedFixture();
  await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
  const localBase = `http://127.0.0.1:${local.server.address().port}`;
  let browser;
  const errors = [];

  try {
    browser = await chromium.launch({ headless: true });

    // 1. Android mobile browser & PWA: bottom tab bar, SW registration, beforeinstallprompt,
    //    Share Target prefill, touch targets, anti-zoom inputs, offline fallback, axe.
    const androidContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    });
    const page = await androidContext.newPage();
    page.on('pageerror', e => errors.push('android: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('android-console: ' + m.text()); });

    await page.goto(localBase);
    await page.getByRole('heading', { name: 'Your next chapter starts here.' }).waitFor();

    // Service worker registers and activates cleanly.
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, state: reg.active?.state || null };
    });
    assert.equal(swState.state, 'activated', 'service worker activates cleanly');

    // Bottom quick navigation is visible on phone and works smoothly.
    const tabbar = page.getByRole('navigation', { name: 'Mobile quick navigation' });
    assert.equal(await tabbar.isVisible(), true, 'mobile bottom tab bar is visible on phone');
    await tabbar.getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow on mobile Jobs');

    // Verify 16px anti-zoom font size on form inputs at 390px.
    const inputFontPx = await page.locator('#scan-filter').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(inputFontPx >= 16, `mobile inputs must be >=16px to prevent iOS zoom (got ${inputFontPx}px)`);

    // Verify touch target height >= 44px on mobile bottom tabs.
    const tabHeight = await tabbar.getByRole('link', { name: 'Home', exact: true }).evaluate(el => el.getBoundingClientRect().height);
    assert.ok(tabHeight >= 44, `mobile tab touch target must be >=44px (got ${tabHeight}px)`);

    // Simulate Android beforeinstallprompt -> Install button appears in Workspace and drawer.
    await page.evaluate(() => {
      const ev = new Event('beforeinstallprompt');
      ev.prompt = async () => {};
      ev.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(ev);
    });
    await tabbar.getByRole('button', { name: 'More sections' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Install app', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Use on your phone (iPhone & Android)' }).waitFor();
    await page.getByRole('button', { name: 'Install Plainhand app', exact: true }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '01-android-workspace-light.png'), fullPage: false });

    // Dark mode mobile check + screenshot.
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const darkThemeColor = await page.locator('meta[name="theme-color"]').first().getAttribute('content');
    assert.equal(darkThemeColor, '#0f0f10', 'theme-color updates for dark mode');
    await page.screenshot({ path: path.join(SHOTS, '02-android-workspace-dark.png'), fullPage: false });

    // Axe accessibility check on mobile Workspace (dark).
    const mobileAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(mobileAxe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'mobile workspace passes WCAG 2.1 AA');

    // Android Web Share Target pre-populates Add a job and cleans the query string.
    await page.goto(localBase + '/?share_title=Robotics+Engineer+at+Northstar&share_text=Role+link+https%3A%2F%2Fjobs.lever.co%2Fnorthstar%2F42#jobs');
    const dialog = page.getByRole('dialog', { name: 'Add a job' });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Company').inputValue(), 'Northstar');
    assert.equal(await dialog.getByLabel('Role').inputValue(), 'Robotics Engineer');
    assert.equal(await dialog.getByLabel('Job posting URL').inputValue(), 'https://jobs.lever.co/northstar/42');
    assert.equal(await page.evaluate(() => location.search), '', 'share query params cleaned from URL');
    await page.screenshot({ path: path.join(SHOTS, '03-android-share-target.png'), fullPage: false, animations: 'disabled' });
    await page.keyboard.press('Escape');

    // Offline fallback: when offline, navigating to / serves branded /offline.html from SW cache.
    await androidContext.setOffline(true);
    await page.goto(localBase + '/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'You’re offline' }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '04-offline-fallback.png'), fullPage: false });
    await androidContext.setOffline(false);
    await androidContext.close();

    // 2. iPhone Safari experience (375x667 compact iPhone SE): iOS install guide dialog + zero overflow + axe.
    const iosContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    });
    const iosPage = await iosContext.newPage();
    iosPage.on('pageerror', e => errors.push('ios: ' + e.message));
    iosPage.on('console', m => { if (m.type() === 'error') errors.push('ios-console: ' + m.text()); });

    await iosPage.goto(localBase + '/#workspace');
    await iosPage.getByRole('button', { name: 'Add to iPhone Home Screen', exact: true }).click();
    await iosPage.getByRole('dialog', { name: 'Install Plainhand on iPhone' }).waitFor();
    assert.equal(await iosPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow on 375px iPhone SE');
    await iosPage.screenshot({ path: path.join(SHOTS, '05-iphone-install-guide.png'), fullPage: false, animations: 'disabled' });
    const iosAxe = await new AxeBuilder({ page: iosPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(iosAxe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'iPhone install dialog passes WCAG 2.1 AA');
    await iosContext.close();

    // 3. Hosted mobile experience: sign-in page, landing page, and signed-in mobile workspace at 390px + axe.
    const hostedMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const hostedPage = await hostedMobile.newPage();
    hostedPage.on('pageerror', e => errors.push('hosted: ' + e.message));
    hostedPage.on('console', m => { if (m.type() === 'error') errors.push('hosted-console: ' + m.text()); });

    await hostedPage.goto(hosted.base + '/signin');
    await hostedPage.getByRole('heading', { name: 'Sign in to Plainhand' }).waitFor();
    assert.equal(await hostedPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'hosted /signin fits 390px');
    await hostedPage.screenshot({ path: path.join(SHOTS, '06-hosted-signin-mobile.png'), fullPage: false });
    const signinAxe = await new AxeBuilder({ page: hostedPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(signinAxe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'hosted mobile /signin passes WCAG 2.1 AA');

    await hostedPage.goto(hosted.base + '/');
    await hostedPage.getByRole('heading', { level: 1, name: /Your job applications/ }).waitFor();
    assert.equal(await hostedPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'hosted landing fits 390px');

    await hostedMobile.close();

    const hostedAuthMobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      extraHTTPHeaders: { Cookie: '__Host-plainhand_session=alice' },
    });
    const hostedAuthPage = await hostedAuthMobile.newPage();
    hostedAuthPage.on('pageerror', e => errors.push('hosted-auth: ' + e.message));
    hostedAuthPage.on('console', m => { if (m.type() === 'error') errors.push('hosted-auth-console: ' + m.text()); });
    await hostedAuthPage.goto(hosted.base + '/#workspace');
    await hostedAuthPage.getByRole('heading', { name: 'Use on your phone (iPhone & Android)' }).waitFor();
    assert.equal(await hostedAuthPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'hosted mobile workspace fits 390px');
    await hostedAuthPage.screenshot({ path: path.join(SHOTS, '07-hosted-workspace-mobile.png'), fullPage: false });
    const hostedWsAxe = await new AxeBuilder({ page: hostedAuthPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(hostedWsAxe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'hosted mobile workspace passes WCAG 2.1 AA');
    await hostedAuthMobile.close();

    // 4. Desktop hides the mobile bottom tab bar completely.
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const desktopPage = await desktopCtx.newPage();
    await desktopPage.goto(localBase);
    await desktopPage.getByRole('heading', { name: 'Your next chapter starts here.' }).waitFor();
    assert.equal(await desktopPage.getByRole('navigation', { name: 'Mobile quick navigation' }).isVisible(), false, 'desktop hides mobile tab bar');
    await desktopCtx.close();

    assert.deepEqual(errors, [], 'no browser console or page errors across mobile & PWA flows');
  } finally {
    await browser?.close();
    await local.close();
    await hosted.close();
    await rm(root, { recursive: true, force: true });
  }
});

// E2E swarm #17: at phone width the role sheet used to cover the whole scrim and could not
// be dragged down, so Close and Escape were the only ways out.
test('phone role sheet leaves scrim to tap and closes when dragged down', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-pwa-sheet-'));
  const local = await createPlainhand({ root, providers: fixtureProviders });
  await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${local.server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    // No service worker: its first-install reload would race the navigation under test.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('heading', { name: 'Your next chapter starts here.' }).waitFor();
    await page.goto(base + '/?share_title=Robotics+Engineer+at+Northstar&share_text=Role+link+https%3A%2F%2Fjobs.lever.co%2Fnorthstar%2F42#jobs');
    const add = page.getByRole('dialog', { name: 'Add a job' });
    await add.waitFor();
    await add.getByRole('button', { name: 'Save role' }).click();
    await add.waitFor({ state: 'detached' });
    const sheet = page.getByRole('dialog', { name: 'Robotics Engineer at Northstar' });
    const openRole = async () => {
      if (await sheet.isVisible()) return;
      // The toast and bottom bar can sit over the row while it settles; open it directly.
      await page.locator('.job-title', { hasText: 'Robotics Engineer' }).first().evaluate(el => el.click());
      await sheet.waitFor();
    };
    await openRole();

    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet').getBoundingClientRect();
      const scrim = document.querySelector('.scrim').getBoundingClientRect();
      const x = 195, y = Math.round((scrim.top + sheet.top) / 2);
      return { sheetTop: sheet.top, scrimTop: scrim.top, hit: document.elementFromPoint(x, y)?.className, x, y };
    });
    assert.ok(geometry.sheetTop - geometry.scrimTop >= 16, `a scrim strip is visible above the sheet (${JSON.stringify(geometry)})`);
    assert.equal(geometry.hit, 'scrim');
    await page.mouse.click(geometry.x, geometry.y);
    await sheet.waitFor({ state: 'detached' });
    await page.waitForTimeout(500); // let the close settle before reopening, as a person would

    await openRole();
    // Measured right before each drag: the save toast leaving moves the sheet up.
    const drag = async distance => {
      const box = await page.locator('.sheet-handle').boundingBox();
      assert.ok(box && box.height >= 20, 'the drag handle is visible at phone width');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + distance, { steps: 8 });
      await page.mouse.up();
    };
    await drag(60);
    assert.equal(await sheet.isVisible(), true, 'a short drag snaps back');
    await drag(400);
    await sheet.waitFor({ state: 'detached' });
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
