// Sign in with ChatGPT: Responses API agent, encrypted token store, and the local
// app's sign-in routes. Everything runs against a fake fetch; no real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../plainhand/store.mjs';
import { MemoryStorage } from '../plainhand/storage.mjs';
import { AGENT_PREAMBLE, executeAgent } from '../plainhand/agents.mjs';
import {
  createChatgptAgent, createTokenStore, TOKEN_FILE, PLAN_LIMIT_MESSAGE, SIGN_IN_AGAIN_MESSAGE, CHATGPT_TOKEN_URL, CHATGPT_RESPONSES_URL,
  CHATGPT_MODELS_URL, CHATGPT_OPENID_CONFIGURATION_URL, CHATGPT_RESOURCE,
} from '../plainhand/cloud/chatgpt-agent.mjs';
import { verifyIdToken, SECRET_KEY_FILE, CLIENT_FILE } from '../plainhand/chatgpt-local.mjs';
import { createPlainhand } from '../plainhand-server.mjs';
import { fixtureProviders } from '../plainhand/test-fixtures.mjs';

const KEY = Buffer.alloc(32, 7);
const FORBIDDEN = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id', 'tools'];
const memoryWorkspace = () => new Workspace('memory', { storage: new MemoryStorage() });
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = events => new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const usageBlock = { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 150 };
// A reply in the recorded Responses streaming format, split into text deltas.
const replyStream = (deltas, extra = []) => sse([
  { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', model: 'gpt-test' } },
  ...deltas.map((delta, i) => ({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta, sequence_number: i + 1 })),
  ...extra,
  { type: 'response.completed', response: { id: 'resp_1', status: 'completed', model: 'gpt-test', usage: usageBlock, output: [{ type: 'message', content: [{ type: 'output_text', text: deltas.join('') }] }] } },
]);
const models = () => jsonResponse(200, { models: [{ slug: 'hidden-model', visibility: 'hide' }, { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }] });

function fakeTokens(sequence = ['access-1', 'access-2']) {
  const calls = [];
  return { calls, async get(options = {}) { calls.push(options); return sequence[Math.min(calls.length - 1, sequence.length - 1)]; } };
}

test('the request follows the preview rules: store false, stream true, instructions, full input, no forbidden fields', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    if (url === CHATGPT_MODELS_URL) return models();
    return replyStream(['{"ok":', 'true}']);
  };
  const agent = createChatgptAgent({ tokens: fakeTokens(), fetchImpl });
  const result = await agent('chatgpt', 'Return {"ok":true}.', { job: 'Example' });
  assert.deepEqual(result, { ok: true });
  const call = seen.find(c => c.url === CHATGPT_RESPONSES_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer access-1');
  const body = JSON.parse(call.init.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'gpt-test', 'first listed model');
  assert.equal(body.instructions, AGENT_PREAMBLE);
  assert.ok(body.instructions.includes('Never submit an application.'));
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].role, 'user');
  assert.ok(body.input[0].content.includes('TASK:\nReturn {"ok":true}.'));
  assert.ok(body.input[0].content.includes('INPUT DATA:\n{"job":"Example"}'));
  assert.ok(!body.input.some(item => item.role === 'system'));
  for (const field of FORBIDDEN) assert.ok(!(field in body), `${field} must not be sent`);
  // A configured model skips the listing.
  seen.length = 0;
  await createChatgptAgent({ tokens: fakeTokens(), fetchImpl, model: 'chosen-model' })('chatgpt', 'x', {});
  assert.ok(!seen.some(c => c.url === CHATGPT_MODELS_URL));
  assert.equal(JSON.parse(seen[0].init.body).model, 'chosen-model');
});

test('streams the say field, parses the JSON reply and reports usage', async () => {
  const fetchImpl = async url => url === CHATGPT_MODELS_URL ? models() : replyStream(['```json\n{"say":"Hel', 'lo \\"there\\"', '","proposals":[]}\n```']);
  const deltas = [];
  let usage;
  const result = await createChatgptAgent({ tokens: fakeTokens(), fetchImpl })('chatgpt', 'Act', {}, { onText: text => deltas.push(text), onUsage: value => { usage = value; } });
  assert.deepEqual(result, { say: 'Hello "there"', proposals: [] });
  assert.equal(deltas.join(''), 'Hello "there"');
  assert.ok(deltas.length >= 2, 'text arrives in pieces');
  assert.equal(usage.inputTokens, 120);
  assert.equal(usage.cacheReadTokens, 20);
  assert.equal(usage.uncachedInputTokens, 100);
  assert.equal(usage.outputTokens, 30);
  assert.equal(usage.reasoningTokens, 8);
  assert.deepEqual(usage.models, ['gpt-test']);
});

test('SSE parsing copes with events split across chunks and CRLF line endings', async () => {
  const text = ['{"ok":', 'true}'].map((delta, i) => `event: response.output_text.delta\r\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta, sequence_number: i })}\r\n\r\n`).join('')
    + `: keep-alive\n\nevent: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { usage: usageBlock, model: 'gpt-test' } })}\n\n`;
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
  const result = await createChatgptAgent({ tokens: fakeTokens(), fetchImpl: async () => new Response(body, { status: 200 }), model: 'm' })('chatgpt', 'x', {});
  assert.deepEqual(result, { ok: true });
});

test('a stream that ends without response.completed is an error, not a result', async () => {
  const fetchImpl = async () => sse([{ type: 'response.output_text.delta', delta: '{"ok":true}' }]);
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl, model: 'm' })('chatgpt', 'x', {}), /ended early/);
  const incomplete = async () => sse([{ type: 'response.incomplete', response: { status: 'incomplete' } }]);
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: incomplete, model: 'm' })('chatgpt', 'x', {}), /stopped before finishing/);
});

test('plan limit and usage turned off map to the plain plan-limit message, before or during the stream', async () => {
  let usage;
  const admission = async () => jsonResponse(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } });
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: admission, model: 'm' })('chatgpt', 'x', {}, { onUsage: u => { usage = u; } }), { message: PLAN_LIMIT_MESSAGE });
  assert.equal(usage.inputTokens, null, 'usage is still reported (as unknown) on failure');
  const midStream = async () => sse([{ type: 'response.output_text.delta', delta: '{"ok"' }, { type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded' }, usage: usageBlock } }]);
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: midStream, model: 'm' })('chatgpt', 'x', {}, { onUsage: u => { usage = u; } }), { message: PLAN_LIMIT_MESSAGE });
  assert.equal(usage.inputTokens, 120);
  const unavailable = async () => jsonResponse(503, { error: { code: 'subscription_sharing_usage_unavailable' } });
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: unavailable, model: 'm' })('chatgpt', 'x', {}), /busy right now/);
  const notEligible = async () => jsonResponse(403, { error: { code: 'subscription_sharing_user_not_eligible' } });
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: notEligible, model: 'm' })('chatgpt', 'x', {}), /Plus and Pro/);
});

test('a 401 refreshes once and retries; a second 401 asks the candidate to sign in again', async () => {
  const tokens = fakeTokens();
  const auth = [];
  const once = async (url, init) => { auth.push(init.headers.Authorization); return auth.length === 1 ? jsonResponse(401, { detail: 'expired' }) : replyStream(['{"ok":true}']); };
  assert.deepEqual(await createChatgptAgent({ tokens, fetchImpl: once, model: 'm' })('chatgpt', 'x', {}), { ok: true });
  assert.deepEqual(auth, ['Bearer access-1', 'Bearer access-2']);
  assert.deepEqual(tokens.calls, [{}, { forceRefresh: true }]);
  const always = async () => jsonResponse(401, { detail: 'no' });
  await assert.rejects(createChatgptAgent({ tokens: fakeTokens(), fetchImpl: always, model: 'm' })('chatgpt', 'x', {}), { message: SIGN_IN_AGAIN_MESSAGE });
});

test('token store: encrypted at rest, round trip, tamper detection, wrong key', async () => {
  const workspace = memoryWorkspace();
  const store = createTokenStore({ workspace, key: KEY, fetchImpl: async () => assert.fail('no refresh while fresh') });
  await store.save({ accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token', expiresAt: Date.now() + 3600000, clientId: 'oaiapp_x', email: 'a@example.invalid' });
  const raw = await workspace.read(TOKEN_FILE);
  assert.ok(!raw.includes('secret-access-token') && !raw.includes('secret-refresh-token') && !raw.includes('a@example.invalid'));
  assert.equal(await store.get(), 'secret-access-token');
  assert.deepEqual((await store.info()).email, 'a@example.invalid');
  assert.ok(!JSON.stringify(await store.info()).includes('secret-'), 'info never carries tokens');
  // Tampering with the ciphertext fails authentication.
  const sealed = JSON.parse(raw);
  const data = Buffer.from(sealed.data, 'base64'); data[0] ^= 1;
  await workspace.write(TOKEN_FILE, JSON.stringify({ ...sealed, data: data.toString('base64') }));
  await assert.rejects(store.get(), { message: SIGN_IN_AGAIN_MESSAGE });
  await workspace.write(TOKEN_FILE, raw);
  await assert.rejects(createTokenStore({ workspace, key: Buffer.alloc(32, 9) }).get(), { message: SIGN_IN_AGAIN_MESSAGE });
  assert.throws(() => createTokenStore({ workspace, key: Buffer.alloc(16) }), /32 bytes/);
  await store.clear();
  assert.equal(await workspace.read(TOKEN_FILE), '');
  await assert.rejects(store.get(), /Sign in with ChatGPT/);
});

test('token store refreshes under five minutes left, rotates the refresh token, and serializes concurrent refreshes', async () => {
  const workspace = memoryWorkspace();
  let clock = 1_000_000_000_000, refreshes = 0;
  const bodies = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, CHATGPT_TOKEN_URL);
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    bodies.push(Object.fromEntries(new URLSearchParams(init.body)));
    refreshes++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return jsonResponse(200, { access_token: `access-${refreshes + 1}`, refresh_token: `refresh-${refreshes + 1}`, expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct', token_type: 'Bearer' });
  };
  const store = createTokenStore({ workspace, key: KEY, fetchImpl, now: () => clock });
  await store.save({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: clock + 3600000, clientId: 'oaiapp_x' });
  clock += 54 * 60000; // six minutes left: still fresh
  assert.equal(await store.get(), 'access-1');
  clock += 2 * 60000; // four minutes left: refresh
  const [a, b] = await Promise.all([store.get(), store.get()]);
  assert.equal(refreshes, 1, 'one refresh for concurrent callers');
  assert.equal(a, 'access-2'); assert.equal(b, 'access-2');
  assert.deepEqual(bodies[0], { grant_type: 'refresh_token', client_id: 'oaiapp_x', refresh_token: 'refresh-1', resource: CHATGPT_RESOURCE });
  assert.equal(bodies[0].scope, undefined, 'scope omitted to keep the grant');
  assert.equal(await store.get({ forceRefresh: true }), 'access-3');
  assert.equal(bodies[1].refresh_token, 'refresh-2', 'rotated refresh token used');
});

test('token store: an unusable refresh token clears the sign-in; a temporary failure keeps it', async () => {
  const workspace = memoryWorkspace();
  let status = 503;
  const fetchImpl = async () => status === 503 ? jsonResponse(503, {}) : jsonResponse(400, { error: 'invalid_grant' });
  const store = createTokenStore({ workspace, key: KEY, fetchImpl });
  await store.save({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000, clientId: 'oaiapp_x' });
  await assert.rejects(store.get(), /busy/);
  assert.ok(await workspace.read(TOKEN_FILE), 'kept after a temporary failure');
  status = 400;
  await assert.rejects(store.get(), { message: SIGN_IN_AGAIN_MESSAGE });
  assert.equal(await workspace.read(TOKEN_FILE), '', 'cleared after invalid_grant');
});

test('executeAgent dispatches chatgpt to the supplied agent and explains when not signed in', async () => {
  await assert.rejects(executeAgent('chatgpt', 'x', {}), /Sign in with ChatGPT/);
  const seen = [];
  const result = await executeAgent('chatgpt', 'x', { a: 1 }, { chatgpt: async (...args) => { seen.push(args); return { ok: true }; }, onText: () => {} });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen[0][0], 'chatgpt');
  assert.equal(typeof seen[0][3].onText, 'function');
});

// --- Local app sign-in --------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function idToken(claims) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${part(claims)}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')}`;
}

test('ID token validation checks signature, issuer, audience, expiry and nonce', () => {
  const claims = { iss: 'https://auth.openai.com', aud: 'oaiapp_x', sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 300, nonce: 'n1' };
  const options = { issuer: 'https://auth.openai.com', audience: 'oaiapp_x', nonce: 'n1' };
  assert.equal(verifyIdToken(idToken(claims), { keys: [JWK] }, options).sub, 'user-1');
  assert.throws(() => verifyIdToken(idToken({ ...claims, nonce: 'other' }), { keys: [JWK] }, options));
  assert.throws(() => verifyIdToken(idToken({ ...claims, aud: 'oaiapp_other' }), { keys: [JWK] }, options));
  assert.throws(() => verifyIdToken(idToken({ ...claims, iss: 'https://evil.example' }), { keys: [JWK] }, options));
  assert.throws(() => verifyIdToken(idToken({ ...claims, exp: 1000 }), { keys: [JWK] }, options));
  const forged = idToken(claims).split('.'); forged[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'user-2' })).toString('base64url');
  assert.throws(() => verifyIdToken(forged.join('.'), { keys: [JWK] }, options));
});

function fakeOpenAI() {
  const calls = [], state = { authorize: null, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', revoked: [] };
  async function fetchImpl(url, init = {}) {
    calls.push(url);
    if (url === CHATGPT_OPENID_CONFIGURATION_URL) return jsonResponse(200, { issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/oauth/revoke' });
    if (url === 'https://auth.openai.com/.well-known/jwks.json') return jsonResponse(200, { keys: [JWK] });
    if (url === 'https://auth.openai.com/oauth/revoke') { state.revoked.push(Object.fromEntries(new URLSearchParams(init.body))); return new Response('', { status: 200 }); }
    if (url === CHATGPT_TOKEN_URL) {
      const form = Object.fromEntries(new URLSearchParams(init.body));
      const a = state.authorize;
      // PKCE: the verifier must hash to the challenge sent with the authorize request.
      const challenge = createHash('sha256').update(form.code_verifier || '').digest('base64url');
      if (form.grant_type !== 'authorization_code' || form.code !== 'good-code' || challenge !== a.get('code_challenge') || form.redirect_uri !== a.get('redirect_uri') || form.client_id !== 'oaiapp_test' || form.resource !== CHATGPT_RESOURCE) return jsonResponse(400, { error: 'invalid_grant' });
      return jsonResponse(200, { access_token: 'local-access', refresh_token: 'local-refresh', id_token: idToken({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'user-1', email: 'candidate@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600, nonce: a.get('nonce') }), expires_in: 3600, token_type: 'Bearer', scope: state.scope });
    }
    if (url === CHATGPT_MODELS_URL) return models();
    if (url === CHATGPT_RESPONSES_URL) { assert.equal(init.headers.Authorization, 'Bearer local-access'); return replyStream(['{"ok":true}']); }
    throw new Error('unexpected ' + url);
  }
  return { fetchImpl, calls, state };
}

test('local sign-in route: authorize URL, state check, PKCE exchange, encrypted storage, check, sign-out', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-chatgpt-'));
  const openai = fakeOpenAI();
  const app = await createPlainhand({ root, providers: async () => [{ id: 'chatgpt', name: 'ChatGPT', installed: true, auth: 'sign-in-needed' }, ...await fixtureProviders()], startFeatures: false, chatgptOptions: { fetchImpl: openai.fetchImpl, port: 0 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const started = await request('providers/chatgpt/signin', {});
    assert.equal(started.status, 202);
    const authorize = new URL(started.data.url);
    openai.state.authorize = authorize.searchParams;
    const p = authorize.searchParams;
    assert.equal(authorize.origin + authorize.pathname, 'https://auth.openai.com/api/accounts/authorize');
    assert.equal(p.get('client_id'), 'dynamic_agent_client');
    assert.equal(p.get('agent_name_hint'), 'Plainhand');
    assert.match(p.get('ext_agent_host_id'), /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('scope'), 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
    assert.equal(p.get('resource'), 'https://api.openai.com/v1');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.match(p.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.ok(p.get('state').length >= 32 && p.get('nonce').length >= 32 && p.get('state') !== p.get('nonce'));
    const redirect = new URL(p.get('redirect_uri'));
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(redirect.pathname, '/auth/callback');
    assert.equal((await request('providers/chatgpt/status')).data.status, 'waiting');

    // A callback with the wrong state is refused and does not end the attempt or exchange a code.
    const forged = await fetch(`${redirect.href}?code=good-code&state=wrong&client_id=oaiapp_test`)
    assert.equal(forged.status, 400);
    assert.ok(!openai.calls.includes(CHATGPT_TOKEN_URL));
    assert.equal((await request('providers/chatgpt/status')).data.status, 'waiting');

    const done = await fetch(`${redirect.href}?code=good-code&state=${encodeURIComponent(p.get('state'))}&scope=${encodeURIComponent(p.get('scope'))}&client_id=oaiapp_test`)
    assert.equal(done.status, 200);
    assert.match(await done.text(), /using your ChatGPT plan/);
    const status = (await request('providers/chatgpt/status')).data;
    assert.equal(status.status, 'signed-in', JSON.stringify(status));
    assert.equal(status.email, 'candidate@example.invalid');
    const listed = (await request('providers')).data.find(x => x.id === 'chatgpt');
    assert.equal(listed.auth, 'signed-in');

    // Stored encrypted with an owner-only key; the client registration is kept for next time.
    const tokenFile = await readFile(path.join(root, TOKEN_FILE), 'utf8');
    assert.ok(!tokenFile.includes('local-access') && !tokenFile.includes('local-refresh'));
    assert.equal((await stat(path.join(root, SECRET_KEY_FILE))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(root, TOKEN_FILE))).mode & 0o777, 0o600);
    const client = JSON.parse(await readFile(path.join(root, CLIENT_FILE), 'utf8'));
    assert.equal(client.clientId, 'oaiapp_test');
    assert.equal(client.hostId, p.get('ext_agent_host_id'));

    // The callback listener is one-shot: it is closed after the sign-in finishes.
    await assert.rejects(fetch(`${redirect.href}?state=x`));

    // Check and use runs one Responses call with the stored token.
    const check = await request('provider/test', { id: 'chatgpt' });
    assert.equal(check.status, 200, JSON.stringify(check.data));
    const state = await app.workspace.load();
    assert.equal(state.provider, 'chatgpt');
    assert.ok(state.connectionChecks.chatgpt.verifiedAt);

    // A later sign-in reuses the issued client id and host id, and rejects a different client id.
    const again = new URL((await request('providers/chatgpt/signin', {})).data.url);
    assert.equal(again.searchParams.get('client_id'), 'oaiapp_test');
    assert.equal(again.searchParams.get('agent_name_hint'), null);
    assert.equal(again.searchParams.get('ext_agent_host_id'), p.get('ext_agent_host_id'));
    const other = await fetch(`${again.searchParams.get('redirect_uri')}?code=good-code&state=${encodeURIComponent(again.searchParams.get('state'))}&client_id=oaiapp_other`);
    assert.match(await other.text(), /different app registration/);
    assert.equal((await request('providers/chatgpt/status')).data.status, 'signed-in', 'the earlier sign-in is kept');

    // Sign-out revokes the refresh token at OpenAI and deletes the stored tokens.
    const out = await request('providers/chatgpt/signout', {});
    assert.equal(out.status, 200);
    assert.equal(out.data.message, 'Signed out of ChatGPT.');
    assert.deepEqual(openai.state.revoked, [{ token: 'local-refresh', token_type_hint: 'refresh_token', client_id: 'oaiapp_test' }]);
    await assert.rejects(stat(path.join(root, TOKEN_FILE)));
    assert.equal((await request('providers/chatgpt/status')).data.status, 'signed-out');
    assert.equal((await app.workspace.load()).provider, null);
    const failed = await request('provider/test', { id: 'chatgpt' });
    assert.equal(failed.status, 400);
    assert.match(failed.data.error, /Sign in with ChatGPT/);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('local sign-in: cancelled consent and missing plan permission do not save tokens', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-chatgpt-'));
  const openai = fakeOpenAI();
  const app = await createPlainhand({ root, providers: fixtureProviders, startFeatures: false, chatgptOptions: { fetchImpl: openai.fetchImpl, port: 0 } });
  try {
    let url = new URL((await app.chatgpt.start()).url);
    let redirect = url.searchParams.get('redirect_uri');
    await fetch(`${redirect}?error=access_denied&state=${encodeURIComponent(url.searchParams.get('state'))}`);
    assert.deepEqual(await app.chatgpt.status(), { status: 'failed', message: 'You cancelled the ChatGPT sign-in.' });
    assert.ok(!openai.calls.includes(CHATGPT_TOKEN_URL), 'no code exchange after access_denied');

    openai.state.scope = 'openid profile email offline_access';
    url = new URL((await app.chatgpt.start()).url);
    openai.state.authorize = url.searchParams;
    redirect = url.searchParams.get('redirect_uri');
    await fetch(`${redirect}?code=good-code&state=${encodeURIComponent(url.searchParams.get('state'))}&client_id=oaiapp_test`);
    const status = await app.chatgpt.status();
    assert.equal(status.status, 'failed');
    assert.match(status.message, /did not allow Plainhand to use your ChatGPT plan/);
    await assert.rejects(stat(path.join(root, TOKEN_FILE)));
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
