// Plainhand extension popup. Three actions, plain words: Save this job,
// Fill this page, I submitted this — plus sign-in and sign-out. Every action
// just asks the background service worker; the filler never submits.
const app = document.getElementById('app');
const send = message => new Promise((resolve, reject) =>
  chrome.runtime.sendMessage(message, response => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response)));
const escape = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, options = {}) {
  const { site = 'https://plainhand.test', token } = await chrome.storage.local.get(['site', 'token']);
  if (!token) throw new Error('Connect Plainhand first.');
  const response = await fetch(site + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Plainhand said ${response.status}.`);
  return response.json();
}

const busy = on => { app.classList.toggle('busy', on); const buttons = [...app.querySelectorAll('button')]; buttons.forEach(b => (b.disabled = on)); };
const note = (kind, text) => { const box = document.createElement('div'); box.className = kind; box.textContent = text; app.appendChild(box); };
const clearNotes = () => [...app.querySelectorAll('.error,.ok')].forEach(n => n.remove());

async function renderSignedOut() {
  app.innerHTML = `
    <h1>Plainhand</h1>
    <p class="muted">Save jobs, fill applications with your approved answers, and keep your tracker up to date. It never submits for you.</p>
    <button class="primary" id="signin">Sign in to Plainhand</button>`;
  app.querySelector('#signin').onclick = async () => {
    busy(true); clearNotes();
    try { await import('../background/oauth.js').then(m => m.launchSignIn()); await render(); }
    catch (error) { busy(false); note('error', error.message); }
  };
}

async function render() {
  const { token } = await chrome.storage.local.get(['token']);
  if (!token) return renderSignedOut();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  app.innerHTML = `
    <header><h1>Plainhand</h1><button class="account" id="account">Account</button></header>
    <p class="muted">${escape((tab?.url || '').slice(0, 60))}</p>
    <button class="primary" data-action="save-job">Save this job</button>
    <button data-action="fill-page">Fill this page</button>
    <button data-action="mark-submitted">I submitted this</button>
    <h2>What this does</h2>
    <p class="muted">Fill this page enters your approved answers and leaves anything you have not approved — including the final submit — to you.</p>`;
  app.querySelector('#account').onclick = renderAccount;
  for (const button of app.querySelectorAll('button[data-action]')) {
    button.onclick = async () => {
      busy(true); clearNotes();
      try {
        const { ok, result, error } = await send({ type: button.dataset.action });
        if (!ok) throw new Error(error);
        showResult(button.dataset.action, result);
      } catch (error) { note('error', error.message); }
      finally { busy(false); }
    };
  }
}

function showResult(action, result) {
  clearNotes();
  if (action === 'save-job') {
    note('ok', `Saved ${result.company} — ${result.title}. Evaluate it in Plainhand when you have a moment.`);
  } else if (action === 'fill-page') {
    const filled = result.filled?.length || 0, skipped = result.skipped?.length || 0, failed = result.failed?.length || 0;
    note('ok', `Filled ${filled} field${filled === 1 ? '' : 's'} for ${result.match?.company || 'your role'}.`);
    const lines = [];
    if (skipped) lines.push(`${skipped} left for you (pay, authorization, personal choices and anything Plainhand does not have yet).`);
    if (failed) lines.push(`${failed} could not be filled — type those yourself.`);
    if (result.left?.length) lines.push('Plainhand flagged: ' + result.left.map(l => l.label || l.reason).slice(0, 3).join(', ') + '.');
    lines.push('Check every answer, then press Submit yourself.');
    const list = document.createElement('ul'); list.className = 'list muted';
    list.innerHTML = lines.map(line => `<li>${escape(line)}</li>`).join('');
    app.appendChild(list);
  } else if (action === 'mark-submitted') {
    note('ok', 'Recorded as Applied. Well done.');
  }
}

async function renderAccount() {
  const { site = 'https://plainhand.test' } = await chrome.storage.local.get(['site']);
  app.innerHTML = `
    <h1>Plainhand account</h1>
    <p class="muted">Signed in to ${escape(site)}</p>
    <button class="primary" id="open">Open Plainhand</button>
    <button class="danger" id="signout">Sign out of the extension</button>
    <button id="back">Back</button>`;
  app.querySelector('#open').onclick = () => chrome.tabs.create({ url: site });
  app.querySelector('#back').onclick = render;
  app.querySelector('#signout').onclick = async () => {
    busy(true);
    try { await import('../background/oauth.js').then(m => m.signOut()); } catch { /* token already gone */ }
    await render();
  };
}

render().catch(error => { app.innerHTML = `<h1>Plainhand</h1><div class="error">${escape(error.message)}</div>`; });
