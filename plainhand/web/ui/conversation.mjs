// Conversation components. Shapes follow docs/AGENT-CONTRACTS.md §4:
//   message  { id, turnId, role: 'user'|'assistant', text, at, proposalId?, taskIds?, panel?, status? }
//   proposal { id, turnId, status, tainted, taintSources: [{ kind, id, label }], actions: [{ index, name, title, tier, input, summary }] }
// The profile interview uses Message/MessageList/Composer today; the assistant
// thread on Home uses all of them once the agent engine is available.
import { html, useEffect, useRef, useState, Icon, ago, store, taskProgress, TASK_TITLES, ACTIVE, useDraft, openJob, toast } from './core.mjs';
import { ActionButton, Button, Spinner } from './components.mjs';

export function Message({ message, author, children }) {
  const mine = message.role === 'user';
  return html`<article class=${'message ' + (mine ? 'from-user' : 'from-assistant') + (message.status === 'failed' ? ' failed' : '') + (message.local ? ' local' : '')} aria-label=${`${author} said`}>
    <header class="message-meta">${!mine ? html`<span class="message-avatar" aria-hidden="true">p</span>` : null}<strong>${author}</strong>${message.at ? html`<time datetime=${message.at}>${ago(message.at)}</time>` : null}</header>
    <div class="message-text">${message.text}</div>
    ${children || null}
  </article>`;
}

// Streamed text is hidden from screen readers while it grows, so it is not
// re-announced per token; the finished message is announced once by the log.
export function StreamingMessage({ text, author = 'Plainhand' }) {
  return html`<article class="message from-assistant streaming" aria-busy="true">
    <header class="message-meta"><span class="message-avatar" aria-hidden="true">p</span><strong>${author}</strong><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span><span class="visually-hidden">is replying</span></header>
    ${text ? html`<div class="message-text" aria-hidden="true">${text}</div>` : null}
  </article>`;
}

// A scrolling list that keeps the newest message in view unless the reader
// has scrolled up to read history.
// In page-flow mode the list grows with the page (the assistant thread); the
// newest entry is brought into view while the candidate is using the thread.
export function MessageList({ messages, authorFor, renderExtra, streaming, streamingKey, empty, label = 'Conversation', pageFlow, limit }) {
  const ref = useRef();
  const stick = useRef(true);
  const [showAll, setShowAll] = useState(false);
  const showStream = streaming !== null && streaming !== undefined && streaming !== false;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!pageFlow) { if (stick.current) el.scrollTop = el.scrollHeight; return; }
    const engaged = el.closest('section')?.contains(document.activeElement) && !document.activeElement?.closest('.proposal');
    if (engaged) el.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, showStream, typeof streaming === 'string' ? streaming.length : 0]);
  const hidden = limit && !showAll ? Math.max(0, messages.length - limit) : 0;
  const shown = hidden ? messages.slice(hidden) : messages;
  return html`<div class=${'message-list' + (pageFlow ? ' page-flow' : '')} ref=${ref} role="log" aria-label=${label} aria-live="polite" aria-relevant="additions" tabindex=${pageFlow ? undefined : 0} onScroll=${event => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
    ${hidden ? html`<div class="show-earlier"><button type="button" class="button ghost small" onClick=${() => setShowAll(true)}><${Icon} name="clock" />Show ${hidden} earlier ${hidden === 1 ? 'message' : 'messages'}</button></div>` : null}
    ${shown.length ? shown.map((m, i) => { const extra = renderExtra?.(m); return html`<div class=${'entry from-' + m.role} key=${m.id || i} data-id=${m.id}><${Message} message=${m} author=${authorFor(m)} />${extra ? html`<div class="entry-extras">${extra}</div>` : null}</div>`; }) : !showStream ? empty || null : null}
    ${showStream ? html`<${StreamingMessage} key=${streamingKey || 'stream'} text=${typeof streaming === 'string' ? streaming.trim() : ''} />` : null}
  </div>`;
}

// Text entry with a send button. Enter sends; Shift+Enter adds a line.
// The draft is kept in the session store, so a refresh never clears it.
export function Composer({ draftKey, onSend, disabled, busy, running, onStop, placeholder = 'Write a message…', label = 'Your message', hint, sendLabel = 'Send' }) {
  const [value, setValue, clear] = useDraft(draftKey, '');
  const [sending, setSending] = useState(false);
  async function send(event) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || disabled || busy || running || sending) return;
    setSending(true);
    try { await onSend(text); clear(); } catch (error) { if (!error.quiet) toast(error.message, true); } finally { setSending(false); }
  }
  function key(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) send(event);
  }
  const id = 'composer-' + draftKey;
  return html`<form class="composer" onSubmit=${send}>
    <label class="visually-hidden" for=${id}>${label}</label>
    <textarea id=${id} name="text" rows="2" value=${value} placeholder=${placeholder} disabled=${disabled} onInput=${e => setValue(e.currentTarget.value)} onKeyDown=${key}></textarea>
    <div class="composer-bar"><small>${hint || 'Enter to send · Shift+Enter for a new line'}</small>
      ${running && onStop ? html`<${ActionButton} class="small stop" icon="pause" onClick=${onStop}>Stop</${ActionButton}>`
        : html`<button type="submit" class="button primary small" disabled=${disabled || busy || sending || !value.trim()}>${busy || sending ? html`<${Spinner} />` : html`<${Icon} name="send" />`}${sendLabel}</button>`}</div>
  </form>`;
}

// Friendly edit forms for the common actions; anything else stays read-only.
const EDIT_FIELDS = {
  'record.setNextAction': [['text', 'What happens next?'], ['due', 'Due date', 'date']],
  'record.addContact': [['name', 'Name'], ['role', 'Their role'], ['type', 'Relationship', ['recruiter', 'hiring manager', 'interviewer', 'referral', 'other']], ['email', 'Email', 'email'], ['phone', 'Phone'], ['linkedin', 'Profile link', 'url'], ['notes', 'Notes', 'area']],
  'record.addInterview': [['stage', 'Stage'], ['date', 'Date', 'date'], ['status', 'Status', ['scheduled', 'completed', 'canceled']], ['interviewer', 'Interviewer'], ['preparation', 'Preparation'], ['notes', 'Notes', 'area']],
  'jobs.add': [['company', 'Company'], ['title', 'Role'], ['url', 'Job posting URL', 'url'], ['location', 'Location'], ['description', 'Job description', 'area']],
  'profile.update': [['location', 'Location'], ['roles', 'Target roles'], ['graduation', 'Education & graduation'], ['phone', 'Phone'], ['timezone', 'Time zone'], ['links', 'Links'], ['story', 'Your story', 'area'], ['voice', 'How you sound', 'area'], ['constraints', 'What matters to you', 'area']],
};
function editableFields(action) {
  const fields = EDIT_FIELDS[action.name];
  if (!fields) return null;
  // profile.update only edits the fields it proposes to change.
  return action.name === 'profile.update' ? fields.filter(([key]) => key in (action.input || {})) : fields;
}
function EditForm({ action, value, onChange, idPrefix }) {
  const fields = editableFields(action);
  if (!fields) return html`<p class="proposal-readonly">This change can’t be edited here. Decline it and ask for something different instead.</p>`;
  return html`<div class="proposal-edit form-grid">${fields.map(([key, label, kind]) => {
    const id = `${idPrefix}-${key}`, v = value[key] ?? '';
    const set = e => onChange({ ...value, [key]: e.currentTarget.value });
    const control = Array.isArray(kind) ? html`<select id=${id} value=${v || kind[0]} onChange=${set}>${kind.map(o => html`<option value=${o}>${o[0].toUpperCase() + o.slice(1)}</option>`)}</select>`
      : kind === 'area' ? html`<textarea id=${id} value=${v} onInput=${set}></textarea>`
      : html`<input id=${id} type=${kind || 'text'} value=${v} onInput=${set} />`;
    return html`<div class=${'field' + (kind === 'area' ? ' full' : '')} key=${key}><label for=${id}>${label}</label>${control}</div>`;
  })}</div>`;
}
const clean = input => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== '' && v !== undefined));
const STATUS_TEXT = { accepted: 'Saved', declined: 'Declined', canceled: 'Canceled', stale: 'Out of date' };

// A group of changes the assistant proposes. Nothing is saved until the
// candidate chooses Save; Edit adjusts inputs first; Undo reverses a save.
export function ProposalCard({ proposal, onConfirm, onDecline, onUndo, undoToken, autoFocus, onFocused }) {
  const ref = useRef();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({});
  useEffect(() => { if (autoFocus && ref.current) { ref.current.focus({ preventScroll: false }); onFocused?.(); } }, [autoFocus]);
  const pending = proposal.status === 'pending';
  const n = proposal.actions.length;
  const isTask = proposal.actions[0]?.tier === 'task';
  const failed = (proposal.outcomes || []).filter(o => !o.ok);
  const idBase = 'proposal-' + proposal.id.slice(0, 8);
  const anyEditable = proposal.actions.some(editableFields);
  const actionLabel = isTask ? proposal.actions[0].title : n === 1 ? proposal.actions[0].title : `${n} changes`;
  function cancelEdit() { setEditing(false); setEdits({}); }
  const changedEdits = () => {
    const out = {};
    for (const action of proposal.actions) {
      const edit = edits[action.index];
      if (edit && JSON.stringify(clean(edit)) !== JSON.stringify(clean(action.input))) out[action.index] = clean(edit);
    }
    return Object.keys(out).length ? out : undefined;
  };
  const head = pending ? (isTask ? 'Start this task?' : n === 1 ? 'Proposed change' : `${n} proposed changes`)
    : proposal.undone ? 'Undone' : proposal.status === 'accepted' && isTask ? 'Started' : STATUS_TEXT[proposal.status] || proposal.status;
  return html`<section ref=${ref} tabindex="-1" class=${'proposal status-' + proposal.status + (proposal.undone ? ' undone' : '')} aria-labelledby=${idBase + '-head'} onKeyDown=${e => { if (e.key === 'Escape' && editing) { e.stopPropagation(); cancelEdit(); } }}>
    <header class="proposal-head"><span class="proposal-icon"><${Icon} name=${pending ? 'layers' : proposal.status === 'accepted' && !proposal.undone ? 'checkCircle' : 'close'} /></span>
      <div><strong id=${idBase + '-head'}>${head}</strong><small>${pending ? (proposal.lastError ? 'Nothing was saved last time. Edit and try again, or decline.' : 'Nothing is saved until you choose.') : proposal.status === 'stale' ? 'The information changed since this was suggested. Ask again for an up-to-date version.' : proposal.edited ? 'Saved with your edits.' : proposal.status === 'accepted' ? (isTask ? 'Started by you.' : 'Confirmed by you.') : 'Nothing was changed.'}</small></div></header>
    ${proposal.tainted ? html`<div class="proposal-taint"><${Icon} name="alert" /><p>Includes text from: ${(proposal.taintSources || []).map(s => s.label).join('; ') || 'content you did not write'}. Check each change before saving.</p></div>` : null}
    <ol class="proposal-actions">${proposal.actions.map(action => {
      const outcome = (proposal.outcomes || []).find(o => o.index === action.index) || (pending && proposal.lastError && !proposal.outcomes && action.index === 0 ? { ok: false, error: proposal.lastError } : null);
      return html`<li key=${action.index} class=${outcome && !outcome.ok ? 'failed' : ''}>
        <div class="proposal-line"><span class=${'tier tier-' + action.tier}>${action.title}</span><p>${editing && edits[action.index] ? html`<em>Edited:</em> ` : null}${action.summary}</p></div>
        ${outcome && !outcome.ok ? html`<p class="proposal-failed"><${Icon} name="alert" />${outcome.error}</p>` : null}
        ${editing && pending ? html`<${EditForm} action=${action} idPrefix=${`${idBase}-${action.index}`} value=${edits[action.index] || action.input || {}} onChange=${v => setEdits(all => ({ ...all, [action.index]: v }))} />` : null}
      </li>`;
    })}</ol>
    <footer class="proposal-foot">${pending ? html`
      <${ActionButton} class="primary small" icon="check" aria-label=${isTask ? `Start: ${actionLabel}` : n === 1 ? `Save: ${actionLabel}` : `Save all ${n} changes`} onClick=${() => onConfirm(changedEdits())}>${isTask ? 'Start' : n === 1 ? 'Save' : 'Save all'}</${ActionButton}>
      ${anyEditable && !isTask ? html`<${Button} class="small" icon=${editing ? 'close' : 'edit'} aria-expanded=${editing ? 'true' : 'false'} aria-label=${editing ? 'Cancel editing' : `Edit: ${actionLabel}`} onClick=${() => editing ? cancelEdit() : setEditing(true)}>${editing ? 'Cancel edit' : 'Edit'}</${Button}>` : null}
      <${ActionButton} class="ghost small" aria-label=${`Decline: ${actionLabel}`} onClick=${onDecline}>Decline</${ActionButton}>`
      : proposal.status === 'accepted' && undoToken && !isTask ? html`<${ActionButton} class="small" icon="undo" aria-label=${`Undo: ${actionLabel}`} onClick=${onUndo}>Undo</${ActionButton}><small class="undo-hint">Available for 10 minutes</small>` : null}</footer>
  </section>`;
}

// A background task with its progress, plus cancel or retry.
export function TaskCard({ task, onCancel, onRetry, compact }) {
  const job = task.jobId ? store.state?.jobs.find(j => j.id === task.jobId) : null;
  const active = ACTIVE.includes(task.status);
  const failed = ['failed', 'interrupted'].includes(task.status);
  const progress = taskProgress(task);
  const tone = failed ? 'danger' : task.status === 'complete' ? 'success' : task.status === 'canceled' ? 'neutral' : 'info';
  return html`<article class=${'task-card tone-' + tone + (compact ? ' compact' : '')}>
    <span class="task-icon">${active ? html`<${Spinner} />` : html`<${Icon} name=${task.status === 'complete' ? 'checkCircle' : failed ? 'alert' : 'pause'} />`}</span>
    <div class="task-main">
      <div class="task-title"><strong>${TASK_TITLES[task.kind] || task.kind}</strong>${job ? html`<button type="button" class="link-button" onClick=${() => openJob(job.id, task.kind === 'prepare' ? 'packet' : 'fit')}>${job.company}</button>` : null}</div>
      <p>${task.message}</p>
      ${active ? html`<div class="task-progress">${progress.step ? html`<div class="steps" aria-label=${`Step ${progress.step} of ${progress.total}`}>${Array.from({ length: progress.total }, (_, i) => html`<i class=${i < progress.step ? 'done' : ''}></i>`)}</div><small>Step ${progress.step} of ${progress.total}</small>` : html`<div class="indeterminate"><i></i></div>`}</div>` : null}
      <small class="task-time">${task.status === 'complete' ? 'Finished' : task.status} · ${ago(task.finishedAt || task.createdAt)}</small>
    </div>
    <div class="task-actions">${active && onCancel ? html`<${ActionButton} class="ghost small" onClick=${onCancel}>Cancel</${ActionButton}>` : null}${['failed', 'interrupted', 'canceled'].includes(task.status) && onRetry ? html`<${ActionButton} class="small" icon="refresh" onClick=${onRetry}>Retry</${ActionButton}>` : null}</div>
  </article>`;
}
