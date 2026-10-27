// Synthetic outcome data for the insights tests (fictional companies only).
import { randomUUID } from 'node:crypto';

export const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
export const dateAgo = n => daysAgo(n).slice(0, 10);

// outcome: evaluated | pending | silent | responded | interview | interview-rejected | rejected | offer | discarded
export function syntheticJob({ score = 4.2, outcome = 'pending', company, title = 'Engineer', applied = 40, changed, interviewsOnly = false } = {}) {
  const id = randomUUID();
  const job = { id, company: company || `Company ${id.slice(0, 6)}`, title, url: `https://jobs.lever.co/${id.slice(0, 8)}/1`, createdAt: daysAgo(applied + 5), stage: 'evaluated',
    evaluation: { score, recommendation: 'Apply', summary: 'Synthetic.', matches: [], gaps: [], questions: [], legitimacyNotes: [] }, status: 'Evaluated', statusHistory: [] };
  if (outcome === 'evaluated') return job;
  if (outcome === 'discarded') { job.status = 'Discarded'; job.statusHistory.push({ from: 'Evaluated', to: 'Discarded', at: daysAgo(applied) }); return job; }
  job.submittedAt = daysAgo(applied); job.stage = 'submitted'; job.status = 'Applied';
  job.statusHistory.push({ from: 'Evaluated', to: 'Applied', at: daysAgo(applied) });
  const step = (to, at) => { job.statusHistory.push({ from: job.status, to, at: daysAgo(at) }); job.status = to; };
  const later = changed ?? Math.max(0, applied - 7);
  if (outcome === 'silent') return job;
  if (outcome === 'responded') step('Responded', later);
  if (outcome === 'interview' || outcome === 'interview-rejected' || outcome === 'offer') {
    if (interviewsOnly) job.record = { contacts: [], interviews: [{ id: randomUUID(), stage: 'Screen', date: dateAgo(later), status: 'completed', addedAt: daysAgo(later) }] };
    else step('Interview', later);
  }
  if (outcome === 'interview-rejected' || outcome === 'rejected') step('Rejected', Math.max(0, later - 1));
  if (outcome === 'offer') step('Offer', Math.max(0, later - 2));
  return job;
}

export const many = (n, spec) => Array.from({ length: n }, () => syntheticJob(spec));
// 20 observed outcomes: the 3.5–3.9 band interviews more often than the 4.5–5.0 band.
export const sufficientJobs = () => [
  ...many(4, { score: 3.6, outcome: 'interview' }), ...many(6, { score: 3.7, outcome: 'rejected' }),
  ...many(1, { score: 4.6, outcome: 'interview' }), ...many(9, { score: 4.7, outcome: 'rejected' }),
];
export const TRACKER_HEADER = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
