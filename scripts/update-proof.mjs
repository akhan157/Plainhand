#!/usr/bin/env node
// U15 proof: a real update from the previous release to this branch, on a populated
// install, then a rollback.
//
// What it does, in a throw-away directory under $TMPDIR:
//   1. builds a local "release" remote from this repository and tags two synthetic
//      releases whose only difference from this branch is VERSION (v1.2.0-proof, v1.2.1-proof);
//   2. clones the previous release (v1.1.2 by default) as a candidate install and installs
//      its dependencies from the npm cache (--offline, no network);
//   3. fills the workspace with the records the row names: profile, stories, master resume,
//      two jobs (one with a packet and an approval), tracker rows, contacts, settings, a
//      reusable answer and a writing sample — approved through the v1.1.2 code itself;
//   4. starts v1.1.2 and reads everything back through its API (the baseline);
//   5. updates with the commands the v1.1.2 release documents, restarts, and checks every
//      record through the new API, the files on disk and the migration backup;
//   6. updates again with the one-command updater, rolls back one release (code only) and
//      then across the migration, and starts v1.1.2 again against its original data;
//   7. checks the fake ~/.codex and ~/.claude credential directories were never touched.
//
// Usage: node scripts/update-proof.mjs [--from v1.1.2] [--to HEAD] [--work DIR] [--keep]
// Exit code 0 means every check passed. Output is printed and can be recorded with tee.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const flags = {};
for (let index = 2; index < process.argv.length; index++) {
  const item = process.argv[index];
  if (!item.startsWith('--')) continue;
  const [name, inline] = item.slice(2).split('=');
  if (inline !== undefined) flags[name] = inline;
  else if (process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) flags[name] = process.argv[++index];
  else flags[name] = true;
}

const FROM = typeof flags.from === 'string' ? flags.from : 'v1.1.2';
const TO = typeof flags.to === 'string' ? flags.to : 'HEAD';
const RELEASES = ['v1.2.0-proof', 'v1.2.1-proof'];
const TMP = process.env.TMPDIR || os.tmpdir();

const checks = [];
const candidateSteps = [];
const phases = [];
const startedAll = Date.now();
let work = null;

const log = message => console.log(message);
const phase = name => { phases.push({ phase: name, at: new Date().toISOString() }); log(`\n=== ${name} ===`); };
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`CHECK FAILED: ${label}${detail ? ` — ${detail}` : ''}`);
  checks.push(label);
}
async function candidateStep(label, run) {
  const at = Date.now();
  const value = await run();
  const ms = Date.now() - at;
  candidateSteps.push({ label, ms });
  log(`  [${(ms / 1000).toFixed(1)} s] ${label}`);
  return value;
}

function run(command, args, { cwd = ROOT, env = {}, timeout = 900000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout });
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const git = (cwd, args, options = {}) => run('git', ['-C', cwd, ...args], options).stdout.trim();

const sha256 = value => createHash('sha256').update(value).digest('hex');
async function hashFile(file) { return sha256(await readFile(file)); }
async function hashTree(directory) {
  const result = {};
  const walk = async (current, prefix = '') => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(current, entry.name), key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(full, `${key}/`);
      else { const info = await stat(full); result[key] = `${info.size}:${info.mtimeMs}:${await hashFile(full)}`; }
    }
  };
  await walk(directory);
  return result;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout, describe) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(100); }
  throw new Error(describe());
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

// ── the candidate install ───────────────────────────────────────

let candidate = null, home = null, npmCache = null;
const envFor = () => ({ HOME: home, USERPROFILE: home, npm_config_cache: npmCache, npm_config_audit: 'false', npm_config_fund: 'false' });

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['plainhand-server.mjs', '--port', String(port), '--data-root', candidate], { cwd: candidate, env: { ...process.env, ...envFor() }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const apiFile = path.join(candidate, 'data', 'plainhand', 'local-api.json');
  await waitFor(() => /Plainhand is ready/.test(output) && existsSync(apiFile), 120000, () => `Plainhand did not start:\n${output}\n${errors}`);
  const api = JSON.parse(await readFile(apiFile, 'utf8'));
  // The page carries the owner session token; local-api.json carries the MCP bridge token.
  const page = await fetch(`http://127.0.0.1:${api.port}/`).then(response => response.text()).catch(() => '');
  const session = page.match(/name="plainhand-session" content="([A-Za-z0-9]+)"/)?.[1] || null;
  if (!session) throw new Error('Could not read the Plainhand session token from the page.');
  return {
    port: api.port, token: session, log: () => output + errors,
    stop: async () => { child.kill('SIGTERM'); await new Promise(resolve => child.on('exit', resolve)); },
  };
}

async function call(server, endpoint, body) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Plainhand-Token': server.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

// ── fixtures ────────────────────────────────────────────────────

const CV = [
  'Riley Example', 'Boston, MA · riley@example.invalid · +1 617 555 0100', '',
  'Education', 'B.S. Mechanical Engineering, Example University, 2027', '',
  'Experience', 'Formula SAE, Suspension Lead, 2024–2026',
  'Designed and tested a lightweight chassis for the Formula SAE team.',
  'Wrote an impeller-wear test procedure the lab still uses.', '',
  'Skills', 'SolidWorks, ANSYS, MATLAB, GD&T',
].join('\n');

const PROFILE = {
  name: 'Riley Example', email: 'riley@example.invalid', phone: '+1 617 555 0100', location: 'Boston, MA',
  timezone: 'America/New_York', roles: 'Mechanical Engineer', compensation: '$70k–$85k', eligibility: 'US citizen',
  graduation: 'May 2027', links: 'https://example.invalid/riley', resume: CV,
  story: 'I am a mechanical engineering graduate who builds and tests hardware, and I write the test procedures other people run.',
  voice: 'Direct, specific, no superlatives.', constraints: 'Entry-level mechanical roles in Boston; no relocation.',
};

const MASTER_DRAFT = {
  headline: 'Mechanical engineering graduate (May 2027)',
  resume: [
    { section: 'Experience', text: 'Designed and tested a lightweight chassis for the Formula SAE team.' },
    { section: 'Experience', text: 'Wrote an impeller-wear test procedure the lab still uses.' },
    { section: 'Education', text: 'B.S. Mechanical Engineering, Example University, 2027' },
  ],
  coverLetter: 'I design and test hardware, and I would bring that to the {role} role at {company}.',
};

const story = (role, text, at) => ({ role, text, at });

function job(id, fields) {
  return {
    id, company: fields.company, title: fields.title, url: fields.url, description: fields.description,
    location: 'Boston, MA', createdAt: fields.createdAt, stage: fields.stage, status: fields.status,
    selected: fields.stage === 'approved', evaluation: { score: fields.score, recommendation: fields.recommendation, summary: 'Fixture evaluation.' },
    packet: fields.packet || null, record: fields.record || { contacts: [], interviews: [], nextAction: null },
    contextHash: null, approvedHash: null,
  };
}

const STATE = {
  version: 1, revision: 12,
  profile: { ...PROFILE },
  provider: 'codex',
  jobs: [
    job('job-pumps', {
      company: 'Example Pumps', title: 'Graduate Engineer', url: 'https://jobs.lever.co/example-pumps/graduate-engineer',
      description: 'Graduate engineering role designing pump components, running bench tests and writing test procedures. '.repeat(3),
      createdAt: '2026-10-01T09:00:00.000Z', stage: 'approved', status: 'Applied', score: 4.2, recommendation: 'Apply',
      packet: {
        headline: MASTER_DRAFT.headline,
        resume: [{ section: 'Experience', text: 'Designed and tested a lightweight chassis for the Formula SAE team.' }],
        coverLetter: 'I would bring my design and test experience to the {role} role at {company}.',
        answers: [{ question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis for the Formula SAE team.' }],
        questions: [],
      },
      record: {
        contacts: [{ id: 'contact-dana', name: 'Dana Example', role: 'Recruiter', type: 'recruiter', email: 'dana@example.invalid', phone: null, linkedin: null, notes: null, date: '2026-10-03', addedAt: '2026-10-03T12:00:00.000Z' }],
        interviews: [{ id: 'round-1', stage: 'Screen', date: '2026-10-10', time: null, status: 'completed', interviewer: 'Dana Example', preparation: null, notes: null, addedAt: '2026-10-03T12:05:00.000Z' }],
        nextAction: { text: 'Send the writing sample', due: '2026-10-20' },
      },
    }),
    job('job-robotics', {
      company: 'Example Robotics', title: 'Test Engineer', url: 'https://jobs.lever.co/example-robotics/test-engineer',
      description: 'Test engineering role building test rigs and running validation campaigns. '.repeat(4),
      createdAt: '2026-10-02T09:00:00.000Z', stage: 'evaluated', status: 'Evaluated', score: 4.0, recommendation: 'Apply',
    }),
  ],
  sources: [], tasks: [],
  conversation: [
    story('user', 'I ran the brake test rig for two seasons, and I wrote the procedure the lab still uses.', '2026-10-01T10:00:00.000Z'),
    story('assistant', 'That is hands-on validation work with a procedure you wrote. What did the procedure catch?', '2026-10-01T10:00:05.000Z'),
    story('user', 'Two bad batches: the clearance check every ten hours caught both before they shipped.', '2026-10-01T10:02:00.000Z'),
    story('assistant', 'Noted as a testing outcome.', '2026-10-01T10:02:05.000Z'),
  ],
  understanding: null,
  standard: null,
  settings: { autonomy: { enabled: true, perDay: 2, minScore: 4 } },
  claimLine: { decisions: [], statements: [{ text: 'I wrote the impeller-wear test procedure the lab still uses.', at: '2026-10-02T00:00:00.000Z' }] },
  writingSamples: [{ id: 'sample-1', title: 'Note to a recruiter', text: 'I build test rigs and write the procedures that keep them honest.', at: '2026-10-01T00:00:00.000Z' }],
  events: [{ at: '2026-10-01T09:00:00.000Z', text: 'Application added: Example Pumps.' }],
};

const CONFIG = `candidate:
  full_name: Riley Example
  email: riley@example.invalid
  phone: "+1 617 555 0100"
  location: Boston, MA
target_roles:
  primary:
    - Mechanical Engineer
location:
  timezone: America/New_York
  visa_status: US citizen
compensation:
  target_range: "$70k-$85k"
`;

const ANSWER_BANK = `version: 1
answers:
  - id: answer-describe-a-hands-on-project
    question: Describe a hands-on project
    answer: I designed and tested a lightweight chassis for the Formula SAE team.
    evidence:
      - sourceId: cv
        quote: Designed and tested a lightweight chassis
    scope: global
    reviewedAt: '2026-10-01'
    reviewBy: null
`;

const TRACKER = `# Applications

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-01 | Example Pumps | Graduate Engineer | 4.2/5 | Applied | — | — | Applied through the careers site. |
| 2 | 2026-10-02 | Example Robotics | Test Engineer | 4.0/5 | Evaluated | — | — | Waiting on the evaluation. |
`;

const STORY_BANK = `# Story bank

## Testing that changed a decision
- I wrote an impeller-wear test procedure the lab still uses.
- The clearance check every ten hours caught two bad batches before they shipped.
`;

const USER_FILES = {
  'cv.md': `${CV}\n`,
  'config/profile.yml': CONFIG,
  'data/applications.md': TRACKER,
  'data/answer-bank.yml': ANSWER_BANK,
  'interview-prep/story-bank.md': STORY_BANK,
  'modes/_profile.md': '# Candidate narrative\n\nRiley builds and tests hardware, and writes the procedures other people run.\n',
  'portals.yml': 'tracked_companies:\n  - Example Pumps\n',
};

// Approves the master resume and the packet through the v1.1.2 code itself, so the hashes
// the update has to preserve are the ones that release really wrote.
const SEED = `
import { Workspace } from './plainhand/store.mjs';
import { approveStandard, standardStatus } from './plainhand/standard.mjs';
import { packetIdentity } from './plainhand/workflow.mjs';
const workspace = new Workspace(process.cwd());
const state = await workspace.load();
const draft = ${JSON.stringify(MASTER_DRAFT)};
state.standard = { kind: 'master', draft, review: { passed: true, issues: [] }, createdAt: '2026-10-03T00:00:00.000Z', approvedHash: null, approvedAt: null, contextHash: null };
approveStandard(state, '2026-10-04T12:00:00.000Z');
const context = await workspace.context(state);
state.standard.contextHash = context.hash;
for (const job of state.jobs) {
  job.contextHash = context.hash;
  if (job.stage === 'approved') job.approvedHash = packetIdentity(job);
}
await workspace.write('data/plainhand/workspace.json', JSON.stringify(state, null, 2) + '\\n');
const after = await workspace.load();
console.log(JSON.stringify({
  contextHash: context.hash,
  standardStatus: standardStatus(after, context.hash),
  standardApprovedHash: after.standard.approvedHash,
  packetHashes: Object.fromEntries(after.jobs.map(item => [item.id, item.approvedHash || null])),
}));
`;

// ── assertions shared by the "after" stops ──────────────────────

async function expectRecords(server, { label, packetHash, storyKeys }) {
  const state = await call(server, 'state');
  check(state.status === 200, `${label}: /api/state answers`);
  const view = state.data;
  check(view.profile.name === PROFILE.name, `${label}: profile name`);
  check(view.profile.email === PROFILE.email && view.profile.phone === PROFILE.phone, `${label}: profile contact fields`);
  check(view.profile.story === PROFILE.story, `${label}: profile narrative`);
  check(view.profile.resume === CV, `${label}: resume text (cv.md mirror)`);
  check(view.provider === 'codex', `${label}: chosen AI provider kept`);
  check(view.jobs.length === 2, `${label}: both jobs`);
  const pumps = view.jobs.find(item => item.id === 'job-pumps');
  const robotics = view.jobs.find(item => item.id === 'job-robotics');
  check(Boolean(pumps && robotics), `${label}: job identities`);
  check(pumps.company === 'Example Pumps' && pumps.title === 'Graduate Engineer', `${label}: job A fields`);
  check(pumps.record?.contacts?.length === 1 && pumps.record.contacts[0].name === 'Dana Example', `${label}: contact`);
  check(pumps.record?.interviews?.length === 1 && pumps.record.interviews[0].stage === 'Screen', `${label}: interview round`);
  check(pumps.record?.nextAction?.text === 'Send the writing sample', `${label}: next action`);
  check(pumps.status === 'Applied' && robotics.status === 'Evaluated', `${label}: tracker statuses on the jobs`);
  check(String(view.tracker).includes('Example Pumps') && String(view.tracker).includes('Example Robotics'), `${label}: tracker rows`);
  check(view.writingSamples?.length === 1 && view.writingSamples[0].text.includes('test rigs'), `${label}: writing sample`);
  check(view.settings?.autonomy?.perDay === 2 && view.settings.autonomy.minScore === 4, `${label}: autonomy setting`);
  check(view.standard?.draft?.resume?.length === MASTER_DRAFT.resume.length, `${label}: master resume draft`);
  check(view.answerBank?.length === 1 && view.answerBank[0].answer === 'I designed and tested a lightweight chassis for the Formula SAE team.', `${label}: reusable answer`);
  check(view.conversation?.length === 4, `${label}: stories in the conversation`);
  STATE.conversation.forEach((message, index) => check(view.conversation[index]?.text === message.text && view.conversation[index]?.at === message.at, `${label}: story ${index + 1} text`));
  if (storyKeys) storyKeys.forEach((key, index) => check(view.conversation[index]?.key === key, `${label}: story ${index + 1} key`, `${view.conversation[index]?.key} vs ${key}`));
  if (packetHash) check(pumps.approvedHash === packetHash, `${label}: packet approval identity kept as evidence`);
  return view;
}

function expectNewRelease(view, { label }) {
  check(view.standardStatus === 'approved', `${label}: master resume still approved`);
  check(view.standard?.contextRechecked?.from, `${label}: master resume records the re-checked basis`);
  check(view.settings?.roleOrder === 'recent', `${label}: role order default present`);
  check(view.answerBank[0].sourceKind === 'factual' && view.answerBank[0].verifiedAt === '2026-10-01', `${label}: reusable answer keeps its provenance`);
  const pumps = view.jobs.find(item => item.id === 'job-pumps');
  check(pumps.stage === 'needs-refresh', `${label}: the packet asks for a fresh approval`);
  check(pumps.approvalReset?.reason === 'profile-privacy' && pumps.approvalReset?.from === 'approved', `${label}: the reset is recorded with its reason`);
  check(Boolean(pumps.stale), `${label}: the job is marked stale, not silently approved`);
  check(view.events.some(event => /email and phone/.test(event.text)), `${label}: the candidate is told why`);
  check(view.events.some(event => /master resume is still approved/.test(event.text)), `${label}: the candidate is told the master resume was kept`);
}

// ── main ────────────────────────────────────────────────────────

try {
  work = flags.work ? path.resolve(flags.work) : await mkdtemp(path.join(TMP, 'u15-proof-'));
  await mkdir(work, { recursive: true });
  candidate = path.join(work, 'candidate');
  home = path.join(work, 'home');
  // The npm cache stays where the machine already has it: the proof may not need the
  // network, but it must not need an empty cache either. It is not a credential directory.
  npmCache = process.env.npm_config_cache || path.join(os.homedir(), '.npm');
  const release = path.join(work, 'release.git'), releaseWork = path.join(work, 'release-work');
  const stateFile = path.join(candidate, 'data/plainhand/workspace.json');
  const toSha = git(ROOT, ['rev-parse', TO]);
  const fromSha = git(ROOT, ['rev-parse', `${FROM}^{commit}`]);
  log(`U15 update proof — ${FROM} (${fromSha.slice(0, 12)}) → ${TO} (${toSha.slice(0, 12)})`);
  log(`Work directory: ${work}`);

  // The release remote, with two synthetic releases on top of this branch. Only VERSION
  // differs, so the code under test is this branch.
  phase('Build the release remote');
  git(work, ['clone', '--quiet', '--bare', ROOT, release]);
  git(work, ['clone', '--quiet', release, releaseWork]);
  for (const tag of RELEASES) {
    await writeFile(path.join(releaseWork, 'VERSION'), `${tag.slice(1, -6)} # x-release-please-version\n`);
    git(releaseWork, ['add', 'VERSION']);
    git(releaseWork, ['-c', 'user.name=U15 Proof', '-c', 'user.email=proof@example.invalid', 'commit', '--quiet', '-m', `Release ${tag}`]);
    git(releaseWork, ['tag', tag]);
  }
  git(releaseWork, ['push', '--quiet', 'origin', ...RELEASES]);
  check(git(release, ['rev-parse', RELEASES[0]]) !== fromSha, 'the first synthetic release is a new commit');
  check(git(release, ['show', `${RELEASES[0]}:VERSION`]).split(/\s+/)[0] === '1.2.0', 'the first release reports 1.2.0');

  // A candidate install already at the previous release.
  phase('Candidate install at the previous release');
  await mkdir(home, { recursive: true });
  await mkdir(npmCache, { recursive: true }).catch(() => {});
  for (const [file, contents] of Object.entries({ '.codex/auth.json': '{"token":"fake-codex"}\n', '.codex/config.toml': 'model = "fake"\n', '.claude/.credentials.json': '{"token":"fake-claude"}\n', '.config/gh/hosts.yml': 'github.com: {user: riley}\n' })) {
    await mkdir(path.dirname(path.join(home, file)), { recursive: true });
    await writeFile(path.join(home, file), contents);
  }
  const credentialsBefore = { codex: await hashTree(path.join(home, '.codex')), claude: await hashTree(path.join(home, '.claude')) };
  git(work, ['clone', '--quiet', release, candidate]);
  git(candidate, ['checkout', '--quiet', FROM]);
  check(git(candidate, ['show', 'HEAD:VERSION']).split(/\s+/)[0] === FROM.replace(/^v/, ''), `the candidate starts at ${FROM}`);
  await candidateStep(`install ${FROM} dependencies (npm ci --offline)`, () => run('npm', ['ci', '--offline', '--no-audit', '--no-fund'], { cwd: candidate, env: envFor() }));

  // A populated workspace, written in the previous release's schema and approved by its code.
  phase('Populate the workspace');
  for (const [file, contents] of Object.entries(USER_FILES)) {
    await mkdir(path.dirname(path.join(candidate, file)), { recursive: true });
    await writeFile(path.join(candidate, file), contents);
  }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(STATE, null, 2) + '\n');
  await writeFile(path.join(candidate, 'u15-seed.mjs'), SEED);
  const seed = JSON.parse(run(process.execPath, ['u15-seed.mjs'], { cwd: candidate, env: envFor() }).stdout.trim().split('\n').pop());
  await rm(path.join(candidate, 'u15-seed.mjs'));
  check(seed.standardStatus === 'approved', 'the seeded master resume is approved by the previous release');
  check(Boolean(seed.packetHashes['job-pumps']), 'the seeded packet is approved by the previous release');

  const fileHashes = {};
  for (const file of Object.keys(USER_FILES)) fileHashes[file] = await hashFile(path.join(candidate, file));

  let server = await startServer();
  let before;
  try {
    before = await call(server, 'state');
    check(before.status === 200, 'the previous release starts and reads the workspace');
    check(before.data.standardStatus === 'approved', 'the previous release reports the master resume approved');
    check(before.data.jobs.find(item => item.id === 'job-pumps').approvedHash === seed.packetHashes['job-pumps'], 'the previous release reads the packet approval');
  } finally { await server.stop(); }
  // What the candidate's install holds immediately before the update. Starting Plainhand
  // writes a state revision of its own, so this is the file the migration must back up.
  const stateBytesBeforeUpdate = await readFile(stateFile);

  // ── the update a v1.1.2 install documents: fetch the release, switch, install ──
  phase(`Update ${FROM} → ${RELEASES[0]} with the documented commands`);
  await candidateStep(`switch to ${RELEASES[0]} (git fetch --tags && git checkout)`, () => {
    git(candidate, ['fetch', '--tags', 'origin']);
    git(candidate, ['checkout', '--quiet', RELEASES[0]]);
  });
  check(git(candidate, ['show', 'HEAD:VERSION']).split(/\s+/)[0] === '1.2.0', 'the checkout is release 1.2.0');
  await candidateStep('install the release dependencies (npm ci --offline)', () => run('npm', ['ci', '--offline', '--no-audit', '--no-fund'], { cwd: candidate, env: envFor() }));
  check(existsSync(path.join(candidate, 'plainhand', 'migrations.mjs')), 'the new release ships the migration runner');

  phase('Start the new release (migrations run on start)');
  const startupAt = Date.now();
  server = await startServer();
  const startupMs = Date.now() - startupAt;
  candidateSteps.push({ label: 'start Plainhand (workspace migrates automatically)', ms: startupMs });
  log(`  [${(startupMs / 1000).toFixed(1)} s] start Plainhand (workspace migrates automatically)`);
  let afterNew, migrated = null, storyKeysAfter = null, answerBankAfterApprove = null;
  try {
    check(/Workspace state migrated 1 → 2/.test(server.log()), 'the start migrated the workspace state', server.log().slice(0, 2000));
    afterNew = await expectRecords(server, { label: 'after update', packetHash: seed.packetHashes['job-pumps'], storyKeys: null });
    expectNewRelease(afterNew, { label: 'after update' });
    // The update itself wrote nothing in the user layer; checked before anything else runs.
    for (const [file, hash] of Object.entries(fileHashes)) check(await hashFile(path.join(candidate, file)) === hash, `user file unchanged by the update: ${file}`);

    // The migrated records are usable, not just present.
    const autonomy = await call(server, 'settings/autonomy', { enabled: true, perDay: 5, minScore: 4 });
    check(autonomy.status === 200 && autonomy.data?.perDay === 5, 'the autonomy setting can be changed');
    const reverted = await call(server, 'settings/autonomy', { enabled: true, perDay: 2, minScore: 4 });
    check(reverted.status === 200 && reverted.data?.perDay === 2, 'the autonomy setting is back to the candidate value');
    const approvedAnswer = await call(server, 'action', { name: 'answers.approve', input: { id: 'answer-describe-a-hands-on-project' } });
    check(approvedAnswer.status === 200, 'the migrated reusable answer can be re-approved', JSON.stringify(approvedAnswer.data));
    answerBankAfterApprove = await readFile(path.join(candidate, 'data/answer-bank.yml'));
    const exported = await call(server, 'export');
    check(exported.status === 200 && exported.data?.profile?.name === PROFILE.name, 'the workspace exports with its profile');
    check(exported.data.jobs.some(item => item.id === 'job-pumps'), 'the export contains the applications');

    migrated = JSON.parse(await readFile(stateFile, 'utf8'));
    check(migrated.version === 2, 'the state file is at version 2');
    check(migrated.conversation.every(message => typeof message.id === 'string' && message.id), 'every story has the id the edit and delete routes use');
    check(afterNew.conversation.every(message => message.key === message.id), 'the API key for each story is its id');
    storyKeysAfter = afterNew.conversation.map(message => message.key);
    check(migrated.jobs.find(item => item.id === 'job-pumps').approvalReset?.reason === 'profile-privacy', 'the state file records the approval reset');
  } finally { await server.stop(); }

  const backups = (await readdir(path.join(candidate, 'data/plainhand/backups'), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('migrate-1-to-2-')).map(entry => entry.name);
  check(backups.length === 1, 'one dated pre-migration backup');
  const backupDir = path.join(candidate, 'data/plainhand/backups', backups[0]);
  check(await readFile(path.join(backupDir, 'workspace.json')).then(buffer => buffer.equals(stateBytesBeforeUpdate)), 'the backup is the exact pre-update state file');
  const manifest = JSON.parse(await readFile(path.join(backupDir, 'MANIFEST.json'), 'utf8'));
  check(manifest.from === 1 && manifest.to === 2 && manifest.appVersion === '1.2.0', 'the backup manifest names the versions', JSON.stringify(manifest));
  check(sha256(await readFile(path.join(backupDir, 'workspace.json'))) === manifest.files[0].sha256, 'the backup matches its recorded hash');
  const journal = JSON.parse(await readFile(path.join(candidate, 'data/plainhand/migrations.json'), 'utf8'));
  check(journal.migrations[0].backup.endsWith(backups[0]), 'the migration journal points at the backup');
  const credentialsAfter = { codex: await hashTree(path.join(home, '.codex')), claude: await hashTree(path.join(home, '.claude')) };
  check(JSON.stringify(credentialsAfter) === JSON.stringify(credentialsBefore), 'provider credential directories were not touched');

  // ── the one-command update to the next release ──
  phase(`One-command update ${RELEASES[0]} → ${RELEASES[1]}`);
  const updateRun = await candidateStep(`npm run update -- --version ${RELEASES[1]}`, () => run('npm', ['run', 'update', '--', '--version', RELEASES[1]], { cwd: candidate, env: envFor() }));
  check(/Plainhand 1\.2\.1 installed/.test(updateRun.stdout), 'the updater reports the new version', updateRun.stdout);
  check(git(candidate, ['show', 'HEAD:VERSION']).split(/\s+/)[0] === '1.2.1', 'the updater switched the code');
  const updateRecord = JSON.parse(await readFile(path.join(candidate, 'data/plainhand/backups', (await readdir(path.join(candidate, 'data/plainhand/backups'))).filter(name => name.startsWith('update-')).sort().pop(), 'UPDATE.json'), 'utf8'));
  check(updateRecord.previousRef && updateRecord.version === '1.2.1', 'the update record names the versions');
  check(updateRecord.migration === null, 'a release that changes no state records no state migration');
  server = await startServer();
  try {
    const afterSecond = await expectRecords(server, { label: 'after second release', packetHash: seed.packetHashes['job-pumps'], storyKeys: storyKeysAfter });
    check(afterSecond.settings.roleOrder === 'recent', 'settings survive the one-command update');
  } finally { await server.stop(); }

  // ── rollback, code only ──
  phase(`Roll back ${RELEASES[1]} → ${RELEASES[0]}`);
  const rollbackOne = await candidateStep('npm run rollback (code only)', () => run('npm', ['run', 'rollback'], { cwd: candidate, env: envFor() }));
  check(/Rolled back to Plainhand 1\.2\.0/.test(rollbackOne.stdout), 'the rollback reports the previous version', rollbackOne.stdout);
  check(git(candidate, ['show', 'HEAD:VERSION']).split(/\s+/)[0] === '1.2.0', 'the code is back at 1.2.0');
  check(JSON.parse(await readFile(stateFile, 'utf8')).version === 2, 'a code-only rollback leaves the state alone');
  server = await startServer();
  try { await expectRecords(server, { label: 'after code-only rollback', packetHash: seed.packetHashes['job-pumps'], storyKeys: storyKeysAfter }); }
  finally { await server.stop(); }

  // ── rollback across the migration ──
  phase(`Roll back ${RELEASES[0]} → ${FROM} with the workspace state`);
  const rollbackTwo = await candidateStep(`npm run rollback -- --version ${FROM} --offline`, () => run('npm', ['run', 'rollback', '--', '--version', FROM, '--offline'], { cwd: candidate, env: envFor() }));
  check(/Rolled back to Plainhand 1\.1\.2/.test(rollbackTwo.stdout), 'the rollback reports 1.1.2', rollbackTwo.stdout);
  check(git(candidate, ['rev-parse', 'HEAD']) === fromSha, 'the code is the exact previous release commit');
  check(await readFile(stateFile).then(buffer => buffer.equals(stateBytesBeforeUpdate)), 'the workspace state file is byte-identical to the pre-update file');
  server = await startServer();
  let restored;
  try {
    restored = await expectRecords(server, { label: 'after rollback', packetHash: seed.packetHashes['job-pumps'], storyKeys: null });
    check(restored.standardStatus === 'approved', 'the previous release shows the master resume approved again');
    check(restored.jobs.find(item => item.id === 'job-pumps').stage === 'approved', 'the packet approval is back');
    check(restored.conversation.every(message => !message.id), 'the restored state is in the previous release\'s shape');
    check(restored.settings.roleOrder === undefined, 'no new-release setting leaked into the restored state');
  } finally { await server.stop(); }
  // Rollback restores the workspace state; it never rewrites user files. The answer bank is
  // the one file the candidate's own re-approval changed in this run, so it is compared to
  // what that action wrote.
  for (const [file, hash] of Object.entries(fileHashes)) {
    if (file === 'data/answer-bank.yml') continue;
    check(await hashFile(path.join(candidate, file)) === hash, `user file unchanged after rollback: ${file}`);
  }
  check((await readFile(path.join(candidate, 'data/answer-bank.yml'))).equals(answerBankAfterApprove), 'the answer bank is what the re-approval wrote, not rewritten by the rollback');
  const credentialsFinal = { codex: await hashTree(path.join(home, '.codex')), claude: await hashTree(path.join(home, '.claude')) };
  check(JSON.stringify(credentialsFinal) === JSON.stringify(credentialsBefore), 'provider credential directories were still untouched after rollback');

  const summary = {
    from: FROM, to: TO, work,
    candidateSteps: candidateSteps.map(item => ({ step: item.label, ms: item.ms })),
    candidateStepsTotalMs: candidateSteps.reduce((sum, item) => sum + item.ms, 0),
    phases,
    checks: checks.length,
    counts: {
      jobs: restored.jobs.length, contacts: restored.jobs.find(item => item.id === 'job-pumps').record.contacts.length,
      stories: restored.conversation.length, writingSamples: restored.writingSamples.length, answers: restored.answerBank.length,
      trackerRows: String(restored.tracker).split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line)).length,
      settings: { autonomy: restored.settings.autonomy },
    },
    totalMs: Date.now() - startedAll,
  };
  log('\n=== Candidate-side steps ===');
  for (const item of candidateSteps) log(`  ${(item.ms / 1000).toFixed(1).padStart(6)} s  ${item.label}`);
  log(`  ${(summary.candidateStepsTotalMs / 1000).toFixed(1).padStart(6)} s  total, including two installs and three starts`);
  log(`\n${checks.length} checks passed in ${(summary.totalMs / 1000).toFixed(1)} s.`);
  if (flags.json) log(JSON.stringify(summary));
  const outDir = path.join(ROOT, 'output', 'u15-update');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'proof.json'), JSON.stringify(summary, null, 2) + '\n');
  log(`Summary written to ${path.relative(ROOT, path.join(outDir, 'proof.json'))}`);
  if (!flags.keep) await rm(work, { recursive: true, force: true });
  else log(`Kept ${work}`);
  process.exit(0);
} catch (error) {
  console.error(`\n${error.message}`);
  if (work) console.error(`\nThe work directory was kept for inspection: ${work}`);
  process.exit(1);
}
