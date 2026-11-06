import { html, useState, useEffect, useLayoutEffect, useRef, useDraft, store, api, refresh, navigate, closeDialog, toast } from './core.mjs';
import { Button, ActionButton, Card, PageHeading, Notice, Dialog } from './components.mjs';
import { setupCoverage, CHECK_REQUEST, EXAMPLE_REQUESTS, connectionResult } from './connect-data.mjs';

export function CopyRequest({ text, label = 'Copy request' }) {
  return html`<div class="code-box"><pre class="chat-request">${text}</pre><${ActionButton} class="small" onClick=${async () => { await navigator.clipboard.writeText(text); toast('Copied. Paste this in your connected chat.'); }}>${label}</${ActionButton}></div>`;
}
export function ChatRequestDialog({ text }) {
  return html`<${Dialog} title="Ask your connected chat" onClose=${closeDialog}><p>This website saves and reviews your work. Run AI tasks in your connected ChatGPT or Claude chat.</p><${CopyRequest} text=${text} /><a class="button" href="#connections" onClick=${() => { closeDialog(); navigate('connections'); }}>Connect your AI</a></${Dialog}>`;
}
export function HelpPage() {
  const [message, setMessage] = useState(''), [sent, setSent] = useState(null);
  return html`<${PageHeading} title="Get help" subtitle="Tell us what you were trying to do." /><${Card}>
    ${sent ? html`<p role="status">Help request saved. Reference: ${sent}. This is not live chat.</p>` : html`<form onSubmit=${async e => { e.preventDefault(); try { const r = await api('help', { message, screen: store.helpScreen || 'help', errorIds: [] }); setSent(r.id); } catch (err) { toast(err.message, true); } }}>
    <div class="field"><label for="help-message">What were you trying to do?</label><textarea id="help-message" required maxlength="4000" value=${message} onInput=${e => setMessage(e.currentTarget.value)} /></div>
    <p>Your message, screen name and account email are saved for support. Workspace contents and files are not attached. Avoid including private resume details.</p><button class="button primary" type="submit">Send help request</button></form>`}
  </${Card}>`;
}
export function CloudProgress() {
  const s = store.state;
  const connected = s.connectionCheck?.read === true && s.connectionCheck?.write === true && s.connectionCheck?.provider === s.onboarding?.provider;
  const checks = [[!!s.profile.resume, 'Resume saved'], [!!s.profile.roles, 'Target roles saved'], [!!s.onboarding?.provider, 'AI and plan chosen'], [connected, 'Read and save connection checked']];
  return html`<${Card} title="Get started" subtitle=${`${checks.filter(c => c[0]).length} of 4 steps complete`}>
    <ul class="check-list">${checks.map(([ok, text]) => html`<li>${ok ? '✓' : '○'} ${text}</li>`)}</ul>
    <${Button} class="primary" onClick=${() => navigate('get-started')}>Continue setup</${Button}>
    <p>Online workspace: your candidate data is stored in Supabase on the server, rather than on this computer. Your connected AI receives the context used for its tasks.</p>
  </${Card}>`;
}
export function CloudChatCard() {
  return html`<${Card} title="Use Plainhand in your chat"><p>${store.state.onboarding?.provider === 'claude' ? 'In Claude, Plainhand is available in chats after you connect it. Check that its tools are enabled.' : 'In ChatGPT, start requests with @Plainhand.'} You review and submit applications yourself.</p>
    ${EXAMPLE_REQUESTS.map(text => html`<${CopyRequest} text=${(store.state.onboarding?.provider === 'claude' ? '' : '@Plainhand ') + text} />`)}
    <${Button} onClick=${() => navigate('connections')}>Connect your AI</${Button}>
  </${Card}>`;
}
export function GetStartedPage() {
  const state = store.state;
  const [step, setStep] = useState(state.profile.resume ? state.profile.roles ? 2 : 1 : 0);
  const [draft, setDraft] = useDraft('hosted-onboarding', { values: { ...state.profile }, revision: state.revision });
  const [busy, setBusy] = useState(false);
  const heading = useRef();
  useLayoutEffect(() => { heading.current?.focus(); }, [step]);
  const set = (key, value) => setDraft(current => ({ ...current, values: { ...current.values, [key]: value } }));
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try { await api('profile', { profile: draft.values, revision: draft.revision }); await refresh(true); setDraft({ values: { ...store.state.profile }, revision: store.state.revision }); setStep(step + 1); }
    catch (error) { toast(error.message, true); if (/workspace changed/i.test(error.message)) { await refresh(true); setDraft({ ...draft, revision: store.state.revision }); } }
    finally { setBusy(false); }
  };
  const upload = async e => {
    const file = e.currentTarget.files[0]; e.currentTarget.value = ''; if (!file) return;
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a resume under 2 MB.');
      const content = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(new Error('Could not read this file. Paste the text instead.')); r.readAsDataURL(file); });
      const result = await api('resume/import', { name: file.name, content }); set('resume', result.text); toast('Preview ready. Review the text, then choose Save resume.');
    } catch (error) { toast(error.message, true); } finally { setBusy(false); }
  };
  return html`<${PageHeading} title="Get started" subtitle="Your facts, your targets, your choice of AI." />
    <${Card}><h2 ref=${heading} tabindex="-1">${['1. Review your resume', '2. Choose your target roles', '3. Connect your AI'][step]}</h2>
    ${step < 2 ? html`<form onSubmit=${save}>
      ${step === 0 ? html`<div class="field"><label for="start-name">Full name</label><input id="start-name" disabled=${busy} required autocomplete="name" value=${draft.values.name} onInput=${e => set('name', e.currentTarget.value)} /></div>
      <div class="field"><label for="start-file">Upload a PDF, text or Markdown resume (2 MB, 20 pages maximum)</label><input id="start-file" type="file" accept=".pdf,.txt,.md" disabled=${busy} onChange=${upload} /></div>
      <div class="field"><label for="start-resume">Resume text — preview or paste</label><textarea id="start-resume" disabled=${busy} class="large" required maxlength="100000" value=${draft.values.resume} onInput=${e => set('resume', e.currentTarget.value)} /></div>
      <p>Check names, dates and layout. Importing does not save your profile. Only include facts you can support.</p>` : html`<div class="field"><label for="start-roles">Target roles</label><textarea id="start-roles" disabled=${busy} required value=${draft.values.roles} onInput=${e => set('roles', e.currentTarget.value)} /></div><p>Separate roles with commas or new lines. You can refine these later in your profile.</p>`}
      <div class="action-row">${step ? html`<${Button} disabled=${busy} onClick=${() => setStep(step - 1)}>Back</${Button}>` : null}<button class="button primary" type="submit" disabled=${busy}>${step === 0 ? 'Save resume' : 'Save target roles'}</button></div>
    </form>` : html`<${ConnectWizard} /><${Button} onClick=${() => setStep(1)}>Back to target roles</${Button}>`}
    </${Card}>`;
}
export function ConnectWizard() {
  const saved = store.state.onboarding || {};
  const [provider, setProvider] = useState(saved.provider || 'chatgpt'), [plan, setPlan] = useState(saved.plan || '');
  const [screen, setScreen] = useState(-1), [started, setStarted] = useState(null), [status, setStatus] = useState('waiting'), [pollError, setPollError] = useState('');
  const heading = useRef();
  const data = setupCoverage[provider], personal = provider === 'chatgpt' && plan !== 'Work or school';
  const phone = window.matchMedia('(max-width: 600px)').matches;
  const check = screen === data.steps.length;
  useLayoutEffect(() => { heading.current?.focus(); }, [screen]);
  useEffect(() => {
    if (!check || !started) return;
    let stopped = false, timer;
    const poll = async () => {
      if (stopped) return;
      if (Date.now() - started >= 120000) { setStatus('timeout'); return; }
      if (document.visibilityState === 'visible') {
        try { const marker = await api('connection-check'); if (stopped) return; setPollError(''); const result = connectionResult(marker, started, provider); if (result !== 'waiting') { setStatus(result); refresh(); return; } }
        catch (error) { if (!stopped) setPollError(error.message); }
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    const visible = () => { clearTimeout(timer); poll(); };
    document.addEventListener('visibilitychange', visible); poll();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [check, started, provider]);
  const beginCheck = () => { setStatus('waiting'); setPollError(''); setStarted(Date.now()); setScreen(data.steps.length); };
  const choose = async () => { await api('onboarding', { provider, plan }); await refresh(); setScreen(0); };
  const admin = `Please allow the Plainhand custom ${provider === 'chatgpt' ? 'MCP plugin' : 'connector'} in our workspace. Server URL: ${location.origin}/mcp. It uses OAuth. I need read and save access; I will review application packets and submit applications myself.`;
  const step = data.steps[screen];
  return html`<section aria-label="Connect your AI">
    <h2 ref=${heading} tabindex="-1">${screen < 0 ? 'Choose your AI and plan' : personal ? 'Use Plainhand on your computer' : check ? 'Check your connection' : step.title}</h2>
    <p class="muted-text">Documentation checked ${setupCoverage.checkedAt}. Account coverage: unverified. No real plan accounts have been tested.</p>
    ${phone ? html`<${Notice}>Use a computer for initial connector setup and browser extensions. Review and track on this website from your phone. Claude mobile can use connected services; ChatGPT mobile availability depends on your account and is unverified here. Form filling needs a computer.</${Notice}>` : null}
    ${screen < 0 ? html`<div class="field"><label for="connect-provider">AI provider</label><select id="connect-provider" value=${provider} onChange=${e => { setProvider(e.currentTarget.value); setPlan(''); }}><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></div>
      <div class="field"><label for="connect-plan">Your plan</label><select id="connect-plan" value=${plan} onChange=${e => setPlan(e.currentTarget.value)}><option value="">Choose your plan</option>${data.plans.map(p => html`<option value=${p}>${p}</option>`)}</select></div>
      <p>Find your plan in your AI account menu or settings. Free and Go ChatGPT availability is unconfirmed.</p>
      ${provider === 'claude' ? html`<p>Claude Free allows one custom connector. If you already use that allowance, decide whether to remove it before starting. Team and Enterprise need an owner to enable connectors.</p>` : null}
      <${ActionButton} class="primary" disabled=${!plan} onClick=${choose}>Continue with this plan</${ActionButton}>
      <button class="button" type="button" disabled>One-click hosted connection — awaiting approval</button>`
    : personal ? html`<p>For this ChatGPT personal plan, the planned full route is the Plainhand desktop app using your ChatGPT account. Free and Go support remains unconfirmed.</p><${Notice}>A packaged desktop installer has not been released. There is no download available here yet. You can save your profile now, export your workspace, or choose Claude if you have access to it.</${Notice}>
      <${Button} onClick=${() => navigate('workspace')}>Export or manage my workspace</${Button}><${Button} onClick=${() => { setScreen(-1); }}>Choose another AI or plan</${Button}>`
    : check ? html`<p>In your ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'} chat, send this request and approve the connection test’s save action when asked.</p><${CopyRequest} text=${CHECK_REQUEST} />
      <div role="status" aria-live="polite">${status === 'connected' ? html`<p class="tone-success">Connected. Plainhand can read and save.</p>` : status === 'read-only' ? html`<p>Plainhand can read, but its save test was refused. Review tool approvals and workspace permissions. The desktop route is planned, but its installer is not released.</p>` : status === 'timeout' ? html`<p>No successful read and save check arrived within two minutes.</p>` : html`<p>Waiting for a new read and save check… Older checks do not count.</p>`}${pollError ? html`<p>${pollError}</p>` : null}</div>
      ${status !== 'connected' ? html`<details open=${status === 'timeout' || status === 'read-only'}><summary>Connection troubleshooting</summary><ol><li>Make sure Plainhand is installed and connected in your AI’s settings.</li><li>Select Plainhand in chat (use @Plainhand in ChatGPT) and send the request.</li><li>Sign in to the same Plainhand account as this website, and approve the save test.</li></ol><p>If your workspace blocks saving, ask your admin. <a href="#help">Get help</a></p></details><${Button} onClick=${beginCheck}>Start a new check</${Button}>` : html`<${Button} class="primary" onClick=${() => navigate('jobs')}>Add or review a job</${Button}>`}`
    : html`<p>Step ${screen + 1} of ${data.steps.length}</p><p>${step.text}</p>${step.link ? html`<a href=${step.link} target="_blank" rel="noreferrer">Open ${provider === 'chatgpt' ? 'ChatGPT Plugins' : 'Claude'}</a>` : null}${step.copy ? html`<${CopyRequest} text=${location.origin + '/mcp'} label="Copy Plainhand link" />` : null}
      <div class="action-row"><${Button} onClick=${() => setScreen(screen - 1)}>Back</${Button}><${Button} class="primary" onClick=${() => screen + 1 === data.steps.length ? beginCheck() : setScreen(screen + 1)}>Next</${Button}></div>
      <details><summary>I cannot find this option</summary><p>Your workspace admin or owner may control access. Menu names may differ; account coverage is unverified.</p><${CopyRequest} text=${admin} label="Copy message for admin" /></details>`}
    <p><a href=${data.source} target="_blank" rel="noreferrer">Official setup instructions</a> · Authentic screenshots pending; no provider UI screenshots are represented here.</p>
    ${screen >= 0 && !personal ? html`<${Button} class="ghost" onClick=${() => { setStarted(null); setScreen(-1); }}>Change AI or plan</${Button}>` : null}
  </section>`;
}

export function ConnectPage() { return html`<${PageHeading} title="Connect your AI" subtitle="One step at a time." /><${Card}><${ConnectWizard} /></${Card}>`; }
