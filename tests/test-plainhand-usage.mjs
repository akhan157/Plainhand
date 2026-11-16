import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { agentUsage, UsageLedger, taskPromptChars } from '../plainhand/usage.mjs';
import { Workspace } from '../plainhand/store.mjs';
import { executeAgent, agentTask } from '../plainhand/agents.mjs';

test('Claude usage normalizes cache tokens once; USD remains a reported reference value', () => {
  const u = agentUsage('claude', JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 40, cache_creation_input_tokens: 20 }, total_cost_usd: 0.012, modelUsage: { 'test-model': {} }, result: '{"ok":true}' }));
  assert.equal(u.inputTokens, 70); assert.equal(u.outputTokens, 7); assert.equal(u.cacheReadTokens, 40); assert.equal(u.reportedUsd, 0.012); assert.deepEqual(u.models, ['test-model']);
  assert.equal(agentUsage('claude', '{"usage":{"input_tokens":1234}}').inputTokens, null, 'Model-written prose is not provider telemetry.');
  assert.equal(agentUsage('antigravity', '{"usage":{"input_tokens":1234}}').inputTokens, null);
});

test('Codex totals completed turns and does not add cached or reasoning tokens twice', () => {
  const result = agentUsage('codex', [{ type: 'thread.started', thread_id: 'not-stored' }, { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5 } }, { type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 3 } }].map(e => JSON.stringify(e)).join('\n'));
  assert.equal(result.inputTokens, 150); assert.equal(result.outputTokens, 30); assert.equal(result.cacheReadTokens, 120); assert.equal(result.reasoningTokens, 8); assert.equal(result.cacheWriteTokens, null);
  assert.equal(agentUsage('codex', '{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}').inputTokens, 0);
});

test('CLI reports telemetry even when its result is malformed; Codex requests JSON events', async () => {
  let usage;
  await assert.rejects(executeAgent('claude', 'Return ok', {}, { onUsage: u => usage = u, runner: async () => ({ stdout: JSON.stringify({ type: 'result', usage: { input_tokens: 12, output_tokens: 3 }, result: 'invalid JSON' }) }) }), /unreadable/);
  assert.equal(usage.uncachedInputTokens, 12);
  assert.equal(usage.inputTokens, null, 'Missing cache counters cannot be assumed zero in a total.');
  await executeAgent('codex', 'Return ok', {}, { runner: async (command, args) => { assert.ok(args.includes('--json')); return { stdout: '{"ok":true}' }; } });
});

test('ledger preserves concurrent, failed and unreported calls without candidate payloads or zero estimates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-usage-')), workspace = new Workspace(root), ledger = new UsageLedger(workspace);
  try {
    await Promise.all([
      ledger.track(async (p, i, d, o) => { o.onUsage({ inputTokens: 70, outputTokens: 8, cacheReadTokens: 60, reportedUsd: 0, models: ['test-model'] }); return { ok: true }; }, 'claude', 'PRIVATE PROMPT', { private: 'PRIVATE CANDIDATE' }, { usageContext: { jobId: 'job-one', purpose: 'prepare' } }),
      ledger.track(async () => ({ ok: true }), 'antigravity', 'PRIVATE PROMPT', {}),
      assert.rejects(ledger.track(async () => { throw Error('PRIVATE ERROR'); }, 'codex', '', {}, { usageContext: { jobId: 'job-one', purpose: 'review', attempt: 2 } })),
    ]);
    const summary = await ledger.summary({ jobs: [] });
    assert.equal(summary.totals.calls, 3); assert.equal(summary.totals.failed, 1); assert.equal(summary.totals.inputTokens.value, 70); assert.equal(summary.totals.inputTokens.reportedCalls, 1); assert.equal(summary.byJob[0].calls, 2);
    assert.equal(summary.byProvider.find(p => p.id === 'antigravity').inputTokens.value, null);
    assert.equal(JSON.stringify(summary).includes('PRIVATE'), false);
    const record = (await ledger.records())[0];
    assert.equal((await stat(await workspace.safe(ledger.file(record.id)))).mode & 0o777, 0o600);
    assert.equal((await readFile(await workspace.safe(ledger.file(record.id)), 'utf8')).includes('PRIVATE'), false);
    assert.equal((await new UsageLedger(workspace).summary({ jobs: [] })).totals.calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// The exact event shape codex-cli 0.167.1 was observed to emit on `exec --json`:
// thread.started carries a thread_id, turn.completed carries usage, and neither names a
// model. Recorded here so a future CLI that starts naming one is visible in the diff.
const codexEvents = (usage = { input_tokens: 100, cached_input_tokens: 80, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5 }) => [
  { type: 'thread.started', thread_id: '01a1e1a9-a1d0-7c73-8392-fe3ed083342c' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: '{"ok":true}' } },
  { type: 'turn.completed', usage },
].map(event => JSON.stringify(event)).join('\n');

test('Codex usage keeps cached and reasoning tokens and the prompt length, and records no model it did not state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-usage-')), workspace = new Workspace(root), ledger = new UsageLedger(workspace);
  try {
    const instruction = 'Evaluate this job against the candidate evidence.';
    const data = { job: { title: 'Synthetic role' }, sources: [{ id: 'cv', text: 'Candidate evidence line.' }] };
    const expected = agentTask(instruction, data).length;
    assert.equal(taskPromptChars(instruction, data), expected, 'the recorded length is the prompt Plainhand sends');
    await ledger.track(async (p, i, d, o) => { o.onUsage(agentUsage('codex', codexEvents())); return { ok: true }; }, 'codex', instruction, data);
    const summary = await ledger.summary({ jobs: [] });
    assert.equal(summary.totals.calls, 1);
    assert.equal(summary.totals.cacheReadTokens.value, 80, 'cached input survives the summary');
    assert.equal(summary.totals.reasoningTokens.value, 5, 'reasoning tokens survive the summary');
    assert.equal(summary.totals.inputTokens.value, 100);
    assert.equal(summary.totals.outputTokens.value, 20);
    assert.equal(summary.totals.promptChars.value, expected, 'the summary sums the characters Plainhand sent');
    assert.deepEqual(summary.totals.models, [], 'the CLI stated no model');
    assert.equal(summary.totals.actualModel, null, 'no model is assumed from the CLI default');
    const [record] = await ledger.records();
    assert.equal(record.promptChars, expected);
    assert.equal(record.actualModel, null);
    const stored = await readFile(await workspace.safe(ledger.file(record.id)), 'utf8');
    assert.equal(stored.includes('Candidate evidence line'), false, 'the ledger stores the prompt length, never its text');
    assert.equal(stored.includes('Synthetic role'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a provider that states its model is recorded per call; several or none stay unresolved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-usage-')), workspace = new Workspace(root), ledger = new UsageLedger(workspace);
  try {
    const stated = agentUsage('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 2, output_tokens: 1, reasoning_output_tokens: 0 }, model: 'reported-model-a' }));
    assert.deepEqual(stated.models, ['reported-model-a']);
    await ledger.track(async (p, i, d, o) => { o.onUsage(stated); return { ok: true }; }, 'codex', 'x', {});
    let summary = await ledger.summary({ jobs: [] });
    assert.equal(summary.totals.actualModel, 'reported-model-a');
    assert.equal((await ledger.records())[0].actualModel, 'reported-model-a');
    // A second call on another model: the run has no single model, so none is claimed.
    await ledger.track(async (p, i, d, o) => { o.onUsage(agentUsage('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 1 }, model: 'reported-model-b' }))); return { ok: true }; }, 'codex', 'x', {});
    summary = await ledger.summary({ jobs: [] });
    assert.deepEqual(summary.totals.models, ['reported-model-a', 'reported-model-b']);
    assert.equal(summary.totals.actualModel, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('interrupted calls recover without inventing duration or token usage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-usage-')), workspace = new Workspace(root), ledger = new UsageLedger(workspace);
  try {
    const id = '00000000-0000-0000-0000-000000000000';
    await workspace.write(ledger.file(id), JSON.stringify({ id, startedAt: new Date().toISOString(), status: 'running', provider: 'claude', inputTokens: null }));
    await ledger.recover();
    const [record] = await ledger.records();
    assert.equal(record.status, 'interrupted'); assert.equal(record.durationMs, null); assert.equal(record.inputTokens, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
