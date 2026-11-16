// Scope and structure: an item's own evidence is the reference for its count; the
// packet array is normalised before humanize and review so review keys and the
// rendered document describe the same entries; a relevant credential is kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlainhand } from '../plainhand-server.mjs';
import { digest } from '../plainhand/store.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { PACKET_INSTRUCTION, REVIEW_INSTRUCTION, STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
import { HUMANIZE_INSTRUCTION } from '../plainhand/humanize.mjs';
import { normalizeResume, groupEntries } from '../plainhand/resume-format.mjs';
import { pluralScopeIssues, scopeRetryFeedback, scopeSuggestions } from '../plainhand/scope-checks.mjs';
import { CREDENTIAL_ASSOCIATIONS, credentialRelevant, masterCredentials, relevantMissingCredentials } from '../plainhand/credential-relevance.mjs';

const evidence = quote => [{ sourceId: 'cv', quote }];
const EXPERIENCE = { org: 'Synthetic Engineering', title: 'Product Engineer', location: '', dates: '2023 to 2026' };
const EDUCATION = { org: 'Example University', title: 'B.S. Mechanical Engineering', location: '', dates: '2027' };
const ASSAY = 'Developed a cell-based potency assay that cut turnaround from 5 days to 2.';
const CHASSIS = 'Designed and tested a lightweight chassis for a Formula SAE team.';
const SUSPENSION = 'Coordinated three sophomores on the suspension sub-team.';
const SOLIDWORKS = 'Used SolidWorks for CAD.';
const MATLAB = 'Used MATLAB for analysis.';
const PROFILE_RESUME = [
  'Synthetic Engineering, Product Engineer, 2023 to 2026.',
  ASSAY,
  CHASSIS,
  SUSPENSION,
  SOLIDWORKS,
  MATLAB,
  'B.S. Mechanical Engineering, Example University, 2027.',
].join('\n');

async function harness(base = fixtureAgent) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-scope-'));
  const inputs = [];
  const agent = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return base(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'Design and test hardware for this engineering role. '.repeat(8), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate, resume: PROFILE_RESUME }, state.revision);
  await app.workspace.mutate(s => { s.provider = 'codex'; });
  const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
  const settle = async () => { for (let i = 0; i < 6; i++) await app.workflow.queue; };
  let n = 0;
  const addJob = async () => { n += 1; return (await ui('jobs.add', { company: 'Test Company', title: `Graduate Engineer ${n}`, url: `https://jobs.lever.co/test/scope-${n}` })).result.id; };
  const lastTask = async () => (await app.workspace.load()).tasks[0];
  const prepare = async ({ master = false } = {}) => {
    if (master) { await ui('tasks.standard', {}); await settle(); await ui('standard.approve', {}); }
    const jobId = await addJob();
    await ui('tasks.evaluate', { jobId }); await settle();
    await ui('jobs.select', { jobId, selected: true });
    await ui('tasks.prepare', { jobId }); await settle();
    return { jobId, job: (await app.workspace.load()).jobs.find(item => item.id === jobId) };
  };
  return { app, ui, settle, prepare, inputs, lastTask, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('the plural check flags only a plural the item evidence never uses', () => {
  const packet = text => ({ resume: [{ section: 'Experience', text, evidence: evidence(ASSAY) }], answers: [], coverLetter: '' });
  const flagged = pluralScopeIssues(packet('Developed cell-based potency assays that cut turnaround.'));
  assert.deepEqual(flagged.map(issue => [issue.kind, issue.index, issue.word, issue.singular]), [['resume', 0, 'assays', 'assay']]);
  assert.match(scopeRetryFeedback(flagged)[1], /Resume entry 1/);
  assert.match(scopeRetryFeedback(flagged)[1], /"assays" must stay "assay"/);
  assert.match(scopeSuggestions(flagged)[0], /not a factual issue/);

  // A plural the evidence itself uses is supported, with or without a number.
  assert.deepEqual(pluralScopeIssues({ resume: [{ section: 'Experience', text: 'Ran three programmes.', evidence: evidence('Ran three programmes.') }], answers: [], coverLetter: '' }), []);
  assert.deepEqual(pluralScopeIssues({ resume: [{ section: 'Experience', text: 'Developed two assays.', evidence: evidence('Developed two assays.') }], answers: [], coverLetter: '' }), []);
  // Uncountable and plural-only nouns never look like a count change.
  assert.deepEqual(pluralScopeIssues({ resume: [{ section: 'Experience', text: 'Ran trainings for the lab.', evidence: evidence('Ran training for the lab.') }], answers: [], coverLetter: '' }), []);
  assert.deepEqual(pluralScopeIssues({ resume: [{ section: 'Experience', text: 'Listed credentials.', evidence: evidence('Listed a credential.') }], answers: [], coverLetter: '' }), []);
  // A third-person verb is not a plural noun.
  assert.deepEqual(pluralScopeIssues({ resume: [{ section: 'Experience', text: 'The method develops quickly.', evidence: evidence('I develop the method.') }], answers: [], coverLetter: '' }), []);
});

test('both instructions state the exact-count rule; the packet keeps relevant credentials', () => {
  const rule = 'Keep counts and number exactly as the sources state. One assay stays "an assay" or "a potency assay", never "assays". A single project, system or team is never pluralised. The job\'s vocabulary may name the kind of work, but it never changes how many.';
  assert.ok(PACKET_INSTRUCTION.includes(rule));
  assert.ok(STANDARD_INSTRUCTION.includes(rule));
  assert.ok(PACKET_INSTRUCTION.includes('A credential the posting names or relates to is always kept in the resume.'));
  assert.ok(PACKET_INSTRUCTION.includes('When INPUT.missingFromResume is present, it lists credentials the posting names or relates to that the previous packet left out: keep each in the resume.'));
});

test('normalisation makes each section contiguous and regroups a heading repeated around another entry', () => {
  const rows = [
    { section: 'Experience', heading: EXPERIENCE, text: CHASSIS },
    { section: 'Skills', heading: null, text: SOLIDWORKS },
    { section: 'Experience', heading: EXPERIENCE, text: SUSPENSION },
    { section: 'Skills', heading: null, text: MATLAB },
  ];
  const out = normalizeResume(rows);
  assert.deepEqual(out.map(entry => entry.section), ['Experience', 'Experience', 'Skills', 'Skills']);
  assert.deepEqual(out.map(entry => entry.text), [CHASSIS, SUSPENSION, SOLIDWORKS, MATLAB]);
  const sections = groupEntries(out);
  assert.deepEqual(sections.map(section => [section.name, section.blocks.length, section.blocks[0].lines.length]), [['Experience', 1, 2], ['Skills', 1, 2]]);
});

test('a placeholder heading is dropped when its section has a real heading, and repeated placeholders group', () => {
  const rows = [
    { section: 'Experience', heading: EXPERIENCE, text: CHASSIS },
    { section: 'Experience', heading: { org: 'Experience', title: '', location: '', dates: '' }, text: SUSPENSION },
  ];
  const out = normalizeResume(rows);
  assert.deepEqual(out.map(entry => entry.heading), [EXPERIENCE, null]);

  const placeholderOnly = [
    { section: 'Projects', heading: { org: 'Role', title: '', location: '', dates: '' }, text: SOLIDWORKS },
    { section: 'Projects', heading: { org: 'Role', title: '', location: '', dates: '' }, text: MATLAB },
  ];
  const kept = normalizeResume(placeholderOnly);
  assert.deepEqual(kept.map(entry => entry.heading.org), ['Role', 'Role'], 'without a real heading the placeholder is the only structure');
  assert.equal(groupEntries(kept)[0].blocks.length, 1, 'identical placeholders still group into one block');
});

test('one packet draft stretches to assays; the existing retry keeps the source count and review never sees the stretch', async () => {
  let packetCalls = 0, reviewCalls = 0;
  const master = {
    headline: 'Mechanical Engineering Graduate',
    resume: [
      { section: 'Experience', heading: EXPERIENCE, text: ASSAY, evidence: evidence(ASSAY) },
      { section: 'Education', heading: EDUCATION, text: '', evidence: evidence('B.S. Mechanical Engineering, Example University, 2027.') },
    ],
    coverLetter: 'I am applying for this engineering role at {company}.',
    suggestions: [],
  };
  const packet = text => ({
    headline: 'Mechanical Engineering Graduate',
    resume: [{ section: 'Experience', heading: EXPERIENCE, text, evidence: evidence(ASSAY) }],
    coverLetter: 'I want to bring my assay work to this engineering role.',
    answers: [], questions: [], suggestions: [],
  });
  const agent = async (id, instruction, data, options) => {
    if (instruction === STANDARD_INSTRUCTION) return master;
    if (instruction === PACKET_INSTRUCTION) { packetCalls += 1; return packet(packetCalls === 1 ? 'Developed cell-based potency assays that cut turnaround.' : 'Developed the cell-based potency assay that cut turnaround.'); }
    if (instruction === REVIEW_INSTRUCTION) { if (data?.job?.company !== '{company}') reviewCalls += 1; return { passed: true, issues: [] }; }
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness(agent);
  try {
    const { job } = await h.prepare({ master: true });
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.equal(packetCalls, 2, 'exactly one retry for the scope finding');
    assert.equal(reviewCalls, 1, 'the check runs before review, so the stretched draft was never reviewed');
    const retry = h.inputs.filter(call => call.instruction === PACKET_INSTRUCTION)[1].data;
    assert.ok(retry.reviewFeedback.some(line => line.includes('"assays" must stay "assay"')), 'the retry names the word and the line');
    assert.match(retry.reviewFeedback.join(' '), /Resume entry 1/);
    assert.ok(job.packet.resume.some(entry => entry.text.includes('the cell-based potency assay')), 'the accepted packet keeps the source count');
    assert.ok(!job.packet.suggestions.some(line => line.startsWith('Scope check')), 'a corrected draft needs no scope suggestion');
  } finally { await h.close(); }
});

test('the packet array is normalised before humanize and review, so their resume indexes agree', async () => {
  let packetCalls = 0;
  const agent = async (id, instruction, data, options) => {
    if (instruction === PACKET_INSTRUCTION) {
      packetCalls += 1;
      return {
        headline: 'Mechanical Engineering Graduate',
        resume: [
          { section: 'Experience', heading: EXPERIENCE, text: CHASSIS, evidence: evidence(CHASSIS) },
          { section: 'Skills', heading: null, text: SOLIDWORKS, evidence: evidence(SOLIDWORKS) },
          { section: 'Experience', heading: EXPERIENCE, text: SUSPENSION, evidence: evidence(SUSPENSION) },
          { section: 'Skills', heading: null, text: MATLAB, evidence: evidence(MATLAB) },
        ],
        coverLetter: 'I designed and tested a chassis, and I want to do that here.',
        answers: [], questions: [], suggestions: [],
      };
    }
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness(agent);
  try {
    const { job } = await h.prepare();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.equal(packetCalls, 1, 'normalisation adds no model call');
    assert.deepEqual(job.packet.resume.map(entry => entry.text), [CHASSIS, SUSPENSION, SOLIDWORKS, MATLAB], 'each section is one contiguous run');
    const humanized = h.inputs.filter(call => call.instruction === HUMANIZE_INSTRUCTION).at(-1).data.items.filter(item => item.id.startsWith('resume:')).map(item => item.text);
    assert.deepEqual(humanized, [CHASSIS, SUSPENSION, SOLIDWORKS, MATLAB], 'the humanizer sees the same order');
    const reviewed = h.inputs.filter(call => call.instruction === REVIEW_INSTRUCTION).at(-1).data.packet.resume.map(entry => entry.text);
    assert.deepEqual(reviewed, [CHASSIS, SUSPENSION, SOLIDWORKS, MATLAB], 'review keys name the same entries');
  } finally { await h.close(); }
});

test('credential relevance uses the posting words and a small documented association table', () => {
  const master = { resume: [
    { section: 'Certifications', heading: null, text: 'Certified Kubernetes Security Specialist (CKS), 2023.' },
    { section: 'Certifications', heading: null, text: 'I earned a Lean Six Sigma Green Belt certification in 2019.' },
    { section: 'Certifications', heading: null, text: 'Certified Public Accountant (CPA), active since 2025.' },
    { section: 'Education', heading: null, text: 'Google Data Analytics Certificate — 2026' },
    { section: 'Education', heading: EDUCATION, text: '', evidence: evidence('B.S. Mechanical Engineering, Example University, 2027.') },
  ] };
  const credentials = masterCredentials(master.resume).map(item => item.text);
  assert.equal(credentials.length, 4, 'degrees are not credentials');
  assert.ok(credentials.includes('Certified Kubernetes Security Specialist (CKS), 2023.'));
  assert.equal(credentialRelevant(credentials[0], 'Kubernetes experience is a plus.'), true);
  assert.equal(credentialRelevant(credentials[0], 'Mechanical design with CAD.'), false);
  assert.equal(credentialRelevant(credentials[1], 'Process improvement training such as Six Sigma is valued.'), true);
  assert.equal(credentialRelevant(credentials[2], 'Support the annual audit.'), true);
  assert.equal(credentialRelevant(credentials[3], 'Data analyst with SQL.'), true);
  assert.ok(CREDENTIAL_ASSOCIATIONS.some(rule => rule.kind === 'Kubernetes'));

  const kubernetes = { resume: [{ section: 'Certifications', heading: null, text: 'CKS' }] };
  assert.deepEqual(relevantMissingCredentials({ master, sources: [], packet: kubernetes, jobText: 'Kubernetes experience is a plus.' }), []);
  const missing = relevantMissingCredentials({ master, sources: [], packet: { resume: [] }, jobText: 'Process improvement training such as Six Sigma is valued.' });
  assert.deepEqual(missing.map(item => item.label), ['I earned a Lean Six Sigma Green Belt certification in 2019.']);
});
