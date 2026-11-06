// Sign in with ChatGPT: the agent that calls OpenAI's Responses API with the
// candidate's ChatGPT plan token, and the encrypted store for those tokens.
// Shared by the local app (plainhand/chatgpt-local.mjs) and hosted Plainhand.
// Follows OpenAI's open-source token-sharing preview rules:
// https://developers.openai.com/siwc/token-sharing-open-source
// Tokens are never logged, never put in URLs and never returned to a browser.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AGENT_PREAMBLE, agentTask, parseAgentJson, sayStream } from '../agents.mjs';

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const CHATGPT_OPENID_CONFIGURATION_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const CHATGPT_MODELS_URL = 'https://api.openai.com/v1/models';
export const CHATGPT_DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const CHATGPT_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
// Refresh when the access token has less than this left (tokens last one hour).
export const CHATGPT_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Assumption: OpenAI documents no default model. With no model configured, the
// agent uses the first model the account's /v1/models listing shows (visibility
// "list", server order), as the models page describes.
export const CHATGPT_MODEL_FROM_LISTING = true;
// Assumption: any HTTP 429 from the Responses API is treated as the plan limit
// (OpenAI documents subscription_sharing_usage_limit_exceeded as a 429).
export const CHATGPT_TREAT_429_AS_PLAN_LIMIT = true;

export const TOKEN_FILE = 'data/plainhand/chatgpt-token.json';
export const PLAN_LIMIT_MESSAGE = 'Your ChatGPT plan limit for Plainhand is reached. Try again after it resets, or raise the limit in ChatGPT settings.';
export const SIGN_IN_AGAIN_MESSAGE = 'Sign in with ChatGPT again.';
export const NOT_SIGNED_IN_MESSAGE = 'Sign in with ChatGPT on the Connections page first.';
const BUSY_MESSAGE = 'ChatGPT is busy right now. Your work is saved; try again in a few minutes.';
const UNREACHABLE_MESSAGE = 'Plainhand could not reach ChatGPT. Check your internet connection and try again.';
const NOT_ELIGIBLE_MESSAGE = 'Your ChatGPT plan cannot be used in other apps. ChatGPT Plus and Pro can; or connect another AI on the Connections page.';
const REJECTED_MESSAGE = 'ChatGPT did not accept this request. Try again, or choose another AI on the Connections page.';
const FAILED_MESSAGE = 'ChatGPT could not finish this request. Try again.';
const INCOMPLETE_MESSAGE = 'ChatGPT stopped before finishing. Try again.';

const PLAN_LIMIT_CODES = new Set(['subscription_sharing_usage_limit_exceeded']);
const BUSY_CODES = new Set(['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable']);
const NOT_ELIGIBLE_CODES = new Set(['subscription_sharing_user_not_eligible']);
const SIGN_IN_CODES = new Set(['subscription_sharing_invalid_user']);
const TERMINAL_REFRESH_CODES = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

function planError(message, code) { const error = new Error(message); if (code) error.code = code; return error; }

// Plain message for a structured Responses error code and/or HTTP status.
export function chatgptErrorMessage(code, status) {
  if (PLAN_LIMIT_CODES.has(code) || (CHATGPT_TREAT_429_AS_PLAN_LIMIT && status === 429)) return PLAN_LIMIT_MESSAGE;
  if (SIGN_IN_CODES.has(code)) return SIGN_IN_AGAIN_MESSAGE;
  if (NOT_ELIGIBLE_CODES.has(code)) return NOT_ELIGIBLE_MESSAGE;
  if (BUSY_CODES.has(code) || status === 503 || status === 502 || status === 504) return BUSY_MESSAGE;
  if (status === 400 || status === 403 || /^(subscription_sharing|chatpass_v2)_/.test(code || '')) return REJECTED_MESSAGE;
  return FAILED_MESSAGE;
}

// --- Token store -----------------------------------------------------------

function keyBytes(key) {
  const bytes = Buffer.isBuffer(key) ? key : typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : typeof key === 'string' ? Buffer.from(key, 'base64') : null;
  if (!bytes || bytes.length !== 32) throw new Error('The token key must be 32 bytes.');
  return bytes;
}
const AAD = Buffer.from('plainhand:chatgpt-token:v1');
export function encryptRecord(record, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptRecord(sealed, key) {
  try {
    if (sealed?.version !== 1) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(AAD); decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw planError(SIGN_IN_AGAIN_MESSAGE, 'token_unreadable'); }
}

// One chain per workspace serializes refreshes in this process; a shared store
// (hosted Postgres) also takes its per-candidate lock across server instances.
const chains = new WeakMap();
function locked(workspace, fn) {
  const run = () => workspace.storage?.exclusive ? workspace.storage.exclusive(fn) : fn();
  const operation = (chains.get(workspace) || Promise.resolve()).then(run);
  chains.set(workspace, operation.catch(() => {}));
  return operation;
}

export function createTokenStore({ workspace, key, fetchImpl = globalThis.fetch, now = Date.now, file = TOKEN_FILE }) {
  keyBytes(key);
  const read = async () => { const raw = await workspace.read(file, ''); return raw ? decryptRecord(JSON.parse(raw), key) : null; };
  const write = record => workspace.write(file, JSON.stringify(encryptRecord(record, key)) + '\n');
  async function refresh(record) {
    if (!record.refreshToken || !record.clientId) throw planError(SIGN_IN_AGAIN_MESSAGE, 'no_refresh_token');
    let response;
    try {
      response = await fetchImpl(CHATGPT_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: record.clientId, refresh_token: record.refreshToken, resource: CHATGPT_RESOURCE }).toString() });
    } catch { throw planError(UNREACHABLE_MESSAGE, 'network'); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.access_token !== 'string') {
      // A refresh token OpenAI says is unusable means the session is over; temporary
      // failures keep the credentials so a later retry can still refresh.
      const code = typeof body.error === 'string' ? body.error : body.error?.code;
      if (TERMINAL_REFRESH_CODES.has(code) || response.status === 401) { await workspace.remove(file); throw planError(SIGN_IN_AGAIN_MESSAGE, code || 'refresh_failed'); }
      if (code === 'invalid_client') { await workspace.remove(file); throw planError(SIGN_IN_AGAIN_MESSAGE, code); }
      throw planError(response.status >= 500 ? BUSY_MESSAGE : FAILED_MESSAGE, code || 'refresh_failed');
    }
    // The access token, expiry, scopes and rotating refresh token are replaced together.
    const next = { ...record, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : record.refreshToken, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000, scopes: typeof body.scope === 'string' ? body.scope : record.scopes, earliestRefreshAt: body.earliest_refresh_at ?? null, ...(typeof body.id_token === 'string' ? { idToken: body.id_token } : {}), savedAt: now() };
    await write(next);
    return next;
  }
  return {
    // record: { accessToken, refreshToken, expiresAt (ms) } plus, for refresh and
    // display, { clientId, idToken, scopes, email, subject, hostId }.
    async save(record) {
      if (typeof record?.accessToken !== 'string' || !Number.isFinite(record.expiresAt)) throw new Error('Invalid ChatGPT sign-in.');
      await locked(workspace, () => write({ ...record, savedAt: now() }));
    },
    // A fresh access token, refreshing when under five minutes are left (or when forced after a 401).
    async get({ forceRefresh = false } = {}) {
      return locked(workspace, async () => {
        const record = await read();
        if (!record) throw planError(NOT_SIGNED_IN_MESSAGE, 'not_signed_in');
        if (!forceRefresh && record.expiresAt - now() > CHATGPT_REFRESH_MARGIN_MS) return record.accessToken;
        return (await refresh(record)).accessToken;
      });
    },
    // Safe details for status screens: never token values.
    async info() {
      try { const record = await read(); return record ? { signedIn: true, email: record.email || null, clientId: record.clientId || null, scopes: record.scopes || '', expiresAt: record.expiresAt } : { signedIn: false }; }
      catch { return { signedIn: false, unreadable: true }; }
    },
    // What sign-out needs to revoke the session at OpenAI. Server side only.
    async revocation() {
      try { const record = await read(); return record?.refreshToken && record.clientId ? { clientId: record.clientId, refreshToken: record.refreshToken } : null; } catch { return null; }
    },
    async clear() { await locked(workspace, () => workspace.remove(file)); },
  };
}

// --- Responses API agent ----------------------------------------------------

// Server-sent events from a fetch body: yields { event, data } with data parsed as JSON.
async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = block => {
    let event = null; const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return null;
    const text = data.join('\n');
    if (text === '[DONE]') return null;
    try { const parsed = JSON.parse(text); return { event: event || parsed.type, data: parsed }; } catch { return null; }
  };
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      const event = parse(block); if (event) yield event;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function responsesUsage(response) {
  const u = response?.usage || {};
  const input = count(u.input_tokens), cached = count(u.input_tokens_details?.cached_tokens);
  return {
    inputTokens: input, uncachedInputTokens: input !== null && cached !== null ? Math.max(0, input - cached) : null,
    outputTokens: count(u.output_tokens), cacheReadTokens: cached, cacheWriteTokens: null,
    reasoningTokens: count(u.output_tokens_details?.reasoning_tokens), reportedUsd: null,
    models: typeof response?.model === 'string' ? [response.model.replace(/[\x00-\x1f]/g, '').slice(0, 100)] : [],
  };
}
const emptyUsage = () => responsesUsage(null);

export function createChatgptAgent({ tokens, fetchImpl = globalThis.fetch, model } = {}) {
  let listedModel = null;
  async function chooseModel(accessToken, signal) {
    if (model) return model;
    if (listedModel) return listedModel;
    let response;
    try { response = await fetchImpl(CHATGPT_MODELS_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal }); }
    catch (error) { if (signal?.aborted) throw new Error('Task canceled.'); throw planError(UNREACHABLE_MESSAGE, 'network'); }
    if (response.status === 401) return null; // caller refreshes and retries
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw planError(chatgptErrorMessage(body?.error?.code, response.status), body?.error?.code);
    const list = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : [];
    const slug = list.find(m => m?.visibility === 'list' && typeof m.slug === 'string')?.slug;
    if (!slug) throw planError('Your ChatGPT account has no model Plainhand can use.', 'no_model');
    return (listedModel = slug);
  }

  return async function chatgptAgent(provider, instruction, data, { signal, onUsage, onText } = {}) {
    let usage = emptyUsage();
    try {
      // Every call carries its full context: no stored conversation, no previous_response_id.
      const body = { model: null, instructions: AGENT_PREAMBLE, input: [{ role: 'user', content: agentTask(instruction, data) }], store: false, stream: true };
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        const accessToken = await tokens.get(attempt ? { forceRefresh: true } : {});
        body.model = await chooseModel(accessToken, signal);
        if (!body.model) { if (attempt) throw planError(SIGN_IN_AGAIN_MESSAGE, 'unauthorized'); continue; }
        try {
          response = await fetchImpl(CHATGPT_RESPONSES_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
        } catch { if (signal?.aborted) throw new Error('Task canceled.'); throw planError(UNREACHABLE_MESSAGE, 'network'); }
        if (response.status !== 401) break;
        await response.body?.cancel?.().catch(() => {});
        if (attempt) throw planError(SIGN_IN_AGAIN_MESSAGE, 'unauthorized');
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const code = typeof error?.error?.code === 'string' ? error.error.code : null;
        throw planError(chatgptErrorMessage(code, response.status), code || `http_${response.status}`);
      }
      const say = typeof onText === 'function' ? sayStream(onText) : null;
      let text = '', completed = null;
      try {
        for await (const { event, data: payload } of sseEvents(response.body)) {
          if (event === 'response.output_text.delta' && typeof payload.delta === 'string') { text += payload.delta; say?.(payload.delta); }
          else if (event === 'response.completed') { completed = payload.response || {}; usage = responsesUsage(completed); }
          else if (event === 'response.failed') {
            usage = responsesUsage(payload.response);
            const code = payload.response?.error?.code || null;
            throw planError(chatgptErrorMessage(code), code || 'failed');
          } else if (event === 'response.incomplete') { usage = responsesUsage(payload.response); throw planError(INCOMPLETE_MESSAGE, 'incomplete'); }
          else if (event === 'error') { const code = payload.code || payload.error?.code || null; throw planError(chatgptErrorMessage(code), code || 'stream_error'); }
        }
      } catch (error) { if (signal?.aborted) throw new Error('Task canceled.'); throw error; }
      // response.completed is the only signal that the request succeeded.
      if (!completed) throw planError('The ChatGPT reply ended early. Try again.', 'stream_ended');
      if (!text) text = (completed.output || []).flatMap(item => item?.content || []).filter(c => c?.type === 'output_text').map(c => c.text).join('');
      return parseAgentJson(text);
    } finally { await onUsage?.(usage); }
  };
}
