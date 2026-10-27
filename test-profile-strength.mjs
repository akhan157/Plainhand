import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { profileStrength, recurringGaps, logUnderstanding } from './plainhand/profile-strength.mjs';
import { initialState } from './plainhand/store.mjs';
import { createPlainhand } from './plainhand-server.mjs';

const story = (n, extra = '') => ({ role: 'user', text: `Story ${n}: I led a team of four students to redesign the cooling bracket for our rig, ran the thermal tests myself and wrote the report the sponsor used. ${extra}` });
const evaluated = (id, matches, gaps, sourceId = 'cv') => ({ id, company: `Co ${id}`, title: 'Engineer', evaluation: { matches: Array.from({ length: matches }, () => ({ text: 'fit', evidence: [{ sourceId, quote: 'quote text' }] })), gaps } });

test('an empty workspace is thin with not-enough-data where nothing can be counted', () => {
  const s = profileStrength(initialState());
  assert.equal(s.foundation.level, 'thin');
  assert.equal(s.depth.statements, 0);
  assert.equal(s.coverage.level, 'not-enough-data');
  assert.equal(s.review.level, 'not-enough-data');
  assert.ok(s.next.some(n => n.kind === 'foundation'));
  assert.ok(s.next.some(n => n.kind === 'depth'));
  assert.ok(s.next.length <= 4);
});

test('story depth counts the candidate’s own detailed statements and numbers', () => {
  const state = initialState();
  state.conversation = [story(1, 'Cut warm-up time by 30%.'), story(2, 'Saved $2,000.'), story(3), { role: 'assistant', text: 'What else did you do on that project with your team?' }, { role: 'user', text: 'ok' }];
  const d = profileStrength(state).depth;
  assert.equal(d.statements, 3, 'assistant turns and one-word replies are not stories');
  assert.equal(d.withNumbers, 3, 'story numbers count');
  assert.ok(d.words >= 90 && d.words <= 110, String(d.words));
  assert.equal(d.level, 'good', 'three stories with enough words');
  assert.ok(!profileStrength(state).foundation.missing.includes('the story your resume doesn’t tell'), 'stories told in conversation fill the story');
});

test('coverage needs three evaluated roles and finds gaps that recur across roles', () => {
  const state = initialState();
  state.jobs = [evaluated('a', 3, ['No production GD&T experience shown']), evaluated('b', 1, ['GD&T experience in production not shown', 'No security clearance'])];
  assert.equal(profileStrength(state).coverage.level, 'not-enough-data');
  state.jobs.push(evaluated('c', 4, [], 'interview'));
  const c = profileStrength(state).coverage;
  assert.equal(c.evaluated, 3);
  assert.equal(c.average, Math.round((0.75 + 1 / 3 + 1) / 3 * 100) / 100);
  assert.equal(c.storyEvidenceShare, 0.5, '4 of 8 quotes come from the interview');
  assert.deepEqual(c.recurringGaps.map(g => g.roles), [2]);
  assert.match(c.recurringGaps[0].text, /GD&T/);
});

test('a gap repeated within one role is not recurring', () => {
  assert.deepEqual(recurringGaps([evaluated('a', 1, ['No CAD portfolio', 'CAD portfolio missing'])]), []);
});

test('review tracks approvals and whether open questions shrink', () => {
  const state = initialState();
  logUnderstanding(state, { event: 'built', questions: 3, gaps: 2 });
  logUnderstanding(state, { event: 'built', questions: 1, gaps: 0 });
  logUnderstanding(state, { event: 'approved' });
  state.understanding = { approved: true, result: { questions: ['Which CAD tools?'], gaps: [] } };
  const r = profileStrength(state).review;
  assert.deepEqual([r.built, r.approved, r.approvalRate, r.openQuestions, r.openQuestionsBefore], [2, 1, 0.5, 1, 5]);
  assert.equal(r.level, 'strong');
  assert.ok(profileStrength(state).next.some(n => n.text === 'Open question: Which CAD tools?' && n.fromModel), 'model-written questions are marked so the digest leaves them out');
});

test('the read action taints the turn when it returns posting-derived gaps; the digest leaves them out', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-strength-'));
  const app = await createPlainhand({ root });
  try {
    await app.workspace.mutate(state => { state.jobs = [evaluated('a', 1, ['No production GD&T experience shown']), evaluated('b', 1, ['Production GD&T experience not shown'])]; });
    const run = await app.registry.run('profile.strength', {}, { actor: 'agent' });
    assert.equal(run.result.coverage.recurringGaps.length, 1);
    assert.equal(run.taintSources.length, 1);
    const digest = app.registry.digest(await app.workspace.load());
    assert.ok(Array.isArray(digest.profile.next));
    assert.ok(!digest.profile.next.some(text => /GD&T/.test(text)), 'posting-derived text stays out of the always-sent digest');
  } finally {
    await app.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
