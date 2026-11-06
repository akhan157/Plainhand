// OAuth 2.1 authorization server for hosted Plainhand (docs/HOSTED-CONNECTOR-PLAN.md §3, §6).
// Clients: ChatGPT and Claude (MCP connectors) and the Plainhand browser extension (public
// client). Implements RFC 8414 / 9728 metadata, RFC 7591 dynamic registration, Client ID
// Metadata Documents, authorization code + PKCE (S256 only), RFC 8707 resource indicators,
// RFC 9207 `iss` on every authorization response, rotating refresh tokens with reuse
// detection, and RFC 7009 revocation. Tokens, codes and secrets are stored only as hashes
// in plainhand.oauth_* (plainhand/cloud/schema.sql).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export const SCOPE = 'plainhand';
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
export const CODE_SECONDS = 60;
const MAX_BODY = 64 * 1024;
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_TIMEOUT_MS = 5000;
const CIMD_DEFAULT_TTL = 5 * 60 * 1000;
const CIMD_MAX_TTL = 24 * 60 * 60 * 1000;
const CIMD_CACHE_ENTRIES = 500;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const token = prefix => prefix + randomBytes(32).toString('base64url');
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const quoted = value => String(value).replace(/["\\]/g, '\\$&').replace(/[\r\n]/g, ' ');

class OAuthError extends Error {
  constructor(error, description, status = 400) { super(description); this.error = error; this.status = status; }
}

// 401 for the protected resource (/mcp, extension API). ChatGPT needs both error and
// error_description before it shows its sign-in button.
export function unauthorized(res, { resourceMetadataUrl, error = 'invalid_token', description = 'Sign in to Plainhand to continue.', scope } = {}) {
  const parts = [`resource_metadata="${quoted(resourceMetadataUrl)}"`];
  if (scope) parts.push(`scope="${quoted(scope)}"`);
  parts.push(`error="${quoted(error)}"`, `error_description="${quoted(description)}"`);
  const header = 'Bearer ' + parts.join(', ');
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'WWW-Authenticate': header });
  res.end(JSON.stringify({ error, error_description: description }));
  return header;
}

// Redirect URIs: https anywhere, or http only on the loopback interface (RFC 8252).
export function validRedirectUri(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) return false;
  let url; try { url = new URL(value); } catch { return false; }
  if (url.hash || value.includes('#') || url.username || url.password) return false;
  if (url.protocol === 'https:') return Boolean(url.hostname);
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

// Exact match, except that a loopback redirect may use any port (OAuth 2.1 §8.4.2).
export function redirectMatches(registered, given) {
  if (typeof given !== 'string') return false;
  if (registered.includes(given)) return true;
  let g; try { g = new URL(given); } catch { return false; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some(r => {
    let u; try { u = new URL(r); } catch { return false; }
    if (u.protocol !== 'http:' || u.hostname !== g.hostname) return false;
    u.port = g.port;
    return u.href === g.href;
  });
}

// RFC 8707 resource comparison: scheme and host are case-insensitive, a trailing slash is ignored.
function canonicalResource(value) {
  try {
    const url = new URL(value);
    if (url.hash || value.includes('#')) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch { return null; }
}

function isCimdUrl(value) { return typeof value === 'string' && value.startsWith('https://'); }

// The CIMD draft: https, a path, no fragment, no credentials, no dot segments. We also
// refuse hosts that point at this machine or a private network by name or literal address.
function checkCimdUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  if (url.href !== value || url.protocol !== 'https:' || url.hash || url.username || url.password) return false;
  if (!url.pathname || url.pathname === '/' || /\/\.\.?(\/|$)/.test(value.slice(url.origin.length))) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return false;
  return true;
}

// A public-looking name can still resolve inside the server's network (directly, or
// through DNS rebinding on a second lookup). Resolve before fetching and refuse every
// address that is not global unicast; a lookup that fails is treated as refused.
const privateV4 = value => {
  const [a, b] = value.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};
export function privateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (isIP(value) === 4) return privateV4(value);
  if (isIP(value) !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value); // IPv4-mapped (::ffff:10.0.0.1)
  if (mapped) return privateV4(mapped[1]);
  if (value === '::' || value === '::1') return true;
  const first = parseInt(value.split(':')[0] || '0', 16);
  // fc00::/7 unique local, fe80::/10 link local, ff00::/8 multicast, 64:ff9b::/96 NAT64 (may reach IPv4 inside).
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || value.startsWith('64:ff9b:');
}
export async function resolvesPublicly(host, lookupImpl = dnsLookup) {
  try {
    const results = await lookupImpl(host, { all: true, verbatim: true });
    if (!results?.length || results.some(r => privateAddress(r.address))) return false;
    return true;
  } catch { return false; }
}

async function readCapped(response, cap) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > cap) throw new Error('too large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > cap) throw new Error('too large');
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { reader.cancel().catch(() => {}); throw new Error('too large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function cacheTtl(response) {
  const match = /max-age=(\d+)/i.exec(response.headers?.get?.('cache-control') || '');
  if (/no-store/i.test(response.headers?.get?.('cache-control') || '')) return 0;
  return match ? Math.min(Number(match[1]) * 1000, CIMD_MAX_TTL) : CIMD_DEFAULT_TTL;
}

function clientName(value, fallback) {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
  return name || fallback;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return { raw: String(req.body) };
    return { parsed: req.body }; // already parsed by the host (Vercel)
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new OAuthError('invalid_request', 'The request is too large.', 413);
    chunks.push(Buffer.from(chunk));
  }
  return { raw: Buffer.concat(chunks).toString('utf8') };
}

// Form or JSON body → { key: string }. A repeated parameter is an error (RFC 6749 §3.1).
async function readParams(req) {
  const body = await readBody(req);
  const type = String(req.headers['content-type'] || '').toLowerCase();
  let source;
  if (body.parsed) {
    if (type.includes('application/json')) return body.parsed;
    source = Object.entries(body.parsed);
  } else if (type.includes('application/json')) {
    let parsed; try { parsed = JSON.parse(body.raw || '{}'); } catch { throw new OAuthError('invalid_request', 'The request body is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OAuthError('invalid_request', 'The request body must be a JSON object.');
    return parsed;
  } else source = [...new URLSearchParams(body.raw || '')];
  return toParams(source);
}

function toParams(entries) {
  const out = {};
  for (const [key, value] of entries) {
    if (Object.hasOwn(out, key) || Array.isArray(value)) throw new OAuthError('invalid_request', `The parameter ${key} was sent more than once.`);
    out[key] = value;
  }
  return out;
}

function str(params, key) {
  const value = params[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new OAuthError('invalid_request', `The parameter ${key} must be a string.`);
  return value;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...headers });
  res.end(JSON.stringify(body));
  return true;
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const CORS_PREFLIGHT = { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version', 'Access-Control-Max-Age': '600' };

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function page(res, status, title, bodyHtml, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // No framing: the Allow button must never be clickjacked. No form-action: Chrome would
    // block the redirect back to the app.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#f7f7f5;color:#1c1c1a}main{max-width:480px;margin:40px auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:24px}h1{font-size:1.3rem;margin:0 0 12px}.small{color:#555;font-size:.9rem}.row{display:flex;gap:12px;margin-top:20px}button{font:inherit;padding:10px 20px;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer}button.allow{background:#1c1c1a;color:#fff;border-color:#1c1c1a}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}main{background:#222;border-color:#444}.small{color:#bbb}button{background:#333;color:#eee}button.allow{background:#eee;color:#111}}</style>
</head><body><main>${bodyHtml}</main></body></html>`);
  return true;
}

export function createOAuthServer({ sql, issuer, resource, sessionUser, now = () => new Date(), fetchImpl = globalThis.fetch, lookupImpl = dnsLookup, extensionIds = [], limits = {} }) {
  if (!sql || !issuer || !resource || typeof sessionUser !== 'function') throw new Error('createOAuthServer needs sql, issuer, resource and sessionUser.');
  const base = issuer.replace(/\/+$/, '');
  const issuerUrl = new URL(issuer);
  const resourceUrl = new URL(resource);
  const canonical = canonicalResource(resource);
  // Two audiences. Chat connectors (ChatGPT, Claude) get tokens for `resource` (/mcp);
  // the browser extension gets tokens for the extension API, which can record "I submitted".
  // A client is the extension only when every redirect is a browser-identity address
  // (Chrome/Edge: <id>.chromiumapp.org, Firefox: <id>.extensions.allizom.org), which only
  // that installed extension can receive; when extensionIds is set, only those ids count.
  const extensionResource = issuer.replace(/\/+$/, '') + '/api/extension';
  const extensionCanonical = canonicalResource(extensionResource);
  const allowedExtensionIds = new Set((extensionIds || []).map(id => String(id).toLowerCase()));
  const isExtensionClient = client => Array.isArray(client?.redirectUris) && client.redirectUris.length > 0 && client.redirectUris.every(uri => {
    let url; try { url = new URL(uri); } catch { return false; }
    const match = /^([a-z0-9-]+)\.(chromiumapp\.org|extensions\.allizom\.org)$/.exec(url.hostname);
    return url.protocol === 'https:' && Boolean(match) && (!allowedExtensionIds.size || allowedExtensionIds.has(match[1]));
  });
  const resourceFor = client => (isExtensionClient(client) ? extensionResource : resource);
  const secureCookie = issuerUrl.protocol === 'https:';
  const csrfCookie = secureCookie ? '__Host-plainhand_oauth' : 'plainhand_oauth';
  const registrationPerIp = limits.registrationsPerIpPerHour ?? 20;
  const registrationGlobal = limits.registrationsPerHour ?? 500;
  const clock = () => { const t = now(); return t instanceof Date ? t : new Date(t); };
  const later = seconds => new Date(clock().getTime() + seconds * 1000);
  const cimdCache = new Map();

  const resourcePath = resourceUrl.pathname.replace(/\/+$/, '');
  const issuerPath = issuerUrl.pathname.replace(/\/+$/, '');
  const resourceMetadataPaths = new Set(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource' + resourcePath]);
  const extensionMetadataPath = '/.well-known/oauth-protected-resource/api/extension';
  const serverMetadataPaths = new Set(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server' + issuerPath, '/.well-known/openid-configuration']);
  const resourceMetadataUrl = `${resourceUrl.origin}/.well-known/oauth-protected-resource${resourcePath}`;
  const endpoint = path => base + path;

  const protectedResourceMetadata = () => ({
    resource, authorization_servers: [issuer], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Plainhand',
  });
  const serverMetadata = () => ({
    issuer,
    authorization_endpoint: endpoint('/oauth/authorize'),
    token_endpoint: endpoint('/oauth/token'),
    registration_endpoint: endpoint('/oauth/register'),
    revocation_endpoint: endpoint('/oauth/revoke'),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  });

  // ---------- clients ----------

  async function storedClient(clientId) {
    if (typeof clientId !== 'string' || clientId.length > 2000) return null;
    const [row] = await sql`select client_id, client_secret_hash, client_name, redirect_uris, metadata from plainhand.oauth_clients where client_id = ${clientId}`;
    return row ? { clientId: row.client_id, secretHash: row.client_secret_hash, name: row.client_name, redirectUris: row.redirect_uris, metadata: row.metadata, cimd: isCimdUrl(row.client_id) } : null;
  }

  // Fetches and validates a Client ID Metadata Document. Throws OAuthError with a
  // plain-language description; the caller shows it on a page (never redirects).
  async function metadataDocumentClient(url) {
    const cached = cimdCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.client;
    if (!checkCimdUrl(url)) throw new OAuthError('invalid_client', 'This app\'s address is not one Plainhand can use.');
    if (!await resolvesPublicly(new URL(url).hostname, lookupImpl)) throw new OAuthError('invalid_client', 'This app\'s address is not one Plainhand can use.');
    let response, text;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(CIMD_TIMEOUT_MS) });
      if (response.status !== 200) throw new Error('status ' + response.status);
      text = await readCapped(response, CIMD_MAX_BYTES);
    } catch {
      throw new OAuthError('invalid_client', 'Plainhand could not reach this app to check who it is. Try again in a minute.');
    }
    let doc; try { doc = JSON.parse(text); } catch { doc = null; }
    const invalid = () => new OAuthError('invalid_client', 'This app described itself in a way Plainhand cannot accept.');
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.client_id !== url) throw invalid();
    if (!Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || !doc.redirect_uris.every(validRedirectUri)) throw invalid();
    if (doc.client_secret !== undefined || doc.client_secret_expires_at !== undefined) throw invalid();
    // We only support public CIMD clients ("none"); private_key_jwt is not implemented.
    const methods = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported
      : [doc.token_endpoint_auth_method || 'none'];
    if (!methods.includes('none')) throw invalid();
    if (doc.response_types !== undefined && !(Array.isArray(doc.response_types) && doc.response_types.includes('code'))) throw invalid();
    const client = {
      clientId: url, secretHash: null, cimd: true, redirectUris: doc.redirect_uris,
      name: clientName(doc.client_name, new URL(url).hostname),
      metadata: { client_name: doc.client_name, client_uri: doc.client_uri, logo_uri: doc.logo_uri, redirect_uris: doc.redirect_uris, token_endpoint_auth_method: 'none', source: 'client_id_metadata_document' },
    };
    const ttl = cacheTtl(response);
    if (ttl > 0) {
      if (cimdCache.size >= CIMD_CACHE_ENTRIES) cimdCache.delete(cimdCache.keys().next().value);
      cimdCache.set(url, { client, expires: Date.now() + ttl });
    }
    return client;
  }

  async function resolveClient(clientId) {
    if (isCimdUrl(clientId)) return metadataDocumentClient(clientId);
    return storedClient(clientId);
  }

  // CIMD clients get a row on first approval so grants can reference them; the row is
  // refreshed with the latest document each time.
  async function persistClient(db, client) {
    if (!client.cimd) return;
    await db`insert into plainhand.oauth_clients (client_id, client_name, redirect_uris, metadata)
      values (${client.clientId}, ${client.name}, ${client.redirectUris}, ${sql.json(client.metadata)})
      on conflict (client_id) do update set client_name = excluded.client_name, redirect_uris = excluded.redirect_uris, metadata = excluded.metadata`;
  }

  // Token and revocation endpoint client authentication.
  async function authenticateClient(req, params) {
    let clientId = str(params, 'client_id'), secret = str(params, 'client_secret'), basic = false;
    const header = String(req.headers.authorization || '');
    if (/^basic /i.test(header)) {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i < 0 || secret) throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
      let id, pass;
      try { id = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, ' ')); pass = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, ' ')); }
      catch { throw new OAuthError('invalid_client', 'Client authentication failed.', 401); }
      if (clientId && clientId !== id) throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
      clientId = id; secret = pass; basic = true;
    }
    if (!clientId) throw new OAuthError('invalid_client', 'client_id is required.', 401);
    const client = await storedClient(clientId);
    const fail = () => Object.assign(new OAuthError('invalid_client', 'Client authentication failed.', 401), { basic });
    if (!client) throw fail();
    if (client.secretHash) {
      if (!secret || !sameSecret(sha256(secret), client.secretHash)) throw fail();
    } else if (secret) throw fail();
    return client;
  }

  // ---------- grants, codes, tokens ----------

  async function revokeGrantRow(db, grantId) {
    await db`update plainhand.oauth_grants set revoked_at = ${clock()} where id = ${grantId} and revoked_at is null`;
    await db`delete from plainhand.oauth_tokens where grant_id = ${grantId}`;
    await db`delete from plainhand.oauth_codes where grant_id = ${grantId}`;
  }

  async function issueTokens(db, grant, tokenResource) {
    const access = token('pha_'), refresh = token('phr_'), at = clock();
    await db`insert into plainhand.oauth_tokens (token_hash, grant_id, kind, resource, expires_at, created_at) values
      (${sha256(access)}, ${grant.id}, 'access', ${tokenResource}, ${later(ACCESS_TOKEN_SECONDS)}, ${at}),
      (${sha256(refresh)}, ${grant.id}, 'refresh', ${tokenResource}, ${later(REFRESH_TOKEN_SECONDS)}, ${at})`;
    // Housekeeping for this grant only. Used codes stay until they expire so reuse is detected.
    await db`delete from plainhand.oauth_tokens where grant_id = ${grant.id} and expires_at < ${at}`;
    await db`delete from plainhand.oauth_codes where grant_id = ${grant.id} and expires_at < ${at}`;
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope: grant.scope || SCOPE };
  }

  function checkResourceParam(value, expected) {
    if (value === undefined) return;
    if (canonicalResource(value) !== canonicalResource(expected)) throw new OAuthError('invalid_target', 'This app can only get tokens for ' + expected + '.');
  }

  async function exchangeCode(req, params) {
    const client = await authenticateClient(req, params);
    const code = str(params, 'code'), redirectUri = str(params, 'redirect_uri'), verifier = str(params, 'code_verifier');
    if (!code) throw new OAuthError('invalid_request', 'code is required.');
    if (!redirectUri) throw new OAuthError('invalid_request', 'redirect_uri is required.');
    if (!verifier) throw new OAuthError('invalid_request', 'code_verifier is required.');
    const at = clock();
    return sql.begin(async tx => {
      const [row] = await tx`select c.code_hash, c.redirect_uri, c.code_challenge, c.resource, c.expires_at, c.used_at,
          g.id, g.client_id, g.scope, g.revoked_at
        from plainhand.oauth_codes c join plainhand.oauth_grants g on g.id = c.grant_id
        where c.code_hash = ${sha256(code)} for update of c`;
      if (!row || row.client_id !== client.clientId) return { error: new OAuthError('invalid_grant', 'The authorization code is not valid.') };
      if (row.used_at) {
        // A code used twice may have been stolen: end everything issued from this grant.
        await revokeGrantRow(tx, row.id);
        return { error: new OAuthError('invalid_grant', 'The authorization code was already used.') };
      }
      if (row.expires_at <= at || row.revoked_at) return { error: new OAuthError('invalid_grant', 'The authorization code has expired.') };
      if (row.redirect_uri !== redirectUri) return { error: new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request.') };
      if (!VERIFIER.test(verifier) || !sameSecret(createHash('sha256').update(verifier).digest('base64url'), row.code_challenge)) {
        return { error: new OAuthError('invalid_grant', 'The code verifier does not match.') };
      }
      try { checkResourceParam(str(params, 'resource'), row.resource || resource); } catch (error) { return { error }; }
      await tx`update plainhand.oauth_codes set used_at = ${at} where code_hash = ${row.code_hash}`;
      return { tokens: await issueTokens(tx, row, row.resource || resource) };
    });
  }

  async function refreshTokens(req, params) {
    const client = await authenticateClient(req, params);
    const refresh = str(params, 'refresh_token');
    if (!refresh) throw new OAuthError('invalid_request', 'refresh_token is required.');
    const at = clock();
    return sql.begin(async tx => {
      const [row] = await tx`select t.token_hash, t.resource, t.expires_at, t.used_at, g.id, g.client_id, g.scope, g.revoked_at
        from plainhand.oauth_tokens t join plainhand.oauth_grants g on g.id = t.grant_id
        where t.token_hash = ${sha256(refresh)} and t.kind = 'refresh' for update of t`;
      const invalid = () => ({ error: new OAuthError('invalid_grant', 'The refresh token is not valid.') });
      if (!row || row.client_id !== client.clientId || row.revoked_at) return invalid();
      if (row.used_at) {
        // Reuse of a rotated refresh token: someone else may hold it. End the connection.
        await revokeGrantRow(tx, row.id);
        return invalid();
      }
      if (row.expires_at <= at) return invalid();
      try { checkResourceParam(str(params, 'resource'), row.resource || resource); } catch (error) { return { error }; }
      await tx`update plainhand.oauth_tokens set used_at = ${at} where token_hash = ${row.token_hash}`;
      return { tokens: await issueTokens(tx, row, row.resource || resource) };
    });
  }

  // ---------- authorization endpoint ----------

  function authorizationRedirect(redirectUri, params) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    url.searchParams.set('iss', issuer);
    return url.toString();
  }

  // Returns { page } (show an error, never redirect: the client or redirect is not
  // trusted), { redirect } (error sent back to the client), or { request }.
  async function validateAuthorization(params) {
    const clientId = str(params, 'client_id'), redirectUri = str(params, 'redirect_uri'), state = str(params, 'state');
    if (!clientId) return { page: 'This sign-in link is missing the app it belongs to. Start again from the app.' };
    let client;
    try { client = await resolveClient(clientId); }
    catch (error) { return { page: error instanceof OAuthError ? error.message : 'Plainhand could not check this app. Try again in a minute.' }; }
    if (!client) return { page: 'This app is not registered with Plainhand. Start again from the app.' };
    if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { page: 'This app asked to send you to an address it did not register, so Plainhand stopped. Start again from the app.' };
    const back = (error, description) => ({ redirect: authorizationRedirect(redirectUri, { error, error_description: description, state }) });
    if (str(params, 'response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    const challenge = str(params, 'code_challenge');
    if (!challenge) return back('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256.');
    if (str(params, 'code_challenge_method') !== 'S256') return back('invalid_request', 'Only code_challenge_method=S256 is supported.');
    if (!CHALLENGE.test(challenge)) return back('invalid_request', 'code_challenge is not a valid S256 challenge.');
    const requestedResource = str(params, 'resource'), audience = resourceFor(client);
    if (requestedResource !== undefined && canonicalResource(requestedResource) !== canonicalResource(audience)) return back('invalid_target', 'This app can only get tokens for ' + audience + '.');
    // Plainhand has one scope; unknown requested scopes are ignored (RFC 6749 §3.3).
    return { request: { client, redirectUri, state, challenge, resource: audience, scope: SCOPE } };
  }

  async function signinRedirect(res, params) {
    const next = '/oauth/authorize?' + new URLSearchParams(Object.entries(params).filter(([k, v]) => typeof v === 'string' && k !== 'csrf' && k !== 'decision')).toString();
    res.writeHead(302, { Location: '/signin?next=' + encodeURIComponent(next), 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }

  function errorPage(res, message, status = 400) {
    return page(res, status, 'Plainhand', `<h1>Plainhand could not connect this app</h1><p>${escapeHtml(message)}</p>`);
  }

  async function authorizeGet(req, res, params) {
    const result = await validateAuthorization(params);
    if (result.page) return errorPage(res, result.page);
    if (result.redirect) { res.writeHead(302, { Location: result.redirect, 'Cache-Control': 'no-store' }); res.end(); return true; }
    const userId = await sessionUser(req);
    if (!userId) return signinRedirect(res, params);
    const { client, redirectUri } = result.request;
    const csrf = randomBytes(24).toString('base64url');
    const hidden = Object.entries(params).filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
    const name = escapeHtml(client.name || new URL(redirectUri).hostname);
    const cookie = `${csrfCookie}=${csrf}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureCookie ? '; Secure' : ''}`;
    return page(res, 200, `Connect ${client.name || 'app'} to Plainhand`, `<h1>Let ${name} use your Plainhand workspace?</h1>
<p>${isExtensionClient(client)
    ? 'It can save jobs you find, fill application forms you open, and record when you tell it you submitted. It never submits an application or approves one for you.'
    : 'It can read your roles and profile and save changes you ask for. It can never approve applications or mark them submitted.'}</p>
<p class="small">You will go back to ${escapeHtml(new URL(redirectUri).host)}. You can disconnect it any time from Connected apps.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${csrf}">
<div class="row"><button class="allow" type="submit" name="decision" value="allow">Allow</button><button type="submit" name="decision" value="cancel">Cancel</button></div></form>`, { 'Set-Cookie': cookie });
  }

  async function authorizePost(req, res) {
    const params = await readParams(req);
    const origin = req.headers.origin;
    const cookies = parseCookies(req.headers.cookie);
    const csrf = str(params, 'csrf');
    const clearCookie = `${csrfCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`;
    if ((origin && origin !== 'null' && origin !== issuerUrl.origin) || !csrf || !cookies[csrfCookie] || !sameSecret(csrf, cookies[csrfCookie])) {
      return errorPage(res, 'This page expired or was opened from somewhere else. Start again from the app.', 403);
    }
    const userId = await sessionUser(req);
    if (!userId) return signinRedirect(res, params);
    const result = await validateAuthorization(params);
    if (result.page) return errorPage(res, result.page);
    const send = location => { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie }); res.end(); return true; };
    if (result.redirect) return send(result.redirect);
    const { client, redirectUri, state, challenge, scope } = result.request;
    if (str(params, 'decision') !== 'allow') {
      return send(authorizationRedirect(redirectUri, { error: 'access_denied', error_description: 'The candidate chose Cancel.', state }));
    }
    const code = token('phc_');
    await sql.begin(async tx => {
      await persistClient(tx, client);
      const [grant] = await tx`insert into plainhand.oauth_grants (id, user_id, client_id, scope) values (${randomUUID()}, ${userId}, ${client.clientId}, ${scope})
        on conflict (user_id, client_id) do update set revoked_at = null, scope = excluded.scope returning id`;
      await tx`insert into plainhand.oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at)
        values (${sha256(code)}, ${grant.id}, ${redirectUri}, ${challenge}, ${result.request.resource}, ${later(CODE_SECONDS)})`;
    });
    return send(authorizationRedirect(redirectUri, { code, state }));
  }

  // ---------- registration (RFC 7591) ----------

  async function register(req, res) {
    const meta = await readParams(req);
    const fail = (error, description) => sendJson(res, 400, { error, error_description: description }, CORS);
    const redirectUris = meta.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10) return fail('invalid_redirect_uri', 'redirect_uris must list one to ten addresses.');
    if (!redirectUris.every(validRedirectUri)) return fail('invalid_redirect_uri', 'Each redirect URI must use https, or http on 127.0.0.1 or localhost, with no fragment.');
    const method = meta.token_endpoint_auth_method ?? 'client_secret_basic'; // RFC 7591 §2 default
    if (!AUTH_METHODS.includes(method)) return fail('invalid_client_metadata', 'token_endpoint_auth_method must be one of ' + AUTH_METHODS.join(', ') + '.');
    const grantTypes = meta.grant_types ?? ['authorization_code', 'refresh_token'];
    if (!Array.isArray(grantTypes) || !grantTypes.every(g => g === 'authorization_code' || g === 'refresh_token')) return fail('invalid_client_metadata', 'grant_types may only include authorization_code and refresh_token.');
    const responseTypes = meta.response_types ?? ['code'];
    if (!Array.isArray(responseTypes) || responseTypes.some(r => r !== 'code')) return fail('invalid_client_metadata', 'response_types may only include code.');
    if (meta.client_name !== undefined && typeof meta.client_name !== 'string') return fail('invalid_client_metadata', 'client_name must be text.');
    for (const key of ['client_uri', 'logo_uri']) {
      if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !/^https:\/\//.test(meta[key]) || meta[key].length > 2000)) return fail('invalid_client_metadata', key + ' must be an https address.');
    }

    const at = clock(), hourAgo = new Date(at.getTime() - 3600_000), ipHash = sha256('register:' + clientIp(req));
    const [{ fromIp, total }] = await sql`select count(*) filter (where registered_ip_hash = ${ipHash})::int as "fromIp", count(*)::int as total
      from plainhand.oauth_clients where created_at > ${hourAgo}`;
    if (fromIp >= registrationPerIp || total >= registrationGlobal) {
      return sendJson(res, 429, { error: 'too_many_requests', error_description: 'Too many apps registered recently. Try again later.' }, { ...CORS, 'Retry-After': '3600' });
    }

    const clientId = 'ph_' + randomBytes(16).toString('base64url');
    const secret = method === 'none' ? null : 'phs_' + randomBytes(32).toString('base64url');
    const name = clientName(meta.client_name, new URL(redirectUris[0]).hostname);
    const stored = {
      client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: method, grant_types: grantTypes, response_types: responseTypes,
      ...(meta.client_uri ? { client_uri: meta.client_uri } : {}), ...(meta.logo_uri ? { logo_uri: meta.logo_uri } : {}),
      ...(typeof meta.software_id === 'string' ? { software_id: meta.software_id.slice(0, 200) } : {}),
      ...(typeof meta.software_version === 'string' ? { software_version: meta.software_version.slice(0, 100) } : {}),
    };
    await sql`insert into plainhand.oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, metadata, created_at, registered_ip_hash)
      values (${clientId}, ${secret ? sha256(secret) : null}, ${name}, ${redirectUris}, ${sql.json(stored)}, ${at}, ${ipHash})`;
    return sendJson(res, 201, {
      client_id: clientId, client_id_issued_at: Math.floor(at.getTime() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      ...stored,
    }, CORS);
  }

  // ---------- token and revocation endpoints ----------

  async function tokenEndpoint(req, res) {
    const params = await readParams(req);
    const grantType = str(params, 'grant_type');
    let result;
    if (grantType === 'authorization_code') result = await exchangeCode(req, params);
    else if (grantType === 'refresh_token') result = await refreshTokens(req, params);
    else throw new OAuthError(grantType ? 'unsupported_grant_type' : 'invalid_request', grantType ? 'Only authorization_code and refresh_token are supported.' : 'grant_type is required.');
    if (result.error) throw result.error;
    return sendJson(res, 200, result.tokens, CORS);
  }

  async function revokeEndpoint(req, res) {
    const params = await readParams(req);
    const client = await authenticateClient(req, params);
    const value = str(params, 'token');
    if (!value) throw new OAuthError('invalid_request', 'token is required.');
    await sql.begin(async tx => {
      const [row] = await tx`select t.kind, t.grant_id, g.client_id from plainhand.oauth_tokens t join plainhand.oauth_grants g on g.id = t.grant_id
        where t.token_hash = ${sha256(value)}`;
      // RFC 7009 §2.2: an unknown token, or one issued to another client, gets 200 with no effect.
      if (!row || row.client_id !== client.clientId) return;
      // Revoking a refresh token ends the whole grant (RFC 7009 §2.1); an access token only itself.
      if (row.kind === 'refresh') await revokeGrantRow(tx, row.grant_id);
      else await tx`delete from plainhand.oauth_tokens where token_hash = ${sha256(value)}`;
    });
    res.writeHead(200, { 'Cache-Control': 'no-store', ...CORS });
    res.end();
    return true;
  }

  // ---------- public API ----------

  async function handle(req, res) {
    let path;
    try { path = new URL(req.url, base).pathname; } catch { return false; }
    const method = String(req.method || 'GET').toUpperCase();
    const known = resourceMetadataPaths.has(path) || path === extensionMetadataPath || serverMetadataPaths.has(path) || ['/oauth/register', '/oauth/authorize', '/oauth/token', '/oauth/revoke'].includes(path);
    if (!known) return false;
    const notAllowed = allow => { res.writeHead(405, { Allow: allow, 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Method not allowed.' })); return true; };
    if (method === 'OPTIONS' && path !== '/oauth/authorize') { res.writeHead(204, CORS_PREFLIGHT); res.end(); return true; }
    try {
      if (resourceMetadataPaths.has(path)) return method === 'GET' || method === 'HEAD' ? sendJson(res, 200, protectedResourceMetadata(), { ...CORS, 'Cache-Control': 'public, max-age=300' }) : notAllowed('GET');
      if (path === extensionMetadataPath) return method === 'GET' || method === 'HEAD' ? sendJson(res, 200, { ...protectedResourceMetadata(), resource: extensionResource, resource_name: 'Plainhand extension' }, { ...CORS, 'Cache-Control': 'public, max-age=300' }) : notAllowed('GET');
      if (serverMetadataPaths.has(path)) return method === 'GET' || method === 'HEAD' ? sendJson(res, 200, serverMetadata(), { ...CORS, 'Cache-Control': 'public, max-age=300' }) : notAllowed('GET');
      if (path === '/oauth/authorize') {
        if (method === 'GET') {
          let params;
          try { params = toParams(new URL(req.url, base).searchParams); }
          catch (error) { return errorPage(res, 'This sign-in link is not valid. Start again from the app.'); }
          return await authorizeGet(req, res, params);
        }
        if (method === 'POST') return await authorizePost(req, res);
        return notAllowed('GET, POST');
      }
      if (method !== 'POST') return notAllowed('POST');
      if (path === '/oauth/register') return await register(req, res);
      if (path === '/oauth/token') return await tokenEndpoint(req, res);
      return await revokeEndpoint(req, res);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (path === '/oauth/authorize') return errorPage(res, 'This sign-in request is not valid. Start again from the app.', error.status);
      const headers = { ...CORS };
      if (error.status === 401 && error.basic) headers['WWW-Authenticate'] = 'Basic realm="plainhand"';
      return sendJson(res, error.status, { error: error.error, error_description: error.message }, headers);
    }
  }

  async function verifyAccessToken(value) {
    if (typeof value !== 'string' || !value.startsWith('pha_') || value.length > 200) return null;
    const at = clock();
    const [row] = await sql`select g.id, g.user_id, g.client_id, g.scope, t.resource from plainhand.oauth_tokens t join plainhand.oauth_grants g on g.id = t.grant_id
      where t.token_hash = ${sha256(value)} and t.kind = 'access' and t.expires_at > ${at} and g.revoked_at is null`;
    const tokenAudience = row ? canonicalResource(row.resource || resource) : null;
    const audience = tokenAudience === canonical ? 'mcp' : tokenAudience === extensionCanonical ? 'extension' : null;
    if (!row || !audience) return null;
    const minuteAgo = new Date(at.getTime() - 60_000);
    await sql`update plainhand.oauth_grants set last_used_at = ${at} where id = ${row.id} and (last_used_at is null or last_used_at < ${minuteAgo})`;
    return { userId: row.user_id, grantId: row.id, clientId: row.client_id, scope: row.scope, audience };
  }

  async function listGrants(userId) {
    if (!UUID.test(String(userId))) return [];
    const rows = await sql`select g.id, g.client_id, g.scope, g.created_at, g.last_used_at, c.client_name, c.redirect_uris
      from plainhand.oauth_grants g join plainhand.oauth_clients c on c.client_id = g.client_id
      where g.user_id = ${userId} and g.revoked_at is null order by g.created_at`;
    return rows.map(row => ({
      grantId: row.id, clientId: row.client_id, clientName: row.client_name || new URL(row.redirect_uris[0]).hostname,
      scope: row.scope, createdAt: row.created_at, lastUsedAt: row.last_used_at,
    }));
  }

  async function revokeGrant(userId, grantId) {
    if (!UUID.test(String(userId)) || !UUID.test(String(grantId))) return false;
    return sql.begin(async tx => {
      const [row] = await tx`select id from plainhand.oauth_grants where id = ${grantId} and user_id = ${userId} and revoked_at is null for update`;
      if (!row) return false;
      await revokeGrantRow(tx, row.id);
      return true;
    });
  }

  return { handle, verifyAccessToken, listGrants, revokeGrant, resourceMetadataUrl, extensionResource, metadata: { server: serverMetadata, resource: protectedResourceMetadata } };
}
