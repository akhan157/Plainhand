// U08: application and site paths.
//
// Greenhouse, Lever and Ashby are exercised as three separate portals on their
// real public hostnames and path grammar. A local HTTPS server answers them on
// loopback; Chromium resolves those names to it, so the product's own host
// detection, submission guard and upload policy run unchanged. Nothing here
// contacts a real employer. Workday is best effort with a sign-in handoff.
// LinkedIn and Indeed are job boards: save, prepare, manual kit, tracking.
// An unknown careers site never blocks preparation.
//
// Every detector is mutation-checked: the same input with the planted failure
// answered (or the guard handed over) flips the verdict, so a pass is not a
// constant. Access tier: local-fixture for every run. The real-site read-only
// tier stays unverified by design and no real site is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createPlainhand } from '../plainhand-server.mjs';
import { ApplicationBrowser, applicationTarget, isBoardUrl, portalRoot, supportedUrl } from '../plainhand/jobs.mjs';
import { presubmitCheck } from '../plainhand/presubmit.mjs';
import { suggestFormAnswers } from '../plainhand/workflow.mjs';
import { digest } from '../plainhand/store.mjs';
import { isSensitiveLabel } from '../plainhand/field-policy.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { textPdf } from './helpers/hosted-onboarding.mjs';
import { startSiteFixtures, fixtureBrowserLaunch, fixtureUrl, FIXTURE_HOSTS, FIXTURE_PATHS, ACCESS_TIER } from '../plainhand/test-site-fixtures.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(REPO, 'output/u08');
const EVIDENCE_FILE = path.join(EVIDENCE, 'u08-sites.json');
const DESCRIPTION = `LOCAL FIXTURE, NOT A REAL EMPLOYER. Acme Robotics seeks a Graduate Mechanical Engineer in Boston to design lightweight chassis components, run physical tests, and explain design tradeoffs. ${'The role is entry level and reports to the vehicle engineering lead. '.repeat(3)}`;
const PROFILE = { ...candidate, phone: '+1 617 555 0107', links: 'https://www.linkedin.com/in/test-graduate, https://github.com/test-graduate' };
const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const sha256 = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

// No model-proposed form answers: every value below comes from the profile or
// the reviewed packet, so provenance and sensitive-field checks are exact.
const siteAgent = async (id, instruction, data, options) => {
  if (instruction.includes('Draft answers for these actual')) return { suggestions: [], questions: [] };
  return fixtureAgent(id, instruction, data, options);
};
const verifier = async () => ({ state: 'active', legitimacy: 'local-fixture', description: DESCRIPTION, checkedAt: new Date().toISOString(), reason: 'Local loopback fixture. No real employer was contacted.' });
const renderer = async (workspace, state, job) => {
  const pdf = `output/cv-${job.id}.pdf`, cover = `output/cover-letter-${job.id}.pdf`, answers = `output/answers-${job.id}.md`;
  await workspace.write(pdf, textPdf({ text: `${state.profile.name} — ${job.title} at ${job.company} — designed and tested a lightweight chassis` }));
  await workspace.write(cover, textPdf({ text: `Dear ${job.company}, I would like to bring my design and testing experience to the ${job.title} role.` }));
  await workspace.write(answers, `# ${job.company} — ${job.title}\n`);
  return { pdf, pdfHash: digest(await workspace.readBinary(pdf)), artifacts: [pdf, cover, answers] };
};

async function harness() {
  const sites = await startSiteFixtures();
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u08-'));
  const application = new ApplicationBrowser({ launch: fixtureBrowserLaunch(sites) });
  const app = await createPlainhand({ root, providers: fixtureProviders, browser: application, startFeatures: false, workflowOptions: { agent: siteAgent, verifier, renderer } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${endpoint}: ${data.error || 'HTTP ' + response.status}`);
    return data;
  };
  const run = async (kind, jobId) => {
    const { taskId } = await request('tasks', { kind, jobId });
    await app.workflow.queue;
    const task = (await app.workspace.load()).tasks.find(item => item.id === taskId);
    assert.equal(task.status, 'complete', `${kind}: ${task.message}`);
  };
  const configure = async () => {
    const state = await app.workspace.load();
    await request('profile', { profile: PROFILE, revision: state.revision });
    await request('provider', { id: 'codex' });
  };
  const prepare = async (url, { company = 'Acme Robotics', title = 'Graduate Mechanical Engineer' } = {}) => {
    const { id } = await request('jobs', { company, title, url, description: DESCRIPTION, location: 'Boston, MA' });
    await run('evaluate', id);
    await request('jobs/update', { id, selected: true });
    await run('prepare', id);
    const job = (await app.workspace.load()).jobs.find(item => item.id === id);
    assert.ok(job.packet, 'the packet was prepared');
    assert.equal(job.packet.questions.length, 0);
    assert.equal(job.review?.passed, true);
    return job;
  };
  const freshJob = async id => (await app.workspace.load()).jobs.find(item => item.id === id);
  const pageOf = id => {
    const session = application.sessions.get(id);
    assert.ok(session && !session.page.isClosed(), 'the application browser is open');
    return session.page;
  };
  const close = async () => {
    await app.close();
    await sites.close();
    await rm(root, { recursive: true, force: true });
  };
  return { sites, root, app, application, request, run, configure, prepare, freshJob, pageOf, close };
}

async function recordRun(row) {
  await mkdir(EVIDENCE, { recursive: true });
  let evidence = { suite: 'tests/test-u08-sites.mjs', accessTier: ACCESS_TIER, realSiteReadOnly: 'unverified by design; no real employer site was contacted', runs: [] };
  try { evidence = JSON.parse(await readFile(EVIDENCE_FILE, 'utf8')); } catch {}
  evidence.accessTier = ACCESS_TIER;
  evidence.runs = [...(evidence.runs || []).filter(item => item.id !== row.id), { ...row, accessTier: ACCESS_TIER, recordedAt: new Date().toISOString() }];
  await writeFile(EVIDENCE_FILE, JSON.stringify(evidence, null, 2) + '\n');
  const { id, host, path: route, summary } = row;
  console.log(`U08 ${id.padEnd(20)} ${String(host).padEnd(30)} ${String(route).padEnd(42)} tier=${row.accessTier || ACCESS_TIER} ${JSON.stringify(summary)}`);
}

async function domValues(page, fields) {
  const values = {};
  for (const field of fields.filter(item => item.selector && !item.native)) {
    values[field.key] = await page.locator(field.selector).evaluate(el => el.value ?? el.textContent ?? '');
  }
  return values;
}

async function uploadFacts(page, selector) {
  return page.locator(selector).evaluate(async el => {
    const file = el.files?.[0];
    if (!file) return null;
    return { name: file.name, size: file.size, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
  });
}

async function waitFor(label, probe, timeout = 6000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const SOURCES = new Set(['your profile', 'your application materials', 'your approved resume', 'you, on the page']);

// ---- 1. Per-ATS fill, readback, upload hash, provenance, no submission ----

for (const ats of [
  { kind: 'greenhouse', label: 'Greenhouse', host: FIXTURE_HOSTS.greenhouse, url: () => fixtureUrl('greenhouse'), formPath: FIXTURE_PATHS.greenhouse.apply },
  { kind: 'lever', label: 'Lever', host: FIXTURE_HOSTS.lever, url: () => fixtureUrl('lever'), formPath: FIXTURE_PATHS.lever.apply },
  { kind: 'ashby', label: 'Ashby', host: FIXTURE_HOSTS.ashby, url: () => fixtureUrl('ashby', 'apply'), formPath: FIXTURE_PATHS.ashby.apply },
]) {
  test(`${ats.label}: fills the packet into its own portal, reads every field back, uploads the approved PDF, and ends at user review without submitting`, async () => {
    const h = await harness();
    try {
      await h.configure();
      const job = await h.prepare(ats.url());
      await h.request('packet/approve', { id: job.id });
      const plan = await h.request('browser/autofill', { id: job.id });
      const page = h.pageOf(job.id);
      const fresh = await h.freshJob(job.id);
      const checkpoint = fresh.browserCheckpoint;
      assert.ok(checkpoint, 'the fill recorded a checkpoint');
      assert.equal(checkpoint.packetHash, fresh.approvedHash);
      const check = checkpoint.check;
      assert.equal(check.ready, true, `review is ready: ${JSON.stringify(check.summary)}`);
      assert.equal(check.summary.mismatched, 0);

      const filled = check.items.filter(item => item.status === 'filled');
      assert.ok(filled.length >= 5, `${ats.label} filled ${filled.length} fields`);
      for (const item of filled) assert.ok(SOURCES.has(item.source), `provenance for ${item.label}: ${item.source}`);
      const sources = new Set(filled.map(item => item.source));
      assert.ok(sources.has('your profile'), 'a profile value is recorded');
      assert.ok(sources.has('your approved resume'), 'the approved resume is recorded');
      assert.ok(sources.has('your application materials'), 'a packet answer is recorded');

      const values = await domValues(page, plan.fields);
      for (const item of filled) {
        const field = plan.fields.find(entry => entry.key === item.key);
        if (!field || field.type === 'file') continue;
        assert.equal(norm(values[item.key]), norm(plan.answers[item.key]), `${item.label} reads back from the DOM`);
      }

      const resumeField = plan.fields.find(field => field.type === 'file' && /resume/i.test(field.label));
      const uploaded = await uploadFacts(page, resumeField.selector);
      assert.ok(uploaded, 'the resume file input holds a file');
      const packetBytes = await readFile(await h.app.workspace.safe(fresh.pdf));
      assert.equal(uploaded.size, packetBytes.length);
      assert.equal(sha256(uploaded.bytes), sha256(packetBytes), 'the uploaded resume is byte-identical to the approved PDF');
      assert.equal(fresh.pdfHash, digest(packetBytes));

      const cover = plan.fields.find(field => field.type === 'file' && /cover/i.test(field.label));
      const coverArtifact = fresh.artifacts.find(file => /cover-letter.*\.pdf$/.test(file));
      if (cover && coverArtifact) {
        const uploadedCover = await uploadFacts(page, cover.selector);
        assert.ok(uploadedCover, 'the cover letter input holds a file');
        assert.equal(sha256(uploadedCover.bytes), sha256(await readFile(await h.app.workspace.safe(coverArtifact))), 'the uploaded cover letter is byte-identical');
      }

      // No submission: no write reached the fixture, the page script saw no
      // submit event, and the browser stayed on the form.
      assert.equal(h.sites.postsFor(ats.host).length, 0, 'no POST reached the portal');
      assert.equal(await page.evaluate(() => window.submissions), 0, 'the page saw no submit event');
      assert.equal(new URL(page.url()).pathname, ats.formPath);
      assert.equal(plan.observation.state, 'review');
      assert.match(plan.observation.message, /Review/i);
      assert.equal(fresh.status, 'Apply');
      assert.equal(fresh.submittedAt, undefined);

      await recordRun({
        id: `${ats.kind}-fill`, host: ats.host, path: ats.formPath, detector: 'per-ats-fill',
        summary: { fields: plan.fields.length, filled: filled.length, flagged: check.summary.flagged, ready: check.ready, resumeHashMatched: true, coverHashMatched: Boolean(cover && coverArtifact), provenance: [...sources], posts: 0, observation: plan.observation.state },
      });
    } finally { await h.close(); }
  });
}

// ---- 2. Workday: best-effort first step, explicit sign-in handoff ----

test('Workday: the first step is filled best effort, then the portal hands off at its sign-in wall with preparation and tracking intact', async () => {
  const h = await harness();
  try {
    await h.configure();
    const job = await h.prepare(fixtureUrl('workday'), { title: 'Graduate Mechanical Engineer (Workday)' });
    await h.request('packet/approve', { id: job.id });
    const result = await h.request('browser/autofill', { id: job.id });
    assert.ok(result.steps.length >= 1, 'one Workday step was processed');
    assert.ok(result.steps[0].filled.length >= 4, `first step filled ${result.steps[0].filled.length} fields`);
    assert.equal(result.observation.state, 'login');
    assert.match(result.observation.message, /sign in|create an account/i);
    const fresh = await h.freshJob(job.id);
    assert.ok(fresh.browserCheckpoint, 'the first-step answers were journalled');
    assert.ok(fresh.browserCheckpoint.result.filled.length >= 4);
    assert.equal(fresh.status, 'Apply');
    assert.equal(fresh.submittedAt, undefined);
    const tracker = await h.app.workspace.read('data/applications.md');
    assert.match(tracker, /Acme Robotics/);
    assert.match(tracker, /Graduate Mechanical Engineer \(Workday\)/);
    assert.match(tracker, /Apply/);
    const attention = await h.request('browser/attention', { id: job.id });
    assert.match(attention.message, /Sign in to acme\.wd5\.myworkdayjobs\.com/);
    assert.ok(fresh.packet && fresh.pdf && fresh.pdfHash, 'preparation is intact');
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.workday).length, 0);
    await recordRun({
      id: 'workday-handoff', host: FIXTURE_HOSTS.workday, path: FIXTURE_PATHS.workday.apply, detector: 'workday-handoff',
      summary: { steps: result.steps.length, firstStepFilled: result.steps[0].filled.length, observation: result.observation.state, handoff: attention.message.slice(0, 80), tracked: true, packetIntact: true, posts: 0 },
    });
  } finally { await h.close(); }
});

// ---- 3. LinkedIn and Indeed: save, prepare, manual kit, tracking ----

for (const board of [
  { kind: 'linkedin', label: 'LinkedIn', host: FIXTURE_HOSTS.linkedin, url: () => fixtureUrl('linkedin'), title: 'Graduate Mechanical Engineer' },
  { kind: 'indeed', label: 'Indeed', host: FIXTURE_HOSTS.indeed, url: () => fixtureUrl('indeed'), title: 'Mechanical Design Engineer' },
]) {
  test(`${board.label}: the posting is saved without opening it, preparation succeeds, the manual kit carries the documents and answers, and tracking continues`, async () => {
    const h = await harness();
    try {
      await h.configure();
      const job = await h.prepare(board.url(), { title: board.title });
      assert.equal(isBoardUrl(job.url), true, `${board.label} is recognised as a job board`);
      assert.throws(() => applicationTarget(job), /doesn't open/);
      assert.equal(job.status, 'Apply');
      assert.equal(job.submittedAt, undefined);
      const kit = await h.request('jobs/manual-kit', { id: job.id });
      const byName = Object.fromEntries(kit.files.map(file => [file.name, file.path]));
      const pdfBytes = await readFile(await h.app.workspace.safe(job.pdf));
      assert.deepEqual(await readFile(await h.app.workspace.safe(byName['resume.pdf'])), pdfBytes, 'the kit resume is the approved PDF');
      const cover = job.artifacts.find(file => /cover-letter.*\.pdf$/.test(file));
      assert.ok(cover, 'a cover letter was rendered');
      assert.deepEqual(await readFile(await h.app.workspace.safe(byName['cover-letter.pdf'])), await readFile(await h.app.workspace.safe(cover)));
      const answers = await readFile(await h.app.workspace.safe(byName['answers.md']), 'utf8');
      for (const answer of job.packet.answers) assert.ok(answers.includes(answer.answer), `kit answer for ${answer.question}`);
      const posting = await readFile(await h.app.workspace.safe(byName['posting.md']), 'utf8');
      assert.match(posting, /Acme Robotics/);
      assert.ok(posting.includes(job.url), 'the posting link is in the kit');
      const meta = JSON.parse(await readFile(await h.app.workspace.safe(byName['kit.json']), 'utf8'));
      assert.equal(meta.posting, job.url);
      const fresh = await h.freshJob(job.id);
      assert.equal(fresh.status, 'Apply');
      const tracker = await h.app.workspace.read('data/applications.md');
      assert.match(tracker, new RegExp(board.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(tracker, /Apply/);
      assert.ok(fresh.trackerNumber, 'the tracker row has a number');
      await recordRun({
        id: `${board.kind}-manual-kit`, host: board.host, path: new URL(board.url()).pathname, detector: 'board-manual-kit',
        summary: { board: true, browserOpened: false, packetPrepared: true, kitFiles: kit.files.map(file => file.name), answers: job.packet.answers.length, tracked: true, status: fresh.status },
      });
    } finally { await h.close(); }
  });
}

// ---- 4. Unsupported site never blocks preparation ----

test('an unknown careers host cannot block preparation: the packet is rendered, the kit is written and the job stays tracked', async () => {
  const h = await harness();
  try {
    await h.configure();
    const url = fixtureUrl('unknown');
    const job = await h.prepare(url, { title: 'Graduate Design Engineer' });
    assert.equal(supportedUrl(job.url), false, 'the host is not a known ATS');
    assert.equal(isBoardUrl(job.url), false);
    assert.equal(portalRoot(job.url), 'acme-u08.invalid');
    const kit = await h.request('jobs/manual-kit', { id: job.id });
    const names = kit.files.map(file => file.name);
    for (const name of ['posting.md', 'resume.pdf', 'cover-letter.pdf', 'answers.md', 'kit.json']) assert.ok(names.includes(name), `${name} is in the kit`);
    const fresh = await h.freshJob(job.id);
    assert.equal(fresh.status, 'Apply');
    assert.equal(fresh.stage, 'packet-ready');
    const tracker = await h.app.workspace.read('data/applications.md');
    assert.match(tracker, /Graduate Design Engineer/);
    assert.match(tracker, /Apply/);
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.unknown).length, 0);
    await recordRun({
      id: 'unsupported-manual-kit', host: FIXTURE_HOSTS.unknown, path: FIXTURE_PATHS.unknown.board, detector: 'unsupported-manual-kit',
      summary: { supportedUrl: false, packetPrepared: true, kitFiles: names, tracked: true, status: fresh.status, blocked: false },
    });
  } finally { await h.close(); }
});

// ---- 5. Detectors, each with a planted failure and a mutation ----

test('false-ready detector: a required question Plainhand cannot answer is not reported ready, and answering it flips the verdict', async () => {
  const h = await harness();
  try {
    await h.configure();
    const job = await h.prepare(`https://${FIXTURE_HOSTS.greenhouse}${FIXTURE_PATHS.greenhousePlanted.board}`, { title: 'Graduate Mechanical Engineer (planted required field)' });
    await h.request('packet/approve', { id: job.id });
    const plan = await h.request('browser/open', { id: job.id });
    assert.equal(plan.observation.state, 'ready', 'the page is fillable');
    assert.equal(plan.check.ready, false, 'the review is not ready');
    const missing = plan.check.items.find(item => item.status === 'flagged' && /portfolio/i.test(item.label));
    assert.ok(missing, 'the planted required field is flagged');
    assert.equal(missing.required, true);
    assert.equal(plan.check.summary.requiredFlagged >= 1, true);

    // Mutation 1: provide the missing answer; the same check becomes ready.
    const mutated = presubmitCheck({ fields: plan.fields, answers: { ...plan.answers, [missing.key]: 'https://portfolio.example' }, questions: plan.questions || [], profile: PROFILE });
    assert.equal(mutated.ready, true, 'ready follows the input, not a constant');
    // Mutation 2: a DOM value that disagrees with the plan is a mismatch, not ready.
    const email = plan.fields.find(field => /email/i.test(field.label));
    const disagreed = presubmitCheck({ fields: plan.fields, answers: { ...plan.answers, [missing.key]: 'https://portfolio.example' }, readback: { [email.key]: 'someone-else@example.invalid' }, profile: PROFILE });
    assert.equal(disagreed.ready, false);
    assert.equal(disagreed.items.find(item => item.key === email.key).reason, 'changed-on-page');
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.greenhouse).length, 0);
    await recordRun({
      id: 'detector-false-ready', host: FIXTURE_HOSTS.greenhouse, path: FIXTURE_PATHS.greenhousePlanted.apply, detector: 'false-ready',
      summary: { readyWithMissingRequired: plan.check.ready, requiredFlagged: plan.check.summary.requiredFlagged, readyWhenAnswered: mutated.ready, readyOnReadbackMismatch: disagreed.ready, posts: 0 },
    });
  } finally { await h.close(); }
});

test('sensitive-field detector: SSN, birth date, race, disability and salary history stay empty and are flagged, while neutral labels with the same answers fill', async () => {
  const h = await harness();
  try {
    await h.configure();
    const job = await h.prepare(fixtureUrl('lever'), { title: 'Graduate Mechanical Engineer (sensitive fields)' });
    await h.request('packet/approve', { id: job.id });
    await h.request('browser/autofill', { id: job.id });
    const page = h.pageOf(job.id);
    for (const name of ['ssn', 'dob', 'salary']) assert.equal(await page.locator(`[name="${name}"]`).inputValue(), '', `${name} stays empty`);
    assert.equal(await page.locator('[name="disability"]').inputValue(), '', 'disability stays empty');
    assert.equal(await page.locator('input[name="race"]:checked').count(), 0, 'no race option is selected');
    const fresh = await h.freshJob(job.id);
    const flagged = fresh.browserCheckpoint.check.items.filter(item => item.reason === 'sensitive');
    const labels = flagged.map(item => item.label);
    for (const wanted of ['Social Security Number', 'Date of Birth', 'Race', 'Disability Status', 'Salary History']) assert.ok(labels.includes(wanted), `${wanted} is flagged sensitive: ${labels.join(' | ')}`);
    assert.equal(fresh.browserCheckpoint.result.filled.some(label => /social security|date of birth|race|disability|salary/i.test(label)), false);

    // Mutation: the same values under neutral labels do fill, so the blocker is
    // the sensitive classification, not an absent answer or an empty profile.
    const sensitive = [
      { key: 'a', label: 'Social Security Number', type: 'text' },
      { key: 'b', label: 'Date of Birth', type: 'date' },
      { key: 'c', label: 'Salary History', type: 'textarea' },
    ];
    const neutral = [
      { key: 'a', label: 'Employee reference code', type: 'text' },
      { key: 'b', label: 'Program start date', type: 'date' },
      { key: 'c', label: 'Project budget', type: 'textarea' },
    ];
    const answers = fields => ({ answers: fields.map(field => ({ question: field.label, answer: 'planted-value' })) });
    assert.deepEqual(suggestFormAnswers(sensitive, PROFILE, answers(sensitive)), {});
    assert.deepEqual(suggestFormAnswers(neutral, PROFILE, answers(neutral)), { a: 'planted-value', b: 'planted-value', c: 'planted-value' });
    for (const label of ['Social Security Number', 'SSN', 'Date of Birth', 'Race', 'Disability Status', 'Salary History']) assert.equal(isSensitiveLabel(label), true, label);
    for (const label of ['Employee reference code', 'Program start date', 'Project budget']) assert.equal(isSensitiveLabel(label), false, label);
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.lever).length, 0);
    await recordRun({
      id: 'detector-sensitive', host: FIXTURE_HOSTS.lever, path: FIXTURE_PATHS.lever.apply, detector: 'sensitive-field',
      summary: { domEmpty: true, flagged: labels, filledUnderNeutralLabels: 3, posts: 0 },
    });
  } finally { await h.close(); }
});

test('unauthorized-submission detector: advancing never clicks the submit control, a planted submit click is blocked by the guard, and handing the browser over lets the same click post', async () => {
  const h = await harness();
  try {
    await h.configure();
    const job = await h.prepare(fixtureUrl('greenhouse'), { title: 'Graduate Mechanical Engineer (submit guard)' });
    await h.request('packet/approve', { id: job.id });
    await h.request('browser/autofill', { id: job.id });
    const page = h.pageOf(job.id);
    assert.equal(await page.evaluate(() => window.__plainhandBlockSubmission), true, 'the DOM submit interlock is armed');

    // The product's own advance routine finds no unambiguous next-step control
    // and never treats the submit button as navigation.
    const advanced = await h.request('browser/advance', { id: job.id });
    assert.equal(advanced.observation.advanced, false);
    assert.equal(advanced.observation.state, 'review');
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.greenhouse).length, 0);

    // Planted failure through the fixture's test hook: clicking the real submit
    // button is prevented by the guard.
    const guardedUrl = page.url();
    await page.evaluate(() => window.__plainhandPlantSubmit());
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(h.sites.postsFor(FIXTURE_HOSTS.greenhouse).length, 0, 'the guarded click posted nothing');
    assert.equal(await page.evaluate(() => window.submissions), 0, 'the submit event never reached the page');
    assert.equal(page.url(), guardedUrl);

    // Mutation: hand the browser to the candidate (the guard is removed), then
    // the same planted click must reach the portal, or the detector proves nothing.
    const handoff = await h.request('browser/handoff', { id: job.id });
    assert.match(handoff.message, /browser is yours/i);
    assert.equal(await page.evaluate(() => window.__plainhandBlockSubmission), false);
    await page.evaluate(() => window.__plainhandPlantSubmit());
    const posted = await waitFor('the handed-over click to reach the fixture', () => h.sites.postsFor(FIXTURE_HOSTS.greenhouse).length);
    assert.equal(posted, 1);
    await recordRun({
      id: 'detector-unauthorized-submit', host: FIXTURE_HOSTS.greenhouse, path: FIXTURE_PATHS.greenhouse.apply, detector: 'unauthorized-submission',
      summary: { advanceClickedSubmit: false, guardedPosts: 0, guardArmed: true, handedOverPosts: posted, handoffMessage: handoff.message.slice(0, 60) },
    });
  } finally { await h.close(); }
});
