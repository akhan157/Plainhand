import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { candidateLine, recordDecision, lineInput, markApplied, kindOf } from './plainhand/claim-line.mjs';
import { gradePacket, currentCalibration } from './plainhand/claim-calibration.mjs';
import { initialState } from './plainhand/store.mjs';
import { createPlainhand } from './plainhand-server.mjs';

const stretchedLead = id => ({ id, rating: 'stretched', text: 'Led the suspension sub-team.', suggestion: 'Coordinated the suspension sub-team.', signals: ['ownership-raised'] });

test('rule signals decide the kind; otherwise the reviewer’s kind', () => {
  assert.equal(kindOf({ signals: ['level-raised'], kind: 'scope' }), 'level');
  assert.equal(kindOf({ signals: [], kind: 'motivation' }), 'motivation');
  assert.equal(kindOf({ kind: 'nonsense' }), 'other');
});

test('a pattern needs two choices of the same kind, and later choices replace earlier ones', () => {
  const state = initialState();
  recordDecision(state, { jobId: 'a', claim: stretchedLead('resume:1'), decision: 'keep-mine' });
  assert.deepEqual(candidateLine(state).allowedStretches, ['rounding'], 'market norm only');
  recordDecision(state, { jobId: 'a', claim: stretchedLead('resume:1'), decision: 'use-suggestion' });
  assert.equal(state.claimLine.decisions.length, 1, 'one choice per job and claim');
  recordDecision(state, { jobId: 'b', claim: stretchedLead('resume:0'), decision: 'use-suggestion' });
  const line = candidateLine(state);
  assert.deepEqual(line.strict, ['ownership']);
  assert.ok(line.summary.some(s => /Holds ownership .* to the evidence/.test(s)));
});

test('allowed stretches sit within the line and leave the band; unsupported never does', () => {
  const state = initialState();
  for (const job of ['a', 'b']) recordDecision(state, { jobId: job, claim: stretchedLead('resume:0'), decision: 'keep-mine' });
  const line = candidateLine(state);
  assert.deepEqual(line.allowedStretches, ['ownership', 'rounding']);
  const source = 'I coordinated three sophomores on the suspension sub-team.';
  const packet = { resume: [
    { section: 'Projects', text: 'Led three sophomores on the suspension sub-team.', evidence: [{ sourceId: 'cv', quote: 'I coordinated three sophomores on the suspension sub-team' }] },
    { section: 'Projects', text: 'Managed a $50,000 budget.', evidence: [{ sourceId: 'cv', quote: 'I coordinated three sophomores' }] },
  ], answers: [], coverLetter: '' };
  const strict = gradePacket(packet, [{ id: 'cv', text: source }], [], null);
  const mine = gradePacket(packet, [{ id: 'cv', text: source }], [], line);
  assert.equal(strict.claims[0].withinLine, false);
  assert.equal(mine.claims[0].withinLine, true);
  assert.equal(mine.claims[0].rating, 'stretched', 'the rating stays honest');
  assert.equal(mine.claims[1].withinLine, false);
  assert.equal(mine.band, 'inflated', 'the invented budget still counts');
  assert.equal(mine.counts.withinLine, 1);
});

test('drafting input carries this job’s open choices; applied choices stay in the line', () => {
  const state = initialState();
  recordDecision(state, { jobId: 'a', claim: stretchedLead('resume:0'), decision: 'keep-mine', at: '2026-10-26T10:00:00.000Z' });
  assert.deepEqual(lineInput(state, 'a').decisions.map(d => d.decision), ['keep-mine']);
  markApplied(state, 'a', '2026-10-26T11:00:00.000Z');
  assert.deepEqual(lineInput(state, 'a').decisions, []);
  assert.equal(candidateLine(state).decisions, 1);
  assert.equal(lineInput(initialState(), 'a'), null, 'no line, nothing sent');
});

test('decide is candidate-only, refuses keeping an unsupported claim, and feeds the packet view', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-line-'));
  const app = await createPlainhand({ root });
  try {
    const calibration = gradePacket({ resume: [
      { section: 'Projects', text: 'Led the suspension sub-team.', evidence: [{ sourceId: 'cv', quote: 'I coordinated the suspension sub-team' }] },
      { section: 'Projects', text: 'Managed a $50,000 budget.', evidence: [{ sourceId: 'cv', quote: 'I coordinated the suspension sub-team' }] },
    ], answers: [], coverLetter: '' }, [{ id: 'cv', text: 'I coordinated the suspension sub-team.' }], [{ id: 'resume:0', rating: 'stretched', kind: 'ownership', reason: 'coordinated, not led', suggestion: 'Coordinated the suspension sub-team.' }]);
    await app.workspace.mutate(state => { state.jobs = [{ id: 'j1', company: 'Co', title: 'Engineer', calibration }]; });
    await assert.rejects(app.registry.run('calibration.decide', { jobId: 'j1', claimId: 'resume:0', decision: 'keep-mine' }, { actor: 'agent' }), error => error.code === 'candidate_only', 'the agent cannot make the choice');
    await assert.rejects(app.registry.run('calibration.decide', { jobId: 'j1', claimId: 'resume:0', decision: 'keep-mine' }, { actor: 'mcp' }), error => error.code === 'candidate_only');
    assert.equal((await app.workspace.load()).claimLine, undefined);
    await assert.rejects(app.registry.run('calibration.decide', { jobId: 'j1', claimId: 'resume:1', decision: 'keep-mine' }, { actor: 'ui' }), /can’t be kept/);
    await app.registry.run('calibration.decide', { jobId: 'j1', claimId: 'resume:0', decision: 'keep-mine' }, { actor: 'ui' });
    const state = await app.workspace.load();
    const view = currentCalibration(state, state.jobs[0]);
    assert.equal(view.claims[0].decision, 'keep-mine');
    assert.equal(view.claims[0].withinLine, true);
    const saved = await app.registry.run('line.addStatement', { text: 'I only say led if I made the calls.' }, { actor: 'ui' });
    assert.ok(saved.undoToken);
    assert.deepEqual((await app.registry.run('line.get', {}, { actor: 'agent' })).result.statements, ['I only say led if I made the calls.']);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('the market norm is the starting line: stated rounding allowed until the candidate chooses exact twice; verifiable never', () => {
  const state = initialState();
  const fresh = candidateLine(state);
  assert.deepEqual([fresh.allowedStretches, fresh.defaults], [['rounding'], ['rounding']]);
  assert.match(fresh.summary[0], /market norm/);
  const rounded = id => ({ id, rating: 'stretched', text: 'Cut weight about 20%.', suggestion: 'Cut weight 18%.', signals: ['number-rounded-stated'] });
  for (const job of ['a', 'b']) recordDecision(state, { jobId: job, claim: rounded('resume:0'), decision: 'use-suggestion' });
  assert.deepEqual(candidateLine(state).allowedStretches, []);
  assert.deepEqual(candidateLine(state).strict, ['rounding']);
  const bold = initialState();
  for (const job of ['a', 'b']) recordDecision(bold, { jobId: job, claim: { id: 'resume:0', rating: 'stretched', kind: 'verifiable', text: 'Senior engineer', signals: [] }, decision: 'keep-mine' });
  assert.ok(!candidateLine(bold).allowedStretches.includes('verifiable'));
});
