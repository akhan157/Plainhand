import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from './plainhand-server.mjs';
import { BUDGET } from './plainhand/agent.mjs';
import { digest } from './plainhand/store.mjs';
import { candidate, fixtureProviders, scriptedAgent } from './plainhand/test-fixtures.mjs';

async function harness(steps, { provider = 'codex' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-agent-'));
  const agent = scriptedAgent(steps);
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture browser verification.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (endpoint, input) => {
    const response = await fetch(base + '/api/' + endpoint, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const state = (await request('state')).data;
  await request('profile', { profile: candidate, revision: state.revision });
  if (provider) await request('provider', { id: provider });
  const events = [];
  const original = app.agent.emit;
  app.agent.emit = (event, data) => { events.push({ event, data }); original(event, data); };
  const jobId = (await app.registry.run('jobs.add', { company: 'Acme Robotics', title: 'Graduate Engineer', url: 'https://jobs.lever.co/acme/1' })).result.id;
  const say = async text => { const { turnId } = await app.agent.message(text); await app.agent.running; return { turnId, messages: (await app.agent.history()).messages.filter(m => m.turnId === turnId) }; };
  const job = async () => (await app.workspace.load()).jobs.find(j => j.id === jobId);
  return { app, agent, request, events, jobId, say, job, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a question answered from the digest takes one model call and changes nothing', async () => {
  const h = await harness([{ match: /due this week/, reply: data => ({ say: `You have ${data.digest.followUps.length} follow-ups.`, actions: [] }) }]);
  try {
    const before = await h.job();
    const { turnId, messages } = await h.say("What's due this week?");
    assert.deepEqual(messages.map(m => [m.role, m.text]), [['user', "What's due this week?"], ['assistant', 'You have 0 follow-ups.']]);
    assert.equal(h.agent.calls.length, 1);
    assert.ok(h.agent.calls[0].actions.includes('ui.openPanel') && h.agent.calls[0].actions.includes('record.setNextAction'));
    assert.deepEqual(await h.job(), before);
    assert.deepEqual(h.events.filter(e => e.data.turnId === turnId).map(e => e.event), ['agent.message', 'agent.turn', 'agent.message', 'agent.done']);
    const usage = await h.app.workflow.usage.records();
    assert.equal(usage[0].purpose, 'agent', 'agent calls are metered like every other provider call');
  } finally { await h.close(); }
});

test('reads run immediately and their results reach the next call', async () => {
  const h = await harness([
    { reply: data => ({ say: '', actions: [{ name: 'jobs.get', input: { jobId: data.digest.jobs[0].id } }] }) },
    { reply: data => ({ say: `It is ${JSON.parse(data.results[0].result).company}.`, actions: [] }) },
  ]);
  try {
    const { messages } = await h.say('Which company is this?');
    assert.equal(messages.at(-1).text, 'It is Acme Robotics.');
    assert.equal(h.agent.calls.length, 2);
    assert.equal(h.agent.calls[1].results[0].name, 'jobs.get');
  } finally { await h.close(); }
});

test('"Dana wants references Friday" becomes one grouped proposal that saves on accept and undoes', async () => {
  const h = await harness([{ match: /Dana/, reply: data => {
    const jobId = data.digest.jobs[0].id;
    return { say: 'I can log the screen, add Dana and set a reminder for Friday.', actions: [
      { name: 'record.addInterview', input: { jobId, stage: 'Recruiter screen', date: '2026-10-24', status: 'completed', interviewer: 'Dana Lee' } },
      { name: 'record.addContact', input: { jobId, name: 'Dana Lee', role: 'Recruiter' } },
      { name: 'record.setNextAction', input: { jobId, text: 'Send references to Dana', due: '2026-10-30' } },
    ] };
  } }]);
  try {
    const { messages } = await h.say('Had the screen with Dana, went well, she wants references Friday.');
    const reply = messages.at(-1);
    assert.equal(reply.status, 'needs-confirmation');
    assert.equal((await h.job()).record, undefined, 'nothing is saved before confirmation');
    const { proposals } = await h.app.agent.history();
    const proposal = proposals.find(p => p.id === reply.proposalId);
    assert.deepEqual(proposal.actions.map(a => a.summary), ['Add Recruiter screen interview on 2026-10-24', 'Add contact Dana Lee (Recruiter)', 'Next action: Send references to Dana, due 2026-10-30']);
    assert.equal(proposal.tainted, false);

    const confirmed = await h.app.agent.confirm({ proposalId: proposal.id, accept: true });
    assert.equal(confirmed.ok, true);
    let record = (await h.job()).record;
    assert.equal(record.interviews[0].stage, 'Recruiter screen');
    assert.equal(record.contacts[0].name, 'Dana Lee');
    assert.equal(record.nextAction.text, 'Send references to Dana');
    assert.equal((await h.job()).status, undefined, 'logging an interview never changes the status');
    await assert.rejects(h.app.agent.confirm({ proposalId: proposal.id, accept: true }), /already handled/);

    await h.app.agent.undo(confirmed.undoToken);
    assert.equal((await h.app.agent.history()).proposals.find(p => p.id === proposal.id).undone, true, 'the undo survives a reload');
    record = (await h.job()).record;
    assert.deepEqual([record.interviews.length, record.contacts.length, record.nextAction], [0, 0, null]);
    const audit = (await h.app.registry.run('audit.list', {})).result.map(e => e.action);
    assert.equal(audit.filter(a => a === 'agent-write').length, 3);
    assert.equal(audit.filter(a => a === 'ui-undo').length, 3);
  } finally { await h.close(); }
});

test('declining, editing and partial failure are all explicit', async () => {
  const h = await harness([
    { match: /remind/, reply: data => ({ say: 'Shall I set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Follow up', due: '2026-11-01' } }] }) },
    { match: /again/, reply: data => ({ say: 'Shall I set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Follow up', due: '2026-11-01' } }] }) },
    { match: /two things/, reply: data => ({ say: 'Two changes.', actions: [
      { name: 'record.removeContact', input: { jobId: data.digest.jobs[0].id, entryId: 'missing' } },
      { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Never reached' } },
    ] }) },
  ]);
  try {
    let { messages } = await h.say('remind me to follow up');
    await h.app.agent.confirm({ proposalId: messages.at(-1).proposalId, accept: false });
    assert.equal((await h.job()).record, undefined);
    assert.equal((await h.app.agent.history()).messages.at(-1).text, 'Okay, nothing was changed.');

    ({ messages } = await h.say('remind me again'));
    await h.app.agent.confirm({ proposalId: messages.at(-1).proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'Follow up by email', due: '2026-11-02' } } });
    assert.deepEqual([(await h.job()).record.nextAction.text, (await h.job()).record.nextAction.due], ['Follow up by email', '2026-11-02']);

    ({ messages } = await h.say('do two things'));
    const result = await h.app.agent.confirm({ proposalId: messages.at(-1).proposalId, accept: true });
    assert.equal(result.ok, false);
    assert.deepEqual(result.results.map(r => r.ok), [false], 'the group stops at the first failure');
    assert.equal(result.retryable, true);
    assert.equal((await h.job()).record.nextAction.text, 'Follow up by email');
    assert.match((await h.app.agent.history()).messages.at(-1).text, /^Nothing was saved: Contact not found/);
  } finally { await h.close(); }
});

test('candidate-only actions are never run; the agent opens the panel instead', async () => {
  const h = await harness([{ reply: data => ({ say: 'Approve it in the packet panel.', actions: [{ name: 'packet.approve', input: { jobId: data.digest.jobs[0].id } }, { name: 'jobs.confirmSubmitted', input: { jobId: data.digest.jobs[0].id } }] }) }]);
  try {
    const { turnId, messages } = await h.say('approve and submit it for me');
    assert.equal(messages.at(-1).status, 'complete');
    assert.equal((await h.job()).submittedAt, undefined);
    assert.equal((await h.job()).approvedHash, undefined);
    assert.deepEqual(h.events.find(e => e.event === 'agent.panel' && e.data.turnId === turnId).data.panel, { type: 'packet', id: h.jobId });
    assert.equal((await h.app.agent.history()).proposals.length, 0, 'no proposal can carry a candidate-only action');
  } finally { await h.close(); }
});

test('a task is proposed alone, then queued on confirmation', async () => {
  const h = await harness([{ reply: data => ({ say: 'I can evaluate it and save a note.', actions: [
    { name: 'tasks.evaluate', input: { jobId: data.digest.jobs[0].id } },
    { name: 'tasks.discover', input: {} },
  ] }) }]);
  try {
    const { messages } = await h.say('evaluate the Acme role');
    const proposal = (await h.app.agent.history()).proposals[0];
    assert.deepEqual(proposal.actions.map(a => a.name), ['tasks.evaluate'], 'one task per proposal');
    assert.equal((await h.app.workspace.load()).tasks.length, 0);
    await h.app.agent.confirm({ proposalId: messages.at(-1).proposalId, accept: true });
    await h.app.workflow.queue;
    const tasks = (await h.app.workspace.load()).tasks;
    assert.deepEqual(tasks.map(t => [t.kind, t.status]), [['evaluate', 'complete']]);
    assert.equal(h.events.find(e => e.event === 'agent.task').data.kind, 'evaluate');
  } finally { await h.close(); }
});

test('writes win over a task in the same reply', async () => {
  const h = await harness([{ reply: data => ({ say: 'Two things.', actions: [
    { name: 'tasks.evaluate', input: { jobId: data.digest.jobs[0].id } },
    { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Read the posting' } },
  ] }) }]);
  try {
    await h.say('note it and evaluate');
    assert.deepEqual((await h.app.agent.history()).proposals[0].actions.map(a => a.name), ['record.setNextAction']);
  } finally { await h.close(); }
});

test('a malformed reply gets one repair attempt; a second failure ends the turn', async () => {
  const ok = await harness([{ reply: { say: 42 } }, { reply: { say: 'Fixed.', actions: [] } }]);
  try {
    const { messages } = await ok.say('hello');
    assert.equal(messages.at(-1).text, 'Fixed.');
    assert.match(ok.agent.calls[1].repair, /"say" must be text/);
  } finally { await ok.close(); }
  const bad = await harness([{ reply: { actions: 'nope' } }, { reply: ['still', 'wrong'] }]);
  try {
    const { messages } = await bad.say('hello');
    assert.equal(messages.at(-1).status, 'failed');
    assert.match(messages.at(-1).text, /could not finish/);
  } finally { await bad.close(); }
});

test('unknown actions and invalid inputs are reported back, never executed', async () => {
  const h = await harness([
    { reply: data => ({ say: '', actions: [{ name: 'jobs.delete', input: {} }, { name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, due: 'Friday' } }, { name: 'jobs.list', input: { bogus: true } }] }) },
    { reply: { say: 'Sorry, I could not do that.', actions: [] } },
  ]);
  try {
    await h.say('delete everything');
    assert.deepEqual(h.agent.calls[1].results.map(r => [r.name, Boolean(r.error)]), [['jobs.delete', true], ['record.setNextAction', true], ['jobs.list', true]]);
    assert.equal((await h.app.agent.history()).proposals.length, 0);
    assert.equal((await h.job()).record, undefined);
  } finally { await h.close(); }
});

test('the call budget stops a reply that keeps reading', async () => {
  const h = await harness(Array.from({ length: BUDGET.calls + 2 }, () => ({ reply: { say: '', actions: [{ name: 'workspace.digest', input: {} }] } })));
  try {
    const { messages } = await h.say('keep looking');
    assert.equal(h.agent.calls.length, BUDGET.calls);
    assert.equal(messages.at(-1).status, 'budget');
  } finally { await h.close(); }
});

test('one reply at a time, and cancellation leaves nothing changed', async () => {
  let release;
  const h = await harness([{ wait: signal => new Promise((resolve, reject) => { release = resolve; signal?.addEventListener('abort', () => reject(new Error('aborted'))); }), reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'x' } }] }) }]);
  try {
    const { turnId } = await h.app.agent.message('first');
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(h.app.agent.message('second'), /Wait for the current reply/);
    assert.equal((await h.request('state')).data.agent.running, turnId);
    assert.deepEqual(h.app.agent.cancel(turnId), { ok: true });
    await h.app.agent.running;
    const last = (await h.app.agent.history()).messages.at(-1);
    assert.equal(last.status, 'canceled');
    assert.equal((await h.app.agent.history()).proposals.length, 0);
    assert.equal((await h.request('state')).data.agent.running, null);
  } finally { await h.close(); }
});

test('without a connected provider the agent explains instead of failing silently', async () => {
  const h = await harness([], { provider: null });
  try {
    await assert.rejects(h.app.agent.message('hi'), /Connect an AI account/);
    assert.equal((await h.request('state')).data.agent.available, false);
    assert.equal((await h.request('agent/message', { text: 'hi' })).data.code, 'no_provider');
    assert.equal((await h.app.agent.history()).messages.length, 0);
  } finally { await h.close(); }
});

test('a proposal made after reading posting text is flagged with its untrusted source', async () => {
  const h = await harness([
    { reply: data => ({ say: '', actions: [{ name: 'jobs.get', input: { jobId: data.digest.jobs[0].id, include: ['description'] } }] }) },
    { reply: data => ({ say: 'Shall I note it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Ask about the role' } }] }) },
  ]);
  try {
    await h.say('read the posting and note a follow-up');
    const proposal = (await h.app.agent.history()).proposals[0];
    assert.equal(proposal.tainted, true);
    assert.deepEqual(proposal.taintSources, [{ kind: 'job', id: h.jobId, label: 'Acme Robotics — Graduate Engineer' }]);
  } finally { await h.close(); }
});

test('the HTTP surface: message, history, confirm, undo and clear', async () => {
  const h = await harness([{ reply: data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Call back' } }] }) }]);
  try {
    assert.equal((await h.request('state')).data.agent.available, true);
    const sent = await h.request('agent/message', { text: 'remind me to call back' });
    assert.equal(sent.status, 202);
    await h.app.agent.running;
    const history = (await h.request('agent/history')).data;
    assert.equal(history.messages.length, 2);
    const confirmed = await h.request('agent/confirm', { proposalId: history.proposals[0].id, accept: true });
    assert.equal(confirmed.data.ok, true);
    assert.equal((await h.request('agent/undo', { undoToken: confirmed.data.undoToken })).status, 200);
    assert.equal((await h.job()).record.nextAction, null);
    assert.equal((await h.request('agent/message', { text: '  ' })).data.code, 'invalid_input');
    assert.equal((await h.request('agent/clear', {})).status, 200);
    assert.equal((await h.request('agent/history')).data.messages.length, 0);
  } finally { await h.close(); }
});

test('review fixes: single-flight confirm, no partial budgets, honest audit, storage never erased', async () => {
  const jobInput = data => ({ jobId: data.digest.jobs[0].id });
  const h = await harness([
    { match: /contact/, reply: data => ({ say: 'Add Dana?', actions: [{ name: 'record.addContact', input: { ...jobInput(data), name: 'Dana Lee' } }] }) },
    { match: /many/, reply: { say: '', actions: Array.from({ length: BUDGET.actions - 2 }, () => ({ name: 'workspace.digest', input: {} })) } },
    { match: /many/, reply: data => ({ say: 'Three changes.', actions: ['a', 'b', 'c'].map(text => ({ name: 'record.setNextAction', input: { ...jobInput(data), text } })) }) },
    { match: /edit/, reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { ...jobInput(data), text: 'Original' } }] }) },
  ]);
  try {
    let { messages } = await h.say('add the contact');
    const proposalId = messages.at(-1).proposalId;
    const both = await Promise.allSettled([h.app.agent.confirm({ proposalId, accept: true }), h.app.agent.confirm({ proposalId, accept: true })]);
    assert.deepEqual(both.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal((await h.job()).record.contacts.length, 1, 'a double click applies the proposal once');

    ({ messages } = await h.say('do many things'));
    assert.equal(messages.at(-1).status, 'budget');
    assert.equal((await h.app.agent.history()).proposals.filter(p => p.turnId === messages[0].turnId).length, 0, 'an over-budget reply is not proposed in part');

    ({ messages } = await h.say('edit then save'));
    await h.app.agent.confirm({ proposalId: messages.at(-1).proposalId, accept: true, edits: { 0: { jobId: h.jobId, text: 'Edited text' } } });
    const audit = (await h.app.registry.run('audit.list', {})).result;
    assert.match(audit[0].reason, /Next action: Edited text \(edited by the candidate\)/);

    await h.app.workspace.write('data/plainhand/agent-proposals.json', '{not json');
    await assert.rejects(h.app.agent.history(), /unreadable/);
    assert.equal(await h.app.workspace.read('data/plainhand/agent-proposals.json'), '{not json', 'a corrupt file is reported, not overwritten');
  } finally { await h.close(); }
});

test('a cancel that arrives with the reply still cancels, and shutdown mid-turn does not crash', async () => {
  let resolveReply;
  const h = await harness([{ wait: () => new Promise(resolve => { resolveReply = resolve; }), reply: data => ({ say: 'Set?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'late' } }] }) }]);
  const { turnId } = await h.app.agent.message('set something');
  while (!resolveReply) await new Promise(resolve => setTimeout(resolve, 5));
  h.app.agent.cancel(turnId); // the provider ignores the signal and answers anyway
  resolveReply();
  await h.app.agent.running;
  assert.equal((await h.app.agent.history()).messages.at(-1).status, 'canceled');
  assert.equal((await h.app.agent.history()).proposals.length, 0);
  await h.close();

  let crashed = null;
  const onError = error => { crashed = error; };
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  try {
    const s = await harness([{ wait: signal => new Promise((resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))), reply: { say: 'never' } }]);
    const response = await fetch(`http://127.0.0.1:${s.app.server.address().port}/api/events?token=${s.app.token}`);
    const reader = response.body.getReader();
    await reader.read();
    await s.app.agent.message('long question');
    await s.app.close();
    await s.app.agent.running; // let the canceled turn finish writing before the folder is removed
    await s.close().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(crashed, null, String(crashed?.stack || crashed));
  } finally { process.off('uncaughtException', onError); process.off('unhandledRejection', onError); }
});

test('exports include the conversation and proposals, never the MCP secret', async () => {
  const h = await harness([{ reply: data => ({ say: 'Set it?', actions: [{ name: 'record.setNextAction', input: { jobId: data.digest.jobs[0].id, text: 'Export me' } }] }) }]);
  try {
    await h.say('remind me');
    const exported = (await h.request('export')).data;
    assert.deepEqual(exported.agentConversation.map(m => m.role), ['user', 'assistant']);
    assert.equal(exported.agentProposals[0].actions[0].input.text, 'Export me');
    const { readFile } = await import('node:fs/promises');
    let secret;
    for (let i = 0; i < 100 && !secret; i++) { try { secret = JSON.parse(await readFile(path.join(h.app.workspace.root, 'data/plainhand/local-api.json'), 'utf8')).mcpToken; } catch { await new Promise(r => setTimeout(r, 10)); } }
    assert.ok(secret);
    assert.ok(!JSON.stringify(exported).includes(secret), 'the MCP secret is never exported');
    assert.ok(!JSON.stringify(exported).includes(h.app.token), 'nor the session token');
  } finally { await h.close(); }
});
