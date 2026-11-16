import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { AGENT_INSTRUCTION } from '../plainhand/agent.mjs';
import { PROFILE_AREAS, profileCoverage, canOfferSummary } from '../plainhand/profile-coverage.mjs';
import { PACKET_INSTRUCTION } from '../plainhand/agents.mjs';
import { verifyHeadings } from '../plainhand/resume-format.mjs';
import { digest } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders, scriptedAgent } from '../plainhand/test-fixtures.mjs';

const STORY = 'I led the chassis design for our Formula SAE team and ran the physical load tests myself.';

// A profile the interview has finished with: every area is in the candidate's own words
// or in a field they confirmed.
const covered = () => ({
  profile: { graduation: 'B.S. Mechanical Engineering, 2027', roles: 'Mechanical engineer, design engineer' },
  conversation: [
    { role: 'user', text: 'I cut the upright’s weight by 18% and still passed the same load tests.' },
    { role: 'user', text: 'I was an engineering intern at Example Pumps from 2024 to 2025.' },
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

const ROLE_LABEL = "each role's employer, official job title and dates";

// The employer, title and dates area sits right after the results area: the work comes
// first, then the heading it belongs to.
test('an area for each role’s employer, title and dates starts open and is covered three ways', () => {
  assert.ok(PROFILE_AREAS.some(area => area.label === ROLE_LABEL), 'the area is in the fixed list');
  const empty = { profile: {}, conversation: [] };
  assert.ok(profileCoverage(empty).uncovered.includes(ROLE_LABEL), 'it starts uncovered');

  // The candidate names an employer and a year range in their own words.
  const stated = { profile: {}, conversation: [{ role: 'user', text: 'I was a Lab Automation Scientist at Fictional Biotech from 2016 to 2020.' }] };
  assert.ok(!profileCoverage(stated).uncovered.includes(ROLE_LABEL), 'an employer with a year range covers it');

  // An uploaded or pasted resume already has dated role lines.
  const resume = { profile: { resume: 'Experience\nLab Automation Scientist, Fictional Biotech (2016 – 2020)\nRan the assay pipeline.' }, conversation: [] };
  assert.ok(!profileCoverage(resume).uncovered.includes(ROLE_LABEL), 'a resume with dated role lines covers it');

  // Asked and answered counts even when the answer only covers part of a role.
  const history = [{ role: 'assistant', text: 'Which employer, official job title and dates does each role have?' }, { role: 'user', text: 'I only remember the most recent one.' }];
  assert.ok(!profileCoverage(empty, history).uncovered.includes(ROLE_LABEL), 'asked and answered covers it');

  // A year range with no employer, or an employer with no date, is not enough.
  const numbersOnly = { profile: {}, conversation: [{ role: 'user', text: 'I cut the cycle time by 20% from 2016 to 2020.' }] };
  assert.ok(profileCoverage(numbersOnly).uncovered.includes(ROLE_LABEL), 'dates alone do not cover it');
  const employerOnly = { profile: {}, conversation: [{ role: 'user', text: 'I worked at Fictional Biotech on assays every day.' }] };
  assert.ok(profileCoverage(employerOnly).uncovered.includes(ROLE_LABEL), 'an employer alone does not cover it');
});

test('the assistant asks for role facts in the candidate’s own words and never suggests them', () => {
  const rule = AGENT_INSTRUCTION.slice(AGENT_INSTRUCTION.indexOf('Onboarding:'));
  assert.ok(rule.indexOf(ROLE_LABEL) > rule.indexOf('what each role was responsible for'), 'the role facts are listed right after the results area');
  assert.match(rule, /in the candidate's own words/);
  assert.match(rule, /Never suggest or guess an employer, a job title or any dates/);
  assert.match(rule, /save their answer in their exact words with profile\.addStory/);
  assert.ok(!/\b(?:19|20)\d{2}\b/.test(rule), 'the instruction carries no example year for a model to copy');
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

test('an area the candidate answered with "no" counts, so the interview moves on', () => {
  const state = { profile: {}, conversation: [] };
  const before = profileCoverage(state);
  assert.ok(before.uncovered.includes('certifications and licences'));
  const history = [
    { role: 'assistant', text: 'Thanks, saved. Do you hold any certifications or licences?' },
    { role: 'user', text: 'No.' },
  ];
  const after = profileCoverage(state, history);
  assert.ok(!after.uncovered.includes('certifications and licences'));
  assert.equal(after.covered, before.covered + 1);
  // A question still waiting for an answer does not count.
  assert.ok(profileCoverage(state, history.slice(0, 1)).uncovered.includes('certifications and licences'));
  // Earlier sentences of the reply do not count as the question.
  const unasked = [{ role: 'assistant', text: 'Your audit work is saved. What tools do you use?' }, { role: 'user', text: 'Excel mostly.' }];
  assert.ok(profileCoverage(state, unasked).uncovered.includes('regulated or quality work such as SOPs, audits or controls'));
});

// The defect this area fixes: a conversation-built profile ends up with roles that
// have no employer or dates, because the interview never asked for them. The packet is
// prepared from a workspace whose resume does not state them, so the heading survives
// only if the conversation reaches verifyHeadings' source text.
test('a conversation-built profile keeps org, title and dates on the role heading', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-coverage-roles-'));
  const roleText = 'I was a Lab Automation Scientist at Fictional Biotech from 2016 to 2020.';
  const heading = { org: 'Fictional Biotech', title: 'Lab Automation Scientist', location: '', dates: '2016 to 2020' };
  const line = 'Designed and tested a lightweight chassis for a Formula SAE team.';
  // The fixture agent cannot emit headings, so only its packet reply is replaced.
  const agent = async (id, instruction, data, options) => instruction === PACKET_INSTRUCTION
    ? { headline: 'Lab Automation Scientist', resume: [{ section: 'Experience', heading: { ...heading }, text: line, evidence: [{ sourceId: 'cv', quote: line }] }], coverLetter: 'I would like to bring my lab automation experience to this role.', answers: [], questions: [], suggestions: [] }
    : fixtureAgent(id, instruction, data, options);
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is a laboratory automation role running assay pipelines. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  try {
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...state.profile, name: candidate.name, email: candidate.email, roles: candidate.roles, location: candidate.location, resume: candidate.resume }, state.revision);
    // The candidate's own message, the same record profile.addStory writes.
    await app.workspace.mutate(latest => { latest.provider = 'codex'; latest.conversation.push({ role: 'user', text: roleText, at: new Date().toISOString(), via: 'assistant' }); });
    const saved = await app.workspace.load();
    // workflow.mjs verifies headings against context.sources joined; store.mjs adds the
    // candidate's messages as the "interview" source.
    const sources = (await app.workspace.context(saved)).sources;
    assert.ok(!saved.profile.resume.includes('Fictional Biotech'), 'the resume never states the employer');
    assert.ok(sources.some(source => source.id === 'interview' && source.text.includes(roleText)), 'the conversation is part of the sources verifyHeadings reads');
    const withoutInterview = sources.filter(source => source.id !== 'interview').map(source => source.text).join('\n');
    assert.equal(verifyHeadings([{ section: 'Experience', heading: { ...heading }, text: line }], withoutInterview), 3, 'without the conversation, org, title and dates are unverifiable');
    const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
    const settle = async () => { for (let i = 0; i < 5; i++) await app.workflow.queue; };
    await ui('tasks.standard', {}); await settle(); await ui('standard.approve', {});
    const { result: job } = await ui('jobs.add', { company: 'Test Company', title: 'Lab Automation Scientist', url: 'https://jobs.lever.co/test/role-facts-1' });
    await ui('tasks.evaluate', { jobId: job.id }); await settle();
    await ui('jobs.select', { jobId: job.id, selected: true });
    await ui('tasks.prepare', { jobId: job.id }); await settle();
    const prepared = (await app.workspace.load()).jobs.find(item => item.id === job.id);
    const task = (await app.workspace.load()).tasks.find(item => item.kind === 'prepare');
    assert.ok(prepared.packet, `the packet was prepared: ${task?.message || ''}`);
    assert.deepEqual(prepared.packet.resume[0].heading, heading, 'the role heading keeps its employer, title and dates');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
