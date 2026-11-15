// Subject-aware numeric grounding for the evaluation scorer (design §4 and §5,
// with the root REVIEW amendments). The posting is evidence about the employer,
// never about the candidate: a number is supported by the posting only when the
// packet states it about the employer or role, per mention. These cases are the
// design's §4.4 table plus the REVIEW amendment rows; each negative control was
// observed failing on the pre-fix scorer before the rule existed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scorePacket } from '../plainhand/evaluation/score.mjs';
import { claimSignals } from '../plainhand/claim-calibration.mjs';

// The same structured PDF evidence the runner records for a rendered document;
// the PDF checks themselves live in tests/test-pdf-evidence.mjs.
export const PASSED_PDF = { evidence: { state: 'passed', pageCount: 1, checks: [
  { id: 'parse', status: 'pass' }, { id: 'text-layer', status: 'pass' }, { id: 'garbled', status: 'pass' },
  { id: 'contact', status: 'pass' }, { id: 'resume-coverage', status: 'pass' }, { id: 'reading-order', status: 'pass' },
  { id: 'layout', status: 'pass' }, { id: 'ats', status: 'pass' }, { id: 'cover', status: 'skipped' },
] } };

const FACT = 'Built SQL reports.';
const person = () => ({
  id: 'numeric-fixture',
  name: 'Riley Chen',
  profile: { name: 'Riley Chen', phone: '', resume: FACT },
  facts: [{ id: 'reports', text: FACT }],
  absent: [],
  voice: { banned: [], firstPerson: false },
});
const jobFor = description => ({ id: 'numeric-fixture-job', company: 'Fictional Co', title: 'Analyst', requiredFactIds: ['reports'], atsTerms: [], description });

const DEFAULT_SOURCES = () => [{ id: 'cv', text: FACT }];

// One packet text unit in the part the design names, with the fact-bearing line
// present so the only scoring term under test is the numeric one.
function scoreUnit({ text, part = 'resume', posting = '', sources = DEFAULT_SOURCES(), heading = null, headline = null, extraNotes = {} }) {
  const packet = { headline: headline ?? 'Data analyst', resume: [], answers: [], coverLetter: '', questions: [] };
  if (heading) packet.resume.push({ section: 'Experience', heading, text: FACT });
  else packet.resume.push({ section: 'Experience', text: FACT });
  if (part === 'resume') packet.resume.push({ section: 'Projects', text });
  if (part === 'cover') packet.coverLetter = `${FACT} ${text}`;
  if (part === 'answer') packet.answers.push({ question: 'Tell us about your work.', answer: text });
  const score = scorePacket({
    packet,
    persona: person(),
    job: jobFor(posting),
    sources: sources,
    review: { passed: true, issues: [] },
    pdf: PASSED_PDF,
    ...extraNotes,
  });
  return score;
}

const checksFor = (score, canonical) => score.numberChecks.filter(check => check.canonical === canonical);
const ownerOf = (score, canonical) => checksFor(score, canonical).map(check => check.owner);
const uncertainOf = (score, canonical) => checksFor(score, canonical).map(check => check.uncertain);

// §4.4 + REVIEW §2 rows. `posting` holds every number the row uses; candidate
// sources never do (except where the row says so). `expect` is the required
// per-mention attribution.
const POSTING = 'Fictional Co operates in 28 countries with 25 engineers, 12 teams, a 28-person team and 10+ years of practice.';
const ROWS = [
  {
    id: 'candidate-number-only-in-posting',
    text: 'I led teams in 28 countries.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'candidate-number-posting-removed',
    text: 'I led teams in 28 countries.',
    posting: 'Fictional Co operates in 25 countries.',
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'ambiguous-mixed-number',
    text: 'I told your team about 28 projects.',
    posting: POSTING,
    expect: { owner: ['ambiguous'], supported: [false], uncertain: [true], unsupported: ['28'], pass: false, reason: /unresolved/ },
  },
  {
    id: 'employer-predicate',
    text: 'Your team has 28 people.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'employer-phrase-attachment-of',
    text: 'Your team of 28 spans many cities.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'employer-phrase-attachment-compound',
    text: 'I would love to support your 28-person team.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'employer-description',
    text: 'Your company operates in 28 countries.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'role-description-cover',
    text: 'The role covers 12 countries.',
    part: 'cover',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'role-history-resume',
    text: 'The role lasted 28 months.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'mixed-employer-number',
    text: 'I built reports for your 28-country team.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'mixed-candidate-number',
    text: 'I led teams in 28 countries at your company.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'multi-sentence-cross-license',
    text: 'Your company operates in 28 countries. I led teams in 28 countries.',
    posting: POSTING,
    expect: { owner: ['employer', 'candidate'], supported: [true, false], uncertain: [false, false], unsupported: ['28'], pass: false },
  },
  {
    id: 'quoted-requirement',
    text: 'The role requires 10+ years; I have 12.',
    part: 'cover',
    posting: POSTING,
    sources: [{ id: 'cv', text: `${FACT} 12` }],
    expect: { owner: ['employer', 'candidate'], supported: [true, true], uncertain: [false, false], unsupported: [], pass: true },
  },
  {
    id: 'implicit-bullet',
    text: 'Led 28 teams.',
    posting: POSTING,
    expect: { owner: ['implicit'], supported: [false], uncertain: [true], unsupported: ['28'], pass: false },
  },
  {
    id: 'bare-definite-team',
    text: 'The team of 12 reports to me today.',
    posting: POSTING,
    expect: { owner: ['ambiguous'], supported: [false], uncertain: [true], unsupported: ['12'], pass: false, reason: /unresolved/ },
  },
  {
    id: 'answer-candidate',
    text: 'I managed 28 people.',
    part: 'answer',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'answer-employer',
    text: 'Your 28-person team would gain from my reporting.',
    part: 'answer',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'cover-candidate',
    text: 'I led the 28-country launch.',
    part: 'cover',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'cover-employer',
    text: 'I would love to support your 28-country team.',
    part: 'cover',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  // REVIEW §2 amendment rows verbatim.
  {
    id: 'review-employer-operates',
    text: 'Your company operates in 28 countries.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'review-candidate-led-at-employer',
    text: 'I led teams in 28 countries at your company.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'review-candidate-clause-at-employer',
    text: 'At your company, I led 28 teams.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['28'], pass: false },
  },
  {
    id: 'review-employer-subject',
    text: 'Your 25 engineers would gain from my reporting.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'review-intent-application',
    text: 'I am excited to join your 25 engineers.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'review-intent-turned-claim',
    text: 'Excited to have led your 25 engineers before.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['25'], pass: false },
  },
  {
    id: 'review-implicit-your-team',
    text: 'Led your 25 engineers.',
    posting: POSTING,
    expect: { owner: ['implicit'], supported: [false], uncertain: [true], unsupported: ['25'], pass: false },
  },
  {
    id: 'review-two-mentions-one-sentence',
    text: 'Your company operates in 28 countries and I managed 28 of its offices.',
    posting: POSTING,
    expect: { owner: ['employer', 'candidate'], supported: [true, false], uncertain: [false, false], unsupported: ['28'], pass: false },
  },
  {
    id: 'review-report-to-me',
    text: 'The team of 12 reports to me today.',
    posting: POSTING,
    expect: { owner: ['ambiguous'], supported: [false], uncertain: [true], unsupported: ['12'], pass: false },
  },
  {
    id: 'review-support-your-team',
    text: 'I would love to support your 12-person team.',
    posting: POSTING,
    expect: { owner: ['employer'], supported: [true], uncertain: [false], unsupported: [], pass: true },
  },
  {
    id: 'review-relative-clause-leak',
    text: 'Your 25 engineers, whom I managed, shipped weekly.',
    posting: POSTING,
    expect: { owner: ['candidate'], supported: [false], uncertain: [false], unsupported: ['25'], pass: false },
  },
  {
    id: 'review-my-current-team-leak',
    text: 'The team of 12 is my current team.',
    posting: POSTING,
    expect: { owner: ['ambiguous'], supported: [false], uncertain: [true], unsupported: ['12'], pass: false },
  },
];

for (const row of ROWS) {
  test(`numeric attribution: ${row.id}`, () => {
    const score = scoreUnit(row);
    const mentions = score.numberChecks.filter(check => row.text.includes(check.token));
    assert.ok(mentions.length > 0, `no mention checked for ${row.text}`);
    assert.deepEqual(mentions.map(check => check.owner), row.expect.owner, JSON.stringify(score.numberChecks, null, 2));
    assert.deepEqual(mentions.map(check => check.supported), row.expect.supported, JSON.stringify(score.numberChecks, null, 2));
    assert.deepEqual(mentions.map(check => check.uncertain), row.expect.uncertain, JSON.stringify(score.numberChecks, null, 2));
    assert.deepEqual(score.unsupportedNumbers, row.expect.unsupported);
    assert.equal(score.pass, row.expect.pass, JSON.stringify({ unsupported: score.unsupportedNumbers, checks: score.numberChecks }, null, 2));
    if (row.expect.reason) assert.match(mentions.find(check => !check.supported).reason, row.expect.reason);
    for (const check of mentions) {
      assert.equal(typeof check.allowedSources, 'object');
      assert.ok(Array.isArray(check.supportedBy));
      assert.equal(typeof check.reason, 'string');
      assert.ok(check.reason.length > 0);
      if (check.owner === 'employer') assert.deepEqual(check.allowedSources, ['candidate', 'posting']);
      else assert.deepEqual(check.allowedSources, ['candidate']);
    }
  });
}

test('numeric attribution: number words, percent forms, separators and phones keep their existing results', () => {
  const sources = [{ id: 'cv', text: 'Taught for six years, 2019-2023, 30 per cent faster, phone +1 617 555 0100.' }];
  const score = scoreUnit({ text: 'I taught for 6 years from 2019 to 2023 and made it 30% faster.', posting: '', sources });
  assert.deepEqual(score.unsupportedNumbers, []);
  const phone = scoreUnit({ text: 'I taught for 6 years and can be reached at 415 555 0199.', posting: '', sources });
  assert.deepEqual(phone.unsupportedNumbers, ['415', '555', '0199']);
  const thousands = scoreUnit({ text: 'I taught 4,000 students.', posting: '', sources: [{ id: 'cv', text: `${FACT} 4000 students.` }] });
  assert.deepEqual(thousands.unsupportedNumbers, []);
  const percent = scoreUnit({ text: 'I made it 30 percent faster.', posting: '', sources });
  assert.deepEqual(percent.unsupportedNumbers, []);
});

test('numeric attribution: a bare number is not supported by a longer number, but a percent form is', () => {
  const sources = [{ id: 'cv', text: `${FACT} 2027 expected. 70 percent.` }];
  const score = scoreUnit({ text: 'I ran 20 reviews and improved results by 70%.', posting: '', sources });
  assert.deepEqual(score.unsupportedNumbers, ['20']);
  const bare = scoreUnit({ text: 'I improved results by 70.', posting: '', sources: [{ id: 'cv', text: `${FACT} 70 percent.` }] });
  assert.deepEqual(bare.unsupportedNumbers, []);
});

test('numeric reporting: per-mention checks, posting-only and uncertainty sets', () => {
  const score = scoreUnit({ text: 'Your team has 28 people. I led teams in 28 countries.', posting: POSTING });
  assert.equal(score.numberChecks.length, 2);
  const [employer, candidate] = score.numberChecks;
  assert.equal(employer.owner, 'employer');
  assert.deepEqual(employer.supportedBy, ['job']);
  assert.equal(candidate.owner, 'candidate');
  assert.deepEqual(score.numericPostingOnly.map(check => check.supportedBy), [['job']]);
  assert.deepEqual(score.numericUncertainty, []);
  assert.deepEqual(score.unsupportedNumbers, ['28']);
  assert.equal(score.pass, false);
  const uncertain = scoreUnit({ text: 'The team of 12 reports to me today.', posting: POSTING });
  assert.equal(uncertain.numericUncertainty.length, 1);
  assert.equal(uncertain.numericUncertainty[0].uncertain, true);
  assert.deepEqual(uncertain.numericUncertainty[0].allowedSources, ['candidate']);
});

// §5: the headline and every distinct heading are visible text and are checked.
test('visible headings: a numeric title is checked and fails without a source', () => {
  const score = scoreUnit({ text: FACT, heading: { title: 'Director of 28 divisions' }, posting: POSTING });
  const heading = score.numberChecks.filter(check => check.unitId.startsWith('heading:'));
  assert.equal(heading.length, 1);
  assert.equal(heading[0].canonical, '28');
  assert.equal(heading[0].owner, 'candidate');
  assert.equal(heading[0].supported, false);
  assert.deepEqual(score.unsupportedNumbers, ['28']);
  assert.equal(score.pass, false);
});

test('visible headings: a numeric headline is checked and fails without a source', () => {
  const score = scoreUnit({ text: FACT, headline: 'Director of 28 divisions', posting: POSTING });
  const headline = score.numberChecks.filter(check => check.unitId.startsWith('headline:'));
  assert.equal(headline.length, 1);
  assert.equal(headline[0].owner, 'candidate');
  assert.equal(headline[0].supported, false);
  assert.equal(score.pass, false);
});

test('visible headings: supported dates pass and unsupported years fail', () => {
  const supported = scoreUnit({ text: FACT, heading: { title: 'Engineering Intern', org: 'Example Pumps', location: 'Boston', dates: 'Jun 2026 to Aug 2026' }, posting: '', sources: [{ id: 'cv', text: `${FACT} Example Pumps — Engineering Intern — Jun 2026 to Aug 2026` }] });
  assert.deepEqual(supported.unsupportedNumbers, []);
  assert.equal(supported.pass, true, JSON.stringify(supported.numberChecks));
  const unsupported = scoreUnit({ text: FACT, heading: { title: 'Engineering Intern', org: 'Example Pumps', location: 'Boston', dates: 'Jan 2031 to Mar 2032' }, posting: '', sources: [{ id: 'cv', text: `${FACT} Example Pumps — Engineering Intern — Jun 2026 to Aug 2026` }] });
  assert.deepEqual(unsupported.unsupportedNumbers, ['2031', '2032']);
  assert.equal(unsupported.pass, false);
});

test('visible headings: a heading repeated across entries is checked once, and no heading means no change', () => {
  const persona = person();
  const job = jobFor('');
  const packet = {
    headline: '',
    resume: [
      { section: 'Experience', heading: { title: 'Director of 28 divisions' }, text: FACT },
      { section: 'Experience', heading: { title: 'Director of 28 divisions' }, text: 'I coordinated the quarterly report.' },
    ],
    answers: [], coverLetter: '', questions: [],
  };
  const score = scorePacket({ packet, persona, job, sources: DEFAULT_SOURCES(), review: { passed: true, issues: [] }, pdf: PASSED_PDF });
  assert.equal(score.numberChecks.filter(check => check.unitId.startsWith('heading:')).length, 1);
  const plain = scorePacket({ packet: { headline: '', resume: [{ section: 'Experience', text: FACT }], answers: [], coverLetter: '', questions: [] }, persona, job, sources: DEFAULT_SOURCES(), review: { passed: true, issues: [] }, pdf: PASSED_PDF });
  assert.deepEqual(plain.numberChecks, []);
  assert.equal(plain.pass, true);
});

// REVIEW amendment 1: one-directional binding to the production calibration.
// Anything the scorer exempts as an employer fact must also be exempt in
// production. Production may flag more than the scorer; the one named exception
// is the design's attachment rule on a candidate-subject clause.
const NAMED_EXCEPTIONS = [{ text: 'I built reports for your 28-country team.', canonical: '28' }];
const CROSS_CHECK_ROWS = [
  ...ROWS.filter(row => row.id !== 'candidate-number-posting-removed'),
];

test('numeric attribution: every case row is no more permissive than the production calibration', () => {
  const divergences = [];
  for (const row of CROSS_CHECK_ROWS) {
    const score = scoreUnit(row);
    const sourceText = (row.sources || DEFAULT_SOURCES()).map(source => source.text).join('\n');
    const flagged = new Set(claimSignals(row.text, [], sourceText, row.posting).filter(signal => signal.code === 'number-not-in-sources').map(signal => signal.detail.split(' ')[0]));
    const byCanonical = new Map();
    for (const check of score.numberChecks) {
      const list = byCanonical.get(check.canonical) || [];
      list.push(check);
      byCanonical.set(check.canonical, list);
    }
    for (const [canonical, checks] of byCanonical) {
      const exemptEverywhere = checks.every(check => check.owner === 'employer' && check.supported);
      if (exemptEverywhere && flagged.has(canonical)) divergences.push({ text: row.text, canonical });
    }
  }
  const named = NAMED_EXCEPTIONS.map(item => ({ text: item.text, canonical: item.canonical }));
  const unexpected = divergences.filter(item => !named.some(known => known.text === item.text && known.canonical === item.canonical));
  assert.deepEqual(unexpected, [], 'the scorer exempted a number production flags, outside the named exception');
  assert.deepEqual(divergences.sort((a, b) => a.text.localeCompare(b.text)), named.sort((a, b) => a.text.localeCompare(b.text)), 'named exceptions must be exactly the observed divergences');
});

test('numeric attribution: the named production residual is recorded, not hidden', () => {
  const text = 'I built reports for your 28-country team.';
  const score = scoreUnit({ text, posting: POSTING });
  const mentions = score.numberChecks.filter(check => check.token === '28');
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].owner, 'employer');
  assert.equal(mentions[0].supported, true);
  const signals = claimSignals(text, [], FACT, POSTING);
  assert.deepEqual(signals.map(signal => signal.code), ['number-not-in-sources'], 'production flags it today; the divergence is accepted and listed');
});

test('tenure derived from a sourced year range is supported only as a count of years', async () => {
  const { numericGrounding } = await import('../plainhand/evaluation/score.mjs');
  const sources = [{ id: 'profile', text: 'Data Analyst, Example Co, 2020 to 2026.' }];
  const job = { company: 'Acme', title: 'Analyst', description: 'Analyst role.' };
  const check = text => numericGrounding({ packet: { resume: [], answers: [], coverLetter: text }, persona: { profile: { name: 'Test' } }, job, sources });
  assert.deepEqual(check('I have six years of analytics experience.').unsupportedNumbers, []);
  assert.deepEqual(check('I have 7 years of analytics experience.').unsupportedNumbers, []);
  assert.deepEqual(check('I have nine years of analytics experience.').unsupportedNumbers, ['9']);
  assert.deepEqual(check('I led six teams.').unsupportedNumbers, ['6']);
});

test('tenure: a career total sums roles without gaps; degree, publication and break ranges and "years ago" license nothing', async () => {
  const { numericGrounding } = await import('../plainhand/evaluation/score.mjs');
  const job = { company: 'Acme', title: 'Analyst', description: 'Analyst role.' };
  const check = (text, source) => numericGrounding({ packet: { resume: [], answers: [], coverLetter: text }, persona: { profile: { name: 'Test' } }, job, sources: [{ id: 'cv', text: source }] }).unsupportedNumbers;
  const career = ['Example Retail — Accountant — 2010 to 2014', 'Example Logistics — Systems Lead — 2014 to 2018', 'Career break — 2018 to 2019', 'Example Devices — FP&A Manager — 2019 to 2026'].join('\n');
  assert.deepEqual(check('I have 15 years in finance.', career), []);
  assert.deepEqual(check('I have 16 years in finance.', career), [], 'counting both ends');
  assert.deepEqual(check('I have 17 years in finance.', career), ['17'], 'the break is not counted');
  assert.deepEqual(check('I led the finance transformation for 6 years.', 'Publications — 2014 to 2020'), ['6']);
  assert.deepEqual(check('I worked in research for 4 years.', 'Example University — Bachelor of Science — 2010 to 2014'), ['4']);
  assert.deepEqual(check('Two years ago I migrated the general ledger.', 'Career break — 2018 to 2020\nExample Co — Analyst — 2020 to 2026'), ['2']);
  assert.deepEqual(check('I support a 6-year-old internal tool.', 'Example Co — Analyst — 2020 to 2026'), ['6']);
});

test('tenure: a degree on the same line as a job excludes only its own sentence', async () => {
  const { numericGrounding } = await import('../plainhand/evaluation/score.mjs');
  const job = { company: 'Acme', title: 'Analyst', description: 'Analyst role.' };
  const source = 'Example University — Bachelor of Arts, Mathematics — 2015 to 2019. Example High School — Mathematics Teacher — 2020 to 2026.';
  const check = text => numericGrounding({ packet: { resume: [], answers: [], coverLetter: text }, persona: { profile: { name: 'Test' } }, job, sources: [{ id: 'profile', text: source }] }).unsupportedNumbers;
  assert.deepEqual(check('I taught mathematics for six years.'), []);
  assert.deepEqual(check('I studied for 4 years.'), ['4']);
});

test('tenure: abbreviated degrees, Projects sections and "before" cannot launder years', async () => {
  const { numericGrounding } = await import('../plainhand/evaluation/score.mjs');
  const job = { company: 'Acme', title: 'Analyst', description: 'Analyst role.' };
  const check = (text, source) => numericGrounding({ packet: { resume: [], answers: [], coverLetter: text }, persona: { profile: { name: 'Test' } }, job, sources: [{ id: 'cv', text: source }] }).unsupportedNumbers;
  assert.deepEqual(check('I studied for 4 years.', 'Example University — B.A. — Mathematics — 2015 to 2019. Example High School — Teacher — 2020 to 2026.'), ['4']);
  assert.deepEqual(check('I have twelve years of experience.', 'Example University — B.S. — 2015 to 2019. Example Co — Analyst — 2019 to 2026.'), ['12']);
  assert.deepEqual(check('I have 7 years of experience.', 'Example University — B.S. — 2015 to 2019. Example Co — Analyst — 2019 to 2026.'), []);
  assert.deepEqual(check('I did research for 5 years.', 'Example Lab — Ph.D. — 2010 to 2015'), ['5']);
  const roles = 'Experience\nExample A — Analyst — 2010 to 2012\nExample B — Analyst — 2013 to 2015\nProjects\nSide project — 2024 to 2026';
  assert.deepEqual(check('I have six years of professional experience.', roles), ['6']);
  assert.deepEqual(check('I have four years of professional experience.', roles), []);
  assert.deepEqual(check('I migrated it six years before that.', 'Example Co — Analyst — 2020 to 2026'), ['6']);
  assert.deepEqual(check('I have seven years of experience.', 'Example Co — Master Data Analyst — 2019 to 2026'), []);
});
