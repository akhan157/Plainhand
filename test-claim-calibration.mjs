import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSignals, gradePacket, numbersIn, summarize } from './plainhand/claim-calibration.mjs';

const source = 'On Formula SAE I redesigned the rear upright in SolidWorks and cut its weight by 18%. I coordinated three sophomores on the suspension sub-team. I am learning Python with pandas. Intern, Example Pumps (summer 2026); I helped run 40 bench tests.';
const codes = (text, quotes) => claimSignals(text, quotes, source).map(s => s.code);

test('numbers are normalized and years are not treated as results', () => {
  assert.deepEqual(numbersIn('Cut $2,000 and 18% over 40 tests in 2026'), ['2000', '18%', '40', '2026']);
  assert.deepEqual(codes('Interned at Example Pumps in summer 2026.', ['Intern, Example Pumps (summer 2026)']), []);
});

test('inflation signals: invented number, raised ownership, raised skill level', () => {
  assert.deepEqual(codes('Redesigned the rear upright, cutting weight by 25%.', ['I redesigned the rear upright in SolidWorks and cut its weight by 18%']), ['number-not-in-sources']);
  assert.deepEqual(codes('Led three sophomores on the suspension sub-team.', ['I coordinated three sophomores on the suspension sub-team']), ['ownership-raised']);
  assert.deepEqual(codes('Proficient in Python and pandas.', ['I am learning Python with pandas']), ['level-raised']);
  assert.deepEqual(codes('Ran 40 bench tests at Example Pumps.', ['I helped run 40 bench tests']), ['ownership-raised']);
  assert.deepEqual(codes('Cut upright weight by nearly 20%.', ['cut its weight by 18%']), ['number-rounded-stated'], 'rounding the reader is told about');
  assert.deepEqual(codes('Cut upright weight by 20%.', ['cut its weight by 18%']), ['number-rounded'], 'unstated rounding is a stretch, not an invention');
  assert.deepEqual(claimSignals('Cut upright weight by nearly 20%.', ['cut its weight by 18%'], source).map(s => s.rating), ['stretched']);
});

test('undersell signals: dropped result, lowered ownership', () => {
  assert.deepEqual(codes('Redesigned the rear upright of a Formula SAE car in SolidWorks.', ['I redesigned the rear upright in SolidWorks and cut its weight by 18%']), ['result-dropped']);
  assert.deepEqual(codes('Helped coordinate the suspension sub-team.', ['I coordinated three sophomores on the suspension sub-team']), ['ownership-lowered']);
});

test('a faithful reframing raises no signal', () => {
  assert.deepEqual(codes('Cut rear upright weight 18% through a SolidWorks redesign for Formula SAE.', ['I redesigned the rear upright in SolidWorks and cut its weight by 18%']), []);
  assert.deepEqual(codes('Coordinated three sophomores on the Formula SAE suspension sub-team.', ['I coordinated three sophomores on the suspension sub-team']), []);
});

test('packet grade: model ratings are kept, rules override toward inflation, cover-letter numbers are checked', () => {
  const ev = quote => [{ sourceId: 'cv', quote }];
  const packet = {
    resume: [
      { section: 'Projects', text: 'Cut rear upright weight 18% through a SolidWorks redesign.', evidence: ev('cut its weight by 18%') },
      { section: 'Projects', text: 'Led three sophomores on the suspension sub-team.', evidence: ev('I coordinated three sophomores on the suspension sub-team') },
      { section: 'Projects', text: 'Redesigned the rear upright in SolidWorks.', evidence: ev('I redesigned the rear upright in SolidWorks and cut its weight by 18%') },
    ],
    answers: [{ question: 'Python?', answer: 'I am learning Python with pandas.', evidence: ev('I am learning Python with pandas') }],
    coverLetter: 'I cut weight by 18%. I saved the team $5,000.',
  };
  const grade = gradePacket(packet, [{ id: 'cv', text: source }], [
    { id: 'resume:0', rating: 'balanced', reason: 'Matches.' },
    { id: 'resume:1', rating: 'balanced', reason: 'Model missed it.' },
    { id: 'answer:0', rating: 'balanced', reason: 'Accurate.' },
    { id: 'cover:0', claim: 'I cut weight by 18%.', rating: 'balanced', reason: 'Matches.' },
  ]);
  const by = Object.fromEntries(grade.claims.map(c => [c.id, c]));
  assert.equal(by['resume:0'].rating, 'balanced');
  assert.equal(by['resume:1'].rating, 'stretched', 'a rule signal overrides a lenient model');
  assert.equal(by['resume:1'].source, 'model+rules');
  assert.equal(by['resume:2'].rating, 'undersold');
  assert.ok(grade.claims.some(c => c.part === 'cover' && c.rating === 'unsupported' && /5,000/.test(c.text)), 'an invented cover-letter number is caught without a model rating');
  assert.equal(grade.band, 'inflated');
  const judged = gradePacket(packet, [{ id: 'cv', text: source }], [{ id: 'resume:2', rating: 'balanced', reason: 'A short entry; fine.' }]);
  assert.equal(judged.claims.find(c => c.id === 'resume:2').rating, 'balanced', 'the model’s judgment wins over an undersell rule signal');
  assert.equal(grade.modelRated, true);
});

test('bands: balanced, undersold, mixed', () => {
  const r = rating => ({ rating });
  assert.equal(summarize([r('balanced'), r('balanced'), r('balanced'), r('undersold')]).band, 'balanced');
  assert.equal(summarize([r('balanced'), r('undersold'), r('undersold')]).band, 'undersold');
  assert.equal(summarize([r('stretched'), r('undersold'), r('undersold'), r('balanced')]).band, 'mixed');
  assert.equal(summarize([]).balancedShare, null);
});

test('verifiable facts can’t be stretched, and generic phrasing is flagged', async () => {
  const { genericPhrases } = await import('./plainhand/claim-calibration.mjs');
  const packet = { resume: [{ section: 'Experience', text: 'Senior Test Engineer, Example Pumps. Results-driven team player.', evidence: [{ sourceId: 'cv', quote: 'Intern, Example Pumps (summer 2026)' }] }], answers: [], coverLetter: 'I am writing to express my interest. I am passionate about robots.' };
  const grade = gradePacket(packet, [{ id: 'cv', text: source }], [{ id: 'resume:0', rating: 'stretched', kind: 'verifiable', reason: 'Intern, not senior engineer.' }]);
  assert.equal(grade.claims[0].rating, 'unsupported');
  assert.match(grade.claims[0].reason, /must be exact/);
  assert.deepEqual(grade.claims[0].generic, ['results-driven', 'team player']);
  assert.deepEqual(grade.letterGeneric, ['passionate about', 'i am writing to express my interest']);
  assert.equal(grade.counts.generic, 1);
  assert.deepEqual(genericPhrases('A dynamically sized buffer.'), [], 'whole words only');
});
