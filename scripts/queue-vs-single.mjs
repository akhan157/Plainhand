#!/usr/bin/env node
// Queue versus single packet comparison for U09.
//
// Prepares one role in a batch of queued prepares and the same role alone, from
// copies of the same seeded workspace, then compares the packets. With
// --self-test the deterministic fixture agent must produce byte-identical
// packets (after removing timestamps and generated ids). With a live provider
// the model is stochastic, so the script reports the quality dimensions it can
// check without asking the model, and flags any dimension where the queued run is
// worse. It never sends anything and never uses the candidate's data: the inputs
// are the synthetic evaluation personas and jobs.
//
//   node scripts/queue-vs-single.mjs --provider codex --jobs 3 --repeat 2
//   node scripts/queue-vs-single.mjs --self-test
//
// Exits 1 on a regression (or a failed/unchanged-format run), 0 otherwise.
import { mkdtemp, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPlainhand } from '../plainhand-server.mjs';
import { emptyProfile, digest, now } from '../plainhand/store.mjs';
import { approveStandard } from '../plainhand/standard.mjs';
import { executeAgent, inspectProviders } from '../plainhand/agents.mjs';
import { personaById, jobById } from '../plainhand/evaluation/corpus.mjs';
import { scorePacket } from '../plainhand/evaluation/score.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';

const CLI = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const options = { provider: null, jobs: 2, repeat: 1, timeout: 600, out: null, selfTest: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--provider') options.provider = argv[++i];
    else if (arg === '--jobs') options.jobs = Number(argv[++i]);
    else if (arg === '--repeat') options.repeat = Number(argv[++i]);
    else if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help') { options.help = true; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.help && !options.selfTest && !options.provider) throw new Error('Pass --provider <id>, or --self-test for the deterministic check.');
  if (!Number.isInteger(options.jobs) || options.jobs < 2 || options.jobs > 5) throw new Error('--jobs must be 2 to 5 (the compared role plus at least one queued before it).');
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) throw new Error('--repeat must be 1 to 5.');
  if (!Number.isFinite(options.timeout) || options.timeout < 30) throw new Error('--timeout must be at least 30 seconds.');
  return options;
}

const help = `Queue versus single packet comparison

  node scripts/queue-vs-single.mjs --provider <id> [options]
  node scripts/queue-vs-single.mjs --self-test [options]

  --provider <id>   A live CLI provider: codex, claude or antigravity.
  --self-test       Use the deterministic fixture agent; packets must be byte-identical.
  --jobs <n>        Roles per run, 2 to 5 (default 2). The first is compared.
  --repeat <n>      Independent workspace copies, 1 to 5 (default 1).
  --timeout <s>     Per model call in seconds (default 600).
  --out <dir>       Evidence directory (default output/queue-vs-single-<timestamp>).
  --keep            Keep the temporary workspaces.
`;

const VOLATILE = new Set(['id', 'jobId', 'taskId', 'at', 'createdAt', 'updatedAt', 'finishedAt', 'generatedAt', 'startedAt', 'approvedAt', 'autoSelectedAt', 'checkedAt', 'gradedAt', 'contextHash', 'packetHash', 'pdfHash', 'approvedHash', 'packetJobHash', 'hash']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(key => !VOLATILE.has(key)).map(key => [key, canonical(value[key])]));
  }
  return value;
}
const canonicalJson = value => JSON.stringify(canonical(value));
const sha256 = value => digest(canonicalJson(value));

const selfTestScenario = () => ({
  persona: {
    id: 'queue-single-self-test',
    profile: { ...emptyProfile(), ...candidate },
    facts: [{ id: 'fsae', section: 'Projects', text: 'Designed and tested a lightweight chassis for a Formula SAE team.' }],
    educationEvidence: 'B.S. Mechanical Engineering, Example University, 2027.',
    voice: { banned: [] },
    absent: [],
  },
  jobs: Array.from({ length: 5 }, (_, index) => ({
    id: `queue-single-self-test-${index + 1}`,
    company: 'Test Company',
    title: `Graduate Engineer ${index + 1}`,
    location: 'Boston, US',
    description: 'This is an engineering role designing and testing hardware. '.repeat(10),
    requiredFactIds: ['fsae'],
    atsTerms: ['design', 'testing'],
  })),
});

function liveScenario() {
  const persona = personaById('mech-grad');
  // Synthetic corpus jobs. Only the compared job's packet is scored; the others
  // fill the queue so the compared prepare is not the first item.
  return {
    persona,
    jobs: ['grad-mech', 'data-analyst', 'junior-swe', 'ops-manager', 'product-designer'].map(id => jobById(id)).filter(Boolean),
  };
}

// A master resume built from the persona's own approved facts, so every paired
// run starts from exactly the same inputs and no model call is spent on it.
function masterDraft(persona) {
  const sectionOf = fact => fact.section || (fact.atEmployer ? 'Experience' : 'Projects');
  const resume = (persona.facts || []).map(fact => ({ section: sectionOf(fact), text: fact.text }));
  if (persona.educationEvidence) resume.push({ section: 'Education', text: persona.educationEvidence });
  return {
    headline: persona.profile.roles,
    resume,
    coverLetter: `${persona.profile.story || ''} I am applying for the {role} role at {company}.`.trim(),
    suggestions: [],
  };
}

const slug = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role';

// Writes one workspace with an approved master and evaluated, selected jobs.
async function seedWorkspace(root, scenario, provider) {
  const app = await createPlainhand({
    root,
    providers: fixtureProviders,
    startFeatures: false,
    workflowOptions: {
      agent: () => { throw new Error('The seed writes state directly; it never calls a model.'); },
      verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', reason: 'Synthetic test job; no employer was contacted.' }),
      renderer: async (workspace, state, job) => {
        const file = `output/seed-${job.id}.pdf`;
        await workspace.write(file, 'seed');
        return { pdf: file, pdfHash: digest(Buffer.from('seed')), artifacts: [file] };
      },
    },
  });
  try {
    const initial = await app.workspace.load();
    await app.workspace.saveProfile({ ...emptyProfile(), ...scenario.persona.profile }, initial.revision);
    const ids = [];
    const state = await app.workspace.mutate(async latest => {
      latest.provider = provider;
      latest.settings = { ...(latest.settings || {}), autonomy: { enabled: false } };
      const context = await app.workspace.context(latest);
      const at = now();
      latest.standard = { kind: 'master', draft: masterDraft(scenario.persona), contextHash: context.hash, createdAt: at, approvedAt: null, approvedHash: null };
      approveStandard(latest, at);
      latest.jobs = scenario.jobs.map((job, index) => {
        const id = randomUUID();
        ids.push(id);
        return {
          id,
          company: job.company,
          title: job.title,
          location: job.location || '',
          url: `https://jobs.lever.co/synthetic/u09-queue-vs-single-${index + 1}`,
          description: job.description,
          roleAnswers: '',
          selected: true,
          stage: 'evaluated',
          status: 'Evaluated',
          createdAt: at,
          evaluation: {
            score: 4.5,
            recommendation: 'Apply',
            summary: 'Synthetic seed for the queue comparison; the fit score is fixed.',
            matches: [],
            gaps: [],
            questions: [],
            legitimacyNotes: ['Synthetic test job; no employer was contacted.'],
            modelRecommendation: 'Apply',
          },
          integrity: { summary: 'Synthetic test job.', findings: [] },
          verification: { state: 'active', legitimacy: 'official-ats-unconfirmed-employer', reason: 'Synthetic test job; no employer was contacted.', checkedAt: at },
          contextHash: context.hash,
          reportPath: `reports/hl-${id.slice(0, 8)}-${slug(job.company)}-${slug(job.title)}-${at.slice(0, 10)}.md`,
        };
      });
      return { ids, contextHash: context.hash, sources: context.sources };
    });
    for (const job of state.ids) {
      const seeded = (await app.workspace.load()).jobs.find(item => item.id === job);
      await app.workspace.write(seeded.reportPath, `# ${seeded.company} — ${seeded.title}\n\n**Score:** 4.5/5\n**URL:** ${seeded.url}\n**PDF:** pending\n`);
    }
    return state;
  } finally {
    await app.close();
  }
}

async function settle(app, timeoutMs = 900000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await app.workflow.queue;
    const state = await app.workspace.load();
    const active = state.tasks.filter(task => ['queued', 'running'].includes(task.status));
    if (!active.length) return state;
    if (Date.now() > deadline) throw new Error(`The queue did not finish: ${active.map(task => `${task.kind}:${task.status}`).join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function prepareRun(root, agent, ids, timeoutSec) {
  const app = await createPlainhand({
    root,
    providers: fixtureProviders,
    startFeatures: false,
    workflowOptions: {
      agent: (id, instruction, data, options) => agent(id, instruction, data, { ...options, timeout: timeoutSec * 1000 }),
      verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', reason: 'Synthetic test job; no employer was contacted.' }),
      renderer: async (workspace, state, job) => {
        const file = `output/compare-${job.id}.pdf`;
        await workspace.write(file, 'compare');
        return { pdf: file, pdfHash: digest(Buffer.from('compare')), artifacts: [file] };
      },
    },
  });
  try {
    const ui = (name, input) => app.registry.run(name, input, { actor: 'ui' });
    for (const id of ids) await ui('tasks.prepare', { jobId: id });
    const state = await settle(app);
    const failed = state.tasks.filter(task => task.kind === 'prepare' && task.status !== 'complete');
    if (failed.length) throw new Error(failed.map(task => task.message || task.status).join(' '));
    const context = await app.workspace.context(state);
    return { state, context, usage: await app.workflow.usage.summary(state) };
  } finally {
    await app.close();
  }
}

function qualityOf({ packet, persona, job, sources, review, calibration }) {
  const scored = scorePacket({ packet, persona, job, sources, review, calibration, pdf: null });
  return {
    required: scored.required,
    covered: scored.covered,
    factCoverage: scored.factCoverage,
    missingFacts: scored.missingFacts,
    absentClaims: scored.absentClaims,
    unsupportedNumbers: scored.unsupportedNumbers,
    bannedWords: scored.bannedWords,
    atsCoverage: scored.atsCoverage,
    reviewPassed: scored.reviewPassed,
    questions: scored.questions,
    calibrationUnsupported: calibration?.counts?.unsupported ?? null,
    resumeLines: packet.resume?.length ?? 0,
    answerCount: packet.answers?.length ?? 0,
    coverLetterCharacters: String(packet.coverLetter || '').length,
  };
}

function regressionsBetween(single, queued) {
  const regressions = [];
  const added = (a, b) => b.filter(value => !a.includes(value));
  if (added(single.missingFacts, queued.missingFacts).length) regressions.push(`missing facts: ${added(single.missingFacts, queued.missingFacts).join(', ')}`);
  if (added(single.absentClaims, queued.absentClaims).length) regressions.push(`absent claims: ${added(single.absentClaims, queued.absentClaims).join(', ')}`);
  if (queued.unsupportedNumbers.length > single.unsupportedNumbers.length) regressions.push(`unsupported numbers ${single.unsupportedNumbers.length} -> ${queued.unsupportedNumbers.length}`);
  if (added(single.bannedWords, queued.bannedWords).length) regressions.push(`banned words: ${added(single.bannedWords, queued.bannedWords).join(', ')}`);
  if (single.reviewPassed && !queued.reviewPassed) regressions.push('the queued packet did not pass factual review');
  if (queued.required && queued.covered < single.covered) regressions.push(`required facts covered ${single.covered}/${single.required} -> ${queued.covered}/${queued.required}`);
  if (single.questions !== null && queued.questions !== null && queued.questions > single.questions) regressions.push(`open questions ${single.questions} -> ${queued.questions}`);
  if (single.calibrationUnsupported !== null && queued.calibrationUnsupported !== null && queued.calibrationUnsupported > single.calibrationUnsupported) regressions.push(`unsupported claims ${single.calibrationUnsupported} -> ${queued.calibrationUnsupported}`);
  return regressions;
}

export async function runComparison({ scenario, provider = 'fixture', agent, jobs = 2, repeat = 1, timeout = 600, keep = false } = {}) {
  if (!scenario || !agent) throw new Error('runComparison needs a scenario and an agent.');
  if (!Array.isArray(scenario.jobs) || scenario.jobs.length < jobs) throw new Error(`The scenario needs at least ${jobs} jobs.`);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('repeat must be a positive integer.');
  const seedRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-seed-'));
  const pairRoot = await mkdtemp(path.join(tmpdir(), 'plainhand-u09-pair-'));
  try {
    const seed = await seedWorkspace(seedRoot, scenario, provider);
    const compared = seed.ids[0];
    const comparedJob = scenario.jobs[0];
    const pairs = [];
    for (let index = 0; index < repeat; index++) {
      const singleRoot = path.join(pairRoot, `single-${index}`);
      const queuedRoot = path.join(pairRoot, `queued-${index}`);
      await cp(seedRoot, singleRoot, { recursive: true });
      await cp(seedRoot, queuedRoot, { recursive: true });
      const single = await prepareRun(singleRoot, agent, [compared], timeout);
      const queuedIds = [...seed.ids.slice(1, jobs), compared];
      const queued = await prepareRun(queuedRoot, agent, queuedIds, timeout);
      const singleJob = single.state.jobs.find(job => job.id === compared);
      const queuedJob = queued.state.jobs.find(job => job.id === compared);
      if (!singleJob?.packet || !queuedJob?.packet) throw new Error('A prepare finished without a packet.');
      const identical = canonicalJson(singleJob.packet) === canonicalJson(queuedJob.packet);
      const singleQuality = qualityOf({ packet: singleJob.packet, persona: scenario.persona, job: comparedJob, sources: single.context.sources, review: singleJob.review, calibration: singleJob.calibration });
      const queuedQuality = qualityOf({ packet: queuedJob.packet, persona: scenario.persona, job: comparedJob, sources: queued.context.sources, review: queuedJob.review, calibration: queuedJob.calibration });
      pairs.push({
        pair: index + 1,
        identical,
        singleSha256: sha256(singleJob.packet),
        queuedSha256: sha256(queuedJob.packet),
        single: singleQuality,
        queued: queuedQuality,
        regressions: regressionsBetween(singleQuality, queuedQuality),
        singleUsage: single.usage,
        queuedUsage: queued.usage,
      });
      console.log(`pair ${index + 1}: ${identical ? 'byte-identical packets' : 'packets differ (live model)'}`);
      console.log(`  single ${pairs.at(-1).singleSha256.slice(0, 16)}  queued ${pairs.at(-1).queuedSha256.slice(0, 16)}`);
      console.log(`  required ${singleQuality.covered}/${singleQuality.required} -> ${queuedQuality.covered}/${queuedQuality.required}; unsupported numbers ${singleQuality.unsupportedNumbers.length} -> ${queuedQuality.unsupportedNumbers.length}; review ${singleQuality.reviewPassed} -> ${queuedQuality.reviewPassed}; questions ${singleQuality.questions} -> ${queuedQuality.questions}`);
      if (pairs.at(-1).regressions.length) console.log(`  regression: ${pairs.at(-1).regressions.join('; ')}`);
    }
    const selfTest = provider === 'fixture';
    const regressions = pairs.flatMap(pair => pair.regressions);
    if (selfTest && pairs.some(pair => !pair.identical)) regressions.push('the deterministic fixture agent produced different packets');
    return { provider, compared: { company: comparedJob.company, title: comparedJob.title }, jobs: seed.ids.length, pairs, regressions, identical: pairs.every(pair => pair.identical), selfTest };
  } finally {
    if (!keep) {
      await rm(seedRoot, { recursive: true, force: true });
      await rm(pairRoot, { recursive: true, force: true });
    } else {
      console.log(`kept workspaces: ${seedRoot} and ${pairRoot}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === CLI) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help) { console.log(help); process.exit(0); }

  let scenario, agent, provider;
  try {
    if (options.selfTest) {
      provider = 'fixture';
      scenario = selfTestScenario();
      agent = fixtureAgent;
    } else {
      provider = options.provider;
      if (provider === 'chatgpt') throw new Error('Sign in with ChatGPT runs in-process; use codex, claude or antigravity for this script.');
      const installed = await inspectProviders();
      const found = installed.find(item => item.id === provider);
      if (!found) throw new Error(`Unknown provider "${provider}".`);
      if (!found.installed) throw new Error(`${found.name} is not installed. Install it on the Connections page, then retry.`);
      if (provider !== 'antigravity' && found.auth === 'sign-in-needed') throw new Error(`${found.name} is not signed in. Sign in in your terminal, then retry.`);
      scenario = liveScenario();
      agent = (id, instruction, data, callOptions = {}) => executeAgent(provider, instruction, data, callOptions);
      // A live preflight call proves sign-in before any scenario work is spent.
      const probe = await executeAgent(provider, 'Return the JSON object {"ok":true} and nothing else.', {}, { timeout: Math.min(options.timeout, 180) * 1000 });
      if (probe?.ok !== true) throw new Error(`${found.name} answered the preflight call without {ok:true}; check the provider.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  try {
    const result = await runComparison({ scenario, provider, agent, jobs: options.jobs, repeat: options.repeat, timeout: options.timeout, keep: options.keep });
    const out = options.out || path.join(path.dirname(CLI), '..', 'output', `queue-vs-single-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'result.json'), JSON.stringify({ ...result, options: { ...options, provider } }, null, 2) + '\n');
    const verdict = result.regressions.length ? `REGRESSION (${result.regressions.length})` : 'no quality regression';
    console.log(`\n${result.jobs} roles per run, ${result.pairs.length} pair(s); ${verdict}`);
    console.log(`evidence: ${path.resolve(out, 'result.json')}`);
    process.exitCode = result.regressions.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
