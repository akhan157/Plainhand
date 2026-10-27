// Campaigns: named searches over your job sources that run on a schedule while
// Plainhand is open. Each new, live, matching role is saved to the Jobs inbox
// with the reason it was surfaced. Actions go through the registry (campaigns.*).
import { html, useEffect, useState, store, api, refresh, toast, openJob, navigate, Icon, ago, plural, useDraft, ACTIVE } from './core.mjs';
import { ActionButton, Button, Card, PageHeading, Field, Empty, Notice, Pill } from './components.mjs';

const action = (name, input = {}) => api('action', { name, input });
const split = text => String(text || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
const SCHEDULES = [['manual', 'Manual only'], ['every 6 hours', 'Every 6 hours'], ['every 12 hours', 'Every 12 hours'], ['daily', 'Daily']];
function when(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (date.getTime() <= Date.now()) return 'Due now';
  return date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function status(campaign) {
  const h = campaign.health;
  if (h.running) return ['info', 'Scanning'];
  if (campaign.paused) return ['neutral', 'Paused'];
  if (h.lastStatus === 'failed') return ['danger', 'Last run failed'];
  if (h.sourceErrors.length) return ['warn', 'Source problem'];
  if (campaign.schedule === 'manual') return ['neutral', 'Manual'];
  return ['success', 'Active'];
}

function CampaignForm({ campaign, sources, onDone }) {
  const initial = campaign
    ? { name: campaign.name, terms: campaign.terms.join(', '), locations: campaign.locations.join(', '), exclusions: campaign.exclusions.join(', '), schedule: campaign.schedule, limit: String(campaign.dailyEvaluationLimit), sourceIds: campaign.sourceIds, liveness: campaign.liveness, desktop: Boolean(campaign.notify?.desktop) }
    : { name: '', terms: '', locations: '', exclusions: '', schedule: 'daily', limit: '0', sourceIds: [], liveness: true, desktop: false };
  const key = 'campaign-form-' + (campaign?.id || 'new');
  const [form, setForm, clear] = useDraft(key, initial);
  const set = name => value => setForm({ ...form, [name]: value });
  const schedules = SCHEDULES.some(([v]) => v === form.schedule) ? SCHEDULES : [...SCHEDULES, [form.schedule, form.schedule]];
  const toggleSource = id => setForm({ ...form, sourceIds: form.sourceIds.includes(id) ? form.sourceIds.filter(s => s !== id) : [...form.sourceIds, id] });
  async function submit() {
    const input = { name: form.name, terms: split(form.terms), locations: split(form.locations), exclusions: split(form.exclusions), schedule: form.schedule, dailyEvaluationLimit: Number(form.limit || 0), sourceIds: form.sourceIds.filter(id => sources.some(s => s.id === id)), liveness: form.liveness, desktop: form.desktop };
    await action(campaign ? 'campaigns.update' : 'campaigns.create', campaign ? { campaignId: campaign.id, ...input } : input);
    clear(); onDone();
    toast(campaign ? 'Campaign saved.' : form.schedule === 'manual' ? 'Campaign created. Run it when you are ready.' : 'Campaign created. Its first scan starts within a minute.');
    refresh();
  }
  const prefix = campaign ? 'edit-' + campaign.id.slice(0, 8) : 'new-campaign';
  return html`<form class="campaign-form form-grid" onSubmit=${e => e.preventDefault()} aria-label=${campaign ? `Edit ${campaign.name}` : 'New campaign'}>
    <${Field} form=${prefix} name="name" label="Campaign name" placeholder="Boston mechanical roles" required full value=${form.name} onInput=${set('name')} />
    <${Field} form=${prefix} name="terms" label="Role keywords" placeholder="Mechanical Engineer, Design Engineer" required value=${form.terms} onInput=${set('terms')} hint="A role is kept when its title contains any of these. Separate with commas." />
    <${Field} form=${prefix} name="locations" label="Locations" placeholder="Boston, Remote" value=${form.locations} onInput=${set('locations')} hint="Leave empty for any location." />
    <${Field} form=${prefix} name="exclusions" label="Leave out" placeholder="Senior, Intern, a company name" value=${form.exclusions} onInput=${set('exclusions')} hint="Roles whose title or company contains any of these are skipped." />
    <${Field} form=${prefix} name="schedule" label="Schedule" value=${form.schedule} onInput=${set('schedule')} options=${schedules} hint="Scheduled scans run while Plainhand is open. A scan missed while it was closed runs once at the next start." />
    <${Field} form=${prefix} name="limit" label="Evaluate automatically per day" type="number" value=${form.limit} onInput=${set('limit')} hint="0 to 10. With 0, new roles are only saved to your inbox. Nothing is ever prepared or applied." />
    <fieldset class="full campaign-sources"><legend>Job sources</legend>
      ${sources.length ? html`<div class="campaign-source-options">${sources.map(s => html`<label key=${s.id} class="campaign-check"><input type="checkbox" checked=${form.sourceIds.includes(s.id)} onChange=${() => toggleSource(s.id)} /><span>${s.name}</span></label>`)}</div>
        <small>${form.sourceIds.length ? `Only the ${plural(form.sourceIds.length, 'chosen source')}.` : 'None chosen: every source you follow, including ones you add later.'}</small>`
        : html`<small>No company boards yet. <a href="#jobs" onClick=${e => { e.preventDefault(); navigate('jobs'); }}>Add one under Jobs</a> before running a campaign.</small>`}
    </fieldset>
    <label class="checkbox full"><input type="checkbox" name="liveness" checked=${form.liveness} onChange=${e => set('liveness')(e.currentTarget.checked)} /><span><strong>Check each new posting is still open</strong><br /><small>Recommended. Closed postings are skipped.</small></span></label>
    <label class="checkbox full"><input type="checkbox" name="desktop" checked=${form.desktop} onChange=${e => set('desktop')(e.currentTarget.checked)} /><span><strong>Also send a desktop notification</strong><br /><small>New roles always appear here and in your Jobs inbox. A role is never notified twice.</small></span></label>
    <div class="form-footer full"><${Button} class="ghost" onClick=${() => { clear(); onDone(); }}>Cancel</${Button}><${ActionButton} type="submit" class="primary" icon="check" onClick=${submit}>${campaign ? 'Save changes' : 'Create campaign'}</${ActionButton}></div>
  </form>`;
}

function Results({ run, seenBefore }) {
  const jobs = store.state.jobs;
  if (!run) return html`<p class="muted-text campaign-empty">No runs yet.</p>`;
  if (!run.surfaced.length) return html`<p class="muted-text campaign-empty">The last run found nothing new${run.counts?.found ? ` among ${plural(run.counts.found, 'listed role')}` : ''}.</p>`;
  return html`<ul class="campaign-results">${run.surfaced.map(role => {
    const job = jobs.find(j => j.id === role.jobId);
    const fresh = job?.campaign?.surfacedAt && (!seenBefore || job.campaign.surfacedAt > seenBefore);
    return html`<li key=${role.jobId || role.url}>
      <div class="campaign-result-head">${job ? html`<button type="button" class="job-title" onClick=${() => openJob(job.id, 'fit')}>${role.title}</button>` : html`<strong>${role.title}</strong>`}${fresh ? html`<${Pill} tone="accent">New</${Pill}>` : null}</div>
      <div class="job-sub"><span>${role.company}</span>${role.location ? html`<span class="dot-sep" aria-hidden="true">·</span><span>${role.location}</span>` : null}</div>
      <p class="campaign-reason"><${Icon} name="info" /><span>${role.reason}</span></p>
    </li>`;
  })}${run.surfacedCount > run.surfaced.length ? html`<li class="muted-text">And ${run.surfacedCount - run.surfaced.length} more in your Jobs inbox.</li>` : null}</ul>`;
}

function CampaignCard({ campaign, sources, scanning, seenBefore, onEdit, onDeleted }) {
  const h = campaign.health;
  const [tone, label] = status(campaign);
  const [confirming, setConfirming] = useState(false);
  const run = campaign.lastRun;
  const names = campaign.sourceIds.length ? campaign.sourceIds.map(id => sources.find(s => s.id === id)?.name).filter(Boolean).join(', ') : 'All sources';
  const counts = h.counts;
  const known = counts ? (counts.alreadySaved || 0) + (counts.alreadySeen || 0) : 0;
  const titleId = 'campaign-' + campaign.id.slice(0, 8);
  async function act(name, message) { await action(name, { campaignId: campaign.id }); toast(message); refresh(); }
  async function remove() {
    const { undoToken } = await action('campaigns.delete', { campaignId: campaign.id });
    onDeleted({ token: undoToken, name: campaign.name }); refresh();
  }
  return html`<article class="campaign" aria-labelledby=${titleId}>
    <header class="campaign-head">
      <div class="campaign-title"><h3 id=${titleId}>${campaign.name}</h3><div class="campaign-sub"><${Pill} tone=${tone}>${label}</${Pill}><span>${campaign.scheduleLabel}</span><span class="dot-sep" aria-hidden="true">·</span><span>${names}</span></div></div>
      <div class="row-actions">
        <${ActionButton} class="small primary" icon="refresh" disabled=${scanning} onClick=${() => act('campaigns.run', `Scanning for ${campaign.name}. New roles appear here and in your Jobs inbox.`)}>Run now</${ActionButton}>
        ${campaign.paused
          ? html`<${ActionButton} class="small" icon="arrow" onClick=${() => act('campaigns.resume', `${campaign.name} resumed.`)}>Resume</${ActionButton}>`
          : html`<${ActionButton} class="small" icon="pause" onClick=${() => act('campaigns.pause', `${campaign.name} paused. Its history and saved roles are kept.`)}>Pause</${ActionButton}>`}
        <${Button} class="small ghost" icon="edit" onClick=${onEdit}>Edit</${Button}>
        ${confirming ? null : html`<${Button} class="small ghost" icon="trash" aria-label=${`Delete ${campaign.name}`} onClick=${() => setConfirming(true)}>Delete</${Button}>`}
      </div>
    </header>
    ${confirming ? html`<div class="campaign-confirm" role="group" aria-label="Confirm delete"><span>Delete this campaign? Roles it saved stay in Jobs.</span><${ActionButton} class="small danger" icon="trash" onClick=${remove}>Delete campaign</${ActionButton}><${Button} class="small ghost" onClick=${() => setConfirming(false)}>Keep it</${Button}></div>` : null}
    <ul class="campaign-chips" aria-label="Criteria">
      ${campaign.terms.map(t => html`<li key=${'t' + t} class="campaign-chip"><${Icon} name="search" />${t}</li>`)}
      ${campaign.locations.map(t => html`<li key=${'l' + t} class="campaign-chip"><${Icon} name="pin" />${t}</li>`)}
      ${campaign.exclusions.map(t => html`<li key=${'x' + t} class="campaign-chip muted"><${Icon} name="close" />Not ${t}</li>`)}
    </ul>
    <dl class="campaign-stats">
      <div><dt>Last run</dt><dd>${h.lastRunAt ? html`<time datetime=${h.lastRunAt}>${ago(h.lastRunAt)}</time>` : 'Not run yet'}</dd>${counts ? html`<small>${plural(counts.surfaced || 0, 'new role')} · ${known} already known${counts.closed ? ` · ${counts.closed} closed` : ''}</small>` : null}</div>
      <div><dt>Next run</dt><dd>${h.running ? 'Running now' : h.nextRunAt ? when(h.nextRunAt) : campaign.paused ? 'Paused' : 'When you run it'}</dd><small>${campaign.liveness ? 'Checks postings are open' : 'Open check off'}</small></div>
      <div><dt>Evaluation</dt><dd>${campaign.dailyEvaluationLimit ? `Up to ${campaign.dailyEvaluationLimit} a day` : 'Save only'}</dd><small>${campaign.dailyEvaluationLimit ? `${h.evaluationsToday} used today` : 'You choose what to evaluate'}</small></div>
    </dl>
    ${h.sourceErrors.length ? html`<${Notice} tone="warn" title=${h.sourceErrors.length === 1 ? 'A source could not be checked' : 'Some sources could not be checked'}><ul class="plain-list">${h.sourceErrors.map(s => html`<li key=${s.sourceId}><strong class="inline">${s.source}</strong>: ${s.error}${s.consecutiveFailures > 1 ? ` (${s.consecutiveFailures} runs in a row)` : ''}</li>`)}</ul>Other sources were still checked.</${Notice}>` : null}
    ${h.lastStatus === 'failed' && !h.sourceErrors.length && h.notes.length ? html`<${Notice} tone="danger" title="Last run failed">${h.notes[0]}</${Notice}>` : null}
    ${h.lastStatus !== 'failed' && h.notes.length ? html`<p class="campaign-note"><${Icon} name="info" /><span>${h.notes.join(' ')}</span></p>` : null}
    <section class="campaign-last" aria-label=${`Last results for ${campaign.name}`}><h4>Last results</h4><${Results} run=${run} seenBefore=${seenBefore} /></section>
  </article>`;
}

export function CampaignsPage() {
  const state = store.state;
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const [editing, setEditing] = useState(null);
  const [undo, setUndo] = useState(null);
  const [seenBefore] = useState(() => state.campaignBrief?.viewedAt || '');
  useEffect(() => {
    if (store.demo) return;
    action('campaigns.list').then(r => { setData(r.result); setFailure(null); }).catch(e => setFailure(e.message));
  }, [state.revision, store.demo]);
  // Roles shown here count as seen, including ones that arrive while the page is open.
  useEffect(() => {
    if (store.demo || document.visibilityState === 'hidden') return;
    const viewed = state.campaignBrief?.viewedAt || '';
    if (state.jobs.some(j => j.campaign?.surfacedAt && j.campaign.surfacedAt > viewed)) action('campaigns.markViewed').catch(() => {});
  }, [state.revision]);
  const heading = html`<${PageHeading} title="Campaigns" subtitle="Saved searches over the company boards you follow. While Plainhand is open, each one checks on its schedule and saves new, open, matching roles to your Jobs inbox with the reason it matched. Nothing is prepared or applied for you."
    actions=${!store.demo && editing !== 'new' ? html`<${Button} class="primary" icon="plus" onClick=${() => setEditing('new')}>New campaign</${Button}>` : null} />`;
  if (store.demo) return html`${heading}<${Notice} tone="info" title="Not in the sample workspace">Campaigns check real company boards. Leave the demo to set one up.</${Notice}>`;
  if (failure) return html`${heading}<${Notice} tone="danger" title="Campaigns could not be read">${failure}</${Notice}>`;
  if (!data) return html`${heading}<p class="muted-text">Loading campaigns…</p>`;
  const scanning = data.scanRunning || state.tasks.some(t => t.kind === 'campaign-scan' && ACTIVE.includes(t.status));
  return html`${heading}
    ${undo ? html`<div class="campaign-undo" role="status"><${Icon} name="trash" /><span>Deleted “${undo.name}”.</span><${ActionButton} class="small" icon="undo" onClick=${async () => { await api('action/undo', { undoToken: undo.token }); setUndo(null); toast('Campaign restored.'); refresh(); }}>Undo</${ActionButton}><${Button} class="small ghost" onClick=${() => setUndo(null)}>Dismiss</${Button}></div>` : null}
    ${!data.sources.length ? html`<${Notice} tone="warn" title="Follow a company board first">Campaigns scan the career boards you add under Jobs.<div><${Button} class="small" iconEnd="arrow" onClick=${() => navigate('jobs')}>Go to Jobs</${Button}></div></${Notice}>` : null}
    ${editing === 'new' ? html`<${Card} title="New campaign" icon="plus" id="new-campaign-title"><${CampaignForm} sources=${data.sources} onDone=${() => setEditing(null)} /></${Card}>` : null}
    ${data.campaigns.length ? html`<div class="campaign-list">${data.campaigns.map(c => editing === c.id
        ? html`<${Card} key=${c.id} title=${`Edit ${c.name}`} icon="edit" id=${'edit-title-' + c.id.slice(0, 8)}><${CampaignForm} campaign=${c} sources=${data.sources} onDone=${() => setEditing(null)} /></${Card}>`
        : html`<${CampaignCard} key=${c.id} campaign=${c} sources=${data.sources} scanning=${scanning} seenBefore=${seenBefore} onEdit=${() => setEditing(c.id)} onDeleted=${setUndo} />`)}</div>`
      : editing !== 'new' ? html`<${Card}><${Empty} icon="layers" title="No campaigns yet." action=${html`<${Button} class="primary" icon="plus" onClick=${() => setEditing('new')}>New campaign</${Button}>`}>Name a search once, such as “Mechanical engineer roles in Boston”, and Plainhand keeps checking for new postings.</${Empty}></${Card}>` : null}`;
}
