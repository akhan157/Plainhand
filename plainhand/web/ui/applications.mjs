// Applications: the follow-up queue and the tracker table.
import { html, useState, store, openJob, navigate, Icon, ago, Day, relativeDay, queues } from './core.mjs';
import { Button, Card, PageHeading, Empty, Notice, Pill, Score, StagePill } from './components.mjs';
import { StatusSelect } from './jobpanel.mjs';
import { matches } from './jobs.mjs';

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

function legacyRows(state) {
  return state.tracker?.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(s => s.trim()))
    .filter(c => !state.jobs.some(j => j.company.toLowerCase() === c[3]?.toLowerCase() && j.title.toLowerCase() === c[4]?.toLowerCase())) || [];
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
  const jobs = state.jobs.filter(j => j.evaluation && matches(j, query));
  const legacy = legacyRows(state);
  return html`
    <${PageHeading} title="Applications" subtitle="Every application in one clear picture: status, follow-ups and what happens next."
      actions=${html`<${Button} icon="search" onClick=${() => navigate('jobs')}>Find roles</${Button}>`} />
    <${Queues} />
    <${FollowUps} />
    <${Card} title="Tracker" icon="briefcase" id="tracker-title" subtitle=${`${jobs.length} evaluated ${jobs.length === 1 ? 'role' : 'roles'}${legacy.length ? ` · ${legacy.length} from your existing tracker` : ''}`}
      actions=${html`<div class="search"><${Icon} name="search" /><label class="visually-hidden" for="app-search">Search applications</label><input id="app-search" type="search" placeholder="Search applications" value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></div>`}>
      ${jobs.length || legacy.length ? html`<div class="table-wrap"><table class="tracker">
        <thead><tr><th scope="col">Role & company</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Next step</th></tr></thead>
        <tbody>${jobs.map(j => html`<tr key=${j.id} class=${store.focus?.id === j.id ? 'focused' : ''}>
          <td data-label="Role"><button type="button" class="job-title" onClick=${() => openJob(j.id, SUBMIT(j) ? 'record' : j.packet ? 'packet' : 'fit')}>${j.title}</button><span class="sub">${j.company}</span><span class="row-pill"><${StagePill} job=${j} /></span></td>
          <td data-label="Fit"><${Score} value=${j.evaluation.score} /></td>
          <td data-label="Status"><${StatusSelect} job=${j} /></td>
          <td data-label="Next step" class="next-cell">${j.record?.nextAction ? html`<span>${j.record.nextAction.text}</span>${j.record.nextAction.due ? html`<small><${Day} iso=${j.record.nextAction.due} /></small>` : null}` : html`<span class="muted-inline">—</span>`}</td>
        </tr>`)}
        ${legacy.map((c, i) => html`<tr key=${'legacy' + i} class="legacy"><td data-label="Role">${c[4]}<span class="sub">${c[3]}</span></td><td data-label="Fit">${c[5]}</td><td data-label="Status">${c[6]}</td><td data-label="Next step"><${Pill}>Existing tracker</${Pill}> <span class="muted-inline">Managed in applications.md</span></td></tr>`)}</tbody>
      </table></div>` : html`<${Empty} icon="briefcase" title="Your search is taking shape." action=${html`<${Button} class="small" iconEnd="arrow" onClick=${() => navigate('jobs')}>Browse roles</${Button}>`}>Evaluate a saved role to see it here. A prepared draft stays separate from an application you actually submitted.</${Empty}>`}
    </${Card}>
    <${Notice} tone="info">Statuses stay in sync with your applications tracker. Only mark Applied after you have submitted the application yourself; Plainhand asks you to confirm.</${Notice}>`;
}
const SUBMIT = j => ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(j.status);
