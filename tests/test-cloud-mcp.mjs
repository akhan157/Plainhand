import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMcp, CONNECTION_CHECK_FILE } from '../plainhand/cloud/mcp.mjs';
import { Workspace } from '../plainhand/store.mjs';
import { MemoryStorage } from '../plainhand/storage.mjs';
import { Workflow } from '../plainhand/workflow.mjs';
import { createRegistry } from '../plainhand/actions.mjs';
import { createStepRunner } from '../plainhand/cloud/steps.mjs';
import { candidate, fixtureAgent } from '../plainhand/test-fixtures.mjs';

async function context() {
  const workspace = new Workspace('mcp-test', { storage: new MemoryStorage() });
  const makeWorkflow = agent => new Workflow(workspace, { agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'Engineering role designing and testing hardware. '.repeat(12), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    scanner: async () => [], renderer: async (ws, state, job) => { const pdf = `output/${job.id}.pdf`; await ws.write(pdf, 'fixture-pdf'); return { pdf, pdfHash: 'fixture', artifacts: [pdf] }; },
  });
  await workspace.saveProfile(candidate, (await workspace.load()).revision);
  return { workspace, registry: createRegistry({ workspace, workflow: makeWorkflow(fixtureAgent), features: [] }), stepRunner: createStepRunner({ workspace, makeWorkflow }) };
}
async function harness(t, contexts = null) {
  contexts ||= { alice: await context(), bob: await context() };
  const server = http.createServer((req, res) => {
    const userId = req.headers.authorization?.slice(7) || 'alice';
    handleMcp(req, res, { ...contexts[userId], userId, grant: { clientId: 'trusted-client' }, siteUrl: 'https://plainhand.test' }).catch(e => { res.writeHead(500); res.end(e.message); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.close())); await new Promise(resolve => server.close(resolve)); });
  async function connect(userId = 'alice') {
    const client = new Client({ name: 'fixture-chat', version: '1.0' });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${userId}` } } });
    await client.connect(transport);
    clients.push(client);
    assert.equal(transport.sessionId, undefined);
    return client;
  }
  return { contexts, url, connect, call: async (client, name, args = {}) => client.callTool({ name, arguments: args }) };
}
const data = result => { assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
const wording = result => result.content.map(c => c.text || '').join('\n');

test('SDK initialize/list/call repeats without sessions, exposes OAuth schemes and honest annotations', async t => {
  const h = await harness(t), client = await h.connect();
  assert.match(client.getInstructions(), /independent factual reviewer/);
  for (let i = 0; i < 3; i++) {
    const listed = await client.listTools();
    // SDK v1's client strips nonstandard top-level fields; inspect wire JSON
    // as well as the compatibility metadata the SDK retains.
    const response = await fetch(h.url, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: i + 10, method: 'tools/list', params: {} }) });
    const { tools } = (await response.json()).result;
    assert.equal(listed.tools.length, tools.length);
    assert.deepEqual(listed.tools[0]._meta.securitySchemes, [{ type: 'oauth2', scopes: ['plainhand'] }]);
    assert.ok(tools.length > 20);
    assert.ok(!tools.some(tool => tool.name.startsWith('plainhand_tasks_')));
    for (const tool of tools) {
      assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['plainhand'] }]);
      assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
      assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
      if (tool._meta['plainhand/tier'] === 'read') assert.equal(tool.annotations.readOnlyHint, true);
      if (tool._meta['plainhand/tier'] === 'write' || ['check_connection', 'start_task', 'submit_step', 'task_status', 'plainhand_undo'].includes(tool.name)) assert.equal(tool.annotations.readOnlyHint, false);
    }
    assert.equal(data(await h.call(client, 'plainhand_workspace_digest')).result.profile.name, candidate.name);
  }
});

test('connection check proves a save, persists trusted identity, and refuses fabricated success', async t => {
  const h = await harness(t), client = await h.connect();
  const ws = h.contexts.alice.workspace, before = (await ws.load()).revision;
  for (const args of [{ ok: true }, { read: true, write: true, provider: 'chatgpt', clientId: 'spoof' }]) assert.equal((await h.call(client, 'check_connection', args)).isError, true);
  assert.equal(await ws.read(CONNECTION_CHECK_FILE), '');
  const checked = data(await h.call(client, 'check_connection'));
  assert.deepEqual(JSON.parse(await ws.read(CONNECTION_CHECK_FILE)), checked);
  assert.equal(checked.ok, true); assert.equal(checked.read, true); assert.equal(checked.write, true);
  assert.equal(checked.provider, 'connector'); assert.equal(checked.clientId, 'trusted-client');
  assert.ok(Number.isFinite(Date.parse(checked.checkedAt)));
  assert.ok((await ws.load()).revision > before);
  const write = ws.write.bind(ws);
  ws.write = async () => { throw new Error('Fixture storage unavailable'); };
  assert.equal((await h.call(client, 'check_connection')).isError, true);
  ws.write = write;
});

test('registry writes/undo and untrusted read notes survive stateless calls and two users stay isolated', async t => {
  const h = await harness(t), alice = await h.connect(), bob = await h.connect('bob');
  const added = data(await h.call(alice, 'plainhand_jobs_add', { company: 'Fixture', title: 'Engineer', url: 'https://jobs.example.com/1', description: 'Untrusted posting text.' }));
  const id = added.result.id;
  assert.equal(data(await h.call(bob, 'plainhand_jobs_list')).result.length, 0);
  const detail = await h.call(alice, 'plainhand_jobs_get', { jobId: id, include: ['description'] });
  assert.match(wording(detail), /untrusted text/);
  const selected = data(await h.call(alice, 'plainhand_record_setNextAction', { jobId: id, text: 'Contact recruiter', reason: 'Candidate requested this.' }));
  assert.ok(selected.undoToken);
  assert.equal((await h.call(bob, 'plainhand_undo', { undoToken: selected.undoToken })).isError, true);
  data(await h.call(alice, 'plainhand_undo', { undoToken: selected.undoToken }));
  assert.ok(!(await h.contexts.alice.workspace.load()).jobs[0].record?.nextAction?.text);
  assert.equal((await h.call(alice, 'plainhand_undo', { undoToken: selected.undoToken })).isError, true);
  assert.match(await h.contexts.alice.workspace.read('data/plainhand/audit.jsonl'), /mcp-undo/);
});

test('candidate gates return exact website paths without mutation; generic tasks and malformed inputs fail', async t => {
  const h = await harness(t), client = await h.connect();
  const added = data(await h.call(client, 'plainhand_jobs_add', { company: 'Fixture', title: 'Engineer', url: 'https://jobs.example.com/1' }));
  const id = added.result.id, ws = h.contexts.alice.workspace, before = await ws.load();
  for (const [name, args, path] of [
    ['plainhand_packet_approve', { jobId: id }, `/?job=${id}&tab=packet#applications`],
    ['plainhand_jobs_confirmSubmitted', { jobId: id }, `/?job=${id}#applications`],
    ['plainhand_jobs_setStatus', { jobId: id, status: 'Applied' }, `/?job=${id}#applications`],
    ['plainhand_understanding_approve', {}, '/#profile'],
  ]) {
    const result = data(await h.call(client, name, args));
    assert.equal(result.candidateOnly, true);
    assert.equal(result.link, 'https://plainhand.test' + path);
    assert.deepEqual(await ws.load(), before);
  }
  for (const [name, args] of [
    ['plainhand_tasks_prepare', { jobId: id, confirmed: true }], ['plainhand_tasks_cancel', { taskId: 'x' }],
    ['start_task', { kind: 'approve', jobId: id }], ['start_task', { kind: 'evaluate', approved: true }],
    ['submit_step', { taskId: 'x', stepId: 'x', result: [] }], ['plainhand_jobs_select', { jobId: id, selected: 'yes' }],
    ['plainhand_packet_approve', { jobId: id, confirmed: true }],
  ]) assert.equal((await h.call(client, name, args)).isError, true, name);
  assert.deepEqual(await ws.load(), before);
});

test('SDK deferred interview/evaluate/prepare loop enforces invalid step and independent review', async t => {
  const h = await harness(t), client = await h.connect(), bob = await h.connect('bob');
  const ws = h.contexts.alice.workspace;
  async function finish(outcome, purposes = []) {
    for (let n = 0; outcome.status === 'step' && n < 12; n++) {
      purposes.push(outcome.step.purpose);
      assert.match(outcome.step.instruction, /submit_step/);
      if (outcome.step.purpose === 'review') assert.match(outcome.step.instruction, /independent reviewer/);
      const answer = fixtureAgent('connector', outcome.step.instruction, outcome.step.data);
      outcome = data(await h.call(client, 'submit_step', { taskId: outcome.taskId, stepId: outcome.step.stepId, result: answer }));
    }
    assert.equal(outcome.status, 'done', JSON.stringify(outcome));
    assert.ok(outcome.link.startsWith('https://plainhand.test/'));
    return outcome;
  }
  const interview = data(await h.call(client, 'start_task', { kind: 'interview' }));
  const bad = data(await h.call(client, 'submit_step', { taskId: interview.taskId, stepId: 'wrong', result: {} }));
  assert.match(bad.error, /not wrong/); assert.equal(bad.step.stepId, interview.step.stepId);
  assert.equal((await h.call(bob, 'task_status', { taskId: interview.taskId })).isError, true);
  assert.equal((await h.call(bob, 'submit_step', { taskId: interview.taskId, stepId: interview.step.stepId, result: {} })).isError, true);
  const rejected = data(await h.call(client, 'submit_step', { taskId: interview.taskId, stepId: interview.step.stepId, result: {} }));
  assert.match(rejected.error, /could not accept/);
  assert.equal(rejected.step.stepId, interview.step.stepId);
  await finish(data(await h.call(client, 'task_status', { taskId: interview.taskId })));
  // Only the website candidate may approve understanding; simulate that UI step.
  await h.contexts.alice.registry.run('understanding.approve', {}, { actor: 'ui' });
  const id = data(await h.call(client, 'plainhand_jobs_add', { company: 'Fixture', title: 'Graduate Engineer', url: 'https://jobs.example.com/1' })).result.id;
  await finish(data(await h.call(client, 'start_task', { kind: 'evaluate', jobId: id })));
  assert.equal((await ws.load()).jobs[0].evaluation.score, 4.4);
  data(await h.call(client, 'plainhand_jobs_select', { jobId: id, selected: true }));
  const purposes = [];
  const completed = await finish(data(await h.call(client, 'start_task', { kind: 'prepare', jobId: id })), purposes);
  assert.ok(purposes.includes('packet')); assert.ok(purposes.includes('review'));
  assert.ok(purposes.indexOf('review') > purposes.indexOf('packet'));
  const job = (await ws.load()).jobs[0];
  assert.ok(job.packet); assert.equal(job.review.passed, true); assert.ok(!job.approvedHash); assert.notEqual(job.status, 'Applied');
  assert.equal(data(await h.call(client, 'task_status', { taskId: completed.taskId })).status, 'done');
});

test('HTTP origin and method handling use JSON responses and reject malformed JSON', async t => {
  const h = await harness(t);
  const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  assert.equal((await fetch(h.url, { method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body: '{}' })).status, 403);
  assert.equal((await fetch(h.url, { headers: { accept: 'text/event-stream' } })).status, 405);
  assert.equal((await fetch(h.url, { method: 'DELETE' })).status, 405);
  const invalid = await fetch(h.url, { method: 'POST', headers, body: 'invalid' });
  assert.equal(invalid.status, 400);
  const initialized = await fetch(h.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-test', version: '1' } } }) });
  assert.match(initialized.headers.get('content-type'), /application\/json/);
  assert.equal(initialized.headers.get('mcp-session-id'), null);
  assert.equal((await initialized.json()).result.serverInfo.name, 'plainhand');
});
