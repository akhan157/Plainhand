// Scripted multi-turn conversations with the fixture agent (docs/AGENT-CONTRACTS.md §4–§5,
// docs/AGENT-BUILD-PLAN.md working-state items 2–4). Tests only; no production code here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureProviders, scriptedAgent, spyAgent } from './plainhand/test-fixtures.mjs';

const VERIFIED_TEXT = 'This is an engineering role designing and testing hardware. '.repeat(10);
const JOB = { company: 'Acme Robotics', title: 'Graduate Engineer', url: 'https://jobs.lever.co/acme/42' };
const isAgentCall = input => input.instruction.startsWith('Act as the conversational assistant');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function harness(steps, { root, fresh = true, provider = 'codex', addJob = false } = {}) {
  root ||= await mkdtemp(path.join(tmpdir(), 'plainhand-conv-'));
  const scripted = scriptedAgent(steps);
  const agent = spyAgent(scripted);
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: VERIFIED_TEXT, checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  if (fresh) {
    const state = (await request('state')).data;
    await request('profile', { profile: candidate, revision: state.revision });
    if (provider) await request('provider', { id: provider });
  }
  const events = [];
  const original = app.agent.emit;
  app.agent.emit = (event, data) => { events.push({ event, data }); original(event, data); };
  let jobId = null;
  if (addJob) jobId = (await app.registry.run('jobs.add', JOB)).result.id;
  const say = async text => { const { turnId } = await app.agent.message(text); await app.agent.running; return { turnId, messages: (await app.agent.history({ limit: 500 })).messages.filter(m => m.turnId === turnId) }; };
  const proposalOf = async message => (await app.agent.proposals()).find(p => p.id === message.proposalId);
  const job = async (id = jobId) => (await app.workspace.load()).jobs.find(j => j.id === id);
  const agentInputs = () => agent.inputs.filter(isAgentCall);
  const audit = async () => (await app.registry.run('audit.list', { limit: 100 })).result.slice().reverse();
  return { root, app, agent, request, events, jobId, say, proposalOf, job, agentInputs, audit,
    close: async ({ keep = false } = {}) => { await app.close(); if (!keep) await rm(root, { recursive: true, force: true }); } };
}

// A provider wait the test releases by hand. honour=false models a provider that ignores the abort signal.
function gate({ honour = true } = {}) {
  let release, started = false;
  const ready = new Promise(resolve => { release = resolve; });
  const wait = signal => { started = true; return new Promise((resolve, reject) => { ready.then(resolve); if (honour) signal?.addEventListener('abort', () => reject(new Error('aborted'))); }); };
  return { wait, release: () => release(), started: async () => { while (!started) await new Promise(resolve => setTimeout(resolve, 5)); } };
}

// ── Working-state item 2, by conversation ─────────────────────────────────

test('item 2: paste a link → save → evaluate → discuss → choose → prepare → candidate approves and confirms Applied', async () => {
  const find = data => data.digest.jobs.find(j => j.company === JOB.company);
  const h = await harness([
    { match: /jobs\.lever\.co/, reply: data => {
      assert.equal(data.digest.jobs.length, 0, 'the workspace starts empty');
      return { say: 'I can save Acme Robotics — Graduate Engineer for you.', actions: [{ name: 'jobs.add', input: { ...JOB, description: 'Pasted text from the candidate.' } }] };
    } },
    { match: /^evaluate it/i, reply: data => ({ say: 'I can evaluate it against your evidence.', actions: [{ name: 'tasks.evaluate', input: { jobId: find(data).id } }] }) },
    { match: /why that score/i, reply: data => ({ say: '', actions: [{ name: 'jobs.get', input: { jobId: find(data).id } }] }) },
    { match: /why that score/i, reply: data => {
      const read = JSON.parse(data.results.find(r => r.name === 'jobs.get').result);
      return { say: `It scored ${read.evaluation.score}/5: ${read.evaluation.summary} Gap: ${read.evaluation.gaps[0]}`, actions: [] };
    } },
    { match: /choose it/i, reply: data => ({ say: 'I can choose it for your applications.', actions: [{ name: 'jobs.select', input: { jobId: find(data).id, selected: true } }] }) },
    { match: /prepare it/i, reply: data => ({ say: 'I can prepare the packet.', actions: [{ name: 'tasks.prepare', input: { jobId: find(data).id } }] }) },
    { match: /approve it for me/i, reply: data => ({ say: 'Only you can approve it. I opened the packet.', actions: [{ name: 'packet.approve', input: { jobId: find(data).id } }, { name: 'ui.openPanel', input: { type: 'packet', id: find(data).id } }] }) },
    { match: /mark it applied/i, reply: data => ({ say: 'Confirm it in the job panel.', actions: [{ name: 'jobs.confirmSubmitted', input: { jobId: find(data).id } }] }) },
    { match: /just set the status/i, reply: data => ({ say: 'Setting it.', actions: [{ name: 'jobs.setStatus', input: { jobId: find(data).id, status: 'Applied' } }] }) },
  ]);
  try {
    // 1. Paste a link: one write proposal, nothing saved until confirmed.
    let turn = await h.say(`Here is a role I like: ${JOB.url} (Acme Robotics, Graduate Engineer)`);
    assert.equal(turn.messages.at(-1).status, 'needs-confirmation');
    let proposal = await h.proposalOf(turn.messages.at(-1));
    assert.deepEqual(proposal.actions.map(a => [a.name, a.tier, a.summary]), [['jobs.add', 'write', 'Save Acme Robotics — Graduate Engineer']]);
    assert.equal(proposal.tainted, false);
    assert.equal((await h.app.workspace.load()).jobs.length, 0, 'nothing saved before confirmation');
    let confirmed = await h.app.agent.confirm({ proposalId: proposal.id, accept: true });
    assert.equal(confirmed.ok, true);
    const jobId = confirmed.results[0].result.id;
    assert.equal((await h.job(jobId)).stage, 'inbox');

    // 2. Evaluate: a task proposal, queued only on confirmation, completed by the fixture agent.
    turn = await h.say('evaluate it please');
    proposal = await h.proposalOf(turn.messages.at(-1));
    assert.deepEqual(proposal.actions.map(a => [a.name, a.tier]), [['tasks.evaluate', 'task']]);
    assert.equal((await h.app.workspace.load()).tasks.length, 0);
    confirmed = await h.app.agent.confirm({ proposalId: proposal.id, accept: true });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.undoToken, null, 'tasks are not undoable');
    await h.app.workflow.queue;
    assert.deepEqual((await h.app.workspace.load()).tasks.map(t => [t.kind, t.status]), [['evaluate', 'complete']]);
    assert.equal((await h.job(jobId)).evaluation.score, 4.4);
    assert.deepEqual(h.events.filter(e => e.event === 'agent.task').map(e => e.data), [{ turnId: turn.turnId, taskId: (await h.app.workspace.load()).tasks[0].id, kind: 'evaluate', jobId }]);

    // 3. "Why that score?" is answered from a jobs.get read: two model calls, no proposal.
    const callsBefore = h.agentInputs().length;
    turn = await h.say('why that score?');
    assert.equal(h.agentInputs().length - callsBefore, 2);
    assert.equal(turn.messages.at(-1).status, 'complete');
    assert.equal(turn.messages.at(-1).text, 'It scored 4.4/5: Your hands-on engineering project is relevant. Gap: No industry role documented.');
    assert.equal(turn.messages.at(-1).proposalId, undefined);
    assert.equal(h.agentInputs().at(-1).data.results[0].name, 'jobs.get');

    // 4. Choose it: a fresh turn with no reads is not tainted, even after the previous turn read the evaluation.
    turn = await h.say('ok, choose it');
    proposal = await h.proposalOf(turn.messages.at(-1));
    assert.deepEqual([proposal.actions[0].name, proposal.tainted, proposal.taintSources], ['jobs.select', false, []]);
    assert.equal((await h.job(jobId)).selected, false);
    assert.equal((await h.app.agent.confirm({ proposalId: proposal.id, accept: true })).ok, true);
    assert.equal((await h.job(jobId)).selected, true);

    // 5. Prepare it: packet exists after the task completes.
    turn = await h.say('prepare it');
    proposal = await h.proposalOf(turn.messages.at(-1));
    assert.deepEqual(proposal.actions.map(a => a.name), ['tasks.prepare']);
    await h.app.agent.confirm({ proposalId: proposal.id, accept: true });
    await h.app.workflow.queue;
    let current = await h.job(jobId);
    assert.ok(current.packet, 'packet exists');
    assert.equal(current.stage, 'packet-ready');
    assert.equal(current.approvedHash, null);

    // 6. "Approve it for me": the agent can only open the packet panel.
    turn = await h.say('approve it for me');
    assert.equal(turn.messages.at(-1).status, 'complete');
    assert.equal(turn.messages.at(-1).proposalId, undefined);
    assert.deepEqual(turn.messages.at(-1).panel, { type: 'packet', id: jobId });
    assert.deepEqual(h.events.filter(e => e.event === 'agent.panel' && e.data.turnId === turn.turnId).map(e => e.data.panel), [{ type: 'packet', id: jobId }]);
    assert.equal((await h.job(jobId)).approvedHash, null, 'the agent never approves');
    // The candidate approves on screen.
    await h.app.registry.run('packet.approve', { jobId }, { actor: 'ui' });
    current = await h.job(jobId);
    assert.equal(current.stage, 'approved');
    assert.ok(current.approvedHash);

    // 7. "Mark it applied": never possible for the agent, whatever it tries.
    turn = await h.say('mark it applied');
    assert.deepEqual(turn.messages.at(-1).panel, { type: 'job', id: jobId });
    assert.equal((await h.job(jobId)).status, 'Apply');
    turn = await h.say('just set the status to Applied then');
    if (turn.messages.at(-1).proposalId) {
      // Even if the engine proposes it and the candidate clicks Save, the registry refuses.
      const refused = await h.app.agent.confirm({ proposalId: turn.messages.at(-1).proposalId, accept: true });
      assert.equal(refused.ok, false);
      assert.equal(refused.results[0].code, 'candidate_only');
    }
    current = await h.job(jobId);
    assert.deepEqual([current.status, current.submittedAt, current.stage], ['Apply', undefined, 'approved']);

    // 8. The candidate confirms the submission through the UI actor.
    await h.app.registry.run('jobs.confirmSubmitted', { jobId }, { actor: 'ui' });
    current = await h.job(jobId);
    assert.deepEqual([current.status, current.stage, current.submissionSource], ['Applied', 'submitted', 'candidate-confirmed']);
    assert.deepEqual(current.statusHistory.at(-1).to, 'Applied');

    const tracker = await h.app.workspace.read('data/applications.md');
    assert.equal(tracker, [
      '# Applications', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      `| 1 | ${current.createdAt.slice(0, 10)} | Acme Robotics | Graduate Engineer | 4.4/5 | Applied | ✅ | [1](${current.reportPath.replace(/^reports\//, '../reports/')}) | submitted |`,
    ].join('\n') + '\n');

    // The audit log has exactly the four confirmed agent actions, in order, and nothing candidate-only.
    const agentEntries = (await h.audit()).filter(e => e.action.startsWith('agent-'));
    assert.deepEqual(agentEntries.map(e => [e.action, e.reason.split(':')[0]]), [
      ['agent-write', 'jobs.add'], ['agent-task', 'tasks.evaluate'], ['agent-write', 'jobs.select'], ['agent-task', 'tasks.prepare'],
    ]);
    assert.equal(h.agent.remaining(), 0, 'every scripted step was used');
  } finally { await h.close(); }
});

// ── Items 3 and 4 inside a longer conversation ────────────────────────────

test('items 3 and 4 in one conversation: grouped Dana proposal, undo, redo, then "what is due this week?" from the digest', async () => {
  const friday = plusDays(5);
  const dana = data => [
    { name: 'record.addInterview', input: { jobId: data.digest.jobs[0].id, stage: 'Recruiter screen', date: today(), status: 'completed', interviewer: 'Dana Lee', notes: 'Asked about FEA; private interview note' } },
    { name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee', role: 'Recruiter', email: 'dana.lee@acme.example', phone: '+1 617 555 0101', notes: 'Private: prefers email' } },
    { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Send references to Dana', due: friday } },
  ];
  const h = await harness([
    { match: /good morning/i, reply: { say: 'Morning! One role in your workspace.', actions: [] } },
    { match: /screen with Dana/i, reply: data => ({ say: 'I can log the screen, add Dana and set a reminder for Friday.', actions: dana(data) }) },
    { match: /put it back/i, reply: data => ({ say: 'Here it is again.', actions: dana(data) }) },
    { match: /due this week/i, reply: data => {
      const week = data.digest.followUps.filter(f => f.due && f.due <= plusDays(7));
      return { say: week.map(f => `${f.action} (due ${f.due})`).join('; ') || 'Nothing is due this week.', actions: [] };
    } },
  ], { addJob: true });
  try {
    await h.say('Good morning');
    let turn = await h.say('Had the screen with Dana, went well, she wants references Friday.');
    let proposal = await h.proposalOf(turn.messages.at(-1));
    assert.deepEqual(proposal.actions.map(a => a.index), [0, 1, 2]);
    assert.deepEqual(proposal.actions.map(a => a.summary), [`Add Recruiter screen interview on ${today()}`, 'Add contact Dana Lee (Recruiter)', `Next action: Send references to Dana, due ${friday}`]);
    assert.equal((await h.job()).record, undefined, 'nothing saved before accept');
    const first = await h.app.agent.confirm({ proposalId: proposal.id, accept: true });
    assert.equal(first.ok, true);
    assert.equal((await h.job()).record.contacts[0].email, 'dana.lee@acme.example');
    await h.app.agent.undo(first.undoToken);
    let record = (await h.job()).record;
    assert.deepEqual([record.interviews.length, record.contacts.length, record.nextAction], [0, 0, null]);
    await assert.rejects(h.app.agent.undo(first.undoToken), /can no longer be undone/, 'undo is single use');

    turn = await h.say('Sorry, put it back');
    proposal = await h.proposalOf(turn.messages.at(-1));
    assert.equal((await h.app.agent.confirm({ proposalId: proposal.id, accept: true })).ok, true);
    assert.equal((await h.job()).status, undefined, 'logging an interview never changes the status');

    const stateBefore = JSON.stringify(await h.app.workspace.load());
    const usageBefore = (await h.app.workflow.usage.records()).length;
    const callsBefore = h.agentInputs().length;
    turn = await h.say("What's due this week?");
    assert.equal(h.agentInputs().length - callsBefore, 1, 'one model call');
    assert.equal((await h.app.workflow.usage.records()).length - usageBefore, 1);
    assert.deepEqual(turn.messages.map(m => [m.role, m.text, m.status]), [['user', "What's due this week?", undefined], ['assistant', `Send references to Dana (due ${friday})`, 'complete']]);
    assert.equal(JSON.stringify(await h.app.workspace.load()), stateBefore, 'zero actions: nothing changed');
    assert.deepEqual(h.events.filter(e => e.data.turnId === turn.turnId).map(e => e.event), ['agent.message', 'agent.turn', 'agent.message', 'agent.done']);

    // The model saw the whole conversation so far, in order, but not the current message as history.
    const input = h.agentInputs().at(-1).data;
    assert.deepEqual(input.history.map(m => [m.role, m.text]), [
      ['user', 'Good morning'], ['assistant', 'Morning! One role in your workspace.'],
      ['user', 'Had the screen with Dana, went well, she wants references Friday.'], ['assistant', 'I can log the screen, add Dana and set a reminder for Friday.'],
      ['assistant', 'Saved all 3 changes.'], ['assistant', 'Undone.'],
      ['user', 'Sorry, put it back'], ['assistant', 'Here it is again.'], ['assistant', 'Saved all 3 changes.'],
    ]);
    assert.equal(input.message, "What's due this week?");
    assert.deepEqual(Object.keys(input.history[0]).sort(), ['role', 'text'], 'history carries only role and text');
    // The digest answers the question without contact details or interview notes.
    assert.deepEqual(input.digest.followUps.map(f => [f.action, f.due]), [['Send references to Dana', friday]]);
    for (const secret of ['dana.lee@acme.example', '555 0101', 'Private: prefers email', 'private interview note']) assert.ok(!h.agentInputs().some(i => i.text.includes(secret)), `model input never contains ${secret}`);

    // Stored history is in strict chronological order.
    const stored = (await h.app.agent.history({ limit: 500 })).messages;
    assert.deepEqual(stored.map(m => m.at), stored.map(m => m.at).slice().sort());
    assert.equal(stored.length, 11);
  } finally { await h.close(); }
});

// ── Declines, edits, late confirmations, changed data ─────────────────────

test('a declined proposal stays declined; an earlier proposal cannot overwrite a newer change', async () => {
  const set = text => data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text, due: plusDays(3) } }] });
  const h = await harness([
    { match: /remind/, reply: set('Follow up with Acme') },
    { match: /add Sam/, reply: data => ({ say: 'Add Sam?', actions: [{ name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Sam Park' } }] }) },
    { match: /portfolio/, reply: set('Send portfolio') },
  ], { addJob: true });
  try {
    const first = (await h.say('remind me to follow up')).messages.at(-1);
    const sam = (await h.say('add Sam as a contact')).messages.at(-1);
    assert.deepEqual(await h.app.agent.confirm({ proposalId: sam.proposalId, accept: false }), { ok: true, results: [] });
    assert.equal((await h.proposalOf(sam)).status, 'declined');
    await assert.rejects(h.app.agent.confirm({ proposalId: sam.proposalId, accept: true }), error => error.code === 'stale');
    assert.equal((await h.job()).record, undefined);

    const third = (await h.say('note to send my portfolio')).messages.at(-1);
    const edited = await h.app.agent.confirm({ proposalId: third.proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'Send portfolio PDF', due: plusDays(4) } } });
    assert.equal(edited.ok, true);
    assert.equal((await h.job()).record.nextAction.text, 'Send portfolio PDF');
    assert.equal((await h.proposalOf(third)).edited, true);
    assert.match((await h.audit()).at(-1).reason, /^record\.setNextAction: Next action: Send portfolio PDF, due .* \(edited by the candidate\)$/);

    // The first proposal was made before the record changed: confirming it now is refused, not applied over the newer value.
    assert.equal((await h.proposalOf(first)).status, 'pending');
    await assert.rejects(h.app.agent.confirm({ proposalId: first.proposalId, accept: true }), error => error.code === 'stale');
    assert.equal((await h.job()).record.nextAction.text, 'Send portfolio PDF');
    assert.equal((await h.proposalOf(first)).status, 'stale');
    assert.match((await h.app.agent.history()).messages.at(-1).text, /^Nothing was changed: .*changed since I suggested it/);
  } finally { await h.close(); }
});

test('an edit that fails validation applies nothing and the proposal can be fixed and retried', async () => {
  const h = await harness([{ reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Original', due: plusDays(2) } }] }) }], { addJob: true });
  try {
    const message = (await h.say('set a reminder')).messages.at(-1);
    const result = await h.app.agent.confirm({ proposalId: message.proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'Edited', due: 'next Friday' } } });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(result.results[0].code, 'invalid_input');
    assert.equal(result.undoToken, null);
    assert.equal((await h.job()).record, undefined);
    const proposal = await h.proposalOf(message);
    assert.equal(proposal.status, 'pending', 'nothing was applied, so the proposal stays open');
    assert.match(proposal.lastError, /date/);
    assert.equal((await h.audit()).filter(e => e.action.startsWith('agent-')).length, 0);
    const retried = await h.app.agent.confirm({ proposalId: message.proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'Edited', due: plusDays(5) } } });
    assert.equal(retried.ok, true);
    assert.equal((await h.job()).record.nextAction.text, 'Edited');
  } finally { await h.close(); }
});

test('an edit with an unexpected key or a non-object is rejected, nothing applied', async () => {
  const h = await harness([
    { reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'A' } }] }) },
    { reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'B' } }] }) },
  ], { addJob: true });
  try {
    const a = (await h.say('one')).messages.at(-1);
    const extraKey = await h.app.agent.confirm({ proposalId: a.proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'A', status: 'Applied' } } });
    assert.deepEqual([extraKey.ok, extraKey.results[0].code], [false, 'invalid_input']);
    const b = (await h.say('two')).messages.at(-1);
    const notObject = await h.app.agent.confirm({ proposalId: b.proposalId, accept: true, edits: { 0: 'text' } });
    assert.deepEqual([notObject.ok, notObject.results[0].code], [false, 'invalid_input']);
    assert.equal((await h.job()).record, undefined);
  } finally { await h.close(); }
});

test('confirming a proposal whose job was deleted is refused as out of date and applies nothing', async () => {
  const h = await harness([{ reply: data => ({ say: 'Two changes.', actions: [
    { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Call Dana' } },
    { name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee' } },
  ] }) }], { addJob: true });
  try {
    const message = (await h.say('note the call and add Dana')).messages.at(-1);
    await h.app.workspace.mutate(state => { state.jobs = state.jobs.filter(j => j.id !== h.jobId); });
    const before = await h.app.workspace.read('data/plainhand/workspace.json');
    await assert.rejects(h.app.agent.confirm({ proposalId: message.proposalId, accept: true }), error => error.code === 'stale');
    assert.equal(await h.app.workspace.read('data/plainhand/workspace.json'), before, 'workspace byte-for-byte unchanged');
    assert.equal((await h.app.agent.history()).messages.at(-1).status, 'failed');
    assert.equal((await h.audit()).filter(e => e.action.startsWith('agent-')).length, 0);
  } finally { await h.close(); }
});

test('confirming "choose it" after the posting changed is refused as out of date', async () => {
  const h = await harness([{ reply: data => ({ say: 'Choose it?', actions: [{ name: 'jobs.select', input: { jobId: data.digest.jobs[0].id, selected: true } }] }) }], { addJob: true });
  try {
    await h.app.registry.run('tasks.evaluate', { jobId: h.jobId }, { actor: 'ui' });
    await h.app.workflow.queue;
    const message = (await h.say('choose it')).messages.at(-1);
    await h.app.registry.run('jobs.setContext', { jobId: h.jobId, description: 'A different posting text that replaces the original one.' }, { actor: 'ui' });
    await assert.rejects(h.app.agent.confirm({ proposalId: message.proposalId, accept: true }), error => error.code === 'stale');
    assert.equal((await h.job()).selected, false);
  } finally { await h.close(); }
});

test('a group that fails part-way is rolled back, stays open, and succeeds after an edit', async () => {
  const h = await harness([{ reply: data => ({ say: 'Three changes.', actions: [
    { name: 'record.addInterview', input: { jobId: data.digest.jobs[0].id, stage: 'Screen', date: today() } },
    { name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee' } },
    { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Send references' } },
  ] }) }], { addJob: true });
  try {
    await h.app.registry.run('record.addContact', { jobId: h.jobId, name: 'Dana Lee' }, { actor: 'ui' }); // already recorded before the proposal
    const message = (await h.say('log the Dana screen')).messages.at(-1);
    const result = await h.app.agent.confirm({ proposalId: message.proposalId, accept: true });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.deepEqual(result.results.map(r => r.ok), [true, false]);
    let record = (await h.job()).record;
    assert.deepEqual([record.interviews.length, record.contacts.length, record.nextAction], [0, 1, null], 'the interview saved before the failure was rolled back');
    assert.match((await h.app.agent.history()).messages.at(-1).text, /^Nothing was saved: This contact is already recorded/);
    assert.equal((await h.proposalOf(message)).status, 'pending');
    const fixed = await h.app.agent.confirm({ proposalId: message.proposalId, accept: true, edits: { 1: { jobId: h.jobId, name: 'Sam Park' } } });
    assert.equal(fixed.ok, true);
    record = (await h.job()).record;
    assert.deepEqual([record.interviews.length, record.contacts.map(c => c.name), record.nextAction.text], [1, ['Dana Lee', 'Sam Park'], 'Send references']);
  } finally { await h.close(); }
});

// ── Concurrency ───────────────────────────────────────────────────────────

test('a message while a turn runs is refused as busy (engine and HTTP), and clear is refused too', async () => {
  const g = gate();
  const h = await harness([{ wait: g.wait, reply: { say: 'Done thinking.', actions: [] } }, { reply: { say: 'Second.', actions: [] } }]);
  try {
    const { turnId } = await h.app.agent.message('first');
    await g.started();
    await assert.rejects(h.app.agent.message('second'), error => error.code === 'busy');
    const http = await h.request('agent/message', { text: 'second' });
    assert.deepEqual([http.status, http.data.code], [400, 'busy']);
    await assert.rejects(h.app.agent.clear(), error => error.code === 'busy');
    assert.equal((await h.request('agent/history')).data.running, turnId);
    g.release();
    await h.app.agent.running;
    const messages = (await h.app.agent.history()).messages;
    assert.deepEqual(messages.map(m => m.text), ['first', 'Done thinking.'], 'the refused message was never stored');
    assert.equal((await h.say('second')).messages.at(-1).text, 'Second.');
  } finally { await h.close(); }
});

test('an earlier proposal can be confirmed while a new turn runs; messages keep their real order', async () => {
  const g = gate();
  const h = await harness([
    { match: /remind/, reply: data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Ping Acme' } }] }) },
    { match: /think/, wait: g.wait, reply: data => ({ say: `Next: ${data.digest.jobs[0].nextAction?.text || 'none'}`, actions: [] }) },
  ], { addJob: true });
  try {
    const pending = (await h.say('remind me to ping Acme')).messages.at(-1);
    const { turnId } = await h.app.agent.message('think about it');
    await g.started();
    const confirmed = await h.app.agent.confirm({ proposalId: pending.proposalId, accept: true });
    assert.equal(confirmed.ok, true);
    g.release();
    await h.app.agent.running;
    const texts = (await h.app.agent.history()).messages.map(m => m.text);
    assert.deepEqual(texts, ['remind me to ping Acme', 'Set it?', 'think about it', 'Saved that change.', 'Next: none']);
    assert.equal((await h.job()).record.nextAction.text, 'Ping Acme');
    assert.equal((await h.app.agent.history()).messages.at(-1).turnId, turnId);
  } finally { await h.close(); }
});

test('five parallel confirms of one proposal apply it exactly once', async () => {
  const h = await harness([{ reply: data => ({ say: 'Add Dana?', actions: [{ name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee' } }] }) }], { addJob: true });
  try {
    const { proposalId } = (await h.say('add Dana')).messages.at(-1);
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => h.app.agent.confirm({ proposalId, accept: true })));
    assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(settled.filter(r => r.status === 'rejected').every(r => r.reason.code === 'stale'));
    assert.equal((await h.job()).record.contacts.length, 1);
    assert.equal((await h.audit()).filter(e => e.action === 'agent-write').length, 1);
    assert.equal((await h.app.agent.history()).messages.filter(m => m.text === 'Saved that change.').length, 1);
  } finally { await h.close(); }
});

test('parallel HTTP accept and decline of one proposal: exactly one wins', async () => {
  const h = await harness([{ reply: data => ({ say: 'Add Dana?', actions: [{ name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee' } }] }) }], { addJob: true });
  try {
    const { proposalId } = (await h.say('add Dana')).messages.at(-1);
    const [accept, decline] = await Promise.all([h.request('agent/confirm', { proposalId, accept: true }), h.request('agent/confirm', { proposalId, accept: false })]);
    assert.deepEqual([accept.status, decline.status].sort(), [200, 400]);
    const status = (await h.app.agent.proposals()).find(p => p.id === proposalId).status;
    assert.equal((await h.job()).record?.contacts.length || 0, status === 'accepted' ? 1 : 0);
  } finally { await h.close(); }
});

test('accept must be exactly true over HTTP; "true" as a string declines', async () => {
  const h = await harness([{ reply: data => ({ say: 'Add Dana?', actions: [{ name: 'record.addContact', input: { jobId: data.digest.jobs[0].id, name: 'Dana Lee' } }] }) }], { addJob: true });
  try {
    const { proposalId } = (await h.say('add Dana')).messages.at(-1);
    assert.equal((await h.request('agent/confirm', { proposalId, accept: 'true' })).status, 200);
    assert.equal((await h.app.agent.proposals())[0].status, 'declined');
    assert.equal((await h.job()).record, undefined);
  } finally { await h.close(); }
});

// ── Restart ───────────────────────────────────────────────────────────────

test('restart: history and a pending proposal survive and can be confirmed on the new server', async () => {
  const a = await harness([
    { match: /hello/, reply: { say: 'Hi there.', actions: [] } },
    { match: /remind/, reply: data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Call Acme back', due: plusDays(1) } }] }) },
  ], { addJob: true });
  const jobId = a.jobId;
  const pending = ((await a.say('hello')), (await a.say('remind me to call Acme back'))).messages.at(-1);
  const before = (await a.app.agent.history()).messages;
  await a.close({ keep: true });

  const b = await harness([{ match: /what did I ask/, reply: data => ({ say: `You said: ${data.history.filter(m => m.role === 'user').map(m => m.text).join(' / ')}`, actions: [] }) }], { root: a.root, fresh: false });
  try {
    const after = await b.app.agent.history();
    assert.deepEqual(after.messages, before);
    assert.equal(after.running, null);
    assert.deepEqual(after.proposals.map(p => [p.id, p.status]), [[pending.proposalId, 'pending']]);
    const result = await b.app.agent.confirm({ proposalId: pending.proposalId, accept: true });
    assert.equal(result.ok, true);
    assert.equal((await b.job(jobId)).record.nextAction.text, 'Call Acme back');
    await b.app.agent.undo(result.undoToken);
    assert.equal((await b.job(jobId)).record.nextAction, null, 'undo works for a confirmation made after the restart');
    const turn = await b.say('what did I ask before?');
    assert.equal(turn.messages.at(-1).text, 'You said: hello / remind me to call Acme back');
  } finally { await b.close(); }
});

test('restart: an undo token from before the restart is reported as expired, the data stays', async () => {
  const a = await harness([{ reply: data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Before restart' } }] }) }], { addJob: true });
  const { proposalId } = (await a.say('remind me')).messages.at(-1);
  const { undoToken } = await a.app.agent.confirm({ proposalId, accept: true });
  assert.ok(undoToken);
  await a.close({ keep: true });
  const b = await harness([], { root: a.root, fresh: false });
  try {
    await assert.rejects(b.app.agent.undo(undoToken), error => error.code === 'not_found' && /can no longer be undone/.test(error.message));
    assert.equal((await b.job(a.jobId)).record.nextAction.text, 'Before restart');
  } finally { await b.close(); }
});

test('restart: a pending task proposal is confirmed on the new server and the task runs there', async () => {
  const a = await harness([{ reply: data => ({ say: 'Evaluate?', actions: [{ name: 'tasks.evaluate', input: { jobId: data.digest.jobs[0].id } }] }) }], { addJob: true });
  const { proposalId } = (await a.say('evaluate it')).messages.at(-1);
  await a.close({ keep: true });
  const b = await harness([], { root: a.root, fresh: false });
  try {
    assert.equal((await b.app.agent.confirm({ proposalId, accept: true })).ok, true);
    await b.app.workflow.queue;
    assert.deepEqual((await b.app.workspace.load()).tasks.map(t => [t.kind, t.status]), [['evaluate', 'complete']]);
  } finally { await b.close(); }
});

test('restart: a turn running at shutdown is recorded as canceled; nothing is proposed', async () => {
  const g = gate();
  const a = await harness([{ wait: g.wait, reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'late' } }] }) }], { addJob: true });
  await a.app.agent.message('a long question');
  await g.started();
  await a.close({ keep: true });
  await a.app.agent.running;
  const b = await harness([{ reply: { say: 'Fresh start.', actions: [] } }], { root: a.root, fresh: false });
  try {
    const history = await b.app.agent.history();
    assert.deepEqual(history.messages.map(m => [m.role, m.text, m.status]), [['user', 'a long question', undefined], ['assistant', 'Stopped. Nothing was changed.', 'canceled']]);
    assert.equal((await b.app.agent.proposals()).length, 0);
    assert.equal(history.running, null);
    assert.equal((await b.say('again')).messages.at(-1).text, 'Fresh start.');
  } finally { await b.close(); }
});

test('restart after a crash mid-turn: the unanswered message stays visible and the agent is usable', async () => {
  // A crash cannot append anything: simulate it with the files a killed process leaves behind.
  const a = await harness([], { addJob: true });
  await a.app.workspace.write('data/plainhand/conversation.jsonl', JSON.stringify({ id: 'm1', turnId: 't1', role: 'user', text: 'question before the crash', at: new Date().toISOString() }) + '\n');
  await a.close({ keep: true });
  const b = await harness([{ reply: data => ({ say: `Last time you asked: ${data.history.at(-1).text}`, actions: [] }) }], { root: a.root, fresh: false });
  try {
    const history = await b.app.agent.history();
    assert.equal(history.running, null, 'no phantom running turn');
    assert.deepEqual(history.messages.map(m => [m.role, m.status]), [['user', undefined]], 'documents current behaviour: no marker for the interrupted turn');
    assert.equal((await b.say('hello?')).messages.at(-1).text, 'Last time you asked: question before the crash');
  } finally { await b.close(); }
});
