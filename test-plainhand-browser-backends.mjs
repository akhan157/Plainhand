import test from 'node:test';
import assert from 'node:assert/strict';
import { browserUseLaunch, configuredBrowserLaunch } from './plainhand/browser-backends.mjs';

test('cloud backend is opt-in, requires a key, and uses no shell or third-party model', async () => {
  assert.equal(configuredBrowserLaunch({}), undefined);
  assert.throws(() => configuredBrowserLaunch({ PLAINHAND_BROWSER_BACKEND: 'unknown' }), /must be/);
  await assert.rejects(browserUseLaunch()(), /requires/);
});

test('managed browser is explicitly stopped to end billing; local auth state restores into its context', async () => {
  const requests = [], cookies = [];
  let closed = false, init = false;
  const context = { addCookies: async values => cookies.push(...values), addInitScript: async () => { init = true; } };
  const launch = browserUseLaunch({ key: 'synthetic-key', fetcher: async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, status: 200, json: async () => requests.length === 1 ? { id: 'test-session', cdpUrl: 'wss://cdp.browser-use.com/test', liveUrl: 'https://live.browser-use.com/test' } : {} };
  }, connect: async url => { assert.equal(url, 'wss://cdp.browser-use.com/test'); return { contexts: () => [context], close: async () => { closed = true; } }; } });
  const browser = await launch();
  assert.equal(browser.managed, true);
  await browser.newContext({ storageState: { cookies: [{ name: 'test', value: 'synthetic' }], origins: [{ origin: 'https://jobs.lever.co', localStorage: [] }] } });
  assert.equal(cookies.length, 1); assert.equal(init, true);
  assert.equal(JSON.parse(requests[0].body).solveCaptchas, true);
  await browser.close();
  assert.equal(requests[1].method, 'PATCH');
  assert.equal(JSON.parse(requests[1].body).action, 'stop');
  assert.equal(closed, true);
});

test('failed or hostile CDP connection cleans up the created managed session without leaking its address', async () => {
  let stopped = false, connected = false;
  const launch = browserUseLaunch({ key: 'synthetic-key', fetcher: async (url, options) => {
    if (options.method === 'PATCH') stopped = true;
    return { ok: true, status: 200, json: async () => ({ id: 'test-session', cdpUrl: 'wss://attacker.invalid/secret-token' }) };
  }, connect: async () => { connected = true; } });
  await assert.rejects(launch(), error => /session was stopped/.test(error.message) && !error.message.includes('secret-token'));
  assert.equal(stopped, true); assert.equal(connected, false);
});
