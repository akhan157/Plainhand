// Supabase Auth REST calls, against a fake fetch (never the real service).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAuth, codeChallenge, newCodeVerifier } from '../plainhand/cloud/supabase-auth.mjs';

function fakeFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = responder(calls.at(-1));
    return new Response(body == null ? '' : JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}
const options = fetchImpl => ({ url: 'https://proj.supabase.co/', publishableKey: 'sb_publishable_x', secretKey: 'sb_secret_y', fetchImpl });

test('googleUrl sends the browser to Supabase authorize with an S256 challenge', () => {
  const auth = createSupabaseAuth(options(async () => { throw new Error('no network'); }));
  const verifier = newCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(auth.googleUrl('https://app.example/auth/callback', verifier));
  assert.equal(url.origin + url.pathname, 'https://proj.supabase.co/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), 'https://app.example/auth/callback');
  assert.equal(url.searchParams.get('code_challenge'), codeChallenge(verifier));
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  // RFC 7636 appendix B test vector
  assert.equal(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('sendEmailLink posts to /otp with the redirect and challenge', async () => {
  const { calls, fetchImpl } = fakeFetch(() => [200, {}]);
  const auth = createSupabaseAuth(options(fetchImpl));
  assert.deepEqual(await auth.sendEmailLink('a@example.com', 'https://app.example/auth/callback', 'v'.repeat(43)), { ok: true });
  const [call] = calls;
  const url = new URL(call.url);
  assert.equal(url.pathname, '/auth/v1/otp');
  assert.equal(url.searchParams.get('redirect_to'), 'https://app.example/auth/callback');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.apikey, 'sb_publishable_x');
  assert.equal(call.headers.Authorization, undefined);
  assert.deepEqual(call.body, { email: 'a@example.com', create_user: true, code_challenge: codeChallenge('v'.repeat(43)), code_challenge_method: 's256' });
  const limited = createSupabaseAuth(options(fakeFetch(() => [429, { msg: 'rate' }]).fetchImpl));
  await assert.rejects(limited.sendEmailLink('a@example.com', 'https://x'), /Too many/);
});

test('exchangeCode trades the code and verifier for the user', async () => {
  const { calls, fetchImpl } = fakeFetch(() => [200, { access_token: 'at', refresh_token: 'rt', user: { id: '0b1f7f52-3a0c-4e57-9a43-1d8b6c1f2e11', email: 'a@example.com' } }]);
  const auth = createSupabaseAuth(options(fetchImpl));
  assert.deepEqual(await auth.exchangeCode('code-1', 'verifier-1'), { userId: '0b1f7f52-3a0c-4e57-9a43-1d8b6c1f2e11', email: 'a@example.com' });
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=pkce');
  assert.deepEqual(calls[0].body, { auth_code: 'code-1', code_verifier: 'verifier-1' });
  const bad = createSupabaseAuth(options(fakeFetch(() => [400, { error: 'invalid_grant' }]).fetchImpl));
  await assert.rejects(bad.exchangeCode('c', 'v'), /expired or was already used/);
  await assert.rejects(auth.exchangeCode('', 'v'), /incomplete/);
  const noUser = createSupabaseAuth(options(fakeFetch(() => [200, {}]).fetchImpl));
  await assert.rejects(noUser.exchangeCode('c', 'v'), /did not return an account/);
});

test('verifyEmailToken posts the token hash to /verify', async () => {
  const { calls, fetchImpl } = fakeFetch(() => [200, { user: { id: 'u', email: 'e@example.com' } }]);
  const auth = createSupabaseAuth(options(fetchImpl));
  assert.deepEqual(await auth.verifyEmailToken('th'), { userId: 'u', email: 'e@example.com' });
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/verify');
  assert.deepEqual(calls[0].body, { type: 'email', token_hash: 'th' });
  await assert.rejects(auth.verifyEmailToken('th', 'recovery'), /incomplete/);
});

test('deleteUser uses the secret key, and an already deleted user is fine', async () => {
  const { calls, fetchImpl } = fakeFetch(() => [404, { msg: 'User not found' }]);
  const auth = createSupabaseAuth(options(fetchImpl));
  assert.deepEqual(await auth.deleteUser('0b1f7f52-3a0c-4e57-9a43-1d8b6c1f2e11'), { ok: true });
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/admin/users/0b1f7f52-3a0c-4e57-9a43-1d8b6c1f2e11');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].headers.apikey, 'sb_secret_y');
  assert.equal(calls[0].headers.Authorization, undefined);
  const failing = createSupabaseAuth(options(fakeFetch(() => [500, {}]).fetchImpl));
  await assert.rejects(failing.deleteUser('x'), /could not delete/);
  const offline = createSupabaseAuth(options(async () => { throw new TypeError('fetch failed'); }));
  await assert.rejects(offline.deleteUser('x'), /unavailable/);
  assert.throws(() => createSupabaseAuth({ url: '', publishableKey: '' }), /not configured/);
});

test('legacy JWT API keys retain Bearer authorization while opaque keys do not', async () => {
  const { calls, fetchImpl } = fakeFetch(() => [404, {}]);
  const legacy = 'eyJlegacy.payload.signature';
  const auth = createSupabaseAuth({ ...options(fetchImpl), secretKey: legacy });
  await auth.deleteUser('fixture');
  assert.equal(calls[0].headers.apikey, legacy);
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + legacy);
});
