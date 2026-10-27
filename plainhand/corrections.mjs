import { AnswerBank, validEvidence } from './answer-bank.mjs';
import { isSensitiveLabel } from './field-policy.mjs';

const FILE = 'data/plainhand/corrections.json';

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
    const record = {
      id: id || `correction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      jobId: jobId ? String(jobId) : null,
      question: cleanQuestion,
      previous: previous == null ? null : String(previous).slice(0, 5000),
      answer: cleanAnswer,
      evidence: evidence.map(({ sourceId, quote }) => ({ sourceId, quote })),
      scope: scope === 'global' ? 'global' : { jobs: jobId ? [String(jobId)] : [] },
      status: 'proposed',
      proposedAt: new Date().toISOString(),
    };
    entries.push(record);
    await this.save(entries);
    return record;
  }

  async validateEvidence(evidence) {
    if (!validEvidence(evidence)) throw new Error('A correction needs an exact source quote of at least 8 characters.');
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
