// U15 — updates keep the candidate's setup. These are the fast checks: the migration
// chain, the v1.1.2 → current step, backups, rollback, the answer-bank read-time backfill
// and the release gate's preflight. The full clone-update-rollback run is
// scripts/update-proof.mjs, recorded in docs/internal/lanes/u15-updates/RESULT.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace, storyKey } from '../plainhand/store.mjs';
import { MemoryStorage } from '../plainhand/storage.mjs';
import {
  STATE_VERSION, MIGRATIONS, MigrationError, migrateState, reverseState, planMigrations,
  migrateWorkspace, rollbackWorkspace, migrationStatus, legacyStandardIdentity,
} from '../plainhand/migrations.mjs';
import { standardIdentity, standardStatus } from '../plainhand/standard.mjs';
import { AnswerBank, withProvenance, reuseProblem } from '../plainhand/answer-bank.mjs';
import { preflight } from '../scripts/release-check.mjs';
import { createPlainhand } from '../plainhand-server.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CV = 'Designed and tested a lightweight chassis for a Formula SAE team.\nB.S. Mechanical Engineering, Example University, 2027.';

const legacyDraft = () => ({
  headline: 'Mechanical Engineering Graduate',
  resume: [
    { section: 'Projects', text: 'Designed and tested a lightweight chassis for a Formula SAE team.' },
    { section: 'Education', text: 'B.S. Mechanical Engineering, Example University, 2027.' },
  ],
  coverLetter: 'I would like to bring my design and testing experience to the {role} role at {company}.',
});

function legacyJob(id, stage, overrides = {}) {
  return {
    id, company: id === 'a' ? 'Example Pumps' : 'Example Robotics', title: id === 'a' ? 'Graduate Engineer' : 'Test Engineer',
    url: `https://jobs.lever.co/example/${id}`, description: 'Graduate engineering design and testing role. '.repeat(5),
    createdAt: '2026-10-01T09:00:00.000Z', stage, status: stage === 'approved' ? 'Evaluated' : 'Evaluated',
    selected: stage === 'approved', contextHash: 'legacy-context', evaluation: { score: 4.2, recommendation: 'Apply' },
    packet: { headline: 'Mechanical Engineering Graduate', resume: [], coverLetter: 'Letter.' },
    record: { contacts: [{ id: `c-${id}`, name: 'Dana Example', role: 'Recruiter', type: 'recruiter', email: 'dana@example.invalid', phone: null, linkedin: null, notes: null, date: '2026-10-03', addedAt: '2026-10-03T12:00:00.000Z' }], interviews: [], nextAction: null },
    ...overrides,
  };
}

// A state file exactly as 1.1.2 wrote it: no conflictReview, no settings.roleOrder, no
// conversation ids, no answer-bank provenance, a standard approval under the old identity.
function legacyState() {
  const draft = legacyDraft();
  return {
    version: 1, revision: 7,
    profile: { ...candidate, email: 'graduate@example.invalid', phone: '+1 617 555 0100', resume: CV },
    provider: 'codex',
    jobs: [legacyJob('a', 'approved', { approvedHash: 'packet-approval-a' }), legacyJob('b', 'evaluated')],
    sources: [], tasks: [],
    conversation: [
      { role: 'user', text: 'I ran the brake test rig for two seasons.', at: '2026-10-01T10:00:00.000Z' },
      { role: 'assistant', text: 'That is useful testing experience.', at: '2026-10-01T10:00:05.000Z' },
      { role: 'user', text: 'I also wrote the lab procedure.', at: '2026-10-02T10:00:00.000Z' },
    ],
    understanding: null,
    standard: {
      kind: 'master', draft: legacyDraft(), contextHash: 'legacy-context',
      approvedHash: legacyStandardIdentity(draft), approvedAt: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z',
    },
    settings: { autonomy: { enabled: true, perDay: 2, minScore: 4 } },
    claimLine: { decisions: [], statements: [{ text: 'Built the chassis.', at: '2026-10-02T00:00:00.000Z' }] },
    writingSamples: [{ id: 'sample-1', title: 'Note to a recruiter', text: 'I build hardware carefully.', at: '2026-10-01T00:00:00.000Z' }],
    events: [],
  };
}

// ── the chain ───────────────────────────────────────────────────

test('the migration chain is contiguous and ends at STATE_VERSION', () => {
  assert.ok(MIGRATIONS.length >= 1);
  assert.equal(MIGRATIONS[0].from, 1);
  for (let index = 1; index < MIGRATIONS.length; index++) assert.equal(MIGRATIONS[index].from, MIGRATIONS[index - 1].to, 'a migration chain must not skip a version');
  assert.equal(MIGRATIONS.at(-1).to, STATE_VERSION);
  assert.deepEqual(planMigrations(STATE_VERSION), []);
  assert.equal(planMigrations(1).at(-1).to, STATE_VERSION);
  for (const step of MIGRATIONS) { assert.equal(typeof step.up, 'function'); assert.equal(typeof step.down, 'function'); assert.ok(step.name); }
});

// ── the 1.1.2 → current step ────────────────────────────────────

test('a 1.1.2 workspace keeps every record and setting, and its master resume stays approved', () => {
  const legacy = legacyState();
  const { state, from, to, steps } = migrateState(legacy, { at: '2026-11-15T00:00:00.000Z', appVersion: '1.2.0', contextHash: 'new-context' });
  assert.equal(from, 1); assert.equal(to, STATE_VERSION); assert.ok(steps.length);
  assert.equal(state.version, STATE_VERSION);

  // Nothing the candidate wrote changed.
  assert.deepEqual(state.profile, legacy.profile);
  assert.equal(state.jobs.length, 2);
  assert.deepEqual(state.jobs[1].record, legacy.jobs[1].record);
  assert.deepEqual(state.writingSamples, legacy.writingSamples);
  assert.deepEqual(state.claimLine, legacy.claimLine);
  assert.deepEqual(state.conversation.map(message => ({ role: message.role, text: message.text, at: message.at })), legacy.conversation);

  // Settings keep the candidate's values and gain the current defaults.
  assert.deepEqual(state.settings.autonomy, { enabled: true, perDay: 2, minScore: 4 });
  assert.equal(state.settings.roleOrder, 'recent');

  // Stories address the same key they resolved to before.
  for (const [index, message] of state.conversation.entries()) assert.equal(message.id, storyKey(legacy.conversation[index]));

  // New lists exist with empty defaults.
  assert.deepEqual(state.conflictReview, { decisions: [], questionChecks: [] });
  assert.deepEqual(state.inbox, []);

  // The master resume is approved under the new identity. A 1.1.2 draft has no headings,
  // which the old identity also ignored, so the approval hash does not change at all.
  assert.equal(state.standard.approvedHash, standardIdentity(legacyDraft()));
  assert.equal(state.standard.approvedHash, legacyStandardIdentity(legacyDraft()));
  assert.equal(state.standard.approvalRehashed, undefined);
  // Its basis is re-checked, not thrown away: email and phone no longer travel, the draft
  // itself is unchanged, so the master resume stays usable after the update.
  assert.equal(state.standard.contextRechecked.from, 'legacy-context');
  assert.equal(state.standard.contextHash, 'new-context');
  assert.equal(standardStatus(state, 'new-context'), 'approved');

  // The packet approval is not silently lost: it is marked, the job asks for a fresh one,
  // and the candidate is told why.
  const approved = state.jobs.find(job => job.id === 'a');
  assert.equal(approved.stage, 'needs-refresh');
  assert.equal(approved.approvedHash, 'packet-approval-a');
  assert.equal(approved.approvalReset.reason, 'profile-privacy');
  assert.equal(approved.approvalReset.from, 'approved');
  assert.equal(state.jobs.find(job => job.id === 'b').stage, 'evaluated');
  assert.equal(state.jobs.find(job => job.id === 'b').approvalReset, undefined);
  assert.ok(state.events.some(event => /email and phone/.test(event.text)), 'the candidate sees why an approval needs repeating');
  assert.ok(state.events.some(event => /master resume is still approved/.test(event.text)), 'the candidate sees the master resume kept its approval');

  // A job whose context already matches is left alone.
  const sameContext = migrateState(legacyState(), { at: '2026-11-15T00:00:00.000Z', contextHash: 'legacy-context' }).state;
  assert.equal(sameContext.jobs.find(job => job.id === 'a').stage, 'approved');

  // Running the step again changes nothing.
  const again = structuredClone(state);
  for (const step of planMigrations(1)) { step.up(again, { at: '2026-11-15T00:00:00.000Z', contextHash: 'new-context' }); again.version = step.to; }
  assert.deepEqual(again, state);
});

test('a master resume that already carries headings keeps its approval when the identity formula changed', () => {
  const draft = {
    ...legacyDraft(),
    resume: [{ section: 'Education', heading: { org: 'Example University', title: 'B.S. Mechanical Engineering', location: 'Boston, MA', dates: '2027' }, text: 'Coursework: machine design.' }, ...legacyDraft().resume],
  };
  const legacy = legacyState();
  legacy.standard = { ...legacy.standard, draft, approvedHash: legacyStandardIdentity(draft) };
  const { state } = migrateState(legacy, { at: '2026-11-15T00:00:00.000Z', contextHash: 'legacy-context' });
  assert.notEqual(standardIdentity(draft), legacyStandardIdentity(draft), 'the fixture only proves something when the two formulas differ');
  assert.equal(state.standard.approvalRehashed.from, legacyStandardIdentity(draft));
  assert.equal(state.standard.approvedHash, standardIdentity(draft));
  assert.equal(state.standard.approvalRehashed.reason, 'heading-identity');
  assert.equal(standardStatus(state, 'legacy-context'), 'approved');
  assert.equal(reverseState(state, { to: 1 }).standard.approvedHash, legacyStandardIdentity(draft));
});

test('the reverse step restores the old approvals and leaves the candidate data in place', () => {
  const legacy = legacyState();
  const { state } = migrateState(legacy, { at: '2026-11-15T00:00:00.000Z', contextHash: 'new-context' });
  const back = reverseState(state, { to: 1 });
  assert.equal(back.version, 1);
  assert.equal(back.jobs.find(job => job.id === 'a').stage, 'approved');
  assert.equal(back.jobs.find(job => job.id === 'a').approvalReset, undefined);
  assert.equal(back.standard.approvedHash, legacyStandardIdentity(legacyDraft()));
  assert.equal(back.standard.contextHash, 'legacy-context');
  assert.equal(back.standard.contextRechecked, undefined);
  assert.equal(standardStatus(back, 'legacy-context'), 'approved');
  assert.deepEqual(back.profile, legacy.profile);
  assert.deepEqual(back.jobs.map(job => job.record), legacy.jobs.map(job => job.record));
  assert.deepEqual(back.writingSamples, legacy.writingSamples);
});

// ── backups, refusal and rollback ───────────────────────────────

function memoryWorkspace(state) {
  return new Workspace('test', { storage: new MemoryStorage(state ? { 'data/plainhand/workspace.json': JSON.stringify(state, null, 2) + '\n' } : {}) });
}

test('a migration backs up the exact state file first, journals it, and rollback restores it byte for byte', async () => {
  const legacy = legacyState();
  const workspace = memoryWorkspace(legacy);
  const original = await workspace.read('data/plainhand/workspace.json');
  const result = await migrateWorkspace(workspace, { at: '2026-11-15T00:00:00.000Z', appVersion: '1.2.0' });
  assert.equal(result.status, 'migrated');
  assert.equal(result.from, 1);
  assert.match(result.backup, /^data\/plainhand\/backups\/migrate-1-to-2-/);

  const backedUp = await workspace.read(`${result.backup}/workspace.json`);
  assert.equal(backedUp, original, 'the backup is the exact pre-migration file');
  const manifest = JSON.parse(await workspace.read(`${result.backup}/MANIFEST.json`));
  assert.equal(manifest.from, 1); assert.equal(manifest.to, STATE_VERSION);
  assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(manifest.steps.length);

  const journal = JSON.parse(await workspace.read('data/plainhand/migrations.json'));
  assert.equal(journal.migrations[0].backup, result.backup);
  assert.equal(journal.migrations[0].from, 1);

  const status = await migrationStatus(workspace);
  assert.equal(status.version, STATE_VERSION);
  assert.deepEqual(status.pending, []);

  const rolled = await rollbackWorkspace(workspace);
  assert.equal(rolled.restoredTo, 1);
  assert.equal(await workspace.read('data/plainhand/workspace.json'), original);

  // And starting the current code again migrates the restored file again.
  assert.equal((await migrateWorkspace(workspace, { at: '2026-11-15T01:00:00.000Z' })).status, 'migrated');
});

test('an unreadable or newer state is refused, and nothing is written', async () => {
  const corrupt = memoryWorkspace();
  await corrupt.write('data/plainhand/workspace.json', '{ not json');
  await assert.rejects(migrateWorkspace(corrupt), error => error instanceof MigrationError && /not readable JSON/.test(error.message));
  assert.equal(await corrupt.read('data/plainhand/workspace.json'), '{ not json');

  const newer = memoryWorkspace({ ...legacyState(), version: STATE_VERSION + 1 });
  const before = await newer.read('data/plainhand/workspace.json');
  await assert.rejects(migrateWorkspace(newer), error => error instanceof MigrationError && /written by Plainhand state version/.test(error.message));
  assert.equal(await newer.read('data/plainhand/workspace.json'), before);

  const empty = memoryWorkspace();
  assert.equal((await migrateWorkspace(empty)).status, 'empty');
});

test('the server migrates on start and the candidate sees their data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plainhand-u15-'));
  try {
    const workspace = new Workspace(root);
    await workspace.write('data/plainhand/workspace.json', JSON.stringify(legacyState(), null, 2) + '\n');
    await workspace.write('cv.md', CV + '\n');
    const app = await createPlainhand({ root, providers: fixtureProviders, startFeatures: false, workflowOptions: { agent: fixtureAgent } });
    try {
      const state = await app.workspace.load();
      assert.equal(state.version, STATE_VERSION);
      assert.equal(state.profile.name, candidate.name);
      assert.equal(state.jobs.length, 2);
      assert.equal(state.settings.autonomy.perDay, 2);
      assert.equal(state.conversation.length, 3);
      assert.equal(state.standard.approvedHash, standardIdentity(state.standard.draft), 'the master resume keeps its approval through the start-time migration');
    } finally { await app.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ── answer bank: saved 1.1.2 answers stay reusable ──────────────

test('an answer saved by 1.1.2 keeps working: provenance is derived, not re-entered', async () => {
  const legacyEntry = { id: 'answer-describe-a-project', question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis' }], scope: 'global', reviewedAt: '2026-10-01', reviewBy: null };
  const entry = withProvenance(legacyEntry);
  assert.equal(entry.sourceKind, 'factual');
  assert.equal(entry.verifiedAt, '2026-10-01');
  assert.equal(withProvenance({ ...legacyEntry, verifiedAt: null }).verifiedAt, null, 'an explicit null still needs re-approval');
  assert.equal(withProvenance({ ...legacyEntry, evidence: [{ sourceId: 'candidate-answer', quote: 'Typed by the candidate.' }] }).sourceKind, 'assertion');
  assert.equal(withProvenance({ ...legacyEntry, sourceKind: 'assertion' }).sourceKind, 'assertion', 'a stored kind wins');

  const sources = [{ id: 'cv', text: CV }, { id: 'profile', text: candidate.resume }];
  assert.equal(reuseProblem(entry, { sources }), null, 'the old answer is still reusable');

  const workspace = new Workspace('test', { storage: new MemoryStorage({ 'data/answer-bank.yml': `version: 1\nanswers:\n  - id: ${legacyEntry.id}\n    question: ${legacyEntry.question}\n    answer: ${legacyEntry.answer}\n    evidence:\n      - sourceId: cv\n        quote: Designed and tested a lightweight chassis\n    scope: global\n    reviewedAt: '2026-10-01'\n    reviewBy: null\n` }) });
  const loaded = await new AnswerBank(workspace).load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].sourceKind, 'factual');
  assert.equal(reuseProblem(loaded[0], { sources }), null);
});

// ── the updater and the release gate ────────────────────────────

test('the updater reports the installed and workspace versions without changing anything', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plainhand-u15-status-'));
  try {
    const status = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'lib', 'plainhand-update.mjs'), 'status', '--json', '--data-root', root], { encoding: 'utf8' }));
    assert.equal(status.workspace, root);
    assert.equal(status.state.version, null);
    assert.equal(status.state.current, STATE_VERSION);
    assert.deepEqual(status.state.pending, []);

    const workspace = new Workspace(root);
    await workspace.write('data/plainhand/workspace.json', JSON.stringify(legacyState(), null, 2) + '\n');
    const pending = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'lib', 'plainhand-update.mjs'), 'status', '--json', '--data-root', root], { encoding: 'utf8' }));
    assert.equal(pending.state.version, 1);
    assert.deepEqual(pending.state.pending, ['1 → 2 settings, conversation ids and approvals']);

    const migrated = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'lib', 'plainhand-update.mjs'), 'migrate', '--json', '--data-root', root], { encoding: 'utf8' }));
    assert.equal(migrated.status, 'migrated');
    assert.equal(JSON.parse(await workspace.read('data/plainhand/workspace.json')).version, STATE_VERSION);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function gitRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plainhand-u15-release-'));
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: root });
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'release'], { cwd: root });
  return root;
}

test('the release gate refuses a dirty tree, a version/tag mismatch and missing release notes', async () => {
  const clean = await gitRepo({ VERSION: '1.2.0\n', 'docs/releases/v1.2.0.md': '# Plainhand 1.2.0\n\n## Upgrading\n\nRun `plainhand update`.\n' });
  const dirty = await gitRepo({ VERSION: '1.2.0\n', 'docs/releases/v1.2.0.md': '## Upgrading\n' });
  try {
    assert.equal(preflight({ root: clean, tag: 'v1.2.0', version: '1.2.0' }).ok, true);
    const mismatch = preflight({ root: clean, tag: 'v1.2.1', version: '1.2.0' });
    assert.equal(mismatch.ok, false);
    assert.ok(mismatch.problems.some(problem => /VERSION is 1\.2\.0 but the tag is v1\.2\.1/.test(problem)));
    assert.ok(mismatch.problems.some(problem => /Release notes are missing/.test(problem)));

    await writeFile(path.join(dirty, 'scratch.txt'), 'uncommitted\n');
    const refused = preflight({ root: dirty, tag: 'v1.2.0', version: '1.2.0' });
    assert.equal(refused.ok, false);
    assert.ok(refused.problems.some(problem => /uncommitted changes/.test(problem)));
  } finally {
    await rm(clean, { recursive: true, force: true });
    await rm(dirty, { recursive: true, force: true });
  }
});

test('the release gate runs the documented gates in order', async () => {
  const gateKeys = (await import('../scripts/release-check.mjs')).GATES.map(gate => gate.key);
  assert.deepEqual(gateKeys, ['unit', 'ui', 'evaluation', 'simulation']);
});

// E2E swarm #13: the newest tag can be behind a development checkout, and a release that
// predates the updater cannot finish an update. Neither may move the code.
test('update never downgrades a newer checkout or switches to a release without the updater', async () => {
  const updater = await import('node:fs/promises').then(fs => fs.readFile(path.join(ROOT, 'lib', 'plainhand-update.mjs'), 'utf8'));
  const root = await gitRepo({ VERSION: '1.0.0\n', 'README.md': 'old release\n' });
  try {
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: root });
    await mkdir(path.join(root, 'lib'), { recursive: true });
    await writeFile(path.join(root, 'lib', 'plainhand-update.mjs'), updater);
    await writeFile(path.join(root, 'VERSION'), '1.0.0\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'dev'], { cwd: root });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const run = args => execFileSync(process.execPath, [path.join(root, 'lib', 'plainhand-update.mjs'), 'apply', '--offline', '--no-install', '--remote', root, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const result = JSON.parse(run(['--json']).trim().split('\n').pop());
    assert.equal(result.status, 'current');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), head, 'the code did not move');

    assert.throws(() => run(['--version', 'v1.0.0']), error => /predates the Plainhand updater/.test(String(error.stderr)));
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), head, 'the code did not move');
  } finally { await rm(root, { recursive: true, force: true }); }
});
