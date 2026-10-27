// Connections (AI providers, sample workspace) and Workspace settings
// (appearance, files, boundaries, answer bank, corrections, audit, export).
import { html, useEffect, useState, store, api, refresh, toast, loadProviders, navigate, openDialog, closeDialog, Icon, ago, safeLink, providerNames, providerSymbol, useTheme } from './core.mjs';
import { ActionButton, Button, IconButton, LinkButton, Card, PageHeading, Notice, Pill, Empty, Dialog, Spinner } from './components.mjs';
import { startDemo } from './home.mjs';
import { agentClient } from './agent.mjs';

function copy(text) {
  return navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.'), () => toast('Copy failed. Select the command and copy it yourself.', true));
}

const ACCOUNT = { codex: 'your ChatGPT account (Plus, Pro or Team)', claude: 'your Claude account (Pro or Max)', antigravity: 'your Google account' };
function ProviderCard({ p }) {
  const state = store.state;
  const selected = state.provider === p.id;
  const login = state.loginSessions?.find(l => l.provider === p.id && l.status === 'running');
  const signedIn = p.auth === 'signed-in' || !!p.lastVerifiedAt;
  const installCommand = /^npm |^brew |^curl /.test(p.install) ? p.install : null;
  const test = async () => { toast(`Checking ${providerNames[p.id]}… this takes a few seconds.`); await api('provider/test', { id: p.id }); await loadProviders(); toast(`${providerNames[p.id]} works. Plainhand will use it.`); refresh(); };
  const step = (n, done, title, body) => html`<li class=${'conn-step' + (done ? ' done' : '')}><span class="step-number">${done ? html`<${Icon} name="check" />` : n}</span><div><strong>${title}</strong>${body}</div></li>`;
  return html`<section class=${'provider' + (selected ? ' selected' : '')} aria-labelledby=${'provider-' + p.id}>
    <header><span class="provider-logo" aria-hidden="true">${providerSymbol(p.id)}</span><div><h2 id=${'provider-' + p.id}>${p.name}</h2><small>Uses ${ACCOUNT[p.id] || 'your account'}</small></div>${selected ? html`<${Pill} tone="success" icon="check">In use</${Pill}>` : null}</header>
    <ol class="conn-steps">
      ${step(1, p.installed, 'Install', p.installed ? html`<p class="muted-text">Installed on this computer.</p>` : installCommand
        ? html`<p class="muted-text">Run this once in a terminal, then press Recheck at the top.</p><div class="code-box"><code>${installCommand}</code><${IconButton} icon="copy" label=${`Copy the ${p.name} install command`} onClick=${() => copy(installCommand)} /></div>`
        : html`<p class="muted-text">Install it from the official guide, then press Recheck at the top.</p><${LinkButton} class="small" href=${safeLink(p.docs)} external>Open the install guide</${LinkButton}>`)}
      ${step(2, p.installed && signedIn, 'Sign in', !p.installed ? html`<p class="muted-text">After installing.</p>` : signedIn ? html`<p class="muted-text">Signed in.</p>` : html`
        <p class="muted-text">Opens ${p.name}’s own sign-in. Plainhand never sees your password.</p>
        ${login ? html`<${Notice} tone="info">${login.message}${login.url ? html` <a href=${safeLink(login.url)} target="_blank" rel="noreferrer">Continue sign-in</a>` : null}</${Notice}>` : null}
        <${ActionButton} class="small" icon=${login ? undefined : 'external'} disabled=${!!login} onClick=${async () => { const r = await api('provider/login', { id: p.id }); if (r.manual) openDialog({ type: 'antigravity' }); else { toast('Finish signing in in the window that opened, then check it works.'); refresh(); } }}>${login ? html`<${Spinner} />Signing in…` : p.id === 'antigravity' ? 'How to sign in' : 'Sign in'}</${ActionButton}>`)}
      ${step(3, selected && !!p.lastVerifiedAt, 'Check it works', !p.installed ? html`<p class="muted-text">After installing and signing in.</p>` : html`
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
    <${Notice} tone="info">You only need one. Pick the AI you already pay for and follow its three steps. Usage counts against that plan; Plainhand never sees your password.</${Notice}>
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
  return html`
    <${PageHeading} title="Workspace" subtitle="Your data is inspectable, portable and kept separate from the application code." />
    <${Card} title="Appearance" icon=${theme.resolved === 'dark' ? 'moon' : 'sun'} id="appearance-title" subtitle="Your choice is saved in this browser and shared between its tabs.">
      <div class="field appearance"><label for="theme-preference">Color theme</label>
        <select id="theme-preference" value=${theme.preference} onChange=${e => window.plainhandTheme.set(e.currentTarget.value)}>${[['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
        <small>Follow system tracks your device, including changes while Plainhand is open.</small></div>
    </${Card}>
    <${AutonomyCard} />
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
