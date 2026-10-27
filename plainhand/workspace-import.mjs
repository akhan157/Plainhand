import { randomUUID } from 'node:crypto';
import { now, syncTracker } from './store.mjs';

// Restores a workspace exported from /api/export into this workspace, after backing
// up what is here. Machine-specific state does not travel: packet approvals (their PDFs
// are not in the export), browser checkpoints and in-flight tasks are reset.

const STATE_KEYS = ['profile', 'provider', 'jobs', 'sources', 'tasks', 'conversation', 'understanding', 'events', 'contextPrefs', 'connectionChecks'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HISTORY_FILE = 'data/plainhand/conversation.jsonl', PROPOSALS_FILE = 'data/plainhand/agent-proposals.json';

export class ImportError extends Error { constructor(message) { super(message); this.name = 'ImportError'; this.code = 'invalid_import'; } }

export function validateExport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImportError('Choose a Plainhand workspace export (a .json file from Workspace → Export).');
  if (data.version !== 1) throw new ImportError('This export is from an unknown Plainhand version.');
  if (!data.profile || typeof data.profile !== 'object') throw new ImportError('The export has no profile.');
  for (const key of ['jobs', 'sources', 'tasks', 'conversation', 'events']) if (data[key] !== undefined && !Array.isArray(data[key])) throw new ImportError(`The export's ${key} are not a list.`);
  for (const job of data.jobs || []) if (!job || typeof job.id !== 'string' || typeof job.company !== 'string' || typeof job.title !== 'string') throw new ImportError('The export contains a job without an id, company or title.');
  const ids = (data.jobs || []).map(job => job.id);
  if (new Set(ids).size !== ids.length) throw new ImportError('The export contains duplicate jobs.');
  return true;
}

export function preview(data) {
  validateExport(data);
  return { name: data.profile.name || '', exportedAt: data.exportedAt || null, jobs: (data.jobs || []).length, applied: (data.jobs || []).filter(j => j.submittedAt).length,
    conversation: (data.agentConversation || []).length, sources: (data.sources || []).length, approvalsReset: (data.jobs || []).filter(j => j.approvedHash).length };
}

export async function importWorkspace({ workspace, data, busy = false }) {
  validateExport(data);
  if (busy) throw new ImportError('Wait for the running reply or tasks to finish, then import.');
  const stamp = `${now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  // Back up everything the import replaces, before anything changes.
  for (const [file, name] of [[workspace.file, 'workspace.json'], [HISTORY_FILE, 'conversation.jsonl'], [PROPOSALS_FILE, 'agent-proposals.json'], ['config/profile.yml', 'profile.yml'], ['cv.md', 'cv.md']]) {
    const text = await workspace.read(file);
    if (text) await workspace.write(`data/plainhand/backups/${stamp}-import-${name}`, text);
  }
  let summary;
  await workspace.mutate(async state => {
    if (state.tasks.some(t => ['queued', 'running'].includes(t.status))) throw new ImportError('Wait for the running tasks to finish, then import.');
    const incoming = structuredClone(data);
    for (const key of Object.keys(state)) if (!['version', 'revision'].includes(key)) delete state[key];
    for (const key of STATE_KEYS) if (incoming[key] !== undefined) state[key] = incoming[key];
    state.profile ||= {}; state.jobs ||= []; state.sources ||= []; state.tasks ||= []; state.conversation ||= []; state.events ||= [];
    let approvalsReset = 0;
    for (const job of state.jobs) {
      if (job.approvedHash) approvalsReset++;
      job.approvedHash = null; delete job.browserCheckpoint; delete job.stale;
      if (job.packet && !job.submittedAt) job.stage = 'needs-refresh';
    }
    for (const task of state.tasks) if (['queued', 'running'].includes(task.status)) Object.assign(task, { status: 'interrupted', message: 'Imported from another workspace. Retry to continue.', finishedAt: now() });
    state.events.unshift({ at: now(), text: `Workspace imported${incoming.exportedAt ? ` from an export of ${incoming.exportedAt.slice(0, 10)}` : ''}. Packet approvals were reset; review packets again before using them.` });
    summary = { jobs: state.jobs.length, approvalsReset, backup: `data/plainhand/backups/${stamp}-import-*` };
    await syncTracker(workspace, state);
  });
  // Profile files: written the same way an explicit save writes them.
  const state = await workspace.load();
  if (data.profile.name && data.profile.resume) await workspace.saveProfile({ ...state.profile, ...data.profile }, state.revision);
  const messages = Array.isArray(data.agentConversation) ? data.agentConversation.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').slice(-500) : [];
  await workspace.write(HISTORY_FILE, messages.map(m => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : ''));
  const proposals = Array.isArray(data.agentProposals) ? data.agentProposals.filter(p => p && typeof p.id === 'string').slice(0, 100) : [];
  await workspace.write(PROPOSALS_FILE, JSON.stringify(proposals, null, 2));
  let receipts = 0;
  for (const record of Array.isArray(data.agentUsage) ? data.agentUsage : []) {
    if (!record || !UUID.test(String(record.id))) continue;
    const file = `data/plainhand/usage/${record.id}.json`;
    if (await workspace.read(file)) continue;
    await workspace.write(file, JSON.stringify(record.status === 'running' ? { ...record, status: 'interrupted' } : record));
    receipts++;
  }
  return { ...summary, conversation: messages.length, proposals: proposals.length, usageReceipts: receipts };
}
