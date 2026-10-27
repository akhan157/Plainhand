import { chromium } from 'playwright';
import { LocalAudioSolver, recaptchaFrame } from './solvers/local-audio.mjs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { pickComboboxOption } from './adapters/upstream/option-match.mjs';
import { isResumeLabel } from './adapters/upstream/resume-label.mjs';
import { setSubmissionGuard } from './browser-guard.mjs';
import { navigationSnapshot, executeNavigation } from './browser-driver.mjs';
import { extractForm } from './adapters/upstream/extract.mjs';
import { isSubmitControl } from './adapters/upstream/submit-guard.mjs';
import { ResumeTransfers } from './browser-transfers.mjs';
import { ashbySchemaRead } from './browser-schema.mjs';
import { nativeChoices, fillNativeChoices } from './adapters/native-choices.mjs';
import { isSensitiveLabel } from './field-policy.mjs';
import { AuditLog } from './audit.mjs';
export { isSensitiveLabel };
const transfers = new WeakMap();
const FIELD_SELECTOR = 'input,textarea,select,[role="combobox"],[contenteditable="true"]';
const formShape = fields => JSON.stringify(fields.map(f => [f.key, f.name, f.label, f.type, f.required, f.options, f.sectionContext]));
import greenhouse from '../providers/greenhouse.mjs';
import lever from '../providers/lever.mjs';
import ashby from '../providers/ashby.mjs';
import workable from '../providers/workable.mjs';
import smartrecruiters from '../providers/smartrecruiters.mjs';
import recruitee from '../providers/recruitee.mjs';

export const ATS_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'jobs.lever.co', 'jobs.eu.lever.co', 'jobs.ashbyhq.com']);
const API_HOSTS = new Set(['boards-api.greenhouse.io', 'api.lever.co', 'api.ashbyhq.com']);
function portalAsset(url) {
  return url.hostname === 'job-boards.cdn.greenhouse.io' && url.pathname.startsWith('/assets/') ||
    /^s\d+-recruiting\.cdn\.greenhouse\.io$/.test(url.hostname) && url.pathname.startsWith('/external_greenhouse_job_boards/') ||
    url.hostname === 'cdn.lever.co' && /^\/(?:fonts|css|js|images)\//.test(url.pathname) ||
    url.hostname === 'cdn.ashbyprd.com' && /^\/(?:frontend_non_user|cdn_assets)\//.test(url.pathname) ||
    url.hostname === 'app.ashbyhq.com' && url.pathname.startsWith('/api/images/') ||
    /^[a-z0-9-]+\.myworkdaycdn\.com$/.test(url.hostname) && url.pathname.startsWith('/wday/asset/');
}
// Employer portals are public sites only: never loopback, private ranges or mDNS.
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[[0-9a-f:.]*\])$/i;
const PRIVATE_RANGES = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]]) PRIVATE_RANGES.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE_RANGES.addSubnet(net, bits, 'ipv6');
const resolvedHosts = new Map();
// True when a hostname is, or resolves to, a loopback, private, link-local or
// multicast address. Checked on every browser request, so a public-looking name
// pointing at the candidate's own network is refused too.
export async function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(hostname)) return true;
  // BlockList also matches IPv4 rules against IPv4-mapped IPv6 (::ffff:a.b.c.d).
  const blocked = address => PRIVATE_RANGES.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
  if (isIP(host)) return blocked(host);
  if (!resolvedHosts.has(host)) {
    resolvedHosts.set(host, lookup(host, { all: true }).then(list => list.some(a => blocked(a.address)), () => false));
    setTimeout(() => resolvedHosts.delete(host), 60_000).unref();
  }
  return resolvedHosts.get(host);
}
export function jobUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a complete HTTPS job URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS job URL without credentials or custom ports.');
  if (PRIVATE_HOST.test(url.hostname)) throw new Error('Use a public job URL; local and private addresses are not supported.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^ref$|^source$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
// Job boards whose terms prohibit automated use. Plainhand saves their postings but
// never opens them in its browser; applying goes to the employer's own site.
const BOARD_HOST = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|monster\.com|simplyhired\.com|joinhandshake\.com|wellfound\.com)$/i;
export function isBoardUrl(value) { try { return BOARD_HOST.test(new URL(value).hostname); } catch { return false; } }
// Where the application browser goes: the employer's link for a board posting.
export function applicationTarget(job) {
  if (!isBoardUrl(job.url)) return job;
  if (!job.applyUrl) throw new Error(`Plainhand doesn't open ${new URL(job.url).hostname.replace(/^www\./, '')} pages. Add the employer's application link from the posting, then continue.`);
  if (isBoardUrl(job.applyUrl)) throw new Error('Use the employer’s own application link, not another job board page.');
  return { ...job, url: job.applyUrl };
}
export function supportedUrl(value) { return ATS_HOSTS.has(new URL(jobUrl(value)).hostname); }
// A portal is any public HTTPS hiring site. Known ATS hosts are fully supported;
// any other employer portal is supported on its own registrable domain, so its
// frames, assets and same-site endpoints load without widening writes.
export function portalRoot(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (ATS_HOSTS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}
export function portalFrame(frameUrl, root) {
  try {
    const hostname = new URL(frameUrl).hostname.toLowerCase();
    return ATS_HOSTS.has(hostname) || (root && (hostname === root || hostname.endsWith('.' + root) || portalRoot(frameUrl) === root));
  } catch { return false; }
}
export async function browserAvailable() {
  let browser;
  try { browser = await chromium.launch({ headless: true }); return true; }
  catch { return false; }
  finally { await browser?.close(); }
}

const DISCOVERY_HOSTS = new Set([...API_HOSTS, 'apply.workable.com', 'api.smartrecruiters.com']);
function discoveryTarget(target) {
  const parsed = new URL(target);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
    (DISCOVERY_HOSTS.has(parsed.hostname) || /^[a-z0-9-]+\.recruitee\.com$/i.test(parsed.hostname));
}
export async function discover(source, filter = '', location = '') {
  const url = jobUrl(source.url);
  const entry = { name: source.name, careers_url: url };
  // Reuse the career-ops provider adapters behind a Plainhand-owned boundary.
  const provider = [greenhouse, lever, ashby, workable, smartrecruiters, recruitee].find(p => p.detect(entry));
  if (!provider) throw new Error('Use a supported company board URL (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, or Recruitee).');
  const request = async (target, options = {}) => {
    if (!discoveryTarget(target)) throw new Error('Unsupported discovery endpoint.');
    const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs || 30000) });
    if (!response.ok) throw new Error(`The job source returned HTTP ${response.status}. Retry later.`);
    return response;
  };
  const jobs = await provider.fetch(entry, {
    fetchJson: async (target, options = {}) => (await request(target, options)).json(),
    fetchText: async (target, options = {}) => (await request(target, options)).text(),
  });
  const terms = filter.toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return jobs.filter(j => j.url && (!terms.length || terms.some(t => j.title.toLowerCase().includes(t))) && (!location || j.location.toLowerCase().includes(location.toLowerCase()))).slice(0, 100);
}

// Public ATS and the job's own portal root can receive browser navigation.
// Writes stay blocked except a scoped approved-resume attachment transfer.
export async function guardBrowser(context, root = null) {
  await setSubmissionGuard(context, true, [...ATS_HOSTS, ...(root ? [root] : [])]);
  if (!transfers.has(context)) transfers.set(context, new ResumeTransfers(context));
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (!['https:', 'data:', 'blob:'].includes(url.protocol)) return route.abort();
    if (url.protocol === 'https:' && await privateHost(url.hostname)) return route.abort();
    const challengeHost = url.hostname === 'www.google.com' && url.pathname.startsWith('/recaptcha/') || url.hostname === 'www.recaptcha.net' || url.hostname === 'www.gstatic.com' || url.hostname === 'hcaptcha.com' || url.hostname.endsWith('.hcaptcha.com') || url.hostname === 'challenges.cloudflare.com';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !(challengeHost && req.method() === 'POST')) {
      if (ashbySchemaRead(req)) return route.fallback();
      const transfer = await transfers.get(context).allow(req);
      if (transfer) return route.fallback(transfer);
      const active = transfers.get(context).active;
      if (active) active.events.push({ kind: 'blocked', state: 'failed' });
      return route.abort();
    }
    const portalHost = root && (url.hostname === root || url.hostname.endsWith('.' + root));
    // Portals load bundles, fonts and images from sibling infrastructure domains
    // (Workday: wd5.myworkday.com). Read-only static resources may come from any
    // HTTPS host; fetch/XHR stay restricted, so page code cannot pull arbitrary
    // endpoints. Writes remain blocked above.
    const staticAsset = ['GET', 'HEAD'].includes(req.method()) && ['script', 'stylesheet', 'font', 'image', 'media', 'manifest', 'texttrack', 'other'].includes(req.resourceType());
    if (url.protocol === 'https:' && !challengeHost && !portalHost && !portalAsset(url) && !staticAsset && ![...ATS_HOSTS, ...API_HOSTS, 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'ajax.googleapis.com', 'cdn.greenhouse.io', 'boards.cdn.greenhouse.io'].includes(url.hostname)) return route.abort();
    return route.fallback();
  });
}

export async function verifyJob(job) {
  if (isBoardUrl(job.url)) {
    if (!job.applyUrl) return { state: 'unverified', legitimacy: 'job-board', description: job.description || '', checkedAt: new Date().toISOString(), reason: 'Saved from a job board Plainhand does not open automatically. Paste the description to evaluate; add the employer’s application link to apply.' };
    job = { ...job, url: job.applyUrl };
  }
  const root = portalRoot(job.url);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await guardBrowser(context, root);
    const page = await context.newPage();
    const response = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('h1').first().waitFor({ timeout: 6000 }).catch(() => {});
    const snapshot = await page.evaluate(() => ({ title: document.querySelector('h1')?.innerText || document.title, text: document.body.innerText, apply: [...document.querySelectorAll('a,button,input[type=submit]')].some(e => /apply|submit application/i.test(e.innerText || e.value || '')) }));
    const expired = /job (?:is )?no longer available|job (?:has been|is) closed|position (?:has been|is) filled|job not found|opening (?:has been|is) closed/i.test(snapshot.text);
    const titleWords = job.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const titleMatch = titleWords.length > 0 && titleWords.every(w => snapshot.title.toLowerCase().includes(w));
    const active = response?.ok() && !expired && titleMatch && snapshot.text.length > 400 && snapshot.apply;
    return { state: expired || response?.status() === 404 ? 'closed' : active ? 'active' : 'unconfirmed', legitimacy: active ? 'official-ats-unconfirmed-employer' : 'unconfirmed', reason: active ? 'Title, job description, and application control observed on a supported ATS. Employer identity is not independently verified.' : expired ? 'The posting appears closed.' : 'Could not confirm the exact role and a live application form. Review the original posting.', checkedAt: new Date().toISOString(), title: snapshot.title, description: snapshot.text.slice(0, 45000), url: page.url() };
  } catch (error) { return { state: 'unconfirmed', legitimacy: 'unconfirmed', reason: /Executable|browserType.launch/.test(error.message) ? 'Install Chromium with npx playwright install chromium, then verify again.' : 'Browser verification could not finish. The site may need manual access; retry or paste the description.', checkedAt: new Date().toISOString(), description: job.description || '' }; }
  finally { await browser?.close(); }
}

export function applicationFields(fields) {
  if (fields.some(f => f.type === 'file' || /(?:first|last|full|given|family).?name|e.?mail|phone|resume|résumé|\bcv\b|cover letter|linkedin|portfolio|project|education|university|experience/i.test(f.label))) return fields;
  return fields.every(f => /^(search|filter|keywords?|department|location|office)\b/i.test(f.label)) ? [] : fields;
}

export async function fieldsOn(page) {
  const fields = [];
  let root = null;
  try { root = portalRoot(page.url()); } catch {}
  for (const [frameIndex, frame] of page.frames().entries()) {
    const frameUrl = frame.url() === 'about:blank' ? page.url() : frame.url();
    if (!portalFrame(frameUrl, root)) continue;
    const form = await extractForm(frame);
    for (const field of form.fields) {
      if (['password', 'checkbox', 'radio'].includes(field.type)) continue;
      const selector = `[data-co-field="${field.id}"]`;
      const locator = frame.locator(selector);
      const metadata = await locator.evaluate((node, allFields) => ({
        index: [...document.querySelectorAll(allFields)].indexOf(node),
        type: node.type || '', name: node.name || '', value: node.type === 'file' ? '' : node.value ?? node.textContent ?? '',
        disabled: !!node.disabled || node.getAttribute('aria-disabled') === 'true',
        hiddenContainer: (() => { for (let parent = node.parentElement; parent; parent = parent.parentElement) { const style = getComputedStyle(parent); if (parent.hidden || style.display === 'none' || style.visibility === 'hidden') return true; } return false; })(),
        options: node.tagName === 'SELECT' ? [...node.options].map(o => ({ value: o.value, label: o.text })) : [],
        sectionContext: (() => {
          const section = node.closest('fieldset,[role="group"],[data-section]');
          if (!section) return null;
          const heading = section.querySelector(':scope > legend,:scope > h2,:scope > h3,:scope > h4');
          const label = (section.getAttribute('aria-label') || heading?.textContent || section.getAttribute('data-section') || '').trim().slice(0, 160);
          if (!label) return null;
          const peers = [...document.querySelectorAll('fieldset,[role="group"],[data-section]')].filter(el => {
            const h = el.querySelector(':scope > legend,:scope > h2,:scope > h3,:scope > h4');
            return (el.getAttribute('aria-label') || h?.textContent || el.getAttribute('data-section') || '').trim().slice(0, 160) === label;
          });
          return { label, index: peers.indexOf(section), count: peers.length };
        })(),
      }), FIELD_SELECTOR);
      if (metadata.type === 'password' || metadata.disabled || metadata.hiddenContainer) continue;
      const type = field.combobox ? 'combobox' : field.type === 'select' ? 'select-one' : field.type;
      fields.push({ ...field, ...metadata, type, label: field.label || field.nativeName || field.nativeId || 'Unlabelled field', selector, frameIndex, key: `${frameIndex}:${metadata.index}` });
    }
  }
  try { fields.push(...(await nativeChoices(page)).map(field => ({ ...field, native: true, frameIndex: 0 }))); } catch {}
  return applicationFields(fields);
}

// Inspect actual visible challenges, not merely the presence of an invisible CAPTCHA script.
export async function browserObservation(page, fields = [], jobRoot = null) {
  const root = jobRoot || (() => { try { return portalRoot(page.url()); } catch { return null; } })();
  if (!root) return { state: 'unsupported', message: 'The application left the supported hiring portal.' };
  if (jobRoot && !portalFrame(page.url(), jobRoot)) return { state: 'unsupported', message: 'The application left the supported hiring portal.' };
  let finalReview = false;
  // Every major verification vendor, not only Google and Cloudflare. A vendor
  // frame is a human-attention state even when its UI renders in a shadow root.
  const vendorChallenge = page.frames().some(frame => {
    try {
      const host = new URL(frame.url()).hostname;
      return /(^|\.)captcha-delivery\.com$|(^|\.)arkoselabs\.com$|(^|\.)funcaptcha\.com$|(^|\.)hcaptcha\.com$|(^|\.)challenges\.cloudflare\.com$|(^|\.)perimeterx\.net$|(^|\.)px-cdn\.net$/.test(host);
    } catch { return false; }
  });
  for (const frame of page.frames()) {
    if (recaptchaFrame(frame.url(), 'anchor') && await frame.locator('#recaptcha-anchor').getAttribute('aria-checked', { timeout: 1000 }).catch(() => 'true') !== 'true') return { state: 'challenge', message: 'reCAPTCHA verification is required.' };
    const challenge = await frame.locator('[data-plainhand-challenge], .h-captcha iframe, iframe[src*="bframe"], iframe[src*="challenges.cloudflare.com"]').filter({ visible: true }).count().catch(() => 0);
    const text = await frame.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (challenge || vendorChallenge || /verify (?:that )?you are human|complete the (?:security check|captcha)|checking your browser|unusual traffic|press (?:and|&) hold|are you a robot/i.test(text)) return { state: 'challenge', message: 'A browser verification needs attention. Resolve it in the application browser, then resume here.' };
    if (await frame.locator('input[type="password"]:visible,input[autocomplete="one-time-code"]:visible').count().catch(() => 0)) return { state: 'login', message: 'Sign-in or a verification code is required. Complete it in the application browser, then resume here.' };
    // Workday and similar portals gate the form behind SSO buttons, not a password field.
    if (/sign in with (?:apple|google|email)|welcome! create an account|create an? account to (?:manage|continue)/i.test(text)) return { state: 'login', message: 'Create an account or sign in for this portal, then resume inspection. Filled answers are preserved.' };
    try {
      if (portalFrame(frame.url(), root) && await frame.getByRole('button', { name: /submit application|send application|^submit$/i }).filter({ visible: true }).count()) finalReview = true;
    } catch {}
  }
  if (!fields.length && finalReview) return { state: 'review', message: 'The form is at a review or submission step. Review it in the browser; submission is yours.' };
  if (!fields.length && (await navigationSnapshot(page, url => portalFrame(url, root))).controls.length) return { state: 'navigating', message: 'Application controls found. Autofill can navigate to the form.' };
  return fields.length ? { state: 'ready', message: 'Application fields are ready.' } : { state: 'unsupported', message: 'No supported form fields were found. Open the original posting to continue manually.' };
}

// Verification vendors with no local adapter. Detection only; the candidate clears them.
export function vendorVerification(page) {
  for (const frame of page.frames()) {
    try {
      const host = new URL(frame.url()).hostname;
      if (/(^|\.)hcaptcha\.com$/.test(host)) return 'hCaptcha';
      if (/(^|\.)captcha-delivery\.com$/.test(host)) return 'DataDome';
      if (/(^|\.)arkoselabs\.com$|(^|\.)funcaptcha\.com$/.test(host)) return 'Arkose';
      if (/(^|\.)perimeterx\.net$|(^|\.)px-cdn\.net$/.test(host)) return 'PerimeterX';
    } catch {}
  }
  return null;
}
export async function solveTurnstile(page) {
  const frame = page.frames().find(f => {
    try {
      const url = new URL(f.url());
      return url.protocol === 'https:' && (url.hostname === 'challenges.cloudflare.com' || url.hostname.endsWith('.challenges.cloudflare.com'));
    } catch { return false; }
  });
  if (!frame) return { state: 'unsupported', message: 'No Cloudflare Turnstile challenge found.' };

  const existingToken = await page.locator('[name="cf-turnstile-response"]').inputValue().catch(() => '');
  if (existingToken && existingToken.length > 20) {
    return { state: 'solved', message: 'Cloudflare Turnstile verified non-interactively.' };
  }

  try {
    const el = await frame.frameElement().catch(() => null);
    if (!el) return { state: 'blocked', message: 'Turnstile challenge frame is not accessible.' };
    const box = await el.boundingBox();
    if (!box) return { state: 'blocked', message: 'Turnstile challenge frame is not visible.' };

    const targetX = box.x + 30;
    const targetY = box.y + box.height / 2;

    await page.mouse.move(box.x, box.y);
    await new Promise(r => setTimeout(r, 60));
    await page.mouse.move(targetX, targetY, { steps: 20 });
    await new Promise(r => setTimeout(r, 100));
    await page.mouse.down();
    await new Promise(r => setTimeout(r, 70));
    await page.mouse.up();

    for (let i = 0; i < 20; i++) {
      const token = await page.locator('[name="cf-turnstile-response"]').inputValue().catch(() => '');
      if (token && token.length > 20) {
        return { state: 'solved', message: 'Cloudflare Turnstile verified via natural interaction.' };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return { state: 'blocked', message: 'Turnstile interaction did not complete. Complete it in the browser.' };
  } catch (error) {
    return { state: 'blocked', message: `Turnstile resolution error: ${error.message}` };
  }
}

export class ApplicationBrowser {
  constructor({ launch, storage, solver = storage && process.env.PLAINHAND_CAPTCHA_SOLVER !== 'off' ? new LocalAudioSolver({ root: storage.root }) : null } = {}) {
    this.sessions = new Map();
    this.launch = launch || (options => chromium.launch({
      ...options,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        ...(options?.args || []),
      ],
    }));
    this.storage = storage;
    this.solver = solver;
    this.audit = storage ? new AuditLog(storage) : null;
  }
  stateFile(job) {
    return `data/plainhand/browser/${createHash('sha256').update(new URL(job.url).origin).digest('hex').slice(0, 24)}.json`;
  }
  async saveSession(session) {
    if (!this.storage) return;
    // Authentication stays local and out of exports/model context. Never copy the default browser profile.
    const state = await session.context.storageState();
    const file = this.stateFile(session.job);
    await this.storage.write(file, JSON.stringify(state));
    // A small index makes saved portal sessions inspectable without reversing the
    // origin hash. Cookies still live only in the per-origin state file.
    const indexFile = 'data/plainhand/browser/index.json';
    let index = {};
    try { index = JSON.parse(await this.storage.read(indexFile)) || {}; } catch {}
    index[file] = { origin: new URL(session.job.url).origin, savedAt: new Date().toISOString() };
    await this.storage.write(indexFile, JSON.stringify(index));
  }
  async portalSessions() {
    if (!this.storage) return [];
    let index = {};
    try { index = JSON.parse(await this.storage.read('data/plainhand/browser/index.json')) || {}; } catch {}
    return Object.entries(index)
      .map(([file, meta]) => ({ origin: meta?.origin, savedAt: meta?.savedAt, file: file.split('/').pop() }))
      .filter(entry => entry.origin && entry.savedAt)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }
  async inspect(job) {
    const session = this.sessions.get(job.id);
    if (!session || session.page.isClosed()) return this.open(job);
    if (session.handedOff) { await guardBrowser(session.context, session.root); session.handedOff = false; }
    await this.saveSession(session);
    session.fields = await fieldsOn(session.page);
    session.observation = await browserObservation(session.page, session.fields, session.root);
    return session.fields;
  }
  async status(id) {
    const session = this.sessions.get(id);
    if (!session || session.page.isClosed()) return { state: 'closed', message: 'Open the application to continue.' };
    const observation = await browserObservation(session.page, await fieldsOn(session.page), session.root);
    if (observation.state === 'login' && session.savedSession) {
      Object.assign(observation, {
        expiredSession: true,
        message: `Your saved session for ${new URL(session.job.url).hostname} has expired. Sign in again in the application browser; the refreshed session is saved for this portal.`,
      });
    }
    return session.observation = { ...observation, ...(session.browser.liveUrl ? { liveUrl: session.browser.liveUrl, managed: true } : {}) };
  }
  async resolveChallenge(job) {
    const session = this.sessions.get(job.id);
    if (!session || session.handedOff) throw new Error('Inspect the application before resolving verification.');
    const current = await this.status(job.id);
    if (current.state !== 'challenge') return current;
    const hasTurnstile = session.page.frames().some(f => f.url().includes('challenges.cloudflare.com'));
    if (hasTurnstile) {
      const turnstileOutcome = await solveTurnstile(session.page);
      await this.saveSession(session);
      if (turnstileOutcome.state === 'solved') {
        await this.audit?.append({ action: 'verify', reason: 'Cloudflare Turnstile resolved locally', jobId: job.id, outcome: turnstileOutcome.state }).catch(() => {});
        return { ...await this.status(job.id), solver: { id: 'turnstile', ...turnstileOutcome } };
      }
    }
    if (this.solver && await this.solver.ready()) {
      const outcome = await this.solver.solve(session.page);
      await this.saveSession(session);
      if (outcome.state !== 'unsupported') return { ...await this.status(job.id), solver: { id: 'local-audio', ...outcome } };
    }
    if (session.browser.managed) return this.waitForChallenge(job);
    const vendor = vendorVerification(session.page);
    if (vendor) return { ...current, solver: { id: 'vendor', state: 'manual', message: `${vendor} has no local adapter. Clear it in the application browser; filled answers are preserved and autofill resumes once it clears.` } };
    return { ...current, solver: { id: 'local-audio', state: 'unavailable', message: 'Install the free local audio solver with npm run setup:captcha.' } };
  }
  async waitForChallenge(job, timeout = 120000) {
    const session = this.sessions.get(job.id);
    if (!session || session.page.isClosed()) return this.status(job.id);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const status = await this.status(job.id);
      if (status.state !== 'challenge') {
        await this.saveSession(session);
        return status;
      }
      const anchor = session.page.frames().find(f => recaptchaFrame(f.url(), 'anchor'));
      if (anchor) {
        const checked = await anchor.locator('#recaptcha-anchor').getAttribute('aria-checked', { timeout: 300 }).catch(() => '');
        if (checked === 'true') {
          await this.saveSession(session);
          return this.status(job.id);
        }
      }
      const token = await session.page.locator('[name="cf-turnstile-response"]').inputValue().catch(() => '');
      if (token && token.length > 20) {
        await this.saveSession(session);
        return this.status(job.id);
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    }
    return this.status(job.id);
  }
  async navigate(job, planner, { maxTurns = 5, requireTransition = false } = {}) {
    const session = this.sessions.get(job.id);
    if (!session || session.handedOff) throw new Error('Inspect the application before navigating.');
    const trace = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const fields = await fieldsOn(session.page);
      const observation = await browserObservation(session.page, fields);
      if (['login', 'challenge'].includes(observation.state)) return { ...observation, trace };
      if (!requireTransition && fields.length) return { state: 'ready', trace };
      const snapshot = await navigationSnapshot(session.page, url => portalFrame(url, session.root));
      if (!snapshot.controls.length) return { state: 'review', message: 'No supported navigation remains. Review the current application.', trace };
      const before = JSON.stringify(fields.map(f => [f.name, f.label, f.type]));
      const key = createHash('sha256').update(JSON.stringify([session.page.url(), snapshot.fingerprint, before])).digest('hex');
      if (trace.some(item => item.key === key)) return { state: 'paused', message: 'The page did not change after navigation. Your progress is preserved.', trace };
      const action = await planner({ controls: snapshot.controls, turn, previous: trace.map(({ action, result }) => ({ action, result })) });
      if (action?.action === 'stop') return { state: 'paused', message: 'Your agent stopped navigation for review.', trace };
      const result = await executeNavigation(session.page, snapshot, action, url => portalFrame(url, session.root));
      trace.push({ key, action: { action: action?.action, label: snapshot.offered.get(action?.ref)?.label || '' }, result });
      session.navigationTrace = [...session.navigationTrace || [], ...trace.slice(-1)].slice(-30);
      if (!result.performed) return { state: 'paused', message: result.reason, trace };
      for (let attempt = 0; attempt < 15; attempt++) {
        const current = await fieldsOn(session.page);
        if (JSON.stringify(current.map(f => [f.name, f.label, f.type])) !== before) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const updated = await this.inspect(job);
      const after = await this.status(job.id);
      if (['login', 'challenge'].includes(after.state)) return { ...after, trace };
      if (updated.length && (!requireTransition || JSON.stringify(updated.map(f => [f.name, f.label, f.type])) !== before)) return { state: 'ready', trace };
    }
    return { state: 'paused', message: 'Navigation reached its five-action limit. Inspect progress to continue.', trace };
  }
  async attention(id) {
    const session = this.sessions.get(id);
    if (!session || session.page.isClosed()) throw new Error('Open the application first.');
    await setSubmissionGuard(session.context, false, [...ATS_HOSTS, session.root].filter(Boolean));
    await session.context.unroute('**/*');
    session.handedOff = true;
    // Explicit user action only; background runs never steal desktop focus.
    await session.page.bringToFront();
    await this.audit?.append({ action: 'handoff', reason: 'candidate takes the browser for sign-in or verification', jobId: id, artifact: new URL(session.job.url).hostname }).catch(() => {});
    return { state: 'paused', message: `Sign in to ${new URL(session.job.url).hostname} or complete verification, then use Resume inspection. The portal session is saved locally for next time.` };
  }
  async advance(job) {
    const session = this.sessions.get(job.id);
    if (!session || session.handedOff) throw new Error('Inspect the application before continuing.');
    const observation = await this.status(job.id);
    if (observation.state !== 'ready') return { advanced: false, ...observation };
    // Deliberately narrow: a submit-type button, ambiguous label or handler is never advanced.
    const matches = [];
    const frames = session.page.frames().filter(frame => portalFrame(frame.url() === 'about:blank' ? session.page.url() : frame.url(), session.root));
    for (const frame of frames) {
      const candidates = frame.locator('button[type="button"],input[type="button"]');
      for (let i = 0; i < await candidates.count(); i++) {
        const button = candidates.nth(i);
        const label = (await button.innerText().catch(() => '') || await button.getAttribute('value') || '').trim();
        const facts = await button.evaluate(el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', inForm: !!el.form || !!el.closest('form'), aria: el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '), text: el.textContent, value: el.value, title: el.title }));
        if (!isSubmitControl(facts) && /^(next|next step|continue|save and continue)$/i.test(label) && await button.isVisible() && await button.isEnabled()) matches.push({ button, frame });
      }
    }
    if (matches.length !== 1) return { advanced: false, state: 'review', message: 'No unambiguous next-step control. Review the application in its browser.' };
    const before = JSON.stringify((await fieldsOn(session.page)).map(f => [f.name, f.label, f.type]));
    const invalid = await matches[0].frame.locator('input:visible:invalid,textarea:visible:invalid,select:visible:invalid,[aria-invalid="true"]:visible').count();
    if (invalid) return { advanced: false, state: 'needs-answers', message: 'Complete required fields before continuing.' };
    await matches[0].button.click();
    await session.page.waitForLoadState('domcontentloaded');
    // Client-rendered steps can settle after the click completes.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (before !== JSON.stringify((await fieldsOn(session.page)).map(f => [f.name, f.label, f.type]))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (before === JSON.stringify((await fieldsOn(session.page)).map(f => [f.name, f.label, f.type]))) return { advanced: false, state: 'review', message: 'The next step did not expose a different form. Review the browser before continuing.' };
    await this.inspect(job);
    return { advanced: true, ...await this.status(job.id) };
  }
  async open(job, headless = false) {
    job = applicationTarget(job);
    const root = portalRoot(job.url);
    const existing = this.sessions.get(job.id);
    if (existing && !existing.page.isClosed()) return this.inspect(job);
    await this.close(job.id);
    let browser;
    try {
      browser = await this.launch({ headless });
      const saved = this.storage ? await this.storage.read(this.stateFile(job)) : '';
      const context = await browser.newContext({ serviceWorkers: 'block', ...(saved ? { storageState: JSON.parse(saved) } : {}) });
      await context.addInitScript(() => {
        try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
        try {
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel(R) Iris(R) Xe Graphics';
            return getParameter.apply(this, [param]);
          };
          const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel(R) Iris(R) Xe Graphics';
            return getParameter2.apply(this, [param]);
          };
        } catch {}
      });
      await guardBrowser(context, root);
      const page = await context.newPage();
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('h1').first().waitFor({ timeout: 5000 }).catch(() => {});
      let fields = await fieldsOn(page);
      if (!fields.length) {
        const applyLinks = await page.locator('a[href]').evaluateAll(nodes => nodes.filter(n => /apply/i.test(n.innerText) && /\/apply(?:[/?#]|$)/.test(n.href)).map(n => n.href));
        const next = applyLinks.find(url => portalFrame(url, root));
        if (next) { await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 30000 }); fields = await fieldsOn(page); }
      }
      let observation = await browserObservation(page, fields, root);
      if (saved && observation.state === 'login') {
        observation = { ...observation, message: `Your saved session for ${new URL(job.url).hostname} has expired. Sign in again in the application browser; the refreshed session is saved for this portal.`, expiredSession: true };
      }
      // Portals such as Workday and Workable mount the form or its Apply control
      // after first paint, so a single snapshot at load time under-reports.
      for (let attempt = 0; attempt < 16 && !fields.length && (observation.state === 'unsupported' || (observation.state === 'navigating' && attempt < 6)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 750));
        fields = await fieldsOn(page);
        observation = await browserObservation(page, fields, root);
        if (fields.length) break;
        // Wait a few seconds for a late-rendering form (Ashby takes up to ~4 s) before
        // deciding the page needs navigation, which costs model calls.
        if (attempt < 6) continue;
        const navigation = await navigationSnapshot(page, url => portalFrame(url, root));
        if (navigation.controls.length) {
          observation = { state: 'navigating', message: 'Application controls found. Autofill can navigate to the form.' };
          break;
        }
      }
      if (!fields.length && observation.state === 'unsupported') throw new Error(observation.message);
      if (!portalFrame(page.url(), root)) throw new Error('The application left the supported portal. Continue manually.');
      this.sessions.set(job.id, { browser, context, page, fields, job, root, observation, handedOff: false, savedSession: Boolean(saved) });
      return fields;
    } catch (error) {
      await browser?.close();
      if (/XServer|DISPLAY|headed browser|Executable doesn't exist/.test(error.message)) throw new Error('A local desktop and Playwright Chromium are required for form assistance. Run Plainhand on your computer, install Chromium, and retry.');
      throw error;
    }
  }
  async fill(job, answers, pdfPath, coverPath = null) {
    const session = this.sessions.get(job.id);
    if (!session || session.handedOff) throw new Error('Open and inspect the application again before filling.');
    const observation = await this.status(job.id);
    if (observation.state !== 'ready') throw new Error(observation.message);
    const current = await fieldsOn(session.page);
    if (formShape(current) !== formShape(session.fields)) throw new Error('The form changed. Inspect it again before filling.');
    const filled = [], skipped = [], failed = [], uploads = [];
    // Exactly-once upload: the same approved PDF on the same page is never sent
    // twice, so a same-page retry cannot create a second server-side object.
    session.uploads ??= new Map();
    const resumeKey = pdfPath && Object.values(answers).includes('__resume__')
      ? `${session.page.url()}|${createHash('sha256').update(await readFile(pdfPath)).digest('hex')}`
      : null;
    let formChanged = false;
    for (const field of current) {
      // Radio groups are filled by their own native adapter after this loop.
      if (field.native) continue;
      // Conditional fields can be inserted between answers. Never apply a stale
      // positional key to a different control after a client-side re-render.
      if (formShape(await fieldsOn(session.page)) !== formShape(current)) { formChanged = true; break; }
      let value = answers[field.key];
      if (typeof value === 'string' && field.type !== 'file') value = value.slice(0, field.maxLength > 0 ? Math.min(field.maxLength, 20000) : 20000);
      const locator = session.page.frames()[field.frameIndex].locator(field.selector || FIELD_SELECTOR).nth(field.selector ? 0 : field.index);
      const filledBefore = filled.length;
      try {
      if (field.type === 'file') {
        if (value === '__cover_letter__' && coverPath) {
          // The approved cover letter, uploaded exactly once per page like the resume.
          const coverKey = `${session.page.url()}|cover|${createHash('sha256').update(await readFile(coverPath)).digest('hex')}`;
          if (session.uploads.get(coverKey) === 'server-accepted') { uploads.push({ label: field.label, state: 'server-accepted', reused: true }); filled.push(field.label); continue; }
          const policy = transfers.get(session.context), transfer = await policy.begin(coverPath, session.page.frames()[field.frameIndex]);
          let upload;
          try { await locator.setInputFiles(coverPath); }
          finally { upload = await policy.finish(transfer); uploads.push({ label: field.label, ...upload }); }
          if (['failed', 'pending', 'unconfirmed'].includes(upload.state)) { failed.push(field.label); continue; }
          if (upload.state === 'server-accepted') session.uploads.set(coverKey, 'server-accepted');
          filled.push(field.label);
        } else if (value === '__resume__' && pdfPath) {
          if (resumeKey && session.uploads.get(resumeKey) === 'server-accepted') {
            uploads.push({ label: field.label, state: 'server-accepted', reused: true });
            filled.push(field.label);
            continue;
          }
          const policy = transfers.get(session.context), transfer = await policy.begin(pdfPath, session.page.frames()[field.frameIndex]);
          let upload;
          try { await locator.setInputFiles(pdfPath); }
          finally { upload = await policy.finish(transfer); uploads.push({ label: field.label, ...upload }); }
          if (['failed', 'pending', 'unconfirmed'].includes(upload.state)) { failed.push(field.label); continue; }
          if (resumeKey && upload.state === 'server-accepted') session.uploads.set(resumeKey, 'server-accepted');
          filled.push(field.label);
        }
        else skipped.push(field.label);
      } else if (typeof value === 'string' && value.trim()) {
        if (field.type === 'select-one') {
          if (!field.options.some(o => o.value === value)) throw new Error(`Choose an available option for ${field.label}.`);
          await locator.selectOption(value);
        } else if (field.type === 'combobox') {
          await locator.click();
          const tag = await locator.evaluate(el => el.tagName);
          if (tag === 'INPUT') await locator.fill(value.slice(0, 20000));
          const options = session.page.frames()[field.frameIndex].getByRole('option').filter({ visible: true });
          await options.first().waitFor({ timeout: 2000 }).catch(() => {});
          const option = pickComboboxOption(await options.allTextContents(), value);
          if (option < 0) { skipped.push(field.label); await locator.press('Escape'); continue; }
          await options.nth(option).click();
        } else await locator.fill(value.slice(0, 20000));
        filled.push(field.label);
      } else skipped.push(field.label);
      if (filled.length > filledBefore) {
        const actual = await locator.evaluate(el => el.type === 'file' ? el.files?.[0]?.name || '' : el.value ?? el.textContent ?? '');
        const expected = field.type === 'file' ? (value === '__cover_letter__' ? coverPath : pdfPath).split(/[\\/]/).at(-1) : value;
        let retained = String(actual).trim() === String(expected).trim();
        if (field.type === 'combobox') {
          const selected = await locator.evaluate(el => {
            const group = el.closest('[class*="select__container"], [class*="field-entry"], [class*="form-group"], [class*="question"], label') || el.parentElement;
            const display = group?.querySelector('[class*="singleValue"], [class*="single-value"], [data-selected-value]');
            return [el.getAttribute('aria-valuetext'), el.value, el.tagName === 'INPUT' ? '' : el.textContent, display?.textContent].filter(Boolean);
          });
          retained = pickComboboxOption(selected, value) >= 0;
        }
        if (!retained) {
          filled.splice(filled.lastIndexOf(field.label), 1); failed.push(field.label);
        }
      }
      } catch { failed.push(field.label); }
    }
    const choices = await fillNativeChoices(session.page, current, answers);
    filled.push(...choices.filled); skipped.push(...choices.skipped); failed.push(...choices.failed);
    await new Promise(resolve => setTimeout(resolve, 200));
    if (formShape(await fieldsOn(session.page)) !== formShape(current)) formChanged = true;
    const validation = [];
    for (const frame of session.page.frames()) {
      try {
        if (!portalFrame(frame.url(), session.root)) continue;
        validation.push(...await frame.locator('[aria-invalid="true"]:visible,[role="alert"]:visible').allTextContents());
      } catch {}
    }
    await this.saveSession(session);
    await this.audit?.append({ action: 'fill', reason: 'approved packet answers applied to the portal', jobId: job.id, artifact: pdfPath ? pdfPath.split('/').pop() : null, outcome: `${filled.length} filled, ${uploads.length} uploads, ${failed.length} failed` }).catch(() => {});
    return { filled, skipped, failed, uploads, formChanged, validation: validation.map(text => text.trim().slice(0, 500)).filter(Boolean).slice(0, 20), note: formChanged ? 'The portal changed its questions. Completed answers are preserved; inspect the new fields before continuing.' : 'No buttons were clicked. Attachment status distinguishes local file selection from a server-accepted transfer. Check sensitive fields and required questions in the browser.' };
  }
  async handoff(id) {
    const session = this.sessions.get(id);
    if (!session || session.handedOff) throw new Error('No active application browser to hand over.');
    await setSubmissionGuard(session.context, false, [...ATS_HOSTS, session.root].filter(Boolean));
    await session.context.unroute('**/*');
    session.handedOff = true;
    await session.page.bringToFront();
  }
  async close(id) { const session = this.sessions.get(id); if (session) { try { if (!session.page.isClosed()) await this.saveSession(session); } finally { await session.browser.close(); this.sessions.delete(id); } } }
  async closeAll() {
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)));
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) throw new Error('Some browser sessions could not close. Check any managed browsers in your provider account.');
  }
}

// The candidate's links by kind, from the free-text links field.
export function profileLinks(profile) {
  const urls = String(profile?.links || '').match(/https?:\/\/[^\s,;]+/gi) || [];
  const of = rx => urls.find(u => rx.test(u)) || '';
  const linkedin = of(/linkedin\.com/i), github = of(/github\.com/i);
  return { linkedin, github, website: urls.find(u => u !== linkedin && u !== github) || '' };
}

// Standard identity fields answered from the profile, with no model call. Name
// variants a person would choose themselves (preferred name, pronunciation,
// pronouns) are left to them; "legal name" is the name, not a legal question.
export function defaultFieldAnswers(fields, profile) {
  const answers = {};
  const links = profileLinks(profile);
  const personal = /prefer|pronunc|pronoun|nick/;
  for (const field of fields) {
    const label = field.label.toLowerCase();
    if (field.sectionContext && /education|employment|experience|project/i.test(field.sectionContext.label)) continue;
    const name = !personal.test(label) && field.type !== 'file';
    if (name && /(first|given) ?name/.test(label)) { answers[field.key] = profile.name.split(' ')[0]; continue; }
    if (name && /(last|family) ?name|surname/.test(label)) { answers[field.key] = profile.name.split(' ').slice(1).join(' '); continue; }
    if (name && /^\W*(full |legal |your )?(full )?name\W*$|^\W*(full|legal) name/.test(label)) { answers[field.key] = profile.name; continue; }
    if (isSensitiveLabel(label)) continue;
    if (field.type === 'file') {
      if (/cover.?letter/.test(label)) answers[field.key] = '__cover_letter__';
      else if (isResumeLabel(label)) answers[field.key] = '__resume__';
    }
    else if (field.type === 'email' || /e.?mail/.test(label)) answers[field.key] = profile.email;
    else if (/phone|mobile/.test(label)) answers[field.key] = profile.phone;
    else if (/linkedin/.test(label)) answers[field.key] = links.linkedin;
    else if (/github/.test(label)) answers[field.key] = links.github;
    else if (/portfolio|website|personal (site|url)/.test(label)) answers[field.key] = links.website;
    else if (/^\W*(current )?(location|city)\b/.test(label) && field.type !== 'select-one') answers[field.key] = profile.location;
  }
  for (const key of Object.keys(answers)) if (!answers[key]) delete answers[key];
  return answers;
}
