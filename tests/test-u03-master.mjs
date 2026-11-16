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
import { masterCompleteness } from '../plainhand/master-completeness.mjs';
import { controlledAgent } from '../plainhand/evaluation/agent.mjs';
import { STANDARD_INSTRUCTION } from '../plainhand/agents.mjs';
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
    assert.ok(result.counts.credentials.total >= 1, `${persona.id} has a credential`);
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
    assert.equal(result.counts.credentials.missing, 1);
    assert.equal(result.counts.degrees.missing, 0);
    assert.equal(result.counts.results.missing, 0);
  }
});

async function harness({ persona, job = jobById('holdout-job-fin-forecast'), agent = null, profile = null }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u03-'));
  const base = agent || controlledAgent({ scenario: { id: 'u03', roleOrder: 'recent' }, persona, job });
  const app = await createPlainhand({
    root,
    providers: fixtureProviders,
    workflowOptions: {
      agent: base,
      verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'A finance systems role. '.repeat(20), checkedAt: new Date().toISOString(), reason: 'Fixture.' }),
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

test('the master result carries what it missed, and the profile view can list it', async () => {
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
    assert.deepEqual(state.standard.completeness.missing.map(item => [item.kind, item.label]), [
      ['role', `${oldest.employer} — ${oldest.title} — ${persona.profile.resume.split('\n').find(line => line.startsWith(`${oldest.employer} —`)).split(' — ').at(-1)}`],
      ['credential', credential],
    ]);
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
