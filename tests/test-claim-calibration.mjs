import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSignals, gradePacket, numbersIn, summarize } from '../plainhand/claim-calibration.mjs';

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
  const { genericPhrases } = await import('../plainhand/claim-calibration.mjs');
  const packet = { resume: [{ section: 'Experience', text: 'Senior Test Engineer, Example Pumps. Results-driven team player.', evidence: [{ sourceId: 'cv', quote: 'Intern, Example Pumps (summer 2026)' }] }], answers: [], coverLetter: 'I am writing to express my interest. I am passionate about robots.' };
  const grade = gradePacket(packet, [{ id: 'cv', text: source }], [{ id: 'resume:0', rating: 'stretched', kind: 'verifiable', reason: 'Intern, not senior engineer.' }]);
  assert.equal(grade.claims[0].rating, 'unsupported');
  assert.match(grade.claims[0].reason, /must be exact/);
  assert.deepEqual(grade.claims[0].generic, ['results-driven', 'team player']);
  assert.deepEqual(grade.letterGeneric, ['passionate about', 'i am writing to express my interest']);
  assert.equal(grade.counts.generic, 1);
  assert.deepEqual(genericPhrases('A dynamically sized buffer.'), [], 'whole words only');
});

test('a sentence about the employer may repeat the posting\'s numbers; a claim about the candidate may not', () => {
  const sources = [{ id: 'cv', text: 'I manage 14 engineers across two teams.' }];
  const jobText = 'Director of engineering for the payments platform. Lead three teams of about 25 engineers.';
  const about = gradePacket({ resume: [], answers: [], coverLetter: 'I am applying to lead your 25 engineers.' }, sources, [], null, { jobText });
  assert.equal(about.counts.unsupported, 0);
  const claim = gradePacket({ resume: [], answers: [], coverLetter: 'I have managed 25 engineers.' }, sources, [], null, { jobText });
  assert.equal(claim.counts.unsupported, 1, 'a first-person claim still needs candidate evidence');
  const noJob = gradePacket({ resume: [], answers: [], coverLetter: 'I am applying to lead your 25 engineers.' }, sources, []);
  assert.equal(noJob.counts.unsupported, 1, 'without the posting the number is unsupported');
});

test('a posting number is exempt only where the employer is its subject', () => {
  const sources = [{ id: 'cv', text: 'I manage 14 engineers across two teams.' }];
  const jobText = 'The company operates in 28 countries. Lead three teams of about 25 engineers. Your 28-bed unit runs 12-hour shifts.';
  const grade = coverLetter => gradePacket({ resume: [], answers: [], coverLetter }, sources, [], null, { jobText });
  const unsupported = text => grade(text).claims.filter(claim => claim.rating === 'unsupported');
  for (const fact of [
    'Your company operates in 28 countries.',
    'The role’s 12-hour shifts suit me.',
    'Your 28-country footprint matches my experience.',
    'Your team of 25 is impressive.',
    'I am applying to lead your 25 engineers.',
    'I hope to lead your team of 25.',
    'I would like to manage your team of 25.',
    'I am excited to lead your 25 engineers.',
  ]) assert.deepEqual(unsupported(fact).map(claim => claim.text), [], fact);
  for (const claim of [
    'I led teams in 28 countries at your company.',
    'Led your 25 engineers.',
    'Managed your team of 25.',
    'My experience includes leading your 25 engineers.',
    'We currently manage your team of 25.',
    'I led your 25 engineers.',
    'I increased revenue at your company by 28%.',
    'I managed 25 engineers at your company.',
  ]) assert.equal(unsupported(claim).length, 1, claim);
});

test('repeated occurrences of one number are checked where each one sits', () => {
  const sources = [{ id: 'cv', text: 'I manage 14 engineers across two teams.' }];
  const jobText = 'Our team of 25 engineers ships hardware. The company operates in 28 countries.';
  const unsupported = packet => gradePacket(packet, sources, [], null, { jobText }).claims.filter(claim => claim.rating === 'unsupported');
  const twoSentences = unsupported({ resume: [], answers: [], coverLetter: 'Your team of 25 is impressive. I have led teams of 25.' });
  assert.equal(twoSentences.length, 1, 'the employer fact does not exempt the candidate claim after it');
  assert.match(twoSentences[0].text, /I have led teams of 25/);
  const oneSentence = unsupported({ resume: [], answers: [], coverLetter: 'Your company operates in 28 countries and I led teams in 28 countries.' });
  assert.equal(oneSentence.length, 1, 'the same value twice in one sentence is judged twice');
  assert.match(oneSentence[0].text, /I led teams in 28 countries/);
  const packet = {
    resume: [{ section: 'Experience', text: 'Led your 25 engineers.' }],
    answers: [{ question: 'How large was the team?', answer: 'We currently manage your team of 25.' }],
    coverLetter: 'Your team of 25 ships hardware.',
  };
  assert.deepEqual(unsupported(packet).map(claim => claim.part).sort(), ['answer', 'resume']);
});

test('employer facts keep working, and numbers the posting lacks are never exempt', () => {
  const sources = [{ id: 'cv', text: 'I manage 14 engineers across two teams.' }];
  const jobText = 'A $2,000 training budget and a team of 25 engineers. The company operates in 28 countries.';
  const grade = (coverLetter, posting = jobText) => gradePacket({ resume: [], answers: [], coverLetter }, sources, [], null, { jobText: posting });
  const budget = grade('Your $2,000 training budget would help me lead the 25 engineers on your team.');
  assert.equal(budget.claims.filter(c => c.rating === 'unsupported').length, 1, 'one sentence, one claim');
  assert.deepEqual(budget.claims.find(c => c.rating === 'unsupported').signals, ['number-not-in-sources'], 'the employer’s $2,000 is exempt; the scope I claim is not');
  assert.equal(grade('Your team of 25 is impressive.', 'Our team of 30 engineers ships hardware.').claims.filter(c => c.rating === 'unsupported').length, 1, 'a number the posting does not contain is not an employer fact');
  assert.equal(grade('Your team of 25 is impressive.', '').counts.unsupported, 1, 'without the posting nothing is exempt');
  assert.equal(grade('Your $2,000 training budget covers the 25 engineers I led.').claims.filter(c => c.rating === 'unsupported').length, 1, 'a comma inside $2,000 does not merge the clauses');
});

test('a posting number followed by a first-person owner in the same clause is the candidate claim', () => {
  const job = 'Our company has a 12-person team and 25 engineers.';
  const flagged = text => claimSignals(text, [], source, job).some(s => s.code === 'number-not-in-sources');
  assert.equal(flagged('The team of 12 reports to me today.'), true);
  assert.equal(flagged('Your 25 engineers I managed shipped weekly.'), true);
  assert.equal(flagged('Your 25 engineers would report to us.'), true);
  // Preserved: employer facts and a possessive about the candidate's work stay employer facts.
  assert.equal(flagged('Your 25 engineers would gain from my reporting.'), false);
  assert.equal(flagged('I would love to support your 12-person team.'), false);
});

test('interest and intent after an employer number are not ownership; ownership is', () => {
  const job = 'Our 25 engineers, a team of 12, a 15-week onboarding, a 12-month plan and a $2,000 budget.';
  const flagged = text => claimSignals(text, [], source, job).some(s => s.code === 'number-not-in-sources');
  for (const text of [
    'Your 25 engineers is exactly the team I want to lead.',
    'Your 25 engineers and I would work well together.',
    'Your 25 engineers I met at the career fair were impressive.',
    'Your 15-week onboarding is the ramp I need.',
    'Your team of 12 (i.e. three squads) is impressive.',
    'Your team of 25: I would be honoured to join.',
    'Your team of 25, I noticed, is growing fast.',
    'Your 25-person team appeals to me.',
    'The role’s 12-month plan matters to me.',
  ]) assert.equal(flagged(text), false, text);
  for (const text of [
    'Your 25 engineers, whom I managed, shipped weekly.',
    'The team of 12 is my current team.',
    'The team of 12 grew under my leadership.',
    'The team of 12 reports to me today.',
  ]) assert.equal(flagged(text), true, text);
});

test('a sentence-final employer number does not take ownership from the next sentence', () => {
  const job = 'A team of 25 engineers.';
  const grade = answer => gradePacket({ resume: [], answers: [{ question: 'Team', answer }], coverLetter: '' }, [{ id: 'cv', text: 'I manage 14 engineers.' }], [], null, { jobText: job });
  assert.equal(grade('Your team of 25. I have led bigger teams.').counts.unsupported, 0);
  const cover = gradePacket({ resume: [], answers: [], coverLetter: 'Your $2,000 training budget covers the 25 engineers I led.' }, [{ id: 'cv', text: 'I manage 14 engineers.' }], [], null, { jobText: 'A $2,000 training budget and 25 engineers.' });
  assert.deepEqual(cover.claims.filter(c => c.rating === 'unsupported').map(c => c.signals), [['number-not-in-sources']], 'only 25 is the candidate claim; $2,000 stays exempt');
});
