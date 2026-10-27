import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { agentUsage, UsageLedger } from './plainhand/usage.mjs';
import { Workspace } from './plainhand/store.mjs';
import { executeAgent } from './plainhand/agents.mjs';

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
