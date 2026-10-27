// N3 outcome insights: every done criterion against synthetic workspaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { FEATURES } from './plainhand/features/index.mjs';
import { insights, SILENCE_DAYS } from './plainhand/features/insights.mjs';
import { bandOf, BAND_MINIMUM, OVERALL_MINIMUM, SUGGEST_MINIMUM } from './plainhand/features/insights/analysis.mjs';
import { candidate, fixtureAgent, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';
import { syntheticJob, daysAgo, dateAgo, many, sufficientJobs, TRACKER_HEADER as header } from './test-feature-insights-fixtures.mjs';

async function harness({ jobs = [], tracker = null, agent } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-insights-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent: agent || fixtureAgent } });
  await app.workspace.saveProfile(candidate, (await app.workspace.load()).revision);
  await app.workspace.write('reports/001-legacy.md', '# Legacy\n\n## Machine Summary\n\n```yaml\narchetype: Test Engineer\nnarrative: hands-on builder\n```\n');
  if (tracker) await app.workspace.write('data/applications.md', tracker);
  if (jobs.length) await app.workspace.mutate(state => { state.jobs.push(...jobs); });
  const run = (name, input = {}, options) => app.registry.run(name, input, options);
  const snapshot = async () => {
    const files = {};
    for (const file of ['config/profile.yml', 'cv.md', 'data/applications.md', 'modes/_profile.md', 'portals.yml']) files[file] = await app.workspace.read(file);
    for (const file of await readdir(path.join(root, 'reports')).catch(() => [])) files['reports/' + file] = await readFile(path.join(root, 'reports', file), 'utf8');
    const state = await app.workspace.load();
    return { files, profile: JSON.stringify(state.profile), jobs: JSON.stringify(state.jobs), sources: JSON.stringify(state.sources), understanding: JSON.stringify(state.understanding) };
  };
  const ledgerFile = () => app.workspace.read('data/plainhand/insights/outcome-recommendation-state.json');
  return { root, app, run, snapshot, ledgerFile, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('the feature is registered and its tiers are what the contract says', async () => {
  assert.ok(FEATURES.includes(insights));
  const h = await harness();
  try {
    const tiers = Object.fromEntries(h.app.registry.list().filter(d => d.name.startsWith('insights.')).map(d => [d.name, d.tier]));
    assert.deepEqual(tiers, { 'insights.summary': 'read', 'insights.patterns': 'read', 'insights.recommendations': 'read', 'insights.suggest': 'write', 'insights.approve': 'candidate', 'insights.reject': 'candidate', 'insights.defer': 'candidate' });
  } finally { await h.close(); }
});

test('no outcomes: everything is insufficient data, never 0%, and suggest saves nothing', async () => {
  const h = await harness();
  try {
    const { result } = await h.run('insights.summary');
    assert.equal(result.empty, true);
    assert.equal(result.overall.insufficientData, true);
    assert.equal(result.overall.interviewRate, null);
    assert.equal(result.correlation.status, 'insufficient-data');
    assert.match(result.correlation.statement, /missing data, not a bad result/);
    for (const band of result.bands) { assert.equal(band.insufficientData, true); assert.equal(band.interviewRate, null); assert.equal(band.offerRate, null); }
    const patterns = (await h.run('insights.patterns')).result;
    assert.ok(patterns.dimensions.every(d => !d.available && d.limit));
    assert.deepEqual(patterns.sourceWarnings.map(w => w.code), ['missing-tracker']);
    assert.ok(!patterns.sourceWarnings[0].message.includes(h.root), 'no absolute paths in what the page shows');
    const suggest = (await h.run('insights.suggest')).result;
    assert.equal(suggest.status, 'insufficient-data');
    assert.equal(suggest.created, 0);
    assert.match(suggest.message, /Not enough outcomes yet: 0 of 8/);
    assert.equal(await h.ledgerFile(), '', 'no ledger is written without enough data');
    const recs = (await h.run('insights.recommendations')).result;
    assert.deepEqual([recs.pending, recs.approved, recs.rejected, recs.deferred].map(l => l.length), [0, 0, 0, 0]);
    assert.equal(recs.data.status, 'insufficient-data');
    assert.ok(!(await h.run('workspace.digest')).result.attention.some(a => a.kind === 'insights'));
  } finally { await h.close(); }
});

test('a band below the minimum shows no rate; above it, it is provisional until the overall minimum', async () => {
  const jobs = [...many(3, { score: 4.6, outcome: 'interview' }), ...many(3, { score: 3.6, outcome: 'interview' }), ...many(2, { score: 3.6, outcome: 'rejected' })];
  const h = await harness({ jobs });
  try {
    const { result } = await h.run('insights.summary');
    const high = result.bands.find(b => b.key === '4.5-5.0'), mid = result.bands.find(b => b.key === '3.5-3.9');
    assert.equal(high.observed, 3);
    assert.equal(high.insufficientData, true);
    assert.equal(high.interviewRate, null, 'three interviews out of three is still not a rate');
    assert.match(high.note, new RegExp(`3 of ${BAND_MINIMUM}`));
    assert.equal(mid.observed, 5);
    assert.equal(mid.insufficientData, false);
    assert.equal(mid.provisional, true);
    assert.equal(mid.interviewRate, 0.6);
    assert.equal(result.overall.insufficientData, true);
    assert.equal(result.overall.minimum, OVERALL_MINIMUM);
    assert.match(result.overall.warning, /provisional/);
    assert.equal(result.correlation.status, 'insufficient-data');
  } finally { await h.close(); }
});

test('silence is counted apart from rejection and only after the silence threshold', async () => {
  assert.equal(SILENCE_DAYS, 21);
  const jobs = [
    syntheticJob({ score: 4.1, outcome: 'silent', applied: 30 }), syntheticJob({ score: 4.1, outcome: 'silent', applied: SILENCE_DAYS }),
    syntheticJob({ score: 4.1, outcome: 'silent', applied: 10 }), syntheticJob({ score: 4.2, outcome: 'rejected', applied: 30 }),
    ...many(4, { score: 4.2, outcome: 'interview' }), syntheticJob({ score: 4.2, outcome: 'responded', applied: 40, changed: 35 }),
  ];
  const h = await harness({ jobs });
  try {
    const band = (await h.run('insights.summary')).result.bands.find(b => b.key === '4.0-4.4');
    assert.equal(band.applied, 9);
    assert.equal(band.silent, 2, 'Applied for 30 and for exactly 21 days with no change');
    assert.equal(band.pending, 2, 'Applied 10 days ago, and Responded (a status change, not silence)');
    assert.equal(band.rejected, 1, 'silence is never a rejection');
    assert.equal(band.observed, 5);
    assert.equal(band.assumed, 2);
    assert.equal(band.interviewRate, 0.8, 'observed rate excludes silent applications');
    assert.equal(band.interviewRateIfSilenceIsNo, +(4 / 7).toFixed(4), 'the assumed rate is labelled separately');
  } finally { await h.close(); }
});

test('interview rounds and status history count: an interview that ended in rejection still reached interview', async () => {
  const jobs = [syntheticJob({ score: 4.2, outcome: 'interview-rejected' }), syntheticJob({ score: 4.2, outcome: 'interview', interviewsOnly: true }), syntheticJob({ score: 4.2, outcome: 'offer' })];
  const h = await harness({ jobs });
  try {
    const band = (await h.run('insights.summary')).result.bands.find(b => b.key === '4.0-4.4');
    assert.deepEqual([band.interviews, band.rejected, band.rejectedAfterInterview, band.offers, band.observed], [3, 1, 1, 1, 3]);
  } finally { await h.close(); }
});

test('observed and assumed are stated plainly', async () => {
  const h = await harness();
  try {
    const { observedVsAssumed } = (await h.run('insights.summary')).result;
    assert.ok(observedVsAssumed.observed.some(s => /Status changes you recorded/.test(s)));
    assert.ok(observedVsAssumed.observed.some(s => /Interview rounds/.test(s)));
    assert.ok(observedVsAssumed.assumed.some(s => /21 days/.test(s) && /not rejected/.test(s)));
    assert.ok(observedVsAssumed.assumed.some(s => /correlation/.test(s)));
  } finally { await h.close(); }
});

test('legacy tracker rows are included; a row Plainhand wrote is not counted twice; Apply is not applied', async () => {
  const mine = syntheticJob({ score: 4.2, outcome: 'interview', company: 'Mine Co', title: 'Engineer' });
  const tracker = header + [
    `| 1 | ${dateAgo(60)} | Legacy One | Test Engineer | 3.8/5 | Interview | ✅ | [1](../reports/001-legacy.md) | |`,
    `| 2 | ${dateAgo(60)} | Legacy Two | Test Engineer | 3.8/5 | Rejected | ✅ | | |`,
    `| 3 | ${dateAgo(40)} | Legacy Three | Test Engineer | 3.9/5 | Applied | ✅ | | |`,
    `| 4 | ${dateAgo(40)} | Legacy Four | Test Engineer | 3.9/5 | Apply | — | | |`,
    `| 5 | ${dateAgo(10)} | Mine Co | Engineer | 4.2/5 | Interview | ✅ | | |`,
  ].join('\n') + '\n';
  const h = await harness({ jobs: [mine], tracker });
  try {
    const { result } = await h.run('insights.summary');
    assert.equal(result.sources.legacyTrackerRows, 4);
    assert.equal(result.sources.workspaceJobs, 1);
    const band = result.bands.find(b => b.key === '3.5-3.9');
    assert.deepEqual([band.evaluated, band.applied, band.interviews, band.rejected, band.silent], [4, 3, 1, 1, 1], 'legacy row 3 is silent by its row date; row 4 (Apply) was never submitted');
    assert.equal(result.bands.find(b => b.key === '4.0-4.4').applied, 1, 'the matched tracker row is the workspace job');
    const patterns = await h.run('insights.patterns');
    const narrative = patterns.result.dimensions.find(d => d.field === 'narrative');
    assert.equal(narrative.groups[0].value, 'hands-on builder');
    assert.equal(narrative.groups[0].sample, 1);
    assert.equal(narrative.groups[0].insufficientData, true);
    assert.match(narrative.groups[0].evidence, /Not evidence for or against/);
    assert.deepEqual(patterns.taintSources.map(t => t.kind), ['report'], 'report-derived values are marked untrusted');
  } finally { await h.close(); }
});

test('a score on a band boundary is never dropped', () => {
  assert.equal(bandOf(4.45).key, '4.0-4.4');
  assert.equal(bandOf(3.45).key, '3.0-3.4');
  assert.equal(bandOf(2.95).key, '0.0-2.9');
  assert.equal(bandOf(5).key, '4.5-5.0');
  assert.equal(bandOf(null), null);
});

test('with enough outcomes: correlation is stated, suggestions are saved once, and nothing else changes', async () => {
  const h = await harness({ jobs: sufficientJobs() });
  try {
    const summary = (await h.run('insights.summary')).result;
    assert.equal(summary.overall.observed, 20);
    assert.equal(summary.overall.insufficientData, false);
    assert.equal(summary.correlation.status, 'higher-scores-fewer-interviews');
    assert.equal(summary.bands.find(b => b.key === '3.5-3.9').provisional, false);
    const before = await h.snapshot();
    const first = (await h.run('insights.suggest')).result;
    assert.equal(first.status, 'suggestions');
    assert.ok(first.created >= 2, JSON.stringify(first));
    const ledgerAfterFirst = await h.ledgerFile();
    const second = (await h.run('insights.suggest')).result;
    assert.deepEqual([second.created, second.existing], [0, first.created], 'idempotent by fingerprint');
    assert.equal(await h.ledgerFile(), ledgerAfterFirst, 'the ledger is unchanged by a repeat');
    const recs = (await h.run('insights.recommendations')).result;
    assert.equal(recs.pending.length, first.created);
    assert.deepEqual(recs.pending.map(r => r.type).sort(), ['observed-positive-floor', 'review-score-calibration']);
    assert.ok(recs.pending.every(r => r.kind === 'threshold' && r.message && r.howToApply && r.evidence.observed >= SUGGEST_MINIMUM));
    assert.equal(recs.data.newSuggestions, 0);
    const [a, b] = recs.pending;
    await h.run('insights.approve', { id: a.id });
    await h.run('insights.reject', { id: b.id, reason: 'I prefer to keep my threshold.' });
    assert.deepEqual(await h.snapshot(), before, 'profile, config, tracker, reports, jobs and sources are byte-for-byte unchanged');
    const after = (await h.run('insights.recommendations')).result;
    assert.deepEqual([after.pending.length, after.approved.length, after.rejected.length], [0, 1, 1]);
    assert.equal(after.rejected[0].decisionReason, 'I prefer to keep my threshold.');
    assert.equal((await h.run('insights.suggest')).result.created, 0, 'a decided suggestion is not offered again for the same outcomes');
  } finally { await h.close(); }
});

test('approve, reject and defer are candidate-only: agent and MCP are refused with the Insights panel', async () => {
  const h = await harness({ jobs: sufficientJobs() });
  try {
    await h.run('insights.suggest');
    const [first, second] = (await h.run('insights.recommendations')).result.pending;
    const ledger = await h.ledgerFile();
    for (const name of ['insights.approve', 'insights.reject', 'insights.defer']) for (const actor of ['agent', 'mcp']) {
      await assert.rejects(h.run(name, { id: first.id, reason: 'x' }, { actor, confirmed: true }), e => e.code === 'candidate_only' && JSON.stringify(e.panel) === JSON.stringify({ type: 'insights' }), `${name} as ${actor}`);
    }
    assert.equal(h.app.registry.candidateOnly('insights.approve', { id: first.id }), true);
    assert.equal(await h.ledgerFile(), ledger, 'refusals change nothing');
    await assert.rejects(h.run('insights.defer', { id: first.id }), e => e.code === 'invalid_input' && /reason/.test(e.message));
    const deferred = (await h.run('insights.defer', { id: first.id, reason: 'After my next round.' })).result;
    assert.equal(deferred.status, 'deferred');
    await assert.rejects(h.run('insights.approve', { id: first.id }), /already decided/);
    const approved = (await h.run('insights.approve', { id: second.id })).result;
    assert.equal(approved.status, 'approved');
    assert.match(approved.message, /Nothing was changed/);
    await assert.rejects(h.run('insights.approve', { id: 'outcome-recommendation-missing' }), /not found/);
  } finally { await h.close(); }
});

test('a suggestion the current outcomes no longer produce cannot be approved, only rejected or deferred', async () => {
  const h = await harness({ jobs: sufficientJobs() });
  try {
    await h.run('insights.suggest');
    const floor = (await h.run('insights.recommendations')).result.pending.find(r => r.type === 'observed-positive-floor');
    await h.app.workspace.mutate(state => { state.jobs.push(syntheticJob({ score: 3.5, outcome: 'interview' })); });
    const recs = (await h.run('insights.recommendations')).result;
    assert.ok(recs.superseded.some(r => r.id === floor.id));
    assert.ok(recs.data.newSuggestions >= 1);
    await assert.rejects(h.run('insights.approve', { id: floor.id }), /outcomes changed/);
    assert.equal((await h.run('insights.reject', { id: floor.id, reason: 'Outdated.' })).result.status, 'rejected');
  } finally { await h.close(); }
});

test('agent and MCP read insights without confirmation; suggest needs the agent’s confirmed proposal', async () => {
  const h = await harness({ jobs: sufficientJobs() });
  try {
    for (const actor of ['agent', 'mcp']) for (const name of ['insights.summary', 'insights.patterns', 'insights.recommendations']) assert.ok((await h.run(name, {}, { actor })).result, `${name} as ${actor}`);
    await assert.rejects(h.run('insights.suggest', {}, { actor: 'agent' }), e => e.code === 'confirmation_required');
    assert.equal(await h.ledgerFile(), '');
    assert.equal((await h.run('insights.suggest', {}, { actor: 'agent', confirmed: true })).result.status, 'suggestions');
    const audit = await h.run('audit.list');
    assert.ok(audit.result.some(e => /insights\.suggest/.test(e.reason)), 'the agent write is audited');
  } finally { await h.close(); }
});

test('the conversational agent reads the summary in one turn with no proposal', async () => {
  const agent = scriptedAgent([
    { match: /scores/, reply: { say: '', actions: [{ name: 'insights.summary', input: {} }] } },
    { match: /scores/, reply: data => ({ say: JSON.parse(data.results.find(r => r.name === 'insights.summary').result).correlation.statement, actions: [] }) },
  ]);
  const h = await harness({ jobs: sufficientJobs(), agent });
  try {
    await h.app.workspace.mutate(s => { s.provider = 'codex'; });
    const { turnId } = await h.app.agent.message('Do my scores predict interviews?');
    await h.app.agent.running;
    const messages = (await h.app.agent.history()).messages.filter(m => m.turnId === turnId);
    assert.match(messages.at(-1).text, /Higher scores did not go with more interviews/);
    assert.ok(!messages.some(m => m.proposal), 'reads need no confirmation');
    assert.equal(agent.remaining(), 0);
  } finally { await h.close(); }
});

test('briefing: quiet with too few outcomes, speaks once a suggestion is possible, quiet again after review', async () => {
  const h = await harness({ jobs: many(5, { score: 4.2, outcome: 'rejected' }) });
  const insightItems = async () => (await h.run('workspace.digest')).result.attention.filter(a => a.kind === 'insights');
  try {
    assert.deepEqual(await insightItems(), [], 'no nagging when data is insufficient');
    await h.app.workspace.mutate(state => { state.jobs = sufficientJobs(); });
    const items = await insightItems();
    assert.equal(items.length, 1);
    assert.match(items[0].text, /20 outcomes recorded/);
    await h.run('insights.suggest');
    assert.deepEqual(await insightItems(), [], 'quiet after the review');
    await h.app.workspace.mutate(state => { state.jobs.push(syntheticJob({ score: 3.5, outcome: 'interview' })); });
    const again = await insightItems();
    assert.equal(again.length, 1);
    assert.match(again[0].text, /1 new outcome since your last insights review/);
    // An outcome that changes no suggestion stays quiet.
    await h.run('insights.suggest');
    await h.app.workspace.mutate(state => { state.jobs.push(syntheticJob({ score: 4.6, outcome: 'evaluated' })); });
    assert.deepEqual(await insightItems(), []);
  } finally { await h.close(); }
});

test('attention is pure and returns nothing for an empty or odd state', () => {
  assert.deepEqual(insights.attention({ jobs: [] }), []);
  assert.deepEqual(insights.attention({ jobs: [{ id: 'x', company: 'A', title: 'B' }], insights: { legacy: 'nope' } }), []);
});
