import { AnswerBank, evidenceProblem, answerSourceKind, ASSERTION_SOURCE } from './answer-bank.mjs';
import { isSensitiveLabel } from './field-policy.mjs';

export const CORRECTIONS_FILE = 'data/plainhand/corrections.json';
const FILE = CORRECTIONS_FILE;

// A candidate correction is only a proposal. Nothing reaches the reusable
// answer bank until approve() is called explicitly.
export class Corrections {
  constructor(workspace) { this.workspace = workspace; this.bank = new AnswerBank(workspace); }

  async list() {
    try { const parsed = JSON.parse(await this.workspace.read(FILE)); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }

  async save(entries) { await this.workspace.write(FILE, JSON.stringify(entries, null, 2)); }

  async propose({ jobId, question, previous = null, answer, evidence, scope = null } = {}, { id } = {}) {
    const cleanQuestion = String(question || '').trim();
    const cleanAnswer = String(answer || '').trim();
    if (!cleanQuestion || !cleanAnswer) throw new Error('A correction needs the question and the corrected answer.');
    if (isSensitiveLabel(cleanQuestion)) throw new Error('Sensitive answers are confirmed per application, never stored as corrections.');
    await this.validateEvidence(evidence);
    const entries = await this.list();
    const cleanScope = scope === 'global' ? 'global' : {
      jobs: Array.isArray(scope?.jobs) ? scope.jobs.map(String).slice(0, 100) : jobId ? [String(jobId)] : [],
      // Only an explicit scope object records employer scope; older callers keep their shape.
      ...(Array.isArray(scope?.companies) ? { companies: scope.companies.map(value => String(value).toLowerCase()).slice(0, 100) } : {}),
    };
    const record = {
      id: id || `correction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      jobId: jobId ? String(jobId) : null,
      question: cleanQuestion,
      previous: previous == null ? null : String(previous).slice(0, 5000),
      answer: cleanAnswer,
      evidence: evidence.map(({ sourceId, quote }) => ({ sourceId, quote })),
      sourceKind: answerSourceKind(evidence),
      scope: cleanScope,
      status: 'proposed',
      proposedAt: new Date().toISOString(),
    };
    entries.push(record);
    await this.save(entries);
    return record;
  }

  async validateEvidence(evidence) {
    const problem = evidenceProblem(evidence);
    if (problem) throw new Error(`A correction needs ${problem}.`);
  }

  async approve(id, { reviewedAt = new Date().toISOString().slice(0, 10) } = {}) {
    const entries = await this.list();
    const record = entries.find(entry => entry.id === id);
    if (!record) throw new Error('Correction not found.');
    if (record.status === 'approved') return record;
    const stored = await this.bank.add({ question: record.question, answer: record.answer, evidence: record.evidence, scope: record.scope, reviewedAt }, { id: 'answer-' + record.id });
    record.status = 'approved'; record.approvedAt = new Date().toISOString(); record.answerId = stored.id;
    await this.save(entries);
    return record;
  }

  async reject(id) {
    const entries = await this.list();
    const record = entries.find(entry => entry.id === id);
    if (!record) throw new Error('Correction not found.');
    if (record.status !== 'rejected') { record.status = 'rejected'; record.rejectedAt = new Date().toISOString(); await this.save(entries); }
    return record;
  }
}

// Answers the candidate typed into a form are offered for reuse as assertions, scoped
// to this role and employer. Global reuse is only the candidate's explicit choice
// (propose with scope 'global'). Sensitive questions, uploads and values the plan
// already supplied are never offered; a proposal the candidate already saw is not
// repeated. Approval still happens on the candidate's action.
export async function offerTypedAnswers(corrections, { job, fields = [], answers = {}, planned = {} } = {}) {
  const known = await corrections.list();
  let offered = 0;
  for (const field of Array.isArray(fields) ? fields : []) {
    const typed = typeof answers?.[field?.key] === 'string' ? answers[field.key].trim() : '';
    if (typed.length < 8 || field.type === 'file' || isSensitiveLabel(field.label) || typed === String(planned?.[field.key] || '').trim()) continue;
    if (known.some(item => item.question === field.label && item.answer === typed && item.status !== 'rejected')) continue;
    try {
      await corrections.propose({
        jobId: job?.id, question: field.label, previous: planned?.[field.key] || null, answer: typed,
        evidence: [{ sourceId: ASSERTION_SOURCE, quote: typed.slice(0, 500) }],
        scope: { jobs: job?.id ? [String(job.id)] : [], companies: job?.company ? [String(job.company).toLowerCase()] : [] },
      });
      offered++;
    } catch { /* A field the store refuses is not offered. */ }
  }
  return offered;
}
