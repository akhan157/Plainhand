import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Workspace } from '../plainhand/store.mjs';
import { candidate } from '../plainhand/test-fixtures.mjs';
import { handleWorkspaceTransfer, MAX_TRANSFER_BYTES } from '../plainhand/cloud/workspace-transfer.mjs';
import { TransferMemory } from './helpers/transfer-memory.mjs';
import { freshDatabase, skip } from './cloud-test-db.mjs';
import { startHostedFixture } from './helpers/hosted-onboarding.mjs';
import { PostgresStorage } from '../plainhand/cloud/postgres-storage.mjs';
const db = freshDatabase();
const sample = () => ({ version: 1, profile: { ...candidate }, jobs: [{ id: 'fixture-job', company: 'Synthetic Co', title: 'Engineer', approvedHash: 'old', browserCheckpoint: { token: 'bad' }, packet: { headline: 'Draft' } }], tasks: [{ id: 'imported-task', status: 'running' }], provider: 'codex', connectionChecks: { codex: { verified: true } }, agentProposals: [{ id: 'p', status: 'pending' }], agentUsage: [{ id: randomUUID(), status: 'running' }] });
function harness(storage = new TransferMemory(), userId = 'alice') {
  const workspace = new Workspace('cloud-test', { storage });
  let clock = 1000;
  const call = (suffix, body, extra = {}) => handleWorkspaceTransfer({ url: '/api/workspace/import' + suffix, method: 'POST' }, { workspace, userId, actor: 'ui', now: () => clock, body, ...extra });
  const preview = async data => { const r = await call('/preview', { data }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const apply = (data, p, extra = {}) => call('', { data, confirm: true, previewId: p.previewId, digest: p.digest, revision: p.revision, ...extra });
  return { workspace, call, preview, apply, expire: () => { clock += 16 * 60 * 1000; } };
}
test('preview is non-destructive; confirmed replacement backs up and resets machine state', async () => {
  const h = harness(), data = sample();
  await h.workspace.mutate(s => { s.profile.name = 'Before'; });
  await h.workspace.write('data/plainhand/connection-check.json', '{"read":true}');
  await h.workspace.write('data/plainhand/checkpoints/old.json', 'old checkpoint');
  const before = await h.workspace.read(h.workspace.file), p = await h.preview(data);
  assert.equal(p.approvalsReset, 1); assert.equal(p.jobs, 1);
  assert.equal(await h.workspace.read(h.workspace.file), before);
  assert.equal((await h.apply(data, p, { confirm: false })).body.code, 'confirmation_required');
  const r = await h.apply(data, p); assert.equal(r.status, 200); assert.equal(r.body.approvalsReset, 1);
  const state = await h.workspace.load();
  assert.equal(state.profile.name, candidate.name); assert.equal(state.provider, null); assert.deepEqual(state.connectionChecks, {});
  assert.equal(state.jobs[0].approvedHash, null); assert.equal(state.jobs[0].browserCheckpoint, undefined);
  assert.equal(state.jobs[0].stage, 'needs-refresh'); assert.equal(state.tasks[0].status, 'interrupted');
  assert.equal(await h.workspace.read('data/plainhand/agent-proposals.json'), '[]');
  assert.equal(await h.workspace.read('data/plainhand/connection-check.json'), '');
  assert.deepEqual(await h.workspace.list('data/plainhand/checkpoints'), []);
  const backups = await h.workspace.list('data/plainhand/backups');
  assert.equal(await h.workspace.read('data/plainhand/backups/' + backups.find(f => f.endsWith('-import-workspace.json'))), before);
  assert.equal((await h.apply(data, p)).status, 409, 'receipt is single use');
});
test('candidate-only contract, strict JSON schema, size and unknown scope cannot redirect writes', async () => {
  const h = harness();
  for (const actor of ['mcp', 'extension', undefined]) assert.equal((await h.call('/preview', { data: sample() }, { actor })).status, 403);
  for (const data of [null, [], { version: 2, profile: {} }, { version: 1, profile: [] }, { ...sample(), tasks: ['bad'] }, { ...sample(), profile: { ...candidate, resume: {} } }, { ...sample(), contextPrefs: { excludedFields: 'all' } }]) assert.equal((await h.call('/preview', { data })).status, 400);
  assert.equal((await h.call('/preview', { data: { ...sample(), padding: 'x'.repeat(MAX_TRANSFER_BYTES) } })).status, 413);
  const data = { ...sample(), userId: 'bob', account: { userId: 'bob' }, files: { '../secret': 'bad' }, accessToken: 'bad', profile: { ...candidate, userId: 'bob', token: 'bad' } };
  const p = await h.preview(data); assert.equal((await h.apply(data, p)).status, 200);
  assert.equal((await h.workspace.load()).userId, undefined);
  assert.equal((await h.workspace.load()).profile.token, undefined);
  assert.equal(await h.workspace.read('secret'), '');
  assert.equal(await h.workspace.read('data/plainhand/chatgpt-tokens.json'), '');
  assert.equal(await handleWorkspaceTransfer({ url: '/mcp' }, {}), null);
});
test('digest, revision, expiry and cross-user receipt checks refuse replacement', async () => {
  const h = harness(), data = sample(), p = await h.preview(data);
  assert.equal((await h.apply({ ...data, jobs: [] }, p)).body.code, 'preview_mismatch');
  assert.equal((await h.apply(data, p, { revision: 900 })).status, 409);
  assert.equal((await h.call('', { data, confirm: true })).body.code, 'preview_required');
  const other = harness(); assert.equal((await other.apply(data, p)).status, 409);
  assert.equal((await h.call('', { data, confirm: true, ...p }, { userId: 'bob' })).status, 409);
  await h.workspace.mutate(s => { s.counter = 1; });
  assert.equal((await h.apply(data, p)).body.code, 'stale_workspace');
  const fresh = await h.preview(data); h.expire(); assert.equal((await h.apply(data, fresh)).body.code, 'preview_mismatch');
});
test('busy queued/running tasks and pending deferred steps block preview and apply', async () => {
  const h = harness(), data = sample(), p = await h.preview(data);
  for (const status of ['queued', 'running']) {
    await h.workspace.mutate(s => { s.tasks = [{ id: 'local', status }]; });
    assert.equal((await h.call('/preview', { data })).body.code, 'workspace_busy');
    assert.equal((await h.apply(data, p)).body.code, 'workspace_busy');
  }
  await h.workspace.mutate(s => { s.tasks = []; });
  await h.workspace.write('data/plainhand/steps/deferred.json', JSON.stringify({ status: 'running', pending: { stepId: 's0' } }));
  assert.equal((await h.call('/preview', { data })).body.code, 'workspace_busy');
  assert.equal((await h.apply(data, p)).body.code, 'workspace_busy');
});
test('concurrent apply and mutation serialize; one exact preview applies once', async () => {
  const h = harness(), data = sample(), p = await h.preview(data);
  const results = await Promise.all([h.apply(data, p), h.apply(data, p)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const p2 = await h.preview(data);
  const competing = new Workspace('another-instance', { storage: h.workspace.storage });
  await competing.mutate(s => { s.profile.name = 'Newer'; });
  assert.equal((await h.apply(data, p2)).body.code, 'stale_workspace');
});
test('Postgres transaction is reentrant, atomic on quota failure, and scoped per candidate', { skip, timeout: 20000 }, async () => {
  const a = randomUUID(), b = randomUUID();
  for (const id of [a, b]) await db.sql`insert into plainhand.accounts (user_id, email) values (${id}, ${id + '@example.invalid'})`;
  const storage = new PostgresStorage(db.sql, a), h = harness(storage, a), other = harness(new PostgresStorage(db.sql, b), b), data = sample();
  await h.workspace.mutate(s => { s.profile.name = 'Original'; });
  await other.workspace.mutate(s => { s.profile.name = 'Other candidate'; });
  const p = await h.preview({ ...data, userId: b });
  assert.equal((await h.apply({ ...data, userId: b }, p)).status, 200);
  assert.equal((await other.workspace.load()).profile.name, 'Other candidate');
  assert.equal((await h.call('/preview', { data }, { userId: b })).status, 403);
  const p2 = await h.preview(data), before = await h.workspace.read(h.workspace.file);
  storage.quotaBytes = (await storage.usage()).bytes + 10;
  assert.equal((await h.apply(data, p2)).body.code, 'storage_full');
  assert.equal(await h.workspace.read(h.workspace.file), before);
  storage.quotaBytes = 25 * 1024 * 1024;
  const competitor = harness(new PostgresStorage(db.sql, a), a);
  const results = await Promise.all([h.apply(data, p2), competitor.apply(data, p2)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
});

test('real website mount requires its own session and CSRF; other accounts cannot use preview receipts', async () => {
  const app = await startHostedFixture({ transfer: true });
  try {
    const route = '/api/workspace/import', data = sample();
    assert.equal((await app.request(route + '/preview', { user: 'unknown', data: { data } })).status, 401);
    assert.equal((await app.request(route + '/preview', { csrf: app.token('bob'), data: { data } })).status, 403);
    const foreign = await fetch(app.base + route + '/preview', { method: 'POST', headers: { cookie: '__Host-plainhand_session=alice', origin: 'https://other.invalid', 'x-plainhand-token': app.token('alice'), 'content-type': 'application/json' }, body: JSON.stringify({ data }) });
    assert.equal(foreign.status, 403);
    const previewResponse = await app.request(route + '/preview', { data: { data } });
    assert.equal(previewResponse.status, 200);
    const receipt = await previewResponse.json();
    const payload = { data, confirm: true, previewId: receipt.previewId, digest: receipt.digest, revision: receipt.revision };
    assert.equal((await app.request(route, { user: 'bob', data: payload })).status, 409);
    assert.equal((await app.request(route, { data: payload })).status, 200);
    assert.equal((await app.workspaces.get('alice').load()).profile.name, candidate.name);
    assert.equal((await app.workspaces.get('bob').load()).profile.name, '');
  } finally { await app.close(); }
});
