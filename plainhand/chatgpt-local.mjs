// Sign in with ChatGPT for the local (desktop) app, following OpenAI's
// open-source flow: dynamic client registration, a persisted opaque host id,
// PKCE (S256), state and nonce, a one-shot loopback callback on 127.0.0.1,
// ID-token validation against OpenAI's published keys, and a check that plan
// usage was granted before any model call. Tokens are encrypted with a key kept
// at data/plainhand/secret.key (owner-only) and never leave this process.
import http from 'node:http';
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import {
  CHATGPT_AUTHORIZE_URL, CHATGPT_TOKEN_URL, CHATGPT_OPENID_CONFIGURATION_URL, CHATGPT_RESOURCE, CHATGPT_SCOPES, CHATGPT_PLAN_SCOPE,
  CHATGPT_DYNAMIC_CLIENT_ID, CHATGPT_ISSUER, createTokenStore, createChatgptAgent,
} from './cloud/chatgpt-agent.mjs';

export const SECRET_KEY_FILE = 'data/plainhand/secret.key';
export const CLIENT_FILE = 'data/plainhand/chatgpt-client.json';
export const CHATGPT_CALLBACK_PORT = 1455;
export const CHATGPT_CALLBACK_PATH = '/auth/callback';
// The app's name shown on OpenAI's consent screen (sent only on first registration).
export const CHATGPT_AGENT_NAME_HINT = 'Plainhand';
// Assumption: when port 1455 is taken (for example by a Codex sign-in), any free
// loopback port is acceptable; OpenAI's docs say only that the port may change.
export const CHATGPT_ALLOW_OTHER_PORT = true;
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

const base64url = buffer => Buffer.from(buffer).toString('base64url');
export const pkceChallenge = verifier => base64url(createHash('sha256').update(verifier).digest());
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const scopeList = value => String(value || '').split(/\s+/).filter(Boolean);

// The 32-byte key for the token store, created once per workspace.
export async function workspaceSecretKey(workspace) {
  const existing = (await workspace.read(SECRET_KEY_FILE, '')).trim();
  if (/^[0-9a-f]{64}$/.test(existing)) return Buffer.from(existing, 'hex');
  const key = randomBytes(32);
  await workspace.write(SECRET_KEY_FILE, key.toString('hex') + '\n'); // FileStorage writes 0600
  return key;
}

// Verifies an RS256/ES256 JWT against a JWKS. Returns the payload or throws.
export function verifyIdToken(idToken, jwks, { issuer, audience, nonce, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const keys = (jwks?.keys || []).filter(k => !header.kid || k.kid === header.kid);
  const algorithm = { RS256: 'sha256', ES256: 'sha256' }[header.alg];
  if (!algorithm || !keys.length) throw new Error('unknown key');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`), signature = Buffer.from(parts[2], 'base64url');
  const valid = keys.some(jwk => { try { const key = createPublicKey({ key: jwk, format: 'jwk' }); return verifySignature(algorithm, signed, header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, signature); } catch { return false; } });
  if (!valid) throw new Error('bad signature');
  if (payload.iss !== issuer) throw new Error('bad issuer');
  if (!(Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience)) throw new Error('bad audience');
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now - 60000) throw new Error('expired');
  if (!sameText(payload.nonce, nonce)) throw new Error('bad nonce');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no subject');
  return payload;
}

const page = (title, text) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222;background:#fff"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;

export function createLocalChatgpt({ workspace, fetchImpl = globalThis.fetch, port = CHATGPT_CALLBACK_PORT, now = Date.now } = {}) {
  let store = null, agent = null, attempt = null, last = null;
  async function tokens() {
    store ||= createTokenStore({ workspace, key: await workspaceSecretKey(workspace), fetchImpl, now });
    return store;
  }
  const readClient = async () => { try { return JSON.parse(await workspace.read(CLIENT_FILE, '') || 'null') || {}; } catch { return {}; } };
  const writeClient = client => workspace.write(CLIENT_FILE, JSON.stringify(client, null, 2) + '\n');
  let discovery = null;
  async function openid() {
    if (discovery) return discovery;
    const response = await fetchImpl(CHATGPT_OPENID_CONFIGURATION_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('openid configuration unavailable');
    return (discovery = await response.json());
  }

  function stopAttempt() {
    if (!attempt) return;
    clearTimeout(attempt.timer);
    attempt.server.close(); attempt.server.closeAllConnections?.();
    attempt = null;
  }
  function finish(status, message, extra = {}) { last = { status, message, at: new Date(now()).toISOString(), ...extra }; stopAttempt(); }

  async function listen(server) {
    const tryPort = value => new Promise((resolve, reject) => {
      const onError = error => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(server.address().port); };
      server.once('error', onError); server.once('listening', onListening);
      server.listen(value, '127.0.0.1');
    });
    try { return await tryPort(port); }
    catch (error) { if (error.code === 'EADDRINUSE' && CHATGPT_ALLOW_OTHER_PORT && port !== 0) return tryPort(0); throw error; }
  }

  async function complete(current, query) {
    const client = await readClient();
    const returnedClient = query.get('client_id');
    const clientId = client.clientId || returnedClient;
    if (client.clientId && returnedClient && returnedClient !== client.clientId) throw new Error('This sign-in came back for a different app registration. Start again from Plainhand.');
    if (!clientId || clientId === CHATGPT_DYNAMIC_CLIENT_ID) throw new Error('ChatGPT did not finish registering Plainhand. Start again from Plainhand.');
    if (!client.clientId) await writeClient({ ...client, clientId, hostId: current.hostId });
    let response;
    try {
      response = await fetchImpl(CHATGPT_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: query.get('code') || '', code_verifier: current.verifier, redirect_uri: current.redirectUri, resource: CHATGPT_RESOURCE }).toString() });
    } catch { throw new Error('Plainhand could not reach ChatGPT. Check your internet connection and try again.'); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.access_token !== 'string') throw new Error('ChatGPT did not finish the sign-in. Start again from Plainhand.');
    const scopes = typeof body.scope === 'string' ? body.scope : query.get('scope') || '';
    if (!scopeList(scopes).includes(CHATGPT_PLAN_SCOPE)) { const error = new Error('You signed in, but did not allow Plainhand to use your ChatGPT plan. Sign in again and allow it.'); error.code = 'plan_use_off'; throw error; }
    let claims;
    try {
      const config = await openid();
      const jwksResponse = await fetchImpl(config.jwks_uri, { headers: { Accept: 'application/json' } });
      claims = verifyIdToken(body.id_token, await jwksResponse.json(), { issuer: CHATGPT_ISSUER, audience: clientId, nonce: current.nonce, now: now() });
    } catch { throw new Error('Plainhand could not confirm this ChatGPT sign-in. Start again from Plainhand.'); }
    await (await tokens()).save({ accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000, earliestRefreshAt: body.earliest_refresh_at ?? null, idToken: body.id_token, scopes, clientId, hostId: current.hostId, subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : null, issuer: claims.iss, tokenType: body.token_type || 'Bearer' });
    return typeof claims.email === 'string' ? claims.email : null;
  }

  async function handle(req, res, current) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, title, text) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(page(title, text)); };
    // sendAfter: the response must land before the sign-in attempt tears its one-shot
    // listener down (finish() closes every connection), or the browser sees a reset.
    const sendAfter = (status, title, text) => new Promise(resolve => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(page(title, text), () => resolve()); });
    if (req.method !== 'GET' || url.pathname !== CHATGPT_CALLBACK_PATH) return send(404, 'Not found', 'This address is only used to finish signing in with ChatGPT.');
    // A callback without this attempt's state is ignored; the real one can still arrive.
    if (!sameText(url.searchParams.get('state'), current.state)) return send(400, 'Sign-in link out of date', 'Start signing in again from Plainhand.');
    if (current.done) return send(409, 'Already finished', 'You can close this tab and return to Plainhand.');
    current.done = true;
    const error = url.searchParams.get('error');
    if (error) {
      await sendAfter(200, 'Sign-in not finished', 'Return to Plainhand to try again.');
      finish('failed', error === 'access_denied' ? 'You cancelled the ChatGPT sign-in.' : 'ChatGPT did not finish the sign-in. Try again.');
      return;
    }
    try {
      const email = await complete(current, url.searchParams);
      await sendAfter(200, 'You’re using your ChatGPT plan', 'Plainhand will use your ChatGPT plan for its AI work. You can manage this in ChatGPT settings. Close this tab and return to Plainhand.');
      finish('signed-in', 'Signed in with ChatGPT. Check that it works, then Plainhand will use it.', { email });
    } catch (failure) {
      await sendAfter(200, 'Sign-in not finished', `${failure.message.replace(/[<>&]/g, '')} You can close this tab.`);
      finish('failed', failure.message);
    }
  }

  return {
    // Starts a sign-in: a fresh state, nonce and PKCE verifier, and a one-shot listener
    // for the callback. Returns the URL to open in the candidate's browser.
    async start() {
      stopAttempt();
      const client = await readClient();
      const hostId = client.hostId || `urn:uuid:${randomUUID()}`;
      if (!client.hostId) await writeClient({ ...client, hostId });
      const current = { state: base64url(randomBytes(32)), nonce: base64url(randomBytes(32)), verifier: base64url(randomBytes(48)), hostId, done: false };
      current.server = http.createServer((req, res) => { handle(req, res, current).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } }); });
      const actualPort = await listen(current.server);
      current.redirectUri = `http://127.0.0.1:${actualPort}${CHATGPT_CALLBACK_PATH}`;
      current.timer = setTimeout(() => { if (attempt === current) finish('failed', 'The ChatGPT sign-in timed out. Try again.'); }, SIGN_IN_TIMEOUT_MS);
      current.timer.unref?.();
      attempt = current; last = null;
      const params = new URLSearchParams({
        client_id: client.clientId || CHATGPT_DYNAMIC_CLIENT_ID,
        ...(client.clientId ? {} : { agent_name_hint: CHATGPT_AGENT_NAME_HINT }),
        ext_agent_host_id: hostId, response_type: 'code', redirect_uri: current.redirectUri, scope: CHATGPT_SCOPES,
        resource: CHATGPT_RESOURCE, state: current.state, nonce: current.nonce, code_challenge_method: 'S256', code_challenge: pkceChallenge(current.verifier),
      });
      return { status: 'waiting', url: `${CHATGPT_AUTHORIZE_URL}?${params}`, message: 'Finish signing in with ChatGPT in your browser.' };
    },
    async status() {
      const info = await (await tokens()).info();
      if (attempt) return { status: 'waiting', message: 'Finish signing in with ChatGPT in your browser.', email: info.email || null };
      if (info.signedIn) return { status: 'signed-in', email: info.email || null, message: last?.status === 'signed-in' ? last.message : 'Signed in with ChatGPT.' };
      if (last?.status === 'failed') return { status: 'failed', message: last.message };
      return { status: 'signed-out', message: info.unreadable ? 'Sign in with ChatGPT again.' : 'Not signed in.' };
    },
    // Revokes the session at OpenAI when possible and always forgets it here.
    async signOut() {
      stopAttempt();
      const store = await tokens();
      const session = await store.revocation();
      let confirmed = !session;
      if (session) {
        for (let tries = 0; tries < 2 && !confirmed; tries++) {
          try {
            const { revocation_endpoint: endpoint } = await openid();
            if (!endpoint) break;
            const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.refreshToken, token_type_hint: 'refresh_token', client_id: session.clientId }).toString() });
            if (response.ok) confirmed = true; else if (response.status < 500) break;
          } catch {}
        }
      }
      await store.clear();
      last = null;
      return { status: 'signed-out', message: confirmed ? 'Signed out of ChatGPT.' : 'Signed out on this computer. OpenAI did not confirm it, so you can also disconnect Plainhand in ChatGPT settings.' };
    },
    // The agent for executeAgent's 'chatgpt' provider.
    agent(provider, instruction, data, options) {
      return (async () => { agent ||= createChatgptAgent({ tokens: await tokens(), fetchImpl }); return agent(provider, instruction, data, options); })();
    },
    close: stopAttempt,
  };
}
