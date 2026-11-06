// Production composition, real OAuth token verification and Postgres workspaces.
// Tokens/accounts are synthetic and exist only in cloud-test-db's disposable database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAccounts } from '../plainhand/cloud/accounts.mjs';
import { candidate, fixtureAgent } from '../plainhand/test-fixtures.mjs';
import { CONNECTION_CHECK_FILE } from '../plainhand/cloud/mcp.mjs';
import { freshDatabase, skip, URL_BASE } from './cloud-test-db.mjs';

const db = freshDatabase(), SITE = 'https://plainhand.test';
async function start(t) {
  const [{ name }] = await db.sql`select current_database() as name`;
  const url = new URL(URL_BASE); url.pathname = '/' + name;
  const env = { DATABASE_URL: url.href, SITE_URL: SITE, SESSION_SECRET: 'fixture-session-secret-'.repeat(3), SUPABASE_URL: 'https://unused.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'fixture', PLAINHAND_EXTENSION_IDS: 'a'.repeat(32) };
  // A child scopes the production pool lifecycle to this test. Its process env is
  // intentionally different from buildHandler's explicit settings.
  const script = `import http from 'node:http';
    import { buildHandler } from './api/index.mjs';
    process.env.PLAINHAND_EXTENSION_IDS = 'b'.repeat(32);
    const handler = await buildHandler(JSON.parse(process.argv[1]));
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(env)], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  const port = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', code => reject(new Error(`Production handler exited (${code}): ${stderr}`))); });
  const base = `http://127.0.0.1:${port}`;
  return { base, accounts: createAccounts({ sql: db.sql }) };
}
async function issueToken(accounts, resource, { userId = randomUUID(), clientId = 'fixture-' + randomUUID() } = {}) {
  await accounts.upsert({ userId, email: userId + '@example.invalid' });
  const grantId = randomUUID(), token = 'pha_' + randomUUID();
  await db.sql`insert into plainhand.oauth_clients (client_id, client_name, redirect_uris, metadata) values (${clientId}, 'Fixture chat', ${['https://example.invalid/callback']}, ${db.sql.json({ token_endpoint_auth_method: 'none' })})`;
  await db.sql`insert into plainhand.oauth_grants (id, user_id, client_id, scope) values (${grantId}, ${userId}, ${clientId}, 'plainhand')`;
  await db.sql`insert into plainhand.oauth_tokens (token_hash, grant_id, kind, resource, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${grantId}, 'access', ${resource}, ${new Date(Date.now() + 600000)})`;
  return { token, userId, clientId, grantId };
}
async function connect(t, base, token) {
  const client = new Client({ name: 'endpoint-fixture', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + token } } }));
  return client;
}

test('production endpoint challenges unauthenticated clients and rejects crossed audiences with real OAuth/Postgres', { skip }, async t => {
  const { base, accounts } = await start(t);
  const chat = await issueToken(accounts, SITE + '/mcp');
  const extension = await issueToken(accounts, SITE + '/api/extension');
  const metadata = await (await fetch(base + '/.well-known/oauth-protected-resource')).json();
  assert.equal(metadata.resource, SITE + '/mcp');
  for (const token of [null, 'invalid', extension.token]) {
    const res = await fetch(base + '/mcp', { method: 'POST', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource"`);
  }
  const crossed = await fetch(base + '/api/extension/submitted', { method: 'POST', headers: { authorization: 'Bearer ' + chat.token, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(crossed.status, 401);
  assert.match(crossed.headers.get('www-authenticate'), /oauth-protected-resource\/api\/extension/);
  // The production handler must pass the explicit env extension-id allowlist.
  for (const id of ['a'.repeat(32), 'b'.repeat(32)]) {
    const res = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Fixture extension', redirect_uris: [`https://${id}.chromiumapp.org/`], token_endpoint_auth_method: 'none' }) });
    assert.equal(res.status, 201);
    const registered = await res.json();
    const query = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: registered.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: SITE + '/api/extension' });
    const authorize = await fetch(base + '/oauth/authorize?' + query, { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    if (id.startsWith('a')) assert.ok(authorize.headers.get('location').startsWith('/signin?'));
    else assert.equal(new URL(authorize.headers.get('location')).searchParams.get('error'), 'invalid_target');
  }
  const client = await connect(t, base, chat.token);
  const listed = await client.listTools(); assert.ok(listed.tools.some(tool => tool.name === 'start_task'));
  const checked = await client.callTool({ name: 'check_connection', arguments: {} });
  assert.ok(!checked.isError, JSON.stringify(checked));
  assert.equal(checked.structuredContent.clientId, chat.clientId);
  assert.equal(checked.structuredContent.write, true);
  assert.deepEqual(JSON.parse(await accounts.workspaceFor(chat.userId).read(CONNECTION_CHECK_FILE)), checked.structuredContent);
  // The actual app mount wires its deferred runner, without any provider token.
  const invalid = await client.callTool({ name: 'start_task', arguments: { kind: 'evaluate' } });
  assert.equal(invalid.isError, true); assert.match(invalid.content[0].text, /Say which role/);
  const workspace = accounts.workspaceFor(chat.userId);
  await workspace.saveProfile(candidate, (await workspace.load()).revision);
  const step = await client.callTool({ name: 'start_task', arguments: { kind: 'interview' } });
  assert.equal(step.structuredContent.status, 'step');
  const { taskId, step: pending } = step.structuredContent;
  const result = fixtureAgent('connector', pending.instruction, pending.data);
  const done = await client.callTool({ name: 'submit_step', arguments: { taskId, stepId: pending.stepId, result } });
  assert.equal(done.structuredContent.status, 'done', JSON.stringify(done));
  assert.ok((await workspace.load()).understanding);
  await db.sql`update plainhand.oauth_grants set revoked_at = now() where id = ${chat.grantId}`;
  const revoked = await fetch(base + '/mcp', { headers: { authorization: 'Bearer ' + chat.token } });
  assert.equal(revoked.status, 401);
});

test('production stateless calls isolate two Postgres users, including connection checks and undo', { skip }, async t => {
  const { base, accounts } = await start(t);
  const alice = await issueToken(accounts, SITE + '/mcp'), bob = await issueToken(accounts, SITE + '/mcp');
  const a = await connect(t, base, alice.token), b = await connect(t, base, bob.token);
  const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
  await Promise.all([call(a, 'check_connection'), call(b, 'check_connection')]);
  for (const user of [alice, bob]) assert.equal(JSON.parse(await accounts.workspaceFor(user.userId).read(CONNECTION_CHECK_FILE)).clientId, user.clientId);
  const added = await call(a, 'plainhand_jobs_add', { company: 'Only Alice', title: 'Engineer', url: 'https://jobs.example.invalid/alice' });
  assert.ok(!added.isError, JSON.stringify(added));
  const id = added.structuredContent.result.id;
  assert.equal((await call(b, 'plainhand_jobs_list')).structuredContent.result.length, 0);
  assert.equal((await call(b, 'plainhand_jobs_get', { jobId: id })).isError, true);
  const write = await call(a, 'plainhand_record_setNextAction', { jobId: id, text: 'Review the posting' });
  assert.ok(write.structuredContent.undoToken);
  assert.equal((await call(b, 'plainhand_undo', { undoToken: write.structuredContent.undoToken })).isError, true);
  assert.ok(!(await call(a, 'plainhand_undo', { undoToken: write.structuredContent.undoToken })).isError);
  assert.equal((await call(a, 'plainhand_jobs_list')).structuredContent.result.length, 1);
});
