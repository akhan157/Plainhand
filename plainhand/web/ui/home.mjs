// Home: a briefing computed from the workspace (no model call), the assistant
// thread when the agent engine is available, and a compact list of roles.
import { html, useState, store, api, refresh, toast, openJob, openDialog, navigate, queueTask, update, Icon, ago, Day, relativeDay, daysUntil, todayISO, plural, ACTIVE, SUBMITTED, TASK_TITLES } from './core.mjs';
import { Button, ActionButton, PageHeading, Card, Pill } from './components.mjs';
import { TaskCard } from './conversation.mjs';
import { JobList } from './jobs.mjs';
import { AssistantThread, AssistantLocked, agentAvailable, profileMissing } from './agent.mjs';
import { demoState } from './demo.mjs';

const BRIEF_LIMIT = 4;
const label = job => `${job.company} — ${job.title}`;

// Latest task per kind and job, so an old failure that was since retried
// successfully does not keep asking for attention.
function latestTasks(tasks) {
  const latest = new Map();
  for (const task of tasks) {
    const key = task.kind + ':' + (task.jobId || '');
    const seen = latest.get(key);
    if (!seen || String(task.createdAt) > String(seen.createdAt)) latest.set(key, task);
  }
  return [...latest.values()];
}

export function briefing(state) {
  const items = [];
  const jobs = new Map(state.jobs.map(j => [j.id, j]));
  const runningFor = (kind, id) => state.tasks.some(t => ACTIVE.includes(t.status) && t.kind === kind && t.jobId === id);
  for (const f of state.followUps || []) {
    const job = jobs.get(f.jobId);
    if (!job) continue;
    if (f.action) {
      const n = daysUntil(f.due);
      if (f.due && !f.overdue && !f.dueToday && n > 7) continue;
      items.push({ key: 'f-' + job.id, rank: f.overdue ? 0 : f.dueToday ? 1 : f.due ? 3 : 6, tone: f.overdue ? 'danger' : f.dueToday ? 'warn' : 'neutral', icon: 'flag',
        title: f.action, meta: html`${label(job)} · ${f.due ? html`${f.overdue ? 'Overdue since ' : 'Due '}<${Day} iso=${f.due} /> (${relativeDay(f.due)})` : 'No due date'}`,
        badge: f.overdue ? ['danger', 'Overdue'] : f.dueToday ? ['warn', 'Today'] : null,
        action: { label: 'Open record', run: () => openJob(job.id, 'record') } });
    } else {
      items.push({ key: 'f-' + job.id, rank: 7, tone: 'neutral', icon: 'clock', title: `Set a next step for ${job.company}`,
        meta: `${job.status} · last change ${ago(f.last)} · no next action set`, action: { label: 'Open record', run: () => openJob(job.id, 'record') } });
    }
  }
  for (const task of latestTasks(state.tasks)) {
    if (!['failed', 'interrupted'].includes(task.status)) continue;
    if (task.jobId && !jobs.has(task.jobId)) continue;
    const job = jobs.get(task.jobId);
    items.push({ key: 't-' + task.id, rank: 1, tone: 'danger', icon: 'alert', title: `${TASK_TITLES[task.kind] || task.kind} ${task.status === 'interrupted' ? 'was interrupted' : 'did not finish'}${job ? ' · ' + job.company : ''}`,
      meta: task.message, action: { label: 'Retry', icon: 'refresh', run: () => queueTask(task.kind, task.jobId, { ...task.input, retryOf: task.id }) },
      secondary: job ? { label: 'Open role', run: () => openJob(job.id, task.kind === 'prepare' ? 'packet' : 'fit') } : null });
  }
  const today = todayISO();
  for (const job of state.jobs) {
    for (const round of job.record?.interviews || []) {
      const n = daysUntil(round.date);
      if (round.status !== 'scheduled' || round.date < today || n > 14) continue;
      items.push({ key: 'i-' + round.id, rank: n <= 1 ? 1 : 2, tone: n <= 1 ? 'warn' : 'info', icon: 'calendar', title: `${round.stage}${round.interviewer ? ' with ' + round.interviewer : ''}`,
        meta: html`${label(job)} · <${Day} iso=${round.date} /> (${relativeDay(round.date)})`, action: { label: 'Prepare', run: () => openJob(job.id, 'record') } });
    }
    if (SUBMITTED.includes(job.status) || job.submittedAt) continue;
    if (job.packet) {
      if (job.stale) items.push({ key: 'p-' + job.id, rank: 4, tone: 'warn', icon: 'refresh', title: `Refresh the packet for ${job.company}`, meta: 'Your profile or the role changed after it was prepared. Re-evaluate and prepare again.', action: { label: 'Open packet', run: () => openJob(job.id, 'packet') } });
      else if (job.packet.questions?.length) items.push({ key: 'p-' + job.id, rank: 3, tone: 'warn', icon: 'edit', title: `Answer ${plural(job.packet.questions.length, 'question')} for ${job.company}`, meta: job.packet.questions[0], action: { label: 'Answer', run: () => openJob(job.id, 'fit') } });
      else if (!job.approvedHash) items.push({ key: 'p-' + job.id, rank: 3, tone: 'accent', icon: 'file', title: `Review the packet for ${job.company}`, meta: `${job.title} · resume, cover letter and answers are ready to read`, action: { label: 'Review', run: () => openJob(job.id, 'packet') } });
      else items.push({ key: 'p-' + job.id, rank: 5, tone: 'success', icon: 'checkCircle', title: `Ready to apply at ${job.company}`, meta: 'Packet approved. Open form assistance or apply manually, then confirm when you have submitted.', action: { label: 'Continue', run: () => openJob(job.id, 'apply') } });
    } else if (job.review && !job.review.passed && !runningFor('prepare', job.id)) {
      items.push({ key: 'p-' + job.id, rank: 2, tone: 'danger', icon: 'alert', title: `Factual review blocked ${job.company}`, meta: 'Add evidence or corrections, then prepare again.', action: { label: 'Open', run: () => openJob(job.id, 'packet') } });
    } else if (job.selected && job.evaluation && !runningFor('prepare', job.id)) {
      items.push({ key: 's-' + job.id, rank: 5, tone: 'info', icon: 'file', title: `Prepare your application for ${job.company}`, meta: `${job.title} · selected, fit ${job.evaluation.score}/5`, action: { label: 'Open role', run: () => openJob(job.id, 'fit') } });
    }
  }
  const unevaluated = state.jobs.filter(j => !j.evaluation && !runningFor('evaluate', j.id) && !SUBMITTED.includes(j.status));
  if (unevaluated.length === 1) {
    const job = unevaluated[0];
    items.push({ key: 'e-' + job.id, rank: 6, tone: 'neutral', icon: 'spark', title: `Evaluate ${job.title}`, meta: `${job.company} · saved ${ago(job.createdAt)}`, action: { label: 'Open role', run: () => openJob(job.id, 'fit') } });
  } else if (unevaluated.length > 1) {
    items.push({ key: 'e-many', rank: 6, tone: 'neutral', icon: 'spark', title: `${unevaluated.length} roles are waiting for evaluation`, meta: unevaluated.slice(0, 3).map(j => j.company).join(', ') + (unevaluated.length > 3 ? '…' : ''), action: { label: 'View roles', run: () => navigate('jobs') } });
  }
  const missing = profileMissing(state);
  if (missing.length && state.profile.resume) items.push({ key: 'profile', rank: 4, tone: 'accent', icon: 'brain', title: 'Finish your profile', meta: `Still missing: ${missing.join(', ')}. You can tell Plainhand in conversation.`, action: { label: 'Open profile', run: () => navigate('profile') } });
  const proposed = (state.corrections || []).filter(c => c.status === 'proposed');
  if (proposed.length) items.push({ key: 'corrections', rank: 4, tone: 'accent', icon: 'edit', title: `${plural(proposed.length, 'correction')} awaiting your approval`, meta: proposed[0].question, action: { label: 'Review', run: () => navigate('workspace') } });
  if (state.understanding && !state.understanding.approved) items.push({ key: 'understanding', rank: 4, tone: 'accent', icon: 'brain', title: 'Review how your agent sees you', meta: 'A new understanding is ready. Approve it only if it reflects you.', action: { label: 'Review', run: () => navigate('profile') } });
  // Items from feature modules (campaigns, follow-ups, insights), computed on the server.
  for (const [i, item] of (state.featureAttention || []).entries()) {
    const job = item.jobId ? jobs.get(item.jobId) : null;
    const area = item.kind.split('-')[0];
    const go = area === 'campaign' ? { label: 'Open campaigns', run: () => navigate('campaigns') }
      : area === 'insights' ? { label: 'Open insights', run: () => navigate('insights') }
      : job ? { label: area === 'followup' ? 'Open record' : 'Open role', run: () => openJob(job.id, area === 'followup' ? 'record' : 'fit') } : null;
    if (!go) continue;
    const failing = /fail/.test(item.kind), quiet = /paused/.test(item.kind);
    items.push({ key: `x-${item.kind}-${item.jobId || i}`, rank: failing ? 2 : quiet ? 8 : 4, tone: failing ? 'danger' : quiet ? 'neutral' : 'accent',
      icon: area === 'campaign' ? 'layers' : area === 'insights' ? 'star' : area === 'followup' ? 'send' : 'flag', title: item.text, meta: job ? label(job) : '', action: go });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

function BriefingItem({ item }) {
  return html`<li class=${'brief-item tone-' + item.tone}>
    <span class="brief-icon"><${Icon} name=${item.icon} /></span>
    <div class="brief-main"><strong>${item.title}</strong><p>${item.meta}</p></div>
    ${item.badge ? html`<${Pill} tone=${item.badge[0]}>${item.badge[1]}</${Pill}>` : null}
    <div class="brief-actions">${item.secondary ? html`<${Button} class="ghost small" onClick=${item.secondary.run}>${item.secondary.label}</${Button}>` : null}<${ActionButton} class="small" icon=${item.action.icon} onClick=${item.action.run}>${item.action.label}</${ActionButton}></div>
  </li>`;
}

function SetupSteps({ state }) {
  const statements = (state.conversation || []).filter(m => m.role === 'user').length;
  const steps = [
    { done: !!state.provider, n: '1', title: 'Connect your AI account', text: 'Claude, ChatGPT or Antigravity: the subscription you already have.', action: () => navigate('connections'), label: 'Connect' },
    { done: !!(state.profile.name && state.profile.resume), n: '2', title: 'Add your basics and resume', text: 'Upload or paste your resume; add your own resume PDF to keep its format.', action: () => navigate('profile'), label: 'Open profile' },
    { done: statements >= 3, n: '3', title: 'Tell your story', text: 'Talk about projects and jobs you’re proud of. Plainhand keeps your words.', action: () => navigate('profile'), label: 'Start talking' },
    { done: state.standardStatus === 'approved', n: '4', title: 'Approve your standard application', text: 'One resume and cover letter every application starts from.', action: () => navigate('profile'), label: 'Open profile' },
    { done: state.jobs.length > 0, n: '5', title: 'Add a role you like', text: 'Paste a job link, or follow a company’s job board.', action: () => openDialog({ type: 'add-job' }), label: 'Add a job' },
  ];
  const done = steps.filter(s => s.done).length;
  return html`<${Card} title="Get set up" id="setup-title" icon="spark" subtitle=${`${done} of ${steps.length} done. Each step takes a few minutes.`} actions=${!store.demo && !state.profile.resume ? html`<${Button} class="small" icon="spark" onClick=${startDemo}>Take a look around</${Button}>` : null}>
    <ol class="setup-steps">${steps.map(s => html`<li key=${s.n} class=${s.done ? 'done' : ''}>
      <span class="step-no" aria-hidden="true">${s.done ? html`<${Icon} name="check" />` : s.n}</span>
      <div><strong>${s.title}</strong><p>${s.done ? 'Done' : s.text}</p></div>
      ${!s.done ? html`<${Button} class="small" onClick=${s.action} aria-label=${s.label + ': ' + s.title}>${s.label}</${Button}>` : null}
    </li>`)}</ol>
  </${Card}>`;
}

export function startDemo() {
  update(s => ({ live: s.state, demo: true, state: demoState(), focus: null, view: 'home' }));
  if (location.hash.slice(1) !== 'home') location.hash = 'home';
  window.scrollTo(0, 0);
}

export function HomePage() {
  const state = store.state;
  const [filter, setFilter] = useState('all');
  const [allItems, setAllItems] = useState(false);
  const first = state.profile.name?.trim().split(/\s+/)[0];
  const items = briefing(state);
  const running = state.tasks.filter(t => ACTIVE.includes(t.status));
  const setupNeeded = !state.provider || !state.profile.resume || (state.conversation || []).filter(m => m.role === 'user').length < 3 || state.standardStatus !== 'approved' || !state.jobs.length;
  const counts = {
    roles: state.jobs.length,
    selected: state.jobs.filter(j => j.selected && !SUBMITTED.includes(j.status)).length,
    review: state.jobs.filter(j => j.packet && !j.approvedHash && !j.stale && !SUBMITTED.includes(j.status)).length,
    applied: state.jobs.filter(j => SUBMITTED.includes(j.status)).length,
  };
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return html`
    <${PageHeading} eyebrow=${date} title=${first ? `Welcome back, ${first}.` : 'Your next chapter starts here.'}
      subtitle=${items.length || running.length ? `${plural(items.length + running.length, 'thing')} ${items.length + running.length === 1 ? 'needs' : 'need'} your attention.` : first ? 'You’re all caught up. Nothing needs you right now.' : 'Set up your workspace, then Plainhand keeps track of what needs you.'}
      actions=${html`<${Button} class="primary" icon="plus" onClick=${() => openDialog({ type: 'add-job' })}>Add a job</${Button}>`} />
    ${state.jobs.length ? html`<ul class="summary-strip" aria-label="Workspace summary">
      <li><strong>${counts.roles}</strong> ${counts.roles === 1 ? 'role' : 'roles'}</li><li><strong>${counts.selected}</strong> selected</li><li><strong>${counts.review}</strong> to review</li><li><strong>${counts.applied}</strong> submitted, confirmed by you</li></ul>` : null}
    ${setupNeeded ? html`<${SetupSteps} state=${state} />` : null}
    ${setupNeeded && !items.length && !running.length && !agentAvailable() ? null : html`<section class="card briefing" aria-labelledby="briefing-title">
      <header class="card-head"><div class="card-title"><span class="card-icon"><span class="brand-mark small" aria-hidden="true">p</span></span><div><h2 id="briefing-title">Today’s briefing</h2><p>Computed from your workspace: follow-ups, tasks, reviews and interviews.</p></div></div></header>
      ${running.map(task => html`<${TaskCard} key=${task.id} task=${task} onCancel=${async () => { await api('tasks/cancel', { id: task.id }); toast('Cancellation requested. Saved work is preserved.'); refresh(); }} />`)}
      ${items.length ? html`<ul class="brief-list">${(allItems ? items : items.slice(0, BRIEF_LIMIT)).map(item => html`<${BriefingItem} key=${item.key} item=${item} />`)}</ul>
        ${items.length > BRIEF_LIMIT ? html`<div class="list-more"><${Button} class="ghost small" icon=${allItems ? 'chevronDown' : 'plus'} aria-expanded=${allItems ? 'true' : 'false'} onClick=${() => setAllItems(!allItems)}>${allItems ? 'Show fewer' : `Show ${items.length - BRIEF_LIMIT} more`}</${Button}></div>` : null}`
        : !running.length ? html`<div class="brief-empty"><${Icon} name="checkCircle" /><div><strong>Nothing needs you right now.</strong><p>${state.jobs.length ? 'New follow-ups, reviews and interviews will show up here.' : 'Add a role to get started. Overdue follow-ups, finished tasks and packets to review will show up here.'}</p></div></div>` : null}
    </section>`}
    ${store.demo ? null : agentAvailable() ? html`<${AssistantThread} />` : html`<${AssistantLocked} />`}
    ${state.jobs.length ? html`<${Card} title="Your roles" icon="briefcase" id="home-roles-title" actions=${html`<a class="button ghost small" href="#jobs">All jobs<${Icon} name="arrow" /></a>`}>
      <${JobList} jobs=${state.jobs} filter=${filter} setFilter=${setFilter} query="" limit=${6} />
    </${Card}>` : null}`;
}
