// Connections (AI providers, sample workspace) and Workspace settings
// (appearance, files, boundaries, answer bank, corrections, audit, export).
import { html, useEffect, useState, store, api, refresh, toast, loadProviders, navigate, openDialog, closeDialog, Icon, ago, safeLink, providerNames, providerSymbol, useTheme } from './core.mjs';
import { ActionButton, Button, IconButton, LinkButton, Card, PageHeading, Notice, Pill, Empty, Dialog, Spinner } from './components.mjs';
import { startDemo } from './home.mjs';
import { agentClient } from './agent.mjs';

function copy(text) {
  return navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.'), () => toast('Copy failed. Select the command and copy it yourself.', true));
}

const ACCOUNT = { chatgpt: 'your ChatGPT plan (Plus or Pro)', codex: 'your ChatGPT account through the Codex app', claude: 'your Claude account (Pro or Max)', antigravity: 'your Google account' };
// Sign in with ChatGPT: nothing to install. Sign in, then check it works.
const MANAGE_USAGE = 'https://chatgpt.com/settings/usage';
function ChatgptCard({ p }) {
  const state = store.state;
  const selected = state.provider === p.id;
  const [signIn, setSignIn] = useState(p.signIn || { status: p.auth === 'signed-in' ? 'signed-in' : 'signed-out' });
  const [link, setLink] = useState(null);
  const waiting = signIn.status === 'waiting', signedIn = signIn.status === 'signed-in';
  useEffect(() => { if (p.signIn) setSignIn(p.signIn); }, [p.signIn?.status, p.signIn?.message]);
  // While the browser sign-in is open, check every two seconds whether it finished.
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(async () => {
      try {
        const next = await api('providers/chatgpt/status');
        if (next.status === 'waiting') return;
        setSignIn(next); setLink(null);
        if (next.status === 'signed-in') { toast('Signed in with ChatGPT. Now check that it works.'); await loadProviders(); }
        else if (next.status === 'failed') toast(next.message, true);
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting]);
  const start = async () => {
    // Open the tab during the click so the browser does not block it, then point it at OpenAI.
    const tab = window.open('', '_blank');
    try {
      const result = await api('providers/chatgpt/signin', {});
      setSignIn({ status: 'waiting', message: result.message }); setLink(result.url);
      if (tab) { tab.opener = null; tab.location.href = safeLink(result.url); }
    } catch (error) { tab?.close(); throw error; }
  };
  const signOut = async () => { const result = await api('providers/chatgpt/signout', {}); setSignIn(result); toast(result.message); await loadProviders(); refresh(); };
  const test = async () => { toast('Checking ChatGPT… this takes a few seconds.'); await api('provider/test', { id: p.id }); await loadProviders(); toast('ChatGPT works. Plainhand will use your ChatGPT plan.'); refresh(); };
  const step = (n, done, title, body) => html`<li class=${'conn-step' + (done ? ' done' : '')}><span class="step-number">${done ? html`<${Icon} name="check" />` : n}</span><div><strong>${title}</strong>${body}</div></li>`;
  return html`<section class=${'provider' + (selected ? ' selected' : '')} aria-labelledby=${'provider-' + p.id}>
    <header><span class="provider-logo" aria-hidden="true">${providerSymbol(p.id)}</span><div><h2 id=${'provider-' + p.id}>Sign in with ChatGPT</h2><small>Uses ${ACCOUNT[p.id]}</small></div>${selected ? html`<${Pill} tone="success" icon="check">Using ChatGPT plan</${Pill}>` : null}</header>
    <ol class="conn-steps">
      ${step(1, signedIn, 'Sign in', signedIn
        ? html`<p class="muted-text">Signed in${signIn.email ? ` as ${signIn.email}` : ''}. <a href=${MANAGE_USAGE} target="_blank" rel="noreferrer">Manage usage</a></p><${ActionButton} class="small ghost" onClick=${signOut}>Sign out</${ActionButton}>`
        : html`
        <p class="muted-text">Opens ChatGPT in your browser. Plainhand’s AI work then counts against your ChatGPT plan, not a separate bill. Plainhand never sees your password. Nothing to install.</p>
        ${waiting ? html`<${Notice} tone="info">${signIn.message || 'Finish signing in with ChatGPT in your browser.'}${link ? html` <a href=${safeLink(link)} target="_blank" rel="noreferrer">Open the sign-in page</a>` : null}</${Notice}>` : null}
        ${signIn.status === 'failed' ? html`<${Notice} tone="warn">${signIn.message}</${Notice}>` : null}
        <${ActionButton} class="small" icon=${waiting ? undefined : 'external'} onClick=${start}>${waiting ? 'Start again' : 'Continue with ChatGPT'}</${ActionButton}>`)}
      ${step(2, selected && !!p.lastVerifiedAt, 'Check it works', !signedIn ? html`<p class="muted-text">After you sign in.</p>` : html`
        <p class="muted-text">Sends one tiny test request (none of your data) and sets ChatGPT as the AI Plainhand uses.</p>
        <${ActionButton} class=${selected ? 'small' : 'small primary'} icon="plug" onClick=${test}>${selected && p.lastVerifiedAt ? 'Check again' : 'Check and use'}</${ActionButton}>`)}
    </ol>
  </section>`;
}

function ProviderCard({ p }) {
  if (p.id === 'chatgpt') return html`<${ChatgptCard} p=${p} />`;
  const state = store.state;
  const selected = state.provider === p.id;
  const login = state.loginSessions?.find(l => l.provider === p.id && l.status === 'running');
  const signedIn = p.auth === 'signed-in' || !!p.lastVerifiedAt;
  const [setupBusy, setSetupBusy] = useState(false);
  const installCommand = !p.installable && /^npm |^brew |^curl /.test(p.install) ? p.install : null;
  const setup = async () => {
    setSetupBusy(true);
    try {
      await api('provider/setup', { id: p.id });
      await loadProviders();
      toast(`${providerNames[p.id]} is ready. Now sign in to your account.`);
      refresh();
    } catch (error) { toast(error.message, true); }
    finally { setSetupBusy(false); }
  };
  const test = async () => { toast(`Checking ${providerNames[p.id]}… this takes a few seconds.`); await api('provider/test', { id: p.id }); await loadProviders(); toast(`${providerNames[p.id]} works. Plainhand will use it.`); refresh(); };
  const step = (n, done, title, body) => html`<li class=${'conn-step' + (done ? ' done' : '')}><span class="step-number">${done ? html`<${Icon} name="check" />` : n}</span><div><strong>${title}</strong>${body}</div></li>`;
  return html`<section class=${'provider' + (selected ? ' selected' : '')} aria-labelledby=${'provider-' + p.id}>
    <header><span class="provider-logo" aria-hidden="true">${providerSymbol(p.id)}</span><div><h2 id=${'provider-' + p.id}>${p.name}</h2><small>Uses ${ACCOUNT[p.id] || 'your account'}</small></div>${selected ? html`<${Pill} tone="success" icon="check">In use</${Pill}>` : null}</header>
    <ol class="conn-steps">
      ${step(1, p.installed, 'Set up', p.installed
        ? html`<p class="muted-text">Ready on this computer.</p>`
        : p.installable
          ? html`<p class="muted-text">Plainhand downloads the connector once. No terminal needed.</p><${ActionButton} class="small" icon="download" disabled=${setupBusy} onClick=${setup}>${setupBusy ? html`<${Spinner} />Setting up…` : `Set up ${p.name}`}</${ActionButton}>`
          : installCommand
            ? html`<p class="muted-text">Run this once in a terminal, then press Recheck at the top.</p><div class="code-box"><code>${installCommand}</code><${IconButton} icon="copy" label=${'Copy the ' + p.name + ' install command'} onClick=${() => copy(installCommand)} /></div>`
            : html`<p class="muted-text">Install it from the official guide, then press Recheck at the top.</p><${LinkButton} class="small" href=${safeLink(p.docs)} external>Open the install guide</${LinkButton}>`)}
      ${step(2, p.installed && signedIn, 'Sign in', !p.installed
        ? html`<p class="muted-text">Set it up first.</p>`
        : signedIn ? html`<p class="muted-text">Signed in.</p>` : html`
        <p class="muted-text">Opens ${p.name}’s own sign-in in your browser. Plainhand never sees your password.</p>
        ${login ? html`<${Notice} tone="info">${login.message}${login.url ? html` <a href=${safeLink(login.url)} target="_blank" rel="noreferrer">Continue sign-in</a>` : null}</${Notice}>` : null}
        <${ActionButton} class="small" icon=${login ? undefined : 'external'} disabled=${!!login} onClick=${async () => { const r = await api('provider/login', { id: p.id }); if (r.manual) openDialog({ type: 'antigravity' }); else { toast('Finish signing in in the browser, then check it works.'); refresh(); } }}>${login ? html`<${Spinner} />Signing in…` : p.id === 'antigravity' ? 'How to sign in' : 'Sign in'}</${ActionButton}>`)}
      ${step(3, selected && !!p.lastVerifiedAt, 'Check it works', !p.installed ? html`<p class="muted-text">After setup and sign-in.</p>` : html`
        <p class="muted-text">Sends one tiny test request (none of your data) and sets ${p.name} as the AI Plainhand uses.</p>
        <${ActionButton} class=${selected ? 'small' : 'small primary'} icon="plug" onClick=${test}>${selected && p.lastVerifiedAt ? 'Check again' : 'Check and use'}</${ActionButton}>`)}
    </ol>
  </section>`;
}

export function ConnectionsPage() {
  const providers = store.providers;
  return html`
    <${PageHeading} title="Connections" subtitle="Connect the AI account you already use. Plainhand brings your career context; the AI does the writing and thinking."
      actions=${html`<${ActionButton} icon="refresh" onClick=${loadProviders}>Recheck</${ActionButton}>`} />
    <${Notice} tone="info">You only need one. Pick the AI account you already have; Plainhand sets up the connector and opens its browser sign-in for you. Usage counts against your plan, and Plainhand never sees your password.</${Notice}>
    ${providers ? html`<div class="provider-grid">${providers.map(p => html`<${ProviderCard} key=${p.id} p=${p} />`)}</div>` : html`<${Card}><div class="loading-row"><${Spinner} />Checking your installed agents…</div></${Card}>`}
    <div class="two-col">
      <${Card} title="One portable understanding of you" icon="layers" id="portable-title">
        <p class="muted-text">Switching agents keeps your profile, evidence, applications and history. Context is assembled from your saved sources for each task. Plainhand never silently falls back to another provider.</p>
        <ul class="tag-list"><li>Local memory</li><li>Explicit provider choice</li><li>Recoverable tasks</li><li>Candidate review</li></ul>
      </${Card}>
      <${Card} title="Sample workspace" icon="spark" id="sample-title">
        <p class="muted-text">Explore Plainhand with a fictional candidate and fictional roles. Nothing is sent, saved or submitted while the sample is open.</p>
        ${store.demo ? html`<${Pill} tone="warn">The sample is open now</${Pill}>` : html`<${Button} iconEnd="arrow" onClick=${startDemo}>Take a look around</${Button}>`}
      </${Card}>
    </div>`;
}

export function ClearConversationDialog() {
  return html`<${Dialog} title="Clear the conversation?" size="sm" onClose=${closeDialog}>
    <p>This deletes your messages with Plainhand and any proposals you have not decided on. Changes you already saved stay as they are.</p>
    <div class="dialog-actions"><${Button} class="ghost" data-autofocus onClick=${closeDialog}>Keep it</${Button}><${ActionButton} class="primary danger-fill" icon="trash" onClick=${async () => { await agentClient.clear(); closeDialog(); toast('Conversation cleared.'); }}>Clear conversation</${ActionButton}></div>
  </${Dialog}>`;
}

// Restoring an export: preview first, then an explicit confirmation. The current
// workspace is backed up by the server before anything is replaced.
export function ImportDialog({ data, preview }) {
  const when = preview.exportedAt ? new Date(preview.exportedAt).toLocaleDateString() : 'an unknown date';
  return html`<${Dialog} title="Import this workspace?" size="sm" onClose=${closeDialog}>
    <p>This replaces the workspace here with the export from ${when}${preview.name ? ` for ${preview.name}` : ''}. Your current workspace is backed up first.</p>
    <ul class="check-list"><li><${Icon} name="briefcase" />${preview.jobs} role${preview.jobs === 1 ? '' : 's'}, ${preview.applied} submitted</li>
      <li><${Icon} name="layers" />${preview.conversation} conversation message${preview.conversation === 1 ? '' : 's'}</li>
      <li><${Icon} name="search" />${preview.sources} job source${preview.sources === 1 ? '' : 's'}</li></ul>
    ${preview.approvalsReset ? html`<${Notice} tone="warn">${preview.approvalsReset} packet approval${preview.approvalsReset === 1 ? ' is' : 's are'} reset: the PDFs are not part of an export, so review and regenerate packets before using them.</${Notice}>` : null}
    <p class="muted-text">Browser sign-ins and saved portal sessions do not move between computers.</p>
    <div class="dialog-actions"><${Button} class="ghost" data-autofocus onClick=${closeDialog}>Cancel</${Button}><${ActionButton} class="primary" icon="upload" onClick=${async () => { const r = await api('import', { data, confirm: true }); closeDialog(); toast(`Workspace imported: ${r.jobs} role${r.jobs === 1 ? '' : 's'}. A backup of the previous workspace is in data/plainhand/backups.`); refresh(); }}>Replace and import</${ActionButton}></div>
  </${Dialog}>`;
}

async function chooseImport(event) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = '';
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('That file is larger than an export can be (8 MB).');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('That file is not a Plainhand export (it is not valid JSON).'); }
    const preview = await api('import/preview', { data });
    openDialog({ type: 'import', data, preview });
  } catch (error) { toast(error.message, true); }
}

export function AntigravityDialog() {
  return html`<${Dialog} title="Connect Antigravity" onClose=${closeDialog}>
    <p>Run this command in your terminal once. Antigravity opens Google sign-in and keeps the account credentials in its own secure storage.</p>
    <div class="code-box"><code>agy</code><${Button} class="small" icon="copy" onClick=${() => copy('agy')}>Copy</${Button}></div>
    <p>After signing in, come back and press Check and use. No API key is needed.</p>
    <div class="dialog-actions"><${LinkButton} href="https://www.antigravity.google/docs/install?tab=cli" external>Official setup guide</${LinkButton}><${Button} class="primary" onClick=${closeDialog}>Done</${Button}></div>
  </${Dialog}>`;
}

const FIELD_LABELS = { email: 'Email', phone: 'Phone', location: 'Location', timezone: 'Time zone', links: 'Links', eligibility: 'Work authorization', compensation: 'Compensation', constraints: 'What matters to you' };

// What reaches the AI provider, with a switch per source and per sensitive field.
// Turning one off clears packet approvals, because packets must match the context.
function SharingCard() {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api('action', { name: 'context.get', input: {} }).then(r => { setView(r.result); setError(null); }, e => setError(e.message));
  useEffect(() => { if (!store.demo) load(); }, [store.state?.revision]);
  const toggle = async (kind, id, on) => {
    try {
      await api('action', { name: on ? 'context.include' : 'context.exclude', input: { [kind]: [id] } });
      toast(on ? 'Shared again with your agent. Re-evaluate before preparing new packets.' : 'No longer shared. Approvals were cleared; prepare packets again when ready.');
      await load(); refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (store.demo) return html`<p class="muted-text">The sample workspace shares nothing.</p>`;
  if (error) return html`<${Notice} tone="danger">${error}</${Notice}>`;
  if (!view) return html`<p class="muted-text"><${Spinner} /> Loading…</p>`;
  const row = (kind, id, label, included, detail, disabled = false) => html`<li key=${kind + id} class="share-row">
    <label class="share-switch"><input type="checkbox" role="switch" checked=${included} disabled=${disabled} aria-describedby=${'share-' + kind + id}
      onChange=${e => toggle(kind, id, e.currentTarget.checked)} /><span><strong>${label}</strong><small id=${'share-' + kind + id}>${detail}</small></span></label></li>`;
  return html`<div class="sharing">
    <h3 class="sub-heading">Sources</h3>
    <ul class="share-list">${view.sources.map(s => row('sources', s.id, s.label, s.included, s.excludable ? `${s.characters.toLocaleString()} characters` : 'Always shared; exclude individual fields below', !s.excludable))}</ul>
    <h3 class="sub-heading">Profile fields</h3>
    <ul class="share-list">${view.fields.map(f => row('fields', f.name, FIELD_LABELS[f.name] || f.name, f.included, f.present ? (f.included ? 'Shared' : 'Not shared') : 'Empty in your profile'))}</ul>
  </div>`;
}

function AnswerRow({ item }) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(item.answer);
  const [reviewBy, setReviewBy] = useState(item.reviewBy || '');
  const save = async () => {
    await api('action', { name: 'answers.update', input: { id: item.id, answer, ...(reviewBy ? { reviewBy } : {}) } });
    toast('Reusable answer updated.'); setEditing(false); refresh();
  };
  return html`<li><span class="record-icon"><${Icon} name="check" /></span><div class="record-main"><strong>${item.question}</strong>
    ${editing ? html`<div class="field"><label for=${'answer-' + item.id}>Answer</label><textarea id=${'answer-' + item.id} value=${answer} onInput=${e => setAnswer(e.currentTarget.value)} onKeyDown=${e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}></textarea></div>
      <div class="field"><label for=${'answer-review-' + item.id}>Stop reusing after</label><input type="date" id=${'answer-review-' + item.id} value=${reviewBy} onInput=${e => setReviewBy(e.currentTarget.value)} /></div>
      <small>Source: “${item.evidence?.[0]?.quote || ''}”</small>`
      : html`<p>${String(item.answer).slice(0, 180)}</p><small>${item.scope === 'global' ? 'Any application' : item.scope?.companies?.length ? item.scope.companies.join(', ') : 'This role only'} · reviewed ${item.reviewedAt}${item.reviewBy ? ' · expires ' + item.reviewBy : ''}</small>`}</div>
    <div class="row-actions">${editing
      ? html`<${ActionButton} class="small primary" onClick=${save} disabled=${!answer.trim()}>Save answer</${ActionButton}><${Button} class="ghost small" onClick=${() => setEditing(false)}>Cancel</${Button}>`
      : html`<${Button} class="ghost small" icon="edit" aria-label=${'Edit answer: ' + item.question} onClick=${() => setEditing(true)}>Edit</${Button}>
        <${ActionButton} class="ghost small" aria-label=${'Remove answer: ' + item.question} onClick=${async () => { await api('action', { name: 'answers.remove', input: { id: item.id } }); toast('Reusable answer removed.'); refresh(); }}>Remove</${ActionButton}>`}</div></li>`;
}

function DataPanel() {
  const state = store.state;
  const answers = state.answerBank || [];
  const corrections = (state.corrections || []).filter(item => item.status !== 'rejected').slice(0, 8);
  const audit = state.audit || [];
  return html`
    <${Card} title="Reusable answers" icon="check" id="answers-title" subtitle="Corrections you approved for reuse. Sensitive questions are never stored.">
      ${answers.length ? html`<ul class="record-list">${answers.map(item => html`<${AnswerRow} key=${item.id} item=${item} />`)}</ul>`
        : html`<${Empty} compact>No reusable answers yet. Approve a correction to build this list.</${Empty}>`}
    </${Card}>
    <${Card} title="Correction proposals" icon="edit" id="corrections-title" subtitle="Nothing reaches the reusable list until you approve it.">
      ${corrections.length ? html`<ul class="record-list">${corrections.map(item => html`<li key=${item.id}><span class="record-icon"><${Icon} name=${item.status === 'approved' ? 'checkCircle' : 'info'} /></span><div class="record-main"><strong>${item.question}</strong><p>${String(item.answer).slice(0, 180)}</p><small>${item.status} · ${ago(item.proposedAt)}</small></div>
        ${item.status === 'proposed' ? html`<div class="row-actions"><${ActionButton} class="small" icon="check" onClick=${async () => { await api('corrections/approve', { id: item.id }); toast('Correction approved and reusable.'); refresh(); }}>Approve</${ActionButton}><${ActionButton} class="ghost small" onClick=${async () => { await api('corrections/reject', { id: item.id }); toast('Correction rejected. Nothing was stored.'); refresh(); }}>Reject</${ActionButton}></div>` : html`<${Pill} tone="success">Approved</${Pill}>`}</li>`)}</ul>`
        : html`<${Empty} compact>No correction proposals. They appear when a reviewed answer needs changing.</${Empty}>`}
    </${Card}>
    <${Card} title="External actions" icon="shield" id="audit-title" subtitle="Fills, handoffs and verification, with a reason and the artifact touched.">
      ${audit.length ? html`<ol class="timeline">${audit.map((item, i) => html`<li key=${i}><span class="tl-dot"><${Icon} name="clock" /></span><div><p>${item.action} — ${item.reason}</p><small>${ago(item.at)}${item.artifact ? ' · ' + item.artifact : ''}${item.outcome ? ' · ' + item.outcome : ''}</small></div></li>`)}</ol>`
        : html`<${Empty} compact>No external actions recorded yet.</${Empty}>`}
    </${Card}>`;
}

async function exportWorkspace() {
  if (store.demo) throw new Error('Leave the sample workspace to export your real data.');
  const data = await api('export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = href; link.download = 'plainhand-workspace.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// Read-only remote view. Vercel hosts a snapshot; it cannot run Plainhand.
function RemoteCard() {
  const remote = store.state?.remote;
  const [busy, setBusy] = useState(null);
  const [project, setProject] = useState(remote?.project || 'plainhand-dashboard');
  useEffect(() => { setProject(remote?.project || 'plainhand-dashboard'); }, [remote?.project]);
  if (!remote || store.demo) return null;
  const login = remote.login;
  const run = async (label, action) => {
    setBusy(label);
    try { const result = await action(); await refresh(true); return result; }
    catch (error) { toast(error.message, true); return null; }
    finally { setBusy(null); }
  };
  const connect = () => run('connect', () => api('remote/connect', {}));
  const check = () => run('check', async () => { const result = await api('remote/status'); toast(result.user ? `Signed in to Vercel as ${result.user}` : 'Vercel is not connected yet.'); return result; });
  const publish = () => run('publish', async () => { const result = await api('remote/publish', {}); toast('Your dashboard is online.'); return result; });
  const toggle = enabled => run('settings', () => api('remote/settings', { enabled }));
  const saveProject = () => run('settings', async () => { await api('remote/settings', { project }); toast('Project name saved.'); });
  const rotate = () => run('rotate', async () => { const result = await api('remote/rotate', {}); toast('A new password is live.'); return result; });
  const forget = () => {
    if (!window.confirm('Remove this link from Plainhand? The published page stays online until you delete the Vercel project, and its password is deleted here.')) return;
    return run('forget', async () => { await api('remote/forget', {}); toast('Link removed here. Delete the Vercel project to take the page offline.'); });
  };
  const connected = Boolean(remote.user);
  const publishing = busy === 'publish' || busy === 'rotate';
  const loginLink = login?.url ? html`<div class="code-box"><a href=${safeLink(login.url)} target="_blank" rel="noreferrer">${login.url}</a></div>` : null;
  const advanced = html`<details class="remote-advanced">
    <summary>Advanced options</summary>
    <div class="disclosure-body">
      <div class="field"><label for="remote-project">Vercel project name</label><div class="action-row"><input id="remote-project" value=${project} disabled=${busy !== null} onInput=${event => setProject(event.currentTarget.value)} /><${Button} class="small" disabled=${busy !== null || project === remote.project} onClick=${saveProject}>Save</${Button}></div><small>Usually leave this as it is.</small></div>
      <label class="checkbox"><input type="checkbox" role="switch" checked=${remote.enabled === true} disabled=${busy !== null} onChange=${event => toggle(event.currentTarget.checked)} /><span><strong>Update it automatically</strong> while Plainhand is running, at most every 15 minutes.</span></label>
      <div class="action-row"><${Button} icon="refresh" disabled=${busy !== null} onClick=${rotate}>New password</${Button}><${Button} class="ghost small" icon="trash" disabled=${busy !== null} onClick=${forget}>Remove from Plainhand</${Button}></div>
    </div>
  </details>`;
  return html`<${Card} title="Open from anywhere" icon="external" id="remote-title" subtitle="Put a read-only copy of your dashboard online. Your applications and files stay on this computer; this page is only for checking them.">
    <p class="muted-text">Use a free Vercel account to host the page. You can sign in with Google, GitHub or email. Applying, submitting and your AI conversation still happen on this computer.</p>
    ${!connected ? html`
      <p class="muted-text"><strong>Connect your Vercel account</strong>, then publish. Nothing is uploaded until you press Publish.</p>
      ${login?.status === 'running' ? html`<${Notice} tone="info">Finish signing in to Vercel in the browser. The link expires in about 10 minutes.${loginLink ? html`<p>If no tab opened, use this link:</p>${loginLink}` : null}</${Notice}>` : null}
      ${login?.status === 'failed' ? html`<${Notice} tone="danger">${login.message}</${Notice}>` : null}
      <div class="action-row">
        <${ActionButton} class="primary" icon="plug" disabled=${busy !== null || login?.status === 'running'} onClick=${connect}>Connect with Vercel</${ActionButton}>
        <${Button} icon="refresh" disabled=${busy !== null} onClick=${check}>I have signed in</${Button}>
      </div>
      <details class="remote-advanced"><summary>Having trouble connecting?</summary><div class="disclosure-body"><p class="muted-text">Open a terminal in the Plainhand folder and run <code>npx vercel login</code>. Finish in the browser, then press “I have signed in”.</p></div></details>`
    : html`
      <div class="action-row"><${Pill} tone="success" icon="checkCircle">Signed in to Vercel as ${remote.user}</${Pill}><${Button} class="ghost small" icon="refresh" disabled=${busy !== null} onClick=${check}>Check again</${Button}></div>
      ${remote.url ? html`
        <h3 class="sub-heading">Your dashboard is online</h3>
        <div class="code-box"><a href=${safeLink(remote.url)} target="_blank" rel="noreferrer">${remote.url}</a><${Button} class="small" icon="external" onClick=${() => window.open(safeLink(remote.url), '_blank', 'noopener')}>Open</${Button}></div>
        <div class="field"><label for="remote-password">Password for other devices</label><div class="code-box"><code id="remote-password">${remote.password || '—'}</code><${Button} class="small" icon="copy" onClick=${() => copy(remote.password || '')}>Copy</${Button}></div><small>${remote.verifiedAt ? 'Checked and working.' : 'Not checked yet.'} Open the link on your phone or another computer${remote.protected ? '; sign in to Vercel with the same account first' : ''}, then enter this password. Use “Remember this device” so you stay signed in.</small></div>
        <div class="action-row"><${ActionButton} class="primary" icon="upload" disabled=${busy !== null} onClick=${publish}>${publishing ? 'Publishing…' : 'Publish again'}</${ActionButton}></div>
        ${publishing ? html`<p class="muted-text"><${Spinner} /> Building and publishing; this usually takes a minute.</p>` : null}`
      : html`<${Notice} tone="info">Ready to publish. This uploads a read-only copy of your applications, reports and PDFs; it does not expose Plainhand or let anyone apply.</${Notice}>
        <div class="action-row"><${ActionButton} class="primary" icon="upload" disabled=${busy !== null} onClick=${publish}>${publishing ? 'Publishing…' : 'Publish my dashboard'}</${ActionButton}></div>
        ${publishing ? html`<p class="muted-text"><${Spinner} /> Building and publishing; this usually takes a minute.</p>` : null}`}
      ${advanced}
      ${remote.lastError ? html`<${Notice} tone="danger" title="Publishing did not finish">${remote.lastError}</${Notice}>` : null}`}
    <${Notice} tone="warn">Only a read-only copy is uploaded. Anyone with the password can read your applications, reports and PDFs. Your AI account, conversations, browser sessions and the ability to apply stay on this computer. Delete the Vercel project to take the page offline.</${Notice}>
  </${Card}>`;
}

function AutonomyCard() {
  const a = store.state.autonomy || { enabled: false, perDay: 3, minScore: 4 };
  const ready = store.state.standardStatus === 'approved';
  const save = async next => { await api('settings/autonomy', { ...a, ...next }); refresh(); };
  return html`<${Card} title="How much Plainhand does on its own" icon="spark" id="autonomy-title" subtitle="It never submits. You review and send every application.">
    <div class="radio-list" role="radiogroup" aria-label="Autonomy">
      <label class="checkbox"><input type="radio" name="autonomy" checked=${!a.enabled} disabled=${store.demo} onChange=${() => save({ enabled: false })} /><span><strong>Ask me per application</strong> · it prepares a role when you choose it.</span></label>
      <label class="checkbox"><input type="radio" name="autonomy" checked=${a.enabled} disabled=${store.demo || !ready} onChange=${() => save({ enabled: true })} /><span><strong>Prepare strong matches on its own</strong> · roles scoring ${a.minScore}/5 or more with an Apply recommendation, up to ${a.perDay} a day, from your approved standard.</span></label>
    </div>
    ${!ready ? html`<p class="muted-text">Approve your standard application on your profile first.</p>` : a.enabled ? html`<div class="field appearance"><label for="autonomy-per-day">Up to this many a day</label><select id="autonomy-per-day" value=${String(a.perDay)} disabled=${store.demo} onChange=${e => save({ perDay: Number(e.currentTarget.value) })}>${[1, 2, 3, 5, 10].map(n => html`<option value=${String(n)}>${n}</option>`)}</select></div>` : null}
  </${Card}>`;
}

export function WorkspacePage() {
  const state = store.state;
  const theme = useTheme();
  if (state.cloud) return html`<${PageHeading} title="Online workspace" subtitle="Your candidate data is stored in Supabase on the server, rather than on this computer. Your connected AI receives context for the tasks you request." /><${Card} title="Your account and data"><p>Export your saved workspace before switching to the desktop app. A desktop installer has not been released yet.</p><div class="action-row"><${ActionButton} onClick=${exportWorkspace}>Export workspace</${ActionButton}><a class="button" href="/account/delete">Delete my account</a><a class="button" href="#help">Get help</a></div></${Card}><${DataPanel} />`;
  return html`
    <${PageHeading} title="Workspace" subtitle="Your data is inspectable, portable and kept separate from the application code." />
    <${Card} title="Appearance" icon=${theme.resolved === 'dark' ? 'moon' : 'sun'} id="appearance-title" subtitle="Your choice is saved in this browser and shared between its tabs.">
      <div class="field appearance"><label for="theme-preference">Color theme</label>
        <select id="theme-preference" value=${theme.preference} onChange=${e => window.plainhandTheme.set(e.currentTarget.value)}>${[['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
        <small>Follow system tracks your device, including changes while Plainhand is open.</small></div>
    </${Card}>
    <${AutonomyCard} />
    <${RemoteCard} />
    <div class="two-col">
      <${Card} title="Your files & context" icon="file" id="files-title">
        <p class="muted-text">Identity and targets are saved to <code>config/profile.yml</code>. Your resume stays in <code>cv.md</code>, and existing structured resume sources are respected. Conversation, voice, task history and application checkpoints live in <code>data/plainhand/workspace.json</code>.</p>
        <h3 class="sub-heading" id="sharing-title">What your agent sees</h3>
        <p class="muted-text">Each task sends these to ${state.provider ? providerNames[state.provider] || 'your provider' : 'your provider'}. Turn off anything you would rather keep private. Your agent can suggest turning things off, but only you can turn them back on.</p>
        <${SharingCard} />
        <${Notice} tone="warn">Changing what is shared clears packet approvals, so every packet matches what your agent actually saw.</${Notice}>
        <div class="action-row"><${ActionButton} class="primary" icon="download" onClick=${exportWorkspace}>Export workspace</${ActionButton}>
          <label class=${'button' + (store.demo ? ' disabled' : '')}><${Icon} name="upload" /><span>Import a workspace</span><input type="file" accept="application/json,.json" class="visually-hidden" disabled=${store.demo} aria-label="Import a workspace export" onChange=${chooseImport} /></label>
          <${Button} icon="brain" onClick=${() => navigate('profile')}>Edit my profile</${Button}></div>
      </${Card}>
      <${Card} title="Application boundaries" icon="shield" id="boundaries-title">
        <ul class="check-list"><li><${Icon} name="checkCircle" />You choose each role to pursue.</li><li><${Icon} name="checkCircle" />Claims need source evidence.</li><li><${Icon} name="checkCircle" />Changed context clears approvals.</li><li><${Icon} name="checkCircle" />The final submit click is yours.</li></ul>
        <p class="muted-text">Browser assistance opens any public employer application page, fills what it can map from your approved packet and profile, and lists the rest for you. Checked on live Greenhouse, Lever and Ashby forms; Workday and other portals that need an account stop at sign-in for you to complete. Plainhand saves roles from LinkedIn, Indeed and other job boards but never opens those sites itself: you add the employer’s application link. Nothing is reported as submitted until you confirm it.</p>
        <h3 class="sub-heading">Local CAPTCHA handling</h3>
        <p class="muted-text">${state.localCaptchaSolver?.installed ? 'Local audio solver installed · no per-solve fee.' : 'Optional local audio solver · no paid account needed.'} Handles supported English reCAPTCHA audio challenges on your computer; other challenges may still need your help.${!state.localCaptchaSolver?.installed ? html` Install once from your Plainhand folder: <code>npm run setup:captcha</code>` : null}</p>
      </${Card}>
    </div>
    <${Card} title="Conversation with Plainhand" icon="layers" id="conversation-title" subtitle="Saved in data/plainhand/conversation.jsonl, up to the last 500 messages. Clearing it does not undo any change you saved.">
      <${Button} icon="trash" disabled=${store.demo} onClick=${() => openDialog({ type: 'clear-conversation' })}>Clear conversation</${Button}>
    </${Card}>
    <h2 class="group-heading">Your data</h2>
    <${DataPanel} />`;
}
