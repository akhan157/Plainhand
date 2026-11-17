// U14: quota efficiency. The CLI request Plainhand builds carries no coding-agent
// scaffolding, an unchanged evaluation is not sent twice, and the optional folded
// humanizer keeps the independent review but drops the separate rewrite call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest, Workspace } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { EVALUATE_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION, PACKET_INSTRUCTION, codexExecArgs, CLI_INSTRUCTIONS } from '../plainhand/agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../plainhand/humanize.mjs';
import { AgentCache, AGENT_CACHE_VERSION } from '../plainhand/agent-cache.mjs';
import { foldedHumanize } from '../plainhand/workflow.mjs';

const LONG_DESCRIPTION = 'This is an engineering role designing and testing hardware. '.repeat(10);

test('the codex argv replaces the CLI prompt, tools and context without user config', () => {
  const args = codexExecArgs({ resultFile: '/tmp/result.json', instructionsFile: '/tmp/plainhand agent/instructions.txt' });
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--ignore-user-config'), 'the user config stays ignored');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  const text = args.join('\n');
  assert.ok(text.includes('model_instructions_file="/tmp/plainhand agent/instructions.txt"'), 'the temp instructions file is a TOML string');
  for (const setting of ['skills.include_instructions=false', 'include_environment_context=false', 'include_permissions_instructions=false', 'include_collaboration_mode_instructions=false', 'features.multi_agent=false', 'features.goals=false', 'features.view_image=false', 'tools.experimental_request_user_input.enabled=false', 'project_doc_max_bytes=0']) {
    assert.ok(text.includes(setting), `missing ${setting}`);
  }
  assert.ok(!text.includes('features.exec_tool'), 'the unrecognized exec_tool flag is gone');
  assert.ok(args.at(-1) === '-', 'the prompt still comes on stdin');
  assert.ok(CLI_INSTRUCTIONS.length > 0 && CLI_INSTRUCTIONS.length < 2000, 'the replacement system text is small');
});

test('the agent cache key covers everything the call sees and only round-trips its own version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u14-cache-'));
  try {
    const cache = new AgentCache(new Workspace(root));
    const base = { provider: 'codex', instruction: 'Do the thing.', data: { context: { hash: 'a' }, job: { title: 'Engineer' } } };
    const key = cache.key(base);
    assert.equal(key, cache.key({ ...base, data: { context: { hash: 'a' }, job: { title: 'Engineer' } } }), 'the same call hashes the same');
    assert.notEqual(key, cache.key({ ...base, provider: 'claude' }), 'a provider change is a different call');
    assert.notEqual(key, cache.key({ ...base, instruction: 'Do the other thing.' }), 'an instruction change is a different call');
    assert.notEqual(key, cache.key({ ...base, data: { context: { hash: 'b' }, job: { title: 'Engineer' } } }), 'a context change is a different call');
    assert.notEqual(key, cache.key({ ...base, data: { context: { hash: 'a' }, job: { title: 'Manager' } } }), 'a job change is a different call');
    assert.equal(await cache.get(key), null);
    await cache.put(key, { provider: 'codex', purpose: 'evaluate', result: { score: 4.4 } });
    assert.deepEqual(await cache.get(key), { score: 4.4 });
    assert.equal((await cache.get(cache.key({ ...base, provider: 'claude' }))), null, 'a different key never reads this entry');
    // An entry from an older cache shape is ignored, not replayed.
    await new Workspace(root).write(cache.file(key), JSON.stringify({ version: AGENT_CACHE_VERSION + 1, key, result: { score: 1 } }));
    assert.equal(await cache.get(key), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function harness(base = fixtureAgent) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u14-'));
  const calls = [];
  const agent = async (id, instruction, data, options) => { calls.push({ id, instruction, data }); return base(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent,
    verifier: async job => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description || LONG_DESCRIPTION, checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; } } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 8; i++) await app.workflow.queue; };
  const runTask = async (kind, input = {}) => { await ui(`tasks.${kind}`, input); await settle(); return (await app.workspace.load()).tasks[0]; };
  const addJob = async () => (await ui('jobs.add', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/u14-' + calls.length + '-' + Date.now() })).result.id;
  return { app, ui, settle, runTask, addJob, calls, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('re-evaluating an unchanged job reuses the stored evaluation; a profile or job change calls again', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    const evaluations = () => h.calls.filter(c => c.instruction === EVALUATE_INSTRUCTION).length;
    let task = await h.runTask('evaluate', { jobId });
    assert.equal(task.status, 'complete', task.message);
    assert.equal(evaluations(), 1);
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    assert.equal(evaluations(), 1, 'identical input makes no provider call');
    await h.app.workspace.mutate(s => { s.profile.story += ' I also ran the brake test rig.'; });
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    assert.equal(evaluations(), 2, 'a changed profile misses the cache');
    await h.app.workspace.mutate(s => { s.jobs.find(j => j.id === jobId).description = LONG_DESCRIPTION + ' Now with more tolerance analysis.'; });
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    assert.equal(evaluations(), 3, 'a changed job misses the cache');
  } finally { await h.close(); }
});

test('a failed evaluation is never cached, so the retry reaches the provider', async () => {
  let first = true;
  const h = await harness((id, instruction, data, options) => first && instruction === EVALUATE_INSTRUCTION
    ? (first = false, { score: 9, recommendation: 'Apply', summary: 'Invalid on purpose.', matches: [], gaps: [], questions: [], legitimacyNotes: [] })
    : fixtureAgent(id, instruction, data, options));
  try {
    const jobId = await h.addJob();
    const evaluations = () => h.calls.filter(c => c.instruction === EVALUATE_INSTRUCTION).length;
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'failed');
    assert.equal(evaluations(), 1);
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    assert.equal(evaluations(), 2, 'the invalid reply was not stored');
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    assert.equal(evaluations(), 2, 'the validated reply is reused');
  } finally { await h.close(); }
});

test('folded master drafting carries the humanizer rules and still gets an independent review', async () => {
  const h = await harness();
  try {
    await h.app.workspace.mutate(s => { s.settings = { ...(s.settings || {}), foldHumanize: true }; });
    const before = h.calls.length;
    assert.equal((await h.runTask('standard')).status, 'complete');
    const calls = h.calls.slice(before);
    assert.equal(calls.filter(c => c.instruction === HUMANIZE_INSTRUCTION).length, 0, 'no separate rewrite call');
    const draft = calls.find(c => c.instruction === STANDARD_INSTRUCTION);
    assert.equal(draft.data.humanizeRules, HUMANIZE_INSTRUCTION, 'the drafting input carries the full rules');
    const reviewIndex = calls.findIndex(c => c.instruction === REVIEW_INSTRUCTION);
    assert.ok(reviewIndex > calls.indexOf(draft), 'review runs after drafting, independently');
    const standard = (await h.app.workspace.load()).standard;
    assert.equal(standard.humanizer.folded, true);
    assert.equal(typeof standard.humanizer.tellsAfter.length, 'number');
    assert.equal(standard.humanizer.kept.length, 0);
  } finally { await h.close(); }
});

test('folded packet drafting drops one call, keeps review, and the old path is still available', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    await h.ui('jobs.select', { jobId, selected: true });
    await h.app.workspace.mutate(s => { s.settings = { ...(s.settings || {}), foldHumanize: true }; });
    let before = h.calls.length;
    assert.equal((await h.runTask('prepare', { jobId })).status, 'complete');
    let calls = h.calls.slice(before);
    assert.equal(calls.filter(c => c.instruction === HUMANIZE_INSTRUCTION).length, 0);
    const packet = calls.find(c => c.instruction === PACKET_INSTRUCTION);
    assert.equal(packet.data.humanizeRules, HUMANIZE_INSTRUCTION);
    assert.ok(calls.some(c => c.instruction === REVIEW_INSTRUCTION), 'review is still independent and separate');
    let job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.humanizer.folded, true);
    // The default path keeps the separate pass and the before/after validation.
    await h.app.workspace.mutate(s => { s.settings.foldHumanize = false; });
    before = h.calls.length;
    assert.equal((await h.runTask('revise', { jobId, request: 'Make the cover letter shorter.' })).status, 'complete');
    calls = h.calls.slice(before);
    const humanize = calls.find(c => c.instruction === HUMANIZE_INSTRUCTION);
    assert.ok(humanize, 'the old path still rewrites separately');
    assert.deepEqual(humanize.data.items.map(i => i.id), ['resume:0', 'resume:1', 'cover', 'answer:0']);
    job = (await h.app.workspace.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.humanizer.folded, undefined);
  } finally { await h.close(); }
});

test('the fold switch reads the setting and the harness override', () => {
  const saved = process.env.PLAINHAND_FOLD_HUMANIZE;
  try {
    delete process.env.PLAINHAND_FOLD_HUMANIZE;
    assert.equal(foldedHumanize({}), false);
    assert.equal(foldedHumanize({ settings: { foldHumanize: true } }), true);
    process.env.PLAINHAND_FOLD_HUMANIZE = '1';
    assert.equal(foldedHumanize({ settings: { foldHumanize: false } }), true);
    process.env.PLAINHAND_FOLD_HUMANIZE = '0';
    assert.equal(foldedHumanize({ settings: { foldHumanize: true } }), false);
  } finally {
    if (saved === undefined) delete process.env.PLAINHAND_FOLD_HUMANIZE;
    else process.env.PLAINHAND_FOLD_HUMANIZE = saved;
  }
});

test('both drafting instructions say what to do with INPUT.humanizeRules in folded mode', async () => {
  const { PACKET_INSTRUCTION, STANDARD_INSTRUCTION } = await import('../plainhand/agents.mjs');
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) assert.match(instruction, /When INPUT\.humanizeRules is present, apply those rules/);
});

// U14: a live application rose from 5 to 7.7-8 calls because one extra
// prepare+humanize+review cycle ran, and the saved evidence could not say why.
// The packet record now carries the purpose and attempt of every call.
test('the packet record logs each call by purpose and attempt', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    await h.ui('jobs.select', { jobId, selected: true });
    assert.equal((await h.runTask('prepare', { jobId })).status, 'complete');
    const job = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.deepEqual(job.callLog.map(entry => [entry.purpose, entry.attempt]), [
      ['evaluate', 1], ['prepare', 1], ['humanize', 1], ['review', 1],
    ]);
    assert.deepEqual(job.packet.callLog, job.callLog, 'the runner saves the packet, so the log rides on it');
    assert.deepEqual(JSON.parse(await h.app.workspace.read(`output/packet-${jobId}.json`)).callLog, job.callLog);
  } finally { await h.close(); }
});

test('a review issue that clearly targets a suggestion drops the note instead of redrafting', async () => {
  let packets = 0, reviews = 0;
  const h = await harness((id, instruction, data, options) => {
    if (instruction === PACKET_INSTRUCTION) {
      packets++;
      return { ...fixtureAgent(id, instruction, data, options), suggestions: ['Add the SOC 2 audit to the resume.'] };
    }
    if (instruction === REVIEW_INSTRUCTION) {
      reviews++;
      return { passed: false, issues: ['The suggestion about the SOC 2 audit is not supported by the sources.'] };
    }
    return fixtureAgent(id, instruction, data, options);
  });
  try {
    const jobId = await h.addJob();
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    await h.ui('jobs.select', { jobId, selected: true });
    const before = h.calls.length;
    const task = await h.runTask('prepare', { jobId });
    assert.equal(task.status, 'complete', task.message);
    assert.equal(packets, 1, 'no second draft');
    assert.equal(reviews, 1, 'no second review');
    assert.equal(h.calls.length - before, 3, 'packet, humanize and review only');
    const job = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.deepEqual(job.packet.suggestions, [], 'the note was dropped');
    assert.equal(job.review.passed, true);
    assert.equal(job.review.resolved.kind, 'dropped-suggestions');
    assert.match(job.review.resolved.reviewerIssues[0], /SOC 2/);
    assert.deepEqual(job.callLog.filter(entry => entry.attempt > 1), [], 'the log shows one attempt');
  } finally { await h.close(); }
});

test('a factual review issue still redrafts, and the log shows the second attempt', async () => {
  let packets = 0, reviews = 0;
  const h = await harness((id, instruction, data, options) => {
    if (instruction === PACKET_INSTRUCTION) { packets++; return fixtureAgent(id, instruction, data, options); }
    if (instruction === REVIEW_INSTRUCTION) {
      reviews++;
      return reviews === 1
        ? { passed: false, issues: ['The resume states a certification the sources do not mention.'] }
        : fixtureAgent(id, instruction, data, options);
    }
    return fixtureAgent(id, instruction, data, options);
  });
  try {
    const jobId = await h.addJob();
    assert.equal((await h.runTask('evaluate', { jobId })).status, 'complete');
    await h.ui('jobs.select', { jobId, selected: true });
    const task = await h.runTask('prepare', { jobId });
    assert.equal(task.status, 'complete', task.message);
    assert.equal(packets, 2, 'a document-fact issue still gets a full redraft');
    assert.equal(reviews, 2);
    const job = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.equal(job.review.passed, true);
    assert.equal(job.review.resolved, undefined, 'only notes are resolved without review');
    assert.deepEqual(job.callLog.filter(entry => entry.attempt === 2).map(entry => entry.purpose), ['prepare', 'humanize', 'review']);
  } finally { await h.close(); }
});

test('the Claude model and effort come from PLAINHAND_CLAUDE_MODEL and PLAINHAND_CLAUDE_EFFORT', async () => {
  const { claudeModelArgs } = await import('../plainhand/agents.mjs');
  assert.deepEqual(claudeModelArgs({ PLAINHAND_CLAUDE_MODEL: 'sonnet', PLAINHAND_CLAUDE_EFFORT: 'medium' }), ['--model', 'sonnet', '--effort', 'medium']);
  assert.deepEqual(claudeModelArgs({}), []);
  assert.deepEqual(claudeModelArgs({ PLAINHAND_CLAUDE_MODEL: 'sonnet; rm -rf', PLAINHAND_CLAUDE_EFFORT: 'turbo' }), []);
});

test('a JSON reply wrapped in prose or a fenced block is still read; prose alone is not', async () => {
  const { parseAgentJson } = await import('../plainhand/agents.mjs');
  const envelope = result => JSON.stringify({ type: 'result', result });
  assert.deepEqual(parseAgentJson(envelope('Here is the reply:\n```json\n{"say":"Hi {there}","actions":[]}\n```\nThanks.')), { say: 'Hi {there}', actions: [] });
  assert.deepEqual(parseAgentJson(envelope('{"a":1}')), { a: 1 });
  assert.throws(() => parseAgentJson(envelope('no json here')), /unreadable result/);
});

test('review fdff850: the output cap is 2 MB unless the caller asks for more, whatever onOutput is', async () => {
  const { runProcess } = await import('../plainhand/agents.mjs');
  const big = ['-c', "head -c 2100000 /dev/zero | tr '\\0' 'a'"];
  await assert.rejects(runProcess('sh', big, { onOutput: () => {} }), /exceeded the limit/);
  const out = await runProcess('sh', big, { onOutput: () => {}, maxOutput: 8000000 });
  assert.equal(String(out.stdout ?? out).length >= 2100000, true);
});
