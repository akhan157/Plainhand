import yaml from 'js-yaml';
import { isSensitiveLabel } from './field-policy.mjs';

export const ANSWER_BANK_FILE = 'data/answer-bank.yml';
const MAX_ANSWER = 5000;
const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();

export function validEvidence(evidence) {
  return Array.isArray(evidence) && evidence.length > 0 && evidence.every(item =>
    item && typeof item.sourceId === 'string' && item.sourceId.trim() &&
    typeof item.quote === 'string' && item.quote.trim().length >= 8);
}

// Reusable, candidate-approved answers. Each entry carries provenance and a
// review date; nothing is reused once it expires, and sensitive questions are
// never answered from here.
export class AnswerBank {
  constructor(workspace) { this.workspace = workspace; }

  async load() {
    try {
      const document = yaml.load(await this.workspace.read(ANSWER_BANK_FILE)) || {};
      return Array.isArray(document.answers) ? document.answers : [];
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
    if (!validEvidence(entry.evidence)) throw new Error('A reusable answer needs an exact source quote of at least 8 characters.');
    if (isSensitiveLabel(question)) throw new Error('Sensitive or legally meaningful questions cannot be stored as reusable answers.');
    const reviewedAt = entry.reviewedAt || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) throw new Error('Record the review date as YYYY-MM-DD.');
    const reviewBy = entry.reviewBy ? String(entry.reviewBy) : null;
    if (reviewBy && !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw new Error('Record the expiry date as YYYY-MM-DD.');
    const scope = entry.scope === 'global' || entry.scope == null ? 'global' : {
      jobs: Array.isArray(entry.scope.jobs) ? entry.scope.jobs.map(String) : [],
      companies: Array.isArray(entry.scope.companies) ? entry.scope.companies.map(value => value.toLowerCase()) : [],
    };
    const record = { id: id || `answer-${normalize(question).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, question, answer, evidence: entry.evidence.map(({ sourceId, quote }) => ({ sourceId, quote })), scope, reviewedAt, reviewBy };
    const answers = (await this.load()).filter(item => normalize(item.question) !== normalize(question));
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

  // A match must be unscoped-safe, unexpired and provable. Anything else falls
  // through to the normal packet path or to the candidate.
  static match(answers, { label, job, asOf }) {
    const question = normalize(label);
    if (!question || isSensitiveLabel(label)) return null;
    const today = asOf || new Date().toISOString().slice(0, 10);
    for (const entry of answers || []) {
      if (normalize(entry.question) !== question) continue;
      if (!entry.answer || typeof entry.answer !== 'string') continue;
      if (entry.reviewBy && String(entry.reviewBy) < today) continue;
      if (!validEvidence(entry.evidence)) continue;
      if (entry.scope && entry.scope !== 'global') {
        const jobs = Array.isArray(entry.scope.jobs) ? entry.scope.jobs : [];
        const companies = Array.isArray(entry.scope.companies) ? entry.scope.companies : [];
        const jobMatch = job && jobs.includes(String(job.id));
        const companyMatch = job && companies.includes(String(job.company || '').toLowerCase());
        if (!jobMatch && !companyMatch) continue;
      }
      return entry;
    }
    return null;
  }
}
