import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { candidateSaid } from './plainhand/agent.mjs';
import { candidate, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';

async function harness(steps, profile = { name: candidate.name, email: candidate.email, resume: candidate.resume }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-onboarding-'));
  const agent = scriptedAgent(steps);
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: { agent } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...profile }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const say = async text => { const { turnId } = await app.agent.message(text); await app.agent.running; return (await app.agent.history()).messages.filter(m => m.turnId === turnId).at(-1); };
  const accept = async message => app.agent.confirm({ proposalId: message.proposalId, accept: true });
  return { app, agent, say, accept, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
const STORY = 'I led the chassis design for our Formula SAE team and ran the physical load tests myself.';

test('candidateSaid accepts exact words regardless of case, spacing and curly quotes, and rejects paraphrase', () => {
  const said = ['Well, I led the chassis design   for our Formula SAE team — it was “hard” work.'];
  assert.ok(candidateSaid(said, 'i led the chassis design for our formula sae team'));
  assert.ok(candidateSaid(said, '"it was "hard" work."'));
  assert.equal(candidateSaid(said, 'I led the chassis design for the whole university'), false);
  assert.equal(candidateSaid(said, 'chassis'), false, 'too short to be evidence');
});

test('a new candidate builds their profile by conversation, ending in their own approval', async () => {
  const h = await harness([
    { match: /start/, reply: data => ({ say: `Welcome. You still need ${data.digest.profile.missing.join(', ')}. What project are you proudest of?`, actions: [] }) },
    { match: /Formula SAE/, reply: { say: 'That is worth keeping. Save it to your story?', actions: [{ name: 'profile.addStory', input: { text: STORY, topic: 'Formula SAE' } }] } },
    { match: /Boston/, reply: { say: 'Shall I note your targets?', actions: [{ name: 'profile.update', input: { location: 'Boston, MA', roles: 'Mechanical engineer, design engineer' } }] } },
    { match: /build my understanding/, reply: { say: 'I can rebuild your understanding now.', actions: [{ name: 'tasks.interview', input: {} }] } },
    { match: /approve/, reply: { say: 'Review it in your profile and approve it there.', actions: [{ name: 'understanding.approve', input: {} }, { name: 'ui.openPanel', input: { type: 'profile' } }] } },
  ]);
  try {
    let reply = await h.say("Let's start my profile");
    assert.match(reply.text, /target roles, location, your story in your own words/);
    reply = await h.say(STORY);
    await h.accept(reply);
    let state = await h.app.workspace.load();
    assert.deepEqual(state.conversation.filter(m => m.role === 'user').map(m => [m.text, m.via]), [[STORY, 'assistant']]);

    reply = await h.say("I'm looking for mechanical or design engineer roles around Boston");
    await h.accept(reply);
    state = await h.app.workspace.load();
    assert.deepEqual([state.profile.location, state.profile.roles], ['Boston, MA', 'Mechanical engineer, design engineer']);
    assert.match(await h.app.workspace.read('config/profile.yml'), /Mechanical engineer/);

    reply = await h.say('Please build my understanding');
    await h.accept(reply);
    await h.app.workflow.queue;
    state = await h.app.workspace.load();
    assert.ok(state.understanding && !state.understanding.approved);
    let digest = (await h.app.registry.run('workspace.digest', {})).result;
    assert.equal(digest.profile.understanding, 'needs-review');
    assert.deepEqual(digest.profile.missing, []);

    reply = await h.say('approve it for me');
    assert.equal((await h.app.workspace.load()).understanding.approved, false, 'only the candidate approves');
    await h.app.registry.run('understanding.approve', {}, { actor: 'ui' });
    digest = (await h.app.registry.run('workspace.digest', {})).result;
    assert.equal(digest.profile.understanding, 'approved');
    assert.ok(!digest.attention.some(item => item.kind === 'profile'));
  } finally { await h.close(); }
});

test('the agent cannot save a paraphrase or invented detail as the candidate story', async () => {
  const h = await harness([
    { reply: { say: 'Save it?', actions: [{ name: 'profile.addStory', input: { text: 'I led a team of 20 engineers and cut chassis weight by 40%.' } }] } },
    { reply: { say: 'I can only save your own words. Could you tell me the details yourself?', actions: [] } },
  ]);
  try {
    const reply = await h.say(STORY);
    assert.equal(reply.status, 'complete');
    assert.match(h.agent.calls[1].results[0].error, /copied exactly from the candidate/);
    assert.equal((await h.app.agent.history()).proposals.length, 0);
    assert.equal((await h.app.workspace.load()).conversation.length, 0);
  } finally { await h.close(); }
});

test('sensitive profile fields are not agent-editable, and preference changes undo cleanly', async () => {
  const h = await harness([
    { match: /visa/, reply: { say: 'Noting it.', actions: [{ name: 'profile.update', input: { eligibility: 'US citizen', compensation: '$120k' } }] } },
    { reply: { say: 'Those are yours to set on the profile screen.', actions: [{ name: 'ui.openPanel', input: { type: 'profile' } }] } },
    { match: /voice/, reply: { say: 'Update your voice?', actions: [{ name: 'profile.update', input: { voice: 'Direct and specific.' } }] } },
  ], { name: candidate.name, email: candidate.email, resume: candidate.resume, voice: 'Warm.' });
  try {
    await h.say('I do not need a visa');
    assert.match(h.agent.calls[1].results[0].error, /Unexpected input "eligibility"/);
    assert.equal((await h.app.workspace.load()).profile.eligibility, '');
    const reply = await h.say('set my voice to direct');
    const { undoToken } = await h.accept(reply);
    assert.equal((await h.app.workspace.load()).profile.voice, 'Direct and specific.');
    await h.app.agent.undo(undoToken);
    assert.equal((await h.app.workspace.load()).profile.voice, 'Warm.');
  } finally { await h.close(); }
});
