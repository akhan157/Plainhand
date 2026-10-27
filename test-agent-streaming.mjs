import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeAgent, partialSay } from './plainhand/agents.mjs';
import { agentUsage } from './plainhand/usage.mjs';
import { createPlainhand } from './plainhand-server.mjs';
import { candidate, fixtureProviders } from './plainhand/test-fixtures.mjs';

// Shape of `claude -p --output-format stream-json --verbose --include-partial-messages`.
function claudeStream(replyText) {
  const pieces = replyText.match(/.{1,7}/gs);
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's', tools: [] },
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    ...pieces.map(text => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })),
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } },
    { type: 'result', subtype: 'success', is_error: false, result: replyText, usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 }, total_cost_usd: 0.001, modelUsage: { 'test-model': {} } },
  ];
  return lines.map(line => JSON.stringify(line)).join('\n') + '\n';
}
const fakeRunner = (stdout, seen) => async (command, args, options) => {
  seen.args = args;
  // Deliver in awkward chunks that split lines and escapes.
  for (let i = 0; i < stdout.length; i += 13) options.onOutput?.(stdout.slice(i, i + 13));
  return { stdout, stderr: '', code: 0 };
};

test('partialSay decodes the visible text of an incomplete JSON reply', () => {
  assert.equal(partialSay('{"say": "Hel'), 'Hel');
  assert.equal(partialSay('{"actions":[],"say":"a\\nb\\"c'), 'a\nb"c');
  assert.equal(partialSay('{"say":"caf\\u00'), 'caf', 'an incomplete escape waits for the rest');
  assert.equal(partialSay('{"say":"caf\\u00e9"}'), 'café');
  assert.equal(partialSay('{"actions":[]'), '');
});

test('Claude replies stream "say" deltas and still return the parsed result and usage', async () => {
  const reply = JSON.stringify({ say: 'You have two follow-ups: Acme "today" and Bolt\nnext week.', actions: [{ name: 'workspace.digest', input: {} }] });
  const stdout = claudeStream(reply);
  const seen = {}, deltas = [];
  let usage;
  const result = await executeAgent('claude', 'Act as the conversational assistant', { message: 'hi' }, { runner: fakeRunner(stdout, seen), onText: text => deltas.push(text), onUsage: value => { usage = value; } });
  assert.deepEqual(result, JSON.parse(reply));
  assert.equal(deltas.join(''), JSON.parse(reply).say);
  assert.ok(deltas.length > 3, 'text arrives in several pieces');
  assert.ok(seen.args.includes('stream-json') && seen.args.includes('--include-partial-messages') && seen.args.includes('--verbose'));
  assert.ok(seen.args.includes('--tools') && seen.args[seen.args.indexOf('--tools') + 1] === '', 'tools stay off when streaming');
  assert.deepEqual([usage.inputTokens, usage.outputTokens, usage.cacheReadTokens], [17, 7, 5]);
  assert.deepEqual(agentUsage('claude', stdout).models, ['test-model']);
});

test('without onText the Claude call keeps the single json format; other providers never stream', async () => {
  const reply = JSON.stringify({ say: 'ok', actions: [] });
  const seen = {};
  const envelope = JSON.stringify({ type: 'result', is_error: false, result: reply });
  await executeAgent('claude', 'x', {}, { runner: fakeRunner(envelope, seen) });
  assert.deepEqual(seen.args.slice(0, 3), ['-p', '--output-format', 'json']);
  const codexSeen = {};
  await executeAgent('codex', 'x', {}, { runner: fakeRunner(reply, codexSeen), onText: () => assert.fail('codex does not stream') });
  assert.ok(!codexSeen.args.includes('stream-json'));
});

test('a stream without a result envelope fails clearly', async () => {
  const broken = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"say":"half' } } }) + '\n';
  await assert.rejects(executeAgent('claude', 'x', {}, { runner: fakeRunner(broken, {}), onText: () => {} }), /ended without a result/);
});

test('the agent engine forwards streamed text as agent.delta events before the final message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-stream-'));
  const agent = async (id, instruction, data, options) => {
    for (const piece of ['Two ', 'follow-ups ', 'today.']) options.onText?.(piece);
    return { say: 'Two follow-ups today.', actions: [] };
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent } });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    await app.workspace.mutate(state => { Object.assign(state.profile, candidate); state.provider = 'claude'; });
    const events = [];
    const original = app.agent.emit;
    app.agent.emit = (event, data) => { events.push({ event, data }); original(event, data); };
    const { turnId } = await app.agent.message('anything due?');
    await app.agent.running;
    const mine = events.filter(e => e.data.turnId === turnId);
    assert.equal(mine.filter(e => e.event === 'agent.delta').map(e => e.data.text).join(''), 'Two follow-ups today.');
    const order = mine.map(e => e.event);
    assert.ok(order.lastIndexOf('agent.delta') < order.findLastIndex(e => e === 'agent.message'), 'deltas precede the final message');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
