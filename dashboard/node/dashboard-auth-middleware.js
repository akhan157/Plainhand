// Fail closed: no fallback credentials. Both env vars MUST be set on Vercel
// (Project Settings → Environment Variables). Hardcoded defaults here were a
// real production hole — anyone could log in or forge a cookie.
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const COOKIE_NAME = 'career_ops_auth';
const SECRET = process.env.DASHBOARD_SECRET || '';
const LONG_MAX_AGE = 60 * 60 * 24 * 90;
const TOKEN_LIFETIME_MS = {
  session: 24 * 60 * 60 * 1000,        // 24h for plain logins
  remember: LONG_MAX_AGE * 1000,        // 90d for "remember this device"
};
const FAILED_LOGIN_DELAY_MS = 1500;     // slows brute force to a crawl

export default async function middleware(request) {
  if (!PASSWORD || !SECRET) {
    return new Response(
      'Dashboard auth is not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SECRET in Vercel env vars.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/auth/login' && request.method === 'POST') {
    return handleLogin(request, url);
  }

  if (pathname === '/auth/logout') {
    return handleLogout(url);
  }

  if (pathname === '/login/' || pathname === '/login') {
    if (await isAuthenticated(request)) {
      return Response.redirect(new URL(readSafeNext(url.searchParams.get('next')), url), 302);
    }
    return null;
  }

  if (await isAuthenticated(request)) {
    return null;
  }

  const loginUrl = new URL('/login/', url);
  loginUrl.searchParams.set('next', `${pathname}${url.search}`);
  return Response.redirect(loginUrl, 302);
}

export const config = {
  // /assets/* and favicon are deliberately NOT matched: the login page loads
  // its own CSS/fonts from /assets/, and gating them redirected those requests
  // to /login/, leaving the login page unstyled. Assets are UI shell only —
  // all PII lives in dashboard-data.json, reports/, and output/, which stay gated.
  matcher: [
    '/',
    '/index.html',
    '/terminal',
    '/terminal/',
    '/terminal/:path*',
    '/login',
    '/login/',
    '/login/:path*',
    '/auth/login',
    '/auth/logout',
    '/dashboard-data.json',
    '/reports/:path*',
    '/output/:path*',
  ],
};

async function handleLogin(request, url) {
  const rawBody = await request.text();
  const form = new URLSearchParams(rawBody);
  const password = String(form.get('password') || '');
  const remember = form.get('remember') === 'on';
  const next = readSafeNext(String(form.get('next') || '/'));

  if (password !== PASSWORD) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    const loginUrl = new URL('/login/', url);
    loginUrl.searchParams.set('next', next);
    loginUrl.searchParams.set('error', '1');
    return Response.redirect(loginUrl, 302);
  }

  const token = await createSignedToken(remember ? 'remember' : 'session');
  return redirectWithCookie(new URL(next, url), serializeCookie(token, remember));
}

function handleLogout(url) {
  return redirectWithCookie(
    new URL('/login/', url),
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

async function isAuthenticated(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = parseCookie(cookieHeader)[COOKIE_NAME];
  if (!token) return false;
  return verifySignedToken(token);
}

function parseCookie(cookieHeader) {
  const result = {};
  for (const pair of cookieHeader.split(/;\s*/)) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}

function readSafeNext(next) {
  if (!next || typeof next !== 'string') return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  // Browsers treat backslashes as slashes in URLs, so "/\evil.com" becomes
  // a protocol-relative redirect to evil.com. Reject any backslash.
  if (next.includes('\\')) return '/';
  return next;
}

function serializeCookie(token, remember) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (remember) {
    parts.push(`Max-Age=${LONG_MAX_AGE}`);
  }
  return parts.join('; ');
}

function redirectWithCookie(destination, cookieValue) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination.toString(),
      'Set-Cookie': cookieValue,
      'Cache-Control': 'no-store',
    },
  });
}

async function createSignedToken(mode) {
  const payload = `${mode}.${Date.now()}`;
  const signature = await sign(payload);
  return `${toBase64Url(payload)}.${signature}`;
}

async function verifySignedToken(token) {
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const encodedPayload = token.slice(0, lastDot);
  const providedSignature = token.slice(lastDot + 1);

  let payload = '';
  try {
    payload = fromBase64Url(encodedPayload);
  } catch {
    return false;
  }

  const expectedSignature = await sign(payload);
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return false;
  }

  // Signature is valid — now enforce the payload contract and expiry.
  // Previously the payload was never parsed, so a signed token lived forever.
  const dot = payload.indexOf('.');
  if (dot <= 0) return false;
  const mode = payload.slice(0, dot);
  const issuedAt = Number(payload.slice(dot + 1));
  const lifetime = TOKEN_LIFETIME_MS[mode];
  if (!lifetime || !Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < lifetime;
}

async function sign(value) {
  // HMAC-SHA256, not a bare hash of secret+payload — bare SHA-256 over a
  // concatenation is open to length-extension forgery.
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64UrlBuffer(digest);
}

function toBase64Url(value) {
  return toBase64UrlBuffer(encoder.encode(value));
}

function toBase64UrlBuffer(bytesLike) {
  const bytes = bytesLike instanceof ArrayBuffer ? new Uint8Array(bytesLike) : bytesLike;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(base64);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

const encoder = new TextEncoder();
