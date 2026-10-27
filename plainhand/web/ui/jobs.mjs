// Jobs: discovery sources, the role list and the add-job / add-source dialogs.
import { html, useState, store, api, refresh, toast, openJob, openDialog, closeDialog, runningTask, queueTask, Icon, ago, hostOf, safeLink, useDraft, SUBMITTED } from './core.mjs';
import { ActionButton, Button, IconButton, Card, PageHeading, Field, Dialog, Tabs, Empty, CompanyMark, Score, StagePill } from './components.mjs';
import { TaskCard } from './conversation.mjs';

export function JobRow({ job, index = 0, focused }) {
  return html`<li class=${'job-row' + (focused ? ' focused' : '')} onClick=${event => { if (!event.target.closest('button,a')) openJob(job.id, job.packet && !job.submittedAt ? 'packet' : 'fit'); }}>
    <${CompanyMark} name=${job.company} index=${index} />
    <div class="job-main">
      <button type="button" class="job-title" onClick=${() => openJob(job.id, job.packet && !job.submittedAt ? 'packet' : 'fit')}>${job.title}</button>
      <div class="job-sub"><span>${job.company}</span>${job.location ? html`<span class="dot-sep" aria-hidden="true">·</span><span>${job.location}</span>` : null}</div>
    </div>
    <div class="job-side"><${Score} value=${job.evaluation?.score} /><${StagePill} job=${job} /><span class="job-time">${ago(job.createdAt)}</span></div>
  </li>`;
}

const FILTERS = {
  all: () => true,
  new: j => !j.evaluation,
  selected: j => j.selected && !SUBMITTED.includes(j.status),
  prepared: j => !!j.packet,
  submitted: j => SUBMITTED.includes(j.status),
};
export function matches(job, query) { return `${job.title} ${job.company} ${job.location || ''}`.toLowerCase().includes(query.trim().toLowerCase()); }

export function JobList({ jobs, filter, setFilter, query, setQuery, limit, searchLabel = 'Search saved roles' }) {
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, jobs.filter(f).length]));
  const shown = jobs.filter(FILTERS[filter] || FILTERS.all).filter(j => matches(j, query || ''));
  const list = limit ? shown.slice(0, limit) : shown;
  return html`<div class="job-list-wrap">
    <div class="list-toolbar">
      <${Tabs} label="Role filter" idPrefix="role-filter" value=${filter} onChange=${setFilter} tabs=${[['all', 'All', counts.all], ['new', 'To evaluate', counts.new], ['selected', 'Selected', counts.selected], ['prepared', 'Prepared', counts.prepared], ['submitted', 'Submitted', counts.submitted]]} />
      ${setQuery ? html`<div class="search"><${Icon} name="search" /><label class="visually-hidden" for="job-search">${searchLabel}</label><input id="job-search" type="search" placeholder="Search roles, companies, locations" value=${query} onInput=${e => setQuery(e.currentTarget.value)} /></div>` : null}
    </div>
    ${list.length ? html`<ul class="job-list">${list.map((job, i) => html`<${JobRow} key=${job.id} job=${job} index=${i} focused=${store.focus?.id === job.id} />`)}</ul>` : jobs.length
      ? html`<${Empty} compact title=${query ? 'No matching roles' : 'Nothing here yet'}>${query ? 'Try another company, role or location.' : 'Roles move into this list as you work on them.'}</${Empty}>`
      : html`<${Empty} icon="briefcase" title="Start with a role that interests you.">Paste a job link to evaluate it, or add a company career board to discover openings.</${Empty}>`}
    ${limit && shown.length > limit ? html`<div class="list-more"><a href="#jobs" class="button ghost small">View all ${shown.length} roles<${Icon} name="arrow" /></a></div>` : null}
  </div>`;
}

export function JobsPage() {
  const state = store.state;
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [scan, setScan] = useDraft('scan-filters', { filter: '', location: '' });
  const discovering = runningTask('discover');
  return html`
    <${PageHeading} title="Jobs" subtitle="Save a role you found, or check the company boards you follow. Nothing starts an application by itself."
      actions=${html`<${Button} class="primary" icon="plus" onClick=${() => openDialog({ type: 'add-job' })}>Add a job</${Button}>`} />
    <${Card} title="Job sources" icon="search" id="sources-title" subtitle="Company career boards, checked only when you ask. Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee are supported."
      actions=${html`<${Button} class="small" icon="plus" onClick=${() => openDialog({ type: 'add-source' })}>Add a company board</${Button}>`}>
      ${state.sources.length ? html`<ul class="source-list">${state.sources.map(s => html`<li key=${s.id} class="source-chip"><span class="source-name">${s.name}</span><a href=${safeLink(s.url)} target="_blank" rel="noreferrer">${hostOf(s.url)}<${Icon} name="external" /></a><${IconButton} icon="close" label=${`Remove ${s.name} source`} onClick=${async () => { try { await api('sources/remove', { id: s.id }); toast('Source removed.'); refresh(); } catch (e) { toast(e.message, true); } }} /></li>`)}</ul>`
        : html`<p class="muted-text">No sources yet. Add the companies you would like to work for.</p>`}
      <form class="scan-form" onSubmit=${e => e.preventDefault()}>
        <${Field} form="scan" name="filter" label="Role keywords" placeholder="Engineer, graduate, intern…" value=${scan.filter} onInput=${v => setScan({ ...scan, filter: v })} />
        <${Field} form="scan" name="scanLocation" label="Location contains" placeholder="Boston, remote…" value=${scan.location} onInput=${v => setScan({ ...scan, location: v })} />
        <${ActionButton} type="submit" class="primary" icon="refresh" disabled=${!state.sources.length || !!discovering} onClick=${() => queueTask('discover', null, { filter: scan.filter, location: scan.location })}>Check sources</${ActionButton}>
      </form>
      <small class="hint">Text filters only. Your agent evaluates the deeper fit after you save or open a role.</small>
      ${discovering ? html`<${TaskCard} task=${discovering} compact onCancel=${() => api('tasks/cancel', { id: discovering.id }).then(refresh)} />` : null}
    </${Card}>
    <${Card} title="Your roles" icon="briefcase" id="roles-title">
      <${JobList} jobs=${state.jobs} filter=${filter} setFilter=${setFilter} query=${query} setQuery=${setQuery} />
    </${Card}>`;
}

export function AddJobDialog() {
  const [job, setJob, clear] = useDraft('new-job', { company: '', title: '', url: '', location: '', description: '' });
  const set = key => value => setJob({ ...job, [key]: value });
  async function submit(event) {
    event.preventDefault();
    const result = await api('jobs', job);
    clear(); closeDialog(); await refresh(); openJob(result.id, 'fit');
    toast('Role saved. Evaluate it when you’re ready.');
  }
  return html`<${Dialog} title="Add a job" description="Save the original link. Your agent helps you work out the fit." onClose=${closeDialog}>
    <form class="form-grid" onSubmit=${e => submit(e).catch(error => toast(error.message, true))}>
      <${Field} form="job" name="company" label="Company" placeholder="Company name" required value=${job.company} onInput=${set('company')} />
      <${Field} form="job" name="title" label="Role" placeholder="Graduate Mechanical Engineer" required value=${job.title} onInput=${set('title')} />
      <${Field} form="job" name="url" label="Job posting URL" type="url" placeholder="https://…" required full value=${job.url} onInput=${set('url')} />
      <${Field} form="job" name="location" label="Location" placeholder="City, country or remote" full value=${job.location} onInput=${set('location')} />
      <${Field} form="job" name="description" label="Job description" area full placeholder="Paste the full description when the posting is behind a sign-in or a script-only page." value=${job.description} onInput=${set('description')} />
      <div class="form-footer full"><small>Saving a role does not start an application.</small><button type="submit" class="button primary">Save role<${Icon} name="arrow" /></button></div>
    </form>
  </${Dialog}>`;
}

export function AddSourceDialog() {
  const [source, setSource, clear] = useDraft('new-source', { name: '', url: '' });
  async function submit(event) {
    event.preventDefault();
    await api('sources', source);
    clear(); closeDialog(); refresh();
    toast('Company board added. Check sources to discover roles.');
  }
  return html`<${Dialog} title="Follow a company board" description="Add a public career board: Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee." onClose=${closeDialog}>
    <form class="form-grid" onSubmit=${e => submit(e).catch(error => toast(error.message, true))}>
      <${Field} form="source" name="name" label="Company name" placeholder="A company you care about" required full value=${source.name} onInput=${v => setSource({ ...source, name: v })} />
      <${Field} form="source" name="url" label="Career board URL" type="url" placeholder="https://jobs.lever.co/company" required full value=${source.url} onInput=${v => setSource({ ...source, url: v })} />
      <div class="form-footer full"><small>Sources are checked only when you ask.</small><button type="submit" class="button primary"><${Icon} name="plus" />Add source</button></div>
    </form>
  </${Dialog}>`;
}

