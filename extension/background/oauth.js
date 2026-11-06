// Plainhand extension sign-in: OAuth 2.1 with PKCE through chrome.identity,
// against the hosted Plainhand OAuth server (plainhand/cloud/oauth.mjs). The
// extension never sees a password; it stores one access token and its expiry,
// refreshing with the rotating refresh token. On first sign-in to a site it
// registers itself (RFC 7591) with its real identity redirect
// (https://<extension-id>.chromiumapp.org/), which only this installed
// extension can receive; the server issues it tokens for the extension API only.
const DEFAULT_SITE = 'https://plainhand.test';
const SCOPES = 'plainhand';
const audience = site => `${site.replace(/\/+$/, '')}/api/extension`;

const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

// One registered client per site, kept in extension storage.
async function clientId(site, auth) {
  const redirect = chrome.identity.getRedirectURL('');
  const { clients = {} } = await chrome.storage.local.get(['clients']);
  const known = clients[site];
  if (known?.clientId && known.redirect === redirect) return known.clientId;
  if (!auth.registration_endpoint) throw new Error('Plainhand sign-in is unavailable right now.');
  const response = await fetch(auth.registration_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Plainhand extension', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (!response.ok) throw new Error('Plainhand sign-in is unavailable right now.');
  const registered = await response.json();
  if (!registered.client_id) throw new Error('Plainhand sign-in is unavailable right now.');
  await chrome.storage.local.set({ clients: { ...clients, [site]: { clientId: registered.client_id, redirect } } });
  return registered.client_id;
}

async function storedClientId(site) {
  const { clients = {} } = await chrome.storage.local.get(['clients']);
  return clients[site]?.clientId || null;
}

async function metadata(site) {
  const response = await fetch(`${site}/.well-known/oauth-authorization-server`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Plainhand sign-in is unavailable right now.');
  return response.json();
}

// One sign-in round: authorize in a browser window, exchange the code.
export async function launchSignIn() {
  const { site = DEFAULT_SITE } = await chrome.storage.local.get(['site']);
  const auth = await metadata(site);
  const redirect = chrome.identity.getRedirectURL('');
  const client = await clientId(site, auth);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await sha256(verifier));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const url = new URL(auth.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: client, redirect_uri: redirect,
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256',
    resource: audience(site),
  });
  const returned = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  if (!returned) throw new Error('Sign-in was cancelled.');
  const callback = new URL(returned);
  if (callback.searchParams.get('state') !== state) throw new Error('The sign-in answer did not come from Plainhand. Try again.');
  const error = callback.searchParams.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'You cancelled the sign-in.' : 'Plainhand sign-in did not finish. Try again.');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Plainhand sign-in did not finish. Try again.');
  const tokenResponse = await fetch(auth.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client, redirect_uri: redirect, code_verifier: verifier, resource: audience(site) }),
  });
  if (!tokenResponse.ok) throw new Error('Plainhand could not finish the sign-in. Try again.');
  const tokens = await tokenResponse.json();
  await chrome.storage.local.set({
    site,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    tokenExpiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  });
  return { ok: true };
}

// Refresh once when the access token is past its life; the server rotates the
// refresh token, so both are replaced together.
export async function freshToken() {
  const { site = DEFAULT_SITE, token, refreshToken, tokenExpiresAt } = await chrome.storage.local.get(['site', 'token', 'refreshToken', 'tokenExpiresAt']);
  if (!token) return null;
  if (!refreshToken || !tokenExpiresAt || Date.now() < tokenExpiresAt - 60000) return token;
  const auth = await metadata(site);
  const client = await storedClientId(site);
  if (!client) { await chrome.storage.local.set({ token: null, refreshToken: null }); throw new Error('Plainhand needs you to sign in again.'); }
  const response = await fetch(auth.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client }),
  });
  if (!response.ok) { await chrome.storage.local.set({ token: null, refreshToken: null }); throw new Error('Plainhand needs you to sign in again.'); }
  const tokens = await response.json();
  await chrome.storage.local.set({ token: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, tokenExpiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 });
  return tokens.access_token;
}

export async function signOut() {
  const { site = DEFAULT_SITE, refreshToken } = await chrome.storage.local.get(['site', 'refreshToken']);
  if (refreshToken) {
    try {
      const auth = await metadata(site);
      await fetch(auth.revocation_endpoint || `${site}/oauth/revoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: (await storedClientId(site)) || '' }),
      });
    } catch { /* revocation is best-effort locally */ }
  }
  await chrome.storage.local.set({ token: null, refreshToken: null, tokenExpiresAt: null });
}

export const API = { freshToken, signOut, launchSignIn, DEFAULT_SITE, SCOPES };
