import { chromium } from 'playwright';

// Browser reasoning remains with the candidate's selected CLI. This optional
// adapter replaces only the browser infrastructure, not the reasoning provider.
export function browserUseLaunch({ key, fetcher = fetch, connect = url => chromium.connectOverCDP(url), country = 'us' } = {}) {
  return async () => {
    if (!key) throw new Error('Browser Use Cloud requires BROWSER_USE_API_KEY. Local browsing remains available.');
    async function request(endpoint, method, body) {
      const response = await fetcher(`https://api.browser-use.com/api/v4/browsers${endpoint}`, {
        method, headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Browser service returned HTTP ${response.status}. Check browser account access and usage limits.`);
      return response.status === 204 ? {} : response.json();
    }
    const remote = await request('', 'POST', { proxyCountryCode: country, solveCaptchas: true });
    if (typeof remote.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(remote.id)) throw new Error('Browser service did not return a valid session ID.');
    const stop = () => request('/' + remote.id, 'PATCH', { action: 'stop' });
    let browser;
    try {
      const cdp = new URL(remote.cdpUrl);
      if (cdp.protocol !== 'wss:' || !(cdp.hostname === 'browser-use.com' || cdp.hostname.endsWith('.browser-use.com'))) throw new Error('Browser service returned an unexpected connection address.');
      browser = await connect(remote.cdpUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error('The managed browser has no application context.');
      let liveUrl;
      try { const url = new URL(remote.liveUrl); if (url.protocol === 'https:' && url.hostname.endsWith('.browser-use.com')) liveUrl = url.href; } catch {}
      return {
        managed: true, liveUrl,
        newContext: async options => {
          if (options.storageState?.cookies?.length) await context.addCookies(options.storageState.cookies);
          // Restore only the exact origin's localStorage when its document loads.
          const origins = options.storageState?.origins || [];
          if (origins.length) await context.addInitScript(saved => {
            const entry = saved.find(item => item.origin === location.origin);
            for (const item of entry?.localStorage || []) localStorage.setItem(item.name, item.value);
          }, origins);
          return context;
        },
        close: async () => {
          try { await stop(); } finally { await browser.close(); }
        },
      };
    } catch (error) {
      let stopped = false;
      try { await stop(); stopped = true; } catch {}
      await browser?.close().catch(() => {});
      // CDP credentials must never appear in application errors or logs.
      throw new Error(stopped ? 'Could not connect to the managed application browser. The session was stopped.' : 'Could not connect or stop the managed browser. Stop its session in your Browser Use account.');
    }
  };
}

export function configuredBrowserLaunch(env = process.env) {
  const backend = env.PLAINHAND_BROWSER_BACKEND || 'local';
  if (backend === 'local') return undefined;
  if (backend !== 'browser-use') throw new Error('PLAINHAND_BROWSER_BACKEND must be local or browser-use.');
  return browserUseLaunch({ key: env.BROWSER_USE_API_KEY, country: env.PLAINHAND_BROWSER_COUNTRY || 'us' });
}
