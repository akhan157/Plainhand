// Discovery campaigns (milestone N1, docs/NEXT-BUILD-PLAN.md). Synthetic job
// boards, an injected liveness check and a fake clock; no network and no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';
import { createCampaignsFeature, TASK_KIND } from './plainhand/features/campaigns.mjs';
import { parseSchedule, nextRunAt } from './plainhand/features/campaigns/config.mjs';

const HOUR = 3600000;
const ACME = { name: 'Acme', url: 'https://boards.greenhouse.io/acme' };
const GLOBEX = { name: 'Globex', url: 'https://jobs.lever.co/globex' };
const posting = (company, n, title = 'Mechanical Engineer', location = 'Boston, MA') => ({ company, title, location, url: `https://jobs.example.com/${company.toLowerCase()}/${n}` });
const DESCRIPTION = 'This is an engineering role designing and testing hardware. '.repeat(10);

async function setup({ start = '2026-10-20T09:00:00.000Z', profile = true, desktop = null, root = null, boards = null, closed = null } = {}) {
  root ||= await mkdtemp(path.join(tmpdir(), 'plainhand-campaigns-'));
  const clock = { t: new Date(start) };
  boards ||= new Map(); // source url -> postings array or Error
  closed ||= new Set();
  const scans = [], verified = [];
  const scanner = async source => { scans.push(source.name); const value = boards.get(source.url); if (value instanceof Error) throw value; return structuredClone(value || []); };
  const verifier = async job => { verified.push(job.url); return closed.has(job.url) ? { state: 'closed', legitimacy: 'unconfirmed', reason: 'Closed.', checkedAt: new Date().toISOString() } : { state: 'active', legitimacy: 'official-ats-unconfirmed-employer', reason: 'Fixture.', description: DESCRIPTION, checkedAt: new Date().toISOString() }; };
  const intervals = [];
  const timers = { setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval: id => { intervals[id - 1] = null; } };
  const feature = createCampaignsFeature({ now: () => clock.t, timers, desktop });
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: fixtureAgent, scanner, verifier }, features: [feature] });
  if (profile) { const state = await app.workspace.load(); if (!state.profile.name) await app.workspace.saveProfile(candidate, state.revision); await app.workspace.mutate(s => { s.provider = 'codex'; }); }
  const ui = async (name, input = {}, options = {}) => (await app.registry.run(name, input, { actor: 'ui', ...options })).result;
  const settle = async () => { let queue; do { queue = app.workflow.queue; await queue; } while (queue !== app.workflow.queue); };
  const tick = async () => { const result = await intervals.at(-1)?.(); await settle(); return result; };
  const runNow = async campaignId => { const { taskId } = await ui('campaigns.run', { campaignId }); await settle(); return taskId; };
  const source = async ({ name, url }) => { await ui('sources.add', { name, url }); return (await app.workspace.load()).sources.find(s => s.url === url).id; };
  const tasks = async kind => (await app.workspace.load()).tasks.filter(t => t.kind === kind);
  const lastRun = async id => (await ui('campaigns.get', { campaignId: id })).runs[0];
  const digest = async () => ui('workspace.digest');
  return { root, app, clock, boards, closed, scans, verified, feature, ui, settle, tick, runNow, source, tasks, lastRun, digest, advance: ms => { clock.t = new Date(clock.t.getTime() + ms); },
    close: async ({ keep = false } = {}) => { await app.close(); if (!keep) await rm(root, { recursive: true, force: true }); } };
}

test('a campaign lives in one owner-only file; pausing and editing are one action each, validated', async () => {
  const h = await setup();
  try {
    const { campaign } = await h.ui('campaigns.create', { name: 'Boston ME', terms: ['Mechanical Engineer'], locations: ['Boston'], schedule: 'daily' });
    assert.deepEqual([campaign.liveness, campaign.dailyEvaluationLimit, campaign.paused, campaign.sourceIds, campaign.notify], [true, 0, false, [], { inApp: true, desktop: false }], 'defaults: liveness on, surface only, all sources');
    const file = path.join(h.root, 'data/plainhand/campaigns.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const read = async () => JSON.parse(await h.app.workspace.read('data/plainhand/campaigns.json'));
    assert.equal((await read()).campaigns.length, 1);
    await h.ui('campaigns.pause', { campaignId: 'boston me' });
    assert.equal((await read()).campaigns[0].paused, true, 'pause by name, in the same file');
    await h.ui('campaigns.update', { campaignId: campaign.id, terms: ['Design Engineer'], schedule: 'every 8 hours', dailyEvaluationLimit: 3 });
    const updated = (await read()).campaigns[0];
    assert.deepEqual([updated.terms, updated.schedule, updated.dailyEvaluationLimit, updated.paused, updated.locations], [['Design Engineer'], 'every 8 hours', 3, true, ['Boston']]);
    await h.ui('campaigns.resume', { campaignId: campaign.id });
    assert.equal((await read()).campaigns[0].paused, false);
    for (const [input, message] of [
      [{ name: 'Too often', terms: ['x'], schedule: 'every 2 hours' }, /at most every 6 hours/],
      [{ name: 'Too many', terms: ['x'], dailyEvaluationLimit: 11 }, /at most 10/],
      [{ name: 'Fraction', terms: ['x'], dailyEvaluationLimit: 1.5 }, /integer/],
      [{ name: 'No terms', terms: [] }, /at least one role keyword/],
      [{ name: 'boston me', terms: ['x'] }, /already has this name/],
      [{ name: 'Bad source', terms: ['x'], sourceIds: ['missing'] }, /no longer exists/],
    ]) await assert.rejects(h.ui('campaigns.create', input), error => error.code === 'invalid_input' && message.test(error.message), input.name);
    assert.equal((await read()).campaigns.length, 1, 'rejected input writes nothing');
    assert.deepEqual([parseSchedule('Every 12 hours'), parseSchedule('every 24 hours'), parseSchedule(''), parseSchedule('daily')], ['every 12 hours', 'daily', 'manual', 'daily']);
    // Delete is reversible.
    const { undoToken } = await h.app.registry.run('campaigns.delete', { campaignId: campaign.id });
    assert.equal((await read()).campaigns.length, 0);
    await h.app.registry.undo(undoToken);
    assert.equal((await read()).campaigns[0].id, campaign.id);
  } finally { await h.close(); }
});

test('the schedule runs due campaigns once, skips paused and manual ones, and catches up a missed run only once', async () => {
  const h = await setup();
  let second;
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [posting('Acme', 1)]);
    const { campaign } = await h.ui('campaigns.create', { name: 'Daily', terms: ['Engineer'], schedule: 'daily' });
    await h.ui('campaigns.create', { name: 'Manual', terms: ['Engineer'] });
    const paused = (await h.ui('campaigns.create', { name: 'Paused', terms: ['Engineer'], schedule: 'every 6 hours' })).campaign;
    await h.ui('campaigns.pause', { campaignId: paused.id });
    await h.tick();
    let scans = await h.tasks(TASK_KIND);
    assert.equal(scans.length, 1, 'a scheduled campaign that never ran is due now');
    assert.deepEqual(scans[0].input.campaignIds, [campaign.id], 'manual and paused campaigns are not scheduled');
    assert.equal(scans[0].status, 'complete');
    h.advance(HOUR); await h.tick();
    h.advance(10 * HOUR); await h.tick();
    assert.equal((await h.tasks(TASK_KIND)).length, 1, 'not due again within the interval');
    h.advance(14 * HOUR); await h.tick();
    assert.equal((await h.tasks(TASK_KIND)).length, 2, 'due after 24 hours');
    const { campaign: view } = await h.ui('campaigns.get', { campaignId: campaign.id });
    assert.equal(view.health.nextRunAt, new Date(h.clock.t.getTime() + 24 * HOUR).toISOString());
    // Plainhand is closed for five days, then started again.
    await h.close({ keep: true });
    second = await setup({ root: h.root, start: new Date(h.clock.t.getTime() + 5 * 24 * HOUR).toISOString(), boards: h.boards });
    await second.settle();
    assert.equal((await second.tasks(TASK_KIND)).length, 3, 'the missed run happens once at start');
    await second.tick(); second.advance(HOUR); await second.tick();
    assert.equal((await second.tasks(TASK_KIND)).length, 3, 'and is not repeated for every missed day');
    assert.equal(nextRunAt({ schedule: 'manual' }, {}), null);
  } finally { if (second) await second.close(); else await h.close(); }
});

test('liveness is on by default and removes closed postings; off keeps them', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [posting('Acme', 1), posting('Acme', 2, 'Senior Mechanical Engineer')]);
    h.closed.add(posting('Acme', 2).url);
    const { campaign } = await h.ui('campaigns.create', { name: 'Live only', terms: ['Mechanical Engineer'] });
    await h.runNow(campaign.id);
    const run = await h.lastRun(campaign.id);
    assert.deepEqual(run.surfaced.map(r => r.url), [posting('Acme', 1).url]);
    assert.equal(run.counts.closed, 1);
    assert.match(run.surfaced[0].reason, /posting checked and open/);
    assert.equal(h.verified.length, 2, 'each candidate was checked');
    const other = (await h.ui('campaigns.create', { name: 'No liveness', terms: ['Senior'], liveness: false })).campaign;
    await h.runNow(other.id);
    assert.deepEqual((await h.lastRun(other.id)).surfaced.map(r => r.url), [posting('Acme', 2).url], 'with liveness off the closed posting is not checked');
  } finally { await h.close(); }
});

test('roles already in the workspace, in the scan history or surfaced by another campaign are not surfaced', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    const saved = posting('Acme', 1), historic = posting('Acme', 2, 'Systems Engineer'), sameRole = { ...posting('Acme', 3), title: 'Robotics Engineer' }, fresh = posting('Acme', 4, 'Test Engineer');
    await h.ui('jobs.add', { company: 'Acme', title: 'Robotics Engineer', url: 'https://jobs.lever.co/acme/other-link' });
    await h.ui('jobs.add', { company: saved.company, title: saved.title, url: saved.url });
    await mkdir(path.join(h.root, 'data/plainhand'), { recursive: true });
    await writeFile(path.join(h.root, 'data/plainhand/scan-history.json'), JSON.stringify([{ company: historic.company, title: historic.title, url: historic.url, seenAt: '2026-10-01T00:00:00.000Z' }]));
    h.boards.set(ACME.url, [saved, historic, sameRole, fresh]);
    const a = (await h.ui('campaigns.create', { name: 'A', terms: ['Engineer'] })).campaign;
    await h.runNow(a.id);
    const run = await h.lastRun(a.id);
    assert.deepEqual(run.surfaced.map(r => r.title), ['Test Engineer']);
    assert.equal(run.counts.alreadySaved, 2, 'same URL or same company and title as a saved job');
    assert.equal(run.counts.alreadySeen, 1, 'the command-line scan history counts as seen');
    const history = JSON.parse(await h.app.workspace.read('data/plainhand/scan-history.json'));
    assert.ok(history.some(e => e.url === fresh.url), 'surfaced roles join the shared scan history');
    const b = (await h.ui('campaigns.create', { name: 'B', terms: ['Test'] })).campaign;
    await h.runNow(b.id);
    assert.equal((await h.lastRun(b.id)).surfaced.length, 0, 'another campaign does not surface it again');
    const jobs = (await h.app.workspace.load()).jobs.filter(j => j.url === fresh.url);
    assert.equal(jobs.length, 1);
    assert.deepEqual([jobs[0].stage, jobs[0].campaign.name, jobs[0].selected], ['inbox', 'A', false], 'saved to the inbox tagged with the campaign');
  } finally { await h.close(); }
});

test('a role is surfaced again only after a meaningful change: reposted after closing or removal, or retitled', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    const role = posting('Acme', 1);
    h.boards.set(ACME.url, [role]);
    const { campaign } = await h.ui('campaigns.create', { name: 'Reposts', terms: ['Engineer'] });
    const forget = () => h.app.workspace.mutate(s => { s.jobs = s.jobs.filter(j => j.url !== role.url); });
    await h.runNow(campaign.id);
    assert.equal((await h.lastRun(campaign.id)).surfaced.length, 1);
    await forget(); // e.g. the candidate undid the save
    h.advance(HOUR); await h.runNow(campaign.id);
    assert.equal((await h.lastRun(campaign.id)).surfaced.length, 0, 'unchanged: not surfaced again');
    h.boards.set(ACME.url, []);
    h.advance(HOUR); await h.runNow(campaign.id);
    h.boards.set(ACME.url, [role]);
    h.advance(HOUR); await h.runNow(campaign.id);
    let run = await h.lastRun(campaign.id);
    assert.equal(run.surfaced.length, 1);
    assert.match(run.surfaced[0].reason, /reposted after it was removed from the board on 2026-10-20/);
    assert.match(run.surfaced[0].reason, /first seen 2026-10-20/);
    await forget();
    h.boards.set(ACME.url, [{ ...role, title: 'Lead Mechanical Engineer' }]);
    h.advance(HOUR); await h.runNow(campaign.id);
    run = await h.lastRun(campaign.id);
    assert.match(run.surfaced[0]?.reason || '', /title changed from "Mechanical Engineer"/);
    // A posting seen closed by the liveness check, then open again.
    const late = posting('Acme', 5, 'Test Engineer');
    h.boards.set(ACME.url, [{ ...role, title: 'Lead Mechanical Engineer' }, late]);
    h.closed.add(late.url);
    h.advance(HOUR); await h.runNow(campaign.id);
    assert.deepEqual([(await h.lastRun(campaign.id)).counts.closed, (await h.lastRun(campaign.id)).surfaced.length], [1, 0]);
    h.closed.delete(late.url);
    h.advance(HOUR); await h.runNow(campaign.id);
    assert.match((await h.lastRun(campaign.id)).surfaced[0]?.reason || '', /reposted after it was closed/);
  } finally { await h.close(); }
});

test('every surfaced role says why and from where, also on the saved job', async () => {
  const h = await setup();
  try {
    await h.source(ACME); await h.source(GLOBEX);
    h.boards.set(ACME.url, [posting('Acme', 1), posting('Acme', 2, 'Accountant'), posting('Acme', 3, 'Design Engineer', 'Denver, CO'), posting('Acme', 4, 'Mechanical Engineer Intern')]);
    h.boards.set(GLOBEX.url, [posting('Globex', 1, 'Design Engineer', 'Remote (US)')]);
    const { campaign } = await h.ui('campaigns.create', { name: 'Boston or remote', terms: ['Mechanical Engineer', 'Design Engineer'], locations: ['Boston', 'Remote'], exclusions: ['Intern'] });
    await h.runNow(campaign.id);
    const run = await h.lastRun(campaign.id);
    assert.deepEqual(run.surfaced.map(r => `${r.company}: ${r.title}`), ['Acme: Mechanical Engineer', 'Globex: Design Engineer']);
    assert.equal(run.counts.filtered, 3, 'wrong title, wrong location and an exclusion');
    assert.equal(run.surfaced[0].reason, 'Matched "Mechanical Engineer" in the title; in Boston, MA; source Acme board; first seen 2026-10-20; posting checked and open');
    assert.match(run.surfaced[1].reason, /^Matched "Design Engineer" in the title; in Remote \(US\); source Globex board; first seen 2026-10-20/);
    const state = await h.app.workspace.load();
    for (const role of run.surfaced) {
      const job = state.jobs.find(j => j.id === role.jobId);
      assert.equal(job.campaign.reason, role.reason);
      assert.equal(job.campaign.source, role.source);
    }
    assert.ok(state.events[0].text.includes('saved 2 new roles') && state.events[0].text.includes('No applications were started'));
    const results = await h.ui('campaigns.results', {});
    assert.ok(results.runs[0].surfaced.every(r => r.reason && r.source && r.jobId));
  } finally { await h.close(); }
});

test('a failing source is isolated, counted in health and shown in the briefing', async () => {
  const h = await setup();
  try {
    await h.source(ACME); await h.source(GLOBEX);
    h.boards.set(ACME.url, new Error('The job source returned HTTP 503. Retry later.'));
    h.boards.set(GLOBEX.url, [posting('Globex', 1)]);
    const { campaign } = await h.ui('campaigns.create', { name: 'Two boards', terms: ['Engineer'] });
    await h.runNow(campaign.id);
    h.boards.set(GLOBEX.url, [posting('Globex', 1), posting('Globex', 2, 'Test Engineer')]);
    h.advance(HOUR); await h.runNow(campaign.id);
    const { campaign: view, runs } = await h.ui('campaigns.get', { campaignId: campaign.id });
    assert.deepEqual(runs.map(r => [r.status, r.surfaced.length]), [['partial', 1], ['partial', 1]], 'the other source still surfaces roles');
    assert.deepEqual(view.health.sourceErrors, [{ sourceId: view.health.sourceErrors[0].sourceId, source: 'Acme', error: 'The job source returned HTTP 503. Retry later.', consecutiveFailures: 2 }]);
    assert.equal(view.health.consecutiveFailures, 2);
    assert.deepEqual(view.health.counts.surfaced, 1);
    const item = (await h.digest()).attention.find(a => a.kind === 'campaign-failing');
    assert.match(item.text, /Campaign "Two boards": Acme could not be checked \(2 runs in a row\): The job source returned HTTP 503/);
    h.boards.set(ACME.url, []);
    h.advance(HOUR); await h.runNow(campaign.id);
    const healed = (await h.ui('campaigns.get', { campaignId: campaign.id })).campaign.health;
    assert.deepEqual([healed.sourceErrors, healed.consecutiveFailures, healed.lastStatus], [[], 0, 'ok']);
    assert.equal((await h.digest()).attention.filter(a => a.kind === 'campaign-failing').length, 0);
    assert.equal((await h.tasks(TASK_KIND)).every(t => t.status === 'complete'), true, 'a source error does not fail the task');
  } finally { await h.close(); }
});

test('automatic evaluation stays within the daily limit across runs and days; nothing is prepared or applied', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [1, 2, 3].map(n => posting('Acme', n, `Engineer ${n}`)));
    const { campaign } = await h.ui('campaigns.create', { name: 'Evaluate two', terms: ['Engineer'], dailyEvaluationLimit: 2 });
    await h.runNow(campaign.id);
    assert.equal((await h.tasks('evaluate')).length, 2);
    let run = await h.lastRun(campaign.id);
    assert.equal(run.evaluationsQueued, 2);
    assert.match(run.notes.join(' '), /Daily evaluation limit reached \(2\); 1 role waits in your inbox/);
    h.boards.set(ACME.url, [1, 2, 3, 4, 5].map(n => posting('Acme', n, `Engineer ${n}`)));
    h.advance(2 * HOUR); await h.runNow(campaign.id);
    assert.equal((await h.tasks('evaluate')).length, 2, 'the same day: no more evaluations');
    assert.equal((await h.lastRun(campaign.id)).surfaced.length, 2, 'new roles are still saved');
    h.boards.set(ACME.url, [1, 2, 3, 4, 5, 6, 7, 8].map(n => posting('Acme', n, `Engineer ${n}`)));
    h.advance(24 * HOUR); await h.runNow(campaign.id);
    assert.equal((await h.tasks('evaluate')).length, 4, 'the next day: up to the limit again');
    const runs = JSON.parse(await h.app.workspace.read('data/plainhand/campaign-runs.json'));
    assert.deepEqual(Object.values(runs.evaluations[campaign.id]), [2, 2], 'counts persisted per day');
    const surfaceOnly = (await h.ui('campaigns.create', { name: 'Surface only', terms: ['Engineer'], dailyEvaluationLimit: 0 })).campaign;
    h.boards.set(ACME.url, [posting('Acme', 9, 'Engineer 9')]);
    await h.runNow(surfaceOnly.id);
    assert.equal((await h.tasks('evaluate')).length, 4, 'limit 0 never evaluates');
    const state = await h.app.workspace.load();
    assert.deepEqual([...new Set(state.tasks.map(t => t.kind))].sort(), [TASK_KIND, 'evaluate'].sort(), 'only scans and evaluations ran');
    assert.ok(state.jobs.every(j => !j.packet && !j.selected && !j.submittedAt && !j.approvedHash && j.status !== 'Applied'));
  } finally { await h.close(); }
});

test('without a ready profile the scan still saves roles and explains the skipped evaluation', async () => {
  const h = await setup({ profile: false });
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [posting('Acme', 1)]);
    const { campaign } = await h.ui('campaigns.create', { name: 'No profile', terms: ['Engineer'], dailyEvaluationLimit: 1 });
    await h.runNow(campaign.id);
    const run = await h.lastRun(campaign.id);
    assert.equal(run.surfaced.length, 1);
    assert.match(run.notes[0], /Automatic evaluation skipped: Connect and select an agent first/);
    const runs = JSON.parse(await h.app.workspace.read('data/plainhand/campaign-runs.json'));
    assert.deepEqual(runs.evaluations[campaign.id], {}, 'a skipped evaluation does not use the daily limit');
  } finally { await h.close(); }
});

test('agent writes and tasks need confirmation; MCP can read and write but not run a campaign', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [posting('Acme', 1)]);
    const input = { name: 'Agent made', terms: ['Engineer'] };
    await assert.rejects(h.app.registry.run('campaigns.create', input, { actor: 'agent' }), error => error.code === 'confirmation_required');
    assert.equal(await h.app.workspace.read('data/plainhand/campaigns.json'), '', 'nothing written without confirmation');
    const { result } = await h.app.registry.run('campaigns.create', input, { actor: 'agent', confirmed: true });
    for (const name of ['campaigns.pause', 'campaigns.resume', 'campaigns.update', 'campaigns.delete', 'campaigns.run']) {
      await assert.rejects(h.app.registry.run(name, { campaignId: result.campaign.id }, { actor: 'agent' }), error => error.code === 'confirmation_required', name);
    }
    await assert.rejects(h.app.registry.run('campaigns.run', { campaignId: result.campaign.id }, { actor: 'mcp' }), error => error.code === 'confirmation_required' && /not from an external agent/.test(error.message));
    await h.app.registry.run('campaigns.pause', { campaignId: result.campaign.id }, { actor: 'mcp' });
    assert.ok((await h.app.registry.run('campaigns.list', {}, { actor: 'mcp' })).result.campaigns[0].paused);
    assert.equal((await h.tasks(TASK_KIND)).length, 0);
    await h.app.registry.run('campaigns.run', { campaignId: 'Agent made' }, { actor: 'agent', confirmed: true });
    await h.settle();
    assert.equal((await h.tasks(TASK_KIND)).length, 1, 'a confirmed agent run is queued (a paused campaign can still be run by hand)');
    const audit = (await h.ui('audit.list', { limit: 20 }));
    assert.ok(audit.some(e => e.action === 'agent-task' && /campaigns\.run/.test(e.reason)));
    assert.ok(h.app.registry.list().filter(d => d.name.startsWith('campaigns.')).every(d => d.description.length > 40));
  } finally { await h.close(); }
});

test('briefing: new roles since last viewed, failing campaigns, paused campaigns with a due schedule', async () => {
  const h = await setup();
  try {
    await h.source(ACME);
    h.boards.set(ACME.url, [posting('Acme', 1), posting('Acme', 2, 'Test Engineer'), posting('Acme', 3, 'Design Engineer')]);
    const { campaign } = await h.ui('campaigns.create', { name: 'Brief', terms: ['Engineer'] });
    await h.runNow(campaign.id);
    let attention = (await h.digest()).attention;
    const fresh = attention.find(a => a.kind === 'campaign-new');
    assert.match(fresh.text, /^Campaign "Brief": 3 new roles since you last looked \(Acme — .+; Acme — .+; …\)$/);
    h.advance(1000);
    await h.ui('campaigns.markViewed');
    assert.equal((await h.digest()).attention.filter(a => a.kind === 'campaign-new').length, 0, 'viewing clears it');
    h.boards.set(ACME.url, [posting('Acme', 4, 'Robotics Engineer')]);
    h.advance(1000); await h.runNow(campaign.id);
    const single = (await h.digest()).attention.find(a => a.kind === 'campaign-new');
    assert.match(single.text, /1 new role since/);
    assert.ok(single.jobId, 'a single new role links to it');
    const daily = (await h.ui('campaigns.create', { name: 'Sleeping', terms: ['Engineer'], schedule: 'daily' })).campaign;
    await h.ui('campaigns.pause', { campaignId: daily.id });
    attention = (await h.digest()).attention;
    const paused = attention.find(a => a.kind === 'campaign-paused');
    assert.match(paused.text, /Campaign "Sleeping" is paused; its daily scan is due/);
    assert.ok(attention.indexOf(paused) > attention.indexOf(attention.find(a => a.kind === 'campaign-new')), 'paused campaigns are low priority');
    await h.ui('campaigns.resume', { campaignId: daily.id });
    assert.equal((await h.digest()).attention.filter(a => a.kind === 'campaign-paused').length, 0);
  } finally { await h.close(); }
});

test('notifications: an in-app event for every run, a desktop notice only when enabled, never twice for a role', async () => {
  const delivered = [];
  const desktop = { name: 'desktop', deliver: async payload => { delivered.push(payload); return { accepted: true }; } };
  const h = await setup({ desktop });
  try {
    await new Promise(resolve => h.app.server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${h.app.server.address().port}/api/events?token=${h.app.token}`, { signal: controller.signal });
    const reader = response.body.getReader();
    let streamed = '';
    const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; streamed += Buffer.from(value).toString(); } } catch {} })();
    await h.source(ACME);
    const role = posting('Acme', 1);
    h.boards.set(ACME.url, [role]);
    const quiet = (await h.ui('campaigns.create', { name: 'Quiet', terms: ['Mechanical'] })).campaign;
    const loud = (await h.ui('campaigns.create', { name: 'Loud', terms: ['Engineer'], desktop: true })).campaign;
    await h.runNow(quiet.id);
    assert.equal(delivered.length, 0, 'desktop notices are off by default');
    h.boards.set(ACME.url, [role, posting('Acme', 2, 'Test Engineer')]);
    await h.runNow(loud.id);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].title, 'Acme — Test Engineer');
    assert.match(delivered[0].body, /Source: Acme board/);
    assert.match(delivered[0].body, /Campaign: Loud/);
    assert.match(delivered[0].body, /Why: Matched "Engineer" in the title; location Boston, MA; source Acme board; first seen 2026-10-20/);
    // The role is removed and later reposted: surfaced again, but never notified twice.
    await h.app.workspace.mutate(s => { s.jobs = s.jobs.filter(j => j.title !== 'Test Engineer'); });
    h.boards.set(ACME.url, [role]); h.advance(HOUR); await h.runNow(loud.id);
    h.boards.set(ACME.url, [role, posting('Acme', 2, 'Test Engineer')]); h.advance(HOUR); await h.runNow(loud.id);
    assert.equal((await h.lastRun(loud.id)).surfaced.length, 1, 'surfaced again after the repost');
    assert.equal(delivered.length, 1, 'but not notified again');
    for (let i = 0; i < 50 && (streamed.match(/event: campaign\.update/g) || []).length < 4; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((streamed.match(/event: campaign\.update/g) || []).length, 4, 'one live update per run');
    controller.abort(); await pump;
  } finally { await h.close(); }
});
