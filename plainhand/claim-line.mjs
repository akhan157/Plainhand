// The candidate's line: how strongly they are willing to word their own experience,
// within the truth. Learned from their choices on flagged claims ("use the suggested
// wording" / "keep mine") and from what they say about it in their own words. It moves
// wording only: an unsupported claim is never within anyone's line.

export const KINDS = ['ownership', 'level', 'numbers', 'rounding', 'scope', 'motivation', 'results', 'verifiable', 'other'];
// The starting line before any choices: the market norm (docs/RESUME-MARKET-NORMS.md).
// Rounding stated as rounding ("about 20%") is normal; a candidate who chooses the
// exact figure twice moves off it. Verifiable facts can never be stretched.
export const MARKET_NORM = ['rounding'];
const NEVER = ['verifiable'];
const KIND_LABELS = { ownership: 'ownership (helped, built, led)', level: 'skill level', numbers: 'numbers', rounding: 'rounding stated as rounding ("about 20%")', scope: 'scope and reach', motivation: 'what you enjoy and want', results: 'results and numbers', verifiable: 'titles, employers, dates and degrees', other: 'other wording' };
const SIGNAL_KINDS = { 'ownership-raised': 'ownership', 'ownership-lowered': 'ownership', 'level-raised': 'level', 'number-rounded': 'numbers', 'number-rounded-stated': 'rounding', 'number-not-in-sources': 'numbers', 'result-dropped': 'results' };
const MIN_DECISIONS = 2;

export function kindOf(claim) {
  const fromSignal = (claim.signals || []).map(code => SIGNAL_KINDS[code]).find(Boolean);
  return fromSignal || (KINDS.includes(claim.kind) ? claim.kind : 'other');
}

export function emptyLine() { return { decisions: [], statements: [] }; }
const lineState = state => state.claimLine || (state.claimLine = emptyLine());

// One choice per job and claim; a later choice replaces an earlier one.
export function recordDecision(state, { jobId, claim, decision, at = new Date().toISOString() }) {
  const line = lineState(state);
  const entry = { at, jobId, claimId: claim.id, rating: claim.rating, kind: kindOf(claim), text: String(claim.text || '').slice(0, 1000), suggestion: String(claim.suggestion || '').slice(0, 1000), decision };
  line.decisions = [...line.decisions.filter(d => !(d.jobId === jobId && d.claimId === claim.id)), entry].slice(-300);
  return entry;
}

export function candidateLine(state) {
  const line = state.claimLine || emptyLine();
  const tally = Object.fromEntries(KINDS.map(k => [k, { stretched: { keep: 0, use: 0 }, undersold: { keep: 0, use: 0 } }]));
  for (const d of line.decisions) {
    if (!tally[d.kind] || !['stretched', 'undersold'].includes(d.rating)) continue;
    tally[d.kind][d.rating][d.decision === 'keep-mine' ? 'keep' : 'use']++;
  }
  const leans = (t, side) => t[side] >= MIN_DECISIONS && t[side] > t[side === 'keep' ? 'use' : 'keep'];
  const strict = KINDS.filter(k => leans(tally[k].stretched, 'use'));
  const defaults = MARKET_NORM.filter(k => !strict.includes(k) && !leans(tally[k].stretched, 'keep'));
  const allowedStretches = KINDS.filter(k => !NEVER.includes(k) && (leans(tally[k].stretched, 'keep') || defaults.includes(k)));
  const keepUnderstated = KINDS.filter(k => leans(tally[k].undersold, 'keep'));
  const wantsMore = KINDS.filter(k => leans(tally[k].undersold, 'use'));
  // Fixed sentences only: the summary is built from counts, never from model text.
  const n = (t, side) => `${t[side]} of ${t.keep + t.use}`;
  const summary = [
    ...(defaults.length ? [`Starting point is the market norm: ${defaults.map(k => KIND_LABELS[k]).join(', ')} is fine; titles, employers, dates and degrees stay exact.`] : []),
    ...allowedStretches.map(k => `Comfortable with slightly stronger wording on ${KIND_LABELS[k]} (kept your wording ${n(tally[k].stretched, 'keep')} times).`),
    ...strict.map(k => `Holds ${KIND_LABELS[k]} to the evidence (chose the closer wording ${n(tally[k].stretched, 'use')} times).`),
    ...wantsMore.map(k => `Wants ${KIND_LABELS[k]} stated fully (chose to say more ${n(tally[k].undersold, 'use')} times).`),
    ...keepUnderstated.map(k => `Prefers ${KIND_LABELS[k]} understated (kept the modest wording ${n(tally[k].undersold, 'keep')} times).`),
  ];
  return { decisions: line.decisions.length, statements: line.statements.map(s => s.text), allowedStretches, defaults, strict, keepUnderstated, wantsMore, summary, tally };
}

// What the drafter and reviewer receive: the learned line, the candidate's own words,
// and this job's earlier choices to apply exactly.
export function lineInput(state, jobId) {
  const line = candidateLine(state);
  const decisions = (state.claimLine?.decisions || []).filter(d => d.jobId === jobId && !d.appliedAt).map(d => ({ claim: d.text, suggestion: d.suggestion, decision: d.decision }));
  if (!line.decisions && !line.statements.length) return null;
  return { allowedStretches: line.allowedStretches, keepUnderstated: line.keepUnderstated, wantsMore: line.wantsMore, strict: line.strict, statements: line.statements, decisions };
}

// Marks claims that sit where the candidate chose to put them and recomputes the band
// from the rest. Called at grading time and again whenever the line may have changed.
export function applyLine(calibration, line, summarize, jobDecisions = []) {
  if (!calibration?.claims) return calibration;
  const chosen = new Map(jobDecisions.map(d => [d.claimId, d.decision]));
  const allowed = new Set(line?.allowedStretches || []), understated = new Set(line?.keepUnderstated || []);
  const claims = calibration.claims.map(c => {
    const kind = kindOf(c), decision = chosen.get(c.id) || null;
    const withinLine = decision === 'keep-mine' && c.rating !== 'unsupported'
      || (c.rating === 'stretched' && allowed.has(kind)) || (c.rating === 'undersold' && understated.has(kind));
    return { ...c, kind, decision, withinLine };
  });
  return { ...calibration, claims, ...summarize(claims) };
}

// A job's stored calibration seen through the candidate's current line and choices.
export function calibrationFor(state, job, summarize) {
  if (!job?.calibration) return null;
  return applyLine(job.calibration, candidateLine(state), summarize, (state.claimLine?.decisions || []).filter(d => d.jobId === job.id && !d.appliedAt));
}

// After a new draft has used a job's choices they stay in the line but no longer
// label claims (the new packet's claims are different). Only choices made before
// the draft started count as applied.
export function markApplied(state, jobId, before, at = new Date().toISOString()) {
  for (const d of state.claimLine?.decisions || []) if (d.jobId === jobId && !d.appliedAt && d.at <= before) d.appliedAt = at;
}
