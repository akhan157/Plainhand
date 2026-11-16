// The candidate's master resume and base cover letter: the complete record of what
// they have done, in wording they approve once. Every application selects from it.
// (State, task and action names still say "standard", the earlier name, so saved
// workspaces and agent contracts keep working.) Also the autonomy setting that
// lets Plainhand prepare strong matches on its own (never submit).
import { digest } from './store.mjs';

export const STANDARD_JOB = { company: '{company}', title: '{role}', description: 'The candidate’s master resume and base cover letter, not for a specific job. {company} and {role} are slots filled per application.' };
export const DEFAULT_AUTONOMY = { enabled: false, perDay: 3, minScore: 4 };
export const DEFAULT_ROLE_ORDER = 'recent';
export const ROLE_ORDERS = ['recent', 'match'];

// What the candidate approved is exactly what the drafter receives. A heading is
// one projection: fixed fields, trimmed, and no other key can travel. The heading
// slot is added to the identity only when one is present, so a master with no
// headings keeps the approval it already had.
const headingOf = heading => {
  if (!heading || typeof heading !== 'object') return null;
  const clean = { org: '', title: '', location: '', dates: '' };
  for (const key of Object.keys(clean)) clean[key] = typeof heading[key] === 'string' ? heading[key].trim() : '';
  return Object.values(clean).some(Boolean) ? clean : null;
};
const identity = draft => digest([
draft.headline,
draft.resume.map(entry => {
const heading = headingOf(entry.heading);
return heading ? [entry.section, heading, entry.text] : [entry.section, entry.text];
}),
draft.coverLetter,
]);

// none | draft | approved | stale (the profile changed since it was written, or it
// is a curated standard resume from before the master resume existed)
export const isMaster = standard => standard?.kind === 'master';
export function standardStatus(state, contextHash) {
  const s = state.standard;
  if (!s?.draft) return 'none';
  if (!isMaster(s)) return 'stale';
  if (contextHash && s.contextHash !== contextHash) return 'stale';
  return s.approvedHash && s.approvedHash === identity(s.draft) ? 'approved' : 'draft';
}

// Only an approved, current master resume is handed to the drafter.
export function standardInput(state, contextHash) {
  if (standardStatus(state, contextHash) !== 'approved') return null;
  const { headline, resume, coverLetter } = state.standard.draft;
  // Headings travel with each line so the agent knows which role a bullet belongs to
  // and can choose and order roles for each job. They go through the same projection
  // the approval hash uses, so nothing unapproved can reach the drafter.
  return { headline, resume: resume.map(({ section, heading, text }) => {
    const clean = headingOf(heading);
    return { section, ...(clean ? { heading: clean } : {}), text };
  }), coverLetter };
}

export function approveStandard(state, at) {
  if (!state.standard?.draft) throw new Error('Write your master resume first.');
  state.standard.approvedHash = identity(state.standard.draft);
  state.standard.approvedAt = at;
}

const words = text => new Set(String(text || '').toLowerCase().match(/[a-z0-9%$]+/g) || []);
const similar = (a, b) => { const x = words(a), y = words(b); let n = 0; for (const w of x) if (y.has(w)) n++; return n / ((x.size + y.size - n) || 1); };

// How an application used the master resume: lines used word for word, reworded,
// added from other sources, and how many master lines it left for other jobs.
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
  return { kept, changed, added, removed: base.length - used.size, total: base.length };
}

// Which lines of the candidate's own resume the master resume covers. A line is
// covered when most of its content words appear somewhere in the master (text or
// role headings), so rewording and merged bullets still count. Contact lines and
// short labels are not counted.
const contentWords = text => (String(text || '').toLowerCase().match(/[a-z0-9%$&+#.]+/g) || []).map(w => w.replace(/^\.+|\.+$/g, '')).filter(w => w.length >= 4 || /\d/.test(w));
export function masterCoverage(resumeText, entries) {
  const have = new Set(contentWords((entries || []).map(e => [e.text, e.section, e.heading?.org, e.heading?.title, e.heading?.location, e.heading?.dates].filter(Boolean).join(' ')).join('\n')));
  const lines = String(resumeText || '').split(/\r?\n/).map(line => line.replace(/^[\s•·*\-–—▪◦]+/, '').trim())
    .filter(line => !/@|https?:\/\/|\+?\d[\d\s().-]{7,}\d/.test(line) && contentWords(line).length >= 4);
  const missing = lines.filter(line => { const need = [...new Set(contentWords(line))]; return need.filter(w => have.has(w)).length / need.length < 0.6; });
  return { lines: lines.length, covered: lines.length - missing.length, missing: missing.slice(0, 12).map(line => line.slice(0, 300)) };
}

export function autonomyOf(state) {
  return { ...DEFAULT_AUTONOMY, ...(state.settings?.autonomy || {}) };
}
// How the roles on a tailored resume are ordered: newest first (the default), or the
// role that best matches the job first. A setting of its own, not part of the resume
// format: the format is re-derived from an uploaded PDF, and this choice is not in it.
export function roleOrderOf(state) {
  const order = state?.settings?.roleOrder;
  return ROLE_ORDERS.includes(order) ? order : DEFAULT_ROLE_ORDER;
}

// A just-evaluated role Plainhand may prepare on its own: autonomy on, a strong
// Apply recommendation, an approved current master resume, and today's limit not used up.
export function autoPrepareDecision(state, job, contextHash, today) {
  const a = autonomyOf(state);
  if (!a.enabled) return { prepare: false, reason: 'off' };
  if (!job?.evaluation || job.evaluation.recommendation !== 'Apply' || job.evaluation.score < a.minScore) return { prepare: false, reason: 'below threshold' };
  if (job.packet || job.submittedAt) return { prepare: false, reason: 'already prepared' };
  if (standardStatus(state, contextHash) !== 'approved') return { prepare: false, reason: 'no approved standard' };
  const done = state.jobs.filter(j => j.autoSelectedAt?.startsWith(today)).length;
  if (done >= a.perDay) return { prepare: false, reason: 'daily limit reached', done, perDay: a.perDay };
  return { prepare: true };
}
