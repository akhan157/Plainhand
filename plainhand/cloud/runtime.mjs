// Cloud-only browser adapter. Never use the host's Playwright browser or fetch a pack.
import chromium from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright';
import { renderPacket } from '../workflow.mjs';

// Single-flight extraction prevents simultaneous cold requests from seeing a partial executable.
let executable;
export async function launchCloudBrowser() {
  executable ??= chromium.executablePath().catch(() => { executable = null; throw new Error('Bundled browser extraction failed.'); });
  return playwright.launch({ args: chromium.args, executablePath: await executable, headless: true, timeout: 10000 });
}

export async function renderCloudDocuments(documents, { launch = launchCloudBrowser, timeoutMs = 25000 } = {}) {
  let browser, expired = false, timer;
  const work = (async () => {
    browser = await launch();
    if (expired) { await browser.close(); throw new Error('Render expired.'); }
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', offline: true });
    // Defense in depth: no HTTP, DNS, file URLs, profile links, scripts or remote fonts.
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const output = [];
    for (const html of documents) {
      if (expired) throw new Error('Render expired.');
      await page.setContent('<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; font-src data:; img-src data:">' + html, { waitUntil: 'load', timeout: 8000 });
      await page.evaluate(() => document.fonts.ready);
      output.push(await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 8000 }));
    }
    return output;
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('PDF rendering timed out. Try again.')); }, timeoutMs); })]);
  } catch { throw new Error('PDF rendering could not finish. Retry or contact support with the request ID.'); }
  finally { clearTimeout(timer); await browser?.close().catch(() => {}); }
}
export const renderCloudPacket = (workspace, state, job, packet) => renderPacket(workspace, state, job, packet, { renderDocuments: renderCloudDocuments });

// No network fetch is treated as verification. The local browser verifier stays unchanged.
export async function verifyCloudJob(job) {
  return { state: 'unconfirmed', legitimacy: 'unconfirmed', checkedAt: new Date().toISOString(), description: job.description || '', reason: 'Hosted browser posting verification is not enabled. Review the original employer posting and application form manually.' };
}
