// Plainhand extension background (Manifest V3 service worker).
//
// Owns the Plainhand account session (an OAuth access token for the hosted
// API), the script injection into the active tab, and the multi-frame fill
// orchestration the popup starts. Nothing here ever fills or submits a form on
// its own: every action starts from a popup click.
import { freshToken } from './oauth.js';

const VENDOR = '/vendor/plainhand-vendor.js';
const CONTENT = '/content/fill.js';

// ── storage ─────────────────────────────────────────────────────────────────
const get = async keys => (await chrome.storage.local.get(keys)) || {};
const set = entries => chrome.storage.local.set(entries);

async function api(path, options = {}) {
  const { site = 'https://plainhand.test' } = await get(['site']);
  const token = await freshToken();
  if (!token) throw new Error('Connect Plainhand first: open the popup and sign in.');
  const response = await fetch(site + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  if (response.status === 401) { await set({ token: null, refreshToken: null }); throw new Error('Plainhand needs you to sign in again.'); }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Plainhand said ${response.status}.`);
  }
  return response;
}

// ── scripting ───────────────────────────────────────────────────────────────
async function ensureInjected(tabId) {
  // chrome.scripting.executeScript is idempotent per frame for a given file,
  // and fill.js itself guards against a second copy.
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [VENDOR, CONTENT] });
}


async function callPlainhand(tabId, method, ...args) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (method, args) => globalThis.__plainhand ? globalThis.__plainhand[method](...args) : null,
    args: [method, args],
  });
  return injection?.result || null;
}

// Host permissions for a frame the form lives in, requested on first use.
async function ensureFrameAccess(tab, frames) {
  const origins = new Set();
  for (const url of frames) { try { origins.add(new URL(url).origin + '/*'); } catch {} }
  const missing = [];
  for (const origin of origins) {
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (!granted) missing.push(origin);
  }
  if (missing.length) {
    // optional_host_permissions in the manifest gates what can be asked for.
    const allowed = await chrome.permissions.request({ origins: missing });
    if (!allowed) throw new Error('Plainhand needs access to the application form frame to fill it. Click again and allow it.');
  }
}

// ── popup actions ───────────────────────────────────────────────────────────
const actions = {
  async 'read-page'(tab) {
    await ensureInjected(tab.id);
    const frames = await callPlainhand(tab.id, 'read');
    return frames;
  },

  // "Save this job": the posting's company, title, link and description.
  async 'save-job'(tab) {
    await ensureInjected(tab.id);
    const [posting] = (await callPlainhand(tab.id, 'posting')).filter(Boolean);
    if (!posting || !posting.company || !posting.title) throw new Error('This page does not look like a job posting.');
    const response = await api('/api/extension/save-job', { method: 'POST', body: JSON.stringify(posting) });
    const saved = await response.json();
    return saved;
  },

  // "Fill this page": read the form, match the role, plan answers, fill.
  async 'fill-page'(tab) {
    await ensureInjected(tab.id);
    const reads = (await callPlainhand(tab.id, 'read')).filter(Boolean);
    const withFields = reads.filter(r => r.fields.length);
    if (!withFields.length) throw new Error('No application form was found on this page.');
    await ensureFrameAccess(tab, withFields.flatMap(r => r.frames || []));
    const main = withFields.sort((a, b) => b.fields.length - a.fields.length)[0];
    const matchResponse = await api('/api/extension/match', { method: 'POST', body: JSON.stringify({ url: main.url }) });
    const { match, text } = await matchResponse.json();
    if (!match) throw new Error(text || 'This page is not one of your saved roles.');
    if (match.packet !== 'approved') throw new Error(match.text || 'Approve the application in Plainhand first, then fill here.');
    const planResponse = await api('/api/extension/plan', { method: 'POST', body: JSON.stringify({ jobId: match.jobId, fields: main.fields }) });
    const plan = await planResponse.json();
    const files = {};
    if (plan.files.resume) {
      const resume = await (await api(`/api/extension/file?jobId=${encodeURIComponent(match.jobId)}&kind=resume`, { headers: {} })).blob();
      files.resume = { name: 'resume.pdf', base64: await blobToBase64(resume) };
    }
    if (plan.files.cover) {
      const cover = await (await api(`/api/extension/file?jobId=${encodeURIComponent(match.jobId)}&kind=cover`)).blob();
      files.cover = { name: 'cover-letter.pdf', base64: await blobToBase64(cover) };
    }
    const results = [];
    for (const read of withFields) {
      const fields = read.fields.filter(f => plan.answers[f.id] !== undefined);
      if (!fields.length) continue;
      const fill = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (fields, answers, identity, files) => globalThis.__plainhand ? globalThis.__plainhand.fill({ fields, answers, identity, files }) : null,
        args: [fields, plan.answers, plan.identity, files],
      });
      for (const frame of fill) if (frame?.result) results.push(frame.result);
    }
    const filled = results.flatMap(r => r.filled), skipped = results.flatMap(r => r.skipped), failed = results.flatMap(r => r.failed);
    return { match, plan, filled, skipped, failed, left: plan.left || [] };
  },

  // "I submitted this": records Applied on the matched role. Candidate only.
  async 'mark-submitted'(tab) {
    await ensureInjected(tab.id);
    const reads = (await callPlainhand(tab.id, 'read')).filter(Boolean);
    const urls = [tab.url, ...reads.map(r => r.url)];
    for (const url of urls) {
      const matchResponse = await api('/api/extension/match', { method: 'POST', body: JSON.stringify({ url }) });
      const { match } = await matchResponse.json();
      if (match) {
        const response = await api('/api/extension/submitted', { method: 'POST', body: JSON.stringify({ jobId: match.jobId }) });
        return await response.json();
      }
    }
    throw new Error('No saved Plainhand role matches this page.');
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const action = actions[message?.type];
    if (!tab || !action) throw new Error('Open the job page you want to use, then click again.');
    return action(tab, message.input || {});
  };
  run().then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true; // async response
});

chrome.runtime.onInstalled.addListener(() => { chrome.action.setBadgeBackgroundColor({ color: '#2563eb' }); });
chrome.runtime.onStartup?.addListener(() => {});

