// U03: the master resume is complete and canonical.
//
// The check is deterministic: the candidate's own resume and stories are parsed
// into roles, credentials, degrees and numbered results, and each item is either
// found in the master (with its entry index) or named as missing. The tests use
// the held-out personas, whose resumes carry three roles, a credential, a degree
// and a dated career gap, and a scripted provider that drops one old role and one
// credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { masterCompleteness, completeMasterResume } from '../plainhand/master-completeness.mjs';
import { controlledAgent } from '../plainhand/evaluation/agent.mjs';
import { PACKET_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
import { holdoutPersonas } from '../plainhand/evaluation/corpus-holdout.mjs';
import { holdout2Personas } from '../plainhand/evaluation/corpus-holdout-2.mjs';
import { jobById } from '../plainhand/evaluation/corpus.mjs';

const SEPARATOR = /\s+[—–]\s+|\s+-\s+/;
const parseHeading = line => {
  const parts = line.split(SEPARATOR).map(part => part.trim()).filter(Boolean);
  return parts.length >= 3 && /\d{4}/.test(parts.at(-1)) ? { parts, heading: { org: parts[0], title: parts[1], location: '', dates: parts.at(-1) } } : null;
};

// The persona's own resume, laid out as master entries the way a faithful draft
// would: one entry per line, role lines sharing their copied heading, education
// as a heading-only entry. Nothing here calls the completeness parser, so the
// test's "full master" is built independently of the code under test.
function masterFromResume(persona) {
  const resume = [];
  let section = '', heading = null;
  for (const raw of String(persona.profile.resume || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Experience$/i.test(line)) { section = 'experience'; heading = null; continue; }
    if (/^Certifications$/i.test(line)) { section = 'credentials'; continue; }
    if (/^Education$/i.test(line)) { section = 'education'; continue; }
    if (section === 'experience') {
      const parsed = parseHeading(line);
      if (parsed) { heading = parsed.heading; continue; }
      // A dated break is a gap, not a job; it is not a role item.
      if (/^Career break\b/i.test(line)) { heading = null; continue; }
      if (heading) resume.push({ section: 'Experience', heading, text: line });
    } else if (section === 'credentials') {
      resume.push({ section: 'Certifications', heading: null, text: line });
    } else if (section === 'education') {
      const parsed = parseHeading(line);
      if (parsed) resume.push({ section: 'Education', heading: parsed.heading, text: '' });
    }
  }
  return resume;
}

const evidence = (quote, text = quote) => [{ sourceId: 'cv', quote: text }];
function masterDraft(persona, { dropOldest = false, dropCredential = false } = {}) {
  const oldest = persona.records.at(-1);
  const credential = persona.facts.find(fact => fact.id === 'cert').text;
  const resume = masterFromResume(persona)
    .filter(entry => !(dropOldest && entry.heading?.org === oldest.employer && entry.heading?.title === oldest.title))
    .filter(entry => !(dropCredential && entry.text === credential))
    .map(entry => ({ ...entry, evidence: evidence(entry.text || `${entry.heading.org} — ${entry.heading.title} — ${entry.heading.dates}`) }));
  return {
    headline: persona.profile.roles,
    resume,
    coverLetter: `${persona.name} targets ${persona.profile.roles} roles. ${persona.profile.story}`,
    suggestions: [],
  };
}

const sourcesFor = persona => [
  { id: 'cv', text: persona.profile.resume },
  { id: 'interview', text: [...persona.facts.map(fact => fact.text), persona.profile.story].join('\n') },
];

const personas = [...holdoutPersonas, ...holdout2Personas];

test('every held-out persona has roles, a credential, a degree and numbered results, and a full master misses nothing', () => {
  for (const persona of personas) {
    const result = masterCompleteness(sourcesFor(persona), masterFromResume(persona));
    assert.ok(result.counts.roles.total >= 3, `${persona.id} has at least three roles`);
    assert.ok(result.counts.certifications.total >= 1, `${persona.id} has a credential`);
    assert.ok(result.counts.degrees.total >= 1, `${persona.id} has a degree`);
    assert.ok(result.counts.results.total >= 1, `${persona.id} has a numbered result`);
    assert.deepEqual(result.missing, [], `${persona.id}: a full master leaves nothing missing`);
    for (const item of result.items) {
      assert.equal(item.present, true, `${persona.id}: ${item.kind} ${item.label || item.text}`);
      assert.ok(Number.isInteger(item.index) && item.index >= 0 && item.index < masterFromResume(persona).length, `${persona.id}: present item reports its master entry index`);
    }
  }
});

test('a master that drops one old role and one credential lists exactly those as missing', () => {
  // These personas' oldest roles contain no number-bearing result, so the dropped
  // role is one item and its provenance is not double-counted as missing results.
  const picked = [
    holdoutPersonas.find(persona => persona.id === 'holdout-fin-controller'),
    holdoutPersonas.find(persona => persona.id === 'holdout-sre-platform'),
    holdout2Personas.find(persona => persona.id === 'holdout2-fin-close'),
    holdout2Personas.find(persona => persona.id === 'holdout2-stem-assay'),
  ];
  for (const persona of picked) {
    const oldest = persona.records.at(-1);
    const credential = persona.facts.find(fact => fact.id === 'cert').text;
    const result = masterCompleteness(sourcesFor(persona), masterDraft(persona, { dropOldest: true, dropCredential: true }).resume);
    assert.deepEqual(result.missing.map(item => `${item.kind}:${item.label || item.text}`), [
      `role:${oldest.employer} — ${oldest.title} — ${persona.profile.resume.split('\n').find(line => line.startsWith(`${oldest.employer} —`)).split(' — ').at(-1)}`,
      `credential:${credential}`,
    ], persona.id);
    assert.equal(result.counts.roles.missing, 1);
    assert.equal(result.counts.certifications.missing, 1);
    assert.equal(result.counts.degrees.missing, 0);
    assert.equal(result.counts.results.missing, 0);
  }
});

test('common resume section headings are read, not only the persona layout', () => {
  const resume = [
    'Work Experience',
    'Acme Corp — Financial Analyst — 2020 to 2022',
    'Cut the close from 9 days to 5.',
    '',
    'Certifications & Licenses',
    'CPA, 2021',
    '',
    'Education & Training',
    'Example University — B.S. Accounting — 2018',
  ].join('\n');
  const master = [
    { section: 'Experience', heading: { org: 'Acme Corp', title: 'Financial Analyst', location: '', dates: '2020 to 2022' }, text: 'Cut the close from 9 days to 5.' },
    { section: 'Certifications', heading: null, text: 'CPA, 2021' },
    { section: 'Education', heading: { org: 'Example University', title: 'B.S. Accounting', location: '', dates: '2018' }, text: '' },
  ];
  const result = masterCompleteness([{ id: 'cv', text: resume }], master);
  assert.deepEqual(result.missing, []);
  assert.equal(result.counts.roles.total, 1);
  assert.equal(result.counts.certifications.total, 1);
  assert.equal(result.counts.degrees.total, 1);
  assert.equal(result.counts.results.total, 1);
});

test('both instructions carry the role-heading and placement rules', () => {
  assert.match(STANDARD_INSTRUCTION, /Every role heading the sources state appears in the master resume/);
  assert.match(STANDARD_INSTRUCTION, /heading-only Experience entry/);
  assert.match(STANDARD_INSTRUCTION, /never invent a line of work for it/);
  assert.match(STANDARD_INSTRUCTION, /never under a made-up section name/);
  assert.match(STANDARD_INSTRUCTION, /suggestions must ask which role each such line belongs to/);
  assert.match(PACKET_INSTRUCTION, /never a separate heading-less accomplishments section/);
  assert.match(PACKET_INSTRUCTION, /never a line that only repeats the role's title/);
});

test('a resume with no section headers and several packed headings is read; a degree line is not a role', () => {
  const text = 'Example University — Master of Science, Molecular Biology — 2012. Example Bioinstruments — Applications Scientist — 2025 to 2026.';
  const parsed = masterCompleteness([{ id: 'cv', text }], []);
  assert.equal(parsed.counts.roles.total, 1, 'the dated employer — title — dates heading is a role');
  assert.equal(parsed.roles[0].org, 'Example Bioinstruments');
  assert.equal(parsed.roles[0].title, 'Applications Scientist');
  assert.equal(parsed.counts.degrees.total, 1, 'the graduation line is a degree, not a role');
  assert.equal(parsed.counts.certifications.total, 0);
  const master = [
    { section: 'Experience', heading: { org: 'Example Bioinstruments', title: 'Applications Scientist', location: '', dates: '2025 to 2026' }, text: 'Ran demonstrations.' },
    { section: 'Education', heading: { org: 'Example University', title: 'Master of Science, Molecular Biology', location: '', dates: '2012' }, text: '' },
  ];
  assert.deepEqual(masterCompleteness([{ id: 'cv', text }], master).missing, []);
});

test('the last resort derives a certification heading from the sentence, or falls back to its own clause', () => {
  const strictSentence = 'I earned a Lean Six Sigma Green Belt certification in 2019.';
  const strict = completeMasterResume([{ id: 'interview', text: strictSentence }], []);
  assert.equal(strict.added.length, 1);
  assert.deepEqual(strict.added[0].heading, { org: 'Lean Six Sigma Green Belt', title: 'Certification', location: '', dates: '2019' });
  assert.equal(strict.added[0].text, '');
  assert.deepEqual(strict.added[0].evidence, [{ sourceId: 'interview', quote: strictSentence }]);
  assert.deepEqual(strict.completeness.missing, []);
  const looseSentence = 'I am the main contact for our auditors, and I hold an active Colorado CPA license since 2025.';
  const loose = completeMasterResume([{ id: 'stories', text: looseSentence }], []);
  assert.equal(loose.added.length, 1);
  assert.ok(looseSentence.includes(loose.added[0].text), 'the fallback text is a clause of the candidate’s sentence');
  assert.match(loose.added[0].text, /CPA/);
  assert.deepEqual(loose.added[0].evidence, [{ sourceId: 'stories', quote: looseSentence }]);
  // Nothing is added when the quote cannot be found in the source exactly.
  assert.deepEqual(completeMasterResume([{ id: 'interview', text: 'Different text.' }], []).added, []);
});

async function harness({ persona, job = jobById('holdout-job-fin-forecast'), agent = null, profile = null, verifier = null }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u03-'));
  const base = agent || controlledAgent({ scenario: { id: 'u03', roleOrder: 'recent' }, persona, job });
  const app = await createPlainhand({
    root,
    providers: fixtureProviders,
    workflowOptions: {
      agent: base,
      verifier: verifier || (async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'A finance systems role. '.repeat(20), checkedAt: new Date().toISOString(), reason: 'Fixture.' })),
      renderer: async (workspace, state, job) => {
        const pdf = `output/test-${job.id}.pdf`;
        await workspace.write(pdf, 'test-pdf');
        return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] };
      },
    },
  });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...(profile || persona.profile) }, state.revision);
  await app.workspace.mutate(latest => { latest.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
  let jobCount = 0;
  const addJob = async job => (await ui('jobs.add', { company: job.company, title: job.title, url: `https://jobs.lever.co/synthetic/u03-${++jobCount}`, description: job.description, location: job.location })).result.id;
  const lastTask = async () => (await app.workspace.load()).tasks[0];
  return { app, ui, settle, addJob, lastTask, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a role and a credential the retry still leaves out are added by the deterministic last resort', async () => {
  const persona = holdoutPersonas.find(item => item.id === 'holdout-fin-controller');
  const oldest = persona.records.at(-1);
  const credential = persona.facts.find(fact => fact.id === 'cert').text;
  const base = controlledAgent({ scenario: { id: 'u03', roleOrder: 'recent' }, persona, job: jobById('holdout-job-fin-forecast') });
  const dropped = masterDraft(persona, { dropOldest: true, dropCredential: true });
  const agent = async (id, instruction, data, options) => instruction === STANDARD_INSTRUCTION ? dropped : base(id, instruction, data, options);
  const h = await harness({ persona, agent });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    const state = await h.app.workspace.load();
    assert.equal(state.standard.kind, 'master');
    assert.ok(state.standard.completeness, 'the completeness result is stored with the master');
    assert.equal(state.standard.completeness.counts.total, 8);
    assert.deepEqual(state.standard.completeness.missing, [], 'the last resort leaves nothing missing');
    // The rows it added are heading-only and carry their exact source quote: the
    // candidate's own heading line for the role, the stated sentence for the credential.
    assert.deepEqual(state.standard.repairs.map(item => item.section), ['Experience', 'Certifications']);
    const role = state.standard.draft.resume.find(entry => entry.heading?.org === oldest.employer && entry.heading?.title === oldest.title);
    assert.ok(role, 'the missing role is in the master');
    assert.equal(role.text, '');
    assert.deepEqual(role.evidence.map(e => e.quote), [persona.profile.resume.split('\n').find(line => line.startsWith(`${oldest.employer} —`))]);
    const found = state.standard.draft.resume.find(entry => entry.evidence?.some(e => e.quote === credential));
    assert.ok(found, 'the credential is in the master');
    assert.equal(found.section, 'Certifications');
    assert.ok(found.text || found.heading, 'either its own clause or its derived heading names it');
  } finally { await h.close(); }
});

test('the master keeps a role it has no line for as a heading-only entry', async () => {
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const quote = persona.profile.resume.split('\n').find(line => line.startsWith('Example Cell Analysis —'));
  const heading = { org: 'Example Cell Analysis', title: 'Research Technician', location: '', dates: '2012 to 2016' };
  const base = controlledAgent({ scenario: { id: 'u03-heading', roleOrder: 'recent' }, persona, job: jobById('holdout-job-stem-assay') });
  const agent = async (id, instruction, data, options) => instruction === STANDARD_INSTRUCTION
    ? { headline: 'Assay development scientist', resume: [{ section: 'Experience', heading, text: '', evidence: [{ sourceId: 'cv', quote }] }], coverLetter: 'I develop assays for the {role} role at {company}.', suggestions: [] }
    : base(id, instruction, data, options);
  const h = await harness({ persona, job: jobById('holdout-job-stem-assay'), agent });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const state = await h.app.workspace.load();
    const row = state.standard.draft.resume.find(entry => entry.heading?.org === 'Example Cell Analysis');
    assert.ok(row, 'the role is in the master');
    assert.equal(row.text, '', 'a role with no stated line stays heading-only');
    assert.deepEqual(row.heading, heading);
  } finally { await h.close(); }
});

test('a stated credential dropped from the first master draft is named in the one retry', async () => {
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const credential = persona.facts.find(fact => fact.id === 'cert').text;
  const base = controlledAgent({ scenario: { id: 'u03-cert', roleOrder: 'recent' }, persona, job: jobById('holdout-job-fin-forecast') });
  const prompts = [];
  const agent = async (id, instruction, data, options) => {
    const reply = await base(id, instruction, data, options);
    if (instruction !== STANDARD_INSTRUCTION) return reply;
    prompts.push(data);
    if (prompts.length > 1) return reply;
    // A first draft that silently drops the credential the candidate stated.
    return { ...reply, resume: reply.resume.filter(entry => entry.text !== credential) };
  };
  const h = await harness({ persona, agent });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    assert.equal(prompts.length, 2, 'the missing credential triggers exactly one retry');
    assert.match(prompts[1].missingFromResume.join(' '), /Lean Six Sigma Green Belt/, 'the retry names the credential');
    const state = await h.app.workspace.load();
    assert.ok(state.standard.draft.resume.some(entry => entry.text === credential), 'the credential is in the accepted master');
    assert.equal(state.standard.completeness.missing.some(item => item.text === credential), false, 'the credential is no longer listed as missing');
  } finally { await h.close(); }
});

test('preparing two tailored packets leaves the stored master byte-identical', async () => {
  const persona = holdoutPersonas.find(item => item.id === 'holdout-sre-platform');
  const job = jobById('holdout-job-tech-reliability');
  const h = await harness({ persona, job });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('standard.approve', {});
    const before = JSON.stringify((await h.app.workspace.load()).standard);
    const beforeDigest = digest((await h.app.workspace.load()).standard);
    for (const candidateJob of [job, jobById('holdout-job-tech-ml')]) {
      const jobId = await h.addJob(candidateJob);
      await h.ui('tasks.evaluate', { jobId }); await h.settle();
      await h.ui('jobs.select', { jobId, selected: true });
      await h.ui('tasks.prepare', { jobId }); await h.settle();
      const task = (await h.app.workspace.load()).tasks[0];
      assert.equal(task.status, 'complete', task.message);
      assert.ok((await h.app.workspace.load()).jobs.find(item => item.id === jobId)?.packet, 'the packet was prepared');
      const after = JSON.stringify((await h.app.workspace.load()).standard);
      assert.equal(after, before, 'tailoring does not rewrite the master');
      assert.equal(digest((await h.app.workspace.load()).standard), beforeDigest);
    }
  } finally { await h.close(); }
});

test('the 150-entry cap is gone: a 200-entry master is accepted and stored', async () => {
  const quote = 'Designed and tested a lightweight chassis for a Formula SAE team.';
  const resume = Array.from({ length: 200 }, (_, index) => ({ section: 'Experience', heading: null, text: `Maintained test rig ${index + 1} and recorded its measurements.`, evidence: [{ sourceId: 'cv', quote }] }));
  const agent = async (id, instruction, data, options) => {
    if (instruction === STANDARD_INSTRUCTION) return { headline: 'Test Graduate', resume, coverLetter: 'I would like to bring my design and testing experience to the {role} role at {company}.', suggestions: [] };
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness({ persona: null, profile: candidate, agent });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    const state = await h.app.workspace.load();
    assert.equal(state.standard.draft.resume.length, 200);
    assert.ok(state.standard.completeness, 'completeness is computed for the long master too');
  } finally { await h.close(); }
});

test('a relevant credential dropped from the packet is named in the one retry', async () => {
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const job = jobById('holdout2-job-stem-assay');
  const base = controlledAgent({ scenario: { id: 'u03-packet-cert', roleOrder: 'recent' }, persona, job });
  const prompts = [];
  let packetCalls = 0;
  const agent = async (id, instruction, data, options) => {
    const reply = await base(id, instruction, data, options);
    if (instruction !== PACKET_INSTRUCTION) return reply;
    packetCalls += 1;
    prompts.push(data);
    if (packetCalls > 1) return reply;
    // A first packet that drops the Green Belt the posting relates to process
    // improvement, although the approved master keeps it.
    return { ...reply, resume: reply.resume.filter(entry => !/Green Belt/.test(entry.text)) };
  };
  const h = await harness({ persona, job, agent, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description, checkedAt: new Date().toISOString(), reason: 'Fixture.' }) });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('standard.approve', {});
    const jobId = await h.addJob(job);
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    await h.ui('jobs.setContext', { jobId, overrideReason: 'Fixture proceeds to the packet.' });
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    assert.equal(packetCalls, 2, 'the missing relevant credential triggers exactly one retry');
    assert.match(prompts[1].missingFromResume.join(' '), /Keep the relevant credential: .*Green Belt/, 'the retry carries the credential in missingFromResume');
    assert.ok(prompts[1].reviewFeedback.some(line => /Keep the relevant credential: .*Green Belt/.test(line)), 'the retry feedback names it too');
    const prepared = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.ok(prepared.packet.resume.some(entry => /Green Belt/.test(entry.text)), 'the accepted packet keeps the credential');
  } finally { await h.close(); }
});

test('the last-pass repair runs before the review, and an omission note for a repaired row is dropped', async () => {
  const { dropRepairedOmissions } = await import('../plainhand/workflow.mjs');
  const added = [{ section: 'Certifications', heading: { org: 'Lean Six Sigma Green Belt', title: 'Certification', location: '', dates: '2019' }, text: '' }];
  assert.deepEqual(dropRepairedOmissions(['Left out the Lean Six Sigma Green Belt because no issuer is stated.', 'Consider adding the issuer of the Green Belt.', 'Left out compensation.'], added),
    ['Consider adding the issuer of the Green Belt.', 'Left out compensation.']);
  assert.deepEqual(dropRepairedOmissions(['Left out X.'], []), ['Left out X.']);

  const persona = holdoutPersonas.find(item => item.id === 'holdout-fin-controller');
  const credential = persona.facts.find(fact => fact.id === 'cert').text;
  const base = controlledAgent({ scenario: { id: 'u03', roleOrder: 'recent' }, persona, job: jobById('holdout-job-fin-forecast') });
  const dropped = masterDraft(persona, { dropOldest: true, dropCredential: true });
  const reviewed = [];
  const agent = async (id, instruction, data, options) => {
    if (instruction === STANDARD_INSTRUCTION) return dropped;
    if (data?.packet && !data?.items) reviewed.push(data.packet);
    return base(id, instruction, data, options);
  };
  const h = await harness({ persona, agent });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    const last = reviewed.at(-1);
    assert.ok(last, 'the master was reviewed');
    assert.ok(last.resume.some(entry => entry.evidence?.some(e => e.quote === credential)), 'the reviewer saw the repaired credential');
    const state = await h.app.workspace.load();
    assert.deepEqual(state.standard.repairs.map(item => item.section), ['Experience', 'Certifications']);
  } finally { await h.close(); }
});

test('the repair is idempotent for a credential sentence with context words, and field advice survives', async () => {
  const { dropRepairedOmissions } = await import('../plainhand/workflow.mjs');
  const sentence = 'I earned a Lean Six Sigma Green Belt certification in 2019 after leading the plant process-improvement program.';
  const sources = [{ id: 'interview', text: sentence }];
  const once = completeMasterResume(sources, []);
  assert.equal(once.added.length, 1);
  assert.deepEqual(once.completeness.missing, [], 'the added row satisfies its own item');
  const twice = completeMasterResume(sources, once.resume);
  assert.equal(twice.added.length, 0, 'a second pass adds nothing');
  const added = once.added;
  assert.deepEqual(dropRepairedOmissions([
    'Left out the Green Belt because no issuer is stated.',
    'Omission: Lean Six Sigma Green Belt.',
    'Lean Six Sigma Green Belt is missing the issuing body.',
    'Consider adding the missing issuer of the Lean Six Sigma Green Belt.',
  ], added), ['Lean Six Sigma Green Belt is missing the issuing body.', 'Consider adding the missing issuer of the Lean Six Sigma Green Belt.']);
});

test('a relevant credential the retry still drops is carried from the approved master', async () => {
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const job = jobById('holdout2-job-stem-assay');
  const base = controlledAgent({ scenario: { id: 'u03-packet-carry', roleOrder: 'recent' }, persona, job });
  let packetCalls = 0, reviewed = null;
  const agent = async (id, instruction, data, options) => {
    const reply = await base(id, instruction, data, options);
    if (instruction === PACKET_INSTRUCTION) {
      packetCalls += 1;
      // Both drafts drop the Green Belt and claim it was added.
      return { ...reply, resume: reply.resume.filter(entry => !/Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`)), suggestions: ['Added the Lean Six Sigma Green Belt to the resume.'] };
    }
    if (data?.packet && !data?.items && data?.job) reviewed = data.packet;
    return reply;
  };
  const h = await harness({ persona, job, agent, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description, checkedAt: new Date().toISOString(), reason: 'Fixture.' }) });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('standard.approve', {});
    const jobId = await h.addJob(job);
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    await h.ui('jobs.setContext', { jobId, overrideReason: 'Fixture proceeds to the packet.' });
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    const task = await h.lastTask();
    assert.equal(task.status, 'complete', task.message);
    assert.equal(packetCalls, 2);
    const state = await h.app.workspace.load();
    const prepared = state.jobs.find(item => item.id === jobId);
    const masterRow = state.standard.draft.resume.find(entry => /Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`));
    const carried = prepared.packet.resume.find(entry => /Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`));
    assert.ok(carried, 'the packet carries the credential');
    assert.deepEqual(carried.evidence, masterRow.evidence, 'with the master row\'s exact quote');
    assert.ok(reviewed.resume.some(entry => /Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`)), 'the reviewer saw it');
    // A revision that asks to remove it is the candidate's choice: nothing is carried back.
    await h.ui('jobs.approve', { jobId }).catch(() => {});
    await h.ui('tasks.revise', { jobId, request: 'Remove the Green Belt from the resume.' }); await h.settle();
    const revised = await h.lastTask();
    assert.equal(revised.status, 'complete', revised.message);
    const after = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.ok(!after.packet.resume.some(entry => /Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`)), 'the revision keeps it out');
  } finally { await h.close(); }
});

test('a revision that removes a credential is not asked to keep it, even by a drafter that obeys the retry', async () => {
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const job = jobById('holdout2-job-stem-assay');
  const base = controlledAgent({ scenario: { id: 'u03-revise-obey', roleOrder: 'recent' }, persona, job });
  const greenBelt = entry => /Green Belt/.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`);
  const revisionPrompts = [];
  const agent = async (id, instruction, data, options) => {
    const reply = await base(id, instruction, data, options);
    if (instruction !== PACKET_INSTRUCTION || !data?.revisionRequest) return reply;
    revisionPrompts.push(data);
    // A drafter that removes the credential as asked, but restores it if told to keep it.
    const keep = (data.missingFromResume || []).some(line => /Green Belt/.test(line));
    return keep ? reply : { ...reply, resume: reply.resume.filter(entry => !greenBelt(entry)) };
  };
  const h = await harness({ persona, job, agent, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description, checkedAt: new Date().toISOString(), reason: 'Fixture.' }) });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    await h.ui('standard.approve', {});
    const jobId = await h.addJob(job);
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    await h.ui('jobs.setContext', { jobId, overrideReason: 'Fixture proceeds to the packet.' });
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    await h.ui('tasks.revise', { jobId, request: 'Remove the Green Belt from the resume.' }); await h.settle();
    const revised = await h.lastTask();
    assert.equal(revised.status, 'complete', revised.message);
    assert.ok(revisionPrompts.length >= 1);
    assert.ok(revisionPrompts.every(data => !(data.missingFromResume || []).length), 'no keep-the-credential instruction on a revision');
    const after = (await h.app.workspace.load()).jobs.find(item => item.id === jobId);
    assert.ok(!after.packet.resume.some(greenBelt), 'the revised packet leaves it out');
    assert.ok(!after.packet.suggestions.some(text => /Left out: .*Green Belt/.test(text)), 'and does not note it as missing');
  } finally { await h.close(); }
});

test('a carried credential keeps its master wording through the humanizer, and is carried once', async () => {
  const { HUMANIZE_INSTRUCTION } = await import('../plainhand/humanize.mjs');
  const persona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const job = jobById('holdout2-job-stem-assay');
  const base = controlledAgent({ scenario: { id: 'u03-carry-humanize', roleOrder: 'recent' }, persona, job });
  const greenBelt = entry => /Green Belt/i.test(`${entry.text} ${entry.heading?.org || ''} ${entry.heading?.title || ''}`);
  let preparing = false;
  const agent = async (id, instruction, data, options) => {
    const reply = await base(id, instruction, data, options);
    if (instruction === PACKET_INSTRUCTION) { preparing = true; return { ...reply, resume: reply.resume.filter(entry => !greenBelt(entry)) }; }
    // A humanizer that rewords the credential line.
    if (instruction === HUMANIZE_INSTRUCTION && preparing) return { ...reply, items: reply.items.map(item => /Green Belt/.test(item.text) ? { ...item, text: item.text.replace(/Lean Six Sigma Green Belt/, 'six sigma green-belt') } : item) };
    return reply;
  };
  const h = await harness({ persona, job, agent, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description, checkedAt: new Date().toISOString(), reason: 'Fixture.' }) });
  try {
    await h.ui('tasks.standard', {}); await h.settle();
    await h.ui('standard.approve', {});
    const jobId = await h.addJob(job);
    await h.ui('tasks.evaluate', { jobId }); await h.settle();
    await h.ui('jobs.setContext', { jobId, overrideReason: 'Fixture proceeds to the packet.' });
    await h.ui('jobs.select', { jobId, selected: true });
    await h.ui('tasks.prepare', { jobId }); await h.settle();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    const state = await h.app.workspace.load();
    const masterRow = state.standard.draft.resume.find(greenBelt);
    const rows = state.jobs.find(item => item.id === jobId).packet.resume.filter(greenBelt);
    assert.equal(rows.length, 1, 'carried once');
    assert.equal(rows[0].text, masterRow.text, 'with the approved wording');
    assert.ok(!state.jobs.find(item => item.id === jobId).packet.suggestions.some(text => /Left out: .*Green Belt/.test(text)), 'and no false omission note');
  } finally { await h.close(); }
});

test('two credentials citing one source sentence are each carried and restored to their own row', async () => {
  const COMBINED = 'Certified Public Accountant (CPA), Ohio, 2015, and Lean Six Sigma Green Belt, 2019.';
  const CPA_ROW = 'Certified Public Accountant (CPA), Ohio, 2015';
  const GB_ROW = 'Lean Six Sigma Green Belt, 2019';
  const basePersona = holdout2Personas.find(item => item.id === 'holdout2-stem-assay');
  const persona = {
    ...basePersona,
    profile: { ...basePersona.profile, resume: basePersona.profile.resume.split('\n').map(line => /Green Belt/.test(line) ? COMBINED : line).join('\n') },
    facts: basePersona.facts.map(fact => fact.id === 'cert' ? { ...fact, text: COMBINED } : fact),
  };
  const baseJob = jobById('holdout2-job-stem-assay');
  const job = { ...baseJob, description: `${baseJob.description} CPA audit exposure and process improvement leadership are required.` };
  const cert = text => ({ section: 'Certifications', heading: null, text, evidence: [{ sourceId: 'cv', quote: COMBINED }] });
  for (const keeps of ['cpa', 'none']) {
    const base = controlledAgent({ scenario: { id: `u03-shared-quote-${keeps}`, roleOrder: 'recent' }, persona, job });
    const agent = async (id, instruction, data, options) => {
      const reply = await base(id, instruction, data, options);
      if (instruction === STANDARD_INSTRUCTION) return { ...reply, resume: [...reply.resume.filter(entry => !/Green Belt|CPA/.test(entry.text)), cert(CPA_ROW), cert(GB_ROW)] };
      if (instruction === PACKET_INSTRUCTION) return { ...reply, resume: [...reply.resume.filter(entry => !/Green Belt|CPA/.test(entry.text)), ...(keeps === 'cpa' ? [cert(CPA_ROW)] : [])] };
      return reply;
    };
    const h = await harness({ persona, job, agent, profile: persona.profile, verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: job.description, checkedAt: new Date().toISOString(), reason: 'Fixture.' }) });
    try {
      await h.ui('tasks.standard', {}); await h.settle();
      await h.ui('standard.approve', {});
      const jobId = await h.addJob(job);
      await h.ui('tasks.evaluate', { jobId }); await h.settle();
      await h.ui('jobs.setContext', { jobId, overrideReason: 'Fixture proceeds to the packet.' });
      await h.ui('jobs.select', { jobId, selected: true });
      await h.ui('tasks.prepare', { jobId }); await h.settle();
      assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
      const packet = (await h.app.workspace.load()).jobs.find(item => item.id === jobId).packet;
      const texts = packet.resume.filter(entry => /Green Belt|CPA/.test(entry.text)).map(entry => entry.text).sort();
      assert.deepEqual(texts, [CPA_ROW, GB_ROW].sort(), `${keeps}: each credential once, in its own wording`);
      assert.ok(!packet.suggestions.some(text => /^Left out: /.test(text)), `${keeps}: no false omission note`);
    } finally { await h.close(); }
  }
});
