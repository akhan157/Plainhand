import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { ApplicationBrowser } from './plainhand/jobs.mjs';
import { Workspace } from './plainhand/store.mjs';

const job = { id: 'portal', url: 'https://jobs.lever.co/synthetic/123' };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-portal-'));
  const storage = new Workspace(root);
  const runtime = new ApplicationBrowser({ storage, solver: null, launch: async options => {
    const browser = await chromium.launch({ ...options, headless: true });
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await createContext(config);
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await createPage();
        await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic portal</h1><label>Password<input type="password" name="password"></label>' }));
        return page;
      };
      return context;
    };
    return browser;
  } });
  return { root, storage, runtime, close: async () => { await runtime.closeAll(); await rm(root, { recursive: true, force: true }); } };
}

test('a saved portal session is indexed by origin without exposing cookies', async () => {
  const h = await fixture();
  try {
    await h.runtime.saveSession({ job, context: { storageState: async () => ({ cookies: [{ name: 'session', value: 'secret' }], origins: [] }) } });
    const sessions = await h.runtime.portalSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].origin, 'https://jobs.lever.co');
    assert.match(sessions[0].savedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(JSON.stringify(sessions), /secret|session/);
    const index = await h.storage.read('data/plainhand/browser/index.json');
    assert.doesNotMatch(index, /secret/);
  } finally { await h.close(); }
});

test('an expired saved session is reported as expiry, not as a first-time login', async () => {
  const h = await fixture();
  try {
    await h.storage.write(h.runtime.stateFile(job), JSON.stringify({ cookies: [], origins: [] }));
    await h.runtime.open(job, true);
    const status = await h.runtime.status(job.id);
    assert.equal(status.state, 'login');
    assert.equal(status.expiredSession, true);
    assert.match(status.message, /saved session .* has expired/i);
  } finally { await h.close(); }
});
