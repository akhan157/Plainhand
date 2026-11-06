// The hosted website handler against a real Postgres (see tests/cloud-test-db.mjs) and a
// fake Supabase Auth:
//   PLAINHAND_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54331/postgres node --test tests/test-cloud-app.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createAccounts, createSessions } from '../plainhand/cloud/accounts.mjs';
import { createCloudApp, SESSION_COOKIE, PKCE_COOKIE } from '../plainhand/cloud/app.mjs';
import { AuthError } from '../plainhand/cloud/supabase-auth.mjs';
import { freshDatabase, skip } from './cloud-test-db.mjs';

const db = freshDatabase();
const SITE = 'https://plainhand.test';
const env = { SITE_URL: SITE, SESSION_SECRET: 's'.repeat(40), CRON_SECRET: 'cron-secret-value' };

function fakeAuth() {
  const users = new Map(); // code -> user
  const auth = {
    emails: [], deleted: [],
    googleUrl: (redirectTo, verifier) => `https://auth.test/google?redirect_to=${encodeURIComponent(redirectTo)}&v=${verifier}`,
    async sendEmailLink(email, redirectTo, verifier) { auth.emails.push({ email, redirectTo, verifier }); return { ok: true }; },
    async exchangeCode(code, verifier) { const u = users.get(code); if (!u || u.verifier !== verifier) throw new AuthError('This sign-in link has expired or was already used. Start again.'); return { userId: u.userId, email: u.email }; },
    async verifyEmailToken(hash) { const u = users.get('hash:' + hash); if (!u) throw new AuthError('expired'); return { userId: u.userId, email: u.email }; },
    async deleteUser(userId) { auth.deleted.push(userId); return { ok: true }; },
    issue(userId, email, verifier) { const code = randomUUID(); users.set(code, { userId, email, verifier }); return code; },
    issueHash(userId, email) { const hash = randomUUID(); users.set('hash:' + hash, { userId, email }); return hash; },
  };
  return auth;
}

async function start(extra = {}) {
  const auth = fakeAuth(), accounts = createAccounts({ sql: db.sql }), sessions = createSessions({ sql: db.sql });
  const handler = createCloudApp({ sql: db.sql, env, auth, accounts, sessions, now: () => new Date(), ...extra });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let ipCounter = 0;
  // Every client gets its own IP so the per-IP limit only trips where a test wants it.
  const client = (ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`) => {
    const jar = {};
    const request = async (path, { method = 'GET', headers = {}, body, json } = {}) => {
      const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'x-real-ip': ip, ...(cookieHeader ? { cookie: cookieHeader } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: json !== undefined ? JSON.stringify(json) : body });
      for (const line of response.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';'); const [name, value] = pair.split('=');
        if (attrs.some(a => a.trim() === 'Max-Age=0')) delete jar[name]; else jar[name] = value;
      }
      return response;
    };
    const c = { jar, request, token: null };
    c.api = (path, data, { method = data === undefined ? 'GET' : 'POST', origin = SITE, token = c.token } = {}) => request('/api/' + path, { method, json: data, headers: { ...(token ? { 'x-plainhand-token': token } : {}), ...(method !== 'GET' && origin ? { origin } : {}) } });
    c.signIn = async (userId = randomUUID(), email = `${userId.slice(0, 8)}@example.com`) => {
      const go = await request('/auth/google');
      assert.equal(go.status, 302);
      const verifier = new URL(go.headers.get('location')).searchParams.get('v');
      assert.ok(jar[PKCE_COOKIE]);
      const back = await request('/auth/callback?code=' + auth.issue(userId, email, verifier));
      assert.equal(back.status, 303);
      assert.equal(back.headers.get('location'), '/');
      assert.ok(jar[SESSION_COOKIE]);
      const page = await (await request('/')).text();
      c.token = /name="plainhand-session" content="([^"]+)"/.exec(page)[1];
      c.userId = userId;
      return c;
    };
    return c;
  };
  return { auth, accounts, sessions, base, client, close: () => new Promise(r => server.close(r)) };
}

let app;
test.before(async () => { await db.ready; if (!skip) app = await start(); });
test.after(async () => { await app?.close(); });

test('signed-out visitors are sent to sign in; the API answers 401', { skip }, async () => {
  const c = app.client();
  const home = await c.request('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/signin');
  assert.equal((await c.request('/api/state')).status, 401);
  assert.equal((await c.api('jobs', { company: 'A' })).status, 401);
  const signin = await c.request('/signin');
  assert.equal(signin.status, 200);
  const text = await signin.text();
  assert.match(text, /Continue with Google/);
  assert.match(text, /Email me a sign-in link/);
  // Static files are public and safe; the app page is not.
  assert.equal((await c.request('/app.js')).status, 200);
  assert.equal((await c.request('/index.html')).status, 302);
  assert.equal((await c.request('/../package.json')).status, 302);
  // Encoded traversal as an attacker sends it (fetch keeps %2e%2e%2f raw; a literal
  // %2e%2e is normalized away before it reaches the server).
  assert.equal((await c.request('/%2e%2e%2fpackage.json')).status, 404);
});

test('security headers are set on every response', { skip }, async () => {
  const response = await app.client().request('/signin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('strict-transport-security'), /max-age=/);
});

test('Google sign-in sets an httpOnly Secure SameSite=Lax session cookie', { skip }, async () => {
  const c = app.client();
  const go = await c.request('/auth/google');
  const location = new URL(go.headers.get('location'));
  assert.equal(location.searchParams.get('redirect_to'), SITE + '/auth/callback');
  const verifier = location.searchParams.get('v');
  const id = randomUUID();
  const back = await c.request('/auth/callback?code=' + app.auth.issue(id, 'g@example.com', verifier));
  const setCookie = back.headers.getSetCookie().find(line => line.startsWith(SESSION_COOKIE + '='));
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//);
  assert.equal((await app.accounts.get(id)).email, 'g@example.com');
  // A code used without the verifier cookie from this browser is refused.
  const other = app.client();
  const reused = await other.request('/auth/callback?code=' + app.auth.issue(randomUUID(), 'x@example.com', verifier));
  assert.equal(reused.status, 400);
  assert.match(await reused.text(), /same browser/);
  assert.equal((await other.request('/auth/callback?error=access_denied')).headers.get('location'), '/signin?error=1');
});

test('email sign-in link: request, then sign in from the link', { skip }, async () => {
  const c = app.client();
  const sent = await c.request('/auth/email', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=Mia%40Example.com' });
  assert.equal(sent.status, 303);
  assert.equal(sent.headers.get('location'), '/signin?sent=1');
  const last = app.auth.emails.at(-1);
  assert.equal(last.email, 'mia@example.com');
  assert.equal(last.redirectTo, SITE + '/auth/callback');
  assert.equal(last.verifier, c.jar[PKCE_COOKIE]);
  assert.match(await (await c.request('/signin?sent=1')).text(), /Check your email/);
  const bad = await c.request('/auth/email', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=nope' });
  assert.equal(bad.status, 400);
  // The token-hash link works from any device.
  const phone = app.client(), id = randomUUID();
  const back = await phone.request('/auth/callback?type=email&token_hash=' + app.auth.issueHash(id, 'mia@example.com'));
  assert.equal(back.status, 303);
  assert.equal((await phone.request('/')).status, 200);
});

test('one user can never read or change another user\'s workspace', { skip }, async () => {
  const a = await app.client().signIn(), b = await app.client().signIn();
  assert.equal((await a.api('jobs', { company: 'Acme', title: 'Engineer', url: 'https://jobs.example.com/acme/1', description: 'secret posting text' })).status, 201);
  // Give A a downloadable artifact.
  const wa = app.accounts.workspaceFor(a.userId);
  await wa.write('output/acme.md', 'A private report');
  let jobId;
  await wa.mutate(state => { state.jobs[0].artifacts = ['output/acme.md']; jobId = state.jobs[0].id; });
  assert.equal(await (await a.api('artifact?path=output%2Facme.md')).text(), 'A private report');

  const stateB = await (await b.api('state')).json();
  assert.equal(stateB.jobs.length, 0);
  assert.doesNotMatch(JSON.stringify(stateB), /Acme|secret posting/);
  assert.equal((await b.api('artifact?path=output%2Facme.md')).status, 404);
  assert.doesNotMatch(await (await b.api('export')).text(), /Acme/);
  for (const [path, body] of [['jobs/update', { id: jobId, selected: true }], ['packet/approve', { id: jobId }], ['action', { name: 'jobs.get', input: { jobId } }], ['jobs/record/next-action', { id: jobId, text: 'x', due: '2026-12-01' }]]) {
    const response = await b.api(path, body);
    assert.equal(response.status, 400, path);
    assert.doesNotMatch(await response.text(), /Acme|secret/, path);
  }
  // Mixing one user's cookie with another's page token is refused.
  assert.equal((await a.api('state', undefined, { token: b.token })).status, 403);
  assert.equal((await b.api('state', undefined, { token: a.token })).status, 403);
  const [{ n }] = await db.sql`select count(*)::int as n from plainhand.workspace_files where user_id = ${b.userId} and convert_from(content, 'UTF8') like '%Acme%'`;
  assert.equal(n, 0);
  assert.equal((await (await a.api('state')).json()).jobs.length, 1);
});

test('state-changing requests from other sites are refused (CSRF)', { skip }, async () => {
  const c = await app.client().signIn();
  const job = { company: 'Csrf', title: 'Role', url: 'https://jobs.example.com/csrf/1' };
  assert.equal((await c.api('jobs', job, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.api('jobs', job, { origin: null })).status, 403); // no Origin, no Sec-Fetch-Site
  assert.equal((await c.api('jobs', job, { token: 'wrong' })).status, 403);
  assert.equal((await c.api('jobs', job, { token: '' })).status, 403);
  assert.equal((await c.request('/auth/signout', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await c.request('/api/state')).status, 403); // GET needs the page token too
  assert.equal((await (await c.api('state')).json()).jobs.length, 0);
  assert.equal((await c.api('jobs', job)).status, 201);
  // Same-origin fetch without Origin but with Sec-Fetch-Site is accepted.
  assert.equal((await c.request('/api/tasks/cancel', { method: 'POST', json: { id: 'none' }, headers: { 'x-plainhand-token': c.token, 'sec-fetch-site': 'same-origin' } })).status, 400);
});

test('website routes work behind the session: profile, help, local-only features', { skip }, async () => {
  const c = await app.client().signIn();
  const state = await (await c.api('state')).json();
  assert.equal(state.cloud, true);
  assert.equal((await c.api('profile', { profile: { name: 'Ana Example', resume: 'Built things.' }, revision: state.revision })).status, 200);
  assert.equal((await (await c.api('state')).json()).profile.name, 'Ana Example');
  const help = await c.api('help', { message: 'I could not find the approve button.', screen: 'jobs', errorIds: ['e1'] });
  assert.equal(help.status, 200);
  const { id } = await help.json();
  const stored = JSON.parse(await app.accounts.workspaceFor(c.userId).read(`data/plainhand/help/${id}.json`));
  assert.equal(stored.message, 'I could not find the approve button.');
  assert.equal(stored.screen, 'jobs');
  assert.deepEqual(stored.errorIds, ['e1']);
  assert.equal((await c.api('help', { message: '' })).status, 400);
  for (const path of ['browser/autofill', 'remote/publish', 'provider/setup', 'import']) assert.equal((await c.api(path, {})).status, 404, path);
  const events = await c.api('events');
  assert.match(await events.text(), /retry: 5000\nevent: state/);
  assert.equal((await c.api('resume/import', { name: 'cv.pdf', content: 'JVBERi0=' })).status, 400);
  assert.equal(await (await c.api('resume/import', { name: 'cv.txt', content: Buffer.from('My resume').toString('base64') })).json().then(r => r.text), 'My resume');
  const account = await (await c.api('account')).json();
  assert.match(account.email, /@example\.com$/);
});

test('signing out ends the session', { skip }, async () => {
  const c = await app.client().signIn();
  const saved = { ...c.jar };
  const out = await c.request('/auth/signout', { method: 'POST', headers: { origin: SITE } });
  assert.equal(out.status, 303);
  assert.equal(c.jar[SESSION_COOKIE], undefined);
  Object.assign(c.jar, saved); // replaying the old cookie does not work
  assert.equal((await c.api('state')).status, 401);
});

test('deleting the account removes everything after one confirmation', { skip }, async () => {
  const c = await app.client().signIn();
  await c.api('jobs', { company: 'Gone', title: 'Role', url: 'https://jobs.example.com/gone/1' });
  await c.api('help', { message: 'hello' });
  const second = app.client(); Object.assign(second.jar, c.jar); // another device, same account
  assert.equal((await c.api('account', {}, { method: 'DELETE' })).status, 400); // no confirmation
  assert.equal((await c.api('account', { confirm: true }, { method: 'DELETE', origin: 'https://evil.example' })).status, 403);
  assert.ok(await app.accounts.get(c.userId));
  const done = await c.api('account', { confirm: true }, { method: 'DELETE' });
  assert.equal(done.status, 200);
  assert.ok(app.auth.deleted.includes(c.userId));
  assert.equal(await app.accounts.get(c.userId), null);
  for (const table of ['workspace_files', 'sessions']) {
    const [{ n }] = await db.sql`select count(*)::int as n from ${db.sql('plainhand.' + table)} where user_id = ${c.userId}`;
    assert.equal(n, 0, table);
  }
  assert.equal((await second.api('state', undefined, { token: c.token })).status, 401);

  // The confirmation page route, for the website's Delete my account button.
  const d = await app.client().signIn();
  const confirmPage = await (await d.request('/account/delete')).text();
  assert.match(confirmPage, /Delete your account\?/);
  const csrf = /name="csrf" value="([^"]+)"/.exec(confirmPage)[1];
  const form = { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' } };
  assert.equal((await d.request('/account/delete', { ...form, body: 'csrf=wrong&confirm=yes' })).status, 403);
  assert.equal((await d.request('/account/delete', { ...form, body: `csrf=${csrf}&confirm=yes` })).status, 200);
  assert.equal(await app.accounts.get(d.userId), null);
});

test('the daily cron needs its secret', { skip }, async () => {
  const c = app.client();
  assert.equal((await c.request('/api/cron/daily')).status, 401);
  assert.equal((await c.request('/api/cron/daily', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const ok = await c.request('/api/cron/daily', { headers: { authorization: 'Bearer cron-secret-value' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
});

test('rate limits stop floods per user, per IP and per sign-in email', { skip }, async () => {
  const limited = await start({ limits: { user: { limit: 3, seconds: 60 }, ip: { limit: 25, seconds: 60 }, signinEmail: { limit: 2, seconds: 3600 } } });
  try {
    const c = await limited.client().signIn();
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await c.api('tasks/cancel', { id: 'x' })).status);
    assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
    const blocked = await c.api('tasks/cancel', { id: 'x' });
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Another user is not affected.
    const other = await limited.client().signIn();
    assert.equal((await other.api('tasks/cancel', { id: 'x' })).status, 400);

    const ip = limited.client('203.0.113.9');
    let last;
    for (let i = 0; i < 30; i++) last = (await ip.request('/signin')).status;
    assert.equal(last, 429);

    const form = { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=flood%40example.com' };
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await limited.client().request('/auth/email', form)).status);
    assert.deepEqual(results, [303, 303, 429]);
    const [{ n }] = await db.sql`select count(*)::int as n from plainhand.rate_limits where key like '%flood%'`;
    assert.equal(n, 0); // keys are hashed
  } finally { await limited.close(); }
});

test('optional connector and extension routes require a valid bearer token', { skip }, async () => {
  const userId = randomUUID();
  const calls = [];
  const oauth = {
    async handle(req, res) { if (req.url.startsWith('/.well-known/oauth-protected-resource')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"resource":"x"}'); return true; } return false; },
    async verifyAccessToken(token) { return token === 'good' ? { userId, grantId: 'g', clientId: 'c', scope: '' } : null; },
  };
  const echo = name => async (req, res, ctx) => { calls.push({ name, userId: ctx.userId, hasWorkspace: !!ctx.workspace && !!ctx.registry }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ userId: ctx.userId })); };
  const mounted = await start({ oauth, handleMcp: echo('mcp'), handleExtensionApi: echo('extension') });
  try {
    await mounted.accounts.upsert({ userId, email: 'mcp@example.com' });
    const c = mounted.client();
    assert.equal(await (await c.request('/.well-known/oauth-protected-resource')).text(), '{"resource":"x"}');
    const denied = await c.request('/mcp', { method: 'POST', json: {} });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /resource_metadata="https:\/\/plainhand\.test\/\.well-known\/oauth-protected-resource"/);
    assert.equal((await c.request('/mcp', { method: 'POST', json: {}, headers: { authorization: 'Bearer bad' } })).status, 401);
    assert.deepEqual(await (await c.request('/mcp', { method: 'POST', json: {}, headers: { authorization: 'Bearer good' } })).json(), { userId });
    assert.equal((await c.request('/api/extension/match', { method: 'POST', json: {} })).status, 401);
    assert.deepEqual(await (await c.request('/api/extension/match', { method: 'POST', json: {}, headers: { authorization: 'Bearer good' } })).json(), { userId });
    assert.deepEqual(calls.map(x => [x.name, x.hasWorkspace]), [['mcp', true], ['extension', true]]);
    // A session cookie is not a bearer token, and without the modules these routes do not exist.
    const web = await app.client().signIn();
    assert.equal((await web.request('/mcp', { method: 'POST', json: {} })).status, 404);
  } finally { await mounted.close(); }
});
