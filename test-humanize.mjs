import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTells, safeRewrite, applyHumanized, humanizeItems, HUMANIZE_INSTRUCTION } from './plainhand/humanize.mjs';

const packet = { resume: [{ section: 'Projects', text: 'Spearheaded a robust redesign — cut weight 18%.', evidence: [] }], coverLetter: 'I am thrilled to apply for the {role} role at {company}. It is not just a job, it is a mission.', answers: [{ question: 'Why us?', answer: 'Additionally, I want to delve into robotics.' }] };

test('the vendored humanizer rules ship in the instruction', () => {
  assert.match(HUMANIZE_INSTRUCTION, /Not X but Y/);
  assert.match(HUMANIZE_INSTRUCTION, /blader\/humanizer/);
  assert.match(HUMANIZE_INSTRUCTION, /\{company\} and \{role\}/);
});

test('tells: dashes, not-X-but-Y, stock AI words, chatbot residue', () => {
  assert.deepEqual(aiTells('Spearheaded a robust redesign — cut weight 18%.'), ['dash', 'word:robust', 'word:spearheaded']);
  assert.ok(aiTells('It is not just a job, but a mission.').includes('not-x-but-y'));
  assert.ok(aiTells('I hope this helps!').includes('chatbot'));
  assert.deepEqual(aiTells('Cut weight 18% in a SolidWorks redesign.'), []);
});

test('a rewrite may change wording only', () => {
  assert.equal(safeRewrite('Cut weight 18%.', 'Cut the weight by 18%.'), null);
  assert.equal(safeRewrite('Cut weight 18%.', 'Cut weight 20%.'), 'numbers changed');
  assert.equal(safeRewrite('Apply to {company}.', 'Apply to Acme.'), 'slots changed');
  assert.equal(safeRewrite('Short.', ''), 'empty');
});

test('humanized text replaces the original unless it changed facts', () => {
  const items = humanizeItems(packet);
  assert.deepEqual(items.map(i => i.id), ['resume:0', 'cover', 'answer:0']);
  const { packet: out, report } = applyHumanized(packet, { items: [
    { id: 'resume:0', text: 'Redesigned the part and cut its weight 18%.' },
    { id: 'cover', text: 'I want the {role} role at {company} because I build test rigs.' },
    { id: 'answer:0', text: 'I want to work on robotics for 3 years.' },
  ], remaining: ['kept one dash in a title'] });
  assert.equal(out.resume[0].text, 'Redesigned the part and cut its weight 18%.');
  assert.match(out.coverLetter, /\{company\}/);
  assert.equal(out.answers[0].answer, packet.answers[0].answer, 'an invented number keeps the original');
  assert.deepEqual(report.kept, [{ id: 'answer:0', reason: 'numbers changed' }]);
  assert.equal(report.changed, 2);
  assert.ok(report.tellsBefore >= 6);
  assert.deepEqual(report.tellsAfter, ['word:additionally', 'word:delve']);
  assert.deepEqual(report.remaining, ['kept one dash in a title']);
  assert.equal(packet.resume[0].text, 'Spearheaded a robust redesign — cut weight 18%.', 'the input is not mutated');
});
