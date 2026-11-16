// U09: quality-preserving queues and autonomy.
//
// These tests drive the product's own task queue (plainhand/workflow.mjs) through
// the action registry. They cover batches, a process stop in the middle of a queue,
// per-item retry and cancel, the opt-in autonomy limits, and the claim that a
// packet prepared from a queue is the same packet a single run produces from the
// same state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { autonomyOf } from '../plainhand/standard.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';

const verifier = async () => ({
  state: 'active',
  legitimacy: 'official-ats-unconfirmed-employer',
  description: 'This is an engineering role designing and testing hardware. '.repeat(10),
  checkedAt: new Date().toISOString(),
  reason: 'Fixture verification.',
});
const renderer = async (workspace, state, job) => {
  const pdf = `output/test-${job.id}.pdf`;
  await workspace.write(pdf, 'test-pdf');
  return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] };
};

async function openApp(root, { agent = fixtureAgent, clock } = {}) {
  return createPlainhand({
    root,
    providers: fixtureProviders,
    startFeatures: false,
    workflowOptions: { agent, verifier, renderer, ...(clock ? { clock } : {}) },
  });
}

async function seed(app) {
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(latest => { latest.provider = 'codex'; });
}

const ui = (app, name, input) => app.registry.run(name, input, { actor: 'ui' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(label, probe, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(10);
  }
}

// Wait until no task is queued or running, including tasks another task enqueued
// (an auto-prepare). Resolves with the final state.
async function settle(app, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    await app.workflow.queue;
    const state = await app.workspace.load();
    if (!state.tasks.some(task => ['queued', 'running'].includes(task.status))) return state;
    if (Date.now() > deadline) throw new Error(`Tasks did not settle: ${state.tasks.filter(task => ['queued', 'running'].includes(task.status)).map(task => `${task.kind}:${task.status}`).join(', ')}`);
    await sleep(10);
  }
}

async function addJob(app, n) {
  const added = await ui(app, 'jobs.add', { company: 'Test Company', title: `Graduate Engineer ${n}`, url: `https://jobs.lever.co/test/u09-${n}` });
  return added.result.id;
}

async function evaluateAndSelect(app, jobId) {
  await ui(app, 'tasks.evaluate', { jobId });
  await settle(app);
  await ui(app, 'jobs.select', { jobId, selected: true });
}

function jobOf(state, id) { return state.jobs.find(job => job.id === id); }
function taskOf(state, id) { return state.tasks.find(task => task.id === id); }

// Timestamps and generated ids are the only fields a queue run may differ on.
const VOLATILE = new Set(['id', 'jobId', 'taskId', 'at', 'createdAt', 'updatedAt', 'finishedAt', 'generatedAt', 'startedAt', 'approvedAt', 'autoSelectedAt', 'checkedAt', 'gradedAt', 'contextHash', 'packetHash', 'pdfHash', 'approvedHash', 'packetJobHash', 'hash']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(key => !VOLATILE.has(key)).map(key => [key, canonical(value[key])]));
  }
  return value;
}

test('a batch of evaluate and prepare jobs completes in queue order with each task recorded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-batch-'));
  const calls = [];
  const agent = async (id, instruction, data, options) => {
    if (instruction.includes('Evaluate this')) calls.push(['evaluate', data.job.id]);
    if (instruction.includes('Prepare a')) calls.push(['prepare', data.job.id]);
    return fixtureAgent(id, instruction, data, options);
  };
  const app = await openApp(root, { agent });
  try {
    await seed(app);
    const [prepared, first, second] = [await addJob(app, 1), await addJob(app, 2), await addJob(app, 3)];
    await evaluateAndSelect(app, prepared);
    calls.length = 0;

    const batch = [];
    batch.push((await ui(app, 'tasks.evaluate', { jobId: first })).result.taskId);
    batch.push((await ui(app, 'tasks.evaluate', { jobId: second })).result.taskId);
    batch.push((await ui(app, 'tasks.prepare', { jobId: prepared })).result.taskId);
    // All three are in the queue before any of them is awaited.
    assert.equal((await app.workspace.load()).tasks.filter(task => batch.includes(task.id)).length, 3);

    const state = await settle(app);
    assert.deepEqual(calls, [['evaluate', first], ['evaluate', second], ['prepare', prepared]], 'the queue runs jobs in the order they were added, one at a time');
    for (const id of batch) {
      const task = taskOf(state, id);
      assert.equal(task.status, 'complete');
      assert.equal(task.message, 'Finished');
      assert.ok(task.finishedAt);
    }
    assert.equal(taskOf(state, batch[0]).kind, 'evaluate');
    assert.equal(taskOf(state, batch[2]).kind, 'prepare');
    assert.ok(jobOf(state, first).evaluation, 'the first evaluation is saved');
    assert.ok(jobOf(state, second).evaluation, 'the second evaluation is saved');
    const packetJob = jobOf(state, prepared);
    assert.ok(packetJob.packet, 'the prepare job produced a packet');
    assert.equal(packetJob.stage, 'packet-ready');
    assert.equal(packetJob.approvedHash, null, 'nothing is approved for the candidate');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a process stop mid-queue marks running and queued work interrupted; retry runs only the interrupted item', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-interrupt-'));
  let agentEntered;
  const agentStarted = new Promise(resolve => { agentEntered = resolve; });
  const never = () => { agentEntered(); return new Promise(() => {}); };
  const first = await openApp(root, { agent: never });
  let taskA, taskB, jobA, jobB;
  try {
    await seed(first);
    jobA = await addJob(first, 11);
    jobB = await addJob(first, 12);
    taskA = (await ui(first, 'tasks.evaluate', { jobId: jobA })).result.taskId;
    await agentStarted;
    assert.equal(taskOf(await first.workspace.load(), taskA).status, 'running');
    taskB = (await ui(first, 'tasks.evaluate', { jobId: jobB })).result.taskId;
    assert.equal(taskOf(await first.workspace.load(), taskB).status, 'queued');
  } finally {
    // Closing aborts the running controller; the fixture agent ignores it, which is a
    // process that stopped exactly where this one did.
    await first.close();
  }
  const afterClose = await first.workspace.load();
  assert.equal(taskOf(afterClose, taskA).status, 'running', 'the aborted call was inside the agent and has not written');
  assert.equal(taskOf(afterClose, taskB).status, 'queued', 'closing stops the queue instead of starting the next item');

  const second = await openApp(root);
  try {
    let state = await second.workspace.load();
    const interrupted = taskOf(state, taskA);
    const queuedInterrupted = taskOf(state, taskB);
    assert.equal(interrupted.status, 'interrupted', 'running work is never silently complete');
    assert.match(interrupted.message, /restarted/);
    assert.equal(queuedInterrupted.status, 'interrupted', 'queued-but-unstarted work is clearly marked, not run after restart');
    assert.match(queuedInterrupted.message, /before this task started/);
    assert.equal(jobOf(state, jobA).evaluation, undefined, 'no half-written evaluation is saved');
    assert.equal(jobOf(state, jobA).packet, undefined, 'no half-written packet is saved');
    assert.equal(jobOf(state, jobA).approvedHash ?? null, null);

    const retry = (await ui(second, 'tasks.evaluate', { jobId: jobA, retryOf: taskA })).result.taskId;
    state = await settle(second);
    assert.equal(taskOf(state, retry).status, 'complete', taskOf(state, retry).message);
    assert.equal(taskOf(state, retry).retryOf, taskA);
    assert.ok(jobOf(state, jobA).evaluation, 'the retried item completes');
    assert.equal(taskOf(state, taskB).status, 'interrupted', 'the untouched item keeps its state');
    assert.equal(state.tasks.filter(task => task.jobId === jobA && task.kind === 'evaluate').length, 2, 'history keeps the interrupted task and its one retry');
    assert.equal(state.tasks.filter(task => task.jobId === jobB).length, 1, 'nothing is duplicated for the queued item');
    assert.equal(state.jobs.length, 2);
  } finally {
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('retry of one failed item re-runs that item only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-retry-'));
  const attempts = new Map();
  const agent = async (id, instruction, data, options) => {
    if (instruction.includes('Evaluate this')) {
      const n = (attempts.get(data.job.id) || 0) + 1; attempts.set(data.job.id, n);
      if (n === 1 && data.job.title === 'Graduate Engineer 21') throw new Error('Synthetic provider failure');
    }
    return fixtureAgent(id, instruction, data, options);
  };
  const app = await openApp(root, { agent });
  try {
    await seed(app);
    const failing = await addJob(app, 21), healthy = await addJob(app, 22);
    const first = (await ui(app, 'tasks.evaluate', { jobId: failing })).result.taskId;
    const second = (await ui(app, 'tasks.evaluate', { jobId: healthy })).result.taskId;
    let state = await settle(app);
    assert.equal(taskOf(state, first).status, 'failed');
    assert.match(taskOf(state, first).message, /Synthetic provider failure/);
    assert.equal(taskOf(state, second).status, 'complete');
    assert.equal(attempts.get(healthy), 1);

    const retry = (await ui(app, 'tasks.evaluate', { jobId: failing, retryOf: first })).result.taskId;
    state = await settle(app);
    assert.equal(taskOf(state, retry).status, 'complete', taskOf(state, retry).message);
    assert.equal(attempts.get(failing), 2, 'only the failed role was called again');
    assert.equal(attempts.get(healthy), 1, 'the healthy role was not re-run');
    assert.equal(state.tasks.filter(task => task.jobId === healthy).length, 1);
    assert.equal(state.tasks.filter(task => task.jobId === failing).length, 2, 'failed task and its retry, no duplicate');
    assert.ok(jobOf(state, failing).evaluation);
    assert.ok(jobOf(state, healthy).evaluation);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('canceling a queued item removes it without touching the running one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-cancel-queued-'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const agent = async (id, instruction, data, options) => { entered(); await gate; return fixtureAgent(id, instruction, data, options); };
  const app = await openApp(root, { agent });
  try {
    await seed(app);
    const runningJob = await addJob(app, 31), queuedJob = await addJob(app, 32);
    const running = (await ui(app, 'tasks.evaluate', { jobId: runningJob })).result.taskId;
    await started;
    const queued = (await ui(app, 'tasks.evaluate', { jobId: queuedJob })).result.taskId;
    assert.equal(taskOf(await app.workspace.load(), queued).status, 'queued');

    await ui(app, 'tasks.cancel', { taskId: queued });
    let state = await app.workspace.load();
    assert.equal(taskOf(state, queued).status, 'canceled', 'the queued item is removed from the queue');
    assert.equal(taskOf(state, running).status, 'running', 'the running item is left running');

    release();
    state = await settle(app);
    assert.equal(taskOf(state, running).status, 'complete');
    assert.equal(taskOf(state, queued).status, 'canceled');
    assert.ok(jobOf(state, runningJob).evaluation, 'the running item still completes');
    assert.equal(jobOf(state, queuedJob).evaluation, undefined, 'the canceled item never ran');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('canceling a running prepare during its final check leaves no packet that can be approved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-cancel-running-'));
  // Two gates: the packet draft holds before its commit mutation starts, so a
  // second task can be queued behind it, then the final check holds so the cancel
  // lands inside the prepare's own mutation.
  let draftRelease, draftEntered;
  const draftGate = new Promise(resolve => { draftRelease = resolve; });
  const draftStarted = new Promise(resolve => { draftEntered = resolve; });
  const agent = async (id, instruction, data, options) => {
    if (instruction.includes('Prepare a')) { draftEntered(); await draftGate; }
    return fixtureAgent(id, instruction, data, options);
  };
  const app = await openApp(root, { agent });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const checkStarted = new Promise(resolve => { entered = resolve; });
  try {
    await seed(app);
    const preparing = await addJob(app, 41), other = await addJob(app, 42);
    await evaluateAndSelect(app, preparing);
    app.workflow.atsCheck = async () => { entered(); await gate; return { state: 'unavailable', checks: [], keywords: { covered: [], suggested: [], gaps: [] }, hint: 'held for cancellation', checkedAt: new Date().toISOString() }; };

    const task = (await ui(app, 'tasks.prepare', { jobId: preparing })).result.taskId;
    await draftStarted;
    const queued = (await ui(app, 'tasks.evaluate', { jobId: other })).result.taskId;
    assert.equal(taskOf(await app.workspace.load(), queued).status, 'queued', 'the second item is queued while the first runs');
    draftRelease();
    await checkStarted;
    const cancel = ui(app, 'tasks.cancel', { taskId: task });
    await waitFor('the abort request', () => app.workflow.controllers.get(task)?.signal.aborted);
    release();
    await cancel;
    const state = await settle(app);

    assert.equal(taskOf(state, task).status, 'canceled');
    const job = jobOf(state, preparing);
    assert.equal(job.packet, undefined, 'a canceled prepare leaves no packet');
    assert.equal(job.approvedHash, null);
    assert.notEqual(job.stage, 'packet-ready');
    assert.equal(await app.workspace.read(`output/packet-${preparing}.json`), '', 'no packet file is written after cancellation');
    await assert.rejects(ui(app, 'packet.approve', { jobId: preparing }), /regenerated/);
    assert.equal(taskOf(state, queued).status, 'complete', 'the queued item still runs after the cancel');
    assert.ok(jobOf(state, other).evaluation);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('autonomy is off by default and prepares only a strong match from an approved current master', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-autonomy-'));
  const app = await openApp(root);
  try {
    await seed(app);
    let state = await app.workspace.load();
    assert.equal(autonomyOf(state).enabled, false, 'autonomy is off unless the candidate turns it on');

    const beforeStandard = await addJob(app, 51);
    await ui(app, 'tasks.evaluate', { jobId: beforeStandard });
    state = await settle(app);
    assert.equal(jobOf(state, beforeStandard).autoSelectedAt, undefined, 'off by default: nothing is prepared');
    assert.equal(jobOf(state, beforeStandard).packet, undefined);

    await ui(app, 'tasks.standard', {});
    state = await settle(app);
    const unapproved = await addJob(app, 52);
    await ui(app, 'tasks.evaluate', { jobId: unapproved });
    state = await settle(app);
    assert.equal(jobOf(state, unapproved).autoSelectedAt, undefined, 'a master resume must be approved first');

    await ui(app, 'standard.approve', {});
    await ui(app, 'settings.autonomy', { enabled: true, perDay: 3, minScore: 5 });
    const tooLow = await addJob(app, 53);
    await ui(app, 'tasks.evaluate', { jobId: tooLow });
    state = await settle(app);
    assert.equal(jobOf(state, tooLow).autoSelectedAt, undefined, 'a below-minScore role is not prepared');
    assert.equal(jobOf(state, tooLow).packet, undefined);

    await ui(app, 'settings.autonomy', { enabled: true, perDay: 3, minScore: 4 });
    const strong = await addJob(app, 54);
    await ui(app, 'tasks.evaluate', { jobId: strong });
    state = await settle(app);
    const prepared = jobOf(state, strong);
    assert.ok(prepared.autoSelectedAt, 'a role at the threshold and above is prepared automatically');
    assert.ok(prepared.packet, 'the automatic prepare completed');
    assert.equal(prepared.approvedHash, null, 'the candidate still approves it');
    assert.equal(prepared.submittedAt, undefined, 'autonomy never submits');
    assert.ok(state.events.some(event => event.text.includes('Preparing Test Company')));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the daily limit refuses the next auto-prepare with a recorded reason and resets on the injected clock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-limit-'));
  let today = '2026-11-15T12:00:00.000Z';
  const app = await openApp(root, { clock: () => today });
  try {
    await seed(app);
    await ui(app, 'tasks.standard', {}); await settle(app);
    await ui(app, 'standard.approve', {});
    await ui(app, 'settings.autonomy', { enabled: true, perDay: 1, minScore: 4 });

    const first = await addJob(app, 61);
    await ui(app, 'tasks.evaluate', { jobId: first });
    let state = await settle(app);
    assert.ok(jobOf(state, first).autoSelectedAt.startsWith('2026-11-15'), 'the injected clock dates the automatic pick');
    assert.ok(jobOf(state, first).packet);

    const second = await addJob(app, 62);
    await ui(app, 'tasks.evaluate', { jobId: second });
    state = await settle(app);
    assert.equal(jobOf(state, second).autoSelectedAt, undefined, 'the (perDay+1)th role is refused');
    assert.equal(jobOf(state, second).packet, undefined);
    const refusal = state.events.find(event => event.text.includes('daily limit'));
    assert.ok(refusal, 'the refusal is recorded');
    assert.match(refusal.text, /1 of 1 today/);
    assert.match(refusal.text, /Test Company — Graduate Engineer 62/);

    today = '2026-11-16T00:01:00.000Z';
    const third = await addJob(app, 63);
    await ui(app, 'tasks.evaluate', { jobId: third });
    state = await settle(app);
    assert.ok(jobOf(state, third).autoSelectedAt.startsWith('2026-11-16'), 'the limit resets the next day');
    assert.ok(jobOf(state, third).packet);
    assert.equal(state.jobs.filter(job => job.submittedAt).length, 0, 'nothing was submitted');
    assert.ok(state.jobs.filter(job => job.packet).every(job => job.approvedHash === null), 'no automatic packet is approved');

    await ui(app, 'settings.autonomy', { enabled: false });
    today = '2026-11-17T00:01:00.000Z';
    const fourth = await addJob(app, 64);
    await ui(app, 'tasks.evaluate', { jobId: fourth });
    state = await settle(app);
    assert.equal(jobOf(state, fourth).autoSelectedAt, undefined, 'turning autonomy off stops further automatic prepares');
    assert.equal(jobOf(state, fourth).packet, undefined);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the packet from a queued batch is byte-identical to the packet from a single run on the same state', async () => {
  const seedRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-seed-'));
  const pairRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-pair-'));
  const singleRoot = path.join(pairRoot, 'single');
  const queuedRoot = path.join(pairRoot, 'queued');
  let seedApp, singleApp, queuedApp;
  try {
    seedApp = await openApp(seedRoot);
    await seed(seedApp);
    await ui(seedApp, 'tasks.standard', {});
    await settle(seedApp);
    await ui(seedApp, 'standard.approve', {});
    const ids = [];
    for (const n of [71, 72, 73]) ids.push(await addJob(seedApp, n));
    for (const id of ids) await evaluateAndSelect(seedApp, id);
    await seedApp.close(); seedApp = null;
    await cp(seedRoot, singleRoot, { recursive: true });
    await cp(seedRoot, queuedRoot, { recursive: true });

    singleApp = await openApp(singleRoot);
    await ui(singleApp, 'tasks.prepare', { jobId: ids[0] });
    const singleState = await settle(singleApp);
    const singlePacket = jobOf(singleState, ids[0]).packet;
    assert.ok(singlePacket);

    queuedApp = await openApp(queuedRoot);
    for (const id of [ids[1], ids[2], ids[0]]) await ui(queuedApp, 'tasks.prepare', { jobId: id });
    const queuedState = await settle(queuedApp);
    const queuedPacket = jobOf(queuedState, ids[0]).packet;
    assert.ok(queuedPacket);
    assert.equal(queuedState.tasks.filter(task => task.status === 'complete' && task.kind === 'prepare').length, 3, 'exactly the three queued prepares ran, none twice');

    const once = JSON.stringify(canonical(singlePacket));
    const batched = JSON.stringify(canonical(queuedPacket));
    assert.equal(batched, once, 'queueing must not change the resume, letter or evidence');
    assert.deepEqual(queuedPacket.resume, singlePacket.resume);
    assert.deepEqual(queuedPacket.answers, singlePacket.answers);
    assert.equal(queuedPacket.coverLetter, singlePacket.coverLetter);
    assert.deepEqual(jobOf(queuedState, ids[0]).fromStandard, jobOf(singleState, ids[0]).fromStandard);
  } finally {
    await seedApp?.close();
    await singleApp?.close();
    await queuedApp?.close();
    await rm(seedRoot, { recursive: true, force: true });
    await rm(pairRoot, { recursive: true, force: true });
  }
});
