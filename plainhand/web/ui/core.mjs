// Core runtime for the Plainhand front end: one shared store, the API client,
// the live event stream, small formatting helpers and the icon set.
import { html, useEffect, useReducer, useRef, useState } from '../vendor/preact-htm.mjs';

export { html, useEffect, useRef, useState, useReducer };
export { useMemo, useCallback, useLayoutEffect, render } from '../vendor/preact-htm.mjs';

export const token = document.querySelector('meta[name="plainhand-session"]')?.content || '';

// ---------------------------------------------------------------------------
// Store. A single mutable object plus subscribers. The root component
// subscribes and re-renders; Preact's keyed diff keeps inputs, focus and
// component state intact, so drafts are never lost on refresh.
// ---------------------------------------------------------------------------
const listeners = new Set();
export const store = {
  state: null,          // the workspace (live or sample)
  live: null,           // live workspace kept while the sample is shown
  demo: false,
  offline: false,
  offlineReason: '',
  providers: null,
  view: 'home',
  focus: null,          // { type: 'job', id, tab } shown in the context panel
  dialog: null,         // { type, ... } modal dialogs
  navOpen: false,
  toast: null,
};
let version = 0;
export function update(patch) {
  Object.assign(store, typeof patch === 'function' ? patch(store) : patch);
  version++;
  for (const listener of listeners) listener();
}
// Subscribing happens after paint; an update that landed in between is caught
// by comparing the version seen at render with the current one.
export function useStore() {
  const [, force] = useReducer(n => n + 1, 0);
  const seen = useRef(version);
  seen.current = version;
  useEffect(() => { listeners.add(force); if (seen.current !== version) force(); return () => listeners.delete(force); }, []);
  return store;
}

// Drafts survive re-renders, tab switches and closing a panel within the session.
const drafts = new Map();
export function useDraft(key, initial = {}) {
  const [, force] = useReducer(n => n + 1, 0);
  const value = drafts.has(key) ? drafts.get(key) : initial;
  const set = next => { drafts.set(key, typeof next === 'function' ? next(drafts.has(key) ? drafts.get(key) : initial) : next); force(); };
  const clear = () => { drafts.delete(key); force(); };
  return [value, set, clear, drafts.has(key)];
}
export function clearDraft(key) { drafts.delete(key); }

// ---------------------------------------------------------------------------
// Toasts live in the header's status region, which never overlaps content.
// ---------------------------------------------------------------------------
let toastTimer;
export function toast(text, error = false) {
  clearTimeout(toastTimer);
  update({ toast: { text, error, id: Date.now() } });
  toastTimer = setTimeout(() => update({ toast: null }), error ? 9000 : 5000);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export const DEMO_WRITE = 'This is a sample workspace. Leave the demo to connect your agent and use your own profile.';
export async function api(path, data) {
  if (store.demo && data !== undefined) throw new Error(DEMO_WRITE);
  const response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Plainhand-Token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Plainhand returned an unreadable response. Check that the local server is running.'); }
  if (!response.ok) { const error = new Error(result.error || 'Something went wrong. Please try again.'); error.code = result.code; error.status = response.status; throw error; }
  return result;
}

let lastText = null, seq = 0, applied = 0;
export async function refresh(force = false) {
  if (force) lastText = null;
  const mine = ++seq;
  try {
    const response = await fetch('/api/state', { headers: { 'X-Plainhand-Token': token } });
    const text = await response.text();
    if (!response.ok) {
      let message = 'Plainhand could not read your workspace.';
      try { message = JSON.parse(text).error || message; } catch {}
      throw Object.assign(new Error(message), { status: response.status });
    }
    if (mine < applied) return;
    applied = mine;
    const wasOffline = store.offline;
    if (text === lastText && !wasOffline) return;
    lastText = text;
    const next = JSON.parse(text);
    if (store.demo) update({ live: next, offline: false, offlineReason: '' });
    else update({ state: next, offline: false, offlineReason: '' });
  } catch (error) {
    if (!store.offline) update({ offline: true, offlineReason: error.status === 403 ? 'expired' : 'offline' });
  }
}

export async function loadProviders() {
  try { update({ providers: await api('providers') }); } catch (error) { toast(error.message, true); }
}

// ---------------------------------------------------------------------------
// Live event stream. `state` means the workspace changed; `tick` is a
// heartbeat that also catches edits made outside Plainhand. Unknown events
// are ignored; agent.* events go to whoever registered for them.
// ---------------------------------------------------------------------------
const eventHandlers = new Set();
export function onServerEvent(handler) { eventHandlers.add(handler); return () => eventHandlers.delete(handler); }
const AGENT_EVENTS = ['agent.turn', 'agent.delta', 'agent.message', 'agent.proposal', 'agent.task', 'agent.panel', 'agent.done', 'agent.error'];
let source = null, retryDelay = 1000, retryTimer = null;
export function connectEvents() {
  clearTimeout(retryTimer);
  source?.close();
  if (typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events?token=' + encodeURIComponent(token));
  source.addEventListener('open', () => { retryDelay = 1000; });
  source.addEventListener('state', () => refresh());
  source.addEventListener('tick', () => { if (document.visibilityState === 'visible') refresh(); });
  for (const name of AGENT_EVENTS) {
    source.addEventListener(name, event => {
      let data = null;
      try { data = JSON.parse(event.data); } catch { return; }
      for (const handler of eventHandlers) handler(name, data);
    });
  }
  source.addEventListener('error', () => {
    // The browser retries an interrupted stream by itself. A refused stream
    // (server restarted, token expired) closes; retry with backoff.
    refresh();
    if (source.readyState === EventSource.CLOSED) {
      retryTimer = setTimeout(connectEvents, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

// ---------------------------------------------------------------------------
// Navigation and panels
// ---------------------------------------------------------------------------
export const VIEWS = {
  home: 'Home', jobs: 'Jobs', campaigns: 'Campaigns', applications: 'Applications', profile: 'Profile & brain',
  activity: 'Activity', usage: 'AI usage', connections: 'Connections', workspace: 'Workspace',
  insights: 'Insights',
};
const ALIASES = { overview: 'home', discover: 'jobs', settings: 'workspace' };
export function viewFromHash(hash = location.hash) {
  const key = hash.replace(/^#\/?/, '');
  return VIEWS[key] ? key : ALIASES[key] || 'home';
}
export function navigate(view) {
  update({ navOpen: false });
  if (location.hash.slice(1) === view) { update({ view }); window.scrollTo(0, 0); return; }
  location.hash = view;
}
export const JOB_TABS = ['fit', 'packet', 'apply', 'record'];
// Work through several applications in a row: packets to review, then approved
// applications to fill and submit. Oldest first, so nothing waits forever.
export function queues(state) {
  const open = j => !j.submittedAt && !['Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded'].includes(j.status);
  const byAge = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));
  const jobs = (state?.jobs || []).filter(open).sort(byAge);
  return {
    review: jobs.filter(j => j.packet && !j.approvedHash && !j.stale && !(j.packet.questions || []).length && j.stage !== 'review-blocked').map(j => j.id),
    apply: jobs.filter(j => j.packet && j.approvedHash && !j.stale).map(j => j.id),
  };
}
export function openJob(id, tab = 'fit') { update({ focus: { type: 'job', id, tab: JOB_TABS.includes(tab) ? tab : 'fit' }, navOpen: false }); }
export function setJobTab(tab) { if (store.focus) update({ focus: { ...store.focus, tab } }); }
export function closePanel() { update({ focus: null }); }
export function openDialog(dialog) { update({ dialog }); }
export function closeDialog() { update({ dialog: null }); }
// Panel requests from the assistant (contract §1 `agent.panel`).
export function openPanelRequest(panel) {
  if (!panel) return;
  const tabs = { job: 'fit', evaluation: 'fit', packet: 'packet', document: 'packet', form: 'apply', record: 'record' };
  const pages = { discover: 'jobs', applications: 'applications', profile: 'profile', workspace: 'workspace' };
  if (panel.id && tabs[panel.type] && store.state?.jobs.some(j => j.id === panel.id)) openJob(panel.id, tabs[panel.type]);
  else if (tabs[panel.type]) navigate('jobs');
  else if (pages[panel.type] || VIEWS[panel.type]) navigate(pages[panel.type] || panel.type);
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------
export const ACTIVE = ['running', 'queued'];
export function runningTask(kind, jobId = null) {
  return store.state?.tasks.find(t => ACTIVE.includes(t.status) && (!kind || t.kind === kind) && (jobId === null || t.jobId === jobId)) || null;
}
export async function queueTask(kind, jobId = null, input = {}) {
  await api('tasks', { kind, jobId, ...input });
  toast('Queued. Your agent’s progress appears here and in Activity.');
  await refresh();
}
export const TASK_TITLES = { interview: 'Build candidate understanding', evaluate: 'Evaluate opportunity', prepare: 'Prepare application', discover: 'Discover opportunities', 'campaign-scan': 'Scan campaigns', standard: 'Write your standard application', revise: 'Revise application' };
// Known progress messages from plainhand/workflow.mjs, in order, so a task card
// can show where it is. Unknown messages fall back to an indeterminate bar.
const TASK_STEPS = {
  evaluate: ['Assembling your candidate context', 'Opening the posting to verify the exact role', 'Matching the role against your evidence'],
  prepare: ['Assembling your candidate context', 'Writing your resume, cover letter, and answers', 'Checking factual claims against the original sources', 'Correcting unsupported claims using the reviewer’s source checks', 'Rendering your application documents'],
  discover: ['Reading your saved job sources'],
  interview: ['Assembling your candidate context'],
};
export function taskProgress(task) {
  const steps = TASK_STEPS[task.kind] || [];
  if (task.status === 'queued') return { step: 0, total: steps.length || 1, label: 'Waiting for the agent' };
  let index = steps.indexOf(task.message);
  if (index < 0 && task.kind === 'discover' && /^Checking /.test(task.message)) index = 0;
  return index < 0 ? { step: null, total: steps.length, label: task.message } : { step: index + 1, total: steps.length, label: task.message };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const providerNames = { codex: 'ChatGPT', claude: 'Claude', antigravity: 'Antigravity' };
export const providerSymbol = id => id === 'codex' ? '◎' : id === 'claude' ? '✳' : '△';
export const initials = value => (value || 'You').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; }
}
export function hostOf(value) { try { return new URL(value).hostname; } catch { return value; } }
export function ago(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Calendar dates (YYYY-MM-DD) are shown in words but keep the exact date in <time>.
export function dayLabel(iso, { weekday = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
export function daysUntil(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
export function relativeDay(iso) {
  const n = daysUntil(iso);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export const Day = ({ iso, weekday = true }) => html`<time datetime=${iso}>${dayLabel(iso, { weekday })}</time>`;
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
export const SUBMITTED = ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'];
export const STATUSES = ['Evaluated', 'Apply', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

// ---------------------------------------------------------------------------
// Icons (24px stroke icons, drawn with currentColor)
// ---------------------------------------------------------------------------
const P = d => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const R = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx }];
const ICONS = {
  sun: [C(12, 12, 4), P('M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5')],
  moon: [P('M20.5 13A8.7 8.7 0 0 1 11 3.5 8.7 8.7 0 1 0 20.5 13Z')],
  home: [P('M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z')],
  brain: [P('M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5M15 4a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5M9 3v18M15 3v18M4 8h2l3 3M20 8h-2l-3 3M3 14h3l3-2M21 14h-3l-3-2')],
  search: [C(10.5, 10.5, 6.5), P('m16 16 5 5')],
  briefcase: [R(3, 7, 18, 14, 2), P('M8 7V4h8v3M3 12c6 4 12 4 18 0M10 13v3h4v-3')],
  activity: [P('M3 12h4l3-8 4 16 3-8h4')],
  gauge: [P('M4 18a8 8 0 1 1 16 0'), P('m12 14 4-5'), C(12, 14, 1.2)],
  plug: [P('m8 3 1 5m7-5-1 5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4')],
  settings: [C(12, 12, 3), P('m9 3-.5 2.5-2 1.2-2.5-.8-2 3.3 2 1.7v2.2l-2 1.7 2 3.3 2.5-.8 2 1.2L9 21h6l.5-2.5 2-1.2 2.5.8 2-3.3-2-1.7v-2.2l2-1.7-2-3.3-2.5.8-2-1.2L15 3Z')],
  arrow: [P('M4 12h16m-6-6 6 6-6 6')],
  chevron: [P('m9 5 7 7-7 7')],
  chevronDown: [P('m5 9 7 7 7-7')],
  plus: [P('M12 5v14M5 12h14')],
  check: [P('m5 12 4 4L19 6')],
  circle: [C(12, 12, 8)],
  checkCircle: [C(12, 12, 9), P('m7 12 3 3 7-7')],
  pin: [P('M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z'), C(12, 10, 2.5)],
  clock: [C(12, 12, 9), P('M12 7v5l3 2')],
  calendar: [R(3, 5, 18, 16, 2), P('M8 3v4m8-4v4M3 10h18')],
  star: [P('m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z')],
  spark: [P('m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4')],
  file: [P('M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h6')],
  shield: [P('m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6Z'), P('m8 11 3 3 5-6')],
  external: [P('M14 3h7v7m0-7L10 14M10 4H4v16h16v-6')],
  close: [P('m6 6 12 12M6 18 18 6')],
  upload: [P('M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6')],
  download: [P('M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5')],
  copy: [R(8, 8, 12, 13, 2), P('M16 8V3H3v13h5')],
  refresh: [P('M20 7a9 9 0 1 0 1 8M20 3v5h-5')],
  menu: [P('M4 6h16M4 12h16M4 18h16')],
  send: [P('m3 3 18 9-18 9 4-9Zm4 9h14')],
  trash: [P('M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7')],
  info: [C(12, 12, 9), P('M12 11v6M12 7h.01')],
  alert: [P('M12 3 2 20h20Z'), P('M12 10v4M12 17h.01')],
  user: [C(12, 8, 4), P('M4 21c1-4 4.5-6 8-6s7 2 8 6')],
  users: [C(9, 8, 3.5), P('M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.3 3.5 5')],
  inbox: [P('M3 13h5l1.5 3h5L16 13h5'), P('M5 5h14l2 8v6H3v-6Z')],
  flag: [P('M5 21V4m0 0h11l-2 4 2 4H5')],
  layers: [P('m12 3 9 5-9 5-9-5Z'), P('m3 13 9 5 9-5')],
  quote: [P('M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6')],
  pause: [P('M9 5v14M15 5v14')],
  lock: [R(5, 11, 14, 10, 2), P('M8 11V7a4 4 0 0 1 8 0v4')],
  edit: [P('M4 20h4L19 9l-4-4L4 16Z'), P('m13 7 4 4')],
  undo: [P('M9 14 4 9l5-5'), P('M4 9h10a6 6 0 0 1 0 12h-3')],
};
export function Icon({ name, size, label }) {
  const parts = ICONS[name] || ICONS.circle;
  return html`<svg class="icon" viewBox="0 0 24 24" width=${size} height=${size} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? undefined : 'true'} role=${label ? 'img' : undefined} aria-label=${label}>${parts.map(([tag, attrs]) => tag === 'path' ? html`<path d=${attrs.d} />` : tag === 'circle' ? html`<circle cx=${attrs.cx} cy=${attrs.cy} r=${attrs.r} />` : html`<rect x=${attrs.x} y=${attrs.y} width=${attrs.width} height=${attrs.height} rx=${attrs.rx} />`)}</svg>`;
}

// Focusable elements inside a container, for dialog focus traps.
export function focusables(root) {
  return [...root.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null || el === document.activeElement);
}
export function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setMatches(media.matches);
    media.addEventListener('change', change); change();
    return () => media.removeEventListener('change', change);
  }, [query]);
  return matches;
}
export function useTheme() {
  const [, force] = useReducer(n => n + 1, 0);
  useEffect(() => { window.addEventListener('plainhand:theme', force); return () => window.removeEventListener('plainhand:theme', force); }, []);
  return { resolved: document.documentElement.dataset.theme || 'light', preference: window.plainhandTheme?.preference || 'system' };
}
