// OAuth server tests (plainhand/cloud/oauth.mjs). Runs against a real Postgres when
// PLAINHAND_TEST_DATABASE_URL is set, e.g.
//   docker run -d --rm --name plainhand-pg -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:17
//   PLAINHAND_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54329/postgres node --test tests/test-cloud-oauth.mjs
// Each run uses a fresh database. No network: requests go straight to handle() and
// Client ID Metadata Documents come from a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from '../plainhand/cloud/postgres-storage.mjs';
import { createOAuthServer, unauthorized, redirectMatches, validRedirectUri } from '../plainhand/cloud/oauth.mjs';

const URL_BASE = process.env.PLAINHAND_TEST_DATABASE_URL;
const skip = URL_BASE ? false : 'set PLAINHAND_TEST_DATABASE_URL to run';
const ISSUER = 'https://plainhand.test';
const RESOURCE = 'https://plainhand.test/mcp';
const COOKIE = '__Host-plainhand_oauth';
const CHATGPT_CIMD = 'https://chatgpt.example/oauth/client.json';
const CHATGPT_REDIRECT = 'https://chatgpt.example/connector_platform_oauth_redirect';

let admin, sql, dbName;
let clock = Date.parse('2026-11-05T12:00:00Z');
const advance = seconds => { clock += seconds * 1000; };
const sessionUser = req => req.headers['x-test-user'] || null;
const fetchCalls = [];
const documents = new Map();
async function fakeFetch(url, options) {
  fetchCalls.push(url);
  assert.ok(options.signal, 'CIMD fetch must have a timeout signal');
  assert.equal(options.redirect, 'error');
  const doc = documents.get(url);
  if (!doc) return new Response('not found', { status: 404 });
  if (typeof doc === 'string') return new Response(doc, { status: 200 });
  return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } });
}
// Fake DNS: every CIMD host is public unless listed here (no real lookups in tests).
const dnsAnswers = new Map();
const fakeLookup = async host => dnsAnswers.get(host) || [{ address: '93.184.216.34', family: 4 }];
const makeServer = (extra = {}) => createOAuthServer({ sql, issuer: ISSUER, resource: RESOURCE, sessionUser, now: () => new Date(clock), fetchImpl: fakeFetch, lookupImpl: fakeLookup, ...extra });
let server;

test.before(async () => {
  if (skip) return;
  admin = connect(URL_BASE, { max: 1 });
  dbName = 'plainhand_test_' + randomUUID().replace(/-/g, '').slice(0, 12);
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(URL_BASE); url.pathname = '/' + dbName;
  sql = connect(url.toString(), { max: 6 });
  const schema = await readFile(new URL('../plainhand/cloud/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
  await sql.unsafe(schema); // idempotent
  server = makeServer({ limits: { registrationsPerIpPerHour: 1000 } });
  documents.set(CHATGPT_CIMD, {
    client_id: CHATGPT_CIMD, client_name: 'ChatGPT', redirect_uris: [CHATGPT_REDIRECT],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], token_endpoint_auth_method: 'private_key_jwt',
  });
});
test.after(async () => {
  if (skip) return;
  await sql?.end();
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

async function account() {
  const id = randomUUID();
  await sql`insert into plainhand.accounts (user_id, email) values (${id}, ${id + '@example.com'})`;
  return id;
}

async function call({ method = 'GET', url, headers = {}, form, json, target = server, ip = '203.0.113.7' }) {
  let data = '';
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (form) { data = new URLSearchParams(form).toString(); h['content-type'] ??= 'application/x-www-form-urlencoded'; }
  if (json) { data = JSON.stringify(json); h['content-type'] = 'application/json'; }
  const req = Readable.from(data ? [Buffer.from(data)] : []);
  Object.assign(req, { method, url, headers: { 'x-forwarded-for': ip, ...h }, socket: { remoteAddress: '127.0.0.1' } });
  const res = {
    status: 0, headers: {}, body: '',
    writeHead(status, headersIn = {}) { this.status = status; for (const [k, v] of Object.entries(headersIn)) this.headers[k.toLowerCase()] = v; },
    end(body = '') { this.body = String(body); },
  };
  const handled = await target.handle(req, res);
  return { handled, status: res.status, headers: res.headers, body: res.body, json: () => JSON.parse(res.body) };
}

const verifierPair = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };

async function registerPublic(redirect = 'https://claude.example/api/mcp/auth_callback', name = 'Claude', ip) {
  const res = await call({ method: 'POST', url: '/oauth/register', json: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }, ip });
  assert.equal(res.status, 201, res.body);
  return res.json();
}

function authorizeQuery({ clientId, redirectUri, challenge, state = 'st-' + randomUUID(), resource = RESOURCE, ...extra }) {
  const q = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'plainhand', ...extra };
  if (resource !== undefined) q.resource = resource;
  return q;
}

// Signs in as `user`, loads the approval page, and clicks Allow (or Cancel).
async function authorize({ user, clientId, redirectUri, decision = 'allow', ...rest }) {
  const pair = rest.challenge ? rest : { ...rest, ...verifierPair() };
  const q = authorizeQuery({ clientId, redirectUri, ...pair });
  const page = await call({ url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
  assert.equal(page.status, 200, page.body);
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)[1];
  assert.match(page.headers['set-cookie'], new RegExp(`^${COOKIE}=${csrf};.*HttpOnly.*SameSite=Lax.*Secure`));
  const post = await call({ method: 'POST', url: '/oauth/authorize', headers: { 'x-test-user': user, cookie: `${COOKIE}=${csrf}`, origin: ISSUER }, form: { ...q, csrf, decision } });
  assert.equal(post.status, 303, post.body);
  const location = new URL(post.headers.location);
  assert.equal(location.searchParams.get('iss'), ISSUER);
  assert.equal(location.searchParams.get('state'), q.state);
  return { location, code: location.searchParams.get('code'), verifier: pair.verifier, page, state: q.state };
}

async function exchange({ clientId, code, verifier, redirectUri, extra = {}, headers = {} }) {
  return call({ method: 'POST', url: '/oauth/token', headers, form: { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE, ...extra } });
}

async function connected(user, client) {
  const redirectUri = client.redirect_uris[0];
  const { code, verifier } = await authorize({ user, clientId: client.client_id, redirectUri });
  const res = await exchange({ clientId: client.client_id, code, verifier, redirectUri });
  assert.equal(res.status, 200, res.body);
  return res.json();
}

test('serves protected resource and authorization server metadata', { skip }, async () => {
  for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const res = await call({ url });
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.deepEqual(res.json(), { resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: ['plainhand'], bearer_methods_supported: ['header'], resource_name: 'Plainhand' });
  }
  const meta = (await call({ url: '/.well-known/oauth-authorization-server' })).json();
  assert.equal(meta.issuer, ISSUER);
  assert.equal(meta.authorization_endpoint, ISSUER + '/oauth/authorize');
  assert.equal(meta.token_endpoint, ISSUER + '/oauth/token');
  assert.equal(meta.registration_endpoint, ISSUER + '/oauth/register');
  assert.equal(meta.revocation_endpoint, ISSUER + '/oauth/revoke');
  assert.deepEqual(meta.response_types_supported, ['code']);
  assert.deepEqual(meta.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none', 'client_secret_post', 'client_secret_basic']);
  assert.deepEqual(meta.scopes_supported, ['plainhand']);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.equal(server.resourceMetadataUrl, 'https://plainhand.test/.well-known/oauth-protected-resource/mcp');
  assert.equal((await call({ url: '/mcp' })).handled, false);
  assert.equal((await call({ url: '/' })).handled, false);
  assert.equal((await call({ method: 'POST', url: '/.well-known/oauth-authorization-server' })).status, 405);
  assert.equal((await call({ method: 'OPTIONS', url: '/oauth/token' })).status, 204);
});

test('unauthorized() sends a Bearer challenge pointing at the resource metadata', { skip }, () => {
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  unauthorized(res, { resourceMetadataUrl: server.resourceMetadataUrl, error: 'invalid_token', description: 'Sign in "again"' });
  assert.equal(res.status, 401);
  assert.equal(res.headers['WWW-Authenticate'], `Bearer resource_metadata="${server.resourceMetadataUrl}", error="invalid_token", error_description="Sign in \\"again\\""`);
  assert.deepEqual(JSON.parse(res.body), { error: 'invalid_token', error_description: 'Sign in "again"' });
});

test('redirect URI rules: https, or http on loopback with any port', () => {
  assert.ok(validRedirectUri('https://abcdefghijklmnop.chromiumapp.org/'));
  assert.ok(validRedirectUri('https://0123abcd.extensions.allizom.org/'));
  assert.ok(validRedirectUri('http://127.0.0.1:3334/callback'));
  assert.ok(validRedirectUri('http://localhost/cb'));
  for (const bad of ['http://evil.example/cb', 'https://x.example/cb#frag', 'myapp://cb', 'javascript:alert(1)', 'https://user:pw@x.example/', '', 42]) assert.ok(!validRedirectUri(bad), String(bad));
  assert.ok(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/callback'));
  assert.ok(!redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:51234/other'));
  assert.ok(!redirectMatches(['https://a.example/cb'], 'https://a.example/cb/'));
  assert.ok(!redirectMatches(['https://a.example:8443/cb'], 'https://a.example:9443/cb'));
});

test('dynamic client registration validates redirect URIs and hashes secrets', { skip }, async () => {
  const pub = await registerPublic('https://abcdefghijklmnop.chromiumapp.org/', 'Plainhand extension', '198.51.100.1');
  assert.match(pub.client_id, /^ph_/);
  assert.equal(pub.client_secret, undefined);
  assert.equal(pub.token_endpoint_auth_method, 'none');

  const conf = await call({ method: 'POST', url: '/oauth/register', json: { client_name: 'Server app', redirect_uris: ['https://app.example/cb'] }, ip: '198.51.100.1' });
  assert.equal(conf.status, 201);
  const body = conf.json();
  assert.equal(body.token_endpoint_auth_method, 'client_secret_basic');
  assert.match(body.client_secret, /^phs_/);
  assert.equal(body.client_secret_expires_at, 0);
  const [row] = await sql`select client_secret_hash, metadata from plainhand.oauth_clients where client_id = ${body.client_id}`;
  assert.equal(row.client_secret_hash, createHash('sha256').update(body.client_secret).digest('hex'));
  assert.ok(!JSON.stringify(row.metadata).includes(body.client_secret));

  for (const redirect_uris of [['http://evil.example/cb'], ['https://a.example/cb#x'], ['myapp://cb'], [], 'https://a.example/cb']) {
    const res = await call({ method: 'POST', url: '/oauth/register', json: { redirect_uris }, ip: '198.51.100.2' });
    assert.equal(res.status, 400, JSON.stringify(redirect_uris));
    assert.equal(res.json().error, 'invalid_redirect_uri');
  }
  const badMethod = await call({ method: 'POST', url: '/oauth/register', json: { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, ip: '198.51.100.2' });
  assert.equal(badMethod.json().error, 'invalid_client_metadata');
  const badGrant = await call({ method: 'POST', url: '/oauth/register', json: { redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, ip: '198.51.100.2' });
  assert.equal(badGrant.json().error, 'invalid_client_metadata');
  const loopback = await call({ method: 'POST', url: '/oauth/register', json: { redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }, ip: '198.51.100.2' });
  assert.equal(loopback.status, 201);
});

test('registration is rate limited per IP', { skip }, async () => {
  const limited = makeServer({ limits: { registrationsPerIpPerHour: 2 } });
  const ip = '192.0.2.' + Math.floor(Math.random() * 200 + 1);
  const register = () => call({ target: limited, method: 'POST', url: '/oauth/register', json: { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, ip });
  assert.equal((await register()).status, 201);
  assert.equal((await register()).status, 201);
  const third = await register();
  assert.equal(third.status, 429);
  assert.equal(third.headers['retry-after'], '3600');
  assert.equal((await call({ target: limited, method: 'POST', url: '/oauth/register', json: { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, ip: '192.0.2.250' })).status, 201);
  advance(3601);
  assert.equal((await register()).status, 201);
});

test('the full authorization code + PKCE flow issues tokens bound to the resource', { skip }, async () => {
  const user = await account();
  const client = await registerPublic();
  const redirectUri = client.redirect_uris[0];
  const { code, verifier, page } = await authorize({ user, clientId: client.client_id, redirectUri });
  assert.match(page.body, /Let Claude use your Plainhand workspace\?/);
  assert.match(page.body, /It can read your roles and profile and save changes you ask for\. It can never approve applications or mark them submitted\./);
  assert.match(page.body, />Allow</); assert.match(page.body, />Cancel</);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(code, /^phc_/);
  const [stored] = await sql`select * from plainhand.oauth_codes where code_hash = ${createHash('sha256').update(code).digest('hex')}`;
  assert.equal(stored.resource, RESOURCE);
  assert.equal(stored.redirect_uri, redirectUri);

  const res = await exchange({ clientId: client.client_id, code, verifier, redirectUri });
  assert.equal(res.status, 200, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  const tokens = res.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, 'plainhand');
  assert.match(tokens.access_token, /^pha_/); assert.match(tokens.refresh_token, /^phr_/);
  const rows = await sql`select token_hash, resource, kind from plainhand.oauth_tokens t join plainhand.oauth_grants g on g.id = t.grant_id where g.user_id = ${user}`;
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.resource, RESOURCE); assert.ok(![tokens.access_token, tokens.refresh_token].includes(row.token_hash)); }

  const who = await server.verifyAccessToken(tokens.access_token);
  assert.equal(who.userId, user); assert.equal(who.clientId, client.client_id); assert.equal(who.scope, 'plainhand'); assert.ok(who.grantId);
  assert.equal(await server.verifyAccessToken(tokens.refresh_token), null);
  assert.equal(await server.verifyAccessToken('pha_nope'), null);
  const grants = await server.listGrants(user);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].clientName, 'Claude');
  assert.equal(grants[0].grantId, who.grantId);
  assert.ok(grants[0].lastUsedAt);

  advance(3601);
  assert.equal(await server.verifyAccessToken(tokens.access_token), null, 'access tokens last one hour');
});

test('last_used_at is written at most once a minute', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const { access_token } = await connected(user, client);
  const { grantId } = await server.verifyAccessToken(access_token);
  const lastUsed = async () => (await sql`select last_used_at from plainhand.oauth_grants where id = ${grantId}`)[0].last_used_at.getTime();
  const first = await lastUsed();
  advance(30); await server.verifyAccessToken(access_token);
  assert.equal(await lastUsed(), first);
  advance(31); await server.verifyAccessToken(access_token);
  assert.equal(await lastUsed(), first + 61_000);
});

test('the token endpoint rejects a wrong verifier, wrong redirect, reused code and expired code', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const redirectUri = client.redirect_uris[0];

  let flow = await authorize({ user, clientId: client.client_id, redirectUri });
  let res = await exchange({ clientId: client.client_id, code: flow.code, verifier: verifierPair().verifier, redirectUri });
  assert.equal(res.status, 400); assert.equal(res.json().error, 'invalid_grant');

  flow = await authorize({ user, clientId: client.client_id, redirectUri });
  res = await exchange({ clientId: client.client_id, code: flow.code, verifier: flow.verifier, redirectUri: 'https://claude.example/other' });
  assert.equal(res.json().error, 'invalid_grant');
  res = await exchange({ clientId: client.client_id, code: flow.code, verifier: flow.verifier, redirectUri, extra: { resource: 'https://other.example/mcp' } });
  assert.equal(res.status, 400); assert.equal(res.json().error, 'invalid_target');
  const other = await registerPublic('https://other.example/cb', 'Other');
  res = await exchange({ clientId: other.client_id, code: flow.code, verifier: flow.verifier, redirectUri });
  assert.equal(res.json().error, 'invalid_grant', 'a code only works for the client it was issued to');

  flow = await authorize({ user, clientId: client.client_id, redirectUri });
  res = await exchange({ clientId: client.client_id, code: flow.code, verifier: flow.verifier, redirectUri });
  assert.equal(res.status, 200);
  const { access_token } = res.json();
  res = await exchange({ clientId: client.client_id, code: flow.code, verifier: flow.verifier, redirectUri });
  assert.equal(res.status, 400); assert.equal(res.json().error, 'invalid_grant');
  assert.equal(await server.verifyAccessToken(access_token), null, 'reusing a code revokes what it issued');

  flow = await authorize({ user, clientId: client.client_id, redirectUri });
  advance(61);
  res = await exchange({ clientId: client.client_id, code: flow.code, verifier: flow.verifier, redirectUri });
  assert.equal(res.json().error, 'invalid_grant');

  res = await call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'password', client_id: client.client_id } });
  assert.equal(res.json().error, 'unsupported_grant_type');
  res = await call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'authorization_code', client_id: 'ph_unknown', code: 'x', code_verifier: 'y', redirect_uri: redirectUri } });
  assert.equal(res.status, 401); assert.equal(res.json().error, 'invalid_client');
  res = await call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'authorization_code', client_id: client.client_id } });
  assert.equal(res.status, 400); assert.equal(res.json().error, 'invalid_request');
});

test('confidential clients must authenticate with their secret', { skip }, async () => {
  const user = await account();
  const reg = (await call({ method: 'POST', url: '/oauth/register', json: { client_name: 'Server app', redirect_uris: ['https://app.example/cb'] }, ip: '198.51.100.9' })).json();
  const redirectUri = reg.redirect_uris[0];
  let flow = await authorize({ user, clientId: reg.client_id, redirectUri });
  let res = await exchange({ clientId: reg.client_id, code: flow.code, verifier: flow.verifier, redirectUri });
  assert.equal(res.status, 401); assert.equal(res.json().error, 'invalid_client');
  const basic = 'Basic ' + Buffer.from(`${encodeURIComponent(reg.client_id)}:${encodeURIComponent('wrong')}`).toString('base64');
  res = await exchange({ clientId: undefined, code: flow.code, verifier: flow.verifier, redirectUri, headers: { authorization: basic }, extra: { client_id: reg.client_id } });
  assert.equal(res.status, 401); assert.match(res.headers['www-authenticate'], /^Basic/);
  const good = 'Basic ' + Buffer.from(`${encodeURIComponent(reg.client_id)}:${encodeURIComponent(reg.client_secret)}`).toString('base64');
  res = await exchange({ clientId: reg.client_id, code: flow.code, verifier: flow.verifier, redirectUri, headers: { authorization: good } });
  assert.equal(res.status, 200, res.body);
  flow = await authorize({ user, clientId: reg.client_id, redirectUri });
  res = await exchange({ clientId: reg.client_id, code: flow.code, verifier: flow.verifier, redirectUri, extra: { client_secret: reg.client_secret } });
  assert.equal(res.status, 200, 'client_secret_post works too');
});

test('refresh tokens rotate, and reusing an old one ends the connection', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const first = await connected(user, client);
  const refresh = token => call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'refresh_token', refresh_token: token, client_id: client.client_id, resource: RESOURCE } });
  let res = await refresh(first.refresh_token);
  assert.equal(res.status, 200, res.body);
  const second = res.json();
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.notEqual(second.access_token, first.access_token);
  assert.ok(await server.verifyAccessToken(second.access_token));
  res = await refresh(second.refresh_token);
  assert.equal(res.status, 200);
  const third = res.json();

  res = await refresh(first.refresh_token); // stolen, already rotated
  assert.equal(res.status, 400); assert.equal(res.json().error, 'invalid_grant');
  assert.equal(await server.verifyAccessToken(third.access_token), null);
  assert.equal((await refresh(third.refresh_token)).json().error, 'invalid_grant');
  assert.deepEqual(await server.listGrants(user), []);

  const other = await registerPublic('https://other.example/cb', 'Other');
  const fresh = await connected(user, client);
  res = await call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: other.client_id } });
  assert.equal(res.json().error, 'invalid_grant', 'a refresh token only works for its own client');
  advance(30 * 24 * 3600 + 1);
  assert.equal((await refresh(fresh.refresh_token)).json().error, 'invalid_grant', 'refresh tokens last 30 days');
});

test('revocation endpoint and revokeGrant end access', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  let tokens = await connected(user, client);
  const revoke = (token, clientId = client.client_id) => call({ method: 'POST', url: '/oauth/revoke', form: { token, client_id: clientId } });
  assert.equal((await revoke(tokens.access_token)).status, 200);
  assert.equal(await server.verifyAccessToken(tokens.access_token), null);
  assert.equal((await server.listGrants(user)).length, 1, 'revoking an access token keeps the connection');
  assert.equal((await revoke(tokens.refresh_token)).status, 200);
  assert.deepEqual(await server.listGrants(user), []);
  assert.equal((await revoke('phr_unknown')).status, 200);

  tokens = await connected(user, client);
  const other = await registerPublic('https://other.example/cb', 'Other');
  assert.equal((await revoke(tokens.access_token, other.client_id)).status, 200);
  assert.ok(await server.verifyAccessToken(tokens.access_token), 'another client cannot revoke this token');

  const [grant] = await server.listGrants(user);
  assert.equal(await server.revokeGrant(user, grant.grantId), true);
  assert.equal(await server.verifyAccessToken(tokens.access_token), null);
  assert.equal(await server.revokeGrant(user, grant.grantId), false);
});

test('one grant per candidate and client; re-authorizing reuses it', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const a = await connected(user, client), b = await connected(user, client);
  const ga = await server.verifyAccessToken(a.access_token), gb = await server.verifyAccessToken(b.access_token);
  assert.equal(ga.grantId, gb.grantId);
  assert.equal((await server.listGrants(user)).length, 1);
  await server.revokeGrant(user, ga.grantId);
  const c = await connected(user, client);
  assert.equal((await server.verifyAccessToken(c.access_token)).grantId, ga.grantId);
  assert.equal(await server.verifyAccessToken(a.access_token), null, 'tokens from before the disconnect stay dead');
});

test('one candidate\'s token never resolves to another candidate', { skip }, async () => {
  const alice = await account(), bob = await account(), client = await registerPublic();
  const ta = await connected(alice, client), tb = await connected(bob, client);
  const a = await server.verifyAccessToken(ta.access_token), b = await server.verifyAccessToken(tb.access_token);
  assert.equal(a.userId, alice); assert.equal(b.userId, bob); assert.notEqual(a.grantId, b.grantId);
  assert.equal(await server.revokeGrant(bob, a.grantId), false);
  assert.ok(await server.verifyAccessToken(ta.access_token));
  assert.deepEqual((await server.listGrants(bob)).map(g => g.grantId), [b.grantId]);
  assert.deepEqual(await server.listGrants('not-a-uuid'), []);
});

test('signed-out authorize sends the candidate to sign in and back', { skip }, async () => {
  const client = await registerPublic();
  const q = new URLSearchParams(authorizeQuery({ clientId: client.client_id, redirectUri: client.redirect_uris[0], ...verifierPair() }));
  const res = await call({ url: '/oauth/authorize?' + q });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.location, ISSUER);
  assert.equal(location.pathname, '/signin');
  const next = location.searchParams.get('next');
  assert.ok(next.startsWith('/oauth/authorize?'));
  assert.equal(new URLSearchParams(next.split('?')[1]).get('client_id'), client.client_id);
});

test('Cancel returns access_denied with state and iss', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const { location, state } = await authorize({ user, clientId: client.client_id, redirectUri: client.redirect_uris[0], decision: 'cancel' });
  assert.equal(location.origin + location.pathname, client.redirect_uris[0]);
  assert.equal(location.searchParams.get('error'), 'access_denied');
  assert.equal(location.searchParams.get('state'), state);
  assert.equal(location.searchParams.get('iss'), ISSUER);
  assert.equal(location.searchParams.get('code'), null);
  assert.deepEqual(await server.listGrants(user), []);
});

test('every authorization error redirect carries iss; untrusted redirects get a page instead', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const redirectUri = client.redirect_uris[0];
  const { challenge } = verifierPair();
  const cases = [
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
  ];
  for (const [override, error] of cases) {
    const q = { ...authorizeQuery({ clientId: client.client_id, redirectUri, challenge, state: 's1' }), ...override };
    for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];
    const res = await call({ url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
    assert.equal(res.status, 302, JSON.stringify(override));
    const location = new URL(res.headers.location);
    assert.equal(location.searchParams.get('error'), error);
    assert.equal(location.searchParams.get('iss'), ISSUER);
    assert.equal(location.searchParams.get('state'), 's1');
  }
  // A resource that differs only by case of the host or a trailing slash is the same resource.
  const ok = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: client.client_id, redirectUri, challenge, resource: 'https://PLAINHAND.test/mcp/' })), headers: { 'x-test-user': user } });
  assert.equal(ok.status, 200);
  // No resource parameter at all is accepted; the token still gets this server as audience.
  const none = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: client.client_id, redirectUri, challenge, resource: undefined })), headers: { 'x-test-user': user } });
  assert.equal(none.status, 200);

  for (const q of [
    authorizeQuery({ clientId: client.client_id, redirectUri: 'https://evil.example/cb', challenge }),
    authorizeQuery({ clientId: 'ph_unknown', redirectUri, challenge }),
    authorizeQuery({ clientId: client.client_id, redirectUri: undefined, challenge }),
  ]) {
    for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];
    const res = await call({ url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
    assert.equal(res.status, 400);
    assert.equal(res.headers.location, undefined);
  }
  const dup = await call({ url: `/oauth/authorize?client_id=${client.client_id}&client_id=other`, headers: { 'x-test-user': user } });
  assert.equal(dup.status, 400);
});

test('the Allow form is protected against cross-site posts', { skip }, async () => {
  const user = await account(), client = await registerPublic();
  const q = authorizeQuery({ clientId: client.client_id, redirectUri: client.redirect_uris[0], ...verifierPair() });
  const page = await call({ url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)[1];
  const post = (headers, form) => call({ method: 'POST', url: '/oauth/authorize', headers: { 'x-test-user': user, ...headers }, form: { ...q, decision: 'allow', ...form } });
  assert.equal((await post({}, { csrf })).status, 403, 'no cookie');
  assert.equal((await post({ cookie: `${COOKIE}=${csrf}` }, { csrf: 'x' + csrf.slice(1) })).status, 403, 'mismatched token');
  assert.equal((await post({ cookie: `${COOKIE}=${csrf}`, origin: 'https://evil.example' }, { csrf })).status, 403, 'foreign origin');
  const signedOut = await call({ method: 'POST', url: '/oauth/authorize', headers: { cookie: `${COOKIE}=${csrf}`, origin: ISSUER }, form: { ...q, csrf, decision: 'allow' } });
  assert.equal(signedOut.status, 302); assert.match(signedOut.headers.location, /^\/signin\?next=/);
  assert.ok(!decodeURIComponent(signedOut.headers.location).includes(csrf));
  assert.equal((await post({ cookie: `${COOKIE}=${csrf}`, origin: ISSUER }, { csrf })).status, 303);
});

test('Client ID Metadata Documents: fetched, validated, cached, and usable end to end', { skip }, async () => {
  const user = await account();
  fetchCalls.length = 0;
  const flow = await authorize({ user, clientId: CHATGPT_CIMD, redirectUri: CHATGPT_REDIRECT });
  assert.match(flow.page.body, /Let ChatGPT use your Plainhand workspace\?/);
  const res = await exchange({ clientId: CHATGPT_CIMD, code: flow.code, verifier: flow.verifier, redirectUri: CHATGPT_REDIRECT });
  assert.equal(res.status, 200, res.body);
  const who = await server.verifyAccessToken(res.json().access_token);
  assert.equal(who.clientId, CHATGPT_CIMD); assert.equal(who.userId, user);
  assert.equal((await server.listGrants(user))[0].clientName, 'ChatGPT');
  assert.deepEqual(fetchCalls, [CHATGPT_CIMD], 'the document is fetched once and cached');

  const page = q => call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ ...verifierPair(), ...q })), headers: { 'x-test-user': user } });
  // Redirect not listed in the document.
  assert.equal((await page({ clientId: CHATGPT_CIMD, redirectUri: 'https://chatgpt.example/elsewhere' })).status, 400);

  const cases = {
    'https://mismatch.example/client.json': { client_id: 'https://someone-else.example/client.json', redirect_uris: ['https://mismatch.example/cb'] },
    'https://badredirect.example/client.json': { client_id: 'https://badredirect.example/client.json', redirect_uris: ['http://badredirect.example/cb'] },
    'https://secret.example/client.json': { client_id: 'https://secret.example/client.json', redirect_uris: ['https://secret.example/cb'], token_endpoint_auth_method: 'client_secret_basic' },
    'https://huge.example/client.json': JSON.stringify({ client_id: 'https://huge.example/client.json', redirect_uris: ['https://huge.example/cb'], pad: 'x'.repeat(70 * 1024) }),
    'https://notjson.example/client.json': 'hello',
  };
  for (const [url, doc] of Object.entries(cases)) {
    documents.set(url, doc);
    const res = await page({ clientId: url, redirectUri: new URL('/cb', url).href });
    assert.equal(res.status, 400, url);
    assert.equal(res.headers.location, undefined, url);
  }
  assert.equal((await page({ clientId: 'https://missing.example/client.json', redirectUri: 'https://missing.example/cb' })).status, 400);
  fetchCalls.length = 0;
  for (const url of ['https://localhost/client.json', 'https://127.0.0.1/client.json', 'https://10.0.0.5/client.json', 'https://[::1]/client.json', 'https://example.com', 'https://intranet/client.json']) {
    assert.equal((await page({ clientId: url, redirectUri: 'https://x.example/cb' })).status, 400, url);
  }
  assert.deepEqual(fetchCalls, [], 'local and private addresses are never fetched');
  await assert.rejects(sql`select 1 from plainhand.oauth_clients where client_id = 'https://mismatch.example/client.json'`.then(r => { if (!r.length) throw new Error('not stored'); }), /not stored/);
});

test('the CIMD cache expires and the document is fetched again', { skip }, async () => {
  const url = 'https://ttl.example/client.json';
  let served = 0;
  const local = makeServer({ fetchImpl: async () => { served++; return new Response(JSON.stringify({ client_id: url, client_name: 'TTL', redirect_uris: ['https://ttl.example/cb'] }), { status: 200, headers: { 'cache-control': 'max-age=0' } }); } });
  const user = await account();
  const q = authorizeQuery({ clientId: url, redirectUri: 'https://ttl.example/cb', ...verifierPair() });
  await call({ target: local, url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
  await call({ target: local, url: '/oauth/authorize?' + new URLSearchParams(q), headers: { 'x-test-user': user } });
  assert.equal(served, 2, 'max-age=0 is not cached');
});


test('a CIMD host that resolves to a private address is never fetched', { skip }, async () => {
  const url = 'https://rebind.example/oauth/client.json';
  documents.set(url, { client_id: url, client_name: 'Rebind', redirect_uris: ['https://rebind.example/cb'] });
  for (const answer of [[{ address: '10.0.0.5', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }], [{ address: '::ffff:192.168.1.2', family: 6 }], [{ address: 'fd12::1', family: 6 }]]) {
    dnsAnswers.set('rebind.example', answer);
    const before = fetchCalls.length;
    const { challenge } = verifierPair();
    const res = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: url, redirectUri: 'https://rebind.example/cb', challenge })), headers: { 'x-test-user': await account() } });
    assert.equal(res.status, 400);
    assert.match(res.body, /not one Plainhand can use/);
    assert.equal(fetchCalls.length, before, 'no request may be sent to a private address');
  }
  dnsAnswers.set('rebind.example', null);
  dnsAnswers.delete('rebind.example');
  const failing = makeServer({ lookupImpl: async () => { throw new Error('ENOTFOUND'); } });
  const { challenge } = verifierPair();
  const res = await call({ target: failing, url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: url, redirectUri: 'https://rebind.example/cb', challenge })), headers: { 'x-test-user': await account() } });
  assert.equal(res.status, 400);
});

test('the extension gets tokens only for the extension API, connectors only for /mcp', { skip }, async () => {
  const EXTENSION = ISSUER + '/api/extension';
  const user = await account();
  const extRedirect = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
  const ext = await registerPublic(extRedirect, 'Plainhand extension');
  // The consent page says what the extension can do.
  const pair = verifierPair();
  const page = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: ext.client_id, redirectUri: extRedirect, challenge: pair.challenge, resource: EXTENSION })), headers: { 'x-test-user': user } });
  assert.match(page.body, /fill application forms you open/);
  // Asking for the connector's audience is refused for the extension client...
  const wrong = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: ext.client_id, redirectUri: extRedirect, challenge: pair.challenge, resource: RESOURCE })), headers: { 'x-test-user': user } });
  assert.equal(new URL(wrong.headers.location).searchParams.get('error'), 'invalid_target');
  // ...and its own audience works end to end.
  const { code, verifier } = await authorize({ user, clientId: ext.client_id, redirectUri: extRedirect, resource: EXTENSION });
  const tokens = await exchange({ clientId: ext.client_id, code, verifier, redirectUri: extRedirect, extra: { resource: EXTENSION } });
  assert.equal(tokens.status, 200, tokens.body);
  const extGrant = await server.verifyAccessToken(tokens.json().access_token);
  assert.equal(extGrant.audience, 'extension');
  assert.equal(extGrant.userId, user);
  const refreshed = await call({ method: 'POST', url: '/oauth/token', form: { grant_type: 'refresh_token', refresh_token: tokens.json().refresh_token, client_id: ext.client_id, resource: RESOURCE } });
  assert.equal(refreshed.status, 400, 'refresh cannot switch audience');
  assert.equal(refreshed.json().error, 'invalid_target');

  // A connector (ChatGPT/Claude) cannot obtain an extension token.
  const claude = await registerPublic('https://claude.example/api/mcp/auth_callback', 'Claude');
  const p2 = verifierPair();
  const denied = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: claude.client_id, redirectUri: claude.redirect_uris[0], challenge: p2.challenge, resource: EXTENSION })), headers: { 'x-test-user': user } });
  assert.equal(new URL(denied.headers.location).searchParams.get('error'), 'invalid_target');
  const connector = await connected(user, claude);
  assert.equal((await server.verifyAccessToken(connector.access_token)).audience, 'mcp');
  // A client mixing an extension redirect with a normal one is a connector, not the extension.
  const mixed = await call({ method: 'POST', url: '/oauth/register', json: { client_name: 'Plainhand extension', redirect_uris: [extRedirect, 'https://evil.example/cb'], token_endpoint_auth_method: 'none' } });
  const p3 = verifierPair();
  const mixedRes = await call({ url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: mixed.json().client_id, redirectUri: extRedirect, challenge: p3.challenge, resource: EXTENSION })), headers: { 'x-test-user': user } });
  assert.equal(new URL(mixedRes.headers.location).searchParams.get('error'), 'invalid_target');
  // The extension audience has its own resource metadata.
  const meta = await call({ url: '/.well-known/oauth-protected-resource/api/extension' });
  assert.equal(meta.json().resource, EXTENSION);
});

test('with extensionIds set, only the published extension counts as the extension', { skip }, async () => {
  const EXTENSION = ISSUER + '/api/extension';
  const pinned = makeServer({ extensionIds: ['publishedidpublishedidpublishedi'], limits: { registrationsPerIpPerHour: 1000 } });
  const user = await account();
  const other = await call({ target: pinned, method: 'POST', url: '/oauth/register', json: { client_name: 'Plainhand extension', redirect_uris: ['https://someotherextensionidsomeother.chromiumapp.org/'], token_endpoint_auth_method: 'none' } });
  const { challenge } = verifierPair();
  const res = await call({ target: pinned, url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: other.json().client_id, redirectUri: 'https://someotherextensionidsomeother.chromiumapp.org/', challenge, resource: EXTENSION })), headers: { 'x-test-user': user } });
  assert.equal(new URL(res.headers.location).searchParams.get('error'), 'invalid_target');
  const published = await call({ target: pinned, method: 'POST', url: '/oauth/register', json: { client_name: 'Plainhand extension', redirect_uris: ['https://publishedidpublishedidpublishedi.chromiumapp.org/'], token_endpoint_auth_method: 'none' } });
  const ok = await call({ target: pinned, url: '/oauth/authorize?' + new URLSearchParams(authorizeQuery({ clientId: published.json().client_id, redirectUri: 'https://publishedidpublishedidpublishedi.chromiumapp.org/', challenge, resource: EXTENSION })), headers: { 'x-test-user': user } });
  assert.equal(ok.status, 200, ok.body);
});

test('production extension support fails closed with no published IDs', {skip}, async () => {
  const target=makeServer({requireExtensionAllowlist:true,extensionIds:[]});
  const redirect='https://fixtureid.chromiumapp.org/';
  const reg=await call({target,method:'POST',url:'/oauth/register',json:{client_name:'fixture',redirect_uris:[redirect],token_endpoint_auth_method:'none'}});
  const {challenge}=verifierPair();
  const res=await call({target,url:'/oauth/authorize?'+new URLSearchParams(authorizeQuery({clientId:reg.json().client_id,redirectUri:redirect,challenge,resource:ISSUER+'/api/extension'})),headers:{'x-test-user':await account()}});
  assert.equal(new URL(res.headers.location).searchParams.get('error'),'invalid_target');
});

test('production allowlist disables old extension access and refresh tokens', {skip}, async () => {
  const redirect='https://retiredfixture.chromiumapp.org/';
  const client=await registerPublic(redirect);
  const code=await authorize({user:await account(),clientId:client.client_id,redirectUri:redirect,resource:ISSUER+'/api/extension'});
  const tokens=await exchange({clientId:client.client_id,...code,redirectUri:redirect,extra:{resource:ISSUER+'/api/extension'}});assert.equal(tokens.status,200);
  const disabled=makeServer({requireExtensionAllowlist:true,extensionIds:[]});
  assert.equal(await disabled.verifyAccessToken(tokens.json().access_token),null);
  const published=makeServer({requireExtensionAllowlist:true,extensionIds:['retiredfixture']});
  assert.equal((await published.verifyAccessToken(tokens.json().access_token)).audience,'extension');
  const refreshed=await call({target:disabled,method:'POST',url:'/oauth/token',form:{grant_type:'refresh_token',refresh_token:tokens.json().refresh_token,client_id:client.client_id}});
  assert.equal(refreshed.json().error,'invalid_grant');
});
