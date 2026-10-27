import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { Workspace, digest, syncTracker } from './plainhand/store.mjs';
import { packetIdentity } from './plainhand/workflow.mjs';
import { addContact, addInterview, setInterviewStatus, removeEntry, setNextAction, providerJob, trackerNote, followUpQueue, upcomingInterview, recordOf } from './plainhand/application-record.mjs';
import { candidate, fixtureAgent, fixtureProviders } from './plainhand/test-fixtures.mjs';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-record-'));
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent: fixtureAgent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
    renderer: async (workspace, state, job) => {
      const pdf = `output/test-${job.id}.pdf`;
      await workspace.write(pdf, 'test-pdf');
      return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] };
    },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const state = (await request('state')).data;
  assert.equal((await request('profile', { profile: candidate, revision: state.revision })).status, 200);
  assert.equal((await request('provider', { id: 'codex' })).status, 200);
  const run = async (kind, jobId) => {
    const result = await request('tasks', { kind, jobId });
    assert.equal(result.status, 202, JSON.stringify(result.data));
    await app.workflow.queue;
    return (await app.workspace.load()).tasks.find(t => t.id === result.data.taskId);
  };
  return { app, request, run, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('contacts are validated, deduplicated per role and removable', () => {
  const job = {};
  const recruiter = addContact(job, { name: ' Dana  Lee ', role: 'Technical recruiter', email: 'dana@example.invalid', linkedin: 'https://www.linkedin.com/in/example' }, { id: 'c1', at: '2026-10-20T10:00:00.000Z' });
  assert.equal(recruiter.name, 'Dana Lee');
  assert.equal(recruiter.type, 'recruiter');
  assert.equal(recruiter.date, '2026-10-20');
  assert.throws(() => addContact(job, { name: 'dana lee', email: 'DANA@example.invalid' }), /already recorded/);
  assert.throws(() => addContact(job, { name: 'No Email', email: 'not-an-email' }), /valid email/);
  assert.throws(() => addContact(job, { name: 'Bad Link', linkedin: 'javascript:alert(1)' }), /https/);
  assert.throws(() => addContact(job, { name: 'Odd', type: 'friend' }), /contact type/);
  assert.throws(() => addContact(job, { name: '  ' }), /contact name/);
  addContact(job, { name: 'Sam Ortiz', type: 'Hiring Manager' }, { id: 'c2' });
  assert.deepEqual(recordOf(job).contacts.map(c => [c.id, c.type]), [['c1', 'recruiter'], ['c2', 'hiring manager']]);
  removeEntry(job, 'contacts', 'c1');
  assert.deepEqual(recordOf(job).contacts.map(c => c.id), ['c2']);
  assert.throws(() => removeEntry(job, 'contacts', 'c1'), /not found/);
});

test('interview rounds need a real calendar date, stay date-ordered and track their own status', () => {
  const job = {};
  assert.throws(() => addInterview(job, { stage: 'Onsite', date: '2026-02-30' }), /real date/);
  assert.throws(() => addInterview(job, { stage: 'Onsite', date: '10/30/2026' }), /real date/);
  assert.throws(() => addInterview(job, { stage: 'Onsite' }), /interview date/);
  assert.throws(() => addInterview(job, { date: '2026-11-02' }), /interview stage/);
  addInterview(job, { stage: 'Technical', date: '2026-11-05', interviewer: 'Sam Ortiz', preparation: 'Review the chassis load test story' }, { id: 'i2' });
  addInterview(job, { stage: 'Recruiter screen', date: '2026-10-28', status: 'completed', notes: 'Asked about  testing.\r\n\r\n\r\n\nNext:   send the report ' }, { id: 'i1' });
  assert.equal(recordOf(job).interviews.find(i => i.id === 'i1').notes, 'Asked about testing.\n\nNext: send the report', 'notes keep paragraphs but not stray whitespace');
  assert.deepEqual(recordOf(job).interviews.map(i => i.id), ['i1', 'i2']);
  assert.equal(upcomingInterview(job, { asOf: '2026-10-30' }).id, 'i2');
  setInterviewStatus(job, 'i2', 'canceled');
  assert.equal(upcomingInterview(job, { asOf: '2026-10-30' }), null);
  assert.throws(() => setInterviewStatus(job, 'i2', 'maybe'), /interview status/);
  assert.throws(() => setInterviewStatus(job, 'missing', 'completed'), /not found/);
});

test('a next action is dated, clearable and written to the canonical tracker notes', async () => {
  const job = { id: 'j1', company: 'Example Co', title: 'Graduate Engineer', status: 'Applied', createdAt: '2026-10-01T00:00:00.000Z', evaluation: { score: 4.5 }, stage: 'submitted' };
  assert.throws(() => setNextAction(job, { text: 'Follow up', due: '2026-13-01' }), /real date/);
  setNextAction(job, { text: 'Email Dana a thank-you note', due: '2026-10-28' });
  assert.equal(trackerNote(job), 'submitted · next: Email Dana a thank-you note by 2026-10-28');
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-record-tracker-'));
  try {
    const workspace = new Workspace(root);
    await syncTracker(workspace, { jobs: [job] });
    assert.match(await workspace.read('data/applications.md'), /\| Applied \| — \|  \| submitted · next: Email Dana a thank-you note by 2026-10-28 \|/);
    setNextAction(job, { text: '   ' });
    assert.equal(recordOf(job).nextAction, null, 'blank text clears instead of storing an empty reminder');
    await syncTracker(workspace, { jobs: [job] });
    assert.match(await workspace.read('data/applications.md'), /\| Applied \| — \|  \| submitted \|/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the follow-up queue puts overdue actions first and still surfaces active roles with no next step', () => {
  const jobs = [
    { id: 'later', status: 'Applied', record: { nextAction: { text: 'Check portal', due: '2026-11-10' } } },
    { id: 'none', status: 'Interview', statusHistory: [{ to: 'Interview', at: '2026-10-01T00:00:00.000Z' }] },
    { id: 'undated', status: 'Responded', record: { nextAction: { text: 'Send availability' } } },
    { id: 'overdue', status: 'Applied', record: { nextAction: { text: 'Nudge recruiter', due: '2026-10-20' } } },
    { id: 'today', status: 'Evaluated', record: { nextAction: { text: 'Decide whether to apply', due: '2026-10-25' } } },
    { id: 'quiet', status: 'Evaluated' },
    { id: 'closed', status: 'Rejected' },
  ];
  const queue = followUpQueue(jobs, { asOf: '2026-10-25' });
  assert.deepEqual(queue.map(item => item.job.id), ['overdue', 'today', 'later', 'undated', 'none']);
  assert.equal(queue[0].overdue, true);
  assert.equal(queue[1].dueToday, true);
  assert.equal(queue.at(-1).action, null);
});

test('application records never reach the provider and survive a task that was running when they were added', async () => {
  const h = await harness();
  try {
    const id = (await h.request('jobs', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/9' })).data.id;
    assert.equal((await h.request('jobs/record/contact', { id, contact: { name: 'Dana Lee', email: 'dana@example.invalid', notes: 'Met at the career fair' } })).status, 200);
    const payloads = [];
    let release;
    h.app.workflow.agent = (provider, instruction, data) => {
      payloads.push(JSON.stringify(data));
      if (!release) return new Promise(resolve => { release = () => resolve(fixtureAgent(provider, instruction, data)); });
      return fixtureAgent(provider, instruction, data);
    };
    const pending = h.request('tasks', { kind: 'evaluate', jobId: id });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    // The candidate keeps working while the evaluation is in flight.
    assert.equal((await h.request('jobs/record/interview', { id, interview: { stage: 'Recruiter screen', date: '2026-11-02' } })).status, 200);
    assert.equal((await h.request('jobs/record/next-action', { id, text: 'Prepare for the screen', due: '2026-11-01' })).status, 200);
    release();
    await pending; await h.app.workflow.queue;
    let job = (await h.app.workspace.load()).jobs[0];
    assert.ok(job.evaluation, 'evaluation completed');
    assert.equal(job.record.contacts[0].name, 'Dana Lee');
    assert.equal(job.record.interviews[0].stage, 'Recruiter screen', 'mid-task record edits are not overwritten by the task result');
    assert.equal(job.record.nextAction.text, 'Prepare for the screen');
    assert.match(await h.app.workspace.read('data/applications.md'), /next: Prepare for the screen by 2026-11-01/);

    await h.request('jobs/update', { id, selected: true });
    assert.equal((await h.run('prepare', id)).status, 'complete');
    assert.equal((await h.request('packet/approve', { id })).status, 200);
    job = (await h.app.workspace.load()).jobs[0];
    for (const payload of payloads) {
      assert.doesNotMatch(payload, /Dana Lee|dana@example\.invalid|career fair|Recruiter screen|Prepare for the screen/, 'no contact, interview or next action text is sent to the model');
    }
    assert.ok(payloads.length >= 3, 'evaluate, prepare and review were all checked');

    // Record edits are not candidate evidence: they never invalidate the approved packet.
    const approved = job.approvedHash;
    assert.equal((await h.request('jobs/record/contact', { id, contact: { name: 'Sam Ortiz', type: 'hiring manager' } })).status, 200);
    const interviewId = job.record.interviews[0].id;
    assert.equal((await h.request('jobs/record/interview-status', { id, entryId: interviewId, status: 'completed' })).status, 200);
    job = (await h.app.workspace.load()).jobs[0];
    assert.equal(job.approvedHash, approved);
    assert.equal(packetIdentity(job), approved);
    assert.equal(job.record.interviews[0].status, 'completed');
    assert.equal(job.status, 'Apply', 'recording an interview never changes the tracker status');

    const state = (await h.request('state')).data;
    assert.equal(state.followUps[0].jobId, id);
    assert.equal(state.followUps[0].action, 'Prepare for the screen');

    assert.equal((await h.request('jobs/record/contact', { id, contact: { name: 'Sam Ortiz' } })).status, 400);
    assert.equal((await h.request('jobs/record/interview', { id, interview: { stage: 'Onsite', date: 'soon' } })).status, 400);
    assert.equal((await h.request('jobs/record/unknown', { id })).status, 400);
    assert.equal((await h.request('jobs/record/contact', { id: 'missing', contact: { name: 'X' } })).status, 400);
    assert.equal((await h.request('jobs/record/remove-contact', { id, entryId: job.record.contacts[1].id })).status, 200);
    assert.deepEqual((await h.app.workspace.load()).jobs[0].record.contacts.map(c => c.name), ['Dana Lee']);
  } finally { await h.close(); }
});

test('a status change made during an evaluation keeps its history entry', async () => {
  const h = await harness();
  try {
    const id = (await h.request('jobs', { company: 'Test Company', title: 'Graduate Engineer', url: 'https://jobs.lever.co/test/10' })).data.id;
    assert.equal((await h.run('evaluate', id)).status, 'complete');
    assert.equal((await h.request('jobs/update', { id, status: 'Apply' })).status, 200);
    let release;
    h.app.workflow.agent = (provider, instruction, data) => new Promise(resolve => { release = () => resolve(fixtureAgent(provider, instruction, data)); });
    const pending = h.request('tasks', { kind: 'evaluate', jobId: id });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await h.request('jobs/update', { id, status: 'Discarded' })).status, 200);
    release();
    await pending; await h.app.workflow.queue;
    const job = (await h.app.workspace.load()).jobs[0];
    assert.equal(job.status, 'Discarded');
    assert.deepEqual(job.statusHistory.map(entry => entry.to), ['Apply', 'Discarded']);
  } finally { await h.close(); }
});

test('the provider projection removes only the private record', () => {
  const job = { id: 'j', company: 'C', title: 'T', description: 'D', evaluation: { score: 4 }, record: { contacts: [{ name: 'Private' }] } };
  assert.deepEqual(providerJob(job), { id: 'j', company: 'C', title: 'T', description: 'D', evaluation: { score: 4 } });
  assert.ok(job.record, 'the stored job is not mutated');
});
