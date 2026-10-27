import test from 'node:test';
import assert from 'node:assert/strict';
import { personas, simulatedCandidate, captured, scoreRun } from './plainhand/benchmarks/profile-bench.mjs';

const persona = personas.find(p => p.id === 'mech-grad');

test('the simulated candidate answers the best-matching fact once, and says "haven’t" for what it lacks', () => {
  const c = simulatedCandidate(persona);
  assert.equal(c.reply('What project are you proudest of?').factId, 'fsae');
  assert.equal(c.reply('Any experience with GD&T in production?').factId, 'gdt');
  assert.notEqual(c.reply('What project are you proudest of?').factId, 'fsae', 'a fact is not repeated');
  assert.equal(c.reply('Thanks, that helps.').onTopic, false);
});

test('keywords match at a word start only', () => {
  const junior = personas.find(p => p.id === 'quiet-junior');
  assert.equal(simulatedCandidate(junior).reply('That sounds great. Tell me more?').onTopic, false);
});

test('a fact counts as captured only when most of its content is saved', () => {
  const fact = persona.facts[0];
  assert.ok(captured(fact, [fact.text]));
  assert.ok(captured(fact, ['Note: ' + fact.text]));
  assert.ok(!captured(fact, ['I did Formula SAE.']));
});

test('scoring flags paraphrased saves, unsupported updates and absent claims', () => {
  const fact = persona.facts[0];
  const result = scoreRun({
    persona,
    candidateMessages: ['Help me build my profile.', fact.text, persona.absent[0].text],
    saved: [fact.text, 'Riley led production GD&T for a manufacturing line.'],
    updates: [{ field: 'roles', value: 'Design engineer' }, { field: 'constraints', value: 'Wants relocation package and equity' }],
    turns: [{ say: 'What are you proud of?', onTopic: true }, { say: 'Great. Any GD&T? And what else?', onTopic: true }, { say: 'Thanks.', onTopic: false }],
    revealed: new Set(['fsae', 'gdt']),
  });
  assert.equal(result.captured, 1);
  assert.equal(result.captureRate, 1);
  assert.equal(result.notVerbatim, 1, 'the invented GD&T line is not the candidate’s words');
  assert.deepEqual(result.unsupportedUpdates, ['constraints: Wants relocation package and equity']);
  assert.deepEqual(result.absentClaimsSaved, ['gdt']);
  assert.deepEqual([result.turns, result.turnsAsking, result.oneQuestionTurns, result.onTopicQuestions], [3, 2, 1, 2]);
});

test('a follow-up about the story just told gets its detail; an offer without a question gets one yes', () => {
  const c = simulatedCandidate(persona);
  c.reply('What project are you proudest of?');
  const follow = c.reply('Nice. What made the upright redesign necessary, and how did you cut the weight?');
  assert.equal(follow.detail, true);
  assert.equal(follow.text, persona.facts[0].detail);
  assert.ok(c.detailed.has('fsae'));
  assert.equal(c.reply('Shall I rebuild your understanding now.').agreed, true);
  assert.equal(c.reply('Okay.').done, true);
});

test('details captured are scored separately from facts', () => {
  const fact = persona.facts[0];
  const result = scoreRun({ persona, candidateMessages: [fact.text, fact.detail], saved: [fact.text, fact.detail], updates: [], turns: [], revealed: new Set(['fsae']), detailsRevealed: new Set(['fsae']) });
  assert.deepEqual([result.captured, result.followUps, result.detailsCaptured], [1, 1, 1]);
});

test('a fact saved as a profile field update counts as captured', () => {
  const voice = persona.facts.find(f => f.id === 'voice');
  const result = scoreRun({ persona, candidateMessages: [voice.text], saved: [], updates: [{ field: 'voice', value: voice.text }], turns: [], revealed: new Set(['voice']) });
  assert.equal(result.captured, 1);
  assert.deepEqual(result.unsupportedUpdates, []);
});
