// U05: voice and conversational revision. The candidate asks for a change in their
// own words, the packet is rebuilt with that request and its previous packet, then
// humanized, independently reviewed, calibrated and rendered again. Writing samples
// are voice only: they reach the drafter and humanizer, and never ground a claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest, hasEvidence } from '../plainhand/store.mjs';
import { AGENT_INSTRUCTION } from '../plainhand/agent.mjs';
import { PACKET_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../plainhand/humanize.mjs';
import { standardStatus } from '../plainhand/standard.mjs';
import { candidate, fixtureAgent, fixtureProviders, scriptedAgent } from '../plainhand/test-fixtures.mjs';
import { voiceAttribution, voiceDistance, voiceFeatures } from '../plainhand/voice-metrics.mjs';
import { voiceTargetOf } from '../plainhand/voice-target.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHASSIS = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const LIMS = 'Built a LIMS for the lab, tracking 1,200 samples.';
const DEGREE = 'B.S. Mechanical Engineering, Example University, 2027.';
const LONG_COVER = 'Dear {company}, I would like to bring my hands-on design and testing experience to the {role} role. I built and tested a lightweight chassis with a Formula SAE team, and I would bring the same care to hardware at your company.';
const SHORT_COVER = 'Dear {company}: my {role} work would start from tested, hands-on engineering.';
const JOB_TEXT = 'Design and test hardware with CAD and prototypes. '.repeat(6);
const PROFILE = { ...candidate, resume: [CHASSIS, LIMS, DEGREE].join(' ') };

const instructionName = instruction => instruction === PACKET_INSTRUCTION ? 'packet'
  : instruction === HUMANIZE_INSTRUCTION ? 'humanize'
  : instruction === REVIEW_INSTRUCTION ? 'review'
  : instruction === STANDARD_INSTRUCTION ? 'standard'
  : instruction === AGENT_INSTRUCTION ? 'agent' : 'other';

const evidence = quote => [{ sourceId: 'cv', quote }];

function basePacket() {
  return {
    headline: 'Mechanical Engineering Graduate',
    resume: [
      { section: 'Projects', text: CHASSIS, evidence: evidence(CHASSIS) },
      { section: 'Projects', text: LIMS, evidence: evidence(LIMS) },
      { section: 'Education', text: DEGREE, evidence: evidence(DEGREE) },
    ],
    coverLetter: LONG_COVER,
    answers: [],
    questions: [],
    suggestions: [],
  };
}

const firstSentence = text => (String(text).match(/^.*?[.!?](?:\s|$)/) || [String(text)])[0].trim();

// One scripted conversational reply: the candidate asked for a change, so the agent
// proposes tasks.revise with the message as the request (and the job, when set).
const revisionStep = target => ({
  reply: data => ({ say: 'I can make that revision.', actions: [{ name: 'tasks.revise', input: { ...(target.jobId ? { jobId: target.jobId } : {}), request: data.message } }] }),
});

function passingReview(data) {
  const cover = data.packet.coverLetter;
  return { passed: true, issues: [], calibration: [{ id: 'cover:0', claim: firstSentence(cover), rating: 'balanced', kind: 'other', reason: cover === SHORT_COVER ? 'revision review' : 'initial review', suggestion: '' }] };
}

// Wraps fixtureAgent so the agent conversation and the packet pipeline are both
// exercised with the same scripted provider. ctl lets a test swap the drafter or
// reviewer for a falsifier without rebuilding the harness.
async function harness({ steps = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u05-'));
  const conversation = scriptedAgent(steps);
  const calls = [], renders = [];
  const ctl = {
    packet: data => data.revisionRequest
      ? { ...data.previousPacket, coverLetter: /shorter/i.test(data.revisionRequest) ? SHORT_COVER : data.previousPacket.coverLetter }
      : basePacket(),
    review: passingReview,
  };
  const agent = async (id, instruction, data, options) => {
    calls.push({ instruction, name: instructionName(instruction), data: JSON.parse(JSON.stringify(data ?? null)) });
    if (instruction === AGENT_INSTRUCTION) return conversation(id, instruction, data, options);
    if (instruction === PACKET_INSTRUCTION) return ctl.packet(data, calls);
    if (instruction === HUMANIZE_INSTRUCTION) return { items: data.items.map(item => ({ id: item.id, text: item.text })), remaining: [] };
    if (instruction === REVIEW_INSTRUCTION) return ctl.review(data, calls);
    if (instruction === STANDARD_INSTRUCTION && ctl.standard) return ctl.standard(data, calls);
    return fixtureAgent(id, instruction, data, options);
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, startFeatures: false, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: JOB_TEXT, checkedAt: new Date().toISOString(), reason: 'U05 fixture.' }),
    renderer: async (workspace, state, job, packet) => {
      calls.push({ instruction: 'render', name: 'render', data: { jobId: job.id } });
      const body = JSON.stringify(packet), pdf = `output/u05-${renders.length}.pdf`;
      await workspace.write(pdf, body);
      renders.push({ pdf, body, jobId: job.id });
      return { pdf, pdfHash: digest(Buffer.from(body)), artifacts: [pdf] };
    },
  } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...PROFILE }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
  const load = () => app.workspace.load();
  const lastTask = async () => (await load()).tasks[0];
  const proposalOf = async message => (await app.agent.proposals()).find(p => p.id === message.proposalId);
  const say = async text => { const { turnId } = await app.agent.message(text); await app.agent.running; return (await app.agent.history({ limit: 500 })).messages.filter(m => m.turnId === turnId); };
  const confirm = async message => {
    const proposal = await proposalOf(message);
    assert.ok(proposal, 'the turn made a proposal');
    const result = await app.agent.confirm({ proposalId: proposal.id, accept: true });
    await settle();
    return { proposal, result };
  };
  let n = 0;
  const addJob = async (company = 'Acme Robotics') => (await ui('jobs.add', { company, title: `Graduate Engineer ${++n}`, url: `https://jobs.lever.co/u05/${n}`, description: JOB_TEXT })).result.id;
  const evaluate = async jobId => { await ui('tasks.evaluate', { jobId }); await settle(); return lastTask(); };
  const prepare = async jobId => {
    await ui('jobs.select', { jobId, selected: true });
    await ui('tasks.prepare', { jobId }); await settle();
    return lastTask();
  };
  const approvedJob = async jobId => {
    await evaluate(jobId);
    assert.equal((await prepare(jobId)).status, 'complete', (await lastTask()).message);
    await ui('packet.approve', { jobId });
    const job = (await load()).jobs.find(j => j.id === jobId);
    assert.ok(job.approvedHash, 'the packet was approved before the revision');
    return job;
  };
  return { app, ui, settle, load, lastTask, say, confirm, addJob, evaluate, prepare, approvedJob, calls, renders, ctl,
    tags: filter => calls.filter(c => instructionName(c.instruction) === filter),
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('conversation: "shorter" becomes a confirmed tasks.revise and the packet is reviewed and rendered again', async () => {
  const target = { jobId: null };
  const h = await harness({ steps: [revisionStep(target)] });
  try {
    const jobId = target.jobId = await h.addJob();
    await h.approvedJob(jobId);
    const before = (await h.load()).jobs.find(j => j.id === jobId);
    const callsBefore = h.calls.length, rendersBefore = h.renders.length;

    const request = 'make my application to Acme Robotics shorter';
    const turn = await h.say(request);
    assert.equal(turn.at(-1).status, 'needs-confirmation', turn.at(-1).text);
    const { proposal, result } = await h.confirm(turn.at(-1));
    assert.equal(result.ok, true);
    assert.deepEqual(proposal.actions.map(a => [a.name, a.tier]), [['tasks.revise', 'task']]);
    assert.deepEqual(proposal.actions[0].input, { jobId, request }, 'the request is the candidate’s own words with the job id');
    const tasksAfterConfirm = (await h.load()).tasks;
    assert.deepEqual([tasksAfterConfirm[0].kind, tasksAfterConfirm[0].jobId, tasksAfterConfirm[0].input.request], ['revise', jobId, request]);
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);

    const afterCalls = h.calls.slice(callsBefore);
    const sequence = afterCalls.map(c => c.name).filter(name => ['packet', 'humanize', 'review', 'render'].includes(name));
    assert.deepEqual(sequence, ['packet', 'humanize', 'review', 'render'], 'the revision goes through draft, humanize, independent review, then rendering');
    const packetCall = afterCalls.find(c => c.name === 'packet');
    assert.equal(packetCall.data.revisionRequest, request);
    assert.equal(packetCall.data.previousPacket.coverLetter, LONG_COVER, 'the provider receives the packet being revised');
    assert.equal(packetCall.data.master, undefined);
    assert.ok(afterCalls.find(c => c.name === 'humanize').data.items.some(i => i.id === 'cover' && i.text === SHORT_COVER), 'the humanizer sees the revised letter');
    const reviewCall = afterCalls.find(c => c.name === 'review');
    assert.equal(reviewCall.data.packet.coverLetter, SHORT_COVER, 'the reviewer sees the humanized revision');

    const job = (await h.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.packet.coverLetter, SHORT_COVER);
    assert.equal(job.review.passed, true);
    assert.equal(job.reviewAttempts.length, 1);
    assert.equal(job.calibration.claims.find(c => c.part === 'cover' && c.text === firstSentence(SHORT_COVER)).reason, 'revision review', 'calibration ran on the revised packet');
    assert.equal(job.approvedHash, null, 'a revision clears approval: the candidate must read and approve it again');
    assert.equal(job.stage, 'packet-ready');
    assert.equal(h.renders.length, rendersBefore + 1, 'the revised packet is rendered again');
    assert.notEqual(job.pdfHash, before.pdfHash, 'the PDF hash changes with the revised packet');
    assert.equal(job.pdfHash, digest(Buffer.from(h.renders.at(-1).body)));
    assert.deepEqual((await h.load()).revisions.map(r => [r.jobId, r.request]), [[jobId, request]]);
    await h.ui('packet.approve', { jobId });
    const reapproved = (await h.load()).jobs.find(j => j.id === jobId);
    assert.ok(reapproved.approvedHash, 'the candidate can approve the revised packet');
    assert.notEqual(reapproved.approvedHash, before.approvedHash, 'the approval binds the revised packet, not the old one');
  } finally { await h.close(); }
});

test('"lead with my LIMS project" reorders the resume and changes nothing else', async () => {
  const target = { jobId: null };
  const h = await harness({ steps: [revisionStep(target)] });
  try {
    const jobId = target.jobId = await h.addJob();
    await h.approvedJob(jobId);
    const before = (await h.load()).jobs.find(j => j.id === jobId);
    h.ctl.packet = data => {
      const previous = data.previousPacket;
      const lims = previous.resume.find(e => e.text === LIMS);
      return { ...previous, resume: [lims, ...previous.resume.filter(e => e !== lims)] };
    };
    const request = 'lead with my LIMS project';
    const turn = await h.say(request);
    const { proposal } = await h.confirm(turn.at(-1));
    assert.deepEqual(proposal.actions[0].input, { jobId, request });
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const after = (await h.load()).jobs.find(j => j.id === jobId);
    assert.deepEqual(after.packet.resume.map(e => e.text), [LIMS, CHASSIS, DEGREE], 'the LIMS project leads');
    assert.equal(after.packet.coverLetter, before.packet.coverLetter, 'nothing the request did not concern changed');
    assert.equal(after.packet.headline, before.packet.headline);
    assert.deepEqual(after.packet.answers, before.packet.answers);
    assert.deepEqual(after.packet.suggestions, before.packet.suggestions);
    const afterContext = await h.app.workspace.context(await h.load());
    assert.ok(after.packet.resume.every(e => hasEvidence(e, afterContext)));
    const evidenceByText = packet => Object.fromEntries(packet.resume.map(e => [e.text, e.evidence]));
    assert.deepEqual(evidenceByText(after.packet), evidenceByText(before.packet), 'evidence travels with its line');
    assert.equal(after.review.passed, true);
    assert.equal(after.approvedHash, null);
    assert.notEqual(after.pdfHash, before.pdfHash);
    assert.deepEqual(h.tags('review').at(-1).data.packet.resume.map(e => e.text), [LIMS, CHASSIS, DEGREE], 'the reviewer saw the new order');
  } finally { await h.close(); }
});

test('an unsupported request is left out and named in suggestions; a provider that inserts it anyway is blocked by review', async () => {
  const target = { jobId: null };
  const h = await harness({ steps: [revisionStep(target), revisionStep(target)] });
  try {
    const jobId = target.jobId = await h.addJob();
    await h.approvedJob(jobId);
    // The contract the drafter must follow.
    assert.match(PACKET_INSTRUCTION, /if the request asks for something the sources don't support, leave it out and say so in suggestions/i);

    // Honest scripted provider: leaves the request out, reports it.
    h.ctl.packet = data => ({
      ...data.previousPacket,
      suggestions: ['I left out “led the team”: no source says you led a team.'],
    });
    let turn = await h.say('say I led the team');
    await h.confirm(turn.at(-1));
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    let job = (await h.load()).jobs.find(j => j.id === jobId);
    const written = [job.packet.headline, job.packet.coverLetter, ...job.packet.resume.map(e => e.text), ...job.packet.answers.map(a => a.answer)].join('\n');
    assert.ok(!/led the team/i.test(written), 'the unsupported claim is not in the application');
    assert.ok(job.packet.suggestions.some(s => /left out/i.test(s) && /led the team/i.test(s)), 'the omission is reported in suggestions');
    assert.equal(job.review.passed, true, 'the clean packet still passes review');
    assert.equal(job.approvedHash, null);

    // Negative control: a provider that inserts the claim anyway must be stopped by review.
    const before = job, rendersBefore = h.renders.length;
    h.ctl.packet = data => ({
      ...data.previousPacket,
      resume: [{ section: 'Projects', text: 'Led the team of five engineers.', evidence: evidence(CHASSIS) }, ...data.previousPacket.resume],
    });
    h.ctl.review = data => /led the team/i.test(JSON.stringify(data.packet))
      ? { passed: false, issues: ['“Led the team of five engineers” is not supported by any source.'], calibration: [] }
      : { passed: true, issues: [], calibration: [] };
    turn = await h.say('say I led the team again');
    await h.confirm(turn.at(-1));
    const task = await h.lastTask();
    assert.equal(task.status, 'failed');
    assert.match(task.message, /factual review found issues/i);
    job = (await h.load()).jobs.find(j => j.id === jobId);
    assert.equal(job.review.passed, false);
    assert.equal(job.reviewAttempts.length, 2, 'both revision attempts were independently reviewed');
    assert.equal(job.stage, 'review-blocked');
    assert.equal(job.approvedHash, null, 'a blocked revision still clears approval');
    assert.equal(job.pdfHash, before.pdfHash, 'nothing is rendered from an unreviewed revision');
    assert.equal(h.renders.length, rendersBefore);
    assert.equal(job.packet.resume[0].text, before.packet.resume[0].text, 'the previous reviewed packet is not replaced');
  } finally { await h.close(); }
});

test('revising without a job id rewrites the master resume and resets its approval', async () => {
  const h = await harness({ steps: [revisionStep({ jobId: null })] });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('standard.approve', {});
    let state = await h.load();
    assert.ok(state.standard.approvedHash, 'the master was approved');
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'approved');
    const approvedDraft = state.standard.draft;
    const standardsBefore = h.tags('standard').length, humanizeBefore = h.tags('humanize').length, reviewBefore = h.tags('review').length;

    const request = 'make my master resume shorter';
    const turn = await h.say(request);
    assert.equal(turn.at(-1).status, 'needs-confirmation', turn.at(-1).text);
    const { proposal } = await h.confirm(turn.at(-1));
    assert.deepEqual(proposal.actions[0].input, { request }, 'no jobId means the master resume');
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);

    const revisions = h.tags('standard').slice(standardsBefore);
    assert.equal(revisions.length, 1, 'the master is rewritten once');
    assert.equal(revisions[0].data.revisionRequest, request);
    assert.deepEqual(revisions[0].data.previous, approvedDraft, 'the approved master is the previous draft');
    state = await h.load();
    assert.equal(state.standard.approvedHash, null);
    assert.equal(state.standard.approvedAt, null);
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'draft', 'the candidate must approve the revision');
    assert.match(state.standard.draft.resume[0].text, /^Formula SAE:/, 'the provider honored the revision request');
    assert.equal(state.standard.review.passed, true);
    assert.equal(state.standard.reviewAttempts.length, 1);
    const humanized = h.tags('humanize').slice(humanizeBefore);
    assert.equal(humanized.length, 1, 'the master revision is humanized again');
    assert.ok(humanized[0].data.items.some(item => item.id === 'resume:0' && /Formula SAE:/.test(item.text)), 'the humanizer sees the revised master line');
    assert.equal(h.tags('review').length - reviewBefore, 1, 'the master revision is reviewed again');
    assert.deepEqual(state.revisions.map(r => [r.jobId, r.request]), [[null, request]]);
    await h.ui('standard.approve', {});
    state = await h.load();
    assert.equal(standardStatus(state, (await h.app.workspace.context(state)).hash), 'approved', 'the candidate can approve the revised master');
  } finally { await h.close(); }
});

test('several writing samples reach the drafter and humanizer, cannot ground a claim, and removal leaves the next input', async () => {
  const h = await harness();
  try {
    const jobId = await h.addJob();
    await h.approvedJob(jobId);
    const samples = [
      { title: 'Team email', text: 'Quick update: the upright passed. I will send the plots tonight.' },
      { title: 'Project note', text: 'I built the rig, ran the matrix and wrote up what failed.' },
      { title: 'Old letter', text: 'I am writing to apply for the testing role described in your notice.' },
    ];
    const ids = [];
    for (const sample of samples) ids.push((await h.ui('profile.addWritingSample', sample)).result.id);
    let context = await h.app.workspace.context(await h.load());
    const voiceSource = context.sources.find(s => s.id === 'writing-samples');
    assert.ok(voiceSource, 'the samples become their own source');
    for (const sample of samples) assert.ok(voiceSource.text.includes(sample.text), sample.title);
    assert.equal((await h.load()).jobs.find(j => j.id === jobId).approvedHash, null, 'saving samples clears approvals');

    const job2 = await h.addJob('Beta Robotics');
    h.ctl.packet = data => ({
      ...basePacket(),
      resume: [{ section: 'Projects', text: 'Sent the test plots.', evidence: [{ sourceId: 'writing-samples', quote: 'I will send the plots tonight.' }] }],
    });
    assert.equal((await h.evaluate(job2)).status, 'complete', (await h.lastTask()).message);
    await h.ui('jobs.select', { jobId: job2, selected: true });
    await h.ui('tasks.prepare', { jobId: job2 }); await h.settle();
    assert.equal((await h.lastTask()).status, 'failed', 'a writing sample can never be cited as evidence');
    assert.match((await h.lastTask()).message, /claim without an exact source reference/);
    assert.equal((await h.load()).jobs.find(j => j.id === job2).packet, undefined);

    h.ctl.packet = () => basePacket();
    h.ctl.review = passingReview;
    const job3 = await h.addJob('Gamma Robotics');
    assert.equal((await h.evaluate(job3)).status, 'complete', (await h.lastTask()).message);
    assert.equal((await h.prepare(job3)).status, 'complete', (await h.lastTask()).message);
    const packetInput = h.tags('packet').at(-1).data;
    const packetVoice = packetInput.context.sources.find(s => s.id === 'writing-samples');
    assert.ok(packetVoice, 'the samples reach the packet provider');
    for (const sample of samples) assert.ok(packetVoice.text.includes(sample.text));
    const humanizeVoice = h.tags('humanize').at(-1).data.context.sources.find(s => s.id === 'writing-samples');
    assert.ok(humanizeVoice, 'the samples reach the humanizer');
    for (const sample of samples) assert.ok(humanizeVoice.text.includes(sample.text));
    for (const sample of samples) assert.equal(hasEvidence({ answer: sample.text, evidence: [{ sourceId: 'writing-samples', quote: sample.text }] }, context), false, 'M2: voice, not fact');

    await h.ui('profile.removeWritingSample', { id: ids[1] });
    context = await h.app.workspace.context(await h.load());
    assert.ok(!context.sources.find(s => s.id === 'writing-samples').text.includes(samples[1].text), 'the removed sample leaves context');
    assert.equal((await h.load()).jobs.find(j => j.id === job3).approvedHash, null, 'removing a sample clears approvals');
    const job4 = await h.addJob('Delta Robotics');
    assert.equal((await h.evaluate(job4)).status, 'complete', (await h.lastTask()).message);
    assert.equal((await h.prepare(job4)).status, 'complete', (await h.lastTask()).message);
    const afterRemoval = h.tags('packet').at(-1).data.context.sources.find(s => s.id === 'writing-samples');
    assert.ok(afterRemoval, 'the remaining samples still reach the provider');
    assert.ok(!afterRemoval.text.includes(samples[1].text), 'the removed sample is gone from the next provider input');
    for (const sample of [samples[0], samples[2]]) assert.ok(afterRemoval.text.includes(sample.text));
  } finally { await h.close(); }
});

// A missing source quote is a drafting error the model can fix: the first attempt
// gets feedback naming the entry and the quote it gave, and only the final attempt
// fails the task. Both the application and the master resume use this path.
test('an uncited packet entry is retried once with feedback naming it, and a second uncited draft still fails', async () => {
  const h = await harness();
  const UNCITED_TEXT = 'Led the chassis program and cut build time by 40%.';
  const UNCITED_QUOTE = 'I led the chassis program and cut build time by 40%.';
  const badEntry = { section: 'Projects', text: UNCITED_TEXT, evidence: evidence(UNCITED_QUOTE) };
  try {
    const fixedJob = await h.addJob('Retry Robotics');
    assert.equal((await h.evaluate(fixedJob)).status, 'complete', (await h.lastTask()).message);
    let drafts = 0;
    h.ctl.packet = () => {
      drafts += 1;
      return drafts === 1 ? { ...basePacket(), resume: [...basePacket().resume, badEntry] } : basePacket();
    };
    const prepared = await h.prepare(fixedJob);
    assert.equal(prepared.status, 'complete', prepared.message);
    assert.equal(drafts, 2, 'the uncited first draft was retried');
    const packetInputs = h.tags('packet');
    assert.equal(packetInputs.length, 2);
    const retried = packetInputs[1].data;
    assert.ok(retried.previousPacket, 'the retry carries the previous packet');
    const feedback = retried.reviewFeedback;
    assert.ok(feedback.some(line => line.includes(UNCITED_TEXT)), `the feedback names the entry: ${JSON.stringify(feedback)}`);
    assert.ok(feedback.some(line => line.includes(UNCITED_QUOTE)), 'the feedback names the quote that was given');
    assert.match(feedback[0], /quote the source exactly or remove the entry/);

    const failedJob = await h.addJob('Still Uncited Robotics');
    assert.equal((await h.evaluate(failedJob)).status, 'complete', (await h.lastTask()).message);
    h.ctl.packet = () => ({ ...basePacket(), resume: [...basePacket().resume, badEntry] });
    const failed = await h.prepare(failedJob);
    assert.equal(failed.status, 'failed');
    assert.match(failed.message, /claim without an exact source reference/);
    assert.equal((await h.load()).jobs.find(job => job.id === failedJob).packet, undefined, 'no packet is saved from an uncited draft');
  } finally { await h.close(); }
});

const FORMAL_TARGET_SAMPLES = [
  'I am writing to provide a comprehensive update regarding the test campaign, and I would like to explain the methodology that was applied throughout the process. Furthermore, the results obtained thus far are approximately consistent with the initial predictions.',
  'Please find the relevant documentation attached for your consideration, and do not hesitate to contact me at your earliest convenience should any further information be required.',
];
const TERSE_TARGET_SAMPLES = [
  "I'm a hands-on engineer. I build test rigs. I break them on purpose. I fix what breaks. Then I write the numbers down.",
  "Quick update: the upright passed. I'll send the plots tonight. Ask me if anything looks off.",
];

test('voice targets are measured from fixed samples deterministically', () => {
  assert.deepEqual(voiceTargetOf(TERSE_TARGET_SAMPLES), { sentenceLength: 5, contractions: 'use', register: 'plain' });
  assert.deepEqual(voiceTargetOf(FORMAL_TARGET_SAMPLES), { sentenceLength: 22, contractions: 'avoid', register: 'formal' });
  assert.equal(voiceTargetOf([]), null);
  assert.equal(voiceTargetOf([{ title: 'Line', text: 'I am writing.' }]), null, 'one short line does not set a target');
});

test('the packet and standard instructions make INPUT.voiceTarget the register authority', () => {
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) {
    assert.match(instruction, /When INPUT\.voiceTarget is present/);
    assert.match(instruction, /authority on register/);
    assert.match(instruction, /Formal is not stock/);
    assert.match(instruction, /never force short sentences or an informal register/);
  }
});

test('writing samples set INPUT.voiceTarget for the drafting and humanizer calls, and an excluded source sets none', async () => {
  const h = await harness();
  try {
    const samples = FORMAL_TARGET_SAMPLES.map((text, i) => ({ title: `Note ${i + 1}`, text }));
    for (const sample of samples) await h.ui('profile.addWritingSample', sample);
    const jobId = await h.addJob('Voice Robotics');
    assert.equal((await h.evaluate(jobId)).status, 'complete', (await h.lastTask()).message);
    assert.equal((await h.prepare(jobId)).status, 'complete', (await h.lastTask()).message);
    const expected = voiceTargetOf(samples);
    assert.deepEqual(expected, { sentenceLength: 22, contractions: 'avoid', register: 'formal' });
    assert.deepEqual(h.tags('packet').at(-1).data.voiceTarget, expected, 'the drafter receives the target');
    assert.deepEqual(h.tags('humanize').at(-1).data.voiceTarget, expected, 'the humanizer receives the target');

    await h.app.workspace.mutate(state => { state.contextPrefs = { excludedSources: ['writing-samples'] }; });
    const excludedJob = await h.addJob('Excluded Robotics');
    assert.equal((await h.evaluate(excludedJob)).status, 'complete', (await h.lastTask()).message);
    assert.equal((await h.prepare(excludedJob)).status, 'complete', (await h.lastTask()).message);
    assert.equal(h.tags('packet').at(-1).data.voiceTarget, undefined, 'an excluded sample set sets no target');
    assert.equal(h.tags('humanize').at(-1).data.voiceTarget, undefined);
  } finally { await h.close(); }
});

test('the packet instruction keeps fit questions out of the blocking list', () => {
  assert.match(PACKET_INSTRUCTION, /include only a fact without which a required document or a job-specific answer cannot be written truthfully/);
  assert.match(PACKET_INSTRUCTION, /Whether the candidate meets a requirement \(years, degree level, a skill\) is never a packet question/);
  assert.match(PACKET_INSTRUCTION, /put the doubt in suggestions/);
});

test('voice metrics rank terse and formal samples deterministically; the contrast script makes no call without a provider', () => {
  const terse = "I'm a test engineer. I build rigs. I break them on purpose. I fix what breaks.";
  const formal = 'Furthermore, I am writing to express my interest in the position, and I would like to explain how my experience in designing and validating mechanical systems could contribute to the continued success of your organisation. I shall follow up at your earliest convenience.';
  const a = voiceFeatures(terse), b = voiceFeatures(formal);
  assert.ok(a.meanSentenceLength < b.meanSentenceLength, 'terse sentences are shorter');
  assert.equal(a.contractionRate > 0, true);
  assert.equal(b.contractionRate, 0);
  assert.ok(b.formalityRate > a.formalityRate, 'formal markers dominate the formal text');
  assert.deepEqual(voiceFeatures(terse), a, 'the metric is deterministic');
  assert.equal(voiceDistance(terse, terse), 0);
  assert.ok(voiceDistance(terse, formal) > 0);
  assert.deepEqual(voiceFeatures(''), { sentences: 0, words: 0, meanSentenceLength: 0, contractionRate: 0, formalityRate: 0, contractionMarkers: 0, formalityMarkers: 0 });
  assert.equal(voiceAttribution({ letter: terse, own: terse, other: formal }).closerToOwn, true);
  assert.equal(voiceAttribution({ letter: formal, own: formal, other: terse }).closerToOwn, true);
  assert.equal(voiceAttribution({ letter: terse, own: formal, other: terse }).closerToOwn, false);
  assert.equal(voiceAttribution({ letter: terse, own: terse, other: terse }).closerToOwn, false, 'a tie is not evidence');

  const spawn = args => spawnSync(process.execPath, ['scripts/voice-contrast.mjs', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  const missing = spawn([]);
  assert.equal(missing.status, 2, 'without --provider the script does not run');
  assert.match(missing.stderr + missing.stdout, /--provider/);
  const help = spawn(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /synthetic/);
  const unknown = spawn(['--provider', 'not-a-provider']);
  assert.equal(unknown.status, 2, 'an unknown provider is refused before any workspace or call');
  assert.match(unknown.stderr, /Unknown provider/);
});
