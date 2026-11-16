import { STATE_VERSION } from './migrations.mjs';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { cleanText, emptyProfile, factualSource, now, syncTracker } from './store.mjs';
import { AnswerBank, ANSWER_BANK_FILE, answerSourceKind } from './answer-bank.mjs';
import { Corrections, CORRECTIONS_FILE } from './corrections.mjs';
import { cleanFormat } from './resume-format.mjs';
import { DEFAULT_AUTONOMY, DEFAULT_ROLE_ORDER, ROLE_ORDERS } from './standard.mjs';
import { isSensitiveLabel } from './field-policy.mjs';

// Restores a workspace exported from /api/export into this workspace, after backing
// up what is here. Transfer carries memory, never authority: packet approvals, the
// approved master resume, the approved understanding, autonomy, browser checkpoints
// and connection checks are reset by an import. The four bounded user-layer sources
// travel with their quotes so a claim keeps its evidence; a reusable answer whose
// quote did not travel is held for the candidate's review instead of filling a field.

export const SOURCE_FILES = Object.freeze(['modes/_profile.md', 'article-digest.md', 'interview-prep/story-bank.md', 'data/resume-source.yml']);
// The canonical tracker travels with an export so rows that exist only in
// applications.md are not lost when memory moves to another computer. It is not
// a context source: it never feeds the model as candidate evidence.
export const TRACKER_FILE = 'data/applications.md';
const EXPORT_FILES = [...SOURCE_FILES, TRACKER_FILE];
export const STRUCTURED_RESUME_FILE = 'data/resume-source.yml';
export const IMPORT_MARKER = 'data/plainhand/backups/import-marker.json';
// One source file larger than this is left out of the export and reported, never
// truncated silently; the import then counts the claims whose quote did not travel.
export const MAX_SOURCE_BYTES = 1024 * 1024;
const STATE_KEYS = ['profile', 'provider', 'jobs', 'sources', 'tasks', 'conversation', 'events', 'contextPrefs', 'inbox', 'skillPlan', 'conflictReview'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HISTORY_FILE = 'data/plainhand/conversation.jsonl', PROPOSALS_FILE = 'data/plainhand/agent-proposals.json';
const MAX_SAMPLES = 10, MAX_SAMPLE_TEXT = 8000, MAX_SAMPLE_TITLE = 120;
const MAX_DECISIONS = 300, MAX_STATEMENTS = 30, MAX_ANSWERS = 200, MAX_CORRECTIONS = 200;
const MAX_QUESTION = 500, MAX_ANSWER = 5000, MAX_QUOTE = 2000, MAX_EVIDENCE = 12;

export class ImportError extends Error { constructor(message) { super(message); this.name = 'ImportError'; this.code = 'invalid_import'; } }

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const textWithin = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const bounded = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isoish = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const normalizeQuestion = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();
const jsonWithin = (value, max = 200000) => {
  if (!object(value)) return null;
  try { const text = JSON.stringify(value); return text.length <= max ? JSON.parse(text) : null; } catch { return null; }
};

export function validateExport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImportError('Choose a Plainhand workspace export (a .json file from Workspace → Export).');
  // An export carries the state version of the workspace that wrote it. Any version this
  // code can migrate from is accepted; the imported keys are cleaned below, and the target
  // keeps its own (current) version. A newer export is refused: update Plainhand first.
  if (!Number.isInteger(data.version) || data.version < 1) throw new ImportError('This export is from an unknown Plainhand version.');
  if (data.version > STATE_VERSION) throw new ImportError('This export was made by a newer Plainhand. Update Plainhand, then import it.');
  if (!data.profile || typeof data.profile !== 'object') throw new ImportError('The export has no profile.');
  for (const key of ['jobs', 'sources', 'tasks', 'conversation', 'events', 'answerBank', 'corrections', 'writingSamples', 'agentConversation', 'agentUsage', 'agentProposals']) if (data[key] !== undefined && !Array.isArray(data[key])) throw new ImportError(`The export's ${key} are not a list.`);
  for (const key of ['claimLine', 'standard', 'resumeFormat', 'settings', 'understanding', 'conflictReview', 'files']) if (data[key] !== undefined && data[key] !== null && !object(data[key])) throw new ImportError(`The export's ${key} is not an object.`);
  if (object(data.files)) for (const [file, value] of Object.entries(data.files)) {
    if (!EXPORT_FILES.includes(file)) continue; // Never write a path outside the allow-list.
    if (typeof value !== 'string') throw new ImportError(`The export's ${file} is not text.`);
    if (Buffer.byteLength(value) > MAX_SOURCE_BYTES) throw new ImportError(`The export's ${file} is too large to import. Export it from the app instead of editing it.`);
  }
  for (const job of data.jobs || []) if (!job || typeof job.id !== 'string' || typeof job.company !== 'string' || typeof job.title !== 'string') throw new ImportError('The export contains a job without an id, company or title.');
  const ids = (data.jobs || []).map(job => job.id);
  if (new Set(ids).size !== ids.length) throw new ImportError('The export contains duplicate jobs.');
  return true;
}

// ── Sanitizers: every imported value is rebuilt from a known shape, never copied. ──

export function cleanSamples(value) {
  if (!Array.isArray(value)) return [];
  const samples = [];
  for (const sample of value) {
    if (samples.length >= MAX_SAMPLES) break;
    if (!object(sample)) continue;
    const text = textWithin(sample.text, MAX_SAMPLE_TEXT);
    if (!text) continue;
    samples.push({ id: textWithin(sample.id, 100) || randomUUID(), title: bounded(sample.title, MAX_SAMPLE_TITLE), text, at: isoish(sample.at) || now() });
  }
  return samples;
}

export function cleanClaimLine(value) {
  if (!object(value)) return null;
  const decisions = (Array.isArray(value.decisions) ? value.decisions : []).slice(-MAX_DECISIONS).flatMap(decision => {
    const text = textWithin(decision?.text, 1000);
    if (!text || !['keep-mine', 'use-suggestion'].includes(decision?.decision)) return [];
    return [{
      at: isoish(decision.at) || now(), jobId: bounded(decision.jobId, 100) || null, claimId: bounded(decision.claimId, 100) || null,
      rating: bounded(decision.rating, 30) || null, kind: bounded(decision.kind, 30) || 'other', text,
      suggestion: bounded(decision.suggestion, 1000), decision: decision.decision,
      ...(isoish(decision.appliedAt) ? { appliedAt: isoish(decision.appliedAt) } : {}),
    }];
  });
  const statements = (Array.isArray(value.statements) ? value.statements : []).slice(-MAX_STATEMENTS).flatMap(statement => {
    const text = textWithin(statement?.text, 2000);
    return text ? [{ text, at: isoish(statement.at) || now() }] : [];
  });
  return { decisions, statements };
}

const HEADING_FIELDS = ['org', 'title', 'location', 'dates'];
function cleanHeading(value) {
  if (!object(value)) return null;
  const heading = Object.fromEntries(HEADING_FIELDS.map(field => [field, bounded(value[field], 200)]));
  return Object.values(heading).some(Boolean) ? heading : null;
}

// The draft is the candidate's own work, so it travels; its approval does not. An
// approval is bound to the exact context the candidate saw, and an import changes
// that context. Dependencies the UI reads (coverage, calibration) travel when they
// have the shape the view expects.
export function cleanStandard(value) {
  if (!object(value)) return null;
  const draft = object(value.draft) ? value.draft : null;
  if (!draft) return null;
  const headline = textWithin(draft.headline, 500), coverLetter = bounded(draft.coverLetter, 25000);
  const resume = (Array.isArray(draft.resume) ? draft.resume : []).slice(0, 150).flatMap(entry => {
    const text = textWithin(entry?.text, 10000), section = textWithin(entry?.section, 100);
    if (!text || !section) return [];
    const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []).slice(0, MAX_EVIDENCE).flatMap(item => typeof item?.sourceId === 'string' && typeof item?.quote === 'string' ? [{ sourceId: item.sourceId, quote: item.quote }] : []);
    return [{ section, heading: cleanHeading(entry.heading), text, ...(evidence.length ? { evidence } : {}) }];
  });
  // A restored draft stays readable even when an older export had no cover letter; it
  // still arrives unapproved, so nothing can be sent from it.
  if (!headline || !resume.length) return null;
  const calibration = object(value.calibration) && object(value.calibration.counts) ? jsonWithin(value.calibration) : null;
  return {
    ...(value.kind === 'master' ? { kind: 'master' } : {}),
    draft: { headline, resume, coverLetter, suggestions: (Array.isArray(draft.suggestions) ? draft.suggestions : []).filter(item => typeof item === 'string').map(item => item.slice(0, 500)).slice(0, 20) },
    ...(object(value.coverage) ? { coverage: jsonWithin(value.coverage) } : {}),
    ...(calibration ? { calibration } : {}),
    contextHash: bounded(value.contextHash, 100) || null,
    createdAt: isoish(value.createdAt) || now(),
    approvedHash: null,
    approvedAt: null,
  };
}

export function cleanResumeFormat(value) {
  if (!object(value)) return null;
  return { ...cleanFormat(value), savedAt: isoish(value.savedAt) || now() };
}

// Autonomy is the one setting that can act without the candidate in the loop, so an
// import keeps the limits and always arrives switched off.
export function cleanSettings(value) {
  if (!object(value)) return null;
  const autonomy = object(value.autonomy) ? value.autonomy : {};
  const perDay = Number.isFinite(+autonomy.perDay) && +autonomy.perDay >= 1 && +autonomy.perDay <= 10 ? Math.round(+autonomy.perDay) : DEFAULT_AUTONOMY.perDay;
  const minScore = Number.isFinite(+autonomy.minScore) && +autonomy.minScore >= 3.5 && +autonomy.minScore <= 5 ? +autonomy.minScore : DEFAULT_AUTONOMY.minScore;
  // foldHumanize is an opt-in; absent means the default two-call path, so an
  // untouched workspace keeps its previous settings shape on export/import.
  return { autonomy: { enabled: false, perDay, minScore }, roleOrder: ROLE_ORDERS.includes(value.roleOrder) ? value.roleOrder : DEFAULT_ROLE_ORDER, ...(value.foldHumanize === true ? { foldHumanize: true } : {}) };
}

// The understanding is the agent's own summary. Its text is kept so the candidate can
// review it, but it never arrives approved and can never ground a claim.
export function cleanUnderstanding(value) {
  if (!object(value) || !object(value.result)) return null;
  const result = value.result;
  const summary = textWithin(result.summary, 20000);
  if (!summary) return null;
  const strings = (list, max = 15000) => (Array.isArray(list) ? list.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, max)).slice(0, 30) : []);
  return {
    result: { summary, voice: bounded(result.voice, 2000), sampleAnswer: bounded(result.sampleAnswer, 15000), strengths: strings(result.strengths), questions: strings(result.questions), gaps: strings(result.gaps) },
    contextHash: bounded(value.contextHash, 100) || null,
    approved: false,
    createdAt: isoish(value.createdAt) || now(),
  };
}

// The conflict ledger holds decisions, not facts: a conflict id, the sources involved,
// quote digests and the source the candidate chose. A malformed or older entry is
// dropped; nothing here can introduce a fact or an approval.
export function cleanConflictReview(value) {
  if (!object(value)) return null;
  const decisions = (Array.isArray(value.decisions) ? value.decisions : []).slice(-200).flatMap(entry => {
    if (!object(entry)) return [];
    const id = textWithin(entry.id, 200);
    const sourceId = textWithin(entry?.disposition?.sourceId, 100);
    const sourceIds = (Array.isArray(entry.sourceIds) ? entry.sourceIds : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.slice(0, 100)).slice(0, 10);
    const quoteDigests = (Array.isArray(entry.quoteDigests) ? entry.quoteDigests : []).filter(item => typeof item === 'string' && /^[0-9a-f]{64}$/.test(item)).slice(0, 10);
    if (!id || !sourceId || !sourceIds.includes(sourceId) || !quoteDigests.length) return [];
    return [{ id, kind: bounded(entry.kind, 40) || 'other', sourceIds, quoteDigests, disposition: { sourceId }, at: isoish(entry.at) || now() }];
  });
  const questionChecks = (Array.isArray(value.questionChecks) ? value.questionChecks : []).slice(-200).flatMap(entry => {
    const digestValue = textWithin(entry?.digest, 100);
    if (!digestValue || !/^[0-9a-f]{64}$/.test(digestValue)) return [];
    return [{ digest: digestValue, by: bounded(entry.by, 40) || 'unknown', at: isoish(entry.at) || now(), jobId: bounded(entry.jobId, 100) || null }];
  });
  return { decisions, questionChecks };
}

function cleanScope(scope) {
  if (scope == null || scope === 'global') return 'global';
  if (!object(scope)) return 'global';
  return {
    jobs: (Array.isArray(scope.jobs) ? scope.jobs : []).map(String).slice(0, 100),
    companies: (Array.isArray(scope.companies) ? scope.companies : []).map(value => String(value).toLowerCase()).slice(0, 100),
  };
}

function cleanEvidence(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_EVIDENCE).flatMap(item => typeof item?.sourceId === 'string' && typeof item?.quote === 'string'
    ? [{ sourceId: item.sourceId.slice(0, 200), quote: item.quote.slice(0, MAX_QUOTE) }] : []);
}

// A reusable answer keeps its wording and provenance. It is held (needs-review, never
// matched) when any quote is not in the imported factual sources, or when the source is
// not factual; a sensitive question is dropped and counted. Nothing is silently lost.
export function cleanAnswerBank(value, sources) {
  if (!Array.isArray(value)) return { answers: [], held: 0, sensitiveDropped: 0, invalidDropped: 0 };
  const factual = new Map();
  for (const source of Array.isArray(sources) ? sources : []) if (factualSource(source?.id)) factual.set(source.id, (factual.get(source.id) || '') + '\n' + String(source.text));
  const byQuestion = new Map();
  let held = 0, sensitiveDropped = 0, invalidDropped = 0;
  for (const entry of value.slice(0, MAX_ANSWERS)) {
    if (!object(entry)) { invalidDropped++; continue; }
    const question = textWithin(entry.question, MAX_QUESTION), answer = textWithin(entry.answer, MAX_ANSWER);
    if (!question || !answer) { invalidDropped++; continue; }
    if (isSensitiveLabel(question)) { sensitiveDropped++; continue; }
    const evidence = cleanEvidence(entry.evidence);
    const unresolved = !evidence.length || evidence.some(item => !factualSource(item.sourceId) || !(factual.get(item.sourceId) || '').includes(item.quote));
    // An entry the candidate still had to review before the export stays held after it.
    // Provenance follows the evidence that travelled, never a stale label.
    const needsReview = entry.needsReview === true;
    if (unresolved || needsReview) held++;
    const record = {
      id: textWithin(entry.id, 120) || `answer-${normalizeQuestion(question).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      question, answer, evidence,
      sourceKind: answerSourceKind(evidence),
      scope: cleanScope(entry.scope),
      reviewedAt: /^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt || '') ? entry.reviewedAt : now().slice(0, 10),
      reviewBy: /^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy || '') ? entry.reviewBy : null,
      verifiedAt: entry.verifiedAt === null ? null : /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt || '') ? entry.verifiedAt : null,
      ...(unresolved || needsReview ? { needsReview: true } : {}),
      importedAt: now(),
      ...(unresolved ? { status: 'needs-review' } : {}),
    };
    byQuestion.set(normalizeQuestion(question), record);
  }
  return { answers: [...byQuestion.values()], held, sensitiveDropped, invalidDropped };
}

// A correction is a proposal with history. Its "approved" status only stands while the
// bank entry it approved is usable after the move; otherwise it is held for review.
export function cleanCorrections(value, bankAnswers) {
  if (!Array.isArray(value)) return { corrections: [], held: 0, sensitiveDropped: 0, invalidDropped: 0 };
  const usable = new Map((bankAnswers || []).map(answer => [answer.id, answer]));
  const corrections = [];
  let held = 0, sensitiveDropped = 0, invalidDropped = 0;
  for (const entry of value.slice(0, MAX_CORRECTIONS)) {
    if (!object(entry)) { invalidDropped++; continue; }
    const question = textWithin(entry.question, MAX_QUESTION), answer = textWithin(entry.answer, MAX_ANSWER);
    if (!question || !answer) { invalidDropped++; continue; }
    if (isSensitiveLabel(question)) { sensitiveDropped++; continue; }
    const status = ['proposed', 'approved', 'rejected', 'needs-review'].includes(entry.status) ? entry.status : 'proposed';
    const record = {
      id: textWithin(entry.id, 120) || `correction-${randomUUID()}`,
      jobId: textWithin(entry.jobId, 100) || null,
      question, answer,
      previous: typeof entry.previous === 'string' ? entry.previous.slice(0, MAX_ANSWER) : null,
      evidence: cleanEvidence(entry.evidence),
      scope: cleanScope(entry.scope),
      status,
      proposedAt: isoish(entry.proposedAt) || now(),
      ...(isoish(entry.approvedAt) ? { approvedAt: isoish(entry.approvedAt) } : {}),
      ...(isoish(entry.rejectedAt) ? { rejectedAt: isoish(entry.rejectedAt) } : {}),
      ...(textWithin(entry.answerId, 120) ? { answerId: textWithin(entry.answerId, 120) } : {}),
      importedAt: now(),
    };
    if (status === 'approved') {
      const linked = usable.get(record.answerId) || usable.get(`answer-${record.id}`);
      if (!linked || linked.status === 'needs-review') { record.status = 'needs-review'; held++; }
    }
    corrections.push(record);
  }
  return { corrections, held, sensitiveDropped, invalidDropped };
}

// Rebuilds the importable workspace from the export before any file is touched, so a
// malformed export is refused while the current workspace is still intact.
function prepareImport(data) {
  const profile = Object.fromEntries(Object.keys(emptyProfile()).map(key => [key, cleanText(data.profile[key])]));
  const files = {};
  if (object(data.files)) for (const file of EXPORT_FILES) if (typeof data.files[file] === 'string' && data.files[file]) files[file] = data.files[file];
  if (files[STRUCTURED_RESUME_FILE] && !profile.resume) throw new ImportError('The export has a structured resume but no resume text to mirror it. Export the workspace again from Plainhand.');
  if (!profile.name || !profile.resume) throw new ImportError('The export needs a name and resume.');
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new ImportError('The export has an invalid email address.');
  return {
    profile, files, carryFiles: object(data.files),
    provider: typeof data.provider === 'string' ? data.provider.slice(0, 100) : undefined, jobs: Array.isArray(data.jobs) ? data.jobs : [], sources: Array.isArray(data.sources) ? data.sources : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [], conversation: Array.isArray(data.conversation) ? data.conversation : [],
    events: Array.isArray(data.events) ? data.events : [], contextPrefs: object(data.contextPrefs) ? data.contextPrefs : undefined,
    inbox: Array.isArray(data.inbox) ? data.inbox : undefined, skillPlan: object(data.skillPlan) ? data.skillPlan : undefined,
    writingSamples: cleanSamples(data.writingSamples), claimLine: cleanClaimLine(data.claimLine), standard: cleanStandard(data.standard),
    resumeFormat: cleanResumeFormat(data.resumeFormat), settings: cleanSettings(data.settings), understanding: cleanUnderstanding(data.understanding),
    conflictReview: cleanConflictReview(data.conflictReview),
    filesOmitted: Array.isArray(data.filesOmitted) ? data.filesOmitted.filter(file => EXPORT_FILES.includes(file)) : [],
  };
}

// One marker record per import, written before any replacement. A crash before the state
// commit restores the backups; a crash after it finishes the derived writes. An injected
// (non-crash) failure restores the backups before the error reaches the caller.
async function restoreBackups(workspace, backups) {
  for (const [file, backup] of Object.entries(backups || {})) {
    if (backup) {
      const text = await workspace.read(backup);
      if (text !== '') await workspace.write(file, text); else await workspace.remove(file);
    } else await workspace.remove(file);
  }
}

// Finishes or undoes an import that was interrupted before it wrote its marker's next
// phase. Called at startup and before every import, so the workspace never stays mixed.
export async function recoverInterruptedImport(workspace) {
  const raw = await workspace.read(IMPORT_MARKER);
  if (!raw) return { recovered: false };
  let marker;
  try { marker = JSON.parse(raw); } catch { await workspace.remove(IMPORT_MARKER); return { recovered: false }; }
  if (marker.phase === 'prepared') {
    await restoreBackups(workspace, marker.backups);
    await workspace.remove(IMPORT_MARKER);
    return { recovered: true, phase: 'prepared' };
  }
  if (marker.phase === 'state-committed') {
    await syncTracker(workspace, await workspace.load());
    await workspace.remove(IMPORT_MARKER);
    return { recovered: true, phase: 'state-committed' };
  }
  await workspace.remove(IMPORT_MARKER);
  return { recovered: false, phase: marker.phase || null };
}

export function preview(data) {
  validateExport(data);
  return { name: data.profile.name || '', exportedAt: data.exportedAt || null, jobs: (data.jobs || []).length, applied: (data.jobs || []).filter(job => job.submittedAt).length,
    conversation: (data.agentConversation || []).length, sources: (data.sources || []).length, approvalsReset: (data.jobs || []).filter(job => job.approvedHash).length,
    answerBank: (data.answerBank || []).length, corrections: (data.corrections || []).length, files: Object.keys(object(data.files) ? data.files : {}).filter(file => EXPORT_FILES.includes(file)).length };
}

// The export allow-list, shared by the local app and the hosted website. Memory travels
// (state, reusable answers, corrections, the bounded user-layer sources and the
// canonical tracker); a connection check, a browser checkpoint and every credential
// stay on the machine that made them.
export async function exportWorkspace(workspace, extra = {}) {
  const state = structuredClone(await workspace.load());
  delete state.connectionChecks;
  for (const job of state.jobs || []) delete job.browserCheckpoint;
  const files = {}, filesOmitted = [];
  for (const file of EXPORT_FILES) {
    const text = await workspace.read(file);
    if (!text) continue;
    if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) filesOmitted.push(file);
    else files[file] = text;
  }
  return { ...state, ...extra, answerBank: await new AnswerBank(workspace).load(), corrections: await new Corrections(workspace).list(),
    files, ...(filesOmitted.length ? { filesOmitted } : {}), exportedAt: extra.exportedAt || now() };
}

const BACKUP_NAMES = {
  'data/plainhand/workspace.json': 'workspace.json', 'data/plainhand/conversation.jsonl': 'conversation.jsonl', 'data/plainhand/agent-proposals.json': 'agent-proposals.json',
  'config/profile.yml': 'profile.yml', 'cv.md': 'cv.md', 'modes/_profile.md': 'narrative.md', 'article-digest.md': 'proof-points.md',
  'interview-prep/story-bank.md': 'story-bank.md', 'data/resume-source.yml': 'resume-source.yml', 'data/answer-bank.yml': 'answer-bank.yml',
  'data/plainhand/corrections.json': 'corrections.json', 'data/applications.md': 'applications.md', 'portals.yml': 'portals.yml',
};
const backupName = file => BACKUP_NAMES[file] || `file-${file.replace(/[^\w.-]+/g, '_')}`;

export async function importWorkspace({ workspace, data, busy = false }) {
  validateExport(data);
  // Finish (or undo) a previous interrupted import before anything reads this workspace.
  await recoverInterruptedImport(workspace);
  if (busy) throw new ImportError('Wait for the running reply or tasks to finish, then import.');
  const prepared = prepareImport(data);
  if (await workspace.read(STRUCTURED_RESUME_FILE) && !prepared.files[STRUCTURED_RESUME_FILE]) {
    throw new ImportError('This workspace has a structured resume. Export this workspace and import that export instead, so the resume source and its mirror stay together.');
  }
  const stamp = `${now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const messages = Array.isArray(data.agentConversation) ? data.agentConversation.filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string').slice(-500) : [];
  const proposals = Array.isArray(data.agentProposals) ? data.agentProposals.filter(proposal => proposal && typeof proposal.id === 'string').slice(0, 100) : [];
  const receipts = [];
  for (const record of Array.isArray(data.agentUsage) ? data.agentUsage : []) {
    if (!record || !UUID.test(String(record.id))) continue;
    const file = `data/plainhand/usage/${record.id}.json`;
    if (await workspace.read(file)) continue;
    receipts.push({ file, record });
  }
  const backups = {};
  const backupPath = file => `data/plainhand/backups/${stamp}-import-${backupName(file)}`;
  const replaced = [...new Set([workspace.file, HISTORY_FILE, PROPOSALS_FILE, 'config/profile.yml', 'cv.md', 'portals.yml', ...SOURCE_FILES, ANSWER_BANK_FILE, CORRECTIONS_FILE, 'data/applications.md', ...receipts.map(receipt => receipt.file)])];
  try {
    for (const file of replaced) {
      const text = await workspace.read(file);
      if (!text) { backups[file] = null; continue; }
      await workspace.write(backupPath(file), text);
      backups[file] = backupPath(file);
    }
    await workspace.write(IMPORT_MARKER, JSON.stringify({ phase: 'prepared', stamp, at: now(), backups }, null, 2));
    const summary = await workspace.mutate(async state => {
      if (state.tasks.some(task => ['queued', 'running'].includes(task.status))) throw new ImportError('Wait for the running tasks to finish, then import.');
      for (const key of Object.keys(state)) if (!['version', 'revision'].includes(key)) delete state[key];
      state.profile = prepared.profile;
      for (const key of STATE_KEYS) if (key !== 'profile' && prepared[key] !== undefined) state[key] = prepared[key];
      state.jobs ||= []; state.sources ||= []; state.tasks ||= []; state.conversation ||= []; state.events ||= [];
      state.writingSamples = prepared.writingSamples;
      state.claimLine = prepared.claimLine;
      state.standard = prepared.standard;
      state.resumeFormat = prepared.resumeFormat;
      state.settings = prepared.settings;
      state.understanding = prepared.understanding;
      let approvalsReset = 0;
      for (const job of state.jobs) {
        if (job.approvedHash) approvalsReset++;
        job.approvedHash = null; delete job.browserCheckpoint; delete job.stale;
        if (job.packet && !job.submittedAt) job.stage = 'needs-refresh';
      }
      for (const task of state.tasks) if (['queued', 'running'].includes(task.status)) Object.assign(task, { status: 'interrupted', message: 'Imported from another workspace. Retry to continue.', finishedAt: now() });
      // Files first: the state below commits last, so a failure leaves the old workspace whole.
      const oldConfig = await workspace.read('config/profile.yml');
      const config = yaml.load(oldConfig) || {};
      config.candidate = { ...config.candidate, full_name: state.profile.name, email: state.profile.email, phone: state.profile.phone, location: state.profile.location };
      config.target_roles = { ...config.target_roles, primary: state.profile.roles.split(/[,\n]/).map(value => value.trim()).filter(Boolean) };
      config.location = { ...config.location, timezone: state.profile.timezone, visa_status: state.profile.eligibility };
      config.compensation = { ...config.compensation, target_range: state.profile.compensation };
      await workspace.write('config/profile.yml', yaml.dump(config));
      await workspace.write('cv.md', state.profile.resume + '\n');
      if (prepared.carryFiles) for (const file of SOURCE_FILES) {
        if (prepared.files[file]) await workspace.write(file, prepared.files[file]);
        // A source the export could not carry (too large) is reported, never replaced
        // with an empty file and never silently deleted from the destination.
        else if (!prepared.filesOmitted.includes(file)) await workspace.remove(file);
      } else if (!await workspace.read('modes/_profile.md')) await workspace.write('modes/_profile.md', '# Candidate narrative\n\n' + state.profile.story + '\n');
      // The exported tracker carries rows that exist only in applications.md. Write
      // it before syncTracker so those rows survive while the imported jobs update
      // their own rows. An export with no tracker leaves this workspace's file alone.
      if (prepared.carryFiles && prepared.files[TRACKER_FILE]) await workspace.write(TRACKER_FILE, prepared.files[TRACKER_FILE]);
      if (!await workspace.read('portals.yml')) await workspace.write('portals.yml', 'tracked_companies: []\n');
      // Hold what cannot be verified: the sources here are the imported ones, before
      // sharing exclusions, so a quote is judged on whether its text travelled.
      const context = await workspace.context({ ...state, contextPrefs: {} });
      // A newer export carries its bank and corrections. An older export has neither:
      // keep what this workspace already had and hold every entry the imported sources
      // can no longer prove, so nothing is silently deleted and nothing stale is used.
      const bankSource = Array.isArray(data.answerBank) ? data.answerBank : await new AnswerBank(workspace).load();
      const correctionSource = Array.isArray(data.corrections) ? data.corrections : await new Corrections(workspace).list();
      const bank = cleanAnswerBank(bankSource, context.sources);
      const corrections = cleanCorrections(correctionSource, bank.answers);
      if (bank.answers.length) await new AnswerBank(workspace).save(bank.answers); else await workspace.remove(ANSWER_BANK_FILE);
      if (corrections.corrections.length) await new Corrections(workspace).save(corrections.corrections); else await workspace.remove(CORRECTIONS_FILE);
      const claims = [];
      for (const job of state.jobs) for (const item of [...(job.packet?.resume || []), ...(job.packet?.answers || [])]) claims.push(...(Array.isArray(item?.evidence) ? item.evidence : []));
      for (const item of state.standard?.draft?.resume || []) claims.push(...(Array.isArray(item?.evidence) ? item.evidence : []));
      const unresolvedClaims = claims.filter(evidence => !factualSource(evidence?.sourceId) || !context.sources.some(source => source.id === evidence.sourceId && String(source.text).includes(evidence.quote))).length;
      await workspace.write(HISTORY_FILE, messages.map(message => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : ''));
      await workspace.write(PROPOSALS_FILE, JSON.stringify(proposals, null, 2));
      for (const { file, record } of receipts) await workspace.write(file, JSON.stringify(record.status === 'running' ? { ...record, status: 'interrupted' } : record));
      const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
      const standard = state.standard ? ' Your master resume arrived as a draft; approve it again.' : '';
      const understanding = state.understanding ? ' Your profile understanding needs review.' : '';
      const omitted = prepared.filesOmitted.length ? ` ${plural(prepared.filesOmitted.length, 'source file')} too large to include; review the claims that cite ${prepared.filesOmitted.length === 1 ? 'it' : 'them'}.` : '';
      const counts = [
        plural(state.jobs.length, 'role'),
        `${plural(approvalsReset, 'packet approval')} reset`,
        `${plural(bank.held, 'reusable answer')} held for review`,
        `${plural(bank.sensitiveDropped, 'sensitive answer')} dropped`,
        `${plural(corrections.held, 'correction')} held for review`,
        `${plural(unresolvedClaims, 'claim')} without its source`,
      ].join(', ');
      state.events.unshift({ at: now(), text: `Workspace imported${data.exportedAt ? ` from an export of ${String(data.exportedAt).slice(0, 10)}` : ''}: ${counts}.${standard}${understanding}${omitted}` });
      await syncTracker(workspace, state);
      return { jobs: state.jobs.length, approvalsReset, answerBank: { stored: bank.answers.length, held: bank.held, sensitiveDropped: bank.sensitiveDropped, invalidDropped: bank.invalidDropped },
        corrections: { stored: corrections.corrections.length, held: corrections.held, sensitiveDropped: corrections.sensitiveDropped, invalidDropped: corrections.invalidDropped },
        conflicts: { decisions: (state.conflictReview?.decisions || []).length, questions: (state.conflictReview?.questionChecks || []).length },
        unresolvedClaims, sourceFiles: Object.keys(prepared.files).length, filesOmitted: prepared.filesOmitted,
        standard: state.standard ? (state.standard.kind === 'master' ? 'draft' : 'stale') : 'none', understanding: state.understanding ? 'needs-review' : 'none',
        backup: `data/plainhand/backups/${stamp}-import-*` };
    });
    await workspace.write(IMPORT_MARKER, JSON.stringify({ phase: 'state-committed', stamp, at: now(), backups }, null, 2));
    await workspace.write(IMPORT_MARKER, JSON.stringify({ phase: 'done', stamp, at: now() }, null, 2));
    await workspace.remove(IMPORT_MARKER);
    return { ...summary, conversation: messages.length, proposals: proposals.length, usageReceipts: receipts.length };
  } catch (error) {
    try { await restoreBackups(workspace, backups); await workspace.remove(IMPORT_MARKER); }
    catch { /* The marker stays; the next load restores the backups. */ }
    throw error;
  }
}
