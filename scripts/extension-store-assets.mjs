#!/usr/bin/env node
// Store images from the real extension: dist/store/screenshot-1.png (1280x800, the
// popup on an application page) and promo-small.png (440x280). Run after changes
// to the popup so the listing never shows an old interface.
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extension'), OUT = path.join(ROOT, 'dist/store');
await mkdir(OUT, { recursive: true });
const icon = (await readFile(path.join(EXTENSION, 'icon.svg'), 'utf8'));
const profile = await mkdtemp(path.join(tmpdir(), 'plainhand-store-'));
const context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`] });
try {
  let [worker] = context.serviceWorkers(); worker ||= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 120 });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForTimeout(600);
  const shot = (await popup.screenshot({ fullPage: true })).toString('base64');
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<html><body style="margin:0;font:16px system-ui;background:#eef0ea;display:flex;height:800px">
  <div style="flex:1;padding:64px 56px;color:#1d1f1a"><div style="width:72px">${icon}</div>
  <h1 style="font-size:44px;line-height:1.15;margin:28px 0 16px">Fill job applications<br>with your approved answers</h1>
  <p style="font-size:21px;line-height:1.5;color:#45493f;max-width:560px">Save jobs in one click. Fill application forms from the resume, cover letter and answers you approved in Plainhand. You check every field and press Submit yourself.</p></div>
  <div style="width:460px;display:flex;align-items:center;justify-content:center"><img src="data:image/png;base64,${shot}" style="width:380px;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.18)"></div></body></html>`);
  await page.screenshot({ path: path.join(OUT, 'screenshot-1.png') });
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<html><body style="margin:0;width:440px;height:280px;background:#0e241d;color:#eef6e6;font:16px system-ui;display:flex;align-items:center;gap:22px;padding:0 36px;box-sizing:border-box">
  <div style="width:84px;flex:none">${icon}</div><div><div style="font-size:32px;font-weight:700">Plainhand</div><div style="font-size:17px;line-height:1.4;margin-top:8px;color:#cfe6c0">Your approved answers, filled in. You submit.</div></div></body></html>`);
  await page.screenshot({ path: path.join(OUT, 'promo-small.png') });
  console.log('dist/store/screenshot-1.png, dist/store/promo-small.png');
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
