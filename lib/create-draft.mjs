#!/usr/bin/env node

/**
 * create-draft.mjs — Create a Gmail draft with attachments via Gmail API.
 *
 * Usage:
 *   node create-draft.mjs \
 *     --to user@example.com [--to user2@example.com] \
 *     --subject "Subject line" \
 *     (--body "Inline body text" | --body-file path/to/body.txt) \
 *     [--attach path/to/file.pdf]... \
 *     [--cc cc@example.com]... \
 *     [--bcc bcc@example.com]...
 *
 * Auth (one-time):
 *   1. Google Cloud Console -> create project -> enable Gmail API.
 *   2. Create OAuth 2.0 client (Desktop app). Download credentials JSON.
 *   3. Save as ~/.career-ops/gmail-credentials.json
 *      (or set CAREER_OPS_GMAIL_CREDS env var to a path).
 *   4. First run will print an auth URL -> open in browser, sign in, copy
 *      the code, paste back. Token is cached at
 *      ~/.career-ops/gmail-token.json for future runs.
 *
 * Returns the created draft ID. The draft appears in Gmail Drafts folder.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve, basename, extname } from 'path';
import { createInterface } from 'readline/promises';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
const HOME_DIR = homedir();
const CFG_DIR = resolve(HOME_DIR, '.career-ops');
const CREDS_PATH = process.env.CAREER_OPS_GMAIL_CREDS
  || resolve(CFG_DIR, 'gmail-credentials.json');
const TOKEN_PATH = process.env.CAREER_OPS_GMAIL_TOKEN
  || resolve(CFG_DIR, 'gmail-token.json');

function parseArgs(argv) {
  const out = { to: [], cc: [], bcc: [], attach: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--to': out.to.push(next()); break;
      case '--cc': out.cc.push(next()); break;
      case '--bcc': out.bcc.push(next()); break;
      case '--subject': out.subject = next(); break;
      case '--body': out.body = next(); break;
      case '--body-file': out.bodyFile = next(); break;
      case '--attach': out.attach.push(next()); break;
      case '--auth-init': out.authInit = true; break;
      case '--auth-code': out.authCode = next(); break;
      case '--delete': out.deleteId = next(); break;
      case '--list': out.list = true; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node create-draft.mjs --to <email> --subject <s> (--body <s> | --body-file <p>)
                        [--attach <path>]... [--cc <email>]... [--bcc <email>]...`);
}

async function loadCredentials() {
  if (!existsSync(CREDS_PATH)) {
    throw new Error(
      `Gmail credentials not found at ${CREDS_PATH}.\n`
      + `One-time setup:\n`
      + `  1. https://console.cloud.google.com -> create project\n`
      + `  2. APIs & Services -> Library -> Gmail API -> Enable\n`
      + `  3. APIs & Services -> Credentials -> Create OAuth client ID\n`
      + `       Application type: Desktop app\n`
      + `  4. Download the JSON, save as ${CREDS_PATH}\n`
      + `Or set CAREER_OPS_GMAIL_CREDS env var to a custom path.`);
  }
  return JSON.parse(await readFile(CREDS_PATH, 'utf8'));
}

async function buildOAuth2() {
  const creds = await loadCredentials();
  const root = creds.installed || creds.web;
  if (!root) throw new Error(`Unexpected credentials JSON shape (no .installed or .web): ${CREDS_PATH}`);
  const { client_id, client_secret, redirect_uris } = root;
  return new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]
  );
}

async function getOAuth2Client() {
  const oAuth2 = await buildOAuth2();
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(
      `No token at ${TOKEN_PATH}. Run with --auth-init first to print the auth URL, `
      + `then with --auth-code <code> to finalize.`);
  }
  oAuth2.setCredentials(JSON.parse(await readFile(TOKEN_PATH, 'utf8')));
  return oAuth2;
}

async function authInit() {
  const oAuth2 = await buildOAuth2();
  const authUrl = oAuth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  console.log(authUrl);
}

async function authFinalize(code) {
  const oAuth2 = await buildOAuth2();
  const { tokens } = await oAuth2.getToken(code);
  await mkdir(CFG_DIR, { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Token saved to ${TOKEN_PATH}`);
}

function mimeType(filename) {
  const ext = extname(filename).toLowerCase();
  return ({
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  })[ext] || 'application/octet-stream';
}

async function buildRawMessage({ to, cc, bcc, subject, body, attachments }) {
  const boundary = `==boundary_${Date.now()}_${Math.random().toString(36).slice(2)}==`;
  const headerLines = [
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (cc.length) headerLines.splice(1, 0, `Cc: ${cc.join(', ')}`);
  if (bcc.length) headerLines.splice(1, 0, `Bcc: ${bcc.join(', ')}`);
  const headers = headerLines.join('\r\n');

  const parts = [];
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/plain; charset="UTF-8"`);
  parts.push(`Content-Transfer-Encoding: 7bit`);
  parts.push(``);
  parts.push(body);

  for (const path of attachments) {
    if (!existsSync(path)) {
      throw new Error(`attachment not found: ${path}`);
    }
    const buf = await readFile(path);
    const filename = basename(path);
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${mimeType(filename)}; name="${filename}"`);
    parts.push(`Content-Disposition: attachment; filename="${filename}"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push(``);
    // Wrap base64 at 76 chars per RFC 2045
    const b64 = buf.toString('base64').match(/.{1,76}/g).join('\r\n');
    parts.push(b64);
  }
  parts.push(`--${boundary}--`);

  // RFC 5322: headers and body are separated by a blank line (CRLF CRLF).
  const raw = headers + '\r\n\r\n' + parts.join('\r\n');
  return Buffer.from(raw).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.authInit) { await authInit(); return; }
  if (args.authCode) { await authFinalize(args.authCode); return; }

  if (args.list) {
    const auth = await getOAuth2Client();
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.drafts.list({ userId: 'me', maxResults: 50 });
    for (const d of res.data.drafts || []) {
      const m = await gmail.users.drafts.get({ userId: 'me', id: d.id, format: 'metadata' });
      const headers = m.data.message?.payload?.headers || [];
      const subj = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const to = headers.find(h => h.name === 'To')?.value || '';
      console.log(`${d.id}\t${to}\t${subj}`);
    }
    return;
  }

  if (args.deleteId) {
    const auth = await getOAuth2Client();
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.drafts.delete({ userId: 'me', id: args.deleteId });
    console.log(`deleted draft ${args.deleteId}`);
    return;
  }

  if (!args.to.length) { console.error('--to required'); process.exit(2); }
  if (!args.subject) { console.error('--subject required'); process.exit(2); }

  let body = args.body;
  if (!body && args.bodyFile) {
    body = await readFile(args.bodyFile, 'utf8');
  }
  if (!body) { console.error('--body or --body-file required'); process.exit(2); }

  const auth = await getOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = await buildRawMessage({
    to: args.to, cc: args.cc, bcc: args.bcc,
    subject: args.subject, body, attachments: args.attach
  });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } }
  });

  console.log(JSON.stringify({
    draft_id: res.data.id,
    message_id: res.data.message?.id,
    attachments: args.attach.length,
    to: args.to,
    subject: args.subject
  }, null, 2));
}

main().catch(err => {
  console.error(`error: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
