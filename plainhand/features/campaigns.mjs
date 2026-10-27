// Discovery campaigns (milestone N1): named searches over the workspace's job
// sources that run on a schedule while Plainhand runs, surface only new, live,
// matching roles with the reason each was surfaced, and save those roles to the
// Jobs inbox tagged with the campaign. Saving is automatic because it is
// reversible and never starts an application. Optional auto-evaluation stays
// within a per-campaign daily limit; nothing is ever prepared or applied.
// Contract: docs/AGENT-CONTRACTS.md §6. Behaviour: docs/PLAINHAND-BROWSER-APP.md#campaigns.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mergeScanHistory } from '../scan-runner.mjs';
import { deliverNotifications } from '../../notification-delivery.mjs';
import { createDesktopAdapter, notificationPayload } from '../notification-channels.mjs';
import { CampaignInputError, MAX_CAMPAIGNS, SCAN_HISTORY_FILE, isDue, loadConfig, loadRuns, localDay, mutateCampaigns, nextRunAt, normalizeCampaign, scheduleLabel } from './campaigns/config.mjs';
import { runCampaign, mergeLedger } from './campaigns/scan.mjs';

export const TASK_KIND = 'campaign-scan';
const RUN_HISTORY = 10;
const ACTIVE = ['queued', 'running'];
const FIELDS = { terms: 'string[]?', locations: 'string[]?', exclusions: 'string[]?', sourceIds: 'string[]?', schedule: 'string?', dailyEvaluationLimit: 'number?', liveness: 'boolean?', desktop: 'boolean?' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function createCampaignsFeature({ now = () => new Date(), scanner = null, verifier = null, desktop = null, timers = { setInterval, clearInterval }, tickMs = 60000 } = {}) {
  const bindings = new WeakMap(); // workspace → { workflow, emit }
  const clock = () => new Date(now());
  const bind = (workspace, patch) => bindings.set(workspace, { ...(bindings.get(workspace) || {}), ...patch });

  const activeScan = state => (state.tasks || []).find(t => t.kind === TASK_KIND && ACTIVE.includes(t.status)) || null;
  function health(campaign, runs, state) {
    const h = runs.health[campaign.id] || {};
    const last = (runs.runs[campaign.id] || [])[0] || null;
    const task = state && activeScan(state);
    return {
      lastRunAt: h.lastRunAt || null, lastStatus: last?.status || null, lastFinishedAt: last?.finishedAt || null,
      nextRunAt: nextRunAt(campaign, h), consecutiveFailures: h.consecutiveFailures || 0,
      sourceErrors: Object.values(h.sources || {}).filter(s => s.error).map(({ sourceId, source, error, consecutiveFailures }) => ({ sourceId, source, error, consecutiveFailures })),
      counts: last?.counts || null, notes: last?.notes || [],
      running: Boolean(task && (task.input?.campaignIds || []).includes(campaign.id)),
      evaluationsToday: runs.evaluations?.[campaign.id]?.[localDay(clock())] || 0,
    };
  }
  const view = (campaign, runs, state) => ({ ...campaign, scheduleLabel: scheduleLabel(campaign.schedule), health: health(campaign, runs, state) });

  // A small derived summary in the workspace state, so the briefing (a pure
  // function of state) can see campaign health. campaigns.json stays the source.
  async function refreshBrief(workspace, { viewed = false } = {}) {
    const config = await loadConfig(workspace), runs = await loadRuns(workspace);
    await workspace.mutate(state => {
      const previous = state.campaignBrief || {};
      state.campaignBrief = {
        viewedAt: viewed ? clock().toISOString() : previous.viewedAt || null,
        campaigns: config.campaigns.map(c => {
          const h = health(c, runs);
          return { id: c.id, name: c.name, paused: c.paused, schedule: c.schedule, dueAt: nextRunAt(c, runs.health[c.id], { ignorePause: true }), lastStatus: h.lastStatus, consecutiveFailures: h.consecutiveFailures, failingSources: h.sourceErrors, lastNote: h.lastStatus === 'failed' ? h.notes[0] || null : null };
        }),
      };
    });
  }

  async function executeRun(workspace, campaignId, trigger, { check, progress, signal }) {
    const { workflow, emit } = bindings.get(workspace) || {};
    const config = await loadConfig(workspace);
    const campaign = config.campaigns.find(c => c.id === campaignId);
    if (!campaign || (trigger === 'schedule' && campaign.paused)) return null;
    const started = clock(), at = started.toISOString(), runId = randomUUID();
    // Recorded at start: a run is due again one interval later, never repeatedly.
    await mutateCampaigns(workspace, (cfg, runs) => { runs.health[campaignId] = { ...(runs.health[campaignId] || {}), lastRunAt: at }; });
    await progress(`Scanning sources for ${campaign.name}`);
    const state = await workspace.load(), runs = await loadRuns(workspace);
    let history = [];
    try { history = JSON.parse(await workspace.read(SCAN_HISTORY_FILE, '[]')); if (!Array.isArray(history)) history = []; } catch { history = []; }
    let outcome;
    try {
      outcome = await runCampaign({ campaign, state, runs, history, deps: { scanner: scanner || workflow.scanner, verifier: verifier || workflow.verifier, now: started, check } });
    } catch (error) {
      if (signal?.aborted) throw error;
      outcome = { run: { campaignId, campaignName: campaign.name, startedAt: at, status: 'failed', sources: [], surfaced: [], counts: {}, notes: [error.message] }, seen: {} };
    }
    const { run } = outcome;
    Object.assign(run, { id: runId, trigger });
    check();

    // Save surfaced roles to the inbox, tagged with the campaign and its reason.
    const saved = [];
    await workspace.mutate(latest => {
      for (const role of run.surfaced) {
        const existing = latest.jobs.find(j => j.url === role.url || (j.company.toLowerCase() === role.company.toLowerCase() && j.title.toLowerCase() === role.title.toLowerCase()));
        if (existing) { role.jobId = existing.id; role.skipped = 'already saved'; continue; }
        const job = { id: randomUUID(), company: role.company, title: role.title, url: role.url, location: role.location, stage: 'inbox', createdAt: at, description: '', selected: false,
          campaign: { id: campaign.id, name: campaign.name, runId, reason: role.reason, source: role.source, firstSeenAt: role.firstSeenAt, surfacedAt: at } };
        latest.jobs.unshift(job); role.jobId = job.id; saved.push(job);
      }
      run.surfaced = run.surfaced.filter(role => !role.skipped);
      run.counts.surfaced = run.surfaced.length;
      const failing = run.sources.filter(s => s.error).map(s => s.source);
      latest.events.unshift({ at: clock().toISOString(), text: `Campaign "${campaign.name}" saved ${plural(saved.length, 'new role')} to your inbox${failing.length ? `; ${failing.join(', ')} could not be checked` : ''}. No applications were started.` });
    });

    // Persist the run, health, the seen ledger and the daily evaluation count.
    await mutateCampaigns(workspace, async (cfg, latestRuns) => {
      latestRuns.seen = mergeLedger(latestRuns.seen, outcome.seen);
      const day = localDay(started);
      run.evaluationsQueued = 0;
      if (campaign.dailyEvaluationLimit > 0 && saved.length) {
        const counts = latestRuns.evaluations[campaign.id] ||= {};
        const remaining = Math.max(0, campaign.dailyEvaluationLimit - (counts[day] || 0));
        for (const job of saved.slice(0, remaining)) {
          try { await workflow.enqueue('evaluate', job.id); run.evaluationsQueued++; counts[day] = (counts[day] || 0) + 1; }
          catch (error) { run.notes.push(`Automatic evaluation skipped: ${error.message}`); break; }
        }
        if (saved.length > remaining) run.notes.push(`Daily evaluation limit reached (${campaign.dailyEvaluationLimit}); ${saved.length - remaining === 1 ? '1 role waits' : `${saved.length - remaining} roles wait`} in your inbox.`);
        for (const key of Object.keys(counts)) if (key < localDay(new Date(started.getTime() - 14 * 86400000))) delete counts[key];
      }
      run.finishedAt = clock().toISOString();
      latestRuns.runs[campaign.id] = [run, ...(latestRuns.runs[campaign.id] || [])].slice(0, RUN_HISTORY);
      const h = latestRuns.health[campaign.id] = { ...(latestRuns.health[campaign.id] || {}), lastRunAt: at };
      h.consecutiveFailures = run.status === 'ok' ? 0 : (h.consecutiveFailures || 0) + 1;
      const sources = h.sources || {};
      for (const report of run.sources) {
        const previous = sources[report.sourceId] || {};
        sources[report.sourceId] = report.error
          ? { sourceId: report.sourceId, source: report.source, error: report.error, consecutiveFailures: (previous.consecutiveFailures || 0) + 1, lastOkAt: previous.lastOkAt || null }
          : { sourceId: report.sourceId, source: report.source, error: null, consecutiveFailures: 0, lastOkAt: at };
      }
      for (const id of Object.keys(sources)) if (!run.sources.some(s => s.sourceId === id) && run.sources.length) delete sources[id];
      h.sources = sources;
    });

    if (saved.length) {
      // Command-line scans share this history, so they do not report these roles again.
      await workspace.write(SCAN_HISTORY_FILE, JSON.stringify(mergeScanHistory(history, saved, at), null, 2));
      if (campaign.notify?.desktop) {
        try {
          const root = path.resolve(workspace.root);
          await deliverNotifications({
            notifications: saved.slice(0, 10).map(job => notificationPayload({ job, source: `${job.campaign.source} board`, campaign: campaign.name, foundAt: at, reason: job.campaign.reason })),
            channels: [desktop || createDesktopAdapter()], rootPath: root, now: at,
            statePath: path.join(root, 'data/plainhand/notification-state.json'),
            journalPath: path.join(root, 'data/plainhand/notification-journal.jsonl'),
            outboxPath: path.join(root, 'data/plainhand/notification-outbox.jsonl'),
          });
        } catch (error) { await mutateCampaigns(workspace, (cfg, r) => { r.runs[campaign.id]?.[0]?.notes.push(`Desktop notification failed: ${error.message}`); }); }
      }
    }
    await refreshBrief(workspace);
    emit?.('campaign.update', { campaignId: campaign.id, runId, status: run.status, surfaced: saved.length, at });
    return run;
  }

  // Runs due, unpaused campaigns through the task queue while Plainhand runs.
  async function scheduleDue(workspace) {
    const { workflow } = bindings.get(workspace) || {};
    if (!workflow) return null;
    const config = await loadConfig(workspace);
    if (!config.campaigns.some(c => !c.paused && c.schedule !== 'manual')) return null;
    const state = await workspace.load();
    if (activeScan(state)) return null;
    const runs = await loadRuns(workspace), at = clock();
    const due = config.campaigns.filter(c => isDue(c, runs.health[c.id], at));
    if (!due.length) return null;
    return workflow.enqueue(TASK_KIND, null, { campaignIds: due.map(c => c.id), trigger: 'schedule' });
  }

  function register({ define, workspace, workflow, helpers }) {
    bind(workspace, { workflow });
    const { ActionError } = helpers;
    const failure = error => error instanceof CampaignInputError ? new ActionError('invalid_input', error.message) : error;
    const find = (config, id) => { const campaign = config.campaigns.find(c => c.id === id || c.name.toLowerCase() === String(id).toLowerCase()); if (!campaign) throw new ActionError('failed', 'Campaign not found.'); return campaign; };
    const write = async fn => { try { const result = await mutateCampaigns(workspace, fn); await refreshBrief(workspace); return result; } catch (error) { throw failure(error); } };
    const describe = input => [input.terms?.length && `keywords ${input.terms.join(', ')}`, input.locations?.length && `in ${input.locations.join(', ')}`, input.schedule && `schedule ${input.schedule}`, typeof input.dailyEvaluationLimit === 'number' && `evaluate up to ${input.dailyEvaluationLimit}/day`].filter(Boolean).join('; ');

    // ── read ───────────────────────────────────────────────────────────────
    define({ name: 'campaigns.list', tier: 'read', title: 'List campaigns', description: 'Discovery campaigns with their criteria (terms, locations, exclusions, sources), schedule, daily evaluation limit, paused state and health: last run, next run, per-source errors, counts and consecutive failures.', input: {},
      run: async () => {
        const [config, runs, state] = [await loadConfig(workspace), await loadRuns(workspace), await workspace.load()];
        return { campaigns: config.campaigns.map(c => ({ ...view(c, runs, state), lastRun: summary((runs.runs[c.id] || [])[0]) })), sources: state.sources.map(s => ({ id: s.id, name: s.name })), scanRunning: Boolean(activeScan(state)) };
      } });
    define({ name: 'campaigns.get', tier: 'read', title: 'Open a campaign', description: 'One campaign (by id or exact name) with its health and its last runs, including every surfaced role with the reason and source it was surfaced from.', input: { campaignId: 'string' },
      run: async (ctx, input) => {
        const [config, runs, state] = [await loadConfig(workspace), await loadRuns(workspace), await workspace.load()];
        const campaign = find(config, input.campaignId);
        return { campaign: view(campaign, runs, state), runs: (runs.runs[campaign.id] || []).slice(0, 5) };
      } });
    define({ name: 'campaigns.results', tier: 'read', title: 'Campaign results', description: 'Roles surfaced by recent campaign runs (newest first), each with why it was surfaced, its source, first-seen date and the saved job id. Optional campaignId narrows to one campaign.', input: { campaignId: 'string?', limit: 'number?' },
      run: async (ctx, input) => {
        const config = await loadConfig(workspace), runs = await loadRuns(workspace);
        const ids = input.campaignId ? [find(config, input.campaignId).id] : config.campaigns.map(c => c.id);
        const all = ids.flatMap(id => runs.runs[id] || []).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
        return { runs: all.slice(0, Math.min(Math.max(1, input.limit || 5), RUN_HISTORY)).map(r => ({ ...summary(r), surfaced: r.surfaced })) };
      } });

    // ── write (reversible) ─────────────────────────────────────────────────
    define({ name: 'campaigns.create', tier: 'write', title: 'Create a campaign', description: `Create a named discovery campaign. terms: role keywords matched in the title (at least one). locations: any of these must appear in the posting location. exclusions: words that drop a role when in its title or company. sourceIds: job source ids (default all sources). schedule: manual, daily or "every N hours" (N ≥ 6). dailyEvaluationLimit 0–10 (0 = only save new roles; never prepares or applies). liveness (default true) drops closed postings. desktop: also send a desktop notification. Use only what the candidate asked for.`,
      input: { name: 'string', ...FIELDS }, summarize: input => `Create campaign "${input.name}"${describe(input) ? `: ${describe(input)}` : ''}`,
      run: async (ctx, input) => {
        const state = await workspace.load();
        const campaign = await write(config => {
          if (config.campaigns.length >= MAX_CAMPAIGNS) throw new CampaignInputError(`Keep at most ${MAX_CAMPAIGNS} campaigns.`);
          const created = normalizeCampaign(input, { sources: state.sources, campaigns: config.campaigns, at: clock().toISOString() });
          config.campaigns.push(created); return created;
        });
        return { result: { campaign }, undo: () => write(config => {
          const current = config.campaigns.find(c => c.id === campaign.id);
          if (current && current.updatedAt !== campaign.updatedAt) throw new ActionError('failed', 'This campaign changed since; undo is no longer safe.');
          config.campaigns = config.campaigns.filter(c => c.id !== campaign.id);
        }) };
      } });
    define({ name: 'campaigns.update', tier: 'write', title: 'Change a campaign', description: 'Change any field of one campaign (by id or exact name): name, terms, locations, exclusions, sourceIds, schedule, dailyEvaluationLimit, liveness, desktop. Lists replace the previous list. One change, one file.',
      input: { campaignId: 'string', name: 'string?', ...FIELDS }, summarize: input => `Change campaign${input.name ? ` "${input.name}"` : ''}${describe(input) ? `: ${describe(input)}` : ''}`,
      run: async (ctx, input) => {
        const state = await workspace.load();
        const { campaignId, ...changes } = input;
        let before;
        const campaign = await write(config => {
          const existing = find(config, campaignId); before = structuredClone(existing);
          const next = normalizeCampaign(changes, { existing, sources: state.sources, campaigns: config.campaigns, at: clock().toISOString() });
          config.campaigns[config.campaigns.indexOf(existing)] = next; return next;
        });
        return { result: { campaign }, undo: () => write(config => {
          const current = config.campaigns.find(c => c.id === campaign.id);
          if (!current || current.updatedAt !== campaign.updatedAt) throw new ActionError('failed', 'This campaign changed since; undo is no longer safe.');
          config.campaigns[config.campaigns.indexOf(current)] = before;
        }) };
      } });
    const toggle = paused => async (ctx, input) => {
      let id = null, changed = false;
      await write(config => { const campaign = find(config, input.campaignId); id = campaign.id; if (campaign.paused !== paused) { campaign.paused = paused; campaign.updatedAt = clock().toISOString(); changed = true; } });
      return { result: { campaignId: id, paused }, undo: changed ? () => write(config => { const campaign = config.campaigns.find(c => c.id === id); if (campaign && campaign.paused === paused) { campaign.paused = !paused; campaign.updatedAt = clock().toISOString(); } }) : null };
    };
    define({ name: 'campaigns.pause', tier: 'write', title: 'Pause a campaign', description: 'Stop scheduled scans for one campaign. Its criteria, history and saved roles are kept; resume continues where it left off.', input: { campaignId: 'string' }, summarize: () => 'Pause this campaign', run: toggle(true) });
    define({ name: 'campaigns.resume', tier: 'write', title: 'Resume a campaign', description: 'Resume scheduled scans for a paused campaign. A run missed while paused happens once, at the next check.', input: { campaignId: 'string' }, summarize: () => 'Resume this campaign', run: toggle(false) });
    define({ name: 'campaigns.delete', tier: 'write', title: 'Delete a campaign', description: 'Remove one campaign. Roles it saved stay in the workspace; its seen-role history is kept so they are not surfaced again. Undo restores it.', input: { campaignId: 'string' }, summarize: () => 'Delete this campaign',
      run: async (ctx, input) => {
        let removed, index;
        await write(config => { removed = find(config, input.campaignId); index = config.campaigns.indexOf(removed); config.campaigns.splice(index, 1); });
        return { result: { deleted: removed.id }, undo: () => write(config => { if (config.campaigns.some(c => c.id === removed.id || c.name.toLowerCase() === removed.name.toLowerCase())) throw new ActionError('failed', 'A campaign with this name exists again; undo is no longer safe.'); config.campaigns.splice(Math.min(index, config.campaigns.length), 0, removed); }) };
      } });
    define({ name: 'campaigns.markViewed', tier: 'write', title: 'Mark campaign results seen', description: 'Clear the "new roles from campaigns" briefing item. The Campaigns page does this when the candidate opens it.', input: {}, summarize: () => 'Mark campaign results as seen',
      run: async () => { await refreshBrief(workspace, { viewed: true }); return { result: { ok: true } }; } });

    // ── task ───────────────────────────────────────────────────────────────
    define({ name: 'campaigns.run', tier: 'task', title: 'Run a campaign now', description: 'Scan one campaign’s sources now (by id or exact name): check liveness, skip roles already saved or seen, save new matching roles to the inbox with their reasons, and queue evaluations within the daily limit. Never prepares or applies.', input: { campaignId: 'string' },
      summarize: () => 'Run this campaign now',
      run: async (ctx, input) => {
        const campaign = find(await loadConfig(workspace), input.campaignId);
        if (activeScan(await workspace.load())) throw new ActionError('failed', 'A campaign scan is already running. Try again when it finishes.');
        return { result: { taskId: await workflow.enqueue(TASK_KIND, null, { campaignIds: [campaign.id], trigger: 'manual' }) } };
      } });
  }

  function attention(state) {
    const brief = state.campaignBrief;
    if (!brief) return [];
    const items = [], later = [];
    const fresh = (state.jobs || []).filter(j => j.campaign?.surfacedAt && (!brief.viewedAt || j.campaign.surfacedAt > brief.viewedAt));
    const groups = new Map();
    for (const job of fresh) groups.set(job.campaign.id, [...(groups.get(job.campaign.id) || []), job]);
    for (const jobs of groups.values()) {
      const names = jobs.slice(0, 2).map(j => `${j.company} — ${j.title}`).join('; ');
      items.push({ kind: 'campaign-new', jobId: jobs.length === 1 ? jobs[0].id : null, text: `Campaign "${jobs[0].campaign.name}": ${plural(jobs.length, 'new role')} since you last looked (${names}${jobs.length > 2 ? '; …' : ''})` });
    }
    for (const c of brief.campaigns || []) {
      for (const s of c.failingSources || []) items.push({ kind: 'campaign-failing', text: `Campaign "${c.name}": ${s.source} could not be checked${s.consecutiveFailures > 1 ? ` (${s.consecutiveFailures} runs in a row)` : ''}: ${s.error}` });
      if (!c.failingSources?.length && c.lastStatus === 'failed') items.push({ kind: 'campaign-failing', text: `Campaign "${c.name}": last run failed${c.lastNote ? `: ${c.lastNote}` : ''}` });
      if (c.paused && c.dueAt && Date.parse(c.dueAt) <= clock().getTime()) later.push({ kind: 'campaign-paused', text: `Campaign "${c.name}" is paused; its ${scheduleLabel(c.schedule).toLowerCase()} scan is due. Resume it to keep scanning.` });
    }
    return [...items, ...later];
  }

  return {
    name: 'campaigns',
    register,
    tasks: { [TASK_KIND]: { needsProfile: false, handler: async ({ task, workspace, check, progress, signal }) => {
      for (const id of task.input?.campaignIds || []) { check(); await executeRun(workspace, id, task.input.trigger || 'manual', { check, progress, signal }); }
    } } },
    attention,
    async start({ workspace, workflow, emit }) {
      bind(workspace, { workflow, emit });
      let ticking = null;
      const tick = () => ticking ||= scheduleDue(workspace).catch(() => null).finally(() => { ticking = null; });
      await tick();
      const handle = timers.setInterval(tick, tickMs);
      handle?.unref?.();
      return async () => { timers.clearInterval(handle); await ticking; };
    },
  };
}

function summary(run) {
  if (!run) return null;
  const { surfaced = [], ...rest } = run;
  return { ...rest, surfacedCount: surfaced.length, surfaced: surfaced.slice(0, 20).map(({ jobId, company, title, url, location, source, reason }) => ({ jobId, company, title, url, location, source, reason })) };
}

export default createCampaignsFeature();
