import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { presubmitCheck } from './plainhand/presubmit.mjs';
import { ApplicationBrowser, defaultFieldAnswers, isBoardUrl, applicationTarget, verifyJob, profileLinks } from './plainhand/jobs.mjs';
import { createPlainhand } from './plainhand-server.mjs';

const profile = { name: 'Riley Chen', email: 'riley@example.invalid', phone: '+1 617 555 0100', location: 'Boston, US', links: 'https://www.linkedin.com/in/riley-example, https://github.com/riley-example https://riley.example' };
const field = (key, label, extra = {}) => ({ key, label, type: 'text', required: false, ...extra });

test('standard fields map from the profile; names a person chooses and legal questions are left to them', () => {
  const fields = [field('a', 'First Name'), field('b', 'Last Name'), field('c', 'Legal Name'), field('d', 'Name Pronunciation | How do you pronounce your name?'), field('e', 'Preferred Name'),
    field('f', 'LinkedIn Profile'), field('g', 'GitHub URL'), field('h', 'Portfolio URL'), field('i', 'Current location ✱'), field('j', 'Country'), field('k', 'Will you now or in the future require sponsorship?'),
    field('l', 'Cover Letter', { type: 'file' }), field('m', 'Resume/CV', { type: 'file' }), field('n', 'Attach', { type: 'file' }), field('o', 'Phone')];
  assert.deepEqual(defaultFieldAnswers(fields, profile), { a: 'Riley', b: 'Chen', c: 'Riley Chen', f: 'https://www.linkedin.com/in/riley-example', g: 'https://github.com/riley-example', h: 'https://riley.example', i: 'Boston, US', l: '__cover_letter__', m: '__resume__', o: '+1 617 555 0100' });
  assert.deepEqual(profileLinks({ links: '' }), { linkedin: '', github: '', website: '' });
  assert.deepEqual(defaultFieldAnswers([field('x', 'LinkedIn Profile')], { ...profile, links: '' }), {}, 'empty values are never entered');
});

test('the check marks each field filled, flagged with a reason, or mismatched, and says when the page is ready', () => {
  const fields = [field('1', 'Email', { required: true }), field('2', 'Why us?', { required: true }), field('3', 'Gender'), field('4', 'Transcript', { type: 'file' }), field('5', 'Resume', { type: 'file', required: true }), field('6', 'Heard about us', { type: 'select-one', required: true }), field('7', 'LinkedIn')];
  const answers = { 1: profile.email, 5: '__resume__', 7: 'https://www.linkedin.com/in/riley-example' };
  const preview = presubmitCheck({ fields, answers, questions: [{ key: '2', question: 'What draws you to this company?' }], profile });
  const by = Object.fromEntries(preview.items.map(i => [i.key, i]));
  assert.deepEqual([by[1].status, by[1].source], ['filled', 'your profile']);
  assert.deepEqual([by[2].status, by[2].reason, by[2].text], ['flagged', 'no-information', 'What draws you to this company?']);
  assert.equal(by[3].reason, 'sensitive');
  assert.equal(by[4].reason, 'document');
  assert.equal(by[5].source, 'your approved resume');
  assert.equal(by[6].reason, 'choice');
  assert.equal(by[7].source, 'your profile');
  assert.deepEqual(preview.summary, { total: 7, filled: 3, flagged: 4, mismatched: 0, requiredFlagged: 2 });
  assert.equal(preview.ready, false);
  const after = presubmitCheck({ fields, answers: { ...answers, 2: 'Your test rigs.', 6: 'linkedin' }, fill: { failed: ['Email'] }, readback: { 7: 'https://www.linkedin.com/in/someone-else' }, profile, resume: { attached: 'a', approved: 'b' } });
  const now = Object.fromEntries(after.items.map(i => [i.key, i]));
  assert.deepEqual([now[1].status, now[1].reason], ['mismatch', 'not-kept']);
  assert.equal(now[5].reason, 'resume-changed');
  assert.equal(now[7].reason, 'changed-on-page');
  assert.equal(after.ready, false);
  assert.equal(presubmitCheck({ fields: [field('1', 'Email', { required: true })], answers: { 1: 'a@b.invalid' }, profile }).ready, true);
});

test('job boards are never opened: verification and the browser need the employer’s link', async () => {
  assert.equal(isBoardUrl('https://www.linkedin.com/jobs/view/123'), true);
  assert.equal(isBoardUrl('https://uk.indeed.com/viewjob?jk=1'), true);
  assert.equal(isBoardUrl('https://jobs.lever.co/acme/1'), false);
  assert.throws(() => applicationTarget({ url: 'https://www.linkedin.com/jobs/view/1' }), /doesn't open linkedin\.com/);
  assert.throws(() => applicationTarget({ url: 'https://www.linkedin.com/jobs/view/1', applyUrl: 'https://www.indeed.com/x' }), /employer’s own/);
  assert.equal(applicationTarget({ url: 'https://www.linkedin.com/jobs/view/1', applyUrl: 'https://jobs.lever.co/acme/1/apply' }).url, 'https://jobs.lever.co/acme/1/apply');
  const verification = await verifyJob({ url: 'https://www.linkedin.com/jobs/view/1', description: 'Pasted text.' });
  assert.deepEqual([verification.state, verification.legitimacy], ['unverified', 'job-board'], 'no browser is launched for a board');
  let launched = false;
  const browser = new ApplicationBrowser({ launch: async () => { launched = true; throw new Error('should not launch'); } });
  await assert.rejects(browser.open({ id: 'b', url: 'https://www.linkedin.com/jobs/view/1' }, true), /doesn't open/);
  assert.equal(launched, false);
});

test('the employer’s link is the candidate’s to set, checked live, and never another board', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-applylink-'));
  const seen = [];
  const app = await createPlainhand({ root, workflowOptions: { verifier: async job => { seen.push(job.applyUrl); return { state: 'active', legitimacy: 'official-ats', checkedAt: new Date().toISOString(), reason: 'Fixture.' }; } } });
  try {
    const { result: { id } } = await app.registry.run('jobs.add', { company: 'Acme', title: 'Engineer', url: 'https://www.linkedin.com/jobs/view/42', description: 'Pasted.' }, { actor: 'ui' });
    await assert.rejects(app.registry.run('jobs.setApplyLink', { jobId: id, applyUrl: 'https://jobs.lever.co/acme/1/apply' }, { actor: 'agent', confirmed: true }), e => e.code === 'candidate_only');
    await assert.rejects(app.registry.run('jobs.setApplyLink', { jobId: id, applyUrl: 'https://www.indeed.com/viewjob?jk=1' }, { actor: 'ui' }), /employer’s own/);
    await app.registry.run('jobs.setApplyLink', { jobId: id, applyUrl: 'https://jobs.lever.co/acme/1/apply' }, { actor: 'ui' });
    const job = (await app.workspace.load()).jobs.find(j => j.id === id);
    assert.deepEqual([job.applyUrl, job.verification.state, seen[0]], ['https://jobs.lever.co/acme/1/apply', 'active', 'https://jobs.lever.co/acme/1/apply']);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('the approved cover letter and resume each go to their own upload field, never to the wrong one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-cover-'));
  const resume = path.join(root, 'resume.pdf'), letter = path.join(root, 'cover-letter.pdf');
  await writeFile(resume, '%PDF-1.4\nresume\n'); await writeFile(letter, '%PDF-1.4\nletter\n');
  let page;
  const browser = new ApplicationBrowser({ launch: async () => {
    const engine = await chromium.launch({ headless: true });
    const original = engine.newContext.bind(engine);
    engine.newContext = async options => {
      const context = await original(options);
      await context.route('**/*', route => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic application</h1><label>Resume<input type="file" name="resume"></label><label>Cover Letter<input type="file" name="cover"></label><button type="submit">Submit application</button>' })
        : route.fulfill({ status: 404 }));
      const create = context.newPage.bind(context); context.newPage = async () => page = await create();
      return context;
    };
    return engine;
  } });
  const job = { id: 'cover', url: 'https://jobs.ashbyhq.com/synthetic/456' };
  try {
    const fields = await browser.open(job, true);
    const answers = defaultFieldAnswers(fields, profile);
    assert.deepEqual(Object.values(answers).sort(), ['__cover_letter__', '__resume__']);
    const result = await browser.fill(job, answers, resume, letter);
    assert.deepEqual(result.filled.sort(), ['Cover Letter', 'Resume'].sort(), JSON.stringify(result));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map(i => [i.name, i.files[0]?.name])), [['resume', 'resume.pdf'], ['cover', 'cover-letter.pdf']]);
    const noLetter = await browser.fill(job, { [fields.find(f => /cover/i.test(f.label)).key]: '__cover_letter__' }, resume, null);
    assert.ok(noLetter.skipped.includes('Cover Letter') && !noLetter.filled.includes('Cover Letter'), 'without an approved cover letter nothing is uploaded');
  } finally { await browser.closeAll(); await rm(root, { recursive: true, force: true }); }
});
