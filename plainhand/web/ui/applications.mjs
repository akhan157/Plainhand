// Applications: the follow-up queue, the people you have spoken to, the tracker
// as a table or a stage board, and spreadsheet / calendar exports.
import { html, useState, store, openJob, navigate, Icon, ago, Day, relativeDay, queues, api, refresh, toast, openDialog, downloadFile, STATUSES } from './core.mjs';
import { ActionButton, Button, Card, PageHeading, Empty, Notice, Pill, Score, StagePill, Tabs } from './components.mjs';
import { StatusSelect } from './jobpanel.mjs';
import { matches } from './jobs.mjs';
import { Inbox } from './inbox.mjs';

export function FollowUps() {
  const state = store.state;
  const items = (state.followUps || []).map(item => ({ ...item, job: state.jobs.find(j => j.id === item.jobId) })).filter(item => item.job);
  if (!items.length) return null;
  return html`<${Card} title="Follow-ups" icon="flag" id="followups-title" subtitle="Your next actions, overdue first, then applications still waiting for one.">
    <ul class="followups">${items.map(item => html`<li key=${item.jobId} class=${item.overdue ? 'tone-danger' : item.dueToday ? 'tone-warn' : ''}>
      <div class="fu-main"><strong>${item.job.company} — ${item.job.title}</strong>
        ${item.action ? html`<p><span class="fu-action">${item.action}</span>${item.due ? html` · ${item.overdue ? 'overdue since' : item.dueToday ? 'due today,' : 'due'} <${Day} iso=${item.due} /> <span class="muted-inline">(${relativeDay(item.due)})</span>` : ' · no due date'}</p>`
          : html`<p>${item.job.status} · last change ${ago(item.last)} · no next action set</p>`}</div>
      ${item.overdue ? html`<${Pill} tone="danger">Overdue</${Pill}>` : item.dueToday ? html`<${Pill} tone="warn">Today</${Pill}>` : null}
      <${Button} class="small" iconEnd="chevron" onClick=${() => openJob(item.job.id, 'record')}>Open record</${Button}>
    </li>`)}</ul>
  </${Card}>`;
}

// "Technical recruiter", or "Recruiter · Referral" when the two say different
// things. Records often carry the same word twice.
function describe(contact) {
  const role = String(contact.role || '').trim(), type = String(contact.type || '').trim();
  if (!role) return type || 'No role recorded';
  return type && !role.toLowerCase().includes(type.toLowerCase()) ? `${role} · ${type}` : role;
}

// Everyone recorded on an application, newest first, with the role they belong to.
export function People() {
  const people = [];
  for (const job of store.state.jobs) for (const contact of job.record?.contacts || []) people.push({ ...contact, job });
  if (!people.length) return null;
  people.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  return html`<${Card} title="People" icon="users" id="people-title" subtitle="Everyone you have spoken to about a role.">
    <ul class="people">${people.map(contact => html`<li key=${contact.id + contact.job.id}>
      <span class="person-icon"><${Icon} name="user" /></span>
      <div class="person-main"><strong>${contact.name}</strong><p>${describe(contact)}</p>
        ${contact.email ? html`<small>${contact.email}</small>` : null}</div>
      <${Button} class="small ghost" iconEnd="chevron" onClick=${() => openJob(contact.job.id, 'record')}>${contact.job.company}</${Button}>
    </li>`)}</ul>
  </${Card}>`;
}

function legacyRows(state) {
  return state.tracker?.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(s => s.trim()))
    .filter(c => !state.jobs.some(j => j.company.toLowerCase() === c[3]?.toLowerCase() && j.title.toLowerCase() === c[4]?.toLowerCase())) || [];
}

// The stage columns are the canonical tracker statuses, in pipeline order.
const COLUMN = status => status === 'SKIP' ? 'Skip' : status;

// Move a card to another stage. Applied is recorded only through the
// confirmation dialog, because that status means you submitted yourself.
async function moveTo(job, status) {
  if (job.status === status) return;
  if (status === 'Applied') { openDialog({ type: 'confirm-submit', id: job.id }); return; }
  try { await api('jobs/update', { id: job.id, status }); toast(`Moved to ${COLUMN(status)}.`); refresh(); }
  catch (error) { toast(error.message, true); }
}

// A job always carries a canonical status; an imported or half-built one may not.
const stageOf = job => STATUSES.includes(job.status) ? job.status : 'Evaluated';

function Board({ jobs }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  return html`<div class="board" role="list" aria-label="Applications by stage">
    ${STATUSES.map(status => {
      const items = jobs.filter(job => stageOf(job) === status);
      return html`<section key=${status} class=${'board-column' + (over === status ? ' over' : '') + (dragging ? ' dragging' : '')} role="listitem"
        aria-labelledby=${'board-' + status}
        onDragOver=${event => { event.preventDefault(); if (over !== status) setOver(status); }}
        onDragLeave=${event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(null); }}
        onDrop=${event => { event.preventDefault(); setOver(null); const id = event.dataTransfer.getData('text/plain') || dragging; const job = jobs.find(j => j.id === id); setDragging(null); if (job) moveTo(job, status); }}>
        <header class="board-column-head"><h3 id=${'board-' + status}>${COLUMN(status)}</h3><span class="board-count">${items.length}</span></header>
        <div class="board-cards">
          ${items.map(job => html`<article key=${job.id} class="board-card" draggable=${true}
            onDragStart=${event => { event.dataTransfer.setData('text/plain', job.id); event.dataTransfer.effectAllowed = 'move'; setDragging(job.id); }}
            onDragEnd=${() => { setDragging(null); setOver(null); }}>
            <button type="button" class="board-card-title" onClick=${() => openJob(job.id, SUBMIT(job) ? 'record' : job.packet ? 'packet' : 'fit')}>${job.title}</button>
            <p class="board-card-company">${job.company}</p>
            <div class="board-card-meta"><${Score} value=${job.evaluation.score} /></div>
            ${job.record?.nextAction?.due ? html`<p class="board-card-due"><${Icon} name="calendar" /> <${Day} iso=${job.record.nextAction.due} /></p>` : null}
            <div class="board-card-stage" onClick=${event => event.stopPropagation()}><${StatusSelect} job=${job} id=${'board-status-' + job.id} /></div>
          </article>`)}
          ${items.length ? null : html`<p class="board-empty">${dragging ? html`Drop to move here` : 'No roles'}</p>`}
        </div>
      </section>`;
    })}
  </div>`;
}

function Queues() {
  const q = queues(store.state);
  if (!q.review.length && !q.apply.length) return null;
  const item = (count, label, meta, run, button) => html`<div class="queue-item"><div><strong>${count} ${label}</strong><span class="muted-text">${meta}</span></div><${Button} class="primary" iconEnd="arrow" onClick=${run}>${button}</${Button}></div>`;
  return html`<${Card} title="Work through your queue" icon="layers" id="queues-title" subtitle="One after another: review each packet, then fill each approved application and submit it yourself.">
    <div class="queue-items">
      ${q.review.length ? item(q.review.length, q.review.length === 1 ? 'packet to review' : 'packets to review', 'Read, adjust and approve.', () => openJob(q.review[0], 'packet'), 'Start reviewing') : null}
      ${q.apply.length ? item(q.apply.length, q.apply.length === 1 ? 'approved application to send' : 'approved applications to send', 'Plainhand fills the form; you check and submit.', () => openJob(q.apply[0], 'apply'), 'Start applying') : null}
    </div>
  </${Card}>`;
}

export function ApplicationsPage() {
  const state = store.state;
  const [query, setQuery] = useState('');
  const [view, setView] = useState('list');
  const jobs = state.jobs.filter(j => j.evaluation && matches(j, query));
  const legacy = legacyRows(state);
  const byStage = STATUSES.map(status => [status, jobs.filter(j => stageOf(j) === status).length]).filter(([, count]) => count);
  return html`
    <${PageHeading} title="Applications" subtitle="Every application in one clear picture: status, follow-ups and what happens next."
      actions=${html`${!store.demo ? html`<${ActionButton} class="ghost" icon="download" onClick=${() => downloadFile('applications.csv', 'plainhand-applications.csv')}>Export CSV</${ActionButton}>` : null}
        ${!store.demo ? html`<${ActionButton} class="ghost" icon="calendar" onClick=${() => downloadFile('calendar.ics', 'plainhand-calendar.ics')}>Deadlines to calendar</${ActionButton}>` : null}
        <${Button} icon="search" onClick=${() => navigate('jobs')}>Find roles</${Button}>`} />
    <${Queues} />
    <${Inbox} />
    <${FollowUps} />
    <${People} />
    <${Card} title="Tracker" icon="briefcase" id="tracker-title" subtitle=${`${jobs.length} evaluated ${jobs.length === 1 ? 'role' : 'roles'}${byStage.length ? ' · ' + byStage.map(([status, count]) => `${count} ${COLUMN(status)}`).join(' · ') : ''}${legacy.length ? ` · ${legacy.length} from your existing tracker` : ''}`}
      actions=${html`<div class="search"><${Icon} name="search" /><label class="visually-hidden" for="app-search">Search applications</label><input id="app-search" type="search" placeholder="Search applications" value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></div>`}>
      ${jobs.length || legacy.length ? html`<${Tabs} tabs=${[['list', 'Table'], ['board', 'Board']]} value=${view} onChange=${setView} label="Tracker view" />
        ${view === 'board' ? html`<p class="board-hint">Drag a card to another stage, or use the stage menu on the card. Later stages are further right.</p><${Board} jobs=${jobs} />` : html`<div class="table-wrap"><table class="tracker">
        <thead><tr><th scope="col">Role & company</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Next step</th></tr></thead>
        <tbody>${jobs.map(j => html`<tr key=${j.id} class=${store.focus?.id === j.id ? 'focused' : ''}>
          <td data-label="Role"><button type="button" class="job-title" onClick=${() => openJob(j.id, SUBMIT(j) ? 'record' : j.packet ? 'packet' : 'fit')}>${j.title}</button><span class="sub">${j.company}</span><span class="row-pill"><${StagePill} job=${j} /></span></td>
          <td data-label="Fit"><${Score} value=${j.evaluation.score} /></td>
          <td data-label="Status"><${StatusSelect} job=${j} /></td>
          <td data-label="Next step" class="next-cell">${j.record?.nextAction ? html`<span>${j.record.nextAction.text}</span>${j.record.nextAction.due ? html`<small><${Day} iso=${j.record.nextAction.due} /></small>` : null}` : html`<span class="muted-inline">—</span>`}</td>
        </tr>`)}
        ${legacy.map((c, i) => html`<tr key=${'legacy' + i} class="legacy"><td data-label="Role">${c[4]}<span class="sub">${c[3]}</span></td><td data-label="Fit">${c[5]}</td><td data-label="Status">${c[6]}</td><td data-label="Next step"><${Pill}>Existing tracker</${Pill}> <span class="muted-inline">Managed in applications.md</span></td></tr>`)}</tbody>
      </table></div>`}` : html`<${Empty} icon="briefcase" title="Your search is taking shape." action=${html`<${Button} class="small" iconEnd="arrow" onClick=${() => navigate('jobs')}>Browse roles</${Button}>`}>Evaluate a saved role to see it here. A prepared draft stays separate from an application you actually submitted.</${Empty}>`}
    </${Card}>
    <${Notice} tone="info">Statuses stay in sync with your applications tracker. Only mark Applied after you have submitted the application yourself; Plainhand asks you to confirm.</${Notice}>`;
}
const SUBMIT = j => ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(j.status);
