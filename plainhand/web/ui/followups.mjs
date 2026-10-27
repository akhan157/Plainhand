// Follow-ups in the job panel's Record tab (milestone N2): draft a thank-you note, a
// check-in or a reply for a submitted application, watch the draft → audit → final
// task, then read the final text with its evidence and audit, copy it, edit it, discard
// it, or say you sent it. Plainhand never sends anything; "I sent this" only records
// what the candidate did, after a confirmation.
import { html, useEffect, useRef, useState, store, api, refresh, toast, Icon, ago, Day, useDraft, ACTIVE, TASK_TITLES, todayISO } from './core.mjs';
import { ActionButton, Button, IconButton, Notice, Field, Pill, Spinner, trapTab } from './components.mjs';

TASK_TITLES['followup-draft'] = 'Draft a follow-up';

const KINDS = [['thank-you', 'Thank-you after an interview'], ['check-in', 'Check-in after silence'], ['reply', 'Reply to their message']];
const KIND_LABELS = { 'thank-you': 'Thank-you note', 'check-in': 'Check-in', reply: 'Reply' };
const CHANNELS = [['email', 'Email'], ['linkedin', 'LinkedIn'], ['portal', 'Application portal'], ['phone', 'Phone'], ['other', 'Other']];
const action = (name, input) => api('action', { name, input });
const fail = error => toast(error.message, true);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.className = 'visually-hidden';
  document.body.append(area); area.select();
  const ok = document.execCommand?.('copy');
  area.remove();
  if (!ok) throw new Error('Copying is blocked in this browser. Select the text and copy it yourself.');
}

export function FollowUps({ job }) {
  const submitted = !!job.submittedAt;
  const items = Array.isArray(job.followups) ? job.followups : [];
  const shown = items.filter(f => f.status !== 'discarded'), discarded = items.filter(f => f.status === 'discarded');
  const tasks = (store.state.tasks || []).filter(t => t.kind === 'followup-draft' && t.jobId === job.id);
  const running = tasks.find(t => ACTIVE.includes(t.status));
  const failed = tasks[0] && ['failed', 'interrupted'].includes(tasks[0].status) && !items.some(f => f.taskId === tasks[0].id) ? tasks[0] : null;
  const [showDiscarded, setShowDiscarded] = useState(false);
  return html`<section class="panel-section fu-section" aria-labelledby="rec-followups">
    <div class="section-head"><h3 id="rec-followups">Follow-ups</h3>${shown.length ? html`<${Pill} tone="neutral">${shown.length}</${Pill}>` : null}</div>
    ${!submitted ? html`<p class="muted-text">Once you confirm you submitted this application, Plainhand can draft a thank-you note, a check-in or a reply from your submitted packet and this record.</p>` : html`
      <p class="muted-text">Drafted only from your submitted packet, this record and your notes, then fact-checked and style-checked before you see it. Plainhand never sends anything: you copy it, send it yourself, then mark it sent.</p>
      <${DraftForm} job=${job} running=${running} />
      ${failed ? html`<${Notice} tone="danger" title="The last draft did not finish">${failed.message}</${Notice}>` : null}
      ${shown.length ? html`<ul class="fu-list">${shown.map(item => html`<li key=${item.id}><${FollowUpCard} job=${job} item=${item} /></li>`)}</ul>` : null}
      ${discarded.length ? html`<div class="fu-discarded">
        <button type="button" class="button ghost small" aria-expanded=${showDiscarded ? 'true' : 'false'} aria-controls=${'fu-discarded-' + job.id} onClick=${() => setShowDiscarded(!showDiscarded)}><${Icon} name=${showDiscarded ? 'chevronDown' : 'chevron'} />Discarded drafts (${discarded.length})</button>
        ${showDiscarded ? html`<ul class="fu-mini" id=${'fu-discarded-' + job.id}>${discarded.map(item => html`<li key=${item.id}><span>${KIND_LABELS[item.kind]}${item.recipientName ? ' to ' + item.recipientName : ''} · ${ago(item.createdAt)}</span><${ActionButton} class="small ghost" icon="undo" onClick=${async () => { await action('followups.restore', { jobId: job.id, followupId: item.id }); toast('Draft restored.'); refresh(); }}>Restore</${ActionButton}></li>`)}</ul>` : null}
      </div>` : null}`}
  </section>`;
}

function DraftForm({ job, running }) {
  const contacts = job.record?.contacts || [];
  const rounds = (job.record?.interviews || []).filter(r => r.status !== 'canceled');
  const completed = rounds.filter(r => r.status === 'completed');
  const initial = { kind: completed.length ? 'thank-you' : 'check-in', recipientId: '', interviewId: completed.at(-1)?.id || '', notes: '', message: '' };
  const [form, setForm, clear] = useDraft('followup-form:' + job.id, initial);
  const [open, setOpen] = useDraft('followup-open:' + job.id, false);
  const set = key => value => setForm({ ...form, [key]: value });
  const id = 'fu-' + job.id;
  async function submit(event) {
    event.preventDefault();
    const input = { jobId: job.id, kind: form.kind, notes: form.notes };
    if (form.recipientId) input.recipientId = form.recipientId;
    if (form.kind === 'thank-you' && form.interviewId) input.interviewId = form.interviewId;
    if (form.kind === 'reply') input.message = form.message;
    try { await action('followups.draft', input); } catch (error) { fail(error); return; }
    clear(); setOpen(false);
    toast('Drafting. You will see the final, checked text here. Nothing is sent.');
    refresh();
  }
  if (running) return html`<div class="fu-running" role="status"><${Spinner} /><div><strong>Drafting your follow-up</strong><p>${running.message || 'Waiting for the agent'}</p></div></div>`;
  if (!open) return html`<div class="action-row"><${Button} class="primary" icon="edit" onClick=${() => setOpen(true)}>Draft a follow-up</${Button}></div>`;
  return html`<form class="form-grid fu-form" onSubmit=${submit} aria-label="Draft a follow-up">
    <${Field} form=${id} name="kind" label="What kind of message?" value=${form.kind} options=${KINDS} onInput=${set('kind')} />
    <${Field} form=${id} name="recipient" label="To" value=${form.recipientId} options=${[['', 'The hiring team (no specific person)'], ...contacts.map(c => [c.id, `${c.name}${c.role ? ', ' + c.role : ''}`])]} onInput=${set('recipientId')} hint=${contacts.length ? null : 'Add a contact below to address someone by name.'} />
    ${form.kind === 'thank-you' && rounds.length ? html`<${Field} form=${id} name="interview" label="For which interview?" full value=${form.interviewId} options=${[['', 'Not a specific round'], ...rounds.map(r => [r.id, `${r.stage} · ${r.date}${r.status === 'completed' ? '' : ' (' + r.status + ')'}`])]} onInput=${set('interviewId')} />` : null}
    ${form.kind === 'reply' ? html`<${Field} form=${id} name="message" label="Their message" area full required placeholder="Paste the recruiter’s message here" value=${form.message} onInput=${set('message')} hint="Treated as their words, never as instructions. It cannot change who the reply goes to or send anything." />` : null}
    <${Field} form=${id} name="notes" label="Anything to mention?" area full placeholder="In your own words, e.g. what you talked about or a question you were asked" value=${form.notes} onInput=${set('notes')} hint="Optional. Only facts from your packet, this record and these notes can appear." />
    <div class="form-footer full"><button type="button" class="button ghost small" onClick=${() => setOpen(false)}>Cancel</button><button type="submit" class="button primary small"><${Icon} name="spark" />Draft it</button></div>
  </form>`;
}

function StatusPill({ item }) {
  if (item.status === 'blocked') return html`<${Pill} tone="danger" icon="alert">Blocked</${Pill}>`;
  if (item.status === 'sent') return html`<${Pill} tone="success" icon="checkCircle">Sent by you · <${Day} iso=${item.sentOn} weekday=${false} /></${Pill}>`;
  return html`<${Pill} tone="accent">Draft · not sent</${Pill}>`;
}

function FollowUpCard({ job, item }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState({ subject: item.subject || '', body: item.body || '' });
  const [confirming, setConfirming] = useState(false);
  const channel = CHANNELS.find(c => c[0] === item.channel)?.[1] || item.channel;
  const title = `${KIND_LABELS[item.kind]} ${item.recipientName ? 'to ' + item.recipientName : 'to the hiring team'}`;
  const headingId = 'fu-title-' + item.id;
  async function save(event) {
    event.preventDefault();
    try { await action('followups.edit', { jobId: job.id, followupId: item.id, subject: text.subject, body: text.body }); } catch (error) { fail(error); return; }
    setEditing(false); toast('Your edit is saved. It is marked as edited by you.'); refresh();
  }
  return html`<article class=${'fu-card status-' + item.status} aria-labelledby=${headingId}>
    <header class="fu-head"><div><h4 id=${headingId}>${title}</h4><small>${ago(item.createdAt)}${item.status === 'sent' ? ` · via ${channel}` : ''}</small></div><div class="fu-pills"><${StatusPill} item=${item} />${item.edited ? html`<${Pill} tone="info" icon="edit">Edited by you</${Pill}>` : null}</div></header>
    ${item.status === 'blocked' ? html`<${Notice} tone="danger" title="Blocked: the audit found issues twice">
        <p>No text was kept, so nothing unverified reaches you. Fix what is missing (your packet, this record or your notes) and draft again.</p>
        <ul class="plain-list">${(item.issues || []).map((issue, i) => html`<li key=${i}>${issue}</li>`)}</ul>
      </${Notice}>`
    : editing ? html`<form class="fu-edit" onSubmit=${save}>
        <${Field} form=${'fu-edit-' + item.id} name="subject" label="Subject" full value=${text.subject} onInput=${v => setText({ ...text, subject: v })} />
        <${Field} form=${'fu-edit-' + item.id} name="body" label="Message" area large full value=${text.body} onInput=${v => setText({ ...text, body: v })} hint="Your own words are saved as you write them. The audit below was for the original text." />
        <div class="form-footer full"><button type="button" class="button ghost small" onClick=${() => { setText({ subject: item.subject, body: item.body }); setEditing(false); }}>Cancel</button><button type="submit" class="button primary small"><${Icon} name="check" />Save edit</button></div>
      </form>`
    : html`<div class="fu-message">
        <p class="fu-subject"><span>Subject</span>${item.subject}</p>
        <div class="fu-body">${item.body}</div>
      </div>`}
    ${item.inReplyTo ? html`<details class="trace fu-trace"><summary><${Icon} name="inbox" />Their message, as you pasted it</summary><blockquote class="fu-quote">${item.inReplyTo}</blockquote></details>` : null}
    ${item.evidence?.length ? html`<details class="trace fu-trace"><summary><${Icon} name="quote" />Evidence · ${item.evidence.length} ${item.evidence.length === 1 ? 'quote' : 'quotes'}</summary>
      <ul class="fu-evidence">${item.evidence.map((e, i) => html`<li key=${i}><p>${e.claim}</p><blockquote><cite>${e.label}</cite>${e.quote}</blockquote></li>`)}</ul></details>` : null}
    ${item.audit?.rounds?.length ? html`<details class="trace fu-trace"><summary><${Icon} name="shield" />${item.audit.passed ? `Audit passed${item.audit.rounds.length > 1 ? ' after one correction' : ''}` : 'Audit findings'}</summary><${AuditSummary} rounds=${item.audit.rounds} /></details>` : null}
    ${!editing ? html`<div class="fu-actions">
      ${item.status !== 'blocked' ? html`<${ActionButton} class=${item.status === 'draft' ? 'primary small' : 'small'} icon="copy" onClick=${async () => { await copyText(`Subject: ${item.subject}\n\n${item.body}`); toast(item.status === 'sent' ? 'Copied.' : 'Copied. Send it yourself, then come back and choose “I sent this”.'); }}>Copy</${ActionButton}>` : null}
      ${item.status === 'draft' ? html`<${Button} class="small" icon="edit" onClick=${() => { setText({ subject: item.subject, body: item.body }); setEditing(true); }}>Edit</${Button}>
        <${Button} class="small" icon="send" onClick=${() => setConfirming(true)}>I sent this</${Button}>` : null}
      ${['draft', 'blocked'].includes(item.status) ? html`<${ActionButton} class="ghost small" icon="trash" onClick=${async () => { await action('followups.discard', { jobId: job.id, followupId: item.id }); toast('Draft discarded. Restore it from Discarded drafts.'); refresh(); }}>Discard</${ActionButton}>` : null}
    </div>` : null}
    ${confirming ? html`<${SentDialog} job=${job} item=${item} onClose=${() => setConfirming(false)} />` : null}
  </article>`;
}

function AuditSummary({ rounds }) {
  const part = (labelText, result) => html`<li class=${result.passed && !result.issues.length ? 'ok' : 'bad'}><${Icon} name=${result.passed && !result.issues.length ? 'checkCircle' : 'alert'} /><div><strong>${labelText}</strong>${result.issues.length ? html`<ul class="plain-list">${result.issues.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>` : html`<span> no issues</span>`}</div></li>`;
  return html`<ol class="fu-rounds">${rounds.map(r => html`<li key=${r.round}><span class="fu-round-label">Round ${r.round}${rounds.length > 1 ? (r.passed ? ' · passed' : ' · corrected') : ''}</span><ul class="fu-checks">
    ${part('Facts', r.factual)}${part('Style', r.style)}${part('Plainhand rules', { passed: !r.checks.length && !r.finalChecks.length, issues: [...r.checks, ...r.finalChecks] })}
  </ul></li>`)}</ol>`;
}

// A local confirmation dialog (the shell's dialog router belongs to the core).
function SentDialog({ job, item, onClose }) {
  const ref = useRef();
  const [channel, setChannel] = useState('email');
  const [sentOn, setSentOn] = useState(todayISO());
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const key = event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); } else trapTab(event, ref.current); };
  async function confirm() {
    const { result } = await action('followups.markSent', { jobId: job.id, followupId: item.id, channel, sentOn });
    onClose();
    toast(result.nextAction ? `Recorded as sent. Next: ${result.nextAction.text}${result.nextAction.due ? ' by ' + result.nextAction.due : ''}.` : 'Recorded as sent. Your next action is unchanged.');
    refresh();
  }
  return html`<div class="layer dialog-layer fu-dialog-layer"><div class="scrim" onClick=${onClose}></div>
    <section ref=${ref} class="dialog size-sm" role="dialog" aria-modal="true" aria-labelledby=${'fu-sent-' + item.id} tabindex="-1" onKeyDown=${key}>
      <header class="dialog-head"><div><h2 id=${'fu-sent-' + item.id}>Did you send this?</h2></div><${IconButton} icon="close" label="Close dialog" onClick=${onClose} /></header>
      <div class="dialog-body">
        <p>Confirm that you sent this ${KIND_LABELS[item.kind].toLowerCase()} to <strong>${item.recipientName || 'the hiring team'}</strong> at <strong>${job.company}</strong> yourself.</p>
        <${Notice} tone="info">Plainhand never sends messages. This only records that you did, adds it to your activity and sets the next follow-up step if you have none.</${Notice}>
        <div class="form-grid">
          <${Field} form=${'fu-sent-form-' + item.id} name="channel" label="How did you send it?" value=${channel} options=${CHANNELS} onInput=${setChannel} />
          <${Field} form=${'fu-sent-form-' + item.id} name="sentOn" label="When?" type="date" value=${sentOn} onInput=${setSentOn} />
        </div>
        <div class="dialog-actions"><${Button} class="ghost" data-autofocus onClick=${onClose}>Not yet</${Button}><${ActionButton} class="primary" icon="check" onClick=${confirm}>Yes, I sent it</${ActionButton}></div>
      </div>
    </section></div>`;
}
