// Activity (agent tasks and workspace events) and AI usage.
import { html, store, api, refresh, toast, queueTask, Icon, ago, providerNames } from './core.mjs';
import { Card, PageHeading, Empty, Notice, Pill } from './components.mjs';
import { TaskCard } from './conversation.mjs';

export function EventList({ limit = 40 }) {
  const items = store.state.events.slice(0, limit);
  return items.length ? html`<ol class="timeline">${items.map((e, i) => html`<li key=${i}><span class="tl-dot"><${Icon} name="check" /></span><div><p>${e.text}</p><small><time datetime=${e.at}>${ago(e.at)}</time></small></div></li>`)}</ol>`
    : html`<${Empty} compact>Profile updates, connection checks and discoveries appear here.</${Empty}>`;
}

export function ActivityPage() {
  const state = store.state;
  return html`
    <${PageHeading} title="Activity" subtitle="What your agent is doing, what it finished, and what happened in your workspace." />
    <${Card} title="Agent tasks" icon="activity" id="tasks-title" subtitle="Tasks keep their progress here, even if a provider needs you to sign in again." actions=${html`<${Pill}>${state.tasks.length} ${state.tasks.length === 1 ? 'task' : 'tasks'}</${Pill}>`}>
      ${state.tasks.length ? html`<div class="task-list">${state.tasks.map(t => html`<${TaskCard} key=${t.id} task=${t}
          onCancel=${async () => { await api('tasks/cancel', { id: t.id }); toast('Cancellation requested. Saved work is preserved.'); refresh(); }}
          onRetry=${() => queueTask(t.kind, t.jobId, { ...t.input, retryOf: t.id })} />`)}</div>`
        : html`<${Empty} icon="activity" title="Nothing running right now.">Start with your profile or a role you’re interested in.</${Empty}>`}
    </${Card}>
    <${Card} title="Workspace history" icon="clock" id="events-title"><${EventList} /></${Card}>`;
}

const number = value => typeof value === 'number' ? value.toLocaleString() : 'Unavailable';
const metric = value => number(value?.value);
const duration = value => typeof value === 'number' ? `${(value / 1000).toFixed(1)}s` : 'Unavailable';
const tokens = entry => `${metric(entry.inputTokens)} in / ${metric(entry.outputTokens)} out`;
const purpose = value => ({ 'connection-test': 'Connection check', interview: 'Candidate understanding', evaluate: 'Job evaluation', prepare: 'Application drafting', review: 'Factual review', humanize: 'Humanizer pass', standard: 'Standard application', revise: 'Revision', 'form-answers': 'Form answers', navigation: 'Browser navigation' })[value] || value;

export function UsagePage() {
  const u = store.state.usage, t = u?.totals;
  const heading = html`<${PageHeading} title="AI usage" subtitle="The AI work Plainhand did with your connected subscription, by provider and by application." />`;
  if (!t?.calls) return html`${heading}<${Card}><${Empty} icon="gauge" title="No agent usage recorded yet.">New Plainhand calls appear here. Earlier calls cannot be reconstructed. Token and model details depend on what your CLI reports.</${Empty}></${Card}>`;
  return html`${heading}
    <${Notice} tone="info">Tokens are not a percentage of your subscription allowance. Remaining account quota and usage in other apps are unavailable. CLI-reported USD is a reference figure, not a subscription charge.</${Notice}>
    <${Card} title="Recorded usage" icon="gauge" id="usage-title">
      <dl class="stat-grid">
        <div><dt>Agent calls</dt><dd>${number(t.calls)}</dd><small>${number(t.succeeded)} succeeded · ${number(t.failed)} failed · ${number(t.retriedCalls)} on retried tasks</small></div>
        <div><dt>Input tokens</dt><dd>${metric(t.inputTokens)}</dd><small>Including reported cache tokens</small></div>
        <div><dt>Output tokens</dt><dd>${metric(t.outputTokens)}</dd><small>Reported for ${t.outputTokens.reportedCalls}/${t.calls} calls</small></div>
        <div><dt>Call time</dt><dd>${duration(t.durationMs.value)}</dd><small>Recorded duration</small></div>
      </dl>
      <p class="detail">Token totals include reported values only. Input reported for ${t.inputTokens.reportedCalls}/${t.calls} calls; output for ${t.outputTokens.reportedCalls}/${t.calls}. Uncached input: ${metric(t.uncachedInputTokens)} · cache reads: ${metric(t.cacheReadTokens)} · cache writes: ${metric(t.cacheWriteTokens)}. Missing values are unavailable, never assumed zero.</p>
      <p class="detail">CLI-reported USD: ${t.reportedUsd.value === null ? 'Unavailable' : '$' + t.reportedUsd.value.toFixed(4)} (${t.reportedUsd.reportedCalls}/${t.calls} calls).</p>
    </${Card}>
    <div class="two-col">
      <${Card} title="By provider" icon="plug" id="usage-provider"><ul class="kv-list">${u.byProvider.map(p => html`<li key=${p.id}><strong>${providerNames[p.id] || p.id}</strong><span>${p.calls} calls · ${tokens(p)} · ${duration(p.durationMs.value)}</span></li>`)}</ul></${Card}>
      <${Card} title="By application" icon="briefcase" id="usage-job">${u.byJob.length ? html`<ul class="kv-list">${u.byJob.map(entry => { const job = store.state.jobs.find(j => j.id === entry.id); return html`<li key=${entry.id}><strong>${job ? `${job.company} — ${job.title}` : 'Removed job'}</strong><span>${entry.calls} calls · ${tokens(entry)}</span></li>`; })}</ul>` : html`<p class="muted-text">No job-specific calls recorded yet.</p>`}</${Card}>
    </div>
    <${Card} title="Workspace outcomes" icon="flag" id="usage-outcomes"><p class="detail">${u.impact.evaluatedJobs} evaluated jobs · ${u.impact.preparedPackets} prepared packets · ${u.impact.applicationsWithFills} applications with filled fields · ${u.impact.confirmedSubmissions} confirmed submissions. These are all-time workspace counts, including work before usage tracking began; they are not completion-rate measurements.</p></${Card}>
    <${Card} title="Recent agent calls" icon="clock" id="usage-recent">
      <div class="table-wrap"><table class="calls"><thead><tr><th scope="col">Call</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Tokens</th><th scope="col">Model</th></tr></thead>
      <tbody>${u.recent.map((call, i) => html`<tr key=${i}><td data-label="Call"><strong class="call-name">${purpose(call.purpose)}</strong><span class="sub">${providerNames[call.provider] || call.provider} · ${ago(call.startedAt)}${call.attempt > 1 ? ` · attempt ${call.attempt}` : ''}</span></td><td data-label="Status"><${Pill} tone=${call.status === 'succeeded' ? 'success' : call.status === 'failed' ? 'danger' : 'neutral'}>${call.status}</${Pill}></td><td data-label="Duration" class="nowrap">${duration(call.durationMs)}</td><td data-label="Tokens" class="nowrap">${number(call.inputTokens)} in / ${number(call.outputTokens)} out</td><td data-label="Model" class="mono">${call.models?.join(', ') || 'Model not reported'}</td></tr>`)}</tbody></table></div>
    </${Card}>`;
}
