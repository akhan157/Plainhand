import yaml from 'js-yaml';
import { nonFactualSource, factualSource } from './store.mjs';
import { isSensitiveLabel } from './field-policy.mjs';

export const ANSWER_BANK_FILE = 'data/answer-bank.yml';
// The candidate's typed form answer. It is assertion provenance: it may fill a later
// form field, but it never grounds a factual claim in a packet.
export const ASSERTION_SOURCE = 'candidate-answer';
const MAX_ANSWER = 5000;
export const normalizeQuestion = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();

// Provenance follows the evidence, never a caller's label. An entry with any typed
// answer in its evidence contains an assertion and cannot become factual by editing.
export function answerSourceKind(evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  return items.some(item => item?.sourceId === ASSERTION_SOURCE) ? 'assertion' : 'factual';
}

// Entries saved by 1.1.2 and earlier carry neither `sourceKind` nor `verifiedAt`. Their
// provenance follows from the evidence they already hold, and the review date they were
// saved with was the verification. Filling both on read keeps a saved answer reusable
// across an update without rewriting the candidate's data/answer-bank.yml; an entry that
// records `verifiedAt: null` on purpose still needs re-approval.
export function withProvenance(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const sourceKind = entry.sourceKind || answerSourceKind(entry.evidence);
  const verifiedAt = entry.verifiedAt === undefined && typeof entry.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt) ? entry.reviewedAt : entry.verifiedAt;
  return { ...entry, sourceKind, verifiedAt };
}

// Whether every quote still appears verbatim in a current factual source. This is the
// same test the import hold rule uses, applied at reuse time against the shared sources.
export function quoteInSources(evidence, sources) {
  if (!Array.isArray(evidence) || !evidence.length || !Array.isArray(sources) || !sources.length) return false;
  return evidence.every(item => sources.some(source => source?.id === item.sourceId && factualSource(source.id) && String(source.text).includes(item.quote)));
}

const scopeMatches = (entry, job) => {
  if (!entry.scope || entry.scope === 'global') return true;
  const jobs = Array.isArray(entry.scope.jobs) ? entry.scope.jobs.map(String) : [];
  const companies = Array.isArray(entry.scope.companies) ? entry.scope.companies.map(value => String(value).toLowerCase()) : [];
  return Boolean(job && (jobs.includes(String(job.id)) || companies.includes(String(job.company || '').toLowerCase())));
};

// Why an approved entry cannot replace a packet answer now, or null when it can. The
// first failing gate is the reason recorded on the packet, so it names the real blocker.
export function reuseProblem(entry, { job = null, label = null, asOf = null, sources = null } = {}) {
  if (!entry || typeof entry !== 'object') return 'not found';
  if (label != null && normalizeQuestion(entry.question) !== normalizeQuestion(label)) return 'question does not match';
  if (entry.status === 'needs-review' || entry.needsReview) return 'needs review';
  if (entry.sourceKind !== 'factual') return 'candidate assertion, not factual evidence';
  const today = asOf || new Date().toISOString().slice(0, 10);
  if (entry.reviewBy && String(entry.reviewBy) < today) return 'expired';
  if (isSensitiveLabel(entry.question)) return 'sensitive question';
  if (!scopeMatches(entry, job)) return 'scope does not match this role';
  if (evidenceProblem(entry.evidence)) return 'missing an exact source quote';
  if (!quoteInSources(entry.evidence, sources)) return 'quote is not in the current sources';
  return null;
}

// Why an evidence list is unusable, or null when it is usable. A reusable answer
// may keep an assertion source ("candidate-answer", typed by the candidate) until
// the provenance packet, but it can never cite a writing sample or the agent's
// reviewed summary as fact.
export function evidenceProblem(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return 'an exact source quote of at least 8 characters';
  for (const item of evidence) {
    if (!item || typeof item.sourceId !== 'string' || !item.sourceId.trim()) return 'an exact source quote of at least 8 characters';
    const kind = nonFactualSource(item.sourceId);
    if (kind) return kind;
    if (typeof item.quote !== 'string' || item.quote.trim().length < 8) return 'an exact source quote of at least 8 characters';
  }
  return null;
}

export function validEvidence(evidence) {
  return evidenceProblem(evidence) === null;
}

// Reusable, candidate-approved answers. Each entry carries provenance and a
// review date; nothing is reused once it expires, and sensitive questions are
// never answered from here.
export class AnswerBank {
  constructor(workspace) { this.workspace = workspace; }

  async load() {
    try {
      const document = yaml.load(await this.workspace.read(ANSWER_BANK_FILE)) || {};
      return Array.isArray(document.answers) ? document.answers.map(withProvenance) : [];
    } catch { return []; }
  }

  async save(answers) {
    await this.workspace.write(ANSWER_BANK_FILE, yaml.dump({ version: 1, answers }, { noRefs: true, lineWidth: 120 }));
  }

  async add(entry, { id } = {}) {
    const question = String(entry?.question || '').trim();
    const answer = String(entry?.answer || '').trim();
    if (!question || !answer) throw new Error('A reusable answer needs a question and an answer.');
    if (answer.length > MAX_ANSWER) throw new Error('That answer is too long to store.');
    const problem = evidenceProblem(entry.evidence);
    if (problem) throw new Error(`A reusable answer needs ${problem}.`);
    if (isSensitiveLabel(question)) throw new Error('Sensitive or legally meaningful questions cannot be stored as reusable answers.');
    const reviewedAt = entry.reviewedAt || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) throw new Error('Record the review date as YYYY-MM-DD.');
    const reviewBy = entry.reviewBy ? String(entry.reviewBy) : null;
    if (reviewBy && !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw new Error('Record the expiry date as YYYY-MM-DD.');
    const sourceKind = answerSourceKind(entry.evidence);
    if (entry.sourceKind && entry.sourceKind !== sourceKind) throw new Error('An answer’s provenance follows its evidence.');
    // A content edit clears the verification until the candidate re-approves or attaches
    // a current quote; an unchanged answer keeps the date it was verified on.
    const verifiedAt = entry.verifiedAt === null ? null : /^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedAt || '') ? entry.verifiedAt : reviewedAt;
    const scope = entry.scope === 'global' || entry.scope == null ? 'global' : {
      jobs: Array.isArray(entry.scope.jobs) ? entry.scope.jobs.map(String) : [],
      companies: Array.isArray(entry.scope.companies) ? entry.scope.companies.map(value => value.toLowerCase()) : [],
    };
    const record = {
      id: id || `answer-${normalizeQuestion(question).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, question, answer,
      evidence: entry.evidence.map(({ sourceId, quote }) => ({ sourceId, quote })),
      sourceKind, scope, reviewedAt, reviewBy, verifiedAt,
      ...(entry.needsReview ? { needsReview: true } : {}),
      // An imported entry stays held until the candidate's review, even through an edit.
      ...(entry.status === 'needs-review' ? { status: 'needs-review' } : {}),
      ...(typeof entry.importedAt === 'string' ? { importedAt: entry.importedAt } : {}),
    };
    const answers = (await this.load()).filter(item => normalizeQuestion(item.question) !== normalizeQuestion(question));
    answers.push(record);
    await this.save(answers);
    return record;
  }

  async remove(id) {
    const answers = await this.load();
    const next = answers.filter(item => item.id !== id);
    if (next.length === answers.length) return false;
    await this.save(next);
    return true;
  }

  // A match must be unexpired, unscoped-safe and provable. Held entries and entries
  // awaiting re-verification fall through to the normal packet path or to the candidate.
  // Form fill accepts an approved assertion; packet reuse uses reuse() below, which
  // requires factual provenance and a quote still present in the shared sources.
  static match(answers, { label, job, asOf } = {}) {
    const question = normalizeQuestion(label);
    if (!question || isSensitiveLabel(label)) return null;
    const today = asOf || new Date().toISOString().slice(0, 10);
    for (const entry of answers || []) {
      if (normalizeQuestion(entry?.question) !== question) continue;
      if (!entry.answer || typeof entry.answer !== 'string') continue;
      // An imported answer whose quote is not in the current sources is held for the
      // candidate's review and never fills an application field.
      if (entry.status === 'needs-review' || entry.needsReview) continue;
      if (entry.reviewBy && String(entry.reviewBy) < today) continue;
      if (!validEvidence(entry.evidence)) continue;
      if (!scopeMatches(entry, job)) continue;
      return entry;
    }
    return null;
  }

  // The reusable answer for one packet question, with the reason when none may be
  // injected. A question with no bank entry returns no reason: nothing was proposed.
  static reuse(answers, { label, job, asOf, sources } = {}) {
    const question = normalizeQuestion(label);
    const matching = (answers || []).filter(entry => question && normalizeQuestion(entry?.question) === question);
    if (!matching.length) return { entry: null, reason: null };
    let reason = null;
    for (const entry of matching) {
      const problem = reuseProblem(entry, { label, job, asOf, sources });
      if (!problem) return { entry, reason: null };
      reason ||= problem;
    }
    return { entry: null, reason: reason || 'no usable answer' };
  }
}
