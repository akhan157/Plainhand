// Explicit live vendor-demo check. No employer page or application is submitted.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { LocalAudioSolver } from './plainhand/solvers/local-audio.mjs';
import { guardBrowser } from './plainhand/jobs.mjs';

if (!process.argv.includes('--live')) {
  console.log('Opt-in: node test-plainhand-solver-live.mjs --live (one public reCAPTCHA demo attempt).');
  process.exit(0);
}
const root = process.cwd();
const output = path.join(root, 'output', 'local-captcha-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const solver = new LocalAudioSolver({ root });
if (!await solver.ready()) throw new Error('Run npm run setup:captcha first.');
const browser = await chromium.launch({ headless: true });
const result = { checkedAt: new Date().toISOString(), target: 'Google public reCAPTCHA demo', solver: 'local Whisper tiny.en CPU', paidApiCalls: 0, employerSubmissions: 0, success: false };
try {
  const context = await browser.newContext();
  await guardBrowser(context);
  const page = await context.newPage();
  await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.frameLocator('iframe[src*="/anchor"]').locator('#recaptcha-anchor').waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(output, 'before.png'), fullPage: true });
  result.outcome = await solver.solve(page);
  result.success = result.outcome.state === 'solved';
  await page.screenshot({ path: path.join(output, 'after.png'), fullPage: true });
} catch { result.outcome = { state: 'blocked', message: 'The public demo or challenge was unavailable during this attempt.' }; }
finally {
  await browser.close();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
  process.exitCode = result.success ? 0 : 1;
}
