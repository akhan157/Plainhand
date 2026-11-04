// Remote view: the Vercel CLI is replaced by a local stand-in so the whole
// flow (account sign-in capture, static build, deploy arguments, password
// middleware and signed-in data check) runs without a real Vercel account.
// The fake deployment is a local HTTP server; no data leaves this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-remote-test-'));
const stateFile = path.join(root, 'fake-vercel.jsonl');
const portFile = path.join(root, 'fake-port.txt');
const cliPath = path.join(root, 'fake-vercel');
const serverPath = path.join(root, 'fake-vercel-server.mjs');

await writeFile(cliPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const stateFile = process.env.FAKE_VERCEL_STATE;
appendFileSync(stateFile, JSON.stringify({ at: new Date().toISOString(), args }) + '\\n');
if (args[0] === 'whoami') { console.log('test@example.com'); process.exit(0); }
if (args[0] === 'login') { console.log('Visit https://vercel.com/oauth/device?user_code=TEST-CODE to approve'); process.exit(0); }
if (args[0] === 'deploy') {
  const dir = args[1];
  const env = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '--env') { const [key, ...rest] = String(args[++i]).split('='); env[key] = rest.join('='); }
  const child = spawn(process.execPath, [process.env.FAKE_VERCEL_SERVER, dir], { env: { ...process.env, ...env }, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 100; i++) {
    try { const port = readFileSync(process.env.FAKE_VERCEL_PORT, 'utf8').trim(); if (port) { console.log('Production: http://127.0.0.1:' + port); process.exit(0); } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  console.error('fake server did not start'); process.exit(1);
}
console.error('unknown command: ' + args.join(' ')); process.exit(1);
`, { mode: 0o755 });
await chmod(cliPath, 0o755);

await writeFile(serverPath, `import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir = process.argv[2];
const password = process.env.DASHBOARD_PASSWORD || '';
const cookie = 'career_ops_auth=fake-signed-token';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/login' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (new URLSearchParams(body).get('password') !== password) { res.writeHead(302, { Location: '/login/?error=1' }); res.end(); return; }
    res.writeHead(302, { 'Set-Cookie': cookie + '; Path=/; HttpOnly', Location: '/' }); res.end(); return;
  }
  if (url.pathname === '/login/' || url.pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Plainhand Dashboard Login</h1>'); return;
  }
  if (url.pathname === '/dashboard-data.json' && !(req.headers.cookie || '').includes(cookie)) { res.writeHead(302, { Location: '/login/' }); res.end(); return; }
  if (url.pathname === '/' && !(req.headers.cookie || '').includes(cookie)) { res.writeHead(302, { Location: '/login/' }); res.end(); return; }
  const file = path.join(dir, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\\/+/, ''));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
server.listen(0, '127.0.0.1', async () => {
  await writeFile(process.env.FAKE_VERCEL_PORT, String(server.address().port));
  await writeFile(process.env.FAKE_VERCEL_PORT + '.pid', String(process.pid));
});
`, { mode: 0o644 });

process.env.VERCEL_CLI = cliPath;
process.env.FAKE_VERCEL_STATE = stateFile;
process.env.FAKE_VERCEL_SERVER = serverPath;
process.env.FAKE_VERCEL_PORT = portFile;
const remote = await import('../plainhand/remote.mjs');
const { Workspace } = await import('../plainhand/store.mjs');

const workspaceRoot = path.join(root, 'workspace');
await mkdir(workspaceRoot, { recursive: true });
const workspace = new Workspace(workspaceRoot);
await workspace.write('data/applications.md', [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-01 | Fictional Co | Test Engineer | 4.2/5 | Applied | — | | Synthetic row |',
  '',
].join('\n'));

test.after(async () => {
  try { const pid = Number((await readFile(portFile + '.pid', 'utf8')).trim()); process.kill(pid); } catch {}
  await rm(root, { recursive: true, force: true });
});

test('parses the account from noisy CLI output', () => {
  assert.equal(remote.parseWhoamiOutput('npm notice run plainhand@1.0.0 npx\nVercel CLI 65.11.0\n> \nakhan157'), 'akhan157');
  assert.equal(remote.parseWhoamiOutput('npm notice run plainhand@1.0.0 npx\nVercel CLI 65.11.0\nuser@example.com'), 'user@example.com');
  assert.equal(remote.parseWhoamiOutput('Vercel CLI 65.11.0\n> Logged out.\n> Run `vercel login` to log in.'), null);
});

test('captures the Vercel sign-in link and the connected account', async () => {
  const started = await remote.beginVercelLogin(workspace);
  assert.equal(started.status, 'running');
  for (let i = 0; i < 100 && remote.currentLogin()?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 50));
  const finished = remote.currentLogin();
  assert.equal(finished.status, 'complete');
  assert.match(finished.url, /^https:\/\/vercel\.com\//);
  const config = await remote.loadRemote(workspace);
  assert.equal(config.user, 'test@example.com');
});

test('publishes, applies the password environment and verifies signed-in data', async () => {
  const result = await remote.publishDashboard(workspace, { log: () => {} });
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(result.apps, 1);
  assert.equal(result.password.length, 20);

  const calls = (await readFile(stateFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const deploy = calls.find(call => call.args[0] === 'deploy');
  assert.ok(deploy, 'deploy was called');
  assert.ok(deploy.args.includes('--prod'));
  assert.ok(deploy.args.includes('--project'));
  assert.ok(deploy.args.some(arg => /^DASHBOARD_PASSWORD=/.test(arg)));
  assert.ok(deploy.args.some(arg => /^DASHBOARD_SECRET=/.test(arg)));

  const config = await remote.loadRemote(workspace);
  assert.equal(config.url, result.url);
  assert.ok(config.secret);
  assert.ok(config.lastFingerprint);
  assert.equal(config.lastError, null);
  assert.equal(config.user, 'test@example.com');

  const anonymous = await fetch(result.url + '/', { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.headers.get('location'), /\/login/);

  const wrong = await fetch(result.url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: 'wrong', next: '/' }), redirect: 'manual' });
  assert.equal(wrong.status, 302);
  assert.doesNotMatch(wrong.headers.get('set-cookie') || '', /career_ops_auth/);

  const right = await fetch(result.url + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: result.password, next: '/' }), redirect: 'manual' });
  assert.equal(right.status, 302);
  const cookie = (right.headers.get('set-cookie') || '').split(';')[0];
  const data = await fetch(result.url + '/dashboard-data.json', { headers: { cookie } });
  assert.equal(data.status, 200);
  assert.equal((await data.json()).counts.all, 1);
});

test('project settings validate and password rotation changes the saved secret', async () => {
  await assert.rejects(() => remote.updateRemoteSettings(workspace, { project: 'Bad Name' }), /lowercase letters/);
  const before = await remote.loadRemote(workspace);
  await remote.updateRemoteSettings(workspace, { project: 'plainhand-remote-test', enabled: true });
  const rotated = await remote.rotateRemotePassword(workspace);
  assert.notEqual(rotated.password, before.password);
  assert.equal((await remote.loadRemote(workspace)).enabled, true);
  await remote.forgetRemote(workspace);
  const forgotten = await remote.loadRemote(workspace);
  assert.equal(forgotten.url, null);
  assert.equal(forgotten.enabled, false);
  assert.equal(forgotten.secret, null);
});
