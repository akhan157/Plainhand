import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from './plainhand/store.mjs';
import { AuditLog } from './plainhand/audit.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-audit-'));
  return { root, workspace: new Workspace(root), log: new AuditLog(new Workspace(root)), close: () => rm(root, { recursive: true, force: true }) };
}

test('every external action records a reason, job, artifact and outcome', async () => {
  const h = await fixture();
  try {
    const entry = await h.log.append({ action: 'fill', reason: 'approved packet answers applied', jobId: 'job-1', artifact: 'resume.pdf', outcome: '5 filled, 1 uploads' });
    assert.equal(entry.action, 'fill');
    assert.equal(entry.jobId, 'job-1');
    assert.equal(entry.artifact, 'resume.pdf');
    assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
    const text = await h.workspace.read('data/plainhand/audit.jsonl');
    assert.equal(text.trim().split('\n').length, 1);
    assert.deepEqual(JSON.parse(text.trim()), entry);
  } finally { await h.close(); }
});

test('malformed actions and missing reasons are rejected before writing', async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.log.append({ action: 'Fill Now', reason: 'x' }), /audit action/);
    await assert.rejects(() => h.log.append({ action: 'fill', reason: '   ' }), /needs a reason/);
    assert.equal((await h.log.list()).length, 0);
  } finally { await h.close(); }
});

test('entries are sanitized, bounded, and listed newest first', async () => {
  const h = await fixture();
  try {
    await h.log.append({ action: 'handoff', reason: 'line one\nline two\u0000', jobId: 'j', artifact: 'example.com' });
    await h.log.append({ action: 'verify', reason: 'turnstile', jobId: 'j', outcome: 'ok' });
    const list = await h.log.list({ limit: 1 });
    assert.equal(list.length, 1);
    assert.equal(list[0].action, 'verify');
    const all = await h.log.list();
    assert.equal(all[0].action, 'verify');
    assert.equal(all[1].reason, 'line one line two');
    assert.doesNotMatch(JSON.stringify(all), /\u0000/);
  } finally { await h.close(); }
});

test('a browser fill writes its own audit entry through the runtime', async () => {
  const { chromium } = await import('playwright');
  const { ApplicationBrowser, defaultFieldAnswers } = await import('./plainhand/jobs.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-audit-fill-'));
  const storage = new Workspace(root);
  const job = { id: 'audit-fill', url: 'https://jobs.lever.co/synthetic/audit' };
  const runtime = new ApplicationBrowser({ storage, solver: null, launch: async options => {
    const browser = await chromium.launch({ ...options, headless: true });
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await createContext(config);
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await createPage();
        await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic</h1><label>Email<input name="email" type="email" required></label><button type="submit">Submit application</button>' }));
        return page;
      };
      return context;
    };
    return browser;
  } });
  try {
    const fields = await runtime.open(job, true);
    const answers = defaultFieldAnswers(fields, { name: 'Test Candidate', email: 'candidate@example.invalid', phone: '+1 202 555 0189' });
    await runtime.fill(job, answers);
    const entries = await new AuditLog(storage).list();
    const fill = entries.find(entry => entry.action === 'fill');
    assert.ok(fill, 'fill was recorded');
    assert.equal(fill.jobId, job.id);
    assert.match(fill.reason, /approved packet/);
  } finally {
    await runtime.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
