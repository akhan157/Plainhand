// Plainhand browser app entry. Preact + htm from ./vendor, no build step.
// Layout: header (status region) · navigation · centre column · context panel.
import { html, render, useEffect, useLayoutEffect, useRef, store, update, useStore, useMedia, useTheme, refresh, connectEvents, loadProviders, navigate, viewFromHash, openJob, openDialog, closePanel, closeDialog, VIEWS, Icon, initials, providerNames, providerSymbol, ACTIVE, api, toast } from './ui/core.mjs';
import { Button, IconButton, Meter, trapTab } from './ui/components.mjs';
import { GetStartedPage, ConnectPage, HelpPage, ChatRequestDialog } from './ui/onboarding.mjs';
import { HomePage } from './ui/home.mjs';
import { JobsPage, AddJobDialog, AddSourceDialog } from './ui/jobs.mjs';
import { ApplicationsPage } from './ui/applications.mjs';
import { CampaignsPage } from './ui/campaigns.mjs';
import { ProfilePage, brainChecks, RemoveStoryDialog } from './ui/profile.mjs';
import { ActivityPage, UsagePage } from './ui/activity.mjs';
import { ConnectionsPage, WorkspacePage, AntigravityDialog, ClearConversationDialog, ImportDialog } from './ui/settings.mjs';
import { syncWithState } from './ui/agent.mjs';
import { JobPanel, ConfirmSubmissionDialog } from './ui/jobpanel.mjs';
import { TaskCard } from './ui/conversation.mjs';
import { InsightsPage } from './ui/insights.mjs';
import { initPwa, usePwa, promptInstall, applyUpdate, IosInstallDialog, extractLaunchAction } from './ui/pwa.mjs';

const PAGES = { 'get-started': GetStartedPage, help: HelpPage, home: HomePage, jobs: JobsPage, campaigns: CampaignsPage, applications: ApplicationsPage, insights: InsightsPage, profile: ProfilePage, activity: ActivityPage, usage: UsagePage, connections: ConnectionsPage, workspace: WorkspacePage };
const NAV = [['home', 'home'], ['jobs', 'search'], ['campaigns', 'layers'], ['applications', 'briefcase'], ['insights', 'star'], ['profile', 'brain'], ['activity', 'activity'], ['usage', 'gauge']];
const NAV_BOTTOM = [['connections', 'plug'], ['workspace', 'settings']];

const MOBILE_PRIMARY = [['home', 'home', 'Home'], ['jobs', 'search', 'Jobs'], ['applications', 'briefcase', 'Apps'], ['profile', 'brain', 'Profile']];
const MOBILE_PRIMARY_KEYS = new Set(MOBILE_PRIMARY.map(([k]) => k));

function Header() {
  const theme = useTheme();
  const pwa = usePwa();
  const state = store.state;
  const next = theme.resolved === 'dark' ? 'light' : 'dark';
  const t = store.toast;
  return html`<header class="topbar" id="topbar">
    <div class="topbar-start">
      <button type="button" class="icon-button nav-toggle" aria-label="Toggle navigation" aria-expanded=${store.navOpen ? 'true' : 'false'} aria-controls="sidenav" onClick=${() => update({ navOpen: !store.navOpen })}><${Icon} name=${store.navOpen ? 'close' : 'menu'} /></button>
      <a class="brand" href="#home" aria-label="Plainhand home"><span class="brand-mark" aria-hidden="true">p</span><span class="brand-word">plain<span>hand</span></span></a>
    </div>
    <div class=${'toast-region' + (t ? ' has-toast' : '') + (t?.error ? ' is-error' : '')} role="status" aria-live="polite">${t ? html`<span class="toast" key=${t.id}><${Icon} name=${t.error ? 'alert' : 'checkCircle'} /><span>${t.text}</span><button type="button" class="toast-close" aria-label="Dismiss message" onClick=${() => update({ toast: null })}><${Icon} name="close" /></button></span>` : null}</div>
    <div class="topbar-end">
      ${state?.cloud ? html`<a class="button small" href="#help" onClick=${() => { store.helpScreen = store.view; }}>Get help</a>` : null}<span class="local-label"><span class=${state?.cloud ? 'status-dot tone-info' : 'status-dot tone-success'} aria-hidden="true"></span>${state?.cloud ? 'Online workspace' : 'Local workspace'}</span>
      ${pwa.installed ? html`<button type="button" class="icon-button theme-toggle" aria-label="Refresh workspace" title="Refresh workspace" onClick=${() => { refresh(true); toast('Workspace refreshed.'); }}><${Icon} name="refresh" /></button>` : null}
      <button type="button" class="icon-button theme-toggle" aria-label=${`Switch to ${next} mode`} title=${`Switch to ${next} mode`} onClick=${() => window.plainhandTheme.set(next)}><${Icon} name=${theme.resolved === 'dark' ? 'sun' : 'moon'} /></button>
      <span class="avatar" aria-hidden="true">${initials(state?.profile.name)}</span>
    </div>
  </header>`;
}

function MobileTabBar() {
  const state = store.state;
  const selected = state.jobs.filter(j => j.selected && !['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(j.status)).length;
  const due = (state.followUps || []).filter(f => f.overdue || f.dueToday).length;
  const running = state.tasks.filter(t => ACTIVE.includes(t.status)).length;
  const moreActive = !MOBILE_PRIMARY_KEYS.has(store.view);
  return html`<nav class="mobile-tabbar" aria-label="Mobile quick navigation">
    ${MOBILE_PRIMARY.map(([key, icon, shortLabel]) => html`<a key=${key} href=${'#' + key} class=${'mobile-tab' + (store.view === key ? ' active' : '')} aria-current=${store.view === key ? 'page' : undefined} onClick=${e => { e.preventDefault(); navigate(key); }}>
      <span class="mobile-tab-icon"><${Icon} name=${icon} />${key === 'applications' && due ? html`<span class="mobile-tab-badge tone-danger" aria-label=${`${due} due`}>${due}</span>` : key === 'applications' && selected ? html`<span class="mobile-tab-badge">${selected}</span>` : null}</span>
      <span class="mobile-tab-label">${shortLabel}</span>
    </a>`)}
    <button type="button" class=${'mobile-tab' + (store.navOpen || moreActive ? ' active' : '')} aria-label="More sections" aria-expanded=${store.navOpen ? 'true' : 'false'} aria-controls="sidenav" onClick=${() => update({ navOpen: !store.navOpen })}>
      <span class="mobile-tab-icon"><${Icon} name="more" />${running ? html`<span class="mobile-tab-badge tone-info pulse" aria-label=${`${running} running`}>${running}</span>` : null}</span>
      <span class="mobile-tab-label">More</span>
    </button>
  </nav>`;
}

function Nav() {
  const state = store.state;
  const pwa = usePwa();
  const selected = state.jobs.filter(j => j.selected && !['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(j.status)).length;
  const due = (state.followUps || []).filter(f => f.overdue || f.dueToday).length;
  const running = state.tasks.filter(t => ACTIVE.includes(t.status)).length;
  const showInstall = !pwa.installed && (pwa.canInstall || pwa.platform.ios);
  const item = ([key, icon]) => html`<li key=${key}><a href=${'#' + key} class=${'nav-item' + (store.view === key ? ' active' : '')} aria-current=${store.view === key ? 'page' : undefined} onClick=${e => { e.preventDefault(); if (key === 'help') store.helpScreen = store.view; navigate(key); }}>
    <${Icon} name=${icon} /><span class="nav-label">${VIEWS[key]}</span>
    ${key === 'applications' && due ? html`<span class="nav-badge tone-danger" aria-label=${`${due} due`}>${due}</span>` : key === 'applications' && selected ? html`<span class="nav-badge">${selected}</span>` : null}
    ${key === 'activity' && running ? html`<span class="nav-badge tone-info pulse" aria-label=${`${running} running`}>${running}</span>` : null}
    ${key === 'connections' && !state.cloud && state.provider ? html`<span class="status-dot tone-success" aria-label="Connected"></span>` : null}
  </a></li>`;
  return html`<nav id="sidenav" class=${'sidenav' + (store.navOpen ? ' open' : '')} aria-label="Main navigation">
    <ul class="nav-list">${NAV.filter(([key]) => !state.cloud || !['campaigns', 'insights', 'usage'].includes(key)).map(item)}</ul>
    <ul class="nav-list nav-bottom">${(state.cloud ? [['get-started', 'spark'], ...NAV_BOTTOM, ['help', 'info']] : NAV_BOTTOM).map(item)}
      ${showInstall ? html`<li key="install-app"><button type="button" class="nav-item nav-install-btn" onClick=${() => { update({ navOpen: false }); promptInstall(); }}><${Icon} name="smartphone" /><span class="nav-label">${pwa.platform.ios ? 'Add to Home Screen' : 'Install app'}</span></button></li>` : null}
    </ul>
    <div class="nav-user"><span class="avatar" aria-hidden="true">${initials(state.profile.name)}</span><div><strong>${state.profile.name || 'Your workspace'}</strong><small>${state.profile.graduation || 'Your next chapter'}</small></div></div>
  </nav>`;
}

// What the side panel shows when nothing specific is open.
function DefaultContext() {
  const state = store.state;
  if (state.cloud) return html`<div class="context-default"><h2>Your online workspace</h2><p>Candidate data is stored in Supabase on the server. Connect your chat to run AI tasks; review and approve your work here.</p><a class="button" href="#connections">Connect your AI</a><a class="button" href="#help">Get help</a><a href="#workspace">Export data or delete account</a></div>`;
  const checks = brainChecks(state);
  const done = checks.filter(c => c[0]).length;
  const running = state.tasks.filter(t => ACTIVE.includes(t.status));
  return html`<div class="context-default">
    <div class="context-label">Workspace context</div>
    ${running.length ? html`<section class="ctx-card"><h2>Running now</h2>${running.map(t => html`<${TaskCard} key=${t.id} task=${t} compact onCancel=${async () => { await api('tasks/cancel', { id: t.id }); toast('Cancellation requested. Saved work is preserved.'); refresh(); }} />`)}</section>` : null}
    ${store.view === 'profile' ? null : html`<section class="ctx-card"><div class="ctx-head"><h2>Your candidate brain</h2><span>${done}/4</span></div><${Meter} value=${done} max=${4} label="Candidate brain progress" />
      <ul class="check-list compact">${checks.map(([ok, text]) => html`<li class=${ok ? 'done' : ''}><${Icon} name=${ok ? 'checkCircle' : 'circle'} />${text}</li>`)}</ul>
      <${Button} class="small wide" iconEnd="arrow" onClick=${() => navigate('profile')}>${done ? 'Keep building your profile' : 'Start with your story'}</${Button}></section>`}
    <section class="ctx-card"><div class="ctx-head"><h2>Your agent</h2></div>
      <div class="agent-mini"><span class="provider-logo small" aria-hidden="true">${providerSymbol(state.provider)}</span><div><strong>${state.provider ? providerNames[state.provider] : 'Bring your own agent'}</strong><small>${state.provider === 'chatgpt' ? 'Selected · uses your ChatGPT plan' : state.provider ? 'Selected · uses your CLI account' : 'ChatGPT, Claude or Antigravity'}</small></div></div>
      <${Button} class="small wide ghost" iconEnd="arrow" onClick=${() => navigate('connections')}>${state.provider ? 'Manage connection' : 'Connect an agent'}</${Button}></section>
    <p class="ctx-tip"><${Icon} name="shield" /><span>Your story stays yours. Personal files live on this computer; your selected agent receives context only when you run a task. Open a role to see its evaluation, packet and record here.</span></p>
  </div>`;
}

function ContextPanel({ docked }) {
  const job = store.focus?.type === 'job' ? store.state.jobs.find(j => j.id === store.focus.id) : null;
  const ref = useRef(), headingRef = useRef();
  const focusKey = job ? job.id : null;
  useEffect(() => {
    if (!job) return;
    const previous = document.activeElement;
    headingRef.current?.focus({ preventScroll: true });
    ref.current?.scrollTo?.(0, 0);
    return () => { if (!docked && previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [focusKey]);
  useEffect(() => { ref.current?.scrollTo?.(0, 0); }, [store.focus?.tab]);
  useEffect(() => { if (store.focus && !job && store.state && (!store.state.cloud || !store.state.jobs.some(j => j.id === store.focus.id))) closePanel(); });
  if (!job) return docked ? html`<aside class="context" aria-label="Workspace context"><div class="context-scroll">${html`<${DefaultContext} />`}</div></aside>` : null;
  const content = html`<div class="context-scroll" ref=${ref}><${JobPanel} key=${job.id} job=${job} tab=${store.focus.tab} headingRef=${headingRef} /></div>`;
  if (docked) return html`<aside class="context has-focus" aria-label=${`${job.title} at ${job.company}`}>${content}</aside>`;
  return html`<div class="layer sheet-layer"><div class="scrim" onClick=${closePanel}></div><aside class="context sheet" role="dialog" aria-modal="true" aria-label=${`${job.title} at ${job.company}`} onKeyDown=${e => trapTab(e, e.currentTarget)}>${content}</aside></div>`;
}

function Dialogs() {
  const d = store.dialog;
  if (!d) return null;
  if (d.type === 'chat-request') return html`<${ChatRequestDialog} text=${d.text} />`;
  if (d.type === 'add-job') return html`<${AddJobDialog} prefill=${d.prefill} />`;
  if (d.type === 'add-source') return html`<${AddSourceDialog} />`;
  if (d.type === 'confirm-submit') return html`<${ConfirmSubmissionDialog} id=${d.id} />`;
  if (d.type === 'antigravity') return html`<${AntigravityDialog} />`;
  if (d.type === 'clear-conversation') return html`<${ClearConversationDialog} />`;
  if (d.type === 'remove-story') return html`<${RemoveStoryDialog} storyKey=${d.storyKey} />`;
  if (d.type === 'import') return html`<${ImportDialog} data=${d.data} preview=${d.preview} />`;
  if (d.type === 'ios-install') return html`<${IosInstallDialog} />`;
  return null;
}

function Boot({ message }) {
  return html`<div class="boot"><span class="brand-mark large" aria-hidden="true">p</span><p>${message}</p></div>`;
}

function App() {
  useStore();
  const pwa = usePwa();
  const docked = useMedia('(min-width: 1280px)');
  useLayoutEffect(() => {
    const header = document.getElementById('topbar');
    if (!header || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px'));
    observer.observe(header);
    return () => observer.disconnect();
  }, [!!store.state]);
  useEffect(() => {
    const key = event => {
      if (event.key !== 'Escape') return;
      if (store.dialog) { closeDialog(); return; }
      if (store.navOpen) { update({ navOpen: false }); return; }
      if (store.focus && (!docked || event.target.closest?.('.context'))) closePanel();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [docked]);
  useEffect(() => { syncWithState(); });
  // A link from the agent or MCP opens its role: /?job=<id>&tab=<tab>#applications.
  // The hash picks the screen; this opens that role and tab on top of it. Runs once
  // the workspace is loaded, after the panel's own effects, so the panel is not closed
  // again by its first render.
  useEffect(() => {
    if (!store.state) return;
    const query = new URLSearchParams(location.search);
    const id = query.get('job');
    if (id && store.state.jobs.some(job => job.id === id)) openJob(id, query.get('tab') || 'fit');
    const launch = extractLaunchAction(location.search);
    if (launch) {
      if (launch.openAddJob) openDialog({ type: 'add-job', prefill: launch.prefill });
      for (const param of launch.cleanParams || []) query.delete(param);
      const nextSearch = query.toString();
      const nextUrl = location.pathname + (nextSearch ? '?' + nextSearch : '') + location.hash;
      try { history.replaceState(null, '', nextUrl); } catch {}
    }
  }, [!!store.state]);
  const lock = !docked && !!store.focus || !!store.dialog || store.navOpen;
  useEffect(() => { document.body.classList.toggle('scroll-lock', lock); }, [lock]);
  if (!store.state) return html`<${Boot} message=${store.offline ? store.offlineReason === 'expired' ? 'Your session expired. Reload Plainhand.' : 'Plainhand is offline. Start the local server and reload this page.' : 'Opening your workspace…'} />`;
  const cloudHidden = store.state.cloud ? ['campaigns', 'insights', 'usage'].includes(store.view) : ['get-started', 'help'].includes(store.view);
  const Page = store.state.cloud && store.view === 'connections' ? ConnectPage : cloudHidden ? HomePage : PAGES[store.view] || HomePage;
  return html`<div class=${'app' + (docked ? ' docked' : '') + (store.focus ? ' has-focus' : '') + (pwa.installed ? ' standalone' : '')}>
    <a class="skip-link" href="#main">Skip to content</a>
    <${Header} />
    ${pwa.updateReady ? html`<div class="update-banner" role="status"><${Icon} name="refresh" /><span>A new version of Plainhand is ready.</span><button type="button" class="button small primary" onClick=${applyUpdate}>Reload</button></div>` : null}
    ${store.demo ? html`<div class="demo-banner" role="note"><${Icon} name="spark" /><span><strong>Sample workspace.</strong> Fictional candidate and roles · no live actions.</span><button type="button" class="button small" onClick=${exitDemo}>Back to my workspace</button></div>` : null}
    <div class="frame">
      <${Nav} />
      ${store.navOpen ? html`<div class="scrim nav-scrim" onClick=${() => update({ navOpen: false })}></div>` : null}
      <main id="main" class="content" tabindex="-1">
        ${store.offline ? html`<div class="offline-banner" role="alert"><${Icon} name="alert" /><span>${store.offlineReason === 'expired' ? 'Your session expired. Reload Plainhand to continue.' : store.state.cloud ? 'Connection lost. Check your internet connection and reload if needed.' : 'Connection lost. Your saved files are safe. Check that Plainhand is still running on this computer.'}</span></div>` : null}
        <${Page} key=${store.view} />
      </main>
      <${ContextPanel} docked=${docked} />
    </div>
    <${MobileTabBar} />
    <${Dialogs} />
  </div>`;
}

function exitDemo() {
  update(s => ({ demo: false, state: s.live || s.state, live: null, focus: null, dialog: null }));
  navigate('home');
  refresh(true);
}

initPwa();
window.addEventListener('hashchange', () => { const view = viewFromHash(); if (view === 'help' && store.view !== 'help') store.helpScreen = store.view; update({ view, navOpen: false }); window.scrollTo(0, 0); });
update({ view: viewFromHash() });
render(html`<${App} />`, document.getElementById('app'));
await refresh(true);
connectEvents();
loadProviders();
