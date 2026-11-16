// Contradictions and settled questions (M5): deterministic detection, decisions that
// never copy facts, a prepare pre-check that blocks only cited conflicts, and an
// excluded source that can cause a block without its text reaching a question or a
// provider. The end-to-end case also proves the decision survives restart and import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { Workspace, digest } from '../plainhand/store.mjs';
import { exportWorkspace, importWorkspace, cleanConflictReview } from '../plainhand/workspace-import.mjs';
import {
  findConflicts, conflictQuestion, conflictDecision, prepareMemoryCheck,
  settledQuestion, recordQuestionChecks, questionStats, questionDigest, memoryReport,
} from '../plainhand/memory-checks.mjs';
import { profileStrength } from '../plainhand/profile-strength.mjs';
import { candidate, fixtureProviders } from '../plainhand/test-fixtures.mjs';

const cvSource = text => ({ id: 'cv', text });
const interview = text => ({ id: 'interview', text });
const TEAM_FIVE = 'Led a team of 5 engineers through the Northwind chassis programme.';
const TEAM_THREE = 'I coordinated 3 contractors on the same chassis programme.';

test('different numbers on the same kind of claim are a conflict with both exact quotes, and a decision suppresses it', () => {
  const sources = [cvSource(TEAM_FIVE), interview(TEAM_THREE)];
  const open = findConflicts({ sources, profile: {} });
  const number = open.find(item => item.kind === 'number');
  assert.ok(number, JSON.stringify(open.map(item => item.kind)));
  assert.deepEqual(number.sourceIds.sort(), ['cv', 'interview']);
  assert.deepEqual(number.quotes.map(quote => quote.quote), [TEAM_FIVE, TEAM_THREE]);
  assert.match(conflictQuestion(number), /how many people/);
  const decision = conflictDecision(number, 'cv');
  assert.deepEqual(findConflicts({ sources, profile: {}, decisions: [decision] }).map(item => item.kind), []);
  assert.ok(!JSON.stringify(decision).includes('5 engineers'), 'the ledger stores digests, not the fact text');
  assert.ok(!JSON.stringify(decision).includes('3 contractors'));
  assert.deepEqual(decision.quoteDigests, number.quotes.map(quote => digest(quote.quote)));
});

test('employer titles conflict unless a promotion is proven by non-overlapping dates; dates disagree on overlap', () => {
  const conflict = findConflicts({ sources: [cvSource('Senior Engineer at Acme, 2020–2022.'), interview('Sales Analyst at Acme, 2021–2023.')], profile: {} });
  assert.deepEqual(conflict.map(item => item.kind), ['employer']);
  const promotion = findConflicts({ sources: [cvSource('Engineer at Acme, 2020–2022.'), interview('Senior Engineer at Acme, 2022–2024.')], profile: {} });
  assert.deepEqual(promotion, [], 'a handover between ranges is not a contradiction');
  const dates = findConflicts({ sources: [cvSource('Engineer at Acme, 2020–2023.'), interview('Engineer at Acme, 2021–2022.')], profile: {} });
  assert.deepEqual(dates.map(item => item.kind), ['dates']);
  assert.match(conflictQuestion(dates[0]), /the dates at acme/i);
  const settled = findConflicts({ sources: [cvSource('Engineer at Acme, 2020–2022.')], profile: {} });
  assert.deepEqual(settled, [], 'one employer and one date are ordinary settled facts');
});

test('a different degree or graduation year conflicts; a second degree at another school and a matching profile do not', () => {
  const shared = 'B.S. Mechanical Engineering, Example University, 2027.';
  const other = 'I graduated with a B.A. in History from Example University in 2026.';
  const degree = findConflicts({ sources: [cvSource(shared), interview(other)], profile: {} });
  assert.deepEqual(degree.map(item => item.kind), ['degree']);
  assert.match(conflictQuestion(degree[0]), /Example University/);
  const secondDegree = findConflicts({ sources: [cvSource(shared), interview('M.S. Systems Engineering, Other Institute, 2025.')], profile: {} });
  assert.deepEqual(secondDegree, [], 'two degrees at different schools and years are a history, not a contradiction');
  const settled = findConflicts({ sources: [cvSource(shared)], profile: { graduation: '2027' } });
  assert.deepEqual(settled, [], 'a profile graduation year that matches the resume is settled');
  const yearOnly = findConflicts({ sources: [cvSource(shared)], profile: { graduation: '2026' } });
  assert.deepEqual(yearOnly.map(item => item.kind), ['degree']);
  // A resume may list a master's and an older bachelor's. The profile holds one
  // graduation year; it is settled when any listed degree has that year.
  const multiple = 'Example Institute — Master of Business Administration — 2020. Example University — Bachelor of Arts — 2018.';
  assert.deepEqual(findConflicts({ sources: [cvSource(multiple)], profile: { graduation: '2020' } }), []);
});

test('conflicting location and work authorization are found; matching statements are not', () => {
  const sources = [cvSource('I am based in Boston.'), interview('I am based in Austin, Texas.')];
  const place = findConflicts({ sources, profile: {} });
  assert.deepEqual(place.map(item => item.kind), ['location']);
  assert.deepEqual(findConflicts({ sources: [cvSource('I am based in Boston.')], profile: { location: 'Boston, US' } }), []);
  const eligibility = findConflicts({ sources: [cvSource('I am authorized to work in the US.')], profile: { eligibility: 'I would require visa sponsorship to work in the US' } });
  assert.deepEqual(eligibility.map(item => item.kind), ['eligibility']);
  assert.deepEqual(findConflicts({ sources: [cvSource('I am authorized to work in the US.')], profile: { eligibility: 'Authorized to work in the US' } }), []);
});

test('settled questions are answered by profile, exact bank answer or this packet, never asked again', () => {
  const profile = { email: 'candidate@example.invalid', location: 'Boston, US', graduation: '2027' };
  const bank = [{ id: 'answer-1', question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }], scope: 'global', reviewedAt: '2026-01-01', reviewBy: null }];
  assert.deepEqual(settledQuestion('What is your email address?', { profile }), { by: 'profile', topic: 'email' });
  assert.deepEqual(settledQuestion('Which city are you based in?', { profile }), { by: 'profile', topic: 'location' });
  assert.equal(settledQuestion('What salary range does this role pay?', { profile: { compensation: '$90k' } }), null, 'the employer’s salary is not the candidate’s preference');
  assert.deepEqual(settledQuestion('Describe a hands-on project', { profile, bank }), { by: 'answer-bank', topic: 'approved answer' });
  assert.deepEqual(settledQuestion('Why this company?', { profile, packet: { answers: [{ question: 'Why this company?', answer: 'Because of the test lab.' }] } }), { by: 'packet-answer', topic: 'this packet’s answer' });
  assert.equal(settledQuestion('What is the company name?', { profile: { name: 'Test Graduate' } }), null);

  const state = {};
  const question = 'What is your current location?';
  recordQuestionChecks(state, [{ digest: questionDigest(question), by: 'profile', topic: 'location' }], { jobId: 'job-1', at: '2026-01-01T00:00:00.000Z' });
  recordQuestionChecks(state, [{ digest: questionDigest(question), by: 'profile', topic: 'location' }], { jobId: 'job-2', at: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(questionStats(state.conflictReview), { asked: 2, distinct: 1, repeated: 1 });
  assert.ok(!JSON.stringify(state).includes('current location'), 'the ledger counts, it does not copy the question text');
});

test('prepare answers settled questions first, then blocks only a claim that cites a conflicted source', () => {
  const sources = [cvSource(TEAM_FIVE), interview(TEAM_THREE)];
  const profile = { location: 'Boston, US' };
  const packet = {
    questions: ['What is your current location?', 'When can you start?'],
    answers: [],
    resume: [{ section: 'Projects', text: 'Led the engineering work.', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }] }],
  };
  const result = prepareMemoryCheck({ packet, sources, profile });
  assert.deepEqual(result.settled.map(item => item.by), ['profile']);
  assert.deepEqual(packet.questions[0], 'When can you start?', 'the settled question is not asked');
  const conflict = packet.questions.find(question => /disagree/.test(question));
  assert.ok(conflict, 'a cited source in an open conflict adds a blocking question');
  assert.match(conflict, /how many people/);
  assert.equal(result.blocking.length, 1);
  assert.equal(result.open.length, 1);

  // A claim that cites neither side is not blocked: this packet does not use either value.
  const unrelated = { questions: [], answers: [], resume: [{ text: 'Built a test rig.', evidence: [{ sourceId: 'profile', quote: 'I owned the design and testing work.' }] }] };
  const clean = prepareMemoryCheck({ packet: unrelated, sources: [...sources, { id: 'profile', text: 'I owned the design and testing work.' }], profile });
  assert.equal(clean.blocking.length, 0);
  assert.deepEqual(unrelated.questions, []);
});

test('an excluded source causes the block without its text entering the question', () => {
  const sources = [cvSource(TEAM_FIVE), interview(TEAM_THREE)];
  const packet = { questions: [], answers: [], resume: [{ text: 'Led the engineering work.', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }] }] };
  const result = prepareMemoryCheck({ packet, sources, profile: {}, excludedSources: ['interview'] });
  assert.equal(result.blocking.length, 1);
  const question = packet.questions[0];
  assert.match(question, /how many people/);
  assert.ok(question.includes(TEAM_FIVE), 'the shared quote is named');
  assert.ok(!question.includes('3 contractors'), 'the excluded quote never enters a question');
  assert.ok(!question.includes('Your interview answers'), 'nor its label');
});

test('the decision ledger is cleaned on import and keeps only decisions, not facts', () => {
  const item = findConflicts({ sources: [cvSource(TEAM_FIVE), interview(TEAM_THREE)], profile: {} }).find(conflict => conflict.kind === 'number');
  const decision = conflictDecision(item, 'cv', '2026-01-01T00:00:00.000Z');
  const cleaned = cleanConflictReview({ decisions: [decision, { id: 'bad', sourceIds: ['cv'], quoteDigests: ['not-a-digest'], disposition: { sourceId: 'cv' } }], questionChecks: [{ digest: digest('q'), by: 'profile', at: '2026-01-02T00:00:00.000Z', jobId: 'job-1' }, { digest: 'x' }] });
  assert.equal(cleaned.decisions.length, 1);
  assert.deepEqual(cleaned.decisions[0], { ...decision, at: '2026-01-01T00:00:00.000Z' });
  assert.equal(cleaned.questionChecks.length, 1);
  assert.equal(cleanConflictReview(null), null);
});

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-memory-'));
  const calls = [];
  const agent = async (provider, instruction, data, options) => {
    calls.push({ instruction, data: JSON.parse(JSON.stringify(data ?? null)) });
    if (options?.onUsage) options.onUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reportedUsd: 0, models: ['synthetic'] });
    if (instruction.includes('Evaluate this')) return { score: 4.4, recommendation: 'Apply', summary: 'Hands-on engineering.', matches: [{ text: 'Team leadership', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }] }], gaps: [], questions: [], legitimacyNotes: [] };
    if (instruction.includes('Prepare a')) return { headline: 'Mechanical Engineering Graduate', resume: [{ section: 'Projects', text: 'Led the Northwind chassis programme.', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }] }], coverLetter: 'I would like to bring my design and testing experience to this engineering role.', answers: [{ question: 'Describe a relevant project.', answer: 'I led the Northwind chassis programme.', evidence: [{ sourceId: 'cv', quote: TEAM_FIVE }] }], questions: ['What is your current location?'] };
    if (instruction.includes('Apply the humanizer rules')) return { items: data.items.map(item => ({ id: item.id, text: item.text })), remaining: [] };
    if (instruction.includes('Review this')) return { passed: true, issues: [] };
    throw new Error('Unknown fixture instruction: ' + instruction.slice(0, 80));
  };
  const app = await createPlainhand({ root, providers: fixtureProviders, features: [], startFeatures: false, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'An engineering role designing and testing hardware. '.repeat(10), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    scanner: async () => [],
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  const ui = async (name, input) => (await app.registry.run(name, input, { actor: 'ui' })).result;
  let s = await app.workspace.load();
  await app.workspace.saveProfile({ ...s.profile, ...candidate, phone: '+1-555-0100', resume: `${TEAM_FIVE} B.S. Mechanical Engineering, Example University, 2027.` }, s.revision);
  await app.workspace.mutate(state => {
    state.provider = 'codex';
    state.conversation.push({ id: 'story-1', role: 'user', text: TEAM_THREE, at: '2026-01-01T00:00:00.000Z' });
  });
  const prepare = async (company, suffix) => {
    const { id } = await ui('jobs.add', { company, title: 'Design Engineer', url: `https://jobs.lever.co/test/${suffix}` });
    await ui('tasks.evaluate', { jobId: id }); await app.workflow.queue;
    await ui('jobs.select', { jobId: id, selected: true });
    await ui('tasks.prepare', { jobId: id }); await app.workflow.queue;
    return id;
  };
  return { app, ui, prepare, calls, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a planted conflict blocks the packet, a disposition clears it, and it stays gone after restart and import', async () => {
  const h = await harness();
  try {
    await h.ui('context.exclude', { sources: ['interview'] });
    // The local card is built from the server's own state view and keeps both quotes.
    const stateForView = await h.app.workspace.load();
    const full = await h.app.workspace.context({ ...stateForView, contextPrefs: {} });
    const card = memoryReport(stateForView, full.sources);
    assert.equal(card.conflicts.open, 1, JSON.stringify(card.conflicts));
    assert.deepEqual(card.open[0].quotes.map(quote => quote.quote), [TEAM_FIVE, TEAM_THREE], 'the card shows both quotes even when one source is excluded');
    assert.deepEqual(card.open[0].excluded, ['interview']);
    // The read action can be called by the agent, so it returns no excluded text.
    const listed = await h.ui('conflicts.list', {});
    assert.deepEqual(listed.open[0].quotes.map(quote => quote.quote), [TEAM_FIVE]);
    assert.equal(listed.open[0].redacted, true);

    const job = await h.prepare('Northwind', 'conflict-1');
    let state = await h.app.workspace.load();
    let current = state.jobs.find(item => item.id === job);
    assert.equal(current.packet.questions.filter(question => /disagree/.test(question)).length, 1, 'the cited conflict blocks');
    assert.ok(!current.packet.questions.some(question => question.includes('3 contractors')), 'the excluded quote is not asked');
    await assert.rejects(h.ui('packet.approve', { jobId: job }), /Resolve open questions/);

    const open = card.open[0];
    const decision = await h.ui('conflicts.record', { id: open.id, sourceId: 'cv' });
    assert.equal(decision.disposition.sourceId, 'cv');
    assert.ok(!JSON.stringify(decision).includes('5 engineers'));
    state = await h.app.workspace.load();
    assert.equal(state.conflictReview.decisions.length, 1);
    assert.deepEqual((await h.ui('conflicts.list', {})).open, []);

    // The same job prepared again does not regain the question.
    await h.ui('tasks.prepare', { jobId: job }); await h.app.workflow.queue;
    state = await h.app.workspace.load();
    current = state.jobs.find(item => item.id === job);
    assert.deepEqual(current.packet.questions, []);
    await h.ui('packet.approve', { jobId: job });

    // The question the profile settles was asked once, recorded, and counted when it recurred.
    const memory = state.conflictReview;
    assert.equal(questionStats(memory).asked, 2);
    assert.equal(questionStats(memory).repeated, 1);
    assert.ok(profileStrength(state).conflicts.resolved >= 1);
    const digestState = h.app.registry.digest(state);
    assert.deepEqual(digestState.memory.conflicts, { open: 0, resolved: 1 });

    // Restart: a fresh Workspace reads the same decision, and detection stays empty.
    const fresh = new Workspace(h.app.workspace.root);
    const reloaded = await fresh.load();
    assert.equal(reloaded.conflictReview.decisions[0].id, open.id);
    const freshContext = await fresh.context({ ...reloaded, contextPrefs: {} });
    assert.deepEqual(findConflicts({ sources: freshContext.sources, profile: reloaded.profile, decisions: reloaded.conflictReview.decisions }), []);

    // Import: the decision travels with its digests, so the conflict does not return.
    const exported = await exportWorkspace(fresh);
    assert.equal(exported.conflictReview.decisions.length, 1);
    const targetRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-memory-import-'));
    try {
      const target = new Workspace(targetRoot);
      const summary = await importWorkspace({ workspace: target, data: exported });
      assert.deepEqual(summary.conflicts, { decisions: 1, questions: 2 });
      const imported = await target.load();
      assert.equal(imported.conflictReview.decisions[0].id, open.id);
      const importedContext = await target.context({ ...imported, contextPrefs: {} });
      assert.deepEqual(findConflicts({ sources: importedContext.sources, profile: imported.profile, decisions: imported.conflictReview.decisions }), []);
      assert.equal(memoryReport(imported).conflicts.open, 0);
    } finally { await rm(targetRoot, { recursive: true, force: true }); }
  } finally { await h.close(); }
});

test('the prepare pre-check never sends an excluded source to the provider', async () => {
  const h = await harness();
  try {
    await h.ui('context.exclude', { sources: ['interview'], fields: ['phone'] });
    const before = h.calls.length;
    await h.prepare('Northwind', 'excluded-1');
    const sent = JSON.stringify(h.calls.slice(before));
    assert.ok(!sent.includes(TEAM_THREE.slice(0, 30)), 'the excluded story never appears in provider input');
    assert.ok(!sent.includes('+1-555-0100'), 'an excluded profile field never appears in provider input');
    const state = await h.app.workspace.load();
    const job = state.jobs[0];
    assert.equal(job.packet.questions.filter(question => /disagree/.test(question)).length, 1);
    assert.ok(!job.packet.questions.join(' ').includes('3 contractors'));
  } finally { await h.close(); }
});

test('a job title with Associate or Master is not a degree, so its dates never conflict with graduation', () => {
  const sources = [
    cvSource('Example University — Master of Science, Molecular Biology — 2012.'),
    interview('My work was at Example Genomics Lab as a Senior Research Associate (2016 to 2023).'),
    interview('I was the Scrum Master for the platform team from 2019 to 2021.'),
  ];
  assert.deepEqual(findConflicts({ sources, profile: { graduation: '2012' } }).filter(item => item.kind === 'degree'), []);
  // A real second degree with a different year at the same school still conflicts.
  const real = findConflicts({ sources: [cvSource('Example University — Master of Science — 2012.'), interview('I finished my Master of Science at Example University in 2014.')], profile: {} });
  assert.equal(real.filter(item => item.kind === 'degree').length, 1);
  // "Associate's degree" is still a degree.
  const assoc = findConflicts({ sources: [cvSource("Example College — Associate's degree in Accounting — 2010."), interview("I earned my Associate's degree in Accounting at Example College in 2011.")], profile: {} });
  assert.equal(assoc.filter(item => item.kind === 'degree').length, 1);
});

test('review 37eb4fd: "in" degree names still count; tool and job phrasing does not', () => {
  const degreeFindings = sources => findConflicts({ sources, profile: {} }).filter(item => item.kind === 'degree').length;
  assert.equal(degreeFindings([cvSource('Example College — Associate in Arts — 2012.'), interview('I finished my Associate in Arts at Example College in 2014.')]), 1);
  assert.equal(degreeFindings([cvSource('Example University — Master in Public Health — 2015.'), interview('I completed my Master in Public Health at Example University in 2016.')]), 1);
  assert.equal(degreeFindings([cvSource('Example University — Master of Science — 2012.'), interview('I used MS Excel and MS Teams at Example Health from 2018 to 2021.')]), 0);
  assert.equal(degreeFindings([cvSource('Example University — Master of Science — 2012.'), interview('I was the Scrum Master in the platform team from 2019 to 2021.'), interview('I worked as a Research Associate in Boston from 2014 to 2016.')]), 0);
});

test('review cec2918: lowercase "ms in" and "BA, pilot" are not degrees; M.Sc., MSc and BSc are', () => {
  const degree = (text, graduation = '2012') => findConflicts({ sources: [interview(text)], profile: { graduation } }).filter(item => item.kind === 'degree').length;
  assert.equal(degree('We got the response down to 50 ms in 2018.'), 0);
  assert.equal(degree('I ran the BA, pilot study in 2019.'), 0);
  assert.equal(degree('Example University — M.Sc. in Biology — 2018.'), 1);
  assert.equal(degree('Example University — MSc Biology — 2018.'), 1);
  assert.equal(degree('I hold a BSc in Physics from 2018.'), 1);
  assert.equal(degree('Example University — BS, Biology — 2018.'), 1);
});

test('review e03f483: abbreviations without regex modifiers; a degree abbreviation ends a sentence before a capital', () => {
  const degree = (text, graduation = '2012') => findConflicts({ sources: [interview(text)], profile: { graduation } }).filter(item => item.kind === 'degree').length;
  assert.equal(degree('I completed my MSc. I then worked at Example Health from 2013 to 2018.'), 0);
  assert.equal(degree('I ran the BA, Pilot study in 2019.'), 0);
  assert.equal(degree('Example University — BA, economics — 2018.'), 1);
  assert.equal(degree('In 2018 I used MS Excel.'), 0);
  // The module must load where RegExp modifiers are unsupported (Node 22).
  const source = readFileSync(new URL('../plainhand/memory-checks.mjs', import.meta.url), 'utf8');
  assert.ok(!/\(\?-?[ims]+:/.test(source), 'no inline RegExp modifiers');
});

test('review 0b20f66: a degree abbreviation keeps its field and year in one sentence', () => {
  const degree = text => findConflicts({ sources: [interview(text)], profile: { graduation: '2012' } }).filter(item => item.kind === 'degree').length;
  assert.equal(degree('Example University — M.Sc. Computer Science — 2018.'), 1);
  assert.equal(degree('I earned my MSc. in Biology at Example University in 2018.'), 1);
  assert.equal(degree('I completed my MSc. I then worked at Example Health from 2013 to 2018.'), 0);
});

test('review 4695e0d: "M.Sc. In 2019, I moved" ends the degree sentence', () => {
  const degree = text => findConflicts({ sources: [interview(text)], profile: { graduation: '2012' } }).filter(item => item.kind === 'degree').length;
  assert.equal(degree('I earned my M.Sc. In 2019, I moved to Baltimore.'), 0);
  assert.equal(degree('I earned my B.Sc. In 2019, I moved to Baltimore.'), 0);
  assert.equal(degree('Example University — M.Sc. Computer Science — 2018.'), 1);
});

test('review 2c9f88e: clause starters end the degree sentence; a year, bracket or school continues it', () => {
  const degree = text => findConflicts({ sources: [interview(text)], profile: { graduation: '2012' } }).filter(item => item.kind === 'degree').length;
  for (const text of ['I completed my MSc. Then, in 2018, I joined Example Health.', 'I completed my MSc. Later, in 2018, I joined Example Health.', 'I completed my MSc. Afterwards, in 2018, I moved.']) assert.equal(degree(text), 0, text);
  for (const text of ['I hold an M.Sc. (2018) from Example University.', 'M.Sc. 2018, Example University.', 'M.Sc. — 2018 — Example University.', 'M.Sc. Computer Science at Example University — 2018.']) assert.equal(degree(text), 1, text);
});

test('review cba3b5c: a study range graduates at its end; contrastive starters end the degree sentence', () => {
  const degree = (text, graduation = '2012') => findConflicts({ sources: [interview(text)], profile: { graduation } }).filter(item => item.kind === 'degree').length;
  assert.equal(degree('M.Sc. 2019 – 2021, Example University.', '2021'), 0);
  assert.equal(degree('Example University — MSc Biology — 2019 to 2021.', '2021'), 0);
  assert.equal(degree('Example University — MSc Biology — 2019 to 2021.', '2012'), 1);
  assert.equal(degree('I hold an M.Sc. 2019 was my first year at Example Health.'), 0);
  assert.equal(degree('I completed my MSc. However, in 2018, I joined Example Health.'), 0);
  assert.equal(degree('I completed my MSc. Therefore, in 2018, I joined.'), 0);
});
