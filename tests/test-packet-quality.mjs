// Packet quality: the cover letter tells the story behind the resume instead of
// restating it, an education or credential heading may stand without a filler line,
// and one accomplishment is never listed twice. All checks here are deterministic;
// no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest, hasEvidence } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { PACKET_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../plainhand/humanize.mjs';
import { MIN_OVERLAP_WORDS, letterOverlaps, letterRetryFeedback, overlapSuggestion } from '../plainhand/letter-checks.mjs';
import { dedupeResume, guardSuggestions, headingOnlyRow, keepResumeRow } from '../plainhand/workflow.mjs';
import { DEFAULT_FORMAT, renderResumeHtml } from '../plainhand/resume-format.mjs';

const ATLAS = 'Built the Atlas reporting tool at Synthetic Engineering and cut report preparation time from three days to four hours for the finance team.';
const SECOND = 'Cut report preparation time from three days to four hours for the finance team.';
const DEGREE = 'B.S. Mechanical Engineering, Example University, 2027.';
const CHASSIS = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const PROFILE_RESUME = `Synthetic Engineering, Product Engineer, 2023 to 2026. ${ATLAS} ${CHASSIS} ${DEGREE}`;
const PROFILE = { ...candidate, resume: PROFILE_RESUME };
const EDUCATION_HEADING = { org: 'Example University', title: 'B.S. Mechanical Engineering', location: '', dates: '2027' };
const EXPERIENCE_HEADING = { org: 'Synthetic Engineering', title: 'Product Engineer', location: '', dates: '2023 to 2026' };
const evidence = quote => [{ sourceId: 'cv', quote }];

function atlasRow() { return { section: 'Projects', heading: EXPERIENCE_HEADING, text: ATLAS, evidence: evidence(ATLAS) }; }
function educationRow() { return { section: 'Education', heading: EDUCATION_HEADING, text: '', evidence: evidence(DEGREE) }; }

async function harness(prepare = null, { humanize = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-packet-quality-'));
  const calls = [];
  const agent = async (id, instruction, data, options) => {
    calls.push({ instruction, data });
    if (instruction === PACKET_INSTRUCTION && prepare) return prepare(calls.filter(call => call.instruction === PACKET_INSTRUCTION).length, data);
    if (instruction === HUMANIZE_INSTRUCTION) return humanize ? humanize(data) : { items: data.items.map(item => ({ id: item.id, text: item.text })), remaining: [] };
    return fixtureAgent(id, instruction, data, options);
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'This is an engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...PROFILE }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
  await ui('tasks.standard', {}); await settle(); await ui('standard.approve', {});
  let n = 0;
  const addJob = async () => { n += 1; return (await ui('jobs.add', { company: 'Test Company', title: `Graduate Engineer ${n}`, url: `https://jobs.lever.co/test/quality-${n}` })).result.id; };
  const prepareJob = async () => {
    const jobId = await addJob();
    await ui('tasks.evaluate', { jobId }); await settle();
    await ui('jobs.select', { jobId, selected: true });
    await ui('tasks.prepare', { jobId }); await settle();
    return { jobId, job: (await app.workspace.load()).jobs.find(item => item.id === jobId) };
  };
  return { app, ui, settle, prepareJob, calls, lastTask: async () => (await app.workspace.load()).tasks[0], close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('the letter detector flags a long repeated run and leaves an original letter alone', () => {
  const resume = [{ section: 'Experience', text: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet' }];
  assert.equal(MIN_OVERLAP_WORDS, 8);

  const repeated = letterOverlaps('I am glad to apply. Alpha bravo charlie delta echo foxtrot golf hotel changed how we worked.', resume);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].words, 8);
  assert.match(repeated[0].phrase, /^alpha bravo charlie delta echo foxtrot golf hotel$/);
  assert.match(repeated[0].sentence, /^Alpha bravo/);

  const borderline = letterOverlaps('We discussed alpha bravo charlie delta echo foxtrot golf in the interview.', resume);
  assert.deepEqual(borderline, [], 'seven content words are below the threshold');

  const original = letterOverlaps('At a previous employer I rebuilt the weekly close so the team stopped working weekends.', resume);
  assert.deepEqual(original, []);

  const feedback = letterRetryFeedback(repeated);
  assert.match(feedback[0], /repeats resume lines word for word/);
  assert.ok(feedback.slice(1).some(line => line.includes('Alpha bravo charlie delta echo foxtrot golf hotel')));
  assert.ok(feedback.slice(1).some(line => line.includes('alpha bravo charlie delta echo foxtrot golf hotel')));
  assert.match(overlapSuggestion(repeated), /^Cover letter quality \(not a factual issue\)/);
});

test('one accomplishment is listed once, under the same heading only', () => {
  const rows = [
    { section: 'Projects', heading: EXPERIENCE_HEADING, text: ATLAS },
    { section: 'Projects', heading: EXPERIENCE_HEADING, text: SECOND },
    { section: 'Projects', heading: EXPERIENCE_HEADING, text: ATLAS },
    { section: 'Projects', heading: { ...EXPERIENCE_HEADING, title: 'Research Assistant' }, text: SECOND },
  ];
  const kept = dedupeResume(rows);
  assert.equal(kept.length, 2, 'the repeated and contained lines under one heading are dropped');
  assert.equal(kept[0], rows[0], 'the first line is kept');
  assert.equal(kept[1], rows[3], 'the same sentence under a different heading is a different accomplishment');
});

test('a heading-only education row survives, renders without a bullet and passes evidence; Experience still drops', async () => {
  let blankItems = 0;
  const h = await harness(attempt => attempt === 1 ? {
    headline: 'Mechanical Engineering Graduate',
    resume: [
      atlasRow(),
      { section: 'Projects', heading: EXPERIENCE_HEADING, text: SECOND, evidence: evidence(SECOND) },
      educationRow(),
      // A heading-only Experience row has no line to keep; it must be dropped, not
      // kept as a blank line or failed for its missing citation.
      { section: 'Experience', heading: EXPERIENCE_HEADING, text: '', evidence: [] },
    ],
    coverLetter: 'I am applying for this engineering role at your company.',
    answers: [], questions: [], suggestions: [],
  } : {
    headline: 'Mechanical Engineering Graduate',
    resume: [atlasRow(), educationRow()],
    coverLetter: 'I am applying for this engineering role at your company.',
    answers: [], questions: [], suggestions: [],
  }, {
    // A humanizer pass may try to fill a blank row; the heading-only row must stay blank.
    humanize: data => { blankItems += data.items.filter(item => !item.text).length; return { items: data.items.map(item => ({ id: item.id, text: item.text || 'Graduated.' })), remaining: [] }; },
  });
  try {
    const { job } = await h.prepareJob();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.ok(job.packet, 'the packet was saved');
    const education = job.packet.resume.find(item => item.section === 'Education' && headingOnlyRow(item));
    assert.ok(education, 'the heading-only education row survives the blank-row filter');
    assert.equal(education.text, '', 'the education line stays empty');
    assert.ok(blankItems >= 1, 'the humanizer was given the blank row and tried to fill it');
    assert.ok(!job.packet.resume.some(item => item.section === 'Experience'), 'a heading-only Experience row is still dropped');
    assert.equal(job.packet.resume.filter(item => item.text.includes('Atlas reporting tool')).length, 1, 'the contained duplicate is dropped');

    const context = await h.app.workspace.context(await h.app.workspace.load());
    assert.ok(hasEvidence(education, context), 'the heading quote still satisfies the evidence gate');

    const html = renderResumeHtml(DEFAULT_FORMAT, { name: 'Test Graduate' }, job.packet);
    assert.ok(html.includes('Example University'), 'the heading renders');
    assert.ok(!html.includes('<li></li>'), 'no empty bullet is rendered');
    assert.equal((html.match(/<li>/g) || []).length, 1, 'only the surviving experience line is bulleted');

    // The pure filter agrees with the workflow: education and credentials may stand
    // on their heading, an incomplete heading or Experience may not.
    assert.equal(keepResumeRow(educationRow()), true);
    assert.equal(keepResumeRow({ ...educationRow(), section: 'Certifications', heading: { org: 'CFA Institute', title: 'CFA Level I', location: '', dates: '2024' } }), true);
    assert.equal(keepResumeRow({ ...educationRow(), section: 'Experience' }), false);
    assert.equal(keepResumeRow({ ...educationRow(), heading: { ...EDUCATION_HEADING, dates: '' } }), false);
  } finally { await h.close(); }
});

test('the one evidence retry carries the repeated letter sentences, and the final packet keeps the overlap as a suggestion', async () => {
  const h = await harness(attempt => attempt === 1 ? {
    headline: 'Mechanical Engineering Graduate',
    resume: [atlasRow(), { section: 'Projects', text: 'Supervised the chassis program.', evidence: evidence('Supervised the chassis program.') }],
    coverLetter: ATLAS,
    answers: [], questions: [], suggestions: [],
  } : {
    headline: 'Mechanical Engineering Graduate',
    resume: [atlasRow()],
    coverLetter: ATLAS,
    answers: [], questions: [], suggestions: [],
  });
  try {
    const before = h.calls.length;
    const { job } = await h.prepareJob();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const packetCalls = h.calls.slice(before).filter(call => call.instruction === PACKET_INSTRUCTION);
    assert.equal(packetCalls.length, 2, 'exactly one retry: the existing evidence retry');
    const duringPrepare = h.calls.slice(before).filter(call => [PACKET_INSTRUCTION, HUMANIZE_INSTRUCTION, REVIEW_INSTRUCTION].includes(call.instruction));
    assert.equal(duringPrepare.length, 4, 'two drafts, one humanize pass and one review: no call was added for the letter');
    const feedback = packetCalls[1].data.reviewFeedback || [];
    assert.ok(feedback.some(line => line.includes('Supervised the chassis program.')), 'the evidence finding is still named');
    assert.ok(feedback.some(line => line.includes('repeats resume lines word for word')), 'the letter finding is named');
    assert.ok(feedback.some(line => line.includes(ATLAS)), 'the overlapping sentence is named');

    assert.ok(job.packet.suggestions.some(line => /^Cover letter quality \(not a factual issue\)/.test(line)), 'the final packet records the overlap in suggestions');
    assert.equal(job.packet.coverLetter, ATLAS, 'a quality finding never blocks or rewrites the letter by itself');
  } finally { await h.close(); }
});

test('both instructions carry the letter, heading-only and duplicate rules', () => {
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) {
    assert.match(instruction, /No sentence of the letter may repeat a resume line's wording; the letter tells the story behind the line, not the line itself\./);
    assert.ok(instruction.includes('heading-only, with empty text and one exact source quote for its heading'));
    assert.ok(instruction.includes('never write filler such as "Graduated." or "Completed undergraduate study."'));
    assert.match(instruction, /never list the same accomplishment twice/i);
  }
  assert.match(PACKET_INSTRUCTION, /The base letter is a voice and tone reference only/);
  assert.match(PACKET_INSTRUCTION, /write this application's letter body fresh around this posting's top two or three requirements/);
  assert.match(PACKET_INSTRUCTION, /Never add a meta disclaimer about the evidence/);
  assert.match(PACKET_INSTRUCTION, /Close by naming something specific about this role or employer, never a generic sentence/);
  assert.match(PACKET_INSTRUCTION, /Experience never has a heading-only entry/);
  assert.match(PACKET_INSTRUCTION, /Every Experience entry has non-empty text/);
  assert.match(PACKET_INSTRUCTION, /pick the top two or three qualifications this posting asks for/);
  assert.ok(!PACKET_INSTRUCTION.includes('Every resume entry has non-empty text'), 'the old blanket rule is replaced');
  assert.ok(!PACKET_INSTRUCTION.includes('fill the letter\'s {company} and {role} slots while tailoring its opening and closing'), 'the copy-the-base-letter instruction is gone');
});

test('both instructions forbid invented motivation and false inclusion suggestions', () => {
  for (const instruction of [PACKET_INSTRUCTION, STANDARD_INSTRUCTION]) {
    assert.match(instruction, /motivation the candidate stated/);
    assert.match(instruction, /never claim a feeling, want, interest or reason/);
    assert.match(instruction, /Suggestions describe only what this (?:packet|master resume) actually contains or leaves out/);
    assert.ok(instruction.includes('"left out X because ..."'));
    assert.ok(instruction.includes('never claim the resume or letter included or added an item that is not in it'));
  }
  assert.ok(PACKET_INSTRUCTION.includes('connect the posting\'s own stated work to the candidate\'s evidenced work'), 'the no-motivation fallback names the posting\'s own work');
  assert.ok(PACKET_INSTRUCTION.includes('Say nothing about the employer or role that the posting text does not say'));
  assert.ok(STANDARD_INSTRUCTION.includes('connect the candidate\'s evidenced work to the kind of work those roles name'));
  assert.ok(!PACKET_INSTRUCTION.includes('Say briefly why this role and this employer'), 'the unsupported why-this-employer request is gone');
  assert.ok(!STANDARD_INSTRUCTION.includes('say briefly why this kind of role at this kind of employer'), 'the unsupported why-this-employer request is gone from the base letter');
});

test('the suggestion guard rewrites a false inclusion and keeps a true one', () => {
  const resume = [
    { section: 'Certifications', heading: { org: 'CNCF', title: 'CKS', location: '', dates: '2025' }, text: '', evidence: evidence('CKS') },
    { section: 'Projects', heading: EXPERIENCE_HEADING, text: ATLAS, evidence: evidence(ATLAS) },
  ];
  const letter = 'I keep Kubernetes clusters patched and tested.';
  assert.deepEqual(guardSuggestions([
    'Included the Google Data Analytics Certificate from the CV.',
    'Included the CKS certification in the resume.',
    'Included the Atlas reporting tool to the resume.',
    'Added Kubernetes work to the letter.',
    'Kept the resume to one page.',
    'Left out the Google Data Analytics Certificate because this posting does not ask for it.',
  ], resume, letter), [
    'Left out: Google Data Analytics Certificate.',
    'Included the CKS certification in the resume.',
    'Included the Atlas reporting tool to the resume.',
    'Added Kubernetes work to the letter.',
    'Kept the resume to one page.',
    'Left out the Google Data Analytics Certificate because this posting does not ask for it.',
  ], 'only the claim whose named item is absent changes, and it becomes an honest omission');
});

test('the suggestion guard runs before review and keeps a true inclusion note', async () => {
  const h = await harness(() => ({
    headline: 'Mechanical Engineering Graduate',
    resume: [atlasRow()],
    coverLetter: 'I built reporting tools for a finance team.',
    answers: [], questions: [],
    suggestions: ['Included the Google Data Analytics Certificate from the CV.', 'Included the Atlas reporting tool in Projects.'],
  }));
  try {
    const { job } = await h.prepareJob();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const reviewCall = h.calls.filter(call => call.instruction === REVIEW_INSTRUCTION).at(-1);
    assert.ok(reviewCall, 'the reviewer ran');
    assert.ok(reviewCall.data.packet.suggestions.some(line => line.startsWith('Scope check')), 'the letter’s unsupported plural is a suggestion, not a gate');
    assert.deepEqual(reviewCall.data.packet.suggestions.filter(line => !line.startsWith('Scope check')), [
      'Left out: Google Data Analytics Certificate.',
      'Included the Atlas reporting tool in Projects.',
    ], 'the reviewer sees the corrected note and the true one');
    assert.deepEqual(job.packet.suggestions, reviewCall.data.packet.suggestions, 'the corrected note is saved with the packet');
  } finally { await h.close(); }
});

test('the voice-contrast setup path prepares offline with the fixture agent', async () => {
  const { preparePersona, SAMPLES } = await import('../scripts/voice-contrast.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-voice-contrast-test-'));
  try {
    const result = await preparePersona('codex', 'terse', SAMPLES.terse, root, { agent: fixtureAgent });
    assert.match(result.coverLetter, /design and testing/, 'the prepared packet has a cover letter');
    assert.equal(result.reviewPassed, true, 'the review passed');
    assert.ok(result.reviewAttempts >= 1, 'the review ran');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('suggestion guard: an inclusion claimed anywhere in the sentence is checked, omissions and true claims are kept', async () => {
  const { guardSuggestions } = await import('../plainhand/workflow.mjs');
  const resume = [{ section: 'Experience', heading: { org: 'Fictional Biologics', title: 'Scientist', location: '', dates: '2021 to 2026' }, text: 'Ran potency assays at Fictional Biologics.' }];
  const [master] = guardSuggestions(['The master includes the Example Bioinstruments role and the Lean Six Sigma Green Belt certification.'], resume, '');
  assert.match(master, /^Left out: Example Bioinstruments role and the Lean Six Sigma Green Belt certification\./);
  const [every] = guardSuggestions(['Every role, including Example Bioinstruments, is listed with its title and dates.'], resume, '');
  assert.match(every, /^Left out: Example Bioinstruments\./);
  assert.deepEqual(guardSuggestions(['The Fictional Biologics role is listed with its dates.'], resume, ''), ['The Fictional Biologics role is listed with its dates.']);
  assert.deepEqual(guardSuggestions(['Left out the Example Bioinstruments role because it predates the posting.'], resume, ''), ['Left out the Example Bioinstruments role because it predates the posting.']);
});

test('suggestion guard leaves advice, questions and conditionals alone', async () => {
  const { guardSuggestions } = await import('../plainhand/workflow.mjs');
  const resume = [{ section: 'Experience', heading: { org: 'Fictional Biologics', title: 'Scientist', location: '', dates: '2021 to 2026' }, text: 'Ran potency assays.' }];
  for (const note of ['Consider adding AWS if your resume lists it.', 'If you have Python experience, it appears relevant.', 'The posting lists Kubernetes; your sources do not show it.', 'Could you confirm whether SQL is listed elsewhere?']) assert.deepEqual(guardSuggestions([note], resume, ''), [note]);
});

test('suggestion guard names only the absent items of a mixed inclusion claim', async () => {
  const { guardSuggestions } = await import('../plainhand/workflow.mjs');
  const resume = [{ section: 'Skills', heading: null, text: 'AWS, Terraform' }];
  assert.deepEqual(guardSuggestions(['The resume includes AWS and Kubernetes.'], resume, ''), ['Left out: Kubernetes.']);
});
