// The browser extension's server routes (plainhand/cloud/extension-api.mjs), against an
// in-memory workspace: no database, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedWorkspace, callApi, WHY_QUESTION, WHY_ANSWER, RESUME_BYTES, COVER_BYTES } from './extension-fixture.mjs';
import { handleExtensionApi, matchJob, postingKeys } from '../plainhand/cloud/extension-api.mjs';

const FIELDS = [
  { key: '0:co0', label: 'First Name', type: 'text', required: true },
  { key: '0:co1', label: 'Last Name', type: 'text', required: true },
  { key: '0:co2', label: 'Email', type: 'email', required: true },
  { key: '0:co3', label: 'Resume/CV', type: 'file', required: true },
  { key: '0:co4', label: 'Cover Letter', type: 'file' },
  { key: '0:co5', label: WHY_QUESTION, type: 'textarea' },
  { key: '0:co6', label: 'Are you legally authorized to work in the United States?', type: 'select-one', options: ['Yes', 'No'], required: true },
  { key: '0:co7', label: 'Gender', type: 'combobox' },
  { key: '0:co8', label: 'Legal name', type: 'text' },
  { key: '0:co9', label: 'What is your favourite robot?', type: 'text', required: true },
  { key: '0:co10', label: 'I agree to the privacy notice', type: 'checkbox', required: true },
];

test('ignores paths outside /api/extension/', async () => {
  const deps = await approvedWorkspace();
  const result = await callApi(deps, 'POST', '/api/other', {});
  assert.equal(result.served, false);
});

test('match finds the saved role from the posting, apply page or an embedded Greenhouse page', async () => {
  const deps = await approvedWorkspace();
  for (const url of [
    'https://job-boards.greenhouse.io/acme/jobs/4012345',
    'https://job-boards.greenhouse.io/acme/jobs/4012345/?utm_source=linkedin#app',
    'https://www.acme-robotics.example/careers/open-roles?gh_jid=4012345',
  ]) {
    const { status, json } = await callApi(deps, 'POST', '/api/extension/match', { url });
    assert.equal(status, 200, url);
    assert.equal(json.match?.jobId, deps.approvedId, url);
    assert.equal(json.match.packet, 'approved');
  }
  const lever = await callApi(deps, 'POST', '/api/extension/match', { url: 'https://jobs.lever.co/beta/8f1e2d3c-1111-2222-3333-444455556666/apply' });
  assert.equal(lever.json.match.jobId, deps.draftId);
  assert.equal(lever.json.match.packet, 'needs-approval');
  assert.match(lever.json.match.text, /approve/i);
  const none = await callApi(deps, 'POST', '/api/extension/match', { url: 'https://example.com/jobs/1' });
  assert.equal(none.json.match, null);
  const local = await callApi(deps, 'POST', '/api/extension/match', { url: 'http://127.0.0.1:3000/x' });
  assert.equal(local.json.match, null);
});

test('match by applyUrl for a role saved from a job board', async () => {
  const jobs = [{ id: 'a', url: 'https://www.linkedin.com/jobs/view/123', applyUrl: 'https://jobs.ashbyhq.com/acme/1b2c3d4e-0000-1111-2222-333344445555' }];
  assert.equal(matchJob(jobs, 'https://jobs.ashbyhq.com/acme/1b2c3d4e-0000-1111-2222-333344445555/application')?.id, 'a');
  assert.equal(matchJob(jobs, 'https://jobs.ashbyhq.com/acme/other'), null);
});

test('a LinkedIn or Indeed posting matches under the URLs those sites show it at', async () => {
  const jobs = [{ id: 'li', url: 'https://www.linkedin.com/jobs/view/4012345678/' }, { id: 'in', url: 'https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b' }];
  assert.equal(matchJob(jobs, 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=analyst')?.id, 'li');
  assert.equal(matchJob(jobs, 'https://www.linkedin.com/jobs/view/4012345678/apply/?openSDUIApplyFlow=true')?.id, 'li');
  assert.equal(matchJob(jobs, 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4099999999'), null);
  assert.equal(matchJob(jobs, 'https://www.indeed.com/jobs?q=analyst&vjk=1a2b3c4d5e6f7a8b')?.id, 'in');
  assert.equal(matchJob(jobs, 'https://www.indeed.com/jobs?q=analyst&vjk=ffffffffffffffff'), null);
});

test('a board posting is identified by its id, never by its list path', () => {
  const jobs = [
    { id: 'job-a', url: 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa' },
    { id: 'job-b', url: 'https://www.indeed.com/viewjob?jk=bbbbbbbbbbbbbbbb' },
  ];
  assert.equal(matchJob(jobs, 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa')?.id, 'job-a');
  assert.equal(matchJob(jobs, 'https://www.indeed.com/viewjob?jk=bbbbbbbbbbbbbbbb')?.id, 'job-b', 'the second role is not the first one');
  assert.equal(matchJob(jobs, 'https://www.indeed.com/viewjob?jk=cccccccccccccccc'), null, 'an unsaved posting is not a saved role');
  assert.equal(matchJob([jobs[0]], 'https://www.indeed.com/viewjob?jk=bbbbbbbbbbbbbbbb'), null);
  // The same posting under the other URL shapes Indeed shows it at.
  assert.equal(matchJob([jobs[0]], 'https://www.indeed.com/jobs?q=analyst&vjk=aaaaaaaaaaaaaaaa')?.id, 'job-a');
  assert.equal(matchJob([jobs[0]], 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa&from=serp')?.id, 'job-a');
});

test('LinkedIn pages need the posting id; a list or search page alone matches nothing', () => {
  const saved = [{ id: 'li', url: 'https://www.linkedin.com/jobs/view/4012345678/' }];
  assert.equal(matchJob(saved, 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=analyst')?.id, 'li');
  assert.equal(matchJob(saved, 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678')?.id, 'li');
  assert.equal(matchJob(saved, 'https://www.linkedin.com/jobs/search/?currentJobId=4099999999'), null);
  assert.equal(matchJob(saved, 'https://www.linkedin.com/jobs/search/?keywords=analyst'), null);
  const savedFromSearch = [{ id: 'saved-search-page', url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678' }];
  assert.equal(matchJob(savedFromSearch, 'https://www.linkedin.com/jobs/search/?currentJobId=4099999999'), null);
  assert.equal(matchJob(savedFromSearch, 'https://www.linkedin.com/jobs/search/?keywords=analyst'), null);
});

test('contradictory ids and id-less board pages fail closed', () => {
  const jobs = [{ id: 'in', url: 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa' }];
  assert.equal(matchJob(jobs, 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa&vjk=bbbbbbbbbbbbbbbb'), null, 'two different ids are not one posting');
  assert.equal(matchJob(jobs, 'https://www.indeed.com/jobs?q=analyst'), null, 'no id, no match');
  const list = [{ id: 'list', url: 'https://www.indeed.com/jobs?q=analyst' }];
  assert.equal(matchJob(list, 'https://www.indeed.com/jobs?q=analyst'), null, 'an identical list address is still not a posting');
  assert.deepEqual(postingKeys('https://www.indeed.com/jobs?q=analyst').keys, []);
  assert.deepEqual(postingKeys('https://www.linkedin.com/jobs/search/?keywords=analyst').keys, []);
});

test('posting keys carry one host-scoped posting id', () => {
  assert.deepEqual(postingKeys('https://www.indeed.com/viewjob?jk=AAAAAAAAAAAAAAAA').keys, ['indeed.com:aaaaaaaaaaaaaaaa']);
  assert.deepEqual(postingKeys('https://uk.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa').keys, ['uk.indeed.com:aaaaaaaaaaaaaaaa']);
  assert.deepEqual(postingKeys('https://www.linkedin.com/jobs/view/senior-analyst-4012345678').keys, ['linkedin.com:4012345678']);
  assert.deepEqual(postingKeys('https://www.glassdoor.com/Job/x?jobListingId=1234567&utm_source=x').keys, ['glassdoor.com:1234567']);
  for (const url of ['https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa', 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678']) {
    const { keys } = postingKeys(url);
    assert.equal(keys.length, 1, url);
    assert.match(keys[0], /^[a-z0-9.-]+:[a-z0-9_-]+$/);
  }
});

test('two saved roles matching one page are ambiguous, not a guess', () => {
  const jobs = [
    { id: 'a', url: 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa', approvedHash: 'forged' },
    { id: 'b', url: 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa' },
  ];
  assert.equal(matchJob(jobs, 'https://www.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa'), null);
});

test('saving a board role twice is a duplicate; another posting is a new role', async () => {
  const deps = await approvedWorkspace();
  const posting = { company: 'Gamma Ltd', title: 'Financial Analyst', url: 'https://www.indeed.com/viewjob?jk=1212121212121212', description: 'Forecast and variance analysis in Excel.' };
  const first = await callApi(deps, 'POST', '/api/extension/save-job', posting);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.saved, true);
  const again = await callApi(deps, 'POST', '/api/extension/save-job', { ...posting, url: 'https://www.indeed.com/viewjob?jk=1212121212121212&from=serp' });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.saved, false, 'the same posting with tracking parameters is not saved twice');
  assert.equal(again.json.jobId, first.json.jobId);
  const other = await callApi(deps, 'POST', '/api/extension/save-job', { ...posting, company: 'Delta Ltd', title: 'Accountant', url: 'https://www.indeed.com/viewjob?jk=3434343434343434' });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  assert.equal(other.json.saved, true, 'a different posting on the same board path is a new role');
  assert.notEqual(other.json.jobId, first.json.jobId);
});

test('plan answers from the profile, packet and answer bank, leaves sensitive and unknown fields', async () => {
  const deps = await approvedWorkspace();
  const { status, json } = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: FIELDS });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.answers['0:co0'], 'Riley');
  assert.equal(json.answers['0:co1'], 'Example');
  assert.equal(json.answers['0:co2'], 'riley@example.invalid');
  assert.equal(json.answers['0:co3'], '__resume__');
  assert.equal(json.answers['0:co4'], '__cover_letter__');
  assert.equal(json.answers['0:co5'], WHY_ANSWER);
  assert.equal(json.answers['0:co8'], 'Riley Example');
  assert.deepEqual(json.identity, ['0:co8']);
  for (const key of ['0:co6', '0:co7', '0:co9', '0:co10']) assert.equal(json.answers[key], undefined, key);
  assert.deepEqual(json.files, { resume: true, cover: true });
  const left = Object.fromEntries(json.left.map(item => [item.key, item.reason]));
  assert.equal(left['0:co6'], 'sensitive');
  assert.equal(left['0:co7'], 'sensitive');
  assert.equal(left['0:co10'], 'sensitive');
  assert.equal(left['0:co9'], 'no-information');
  assert.equal(json.check.ready, false);
  assert.ok(json.check.summary.requiredFlagged >= 3);
});

test('plan uses an approved reusable answer when the packet has none', async () => {
  const deps = await approvedWorkspace();
  await deps.registry.run('answers.add', { question: 'What is your favourite robot?', answer: 'The Mars rover drive train.', evidence: [{ sourceId: 'interview', quote: 'Mars rover drive train' }] }, { actor: 'ui' }).catch(async () => {
    const { AnswerBank } = await import('../plainhand/answer-bank.mjs');
    await new AnswerBank(deps.workspace).add({ question: 'What is your favourite robot?', answer: 'The Mars rover drive train.', evidence: [{ sourceId: 'interview', quote: 'Mars rover drive train' }] });
  });
  const { json } = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: FIELDS });
  assert.equal(json.answers['0:co9'], 'The Mars rover drive train.');
});

test('plan needs an approved, current packet', async () => {
  const deps = await approvedWorkspace();
  const draft = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.draftId, fields: FIELDS });
  assert.equal(draft.status, 409);
  assert.match(draft.json.error, /approve/i);
  // A profile change after approval makes the packet stale.
  await deps.workspace.mutate(state => { state.profile.story = 'A different story.'; });
  const stale = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: FIELDS });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /changed/i);
});

test('plan refuses when the approved resume file was replaced', async () => {
  const deps = await approvedWorkspace();
  const state = await deps.workspace.load();
  await deps.workspace.write(state.jobs[0].pdf, Buffer.from('%PDF-1.4 something else'));
  const result = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: FIELDS });
  assert.equal(result.status, 409);
  assert.match(result.json.error, /resume file changed/);
});

test('plan validates its input and size', async () => {
  const deps = await approvedWorkspace();
  assert.equal((await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: [] })).status, 400);
  assert.equal((await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: [{ key: 'x', label: 'A', type: 'password' }] })).status, 400);
  assert.equal((await callApi(deps, 'POST', '/api/extension/plan', { jobId: 'nope', fields: FIELDS })).status, 404);
  assert.equal((await callApi(deps, 'POST', '/api/extension/plan', '{not json')).status, 400);
  const many = Array.from({ length: 301 }, (_, i) => ({ key: 'k' + i, label: 'Q' + i, type: 'text' }));
  assert.equal((await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: many })).status, 413);
  const huge = await callApi(deps, 'POST', '/api/extension/match', { url: 'https://example.com/' + 'x'.repeat(20000) });
  assert.equal(huge.status, 413);
  assert.match(huge.json.error, /too large/);
  assert.equal((await callApi(deps, 'GET', '/api/extension/plan')).status, 405);
  assert.equal((await callApi(deps, 'POST', '/api/extension/unknown', {})).status, 404);
});

test('file returns the exact approved PDFs and refuses other roles', async () => {
  const deps = await approvedWorkspace();
  const resume = await callApi(deps, 'GET', `/api/extension/file?jobId=${deps.approvedId}&kind=resume`);
  assert.equal(resume.status, 200);
  assert.equal(resume.headers['content-type'], 'application/pdf');
  assert.deepEqual(resume.raw, RESUME_BYTES);
  const cover = await callApi(deps, 'GET', `/api/extension/file?jobId=${deps.approvedId}&kind=cover`);
  assert.deepEqual(cover.raw, COVER_BYTES);
  // The unapproved role's files are never handed out.
  const other = await callApi(deps, 'GET', `/api/extension/file?jobId=${deps.draftId}&kind=resume`);
  assert.equal(other.status, 409);
  assert.equal(other.raw.includes(Buffer.from('%PDF')), false);
  assert.equal((await callApi(deps, 'GET', `/api/extension/file?jobId=${deps.approvedId}&kind=../../cv.md`)).status, 400);
  assert.equal((await callApi(deps, 'GET', `/api/extension/file?jobId=missing&kind=resume`)).status, 404);
});

test('file is scoped to the signed-in user\'s workspace', async () => {
  const mine = await approvedWorkspace();
  const theirs = await approvedWorkspace();
  // Same job id, other user's workspace: the handler only ever reads the workspace it is given.
  await theirs.workspace.mutate(state => { state.jobs = []; });
  const result = await callApi({ ...theirs, userId: 'user-2' }, 'GET', `/api/extension/file?jobId=${mine.approvedId}&kind=resume`);
  assert.equal(result.status, 404);
  const anonymous = await callApi({ ...mine, userId: null }, 'GET', `/api/extension/file?jobId=${mine.approvedId}&kind=resume`);
  assert.equal(anonymous.status, 401);
});

test('save-job adds the posting once', async () => {
  const deps = await approvedWorkspace();
  const body = { company: 'Gamma Motors', title: 'Design Engineer', url: 'https://jobs.ashbyhq.com/gamma/9a8b7c6d-0000-1111-2222-333344445555?utm_source=x', description: 'Design motors.' };
  const first = await callApi(deps, 'POST', '/api/extension/save-job', body);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.saved, true);
  const state = await deps.workspace.load();
  const job = state.jobs.find(j => j.id === first.json.jobId);
  assert.equal(job.company, 'Gamma Motors');
  assert.equal(job.url, 'https://jobs.ashbyhq.com/gamma/9a8b7c6d-0000-1111-2222-333344445555');
  assert.equal(job.description, 'Design motors.');
  assert.equal(job.stage, 'inbox');
  const again = await callApi(deps, 'POST', '/api/extension/save-job', body);
  assert.equal(again.status, 200);
  assert.equal(again.json.saved, false);
  assert.equal(again.json.jobId, first.json.jobId);
  assert.equal((await callApi(deps, 'POST', '/api/extension/save-job', { ...body, company: '' })).status, 400);
  assert.equal((await callApi(deps, 'POST', '/api/extension/save-job', { ...body, url: 'http://intranet/job' })).status, 400);
  const tooBig = await callApi(deps, 'POST', '/api/extension/save-job', { ...body, description: 'x'.repeat(300 * 1024) });
  assert.equal(tooBig.status, 413);
});

test('submitted records Applied through the candidate path', async () => {
  const deps = await approvedWorkspace();
  const { status, json } = await callApi(deps, 'POST', '/api/extension/submitted', { jobId: deps.approvedId });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.status, 'Applied');
  const state = await deps.workspace.load();
  const job = state.jobs.find(j => j.id === deps.approvedId);
  assert.equal(job.status, 'Applied');
  assert.equal(job.stage, 'submitted');
  assert.equal(job.submissionSource, 'candidate-confirmed');
  assert.ok(job.submittedAt);
  assert.match(await deps.workspace.read('data/applications.md'), /Acme Robotics \| Mechanical Engineer \| 4.5\/5 \| Applied/);
  const again = await callApi(deps, 'POST', '/api/extension/submitted', { jobId: deps.approvedId });
  assert.equal(again.json.already, true);
  // After submission, filling the form again is refused.
  const plan = await callApi(deps, 'POST', '/api/extension/plan', { jobId: deps.approvedId, fields: FIELDS });
  assert.equal(plan.status, 409);
  assert.equal((await callApi(deps, 'POST', '/api/extension/submitted', { jobId: 'missing' })).status, 404);
});

test('CORS is opened for extension origins only, and preflight is answered', async () => {
  const deps = await approvedWorkspace();
  const pre = await callApi(deps, 'OPTIONS', '/api/extension/plan', undefined, { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  const web = await callApi(deps, 'POST', '/api/extension/match', { url: 'https://example.com' }, { origin: 'https://evil.example' });
  assert.equal(web.headers['access-control-allow-origin'], undefined);
});

test('handler exports the contract signature', () => {
  assert.equal(typeof handleExtensionApi, 'function');
});
