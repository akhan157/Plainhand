// Story lifecycle (durable-memory packet M3). A saved story is evidence, so editing or
// deleting it must reach the profile context, the packets built on it, profile strength
// and a restart, and only the candidate may do it. These are the M3 falsifiers:
//   1. deleting the story behind a claim quote makes the quote unusable and the packet
//      stale, the next preparation cannot cite it, and it stays gone after a restart;
//   2. editing a story changes the source text and invalidates exactly as adding does;
//   3. neither action can be run by the agent or an external agent;
//   4. the audit record holds the action and its time, never the deleted text;
//   5. a message saved before ids existed can be edited and deleted through its
//      derived key;
//   6. an export/import carries the message ids, so keys keep working after a transfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { Workspace, digest, hasEvidence, claimEvidenceProblem, storyKey } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { profileStrength, candidateStatements } from '../plainhand/profile-strength.mjs';
import { profileCoverage } from '../plainhand/profile-coverage.mjs';
import { exportWorkspace, importWorkspace } from '../plainhand/workspace-import.mjs';

// The story this test deletes. It is distinct from the fixture resume so a quote from it
// can only come from the interview source, and it carries a result with a number so it
// is the one statement that covers the interview's results area.
const STORY = 'I ran the physical load tests on the chassis and cut the reject rate by 12 percent.';
const EDITED = 'I ran the physical load tests on the chassis and cut the scrap rate to 4 percent.';
// A story that must never be written anywhere after it is deleted.
const SECRET = 'My manager said the yard slip was signed while the gate was closed.';
const AUDITED = 'data/plainhand/audit.jsonl';

// The shared fixture only cites the resume. This packet cites the candidate's own story,
// which is what deletion has to take away.
function storyAgent(id, instruction, data) {
  if (instruction.includes('Prepare a')) {
    const evidence = [{ sourceId: 'interview', quote: STORY }];
    return { headline: 'Mechanical Engineering Graduate', resume: [{ section: 'Projects', text: STORY, evidence }],
      coverLetter: 'I would like to bring my design and testing experience to this engineering role.', answers: [{ question: 'Describe a relevant project.', answer: STORY, evidence }], questions: [] };
  }
  return fixtureAgent(id, instruction, data);
}

async function boot(root) {
  const app = await createPlainhand({ root, providers: fixtureProviders, features: [], startFeatures: false, workflowOptions: {
    agent: storyAgent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const state = await app.workspace.load();
  if (!state.profile.name) await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(latest => { latest.provider = 'codex'; });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const http = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const job = async (n = 1) => (await ui('jobs.add', { company: `Company ${n}`, title: 'Graduate Engineer', url: `https://jobs.lever.co/test/${n}` })).result.id;
  const runTask = async (name, jobId) => { await ui(name, jobId ? { jobId } : {}); await app.workflow.queue; return (await app.workspace.load()).tasks.find(task => task.kind === name.split('.')[1] && task.jobId === jobId); };
  return { app, root, http, ui, job, runTask, close: () => app.close(), stop: () => rm(root, { recursive: true, force: true }) };
}

async function tempRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-story-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const quote = { evidence: [{ sourceId: 'interview', quote: STORY }] };
const interviewText = context => context.sources.find(source => source.id === 'interview')?.text || '';

test('deleting the story behind a quote removes it from context, invalidates the packet, blocks the next packet and survives a restart', async t => {
  const root = await tempRoot(t);
  let h = await boot(root);
  let storyKeyOf;
  try {
    const story = (await h.ui('profile.addStory', { text: STORY })).result;
    assert.equal(typeof story.key, 'string');
    storyKeyOf = story.key;
    const jobId = await h.job(1);
    await h.runTask('tasks.evaluate', jobId);
    await h.ui('jobs.select', { jobId, selected: true });
    await h.runTask('tasks.prepare', jobId);
    await h.ui('packet.approve', { jobId });

    let state = await h.app.workspace.load();
    let job = state.jobs.find(item => item.id === jobId);
    assert.ok(job.approvedHash, 'the packet is approved before the story is deleted');
    let context = await h.app.workspace.context(state);
    assert.ok(hasEvidence(quote, context), 'the story grounds the claim while it exists');
    assert.match(interviewText(context), /cut the reject rate by 12 percent/);
    const storedBefore = { strength: profileStrength(state).depth.statements, covered: profileCoverage(state, []).covered };
    assert.ok(storedBefore.strength >= 2 && storedBefore.covered >= 1, `the story is counted before deletion (${JSON.stringify(storedBefore)})`);
    assert.equal(candidateStatements(state).includes(STORY), true);

    await h.ui('profile.removeStory', { key: story.key });

    state = await h.app.workspace.load();
    context = await h.app.workspace.context(state);
    assert.equal(state.conversation.some(message => message.role === 'user' && message.text === STORY), false, 'the story is gone from storage');
    assert.equal(state.conversation.length, 0, 'nothing is left of the profile conversation');
    assert.equal(JSON.stringify(context.sources).includes('reject rate'), false, 'the quote is in no current source');
    assert.equal(hasEvidence(quote, context), false, 'the evidence gate fails');
    assert.match(claimEvidenceProblem(quote, context), /a quote that appears in the current source/);
    job = state.jobs.find(item => item.id === jobId);
    assert.equal(job.approvedHash, null, 'the approval is cleared');
    assert.equal(state.understanding, null, 'the understanding is cleared');
    assert.equal(candidateStatements(state).includes(STORY), false, 'the deleted story stops counting as a candidate statement');
    assert.equal(profileStrength(state).depth.statements, storedBefore.strength - 1, 'profile strength counts one story fewer');
    assert.equal(profileCoverage(state, []).covered, storedBefore.covered - 1, 'the area the story covered is open again');
    await assert.rejects(h.ui('packet.approve', { jobId }), /regenerated/, 'the existing packet cannot be approved again');
    const served = (await h.http('state')).data;
    assert.equal(served.jobs.find(item => item.id === jobId).stale, true, 'the UI shows the packet as stale');

    const evaluated = await h.runTask('tasks.evaluate', jobId);
    assert.equal(evaluated.status, 'complete', 'the role can be evaluated again from the remaining profile');
    const prepared = await h.runTask('tasks.prepare', jobId);
    assert.equal(prepared.status, 'failed', 'a packet citing the deleted story is refused');
    assert.match(prepared.message, /claim without an exact source reference/);
    assert.deepEqual((await h.app.workspace.load()).jobs.find(item => item.id === jobId).packet, job.packet, 'the failed attempt left the previous packet as it was');
  } finally { await h.close(); }

  // Restart on the same root: a new process must not find the story again.
  h = await boot(root);
  try {
    const state = await h.app.workspace.load();
    assert.equal(state.conversation.some(message => message.text === STORY), false, 'the story is still gone after a restart');
    assert.equal((await h.app.workspace.context(state)).sources.some(source => source.id === 'interview'), false);
    await assert.rejects(h.ui('profile.removeStory', { key: storyKeyOf }), /no longer in your profile/, 'the old key resolves to nothing');
  } finally { await h.close(); await h.stop(); }
});

test('editing a story changes the source text and invalidates exactly as adding one does', async t => {
  const root = await tempRoot(t);
  const h = await boot(root);
  try {
    const jobId = await h.job(1);
    const story = (await h.ui('profile.addStory', { text: STORY })).result;
    await h.runTask('tasks.evaluate', jobId);
    await h.ui('jobs.select', { jobId, selected: true });
    await h.runTask('tasks.prepare', jobId);
    await h.ui('packet.approve', { jobId });
    await h.runTask('tasks.interview');
    await h.ui('understanding.approve', {});

    let state = await h.app.workspace.load();
    assert.ok(state.understanding?.approved, 'the understanding is approved first');
    assert.ok(state.jobs.find(item => item.id === jobId).approvedHash, 'the packet is approved first');
    const before = await h.app.workspace.context(state);
    assert.ok(hasEvidence(quote, before));

    const edited = await h.ui('profile.editStory', { key: story.key, text: EDITED });
    assert.equal(edited.result.key, story.key, 'editing keeps the story key');

    state = await h.app.workspace.load();
    const message = state.conversation.find(item => item.role === 'user');
    assert.equal(message.text, EDITED, 'the source text is the corrected one');
    assert.ok(message.editedAt, 'the edit is recorded with its time');
    const after = await h.app.workspace.context(state);
    assert.match(interviewText(after), /cut the scrap rate to 4 percent/);
    assert.equal(JSON.stringify(after.sources).includes('reject rate'), false, 'the old wording is gone');
    assert.notEqual(after.hash, before.hash, 'the context fingerprint changed');
    assert.equal(hasEvidence(quote, after), false, 'the old quote no longer grounds a claim');
    assert.ok(hasEvidence({ evidence: [{ sourceId: 'interview', quote: EDITED }] }, after), 'the corrected words do');
    assert.equal(state.understanding, null, 'the understanding is cleared, exactly as adding a story clears it');
    for (const job of state.jobs) assert.equal(job.approvedHash, null, `${job.company}: the approval is cleared`);
    await assert.rejects(h.ui('packet.approve', { jobId }), /regenerated/);
  } finally { await h.close(); await h.stop(); }
});

test('neither action can be run by the agent or an external agent', async t => {
  const root = await tempRoot(t);
  const h = await boot(root);
  try {
    const story = (await h.ui('profile.addStory', { text: STORY })).result;
    const before = await h.app.workspace.load();
    for (const actor of ['agent', 'mcp']) for (const confirmed of [false, true]) {
      for (const [name, input] of [['profile.editStory', { key: story.key, text: 'Something else entirely.' }], ['profile.removeStory', { key: story.key }]]) {
        const refused = await h.app.registry.run(name, input, { actor, confirmed }).catch(error => error);
        assert.equal(refused.code, 'candidate_only', `${name} as ${actor} confirmed=${confirmed}`);
        assert.deepEqual(refused.panel, { type: 'profile' });
      }
    }
    const after = await h.app.workspace.load();
    assert.deepEqual(after.conversation, before.conversation, 'the story was not changed');
    assert.equal(after.revision, before.revision, 'a refused action writes nothing');
    await assert.rejects(h.ui('profile.removeStory', { key: 'not-a-key' }), /no longer in your profile/);
    await assert.rejects(h.ui('profile.removeStory', { key: story.key.slice(0, 8) }), /no longer in your profile/, 'a partial key does not match');
  } finally { await h.close(); await h.stop(); }
});

test('the audit record holds the action and its time, never the deleted text', async t => {
  const root = await tempRoot(t);
  const h = await boot(root);
  try {
    const story = (await h.ui('profile.addStory', { text: SECRET })).result;
    await h.ui('profile.removeStory', { key: story.key });
    const audit = (await h.app.workspace.read(AUDITED)).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const removal = audit.find(entry => entry.reason.startsWith('profile.removeStory'));
    assert.ok(removal, 'the deletion is recorded');
    assert.ok(removal.at && !Number.isNaN(Date.parse(removal.at)), 'with the time it happened');
    assert.equal(audit.some(entry => entry.reason.includes('yard slip')), false, 'no audit entry holds the deleted text');
    const stored = await h.app.workspace.read('data/plainhand/workspace.json');
    assert.equal(stored.includes('yard slip'), false, 'the workspace no longer holds it either');
    assert.equal((await h.app.workspace.read('data/plainhand/conversation.jsonl')).includes('yard slip'), false, 'the agent transcript is untouched and never received it');
  } finally { await h.close(); await h.stop(); }
});

test('a message saved before ids existed can be edited and deleted through its derived key', async t => {
  const root = await tempRoot(t);
  const h = await boot(root);
  try {
    const at = '2026-02-01T00:00:00.000Z';
    await h.app.workspace.mutate(state => { state.conversation.push({ role: 'user', text: STORY, at }); });
    const legacy = (await h.app.workspace.load()).conversation[0];
    assert.equal(legacy.id, undefined, 'the stored message predates ids');
    const key = storyKey(legacy);
    assert.match(key, /^legacy-/, 'a derived key, not an id');
    const served = (await h.http('state')).data.conversation.find(message => message.text === STORY);
    assert.equal(served.key, key, 'the UI is given the same derived key');

    // The profile screen only ever goes through these two routes; a stale key is a
    // plain refusal, so the controls never delete the wrong message.
    const stale = await h.http('story/remove', { key: 'legacy-0000000000000000' });
    assert.deepEqual([stale.status, stale.data.code], [400, 'failed']);
    const edited = await h.http('story/edit', { key, text: EDITED });
    assert.deepEqual([edited.status, edited.data.key], [200, key], 'the derived key survives the edit');
    let state = await h.app.workspace.load();
    assert.equal(state.conversation[0].text, EDITED);
    assert.equal(state.conversation[0].id, undefined, 'an old message is not rewritten with an id');

    // The edited message is still reachable through its derived key, and a second story
    // added the ordinary way gets its own id key.
    await h.ui('profile.editStory', { key, text: STORY });
    const modern = (await h.ui('profile.addStory', { text: 'I also owned the test plan.' })).result;
    assert.notEqual(modern.key, key);
    state = await h.app.workspace.load();
    const other = state.conversation.find(message => message.text === 'I also owned the test plan.');
    assert.equal(modern.key, other.id, 'a new message is addressed by its id');

    await h.http('story/remove', { key });
    state = await h.app.workspace.load();
    assert.equal(state.conversation.some(message => message.text === STORY), false, 'the old message is deleted through its derived key');
    assert.equal(state.conversation.filter(message => message.role === 'user').length, 1, 'only that one message went');
    assert.ok(state.conversation.some(message => message.id === modern.key), 'the newer story is untouched');
  } finally { await h.close(); await h.stop(); }
});

test('an export and import carry the story keys, so a transferred story can still be deleted', async t => {
  const root = await tempRoot(t);
  const h = await boot(root);
  const target = await mkdtemp(path.join(tmpdir(), 'plainhand-story-import-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  try {
    const story = (await h.ui('profile.addStory', { text: STORY })).result;
    const data = await exportWorkspace(h.app.workspace);
    const imported = new Workspace(target);
    const summary = await importWorkspace({ workspace: imported, data });
    assert.equal(summary.conversation, 0, 'no agent transcript is invented by the export');
    const state = await imported.load();
    const message = state.conversation.find(item => item.role === 'user');
    assert.equal(message.id, story.key, 'the message id travels with the conversation');
    assert.equal(message.text, STORY);
    assert.equal(storyKey(message), story.key);
    assert.equal(state.understanding, null, 'an import arrives with no understanding');
  } finally { await h.close(); await h.stop(); }
});
