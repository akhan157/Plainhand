import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTells, safeRewrite, applyHumanized, humanizeItems, HUMANIZE_INSTRUCTION } from '../plainhand/humanize.mjs';
import { voiceTargetOf, REGISTER_PHRASES } from '../plainhand/voice-target.mjs';
import { PACKET_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';

const FORMAL_SAMPLES = [
  { title: 'Status note', text: 'I am writing to provide a comprehensive update regarding the test campaign, and I would like to explain the methodology that was applied throughout the process. Furthermore, the results obtained thus far are approximately consistent with the initial predictions.' },
  { title: 'Follow-up', text: 'Please find the relevant documentation attached for your consideration, and do not hesitate to contact me at your earliest convenience should any further information be required.' },
];
const FORMAL_DRAFT = 'I am writing to apply for the {role} role at {company}. Furthermore, my design and testing experience would let me contribute to your programme, and I would welcome the opportunity to discuss it with you at your earliest convenience.';
const PLAIN_REWRITE = 'I want the {role} role at {company}. I design and test things. I would like to talk about it.';
const FORMAL_REWRITE = 'I am writing to apply for the {role} role at {company}. Furthermore, my design and testing experience could help me contribute to your programme, and I would welcome the opportunity to discuss it with you at your earliest convenience.';

const packet = { resume: [{ section: 'Projects', text: 'Spearheaded a robust redesign — cut weight 18%.', evidence: [] }], coverLetter: 'I am thrilled to apply for the {role} role at {company}. It is not just a job, it is a mission.', answers: [{ question: 'Why us?', answer: 'Additionally, I want to delve into robotics.' }] };

test('the vendored humanizer rules ship in the instruction', () => {
  assert.match(HUMANIZE_INSTRUCTION, /Not X but Y/);
  assert.match(HUMANIZE_INSTRUCTION, /blader\/humanizer/);
  assert.match(HUMANIZE_INSTRUCTION, /\{company\} and \{role\}/);
});

test('the humanizer matches INPUT.voiceTarget without treating formal writing as stock', () => {
  assert.match(HUMANIZE_INSTRUCTION, /When INPUT\.voiceTarget is present, match it: sentence length near sentenceLength, contractions as contractions says, and that register/);
  assert.match(HUMANIZE_INSTRUCTION, /formal is not stock, and "I am writing to apply" stays/);
  assert.match(HUMANIZE_INSTRUCTION, /never force short sentences or an informal register/);
  assert.match(HUMANIZE_INSTRUCTION, /resume entries stay resume lines/);
});

test('the candidate’s own register phrases are reported, and none is an AI tell', () => {
  const target = voiceTargetOf(FORMAL_SAMPLES);
  const phrases = new Map(target.registerPhrases.map(item => [item.phrase, item]));
  for (const phrase of ['furthermore', 'regarding', 'approximately', 'please find', 'i am writing']) {
    assert.equal(phrases.get(phrase)?.register, 'formal', `the samples' own "${phrase}" is reported`);
    assert.ok(phrases.get(phrase).per100 > 0, 'each phrase carries its rate per 100 words');
  }
  for (const [phrase] of REGISTER_PHRASES) assert.deepEqual(aiTells(phrase), [], `"${phrase}" is style, never a tell`);
  assert.match(HUMANIZE_INSTRUCTION, /registerPhrases .*are the candidate's own voice, not AI tells/);
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) {
    assert.match(instruction, /INPUT\.voiceTarget\.registerPhrases/);
    assert.match(instruction, /use those phrases, and only those/);
  }
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

test('a humanized letter that shortens a formal voice below the samples keeps the draft', () => {
  const voiceTarget = voiceTargetOf(FORMAL_SAMPLES);
  assert.equal(voiceTarget.register, 'formal');
  assert.equal(voiceTarget.contractions, 'avoid');
  const { packet: out, report } = applyHumanized({ resume: [], coverLetter: FORMAL_DRAFT, answers: [] }, { items: [{ id: 'cover', text: PLAIN_REWRITE }], remaining: [] }, { voiceTarget, voiceSamples: FORMAL_SAMPLES });
  assert.equal(out.coverLetter, FORMAL_DRAFT, 'the draft letter is kept');
  assert.equal(report.changed, 0, 'the discarded rewrite is not counted as a change');
  assert.deepEqual(report.kept, [{ id: 'cover', reason: 'voice drifted from samples' }]);
  assert.equal(report.voice.kept, 'draft');
  assert.equal(report.voice.drifted, true);
  assert.ok(report.voice.after > report.voice.before, 'distance to the samples grew');
});

test('a humanized letter that keeps the samples’ register is kept', () => {
  const voiceTarget = voiceTargetOf(FORMAL_SAMPLES);
  const { packet: out, report } = applyHumanized({ resume: [], coverLetter: FORMAL_DRAFT, answers: [] }, { items: [{ id: 'cover', text: FORMAL_REWRITE }], remaining: [] }, { voiceTarget, voiceSamples: FORMAL_SAMPLES });
  assert.equal(out.coverLetter, FORMAL_REWRITE, 'the rewrite is kept');
  assert.equal(report.changed, 1);
  assert.deepEqual(report.kept, []);
  assert.equal(report.voice.kept, 'humanized');
  assert.equal(report.voice.drifted, false);
});

test('without a voice target the humanizer output is unchanged, with no drift report', () => {
  const { packet: out, report } = applyHumanized({ resume: [], coverLetter: FORMAL_DRAFT, answers: [] }, { items: [{ id: 'cover', text: PLAIN_REWRITE }], remaining: [] });
  assert.equal(out.coverLetter, PLAIN_REWRITE);
  assert.equal(report.voice, undefined);
});
