// The candidate's standard application: one resume and cover letter they approve
// once, which every application starts from. Also the autonomy setting that lets
// Plainhand prepare strong matches on its own (never submit).
import { digest } from './store.mjs';

export const STANDARD_JOB = { company: '{company}', title: '{role}', description: 'The candidate’s standard application, not for a specific job. {company} and {role} are slots filled per application.' };
export const DEFAULT_AUTONOMY = { enabled: false, perDay: 3, minScore: 4 };

const identity = draft => digest([draft.headline, draft.resume.map(e => [e.section, e.text]), draft.coverLetter]);

// none | draft | approved | stale (the profile changed since it was written)
export function standardStatus(state, contextHash) {
  const s = state.standard;
  if (!s?.draft) return 'none';
  if (contextHash && s.contextHash !== contextHash) return 'stale';
  return s.approvedHash && s.approvedHash === identity(s.draft) ? 'approved' : 'draft';
}

// Only an approved, current standard is handed to the drafter.
export function standardInput(state, contextHash) {
  if (standardStatus(state, contextHash) !== 'approved') return null;
  const { headline, resume, coverLetter } = state.standard.draft;
  return { headline, resume: resume.map(({ section, text }) => ({ section, text })), coverLetter };
}

export function approveStandard(state, at) {
  if (!state.standard?.draft) throw new Error('Write your standard application first.');
  state.standard.approvedHash = identity(state.standard.draft);
  state.standard.approvedAt = at;
}

const words = text => new Set(String(text || '').toLowerCase().match(/[a-z0-9%$]+/g) || []);
const similar = (a, b) => { const x = words(a), y = words(b); let n = 0; for (const w of x) if (y.has(w)) n++; return n / ((x.size + y.size - n) || 1); };

// What an application changed from the standard: entries kept word for word,
// reworded, added, or left out.
export function compareToStandard(packet, standard) {
  if (!standard) return null;
  const base = standard.resume.map(e => e.text.trim());
  const used = new Set();
  let kept = 0, changed = 0, added = 0;
  for (const entry of packet.resume || []) {
    const text = String(entry.text).trim();
    const exact = base.findIndex((b, i) => !used.has(i) && b === text);
    if (exact >= 0) { used.add(exact); kept++; continue; }
    let best = -1, score = 0;
    base.forEach((b, i) => { if (!used.has(i)) { const s = similar(b, text); if (s > score) { score = s; best = i; } } });
    if (best >= 0 && score >= 0.4) { used.add(best); changed++; } else added++;
  }
  return { kept, changed, added, removed: base.length - used.size };
}

export function autonomyOf(state) {
  return { ...DEFAULT_AUTONOMY, ...(state.settings?.autonomy || {}) };
}

// A just-evaluated role Plainhand may prepare on its own: autonomy on, a strong
// Apply recommendation, an approved current standard, and today's limit not used up.
export function autoPrepareDecision(state, job, contextHash, today) {
  const a = autonomyOf(state);
  if (!a.enabled) return { prepare: false, reason: 'off' };
  if (!job?.evaluation || job.evaluation.recommendation !== 'Apply' || job.evaluation.score < a.minScore) return { prepare: false, reason: 'below threshold' };
  if (job.packet || job.submittedAt) return { prepare: false, reason: 'already prepared' };
  if (standardStatus(state, contextHash) !== 'approved') return { prepare: false, reason: 'no approved standard' };
  const done = state.jobs.filter(j => j.autoSelectedAt?.startsWith(today)).length;
  if (done >= a.perDay) return { prepare: false, reason: 'daily limit reached' };
  return { prepare: true };
}
