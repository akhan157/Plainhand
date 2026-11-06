// Website only: caller must authenticate its cookie session and validate CSRF first.
// Never mount this on MCP/extension bearer routes. Bodies are already parsed JSON.
import { randomUUID, createHash } from 'node:crypto';
import { Workspace, emptyProfile } from '../store.mjs';
import { importWorkspace, preview, ImportError } from '../workspace-import.mjs';
import { CONNECTION_CHECK_PATH } from './connection-check.mjs';

export const MAX_TRANSFER_BYTES = 3 * 1024 * 1024;
const RECEIPTS = 'data/plainhand/import-previews';
const TTL = 15 * 60 * 1000;
const object = x => x && typeof x === 'object' && !Array.isArray(x);
class TransferError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new TransferError(status, code, message); };
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');

function prepare(data) {
  preview(data); // Existing version, required profile, job identity and duplicate rules.
  if (!object(data.profile)) throw new ImportError('The export profile must be an object.');
  if (!data.profile.name?.trim?.() || !data.profile.resume?.trim?.()) throw new ImportError('The export needs a name and resume.');
  if (data.profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.profile.email)) throw new ImportError('Enter a valid profile email address.');
  for (const [key, value] of Object.entries(data.profile)) {
    if (key in emptyProfile() && typeof value !== 'string') throw new ImportError(`The profile's ${key} must be text.`);
  }
  for (const key of ['tasks', 'sources', 'conversation', 'events', 'agentConversation', 'agentUsage', 'agentProposals']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(x => !object(x)))) throw new ImportError(`The export's ${key} must be a list of objects.`);
  }
  if (data.exportedAt !== undefined && typeof data.exportedAt !== 'string') throw new ImportError('The export date must be text.');
  if (data.contextPrefs !== undefined && !object(data.contextPrefs)) throw new ImportError('Invalid sharing choices.');
  for (const key of ['excludedFields', 'excludedSources']) if (data.contextPrefs?.[key] !== undefined && (!Array.isArray(data.contextPrefs[key]) || data.contextPrefs[key].some(x => typeof x !== 'string'))) throw new ImportError('Invalid sharing choices.');
  // Ignore unknown top-level fields: no account/user/file/token input selects storage.
  // Drop credentials and executable proposals even if a hand-edited export adds them.
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:__proto__|prototype|constructor|.*token|.*secret|.*password|credentials|cookies|localStorage|browserCheckpoint|approvedHash|connectionChecks)$/i.test(key)).map(([k, v]) => [k, strip(v)]));
  };
  const result = { version: 1, profile: Object.fromEntries(Object.keys(emptyProfile()).map(k => [k, data.profile[k] || ''])), provider: null, connectionChecks: {}, agentProposals: [] };
  for (const key of ['jobs', 'sources', 'tasks', 'conversation', 'events', 'contextPrefs', 'agentConversation', 'agentUsage', 'exportedAt']) if (data[key] !== undefined) result[key] = strip(data[key]);
  for (const [i, job] of (result.jobs || []).entries()) if (data.jobs[i].approvedHash) job.approvedHash = 'reset-on-import';
  // Existing importer interrupts queued/running tasks; imported deferred tasks cannot resume.
  for (const task of result.tasks || []) if (!['complete', 'failed', 'canceled', 'interrupted'].includes(task.status)) task.status = 'running';
  return result;
}

async function assertIdle(workspace, state) {
  if (state.tasks.some(t => ['queued', 'running', 'pending', 'waiting'].includes(t.status))) fail(409, 'workspace_busy', 'Wait for running tasks to finish or cancel them before importing.');
  for (const file of await workspace.list('data/plainhand/steps')) {
    let record;
    try { record = JSON.parse(await workspace.read(`data/plainhand/steps/${file}`)); }
    catch { fail(409, 'workspace_busy', 'A connector task needs attention before importing.'); }
    if (record.pending || record.claim || !['done', 'failed', 'interrupted', 'canceled'].includes(record.status)) fail(409, 'workspace_busy', 'Finish or cancel pending connector steps before importing.');
  }
}

// Returns {status, body}, or null for another route. now is () => epoch milliseconds.
// actor must be 'ui'; userId and workspace must come ONLY from the verified session.
export async function handleWorkspaceTransfer(req, { workspace, userId, actor, body, now = Date.now }) {
  const route = new URL(req.url, 'https://plainhand.invalid').pathname;
  if (!['/api/workspace/import/preview', '/api/workspace/import'].includes(route)) return null;
  try {
    if (!userId || actor !== 'ui') fail(403, 'candidate_only', 'Sign in on the Plainhand website to import your workspace.');
    if (workspace.storage.userId && workspace.storage.userId !== String(userId).toLowerCase()) fail(403, 'account_mismatch', 'Workspace does not match this session.');
    if (req.method !== 'POST') fail(405, 'method_not_allowed', 'Use POST for workspace imports.');
    if (Buffer.byteLength(JSON.stringify(body ?? null)) > MAX_TRANSFER_BYTES) fail(413, 'import_too_large', 'Choose an export smaller than 3 MiB.');
    if (!object(body)) throw new ImportError('Choose a Plainhand JSON export.');
    const data = prepare(body.data), digest = hash(body.data);
    if (typeof workspace.storage.exclusive !== 'function') throw new Error('Hosted transfer requires transactional storage.exclusive.');
    return await workspace.storage.exclusive(async () => {
      // Do not use the caller's Workspace.chain while holding the storage lock: an
      // earlier queued mutation may itself be waiting for this same lock.
      const locked = new Workspace(workspace.root, { storage: workspace.storage });
      const state = await locked.load();
      await assertIdle(locked, state);
      if (await locked.read('data/resume-source.yml')) fail(409, 'structured_resume_conflict', 'This workspace has a structured resume. Export it and resolve its resume source before replacing it.');
      if (route.endsWith('/preview')) {
        const previewId = randomUUID();
        const receipt = { userId, digest, revision: state.revision, expiresAt: Number(now()) + TTL };
        // At most one outstanding preview per workspace; no unbounded receipt growth.
        for (const file of await locked.list(RECEIPTS)) await locked.remove(`${RECEIPTS}/${file}`);
        await locked.write(`${RECEIPTS}/${previewId}.json`, JSON.stringify(receipt));
        return { status: 200, body: { ...preview(body.data), previewId, ...receipt, userId: undefined, warning: 'Replaces this workspace. Existing files are backed up. Approvals, proposals, checkpoints and AI connection checks reset. Credentials and browser sessions do not transfer.' } };
      }
      if (body.confirm !== true) fail(400, 'confirmation_required', 'Confirm replacement after reviewing the preview.');
      if (typeof body.previewId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.previewId)) fail(409, 'preview_required', 'Preview this export before replacing your workspace.');
      const file = `${RECEIPTS}/${body.previewId}.json`, raw = await locked.read(file);
      const receipt = raw ? JSON.parse(raw) : null;
      if (!receipt || receipt.userId !== userId || receipt.digest !== digest || body.digest !== digest || receipt.revision !== body.revision || receipt.expiresAt <= Number(now())) fail(409, 'preview_mismatch', 'The preview expired or the export changed. Preview it again.');
      if (state.revision !== receipt.revision) fail(409, 'stale_workspace', 'Your workspace changed. Preview the replacement again.');
      const result = await importWorkspace({ workspace: locked, data });
      await locked.remove(CONNECTION_CHECK_PATH);
      for (const name of await locked.list('data/plainhand/checkpoints')) await locked.remove(`data/plainhand/checkpoints/${name}`);
      for (const name of await locked.list('data/plainhand/steps')) await locked.remove(`data/plainhand/steps/${name}`);
      await locked.remove(file);
      return { status: 200, body: { ...result, imported: true, revision: (await locked.load()).revision } };
    });
  } catch (error) {
    if (error instanceof TransferError) return { status: error.status, body: { code: error.code, error: error.message } };
    if (error instanceof ImportError) return { status: 400, body: { code: error.code, error: error.message } };
    if (error.constructor.name === 'QuotaError') return { status: 413, body: { code: 'storage_full', error: error.message } };
    throw error; // Parent's error boundary handles unexpected storage failures.
  }
}
