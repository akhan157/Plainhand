// Routes the production ApplicationBrowser at an owned synthetic portal, captures
// the values after every fill, and keeps all execution on the local machine.
import { chromium } from 'playwright';
import { ApplicationBrowser } from '../jobs.mjs';
import { renderPortal, portalUrl } from './portals.mjs';

export async function readValues(page) {
  if (!page || page.isClosed()) return {};
  try {
    return await page.evaluate(() => {
      const out = {};
      for (const node of document.querySelectorAll('input,textarea,select')) {
        if (!node.name) continue;
        const value = node.type === 'checkbox' ? (node.checked ? 'on' : '') : node.type === 'file' ? '' : node.value;
        const file = node.type === 'file' ? node.files?.[0]?.name || '' : '';
        out[node.name] = { value, file, type: node.type || node.tagName.toLowerCase() };
      }
      return out;
    });
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
  };
}
