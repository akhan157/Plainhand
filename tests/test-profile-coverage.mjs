import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { AGENT_INSTRUCTION } from '../plainhand/agent.mjs';
import { PROFILE_AREAS, profileCoverage, canOfferSummary } from '../plainhand/profile-coverage.mjs';
import { candidate, fixtureProviders, scriptedAgent } from '../plainhand/test-fixtures.mjs';

const STORY = 'I led the chassis design for our Formula SAE team and ran the physical load tests myself.';

// A profile the interview has finished with: every area is in the candidate's own words
// or in a field they confirmed.
const covered = () => ({
  profile: { graduation: 'B.S. Mechanical Engineering, 2027', roles: 'Mechanical engineer, design engineer' },
  conversation: [
    { role: 'user', text: 'I cut the upright’s weight by 18% and still passed the same load tests.' },
    { role: 'user', text: 'I use SolidWorks every day and ANSYS for static stress checks.' },
    { role: 'user', text: 'I passed the Fundamentals of Engineering exam in 2025.' },
    { role: 'user', text: 'On my capstone project I built a gearbox test rig.' },
    { role: 'user', text: 'I coordinated three sophomores on the suspension sub-team.' },
    { role: 'user', text: 'I wrote six SOPs for the flow cytometry workflows and trained four people on them.' },
  ],
});

test('the assistant instruction requires a question in every interview reply and withholds the summary', () => {
  const rule = AGENT_INSTRUCTION.slice(AGENT_INSTRUCTION.indexOf('Onboarding:'));
  assert.match(rule, /every reply you send ends with exactly one specific question/);
  assert.match(rule, /One question per reply, never a list/);
  for (const area of PROFILE_AREAS) assert.ok(rule.includes(area.label), `the instruction names the ${area.id} area: "${area.label}"`);
  assert.match(rule, /An agreement, a "yes, go ahead" or a short answer is not a request to stop/);
  assert.match(rule, /Saying what you propose does not replace the question/);
  assert.match(rule, /Do not offer to rebuild the summary or the profile, and do not propose tasks\.interview, while any area is still uncovered/);
  assert.match(rule, /Never fill in work authorization, compensation, demographics or anything they did not say\./, 'the honesty rules stay');
});

test('coverage comes from the candidate’s own statements, not from how many stories were saved', () => {
  const empty = { profile: {}, conversation: [] };
  assert.equal(profileCoverage(empty).complete, false);
  assert.equal(profileCoverage(empty).uncovered.length, PROFILE_AREAS.length);

  // Two answers leave most areas open even though both were saved as stories.
  const twoStories = { profile: {}, conversation: [{ role: 'user', text: STORY }, { role: 'user', text: 'I use SolidWorks every day.' }] };
  const partial = profileCoverage(twoStories);
  assert.equal(partial.complete, false);
  assert.equal(partial.covered, 2, 'leadership and tools are covered, nothing else');
  assert.ok(partial.uncovered.includes('certifications and licences'));
  assert.ok(partial.uncovered.includes('the roles they want next'));

  const full = profileCoverage(covered());
  assert.equal(full.complete, true, full.uncovered.join('; '));
  assert.deepEqual(full.uncovered, []);
});

test('a summary is offered only once the areas are covered, or when the candidate asks for it', () => {
  const open = { profile: {}, conversation: [{ role: 'user', text: STORY }] };
  assert.equal(canOfferSummary(open, 'Yes, go ahead.'), false, 'agreement is not a request to finish');
  assert.equal(canOfferSummary(open, 'That’s everything I can think of for now.'), true, 'the candidate saying they are done is enough');
  assert.equal(canOfferSummary(open, 'Please build my understanding'), true);
  assert.equal(canOfferSummary(covered(), 'Yes, go ahead.'), true);
});

async function harness(steps, profile = { name: candidate.name, email: candidate.email, resume: candidate.resume }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-coverage-'));
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

test('a volunteered summary while areas are uncovered is refused, and the same turn asks the next question', async () => {
  const h = await harness([
    { match: /Formula SAE/, reply: { say: 'That is worth keeping. Save it to your story?', actions: [{ name: 'profile.addStory', input: { text: STORY } }] } },
    { match: /go ahead/, reply: { say: 'I propose I rebuild your understanding now.', actions: [{ name: 'tasks.interview', input: {} }] } },
    { match: /go ahead/, reply: { say: 'I propose I save that first. What result did the chassis work have, with numbers?', actions: [] } },
  ]);
  try {
    const saved = await h.say(STORY);
    await h.accept(saved);
    const reply = await h.say('Yes, go ahead.');
    assert.match(reply.text, /\?/, 'the turn ends with a question instead of a summary offer');
    assert.match(reply.text, /with numbers/, 'the question is about the first uncovered area');
    assert.ok(h.agent.calls.at(-1).results.some(r => r.name === 'tasks.interview' && /Do not offer to rebuild the profile yet/.test(r.error)), 'the summary proposal was refused');
    assert.equal(h.agent.calls.at(-1).digest.profile.interview.complete, false, 'the digest tells the model the interview is open');
    assert.ok(h.agent.calls.at(-1).digest.profile.interview.uncovered.includes('certifications and licences'));
    const history = await h.app.agent.history();
    assert.equal(history.proposals.length, 1, 'only the story was ever proposed');
    assert.equal((await h.app.workspace.load()).tasks.length, 0);
  } finally { await h.close(); }
});

test('a candidate who asks for the summary can have it while areas are still open', async () => {
  const h = await harness([
    { match: /build my understanding/, reply: { say: 'I can rebuild your understanding now.', actions: [{ name: 'tasks.interview', input: {} }] } },
  ]);
  try {
    const reply = await h.say('Please build my understanding');
    assert.equal(reply.status, 'needs-confirmation');
    const history = await h.app.agent.history();
    assert.deepEqual(history.proposals[0].actions.map(a => a.name), ['tasks.interview']);
    assert.equal(h.agent.calls.length, 1, 'the request was not refused');
  } finally { await h.close(); }
});
