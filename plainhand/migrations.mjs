// Versioned, automatic and reversible migrations for the candidate's workspace state
// (data/plainhand/workspace.json). A candidate moves to a new Plainhand version by
// starting it; nothing is copied and nothing is re-entered.
//
// Rules this file follows:
// - One ordered step per state version, `{ from, to, name, up, down }`. The chain must be
//   contiguous; `planMigrations` throws instead of guessing.
// - Every `up` is idempotent and only adds what is missing. A step never rewrites what the
//   candidate wrote: profile, stories, jobs, packets, tracker rows, settings and contacts
//   are carried as they are. Only state that encodes a schema decision (an approval hash
//   computed by the old formula, a new list default) is touched.
// - The exact bytes of the state file are copied to a dated backup directory before the
//   migrated file is written, so `rollbackWorkspace` restores the pre-update state.
// - The write is atomic (the storage layer writes a temp file and renames it).
// - Candidate content files (config/profile.yml, cv.md, data/applications.md,
//   data/answer-bank.yml, writing samples, interview-prep) are never rewritten here. The
//   answer bank gets its new provenance fields on read instead: see plainhand/answer-bank.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, storyKey } from './store.mjs';
import { DEFAULT_AUTONOMY, DEFAULT_ROLE_ORDER, ROLE_ORDERS, standardIdentity } from './standard.mjs';

export const STATE_FILE = 'data/plainhand/workspace.json';
// Bumped by every release that changes the state shape. A workspace at an older version is
// migrated on start; a workspace at a newer version is refused, never silently rewritten.
export const STATE_VERSION = 2;
// The first release that wrote each state version. A release that changes the state shape
// adds its entry here together with the migration; `plainhand rollback` reads this table to
// know which state the release it returns to understands. docs/internal/RELEASE.md.
export const STATE_VERSION_BY_RELEASE = [
  { release: '1.0.0', state: 1 },
  { release: '1.2.0', state: 2 },
];
export const MIGRATION_BACKUP_ROOT = 'data/plainhand/backups';
export const MIGRATION_JOURNAL = 'data/plainhand/migrations.json';
const JOURNAL_LIMIT = 20;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export class MigrationError extends Error {
  constructor(message) { super(message); this.name = 'MigrationError'; }
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// File-name safe on Windows too: no ":" or "." from the ISO timestamp.
export const migrationStamp = (at = new Date()) => at.toISOString().replace(/[:.]/g, '-');

// The Plainhand version that wrote this code, from VERSION ("1.1.2 # x-release-please-version").
export function appVersion() {
  try { return readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim().split(/\s+/)[0] || null; }
  catch { return null; }
}

// The workspace state version a given release understands: the newest table entry at or
// below it. Null means the release predates the table, so nothing is guessed.
export function stateVersionForRelease(version) {
  const parse = value => String(value || '').replace(/^v/, '').split(/[.+-]/).map(number => Number(number) || 0);
  const compare = (left, right) => {
    const a = parse(left), b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    return 0;
  };
  let best = null;
  for (const entry of STATE_VERSION_BY_RELEASE) if (compare(entry.release, version) <= 0 && (!best || compare(entry.release, best.release) > 0)) best = entry;
  return best ? best.state : null;
}

export function stateVersionOf(state) {
  return Number.isInteger(state?.version) ? state.version : 1;
}

// The identity used before per-entry headings were part of the master resume: the same
// draft hashes differently now, so an approval made then no longer matches.
export const legacyStandardIdentity = draft => digest([
  draft.headline,
  (Array.isArray(draft.resume) ? draft.resume : []).map(entry => [entry.section, entry.text]),
  draft.coverLetter,
]);

// ── the steps ───────────────────────────────────────────────────

export const MIGRATIONS = [
  {
    from: 1, to: 2, name: 'settings, conversation ids and approvals',
    // Workspaces written by 1.1.2 and earlier. Everything the candidate entered stays
    // byte-for-byte; this adds the keys the current code reads and repairs two approval
    // hashes that a changed formula would otherwise silently discard.
    up(state, ctx) {
      if (!Array.isArray(state.jobs)) state.jobs = [];
      if (!Array.isArray(state.conversation)) state.conversation = [];
      if (!Array.isArray(state.events)) state.events = [];
      if (!isObject(state.profile)) state.profile = {};

      // Settings the current UI offers. An existing value always wins.
      const settings = isObject(state.settings) ? state.settings : {};
      state.settings = {
        ...settings,
        autonomy: { ...DEFAULT_AUTONOMY, ...(isObject(settings.autonomy) ? settings.autonomy : {}) },
        roleOrder: ROLE_ORDERS.includes(settings.roleOrder) ? settings.roleOrder : DEFAULT_ROLE_ORDER,
      };

      // Every saved story gets the id the edit and delete routes address. The id is the key
      // the old message already resolved to, so nothing that points at a story changes.
      for (const message of state.conversation) {
        if (!isObject(message) || (typeof message.id === 'string' && message.id)) continue;
        message.id = storyKey({ role: message.role, at: message.at, text: message.text });
      }

      state.claimLine = isObject(state.claimLine) ? state.claimLine : { decisions: [], statements: [] };
      state.conflictReview = isObject(state.conflictReview) ? state.conflictReview : { decisions: [], questionChecks: [] };
      if (!Array.isArray(state.inbox)) state.inbox = [];

      // The master resume keeps its approval: only the hash formula changed, not the words
      // the candidate approved. A draft whose content really changed keeps no approval.
      const standard = isObject(state.standard) ? state.standard : null;
      let rehashed = false;
      if (standard?.kind === 'master' && isObject(standard.draft) && Array.isArray(standard.draft.resume) && standard.approvedHash) {
        const current = standardIdentity(standard.draft), legacy = legacyStandardIdentity(standard.draft);
        if (standard.approvedHash !== current && standard.approvedHash === legacy) {
          standard.approvalRehashed = { at: ctx.at, from: standard.approvedHash, reason: 'heading-identity' };
          standard.approvedHash = current;
          rehashed = true;
        }
      }

      // 1.1.2 sent the candidate's email and phone to the provider; this version never does,
      // so every packet approval was given under a different context. The approval is kept
      // as evidence of what was approved, the job is marked for a fresh one, and the
      // candidate is told why. Nothing is dropped silently.
      let reset = 0;
      if (ctx.contextHash) for (const job of state.jobs) {
        if (!isObject(job) || !job.approvedHash || job.submittedAt || job.stage !== 'approved') continue;
        if (!job.contextHash || job.contextHash === ctx.contextHash) continue;
        job.approvalReset = { at: ctx.at, from: job.stage, approvedContextHash: job.contextHash, reason: 'profile-privacy' };
        job.stage = 'needs-refresh';
        reset += 1;
      }

      // The master resume's approval covers its wording; this version only stopped sending
      // the candidate's email and phone to the provider. Re-checking the basis keeps an
      // approved master usable instead of asking for a paid rewrite after an update. Any
      // later profile change still makes it stale, as before.
      let rechecked = false;
      if (standard?.kind === 'master' && isObject(standard.draft) && standard.approvedHash && standard.contextHash && ctx.contextHash && standard.contextHash !== ctx.contextHash) {
        standard.contextRechecked = { at: ctx.at, from: standard.contextHash, reason: 'profile-privacy' };
        standard.contextHash = ctx.contextHash;
        rechecked = true;
      }

      if (rehashed) state.events.unshift({ at: ctx.at, text: 'Plainhand updated. Your approved master resume is still approved; its approval was re-checked against the new format.' });
      if (rechecked) state.events.unshift({ at: ctx.at, text: 'Plainhand updated. Your master resume is still approved: it was written from the same sources, and this version shares less of your profile with the AI.' });
      if (reset) state.events.unshift({ at: ctx.at, text: `Plainhand updated. ${reset === 1 ? 'One application packet needs' : `${reset} application packets need`} your approval again: this version no longer sends your email and phone to the AI, so the review you gave was for a different shared context. Your records are unchanged.` });
      return state;
    },
    // The reverse of the two repairs. Keys added above are left in place: the previous code
    // ignores them, and deleting them would lose data written after the update.
    down(state) {
      for (const job of Array.isArray(state.jobs) ? state.jobs : []) {
        if (!isObject(job) || !isObject(job.approvalReset)) continue;
        if (job.stage === 'needs-refresh') job.stage = job.approvalReset.from;
        delete job.approvalReset;
      }
      const standard = isObject(state.standard) ? state.standard : null;
      if (standard && isObject(standard.approvalRehashed)) {
        standard.approvedHash = standard.approvalRehashed.from;
        delete standard.approvalRehashed;
      }
      if (standard && isObject(standard.contextRechecked)) {
        standard.contextHash = standard.contextRechecked.from;
        delete standard.contextRechecked;
      }
      return state;
    },
  },
];

const describe = step => ({ from: step.from, to: step.to, name: step.name });

// Contiguous chain from `from` up to `to`, or a clear refusal.
export function planMigrations(from, to = STATE_VERSION) {
  const steps = [];
  let version = from;
  while (version < to) {
    const step = MIGRATIONS.find(item => item.from === version);
    if (!step) throw new MigrationError(`No migration from workspace state version ${version} to ${to}.`);
    steps.push(step);
    version = step.to;
  }
  return steps;
}

// Pure: copies the state, runs every step, returns the migrated copy and what ran.
export function migrateState(state, { at = new Date().toISOString(), appVersion: version = null, contextHash = null } = {}) {
  const from = stateVersionOf(state);
  const steps = planMigrations(from);
  const migrated = structuredClone(state);
  for (const step of steps) {
    step.up(migrated, { at, appVersion: version, contextHash });
    migrated.version = step.to;
  }
  return { state: migrated, from, to: migrated.version, steps: steps.map(describe) };
}

// Pure: the reverse path, used by tests and by rollback when the code is still loaded.
export function reverseState(state, { to }) {
  const current = stateVersionOf(state);
  const reversed = structuredClone(state);
  let version = current;
  while (version > to) {
    const step = MIGRATIONS.find(item => item.to === version);
    if (!step) throw new MigrationError(`No migration from workspace state version ${version} down to ${to}.`);
    step.down?.(reversed);
    version = step.from;
    reversed.version = version;
  }
  return reversed;
}

// ── the workspace side ──────────────────────────────────────────

// Workspace.read turns a missing file into "", so presence is read from the store itself:
// a corrupt file must be refused and an absent one means a new workspace.
async function readRaw(workspace, relative) {
  const data = await workspace.storage.read(relative);
  return data === null ? null : data.toString('utf8');
}

export async function readJournal(workspace) {
  try {
    const document = JSON.parse(await readRaw(workspace, MIGRATION_JOURNAL) || '{"migrations":[]}');
    return Array.isArray(document?.migrations) ? document.migrations : [];
  } catch { return []; }
}

async function recordMigration(workspace, record) {
  const migrations = [record, ...(await readJournal(workspace)).filter(item => item?.backup !== record.backup)].slice(0, JOURNAL_LIMIT);
  await workspace.write(MIGRATION_JOURNAL, JSON.stringify({ version: 1, migrations }, null, 2) + '\n');
  return migrations;
}

async function backupBeforeMigration(workspace, raw, { from, to, steps, at, appVersion: version }) {
  const directory = `${MIGRATION_BACKUP_ROOT}/migrate-${from}-to-${to}-${migrationStamp(new Date(at))}`;
  await workspace.write(`${directory}/workspace.json`, raw);
  const manifest = {
    kind: 'migration', from, to, at, appVersion: version,
    files: [{ path: STATE_FILE, bytes: Buffer.byteLength(raw, 'utf8'), sha256: digest(raw) }],
    steps: steps.map(describe),
  };
  await workspace.write(`${directory}/MANIFEST.json`, JSON.stringify(manifest, null, 2) + '\n');
  return directory;
}

// Called on start. Returns { status }: 'empty' (no workspace yet), 'current', or 'migrated'.
// Throws MigrationError, and writes nothing, when the state is unreadable, newer than this
// code, or has no migration path.
export async function migrateWorkspace(workspace, { at = new Date().toISOString(), appVersion: version = appVersion(), contextHash = null } = {}) {
  const raw = await readRaw(workspace, STATE_FILE);
  if (raw === null) return { status: 'empty', version: null, from: null, to: STATE_VERSION, steps: [], backup: null };
  let state;
  try { state = JSON.parse(raw); }
  catch { throw new MigrationError('Your workspace state file is not readable JSON. Plainhand will not touch it; restore data/plainhand/workspace.json from a backup in data/plainhand/backups.'); }
  const from = stateVersionOf(state);
  if (from === STATE_VERSION) return { status: 'current', version: from, from, to: from, steps: [], backup: null };
  if (from > STATE_VERSION) throw new MigrationError(`This workspace was written by Plainhand state version ${from}, but this copy understands ${STATE_VERSION}. Update Plainhand instead of starting an older copy against it.`);
  const steps = planMigrations(from);
  // The context hash the current code will compute for the same content, so an approval
  // given under the old privacy rules can be told apart from a current one. A state old
  // enough to lack a key the context builder reads still migrates; only the hash is skipped.
  let hash = contextHash;
  if (hash === null) {
    try {
      hash = (await workspace.context({
        ...structuredClone(state),
        profile: isObject(state.profile) ? state.profile : {},
        conversation: Array.isArray(state.conversation) ? state.conversation : [],
      })).hash;
    } catch { hash = null; }
  }
  const { state: migrated } = migrateState(state, { at, appVersion: version, contextHash: hash });
  const backup = await backupBeforeMigration(workspace, raw, { from, to: STATE_VERSION, steps, at, appVersion: version });
  const contents = JSON.stringify(migrated, null, 2) + '\n';
  await workspace.write(STATE_FILE, contents);
  await recordMigration(workspace, { at, from, to: STATE_VERSION, steps: steps.map(describe), appVersion: version, backup, stateHash: digest(contents) });
  return { status: 'migrated', version: STATE_VERSION, from, to: STATE_VERSION, steps: steps.map(describe), backup };
}

// What a `--check` or `status` reports, without changing anything.
export async function migrationStatus(workspace) {
  const journal = await readJournal(workspace);
  const raw = await readRaw(workspace, STATE_FILE);
  if (raw === null) return { version: null, current: STATE_VERSION, pending: [], journal, corrupt: false };
  let state;
  try { state = JSON.parse(raw); }
  catch { return { version: null, current: STATE_VERSION, pending: [], journal, corrupt: true }; }
  const version = stateVersionOf(state);
  let pending = [];
  if (version < STATE_VERSION) { try { pending = planMigrations(version).map(describe); } catch { pending = []; } }
  return { version, current: STATE_VERSION, pending, journal, corrupt: false };
}

// Restore the exact pre-migration state. Defaults to the earliest version the recorded
// migrations came from (one step back for a single release), so a rollback after an update
// returns the workspace the previous code wrote.
export async function rollbackWorkspace(workspace, { to = null } = {}) {
  const raw = await readRaw(workspace, STATE_FILE);
  if (raw === null) throw new MigrationError('There is no saved workspace to roll back.');
  let state;
  try { state = JSON.parse(raw); }
  catch { throw new MigrationError('Your workspace state file is not readable JSON; nothing was restored.'); }
  let version = stateVersionOf(state);
  const journal = await readJournal(workspace);
  const target = to ?? (journal.find(record => record?.to === version)?.from ?? null);
  if (!Number.isInteger(target)) throw new MigrationError(`No recorded migration leads back from state version ${version}. Pass the state version to restore with --to.`);
  if (target > version) throw new MigrationError(`State version ${target} is newer than this workspace (${version}); there is nothing to roll back to.`);
  const restored = [];
  while (version > target) {
    const record = journal.find(item => item?.to === version);
    if (!record) throw new MigrationError(`No backup was recorded for the migration to state version ${version}; nothing was restored.`);
    const backup = await readRaw(workspace, `${record.backup}/workspace.json`);
    if (backup === null) throw new MigrationError(`The backup ${record.backup} is missing; nothing was restored.`);
    const manifest = JSON.parse(await workspace.read(`${record.backup}/MANIFEST.json`, '{}'));
    const expected = Array.isArray(manifest?.files) ? manifest.files.find(file => file?.path === STATE_FILE)?.sha256 : null;
    if (expected && digest(backup) !== expected) throw new MigrationError(`The backup in ${record.backup} does not match its manifest; nothing was restored.`);
    await workspace.write(STATE_FILE, backup);
    version = record.from;
    restored.push({ backup: record.backup, stateVersion: version });
  }
  return { restoredTo: version, backups: restored };
}
