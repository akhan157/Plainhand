import test from 'node:test';
import assert from 'node:assert/strict';
import { importResume, RESUME_LIMITS } from '../plainhand/cloud/resume-import.mjs';
import { CONNECTION_CHECK_PATH } from '../plainhand/cloud/connection-check.mjs';
import { connectionResult, setupCoverage } from '../plainhand/web/ui/connect-data.mjs';
import { startHostedFixture, textPdf } from './helpers/hosted-onboarding.mjs';
const file = (bytes, name = 'resume.pdf') => ({ name, content: bytes.toString('base64') });
test('PDF.js extracts actual PDF text as a preview on Node, with no profile write', async () => {
  const result = await importResume(file(textPdf()));
  assert.match(result.text, /Candidate supplied resume/); assert.equal(result.preview, true);
});
test('text and Markdown imports preserve candidate text; invalid encodings rejected', async () => {
  for (const name of ['cv.txt', 'cv.md']) assert.equal((await importResume(file(Buffer.from('My real résumé'), name))).text, 'My real résumé');
  await assert.rejects(importResume(file(Buffer.from([255]), 'cv.txt')), /UTF-8/);
  await assert.rejects(importResume(file(Buffer.from('a\0b'), 'cv.md')), /plain text/);
});
test('filename, canonical base64, upload size and text output bounds', async () => {
  for (const name of ['../cv.pdf', 'folder\\cv.pdf', 'a\0.pdf', '', 'cv.exe', 'a'.repeat(201) + '.txt']) await assert.rejects(importResume(file(Buffer.from('text'), name)));
  for (const content of ['', '####', 'YQ', 'YQ==\n', 'YR==', 'data:application/pdf;base64,YQ==', 'a'.repeat(4 * Math.ceil(RESUME_LIMITS.bytes / 3) + 4)]) await assert.rejects(importResume({ name: 'cv.txt', content }));
  await assert.rejects(importResume(file(Buffer.alloc(RESUME_LIMITS.bytes + 1), 'cv.txt')), /2 MB/);
  await assert.rejects(importResume(file(Buffer.from('x'.repeat(100001)), 'cv.txt')), /100,000/);
});
test('corrupt, empty/image-only and oversized-page PDFs give paste guidance', async () => {
  for (const bytes of [Buffer.from('not pdf'), Buffer.from('%PDF-1.7\ngarbage'), textPdf({ text: '' })]) await assert.rejects(importResume(file(bytes)), /[Pp]aste.*text/);
  await assert.rejects(importResume(file(textPdf({ pages: 21 }))), /20 pages.*[Pp]aste/s);
});
test('encrypted PDFs give paste guidance', async () => {
  await assert.rejects(importResume(file(textPdf({ encrypted: true }))), /password protected.*paste/s);
});
test('PDF extracted output is bounded', async () => {
  await assert.rejects(importResume(file(textPdf({ text: 'Resume evidence.', repeats: 10000 }))), /100,000/);
});
test('connection result requires a new matching successful read AND write', () => {
  const start = Date.now(), marker = { checkedAt: new Date(start + 1).toISOString(), provider: 'claude', read: true, write: true };
  assert.equal(connectionResult(marker, start, 'claude'), 'connected');
  assert.equal(connectionResult({ ...marker, checkedAt: new Date(start).toISOString() }, start, 'claude'), 'waiting');
  assert.equal(connectionResult(marker, start, 'chatgpt'), 'waiting');
  assert.equal(connectionResult({ ...marker, write: false }, start, 'claude'), 'read-only');
  assert.equal(connectionResult({ ...marker, read: false }, start, 'claude'), 'waiting');
  assert.equal(connectionResult({ ...marker, write: 'true' }, start, 'claude'), 'waiting');
  assert.equal(connectionResult(null, start, 'claude'), 'waiting');
});
test('coverage never claims real-account verification or downloads', () => {
  assert.equal(setupCoverage.accountStatus, 'unverified'); assert.equal(setupCoverage.screenshots.status, 'pending');
  for (const provider of ['chatgpt', 'claude']) for (const c of Object.values(setupCoverage[provider].coverage)) assert.equal(c.status, 'unverified');
});
test('session and CSRF isolate connection markers; client cannot set success; import is preview only', async () => {
  const app = await startHostedFixture();
  try {
    const marker = { checkedAt: new Date().toISOString(), read: true, write: true, provider: 'claude', clientId: 'test-client', private: 'not returned' };
    await app.workspaces.get('alice').write(CONNECTION_CHECK_PATH, JSON.stringify(marker));
    assert.deepEqual(await (await app.request('/api/connection-check', { user: 'bob' })).json(), null);
    const result = await (await app.request('/api/connection-check')).json(); assert.equal(result.clientId, 'test-client'); assert.equal(result.private, undefined);
    assert.equal((await app.request('/api/connection-check', { user: 'unknown' })).status, 401);
    assert.equal((await app.request('/api/connection-check', { csrf: app.token('bob') })).status, 403);
    assert.equal((await app.request('/api/connection-check', { data: marker })).status, 404);
    for (const raw of ['bad json', '{}', JSON.stringify({ checkedAt: { toString: null }, read: true, write: true }), ' '.repeat(4097), '{"checkedAt":"bad","read":true,"write":true}']) { await app.workspaces.get('bob').write(CONNECTION_CHECK_PATH, raw); assert.equal(await (await app.request('/api/connection-check', { user: 'bob' })).json(), null); }
    const imported = await app.request('/api/resume/import', { data: file(textPdf()) }); assert.equal(imported.status, 200); assert.match((await imported.json()).text, /Candidate supplied/);
    assert.equal((await app.workspaces.get('alice').load()).profile.resume, ''); assert.equal(await app.workspaces.get('alice').read('cv.md'), '');
    assert.equal((await app.request('/api/onboarding', { data: { provider: 'claude', plan: 'Free' } })).status, 200);
    assert.equal((await app.request('/api/onboarding', { data: { provider: 'fake', plan: 'Free' } })).status, 400);
    assert.equal((await app.request('/api/tasks', { data: { kind: 'evaluate' } })).status, 409);
    assert.equal((await app.request('/api/action', { data: { name: 'tasks.interview', input: {} } })).status, 409);
    assert.equal((await app.workspaces.get('alice').load()).tasks.length, 0);
  } finally { await app.close(); }
});
