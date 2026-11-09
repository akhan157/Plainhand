// Supabase Auth over its REST API (no client library): Google sign-in and email sign-in
// links through the PKCE flow, plus deleting the Auth user when an account is deleted.
// Plainhand keeps its own session cookie (accounts.mjs); Supabase's access and refresh
// tokens are used once to learn who signed in and are then discarded.
import { createHash, randomBytes } from 'node:crypto';

export class AuthError extends Error {}

export const newCodeVerifier = () => randomBytes(32).toString('base64url'); // 43 chars, RFC 7636
export const codeChallenge = verifier => createHash('sha256').update(verifier).digest('base64url');

export function createSupabaseAuth({ url, publishableKey, secretKey, fetchImpl = globalThis.fetch }) {
  if (!url || !publishableKey) throw new Error('Supabase Auth is not configured.');
  const base = String(url).replace(/\/+$/, '') + '/auth/v1';
  // Opaque sb_* keys are API keys, not JWTs. Sending them as Bearer can fail
  // gateway JWT validation. Legacy JWT keys retain their authorization header.
  // https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
  const headers = key => ({ apikey: key, ...(/^sb_(publishable|secret)_/.test(key) ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json', Accept: 'application/json' });
  async function call(path, { method = 'POST', body, key = publishableKey } = {}) {
    let response;
    try { response = await fetchImpl(base + path, { method, headers: headers(key), ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new AuthError('Sign-in is unavailable right now. Try again in a minute.'); }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, ok: response.ok, data };
  }
  const userFrom = data => {
    const user = data?.user;
    if (!user?.id || !user?.email) throw new AuthError('Sign-in did not return an account. Try again.');
    return { userId: user.id, email: user.email };
  };
  // Which sign-in providers are switched on in the Supabase dashboard, so the sign-in page
  // never offers a button that ends in "provider is not enabled". Cached for a minute.
  let providerCache = null;
  async function providers() {
    if (providerCache && providerCache.expires > Date.now()) return providerCache.value;
    let value = { google: false };
    try {
      const { ok, data } = await call('/settings', { method: 'GET' });
      if (ok) value = { google: data?.external?.google === true };
    } catch { /* unreachable: offer email only */ }
    providerCache = { value, expires: Date.now() + 60_000 };
    return value;
  }
  return {
    providers,
    // Where to send the browser for Google. Supabase returns to redirectTo?code=… afterwards.
    googleUrl(redirectTo, codeVerifier) {
      const params = new URLSearchParams({ provider: 'google', redirect_to: redirectTo, code_challenge: codeChallenge(codeVerifier), code_challenge_method: 's256' });
      return `${base}/authorize?${params}`;
    },
    // With a codeVerifier the link returns to redirectTo?code=… (same browser). Without one,
    // Supabase's email template must link to redirectTo?token_hash=…&type=email (any device).
    async sendEmailLink(email, redirectTo, codeVerifier) {
      const body = { email, create_user: true, ...(codeVerifier ? { code_challenge: codeChallenge(codeVerifier), code_challenge_method: 's256' } : {}) };
      const { ok, status } = await call('/otp?' + new URLSearchParams({ redirect_to: redirectTo }), { body });
      if (status === 429) throw new AuthError('Too many sign-in emails. Wait a few minutes and try again.');
      if (!ok) throw new AuthError('We could not send the sign-in email. Check the address and try again.');
      return { ok: true };
    },
    async exchangeCode(code, codeVerifier) {
      if (!code || !codeVerifier) throw new AuthError('This sign-in link is incomplete. Start again.');
      const { ok, data } = await call('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: codeVerifier } });
      if (!ok) throw new AuthError('This sign-in link has expired or was already used. Start again.');
      return userFrom(data);
    },
    async verifyEmailToken(tokenHash, type = 'email') {
      if (!tokenHash || !['email', 'magiclink', 'signup'].includes(type)) throw new AuthError('This sign-in link is incomplete. Start again.');
      const { ok, data } = await call('/verify', { body: { type, token_hash: tokenHash } });
      if (!ok) throw new AuthError('This sign-in link has expired or was already used. Start again.');
      return userFrom(data);
    },
    // Idempotent: an already deleted user counts as deleted.
    async deleteUser(userId) {
      if (!secretKey) throw new Error('Supabase secret key is not configured.');
      const { ok, status } = await call('/admin/users/' + encodeURIComponent(userId), { method: 'DELETE', key: secretKey });
      if (!ok && status !== 404) throw new AuthError('We could not delete your sign-in account. Try again.');
      return { ok: true };
    },
  };
}
