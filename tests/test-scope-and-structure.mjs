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

async function harness(base = fixtureAgent, profile = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-scope-'));
  const inputs = [];
  const agent = async (id, instruction, data, options) => { inputs.push({ instruction, data }); return base(id, instruction, data, options); };
  const app = await createPlainhand({ root, providers: fixtureProviders, workflowOptions: {
    agent,
    verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'Design and test hardware for this engineering role. '.repeat(8), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
    renderer: async (workspace, state, job) => { const pdf = `output/test-${job.id}.pdf`; await workspace.write(pdf, 'test-pdf'); return { pdf, pdfHash: digest(Buffer.from('test-pdf')), artifacts: [pdf] }; },
  } });
  const state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate, ...profile, resume: profile.resume || PROFILE_RESUME }, state.revision);
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
  const rule = 'Keep counts and number exactly as the sources state, and never state a count, as a digit or a word such as "one" or "two", that the sources';
  const rest = 'One assay stays "an assay" or "a potency assay", never "assays". A single project, system or team is never pluralised. The job\'s vocabulary may name the kind of work, but it never changes how many.';
  assert.ok(PACKET_INSTRUCTION.includes(rest) && STANDARD_INSTRUCTION.includes(rest));
  assert.ok(PACKET_INSTRUCTION.includes(rule));
  assert.ok(STANDARD_INSTRUCTION.includes(rule));
  assert.ok(!STANDARD_INSTRUCTION.includes('or the posting do not state'), 'the master has no posting');
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

test('an accomplishment in a heading-less section moves under the only role, and a title repeat is dropped', async () => {
  let packetCalls = 0;
  const agent = async (id, instruction, data, options) => {
    if (instruction === PACKET_INSTRUCTION) {
      packetCalls += 1;
      return {
        headline: 'Graduate Engineer',
        resume: [
          { section: 'Experience', heading: EXPERIENCE, text: 'Product Engineer.', evidence: evidence(ASSAY) },
          { section: 'Research Accomplishments', heading: null, text: CHASSIS, evidence: evidence(CHASSIS) },
        ],
        coverLetter: 'I designed and tested a chassis and want to do that in this engineering role.',
        answers: [], questions: [], suggestions: [],
      };
    }
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness(agent);
  try {
    const { job } = await h.prepare();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.equal(packetCalls, 1, 'the repair is local and spends no model call');
    assert.deepEqual(job.packet.resume.map(entry => [entry.section, entry.heading?.title, entry.text]), [['Experience', 'Product Engineer', CHASSIS]]);
  } finally { await h.close(); }
});

test('with several roles the placement is named in the one retry instead of guessed', async () => {
  const resume = `${PROFILE_RESUME}\nSynthetic Analytics, Data Analyst, 2018 to 2020.`;
  const other = { org: 'Synthetic Analytics', title: 'Data Analyst', location: '', dates: '2018 to 2020' };
  let packetCalls = 0;
  const agent = async (id, instruction, data, options) => {
    if (instruction === PACKET_INSTRUCTION) {
      packetCalls += 1;
      const base = { headline: 'Graduate Engineer', coverLetter: 'I designed and tested a chassis for this engineering role.', answers: [], questions: [], suggestions: [] };
      if (packetCalls === 1) {
        return { ...base, resume: [
          { section: 'Experience', heading: EXPERIENCE, text: CHASSIS, evidence: evidence(CHASSIS) },
          { section: 'Experience', heading: other, text: SUSPENSION, evidence: evidence(SUSPENSION) },
          { section: 'Research Accomplishments', heading: null, text: SOLIDWORKS, evidence: evidence(SOLIDWORKS) },
        ] };
      }
      return { ...base, resume: [
        { section: 'Experience', heading: EXPERIENCE, text: CHASSIS, evidence: evidence(CHASSIS) },
        { section: 'Experience', heading: EXPERIENCE, text: SOLIDWORKS, evidence: evidence(SOLIDWORKS) },
        { section: 'Experience', heading: other, text: SUSPENSION, evidence: evidence(SUSPENSION) },
      ] };
    }
    return fixtureAgent(id, instruction, data, options);
  };
  const h = await harness(agent, { resume });
  try {
    const { job } = await h.prepare();
    assert.equal((await h.lastTask()).status, 'complete', (await h.lastTask()).message);
    assert.equal(packetCalls, 2, 'the ambiguous placement costs exactly one retry');
    const retry = h.inputs.filter(call => call.instruction === PACKET_INSTRUCTION)[1].data;
    const feedback = retry.reviewFeedback.join(' ');
    assert.match(feedback, /cannot be placed automatically/);
    assert.match(feedback, /Synthetic Engineering — Product Engineer/);
    assert.match(feedback, /Synthetic Analytics — Data Analyst/);
    const loose = job.packet.resume.find(entry => entry.text === SOLIDWORKS);
    assert.equal(loose.heading.org, 'Synthetic Engineering', 'the retry placed the line under the role it belongs to');
    assert.ok(!job.packet.suggestions.some(line => line.startsWith('Check role placement')), 'a corrected draft needs no placement suggestion');
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

test('a packet credential is matched by its own name, not by word overlap', async () => {
  const { packetHasCredential, relevantMissingCredentials } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  // Split across lines: the CFA is still there.
  const fin = [{ section: 'Certifications', heading: null, text: 'Passed CFA Level I in 2024; registered for Level II.' }, { section: 'Skills', heading: null, text: 'Advanced Excel; SQL; Power Query.' }];
  assert.equal(packetHasCredential({ text: 'Passed CFA Level I in 2024; registered for Level II. Advanced Excel and SQL.' }, fin), true);
  // Scattered words are not the certificate.
  const skills = [{ section: 'Skills', heading: null, text: 'SQL; Google Sheets; data analytics dashboards.' }];
  assert.equal(packetHasCredential({ text: 'Google Data Analytics Certificate — 2026' }, skills), false);
  assert.equal(packetHasCredential({ text: 'Google Data Analytics Certificate — 2026' }, [{ section: 'Certifications', heading: { org: 'Google', title: 'Data Analytics Professional Certificate', location: '', dates: '2026' }, text: '' }]), true);
  const master = { resume: [{ section: 'Certifications', heading: null, text: 'Google Data Analytics Certificate — 2026', evidence: [] }] };
  assert.equal(relevantMissingCredentials({ master, packet: { resume: skills }, jobText: 'A data analytics role.' }).length, 1);
  // A note that claims a credential was kept is dropped when one is missing; advice stays.
  assert.deepEqual(dropCredentialInclusionClaims(['The certificate is retained because the posting names data work.', 'Consider adding the certificate date.', 'Left out the older role.']),
    ['Consider adding the certificate date.', 'Left out the older role.']);
});

test('review 37eb4fd: written names, issuer acronyms, tool acronyms, claim notes, register rate', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const { voiceTargetOf } = await import('../plainhand/voice-target.mjs');
  const cert = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt (CSSGB), 2019' }, cert('Lean Six Sigma Green Belt, 2019')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMP), PMI, 2021' }, cert('PMP, 2021')), true);
  assert.equal(packetHasCredential({ text: 'Certified Information Systems Security Professional (CISSP), (ISC)2, 2021' }, cert('CISSP, 2021')), true);
  // A tool acronym in Skills is not the certification.
  assert.equal(packetHasCredential({ text: 'AWS Certified Solutions Architect – Associate, 2023' }, [{ section: 'Skills', heading: null, text: 'AWS, Terraform, Python' }]), false);
  const missing = [{ text: 'Google Data Analytics Certificate — 2026' }];
  assert.deepEqual(dropCredentialInclusionClaims([
    'Certification is included with its stated year.',
    'The resume shows US work authorization, so the clearance question applies.',
    'SQL is listed under Skills with three years of use.',
    'The Google Data Analytics work is listed first.',
  ], missing), ['The resume shows US work authorization, so the clearance question applies.', 'SQL is listed under Skills with three years of use.']);
  // Mixed samples: a formal voice gets only formal phrases, and the rate is capped
  // at one phrase per sentence.
  const target = voiceTargetOf([
    'I am writing regarding the test campaign. Furthermore, the results are approximately consistent with the predictions, and validation shall be required prior to the final report. Please find the documentation attached for your consideration.',
    "Quick note: I'm just checking in, and it's actually going pretty well, you know.",
  ]);
  assert.equal(target.register, 'formal');
  assert.ok(target.registerPhrases.every(item => item.register === 'formal'));
  assert.ok(target.registerRate > 0 && target.registerRate <= Math.round(1000 / target.sentenceLength) / 10);
});

test('review cec2918: own-name credential matching, carried-row notes, negated notes, scope quotes', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropRepairedOmissions, dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const { scopeSuggestions } = await import('../plainhand/scope-checks.mjs');
  const row = (section, text) => ({ section, heading: null, text });
  // A bullet with the field words is not the credential.
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMP), PMI, 2021' }, [row('Summary', 'Led project management for a 12-person team')]), false);
  assert.equal(packetHasCredential({ text: 'Certified Information Systems Security Professional (CISSP), (ISC)2, 2021' }, [row('Experience', 'Owned information systems security for the division')]), false);
  // Another credential from the same issuer is not this one.
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMP), PMI, 2021' }, [row('Certifications', 'Certified Associate in Project Management (CAPM), PMI, 2022')]), false);
  assert.equal(packetHasCredential({ text: 'AWS Certified Solutions Architect – Associate, 2023' }, [row('Certifications', 'AWS Certified Cloud Practitioner, 2022')]), false);
  // The same line under Education is present.
  assert.equal(packetHasCredential({ text: 'PMP, 2021' }, [row('Education', 'PMP, 2021')]), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMP), PMI, 2021' }, [row('Certifications', 'PMP, 2021')]), true);
  // An acronym-only carried row still drops the omission note about it.
  assert.deepEqual(dropRepairedOmissions(['Left out the PMP because the role does not name it.', 'Left out the older role.'], [row('Certifications', 'PMP, 2021')]), ['Left out the older role.']);
  // Case-insensitive acronym; a negated inclusion reports an omission and stays.
  assert.deepEqual(dropCredentialInclusionClaims(['The pmp is included with its year.', 'The certificate was not added because no date is stated.'], [{ text: 'PMP, 2021' }]),
    ['The certificate was not added because no date is stated.']);
  // A long line is quoted around the flagged word.
  const long = `${'Ran the weekly quality control panel and maintained the cell culture lines for the group, '.repeat(3)}and validated two assays.`;
  const [note] = scopeSuggestions([{ kind: 'resume', index: 0, text: long, word: 'assays', singular: 'assay' }]);
  assert.match(note, /"[^"]*assays[^"]*" says "assays"/);
});

test('review e03f483: acronyms inside names, generic suffixes, Registered titles, issuers, negated clauses', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const r = (section, text) => [{ section, heading: null, text }];
  const cases = [
    ['Kubernetes CKA (2023)', r('Certifications', 'CKA (2023)'), true],
    ['Passed CFA Level I in 2024; registered for Level II.', r('Certifications', 'CFA Level II candidate; passed Level I in 2024'), true],
    ['Six Sigma Green Belt (ASQ CSSGB), 2019', r('Certifications', 'CSSGB, 2019'), true],
    ['PE license, Texas', r('Summary', 'I ran PE, pilot programs in Texas in 2019'), false],
    ['CPA license, State of Colorado, active since 2025.', r('Skills', 'I supported CPA firm audits and Colorado clients'), false],
    ['PE license, Texas', r('Licenses', 'PE, Texas'), true],
    ['Registered Nurse (RN) license, Ohio, 2018', r('Licenses', 'Registered Nurse license, Ohio, 2018'), true],
    ['Certified Information Systems Security Professional (CISSP), (ISC)2, 2021', r('Certifications', 'ISC'), false],
  ];
  for (const [master, packet, expected] of cases) assert.equal(packetHasCredential({ text: master }, packet), expected, master);
  assert.deepEqual(dropCredentialInclusionClaims(["The certificate wasn't added because no date is stated.", 'The certificate was not formally listed.', 'The CPA is included with its year, but the CFP was not added.'], [{ text: 'CPA, 2021' }]),
    ["The certificate wasn't added because no date is stated.", 'The certificate was not formally listed.']);
});

test('review 0b20f66: issuer fields, issuer-first names, spaced groups, appositive claims', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const r = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt, ASQ (CSSGB), 2019' }, r('CSSGB, 2019')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional, PMI (PMP), 2021' }, r('PMP, 2021')), true);
  assert.equal(packetHasCredential({ text: '(ISC)2 CISSP, 2021' }, r('CISSP, 2021')), true);
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt (ASQ CSSGB), 2019' }, r('ASQ member since 2019')), false);
  assert.equal(packetHasCredential({ text: 'Certified Information Systems Security Professional (CISSP), (ISC)2, 2021' }, r('ISC')), false);
  assert.deepEqual(dropCredentialInclusionClaims(['The PMP, which PMI issues, is included with its year.'], [{ text: 'PMP, 2021' }]), []);
});

test('review 4695e0d: issuer-first groups take the last token; a later negation never masks an inclusion', async () => {
  const { packetHasCredential, credentialName } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const r = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Black Belt (IASSC LSSBB), 2020' }, r('LSSBB, 2020')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMI PMP)' }, r('PMP, 2021')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMI PMP)' }, r('PMI, 2021')), false);
  assert.deepEqual(credentialName('Lean Six Sigma Green Belt Acme (LLC)').acronyms, []);
  assert.deepEqual(dropCredentialInclusionClaims(['The certificate is included with its stated year, the older licence was not added.'], [{ text: 'CPA, 2021' }]), []);
});

test('review 2c9f88e: a known issuer is never the designation, in either order', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  const r = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMP PMI)' }, r('PMP, 2021')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMI PMP)' }, r('PMP, 2021')), true);
  assert.equal(packetHasCredential({ text: 'Project Management Professional (PMI PMP)' }, r('PMI, 2021')), false);
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt (ASQ CSSGB), 2019' }, r('ASQ member since 2019')), false);
  // A long clause: the negation belongs to its own verb.
  assert.deepEqual(dropCredentialInclusionClaims(['The certificate that the posting asks for in its second paragraph was not included.'], [{ text: 'CPA, 2021' }]),
    ['The certificate that the posting asks for in its second paragraph was not included.']);
});

test('review cba3b5c: an issuer-only group is never the credential; a shared negation covers its list', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const { dropCredentialInclusionClaims } = await import('../plainhand/workflow.mjs');
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt (ASQ), 2019' }, [{ section: 'Certifications', heading: null, text: 'ASQ, 2019' }]), false);
  assert.deepEqual(dropCredentialInclusionClaims(['The certificate was not added or listed.'], [{ text: 'CPA, 2021' }]), ['The certificate was not added or listed.']);
});

test('review 79ac588: a bare-acronym credential matches its written-out line through its issuer', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const r = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'CKA (CNCF), 2022' }, r('Certified Kubernetes Administrator, CNCF, 2022')), true);
  assert.equal(packetHasCredential({ text: 'PMP (PMI), 2021' }, r('Project Management Professional, PMI, 2021')), true);
  assert.equal(packetHasCredential({ text: 'PMP (PMI), 2021' }, r('PMI, 2021')), false);
  assert.equal(packetHasCredential({ text: 'Lean Six Sigma Green Belt (ASQ), 2019' }, r('ASQ, 2019')), false);
});

test('review e21dd19: the issuer fallback needs the written name to spell the acronym', async () => {
  const { packetHasCredential } = await import('../plainhand/credential-relevance.mjs');
  const r = text => [{ section: 'Certifications', heading: null, text }];
  assert.equal(packetHasCredential({ text: 'CKS (CNCF), 2022' }, r('Certified Kubernetes Administrator, CNCF, 2022')), false);
  assert.equal(packetHasCredential({ text: 'PMP (PMI), 2021' }, r('Certified Associate in Project Management, PMI, 2021')), false);
  assert.equal(packetHasCredential({ text: 'CQE (ASQ), 2019' }, r('Certified Quality Auditor, ASQ, 2019')), false);
  assert.equal(packetHasCredential({ text: 'CKA (CNCF), 2022' }, r('Certified Kubernetes Administrator, CNCF, 2022')), true);
});

test('a raised verb its own evidence never uses is a scope stretch, unless the candidate allows it', () => {
  const packet = {
    resume: [
      { section: 'Summary', heading: null, text: 'Mechanical engineer who built a lightweight chassis for a Formula SAE team.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis for the Formula SAE team.' }] },
      { section: 'Experience', heading: null, text: 'Led weekly design reviews.', evidence: [{ sourceId: 'cv', quote: 'Led weekly design reviews for the team.' }] },
    ],
    coverLetter: 'I built a LIMS that tracked 1,200 samples.', answers: [],
  };
  const sources = [{ id: 'cv', text: 'Designed and tested a lightweight chassis for the Formula SAE team. Led weekly design reviews for the team. I built a LIMS that tracked 1,200 samples.' }];
  const issues = pluralScopeIssues(packet, { sources });
  assert.deepEqual(issues.map(issue => [issue.kind, issue.index, issue.word]), [['resume', 0, 'built']]);
  assert.match(scopeRetryFeedback(issues).join('\n'), /"built" is a stronger verb than the cited evidence uses/);
  assert.match(scopeSuggestions(issues)[0], /says "built", a verb its cited evidence does not use/);
  assert.deepEqual(pluralScopeIssues(packet, { sources, allowVerbs: true }), []);
});

test('review 97f3a7e: raised verbs only in verb position, present tense counts, equal-strength verbs support, letters use factual sources', () => {
  const flagged = (text, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(flagged('Integrated built-in SSO using SAML.', 'Integrated SAML SSO for the portal.'), []);
  assert.deepEqual(flagged('Migrated the batch jobs to a managed Kubernetes service.', 'Moved the nightly batch jobs onto GKE.'), []);
  assert.deepEqual(flagged('Debugged the LED driver board.', 'Debugged the light-emitting-diode driver board.'), []);
  assert.deepEqual(flagged('Lead the weekly stand-up for the data platform.', 'Attended the weekly stand-up for the data platform.'), ['lead']);
  assert.deepEqual(flagged('Built the reporting pipeline.', 'Constructed the reporting pipeline in Airflow.'), []);
  assert.deepEqual(flagged('Managed the annual equipment budget of $2M.', 'Responsible for the $2M annual equipment budget.'), []);
  assert.deepEqual(flagged('Headed the safety committee.', 'Chair of the site safety committee.'), []);
  assert.deepEqual(flagged('Mechanical engineer who built a lightweight chassis.', 'Designed and tested a lightweight chassis.'), ['built']);
  const letter = pluralScopeIssues({ resume: [], coverLetter: 'I built the chassis program from scratch.', answers: [] }, { sources: [{ id: 'cv', text: 'Designed and tested a chassis.' }, { id: 'writing-samples', text: 'we build things carefully.' }] });
  assert.deepEqual(letter.filter(issue => issue.verb).map(issue => issue.word), ['built']);
});

test('a number word no source or posting states is a scope stretch; a stated one is not', () => {
  const sources = [{ id: 'cv', text: 'I developed a cell-based potency assay that cut turnaround from 6 days to 2 and is used in three programmes.' }];
  const packet = {
    resume: [{ section: 'Experience', heading: null, text: 'Developed a potency assay used in three programmes.', evidence: [{ sourceId: 'cv', quote: 'used in three programmes' }] }],
    coverLetter: 'Your posting combines the potency assay, sample automation and the LIMS in one Raleigh role. It cut turnaround from six days to two.',
    answers: [],
  };
  const issues = pluralScopeIssues(packet, { sources, jobText: 'Senior Assay Development Scientist in Raleigh.' });
  assert.deepEqual(issues.map(issue => [issue.kind, issue.word]), [['cover', 'one']]);
  assert.match(scopeRetryFeedback(issues).join('\n'), /"one" states a number \(1\) no source gives/);
  // The posting stating it is enough.
  assert.deepEqual(pluralScopeIssues(packet, { sources, jobText: 'One Raleigh role covers assay, automation and LIMS.' }).filter(issue => issue.number), []);
  assert.match(PACKET_INSTRUCTION, /never state a count, as a digit or a word such as "one"/);
});

test('review 983c762: list nouns are not verbs; contractions, adverbs and co- prefixes still count', () => {
  const resumeFlags = (text, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  const letterFlags = text => pluralScopeIssues({ resume: [], coverLetter: text, answers: [] }, { sources: [{ id: 'cv', text: 'Designed and tested a chassis.' }] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(resumeFlags('Owned CI/CD, build tooling, and release automation.', 'Owned CI/CD pipelines and release automation.'), []);
  assert.deepEqual(resumeFlags('Build tooling ownership: Bazel, Gradle and CI for 40 engineers.', 'Owned Bazel, Gradle and CI tooling for 40 engineers.'), []);
  assert.deepEqual(resumeFlags('Co-founded a design studio serving regional utilities.', 'Consulted for regional utilities on design work.'), ['founded']);
  assert.deepEqual(letterFlags("I've built the chassis program from scratch."), ['built']);
  assert.deepEqual(letterFlags('I single-handedly built the chassis program.'), ['built']);
  assert.deepEqual(letterFlags('We co-led the chassis program.'), ['led']);
});

test('review d2a6000: counts compare by value, skip non-count uses, cover answers; verbs after openers and subjects', () => {
  const numbers = (line, cv, jobText = '') => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote: cv }] }], coverLetter: '', answers: [] }, { sources: [{ id: 'cv', text: cv }], jobText }).filter(issue => issue.number).map(issue => issue.word);
  assert.deepEqual(numbers('Validated twenty-five samples.', 'Validated 25 samples.'), []);
  assert.deepEqual(numbers('Wrote twelve reports.', 'Wrote a dozen reports.'), []);
  assert.deepEqual(numbers('Ran the assay two times daily.', 'Ran the assay twice daily.'), []);
  assert.deepEqual(numbers('Led two teams.', 'Maintained the CO2 incubator.'), ['two']);
  assert.deepEqual(numbers('Ran fifteen assay transfers.', 'Ran assay development for the lab.'), ['fifteen']);
  assert.deepEqual(numbers('Served as one of the QA liaisons.', 'Served as QA liaison.'), []);
  assert.deepEqual(numbers('Wrote a one-page strategy brief.', 'Wrote a strategy brief.'), []);
  const letter = pluralScopeIssues({ resume: [], coverLetter: 'Your posting combines the assay, automation and LIMS in one Raleigh role.', answers: [] }, { sources: [{ id: 'cv', text: 'Developed an assay.' }], jobText: 'You will be one of our first engineers in Raleigh.' });
  assert.deepEqual(letter.filter(issue => issue.number).map(issue => issue.word), ['one']);
  const answer = pluralScopeIssues({ resume: [], coverLetter: '', answers: [{ question: 'q', answer: 'I led two teams and one program.', evidence: [{ sourceId: 'cv', quote: 'Led teams on programs.' }] }] }, { sources: [{ id: 'cv', text: 'Led teams on programs.' }] });
  assert.deepEqual(answer.filter(issue => issue.number).map(issue => issue.word), ['two', 'one']);
  const verbs = (line, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(verbs('Successfully built the reporting pipeline.', 'Designed and tested the reporting pipeline.'), ['built']);
  assert.deepEqual(verbs('Personally managed the LIMS rollout.', 'Designed and tested the LIMS rollout.'), ['managed']);
  assert.deepEqual(verbs('Lead QA for the analytical lab.', 'Attended QA reviews for the analytical lab.'), ['lead']);
  const cover = pluralScopeIssues({ resume: [], coverLetter: 'I oversee assay development for three products.', answers: [] }, { sources: [{ id: 'cv', text: 'Ran assay development for three products.' }] });
  assert.deepEqual(cover.filter(issue => issue.verb).map(issue => issue.word), ['oversee']);
});

test('review 45b1448: compounds and composites state counts; only "one of" is partitive; noun phrases are not raised verbs', () => {
  const numbers = (line, cv) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote: cv }] }], coverLetter: '', answers: [] }, { sources: [{ id: 'cv', text: cv }] }).filter(issue => issue.number).map(issue => issue.word);
  assert.deepEqual(numbers('Worked in a team of two.', 'Worked in a two-person team.'), []);
  assert.deepEqual(numbers('Rolled the system out to three sites.', 'Ran the three-site rollout.'), []);
  assert.deepEqual(numbers('Screened two hundred samples.', 'Screened 200 samples.'), []);
  assert.deepEqual(numbers('Screened two thousand samples.', 'Screened 2,000 samples.'), []);
  const letter = pluralScopeIssues({ resume: [], coverLetter: 'I audited twelve of the thirty labs.', answers: [] }, { sources: [{ id: 'cv', text: 'Audited 30 labs.' }] });
  assert.deepEqual(letter.filter(issue => issue.number).map(issue => issue.word), ['twelve']);
  const verbs = (line, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(verbs('Direct reports include five scientists.', 'Managed a team of five scientists.'), []);
  assert.deepEqual(verbs('Assay development, lead optimizations, and method transfer.', 'Ran assay development.'), []);
  assert.match(PACKET_INSTRUCTION, /a count the posting states may be repeated only to describe the posting, never as the candidate's own/);
});

test('review edf7a8f: duration and fraction compounds state no count; people and places are raised-verb objects', () => {
  const numbers = (line, cv) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote: cv }] }], coverLetter: '', answers: [] }, { sources: [{ id: 'cv', text: cv }] }).filter(issue => issue.number).map(issue => issue.word);
  assert.deepEqual(numbers('Supported three teams.', 'Ran a three-hour workshop.'), ['three']);
  assert.deepEqual(numbers('Supported two teams.', 'Wrote a two-year roadmap.'), ['two']);
  assert.deepEqual(numbers('Hired one analyst.', 'Cut defects by one-third.'), ['one']);
  assert.deepEqual(numbers('Worked in a team of two.', 'Worked in a two-person team.'), []);
  const verbs = (line, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(verbs('Lead analysts through the close.', 'Supported the close.'), ['lead']);
  assert.deepEqual(verbs('Manage vendors and invoices.', 'Processed vendor invoices.'), ['manage']);
  assert.deepEqual(verbs('Direct reports include five scientists.', 'Managed five scientists.'), []);
});

test('review d291f66: attributive "direct" before a client noun is not a raised verb', () => {
  const verbs = (line, quote) => pluralScopeIssues({ resume: [{ section: 'Experience', heading: null, text: line, evidence: [{ sourceId: 'cv', quote }] }], coverLetter: '', answers: [] }, { sources: [] }).filter(issue => issue.verb).map(issue => issue.word);
  assert.deepEqual(verbs('Direct client work across three regions.', 'Worked with clients in three regions.'), []);
  assert.deepEqual(verbs('Direct customer support and onboarding.', 'Supported customers during onboarding.'), []);
});
