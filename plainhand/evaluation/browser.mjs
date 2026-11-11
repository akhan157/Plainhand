// Routes the production ApplicationBrowser at an owned synthetic portal, captures
// the values after every fill, and keeps all execution on the local machine.
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { ApplicationBrowser } from '../jobs.mjs';
import { renderPortal, portalUrl } from './portals.mjs';

// Reads every named control. A file input records the name, byte size and SHA-256
// of the file actually attached in the DOM, so the scorer can prove which bytes
// the app uploaded instead of trusting the file name. The portal is served on an
// https origin (a secure context), so the page hashes with crypto.subtle; if that
// is ever unavailable the bytes come back as base64 and are hashed here.
export async function readValues(page) {
  if (!page || page.isClosed()) return {};
  try {
    const values = await page.evaluate(async () => {
      const out = {};
      const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      for (const node of document.querySelectorAll('input,textarea,select')) {
        if (!node.name) continue;
        if (node.type === 'radio') {
          out[node.name] ??= { value: '', file: '', type: 'radio' };
          if (node.checked) out[node.name].value = node.value;
          continue;
        }
        const value = node.type === 'checkbox' ? (node.checked ? 'on' : '') : node.type === 'file' ? '' : node.value;
        const attached = node.type === 'file' ? node.files?.[0] || null : null;
        const entry = { value, file: attached?.name || '', type: node.type || node.tagName.toLowerCase() };
        if (attached) {
          const buffer = await attached.arrayBuffer();
          entry.bytes = buffer.byteLength;
          if (globalThis.crypto?.subtle) entry.sha256 = hex(await crypto.subtle.digest('SHA-256', buffer));
          else {
            let binary = '';
            const view = new Uint8Array(buffer);
            for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
            entry.base64 = btoa(binary);
          }
        }
        out[node.name] = entry;
      }
      return out;
    });
    for (const entry of Object.values(values)) {
      if (entry.base64 === undefined) continue;
      entry.sha256 = createHash('sha256').update(Buffer.from(entry.base64, 'base64')).digest('hex');
      entry.hashedIn = 'node';
      delete entry.base64;
    }
    return values;
  } catch { return {}; }
}

export function stepOf(url) {
  try {
    const parsed = new URL(url);
    return Number(parsed.searchParams.get('step') || parsed.pathname.match(/\/step(\d+)$/)?.[1] || 1);
  } catch { return 1; }
}

export function createSandboxBrowser({ scenario }) {
  let page;
  const snapshots = [];
  const application = new ApplicationBrowser({
    launch: async () => {
      const browser = await chromium.launch({ headless: true });
      const createContext = browser.newContext.bind(browser);
      browser.newContext = async options => {
        const context = await createContext(options);
        const createPage = context.newPage.bind(context);
        context.newPage = async () => {
          page = await createPage();
          await page.route('https://jobs.lever.co/**', route => {
            if (route.request().method() !== 'GET') return route.abort();
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: renderPortal({ scenario, step: stepOf(route.request().url()) }) });
          });
          return page;
        };
        return context;
      };
      return browser;
    },
  });
  const fill = application.fill.bind(application);
  application.fill = async (job, answers, pdfPath, coverPath) => {
    const result = await fill(job, answers, pdfPath, coverPath);
    snapshots.push({ url: page?.url() || portalUrl(scenario), step: stepOf(page?.url() || ''), values: await readValues(page) });
    return result;
  };
  return {
    application,
    scenario,
    snapshots,
    get page() { return page; },
    readValues: () => readValues(page),
    // Candidate intervention after the app's fill: snapshots stay what the app
    // produced; the returned map is the DOM after these answers were entered.
    async fillAsCandidate(candidateAnswers = {}) {
      if (!page || page.isClosed()) return {};
      for (const [name, rawValue] of Object.entries(candidateAnswers)) {
        const control = page.locator(`[name="${name}"]`);
        if (await control.count() === 0) continue;
        const { tag, type } = await control.first().evaluate(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '' }));
        if (type === 'checkbox') {
          if (rawValue) await control.first().check();
          else await control.first().uncheck();
        } else if (tag === 'select' || type === 'select-one') {
          await control.first().selectOption(String(rawValue));
        } else if (type === 'radio') {
          await page.locator(`input[type="radio"][name="${name}"][value="${String(rawValue)}"]`).check();
        } else {
          await control.first().fill(String(rawValue));
        }
      }
      return await readValues(page);
    },
  };
}
