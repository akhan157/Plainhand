#!/usr/bin/env node
// Synthetic voice contrast for U05. Two personas are identical except for their
// writing samples (terse/plain vs formal/long-sentenced). Each prepares the same
// job, and the cover letters are compared with voice-metrics.mjs: a persona passes
// when its letter is closer to its own samples than to the other's. This is a
// synthetic substitute for real user voice, never evidence about a real candidate.
//
//   node scripts/voice-contrast.mjs --provider claude [--keep]
//
// Makes live provider calls (one prepare per persona, including humanize and an
// independent review). Run it deliberately, under the current model budget.
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { voiceAttribution, voiceFeatures } from '../plainhand/voice-metrics.mjs';

export const PERSONA = {
  name: 'Voice Contrast Candidate',
  email: 'voice-contrast@example.invalid',
  phone: '',
  location: 'Boston, US',
  timezone: 'America/New_York',
  roles: 'Mechanical Engineer',
  compensation: '',
  eligibility: '',
  graduation: '2027',
  links: '',
  resume: 'Designed and tested a lightweight chassis for a Formula SAE team. Built a LIMS for the lab, tracking 1,200 samples. B.S. Mechanical Engineering, Example University, 2027.',
  story: 'I owned the design and testing work.',
  voice: '',
  constraints: 'Entry-level roles.',
};
export const SAMPLES = {
  terse: [
    "I'm a hands-on engineer. I build test rigs. I break them on purpose. I fix what breaks. Then I write the numbers down.",
    "Quick update: the upright passed. I'll send the plots tonight. Ask me if anything looks off.",
  ],
  formal: [
    'I am writing to provide a comprehensive update regarding the test campaign, and I would like to explain the methodology that was applied throughout the process. Furthermore, the results obtained thus far are approximately consistent with the initial predictions, although additional validation shall be required prior to the final report.',
    'Please find the relevant documentation attached for your consideration, and do not hesitate to contact me at your earliest convenience should any further information be required.',
  ],
};
export const JOB = {
  company: 'Acme Robotics',
  title: 'Graduate Engineer',
  url: 'https://jobs.lever.co/acme/voice-contrast',
};
const JOB_TEXT = 'Design and test hardware with CAD and prototypes. Work with a small engineering team to validate designs. '.repeat(3);
const USAGE = `Usage: node scripts/voice-contrast.mjs --provider <id> [--keep]

  --provider <id>  codex, claude, antigravity or chatgpt: the live account used for
                   all drafting and review calls.
  --keep           keep the two temporary workspaces for inspection.

Prints JSON. This is a synthetic contrast, not user-voice evidence.
Exit 0 when each cover letter is closer to its own samples, 1 when not, 2 on setup.`;

function parseArgs(argv) {
  const args = { provider: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--keep') args.keep = true;
    else if (arg === '--provider') { args.provider = argv[++i] || null; if (!args.provider) throw new Error('--provider needs an id.'); }
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length) || null;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

export async function preparePersona(provider, label, samples, root, { agent = null } = {}) {
  const [{ createPlainhand }, { digest }] = await Promise.all([import('../plainhand-server.mjs'), import('../plainhand/store.mjs')]);
  // Rendering has its own U05 tests with a real PDF; this harness only needs the
  // pipeline's render step to run, so it writes the packet text as the artifact.
  const renderer = async (workspace, state, job, packet) => {
    const body = JSON.stringify(packet), pdf = `output/voice-contrast-${job.id}.pdf`;
    await workspace.write(pdf, body);
    return { pdf, pdfHash: digest(Buffer.from(body)), artifacts: [pdf] };
  };
  // A test supplies the fixture agent; a live run leaves the default provider path.
  const workflowOptions = agent ? { agent, renderer } : { renderer };
  const app = await createPlainhand({ root, providers: async () => [], startFeatures: false, workflowOptions });
  try {
    const state = await app.workspace.load();
    await app.workspace.saveProfile({ ...state.profile, ...PERSONA }, state.revision);
    for (const [index, text] of samples.entries()) await app.registry.run('profile.addWritingSample', { title: `Sample ${index + 1}`, text }, { actor: 'ui' });
    const loaded = await app.workspace.load();
    const contextHash = (await app.workspace.context(loaded)).hash;
    const jobId = randomUUID(), reportPath = `reports/voice-contrast-${jobId.slice(0, 8)}.md`;
    await app.workspace.mutate(current => {
      current.provider = provider;
      current.jobs = [{ ...JOB, id: jobId, reportPath, description: JOB_TEXT, location: '', createdAt: new Date().toISOString(), stage: 'evaluated', status: 'Evaluated', selected: true, contextHash,
        evaluation: { score: 4.5, recommendation: 'Apply', summary: 'Synthetic voice-contrast fixture.', matches: [], gaps: [], questions: [], legitimacyNotes: [] } }];
    });
    // Evaluate writes this report; the script builds the evaluated job directly, so it
    // must provide the same shape and prepare updates the PDF line in it.
    await app.workspace.write(reportPath, `# ${JOB.company} — ${JOB.title}\n\n**PDF:** pending\n`);
    await app.registry.run('tasks.prepare', { jobId }, { actor: 'ui' });
    for (let i = 0; i < 6; i++) await app.workflow.queue;
    const task = (await app.workspace.load()).tasks[0];
    if (task?.status !== 'complete') throw new Error(`prepare ${label} ${task?.status || 'did not run'}: ${task?.message || 'no task'}`);
    const job = (await app.workspace.load()).jobs.find(j => j.id === jobId);
    if (!job?.packet?.coverLetter) throw new Error(`prepare ${label} finished without a cover letter.`);
    return { coverLetter: job.packet.coverLetter, reviewPassed: job.review?.passed === true, reviewAttempts: job.reviewAttempts?.length || 0 };
  } finally { await app.close(); }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(2); }
  if (args.help) { console.log(USAGE); return 0; }
  if (!args.provider) { console.error(`--provider is required.\n\n${USAGE}`); return 2; }
  let providerById;
  try { ({ providerById } = await import('../plainhand/agents.mjs')); }
  catch (error) { console.error(`Could not load the provider catalogue: ${error.message}`); return 2; }
  try { providerById(args.provider); }
  catch { console.error(`Unknown provider "${args.provider}". ${USAGE}`); return 2; }

  const roots = [];
  try {
    const prepared = [];
    for (const label of ['terse', 'formal']) {
      const root = await mkdtemp(path.join(tmpdir(), 'plainhand-voice-contrast-'));
      roots.push(root);
      const result = await preparePersona(args.provider, label, SAMPLES[label], root);
      prepared.push({ label, samples: SAMPLES[label], ...result });
    }
    const text = samples => samples.join('\n\n');
    const report = prepared.map(persona => {
      const other = prepared.find(candidate => candidate.label !== persona.label);
      const attribution = voiceAttribution({ letter: persona.coverLetter, own: text(persona.samples), other: text(other.samples) });
      return { label: persona.label, samples: persona.samples, coverLetter: persona.coverLetter,
        features: voiceFeatures(persona.coverLetter), sampleFeatures: voiceFeatures(text(persona.samples)),
        reviewPassed: persona.reviewPassed, reviewAttempts: persona.reviewAttempts,
        ownDistance: attribution.ownDistance, otherDistance: attribution.otherDistance, closerToOwn: attribution.closerToOwn, margin: attribution.margin };
    });
    const passed = report.every(entry => entry.closerToOwn);
    console.log(JSON.stringify({ evidence: 'synthetic voice contrast, not user voice', provider: args.provider, job: `${JOB.company} — ${JOB.title}`, passed, personas: report }, null, 2));
    for (const entry of report) {
      console.error(`${entry.label}: own ${entry.ownDistance} vs other ${entry.otherDistance} → ${entry.closerToOwn ? 'own samples closer' : 'NOT closer to own samples'}`);
    }
    return passed ? 0 : 1;
  } finally {
    if (!args.keep) for (const root of roots) await rm(root, { recursive: true, force: true });
    else for (const root of roots) console.error(`kept ${root}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(`voice contrast failed: ${error.message}`); process.exitCode = 2; });
}
