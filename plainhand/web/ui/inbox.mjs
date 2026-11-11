// Emails about applications (Applications page): paste one, see which application it was
// matched to, and approve or dismiss each proposed change. Every proposal shows the exact
// words from the email that support it. Nothing is changed until you press Apply. Links in
// an email are shown as text and never opened by Plainhand.
import { html, useState, store, api, refresh, toast, Icon, ago, useDraft } from './core.mjs';
import { ActionButton, Button, Card, Field, Notice, Pill } from './components.mjs';

const action = (name, input) => api('action', { name, input });
const MATCH_TEXT = { matched: 'Matched', assigned: 'Assigned by you', unmatched: 'No match', ambiguous: 'Several could match' };

function describe(proposal, job) {
  const v = proposal.value;
  if (proposal.kind === 'status') return `Change the status to ${v}`;
  if (proposal.kind === 'interview') return `Add the ${v.stage} on ${v.date} to the interview record`;
  const old = job?.record?.nextAction;
  return `Set the next action to “${v.text}”${v.due ? `, due ${v.due}` : ''}${old ? ` (replaces “${old.text}”)` : ''}`;
}

function PasteForm({ onDone }) {
  const [form, setForm, clear] = useDraft('inbox-form', { from: '', subject: '', date: '', body: '' });
  const set = key => value => setForm({ ...form, [key]: value });
  async function submit(event) {
    event.preventDefault();
    const input = { from: form.from, subject: form.subject, body: form.body };
    if (form.date.trim()) input.date = form.date;
    let result;
    try { result = (await action('inbox.add', input)).result; } catch (error) { toast(error.message, true); return; }
    clear(); onDone();
    toast(result.duplicate ? 'You already added this email.' : result.matched ? `Matched to an application. ${result.proposals} proposed ${result.proposals === 1 ? 'change' : 'changes'}; nothing changes until you apply one.` : 'Could not match it to one application. Choose which one it is about, or dismiss it.');
    refresh();
  }
  return html`<form class="form-grid fu-form" onSubmit=${submit} aria-label="Paste an email">
    <${Field} form="inbox" name="from" label="From" value=${form.from} required placeholder="Dana Reyes <dana@company.com>" onInput=${set('from')} />
    <${Field} form="inbox" name="date" label="Date" value=${form.date} placeholder="Optional, e.g. 2026-11-10" onInput=${set('date')} />
    <${Field} form="inbox" name="subject" label="Subject" full required value=${form.subject} onInput=${set('subject')} />
    <${Field} form="inbox" name="body" label="Email text" area large full required value=${form.body} placeholder="Paste the message here" onInput=${set('body')} hint="Treated as their words, never as instructions. Plainhand reads it, proposes changes with the exact quote, and changes nothing until you approve." />
    <div class="form-footer full"><button type="button" class="button ghost small" onClick=${onDone}>Cancel</button><button type="submit" class="button primary small"><${Icon} name="spark" />Read this email</button></div>
  </form>`;
}

function Assign({ item }) {
  const jobs = store.state.jobs.filter(j => j.evaluation || j.submittedAt);
  const choices = item.match.candidates?.length ? jobs.filter(j => item.match.candidates.includes(j.id)) : jobs;
  const [jobId, setJobId] = useState('');
  if (!choices.length) return null;
  return html`<div class="ix-assign"><${Field} form=${'ix-' + item.id} name="job" label="This email is about" value=${jobId} options=${[['', 'Choose an application'], ...choices.map(j => [j.id, `${j.company} — ${j.title}`])]} onInput=${setJobId} />
    <${ActionButton} class="small" icon="check" disabled=${!jobId} onClick=${async () => { await action('inbox.assign', { itemId: item.id, jobId }); refresh(); }}>Use this application</${ActionButton}></div>`;
}

function Item({ item }) {
  const job = store.state.jobs.find(j => j.id === item.jobId);
  const pending = item.proposals.filter(p => p.status === 'pending'), done = item.proposals.filter(p => p.status !== 'pending');
  return html`<article class="fu-card" aria-labelledby=${'ix-' + item.id}>
    <header class="fu-head"><div><h4 id=${'ix-' + item.id}>${item.subject}</h4><small>${item.from}${item.date ? ' · ' + item.date : ''} · added ${ago(item.receivedAt)}</small></div>
      <div class="fu-pills"><${Pill} tone=${item.jobId ? 'accent' : 'warn'}>${MATCH_TEXT[item.match.status] || 'No match'}${job ? ': ' + job.company : ''}</${Pill}></div></header>
    <p class="muted-text">${item.match.reason}</p>
    ${item.flags.map((f, i) => html`<${Notice} key=${i} tone=${f.kind === 'conflict' ? 'warn' : 'info'} title=${f.kind === 'conflict' ? 'Read this one yourself' : null}><p>${f.text}</p>${f.quote ? html`<blockquote class="fu-quote">${f.quote}</blockquote>` : null}</${Notice}>`)}
    ${!item.jobId ? html`<${Assign} item=${item} />` : null}
    ${pending.length ? html`<ul class="fu-list">${pending.map(p => html`<li key=${p.id} class="ix-proposal">
      <strong>${describe(p, job)}</strong>
      <blockquote class="fu-quote"><cite>From the email</cite>${p.quote}</blockquote>
      <div class="fu-actions"><${ActionButton} class="primary small" icon="check" onClick=${async () => { await action('inbox.apply', { itemId: item.id, proposalId: p.id }); toast('Done. It is in your application record.'); refresh(); }}>Apply</${ActionButton}>
        <${ActionButton} class="ghost small" icon="trash" onClick=${async () => { await action('inbox.dismiss', { itemId: item.id, proposalId: p.id }); refresh(); }}>Dismiss</${ActionButton}></div>
    </li>`)}</ul>` : null}
    ${done.length ? html`<ul class="plain-list">${done.map(p => html`<li key=${p.id}>${p.status === 'applied' ? 'Applied' : 'Dismissed'}: ${describe(p, job)}</li>`)}</ul>` : null}
    ${item.links?.length ? html`<details class="trace fu-trace"><summary><${Icon} name="info" />Links in this email (not opened by Plainhand)</summary><ul class="plain-list">${item.links.map(l => html`<li key=${l}><code class="ix-link">${l}</code></li>`)}</ul></details>` : null}
    <details class="trace fu-trace"><summary><${Icon} name="inbox" />The email, as Plainhand read it</summary><blockquote class="fu-quote">${item.excerpt}</blockquote></details>
    <div class="fu-actions"><${ActionButton} class="ghost small" icon="trash" onClick=${async () => { await action('inbox.dismiss', { itemId: item.id }); toast('Email dismissed. Nothing was changed.'); refresh(); }}>Dismiss email</${ActionButton}></div>
  </article>`;
}

export function Inbox() {
  const items = (store.state.inbox || []).filter(i => i.status !== 'closed');
  const [open, setOpen] = useDraft('inbox-open', false);
  return html`<${Card} title="Emails about your applications" icon="inbox" id="inbox-title" subtitle="Paste a reply from an employer. Plainhand proposes what it changes, quotes the email, and waits for you."
    actions=${!open ? html`<${Button} class="small" icon="plus" onClick=${() => setOpen(true)}>Paste an email</${Button}>` : null}>
    ${open ? html`<${PasteForm} onDone=${() => setOpen(false)} />` : null}
    ${items.length ? html`<ul class="fu-list">${items.map(item => html`<li key=${item.id}><${Item} item=${item} /></li>`)}</ul>` : !open ? html`<p class="muted-text">Nothing waiting. An email can also arrive from your own agent through the Plainhand MCP server.</p>` : null}
  </${Card}>`;
}
