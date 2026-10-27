// Outcome insights: one record per application from the Plainhand workspace and
// the canonical tracker (legacy rows included), then score-band, pattern and
// recommendation views over those records. Everything here is pure: callers
// pass the workspace state and the tracker analysis from outcome-intelligence.mjs.
//
// Observed vs assumed:
//   observed  status changes the candidate recorded (with dates), interview rounds
//             in the application record, tracker statuses, explicit report outcomes
//   assumed   silence (still Applied, no status change for SILENCE_DAYS), the row
//             date of a legacy tracker row standing in for the application date
import { DEFAULT_SCORE_BANDS } from '../../../outcome-intelligence.mjs';
import { calibrate, DEFAULT_MINIMUM } from '../../../score-calibration.mjs';
import { recommendationFingerprint } from '../../../outcome-recommendation-state.mjs';

export const SILENCE_DAYS = 21;
// Observed outcomes a band needs before it shows a rate (outcome-intelligence minimumObservedPerBand).
export const BAND_MINIMUM = 5;
// Observed outcomes overall before bands can be compared (score-calibration DEFAULT_MINIMUM).
export const OVERALL_MINIMUM = DEFAULT_MINIMUM;
// Observed outcomes before any suggestion, and per group for a pattern suggestion
// (outcome-intelligence minimumObservedForRecommendation / minimumPositiveForRecommendation).
export const SUGGEST_MINIMUM = 8;
export const POSITIVE_MINIMUM = 2;
// Plainhand asks for a written reason before pursuing a role below this score.
export const APPLY_THRESHOLD = 4;

const DAY = 86400000;
const APPLIED_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Rejected']);
const EXCLUDED_STATUSES = new Set(['Discarded', 'SKIP']);
export const DIMENSIONS = [
  ['archetype', 'Role archetype', 'target'],
  ['company', 'Company', 'target'],
  ['narrative', 'Narrative', 'narrative'],
  ['resumeFraming', 'Resume framing', 'narrative'],
  ['followUpChannel', 'Follow-up channel', 'channel'],
  ['portal', 'Application portal', 'portal'],
];

// Bands use the outcome-intelligence keys and labels, but a score belongs to the
// highest band whose minimum it reaches, so 3.45 or 4.45 is never left out.
const BANDS = [...DEFAULT_SCORE_BANDS].sort((a, b) => a.min - b.min);
export function bandOf(score) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 5) return null;
  return [...BANDS].reverse().find(band => score >= band.min) || null;
}

const lower = value => String(value || '').trim().toLowerCase();
const rate = (count, of) => of ? Math.round(count / of * 10000) / 10000 : null;
const daysBetween = (from, to) => { const start = new Date(from).getTime(); return Number.isNaN(start) ? null : Math.floor((to - start) / DAY); };
function asOfTime(asOf) { const t = asOf ? new Date(asOf).getTime() : Date.now(); return Number.isNaN(t) ? Date.now() : t; }

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } }

function finish(record, { silenceDays, now }) {
  if (!record.applied) { record.result = record.excluded ? 'excluded' : 'not-applied'; record.evidence = 'none'; return record; }
  const days = record.lastChangeAt ? daysBetween(record.lastChangeAt, now) : null;
  record.daysSinceChange = days;
  if (record.offer) record.result = 'offer';
  else if (record.reachedInterview) record.result = 'interview';
  else if (record.rejected) record.result = 'rejected';
  else if (record.responded) record.result = 'responded';
  else if (record.silentRecorded || (record.status === 'Applied' && days !== null && days >= silenceDays)) record.result = 'silent';
  else record.result = 'pending';
  record.resolved = record.offer || record.reachedInterview || record.rejected;
  record.evidence = record.resolved || record.result === 'responded' ? 'observed' : record.result === 'silent' ? 'assumed' : 'none';
  return record;
}

// One record per Plainhand job. statusHistory, submittedAt and interview rounds
// say more than the current status: an interview that ended in rejection still
// reached the interview stage.
function workspaceRecord(job, trackerRecord, options) {
  const history = Array.isArray(job.statusHistory) ? job.statusHistory : [];
  const seen = new Set([...history.map(h => h.to), job.status].filter(Boolean));
  const interviews = (Array.isArray(job.record?.interviews) ? job.record.interviews : []).filter(i => i.status !== 'canceled');
  const appliedEntry = history.find(h => h.to === 'Applied');
  const applied = Boolean(job.submittedAt) || [...seen].some(s => APPLIED_STATUSES.has(s));
  const appliedAt = job.submittedAt || appliedEntry?.at || null;
  const lastChange = history.at(-1)?.at || null;
  const dims = { ...(trackerRecord?.dimensions || {}) };
  if (!dims.archetype && typeof job.evaluation?.archetype === 'string' && job.evaluation.archetype.trim()) dims.archetype = job.evaluation.archetype.trim();
  if (!dims.portal && job.url) dims.portal = hostOf(job.url);
  if (job.company) dims.company = job.company;
  return finish({
    key: `job:${job.id}`, source: 'workspace', jobId: job.id, company: job.company || '', title: job.title || '',
    score: typeof job.evaluation?.score === 'number' ? job.evaluation.score : null,
    status: job.status || (job.evaluation ? 'Evaluated' : null), applied, excluded: !applied && EXCLUDED_STATUSES.has(job.status),
    appliedAt, appliedAtAssumed: false, lastChangeAt: [lastChange, appliedAt].filter(Boolean).sort().at(-1) || null,
    reachedInterview: seen.has('Interview') || seen.has('Offer') || interviews.length > 0, interviewRounds: interviews.length,
    offer: seen.has('Offer'), rejected: job.status === 'Rejected', responded: seen.has('Responded'), silentRecorded: false,
    reportDimensions: Boolean(trackerRecord && Object.keys(trackerRecord.dimensions || {}).length), dimensions: dims,
  }, options);
}

// A tracker row with no Plainhand job (legacy data). Only its current status is
// known, and its row date stands in for the application date (an assumption).
const LEGACY_STATUS = { applied: 'Applied', responded: 'Responded', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', discarded: 'Discarded', skip: 'SKIP', apply: 'Apply', evaluated: 'Evaluated' };
function legacyRecord(record, options) {
  const status = LEGACY_STATUS[record.normalizedStatus] || record.status || null;
  const outcome = record.outcome;
  // "Apply" means the candidate meant to apply, not that they did.
  const applied = APPLIED_STATUSES.has(status) || ['offer', 'interview', 'rejection', 'response'].includes(outcome);
  const dims = { ...(record.dimensions || {}) };
  if (record.company) dims.company = record.company;
  return finish({
    key: `tracker:${record.num}`, source: 'tracker', trackerNumber: record.num, company: record.company || '', title: record.role || '',
    score: Number.isFinite(record.score) ? record.score : null, status, applied, excluded: !applied && EXCLUDED_STATUSES.has(status),
    appliedAt: record.date || null, appliedAtAssumed: true, lastChangeAt: record.date || null,
    reachedInterview: outcome === 'interview' || outcome === 'offer', interviewRounds: 0,
    offer: outcome === 'offer', rejected: outcome === 'rejection', responded: outcome === 'response',
    silentRecorded: outcome === 'silence' && record.outcomeSource === 'report',
    reportDimensions: Object.keys(record.dimensions || {}).length > 0, dimensions: dims,
  }, options);
}

/**
 * Merge workspace jobs with tracker records. A tracker row that matches a
 * workspace job (same company and role, as syncTracker writes it) is that job;
 * every other row is legacy data and is included as its own application.
 */
export function buildRecords(state, trackerAnalysis, { silenceDays = SILENCE_DAYS, asOf } = {}) {
  const options = { silenceDays, now: asOfTime(asOf) };
  const trackerRecords = Array.isArray(trackerAnalysis?.records) ? trackerAnalysis.records : [];
  const byName = new Map(trackerRecords.map(r => [`${lower(r.company)}\0${lower(r.role)}`, r]));
  const used = new Set();
  const records = [];
  for (const job of state?.jobs || []) {
    const match = byName.get(`${lower(job.company)}\0${lower(job.title)}`);
    if (match) used.add(match);
    records.push(workspaceRecord(job, match, options));
  }
  for (const row of trackerRecords) if (!used.has(row)) records.push(legacyRecord(row, options));
  return records;
}

function counts(records) {
  const applied = records.filter(r => r.applied);
  const c = {
    evaluated: records.filter(r => r.score !== null).length,
    applied: applied.length,
    interviews: applied.filter(r => r.reachedInterview || r.offer).length,
    offers: applied.filter(r => r.offer).length,
    rejected: applied.filter(r => r.rejected).length,
    rejectedAfterInterview: applied.filter(r => r.rejected && (r.reachedInterview || r.offer)).length,
    responded: applied.filter(r => r.result === 'responded').length,
    pending: applied.filter(r => ['pending', 'responded'].includes(r.result)).length,
    silent: applied.filter(r => r.result === 'silent').length,
  };
  c.observed = applied.filter(r => r.resolved).length;
  c.assumed = c.silent;
  return c;
}

function bandRow(band, records, overallSufficient) {
  const c = counts(records);
  const enough = c.observed >= BAND_MINIMUM;
  return {
    key: band.key, label: band.label, min: band.min, max: band.max, ...c,
    insufficientData: !enough,
    provisional: enough && !overallSufficient,
    // Observed rate: interviews among applications with an observed outcome.
    interviewRate: enough ? rate(c.interviews, c.observed) : null,
    offerRate: enough ? rate(c.offers, c.observed) : null,
    // Assumed rate: also counts every silent application as "no interview".
    interviewRateIfSilenceIsNo: enough ? rate(c.interviews, c.observed + c.silent) : null,
    note: c.applied === 0 ? 'No applications in this band yet.'
      : !enough ? `${c.observed} of ${BAND_MINIMUM} observed outcomes needed before this band shows a rate.`
      : !overallSufficient ? 'Provisional: enough outcomes in this band, but not yet enough overall to compare bands.'
      : null,
  };
}

export const OBSERVED_VS_ASSUMED = silenceDays => ({
  observed: [
    'Status changes you recorded (Applied, Responded, Interview, Offer, Rejected) and when you recorded them.',
    'Interview rounds in each application record: a scheduled or completed round means the application reached the interview stage.',
    'Statuses in the canonical tracker (data/applications.md), including rows from before Plainhand.',
    'Outcomes written explicitly in a linked report summary.',
  ],
  assumed: [
    `Silence: an application still at Applied with no status change for ${silenceDays} days is counted as silent. Silent is not rejected: no one told you no.`,
    'For tracker rows without Plainhand history, the row date stands in for the application date, and only the current status is known (an interview that ended in rejection shows as a rejection).',
    'The "if silence means no" rate assumes no silent application would have led to an interview.',
    'Scores are the evaluation’s fit estimate. A difference between bands is a correlation in your own outcomes, not proof that the score causes interviews.',
  ],
});

function correlation(bands, overall, calibration) {
  const rated = bands.filter(b => b.interviewRate !== null);
  if (!calibration.sufficientData || rated.length < 2) {
    return {
      status: 'insufficient-data', comparedBands: rated.map(b => b.key),
      statement: overall.observed === 0
        ? 'No observed outcomes yet, so Plainhand cannot say whether your scores relate to interviews. This is missing data, not a bad result.'
        : `Not enough outcomes to compare score bands yet: ${overall.observed} of ${OVERALL_MINIMUM} observed outcomes overall, and at least two bands need ${BAND_MINIMUM} each (${rated.length} do). Treat anything below as provisional.`,
    };
  }
  const low = rated[0], high = rated.at(-1), diff = high.interviewRate - low.interviewRate;
  const pct = value => `${Math.round(value * 100)}%`;
  const base = `Among your ${overall.observed} observed outcomes, ${high.label} reached interviews ${pct(high.interviewRate)} of the time and ${low.label} ${pct(low.interviewRate)}.`;
  if (diff >= 0.1) return { status: 'higher-scores-more-interviews', comparedBands: [low.key, high.key], statement: `${base} Higher scores went with more interviews. This is a correlation in your own outcomes, not proof.` };
  if (diff <= -0.1) return { status: 'higher-scores-fewer-interviews', comparedBands: [low.key, high.key], statement: `${base} Higher scores did not go with more interviews: this is negative evidence worth reviewing.` };
  return { status: 'no-clear-difference', comparedBands: [low.key, high.key], statement: `${base} The bands differ by less than 10 points, so the score does not separate them clearly yet.` };
}

/** Score bands against applied, interview, offer, rejected, pending and silent. */
export function summarize(records, { silenceDays = SILENCE_DAYS, asOf, trackerAnalysis } = {}) {
  const scored = records.filter(r => r.score !== null);
  // score-calibration supplies the overall sufficiency gate and warning. It reads
  // current status, so each record is given the status its observed outcome implies.
  const calibration = calibrate({ jobs: scored.map(r => ({ id: r.key, company: r.company, title: r.title, evaluation: { score: r.score },
    status: !r.applied ? (r.status || 'Evaluated') : r.offer ? 'Offer' : r.reachedInterview ? 'Interview' : r.rejected ? 'Rejected' : 'Applied', submittedAt: r.applied ? (r.appliedAt || 'unknown') : undefined })) }, { minimum: OVERALL_MINIMUM });
  const overallCounts = counts(scored);
  const bands = BANDS.map(band => bandRow(band, scored.filter(r => bandOf(r.score) === band), calibration.sufficientData)).reverse();
  const overall = {
    ...overallCounts,
    insufficientData: !calibration.sufficientData,
    minimum: OVERALL_MINIMUM,
    interviewRate: overallCounts.observed >= BAND_MINIMUM ? rate(overallCounts.interviews, overallCounts.observed) : null,
    interviewRateIfSilenceIsNo: overallCounts.observed >= BAND_MINIMUM ? rate(overallCounts.interviews, overallCounts.observed + overallCounts.silent) : null,
    warning: calibration.warning,
    unscoredApplications: records.filter(r => r.score === null && r.applied).length,
  };
  return {
    asOf: new Date(asOfTime(asOf)).toISOString(), silenceDays,
    minimums: { band: BAND_MINIMUM, overall: OVERALL_MINIMUM, suggestions: SUGGEST_MINIMUM, positivesPerPattern: POSITIVE_MINIMUM },
    sources: {
      workspaceJobs: records.filter(r => r.source === 'workspace').length,
      legacyTrackerRows: records.filter(r => r.source === 'tracker').length,
      trackerFound: trackerAnalysis ? !trackerAnalysis.warnings?.some(w => w.code === 'missing-tracker') : false,
      trackerRows: trackerAnalysis?.counts?.trackerRows ?? 0,
    },
    empty: records.length === 0,
    overall, bands,
    correlation: correlation([...bands].reverse(), overallCounts, calibration),
    observedVsAssumed: OBSERVED_VS_ASSUMED(silenceDays),
  };
}

function groupMetric(records, overallRate) {
  const c = counts(records);
  const positives = c.interviews;
  const sufficient = c.observed >= SUGGEST_MINIMUM;
  return {
    sample: c.applied, ...c, positives,
    insufficientData: !sufficient,
    interviewRate: sufficient ? rate(c.interviews, c.observed) : null,
    sufficientForRecommendation: sufficient && positives >= POSITIVE_MINIMUM,
    evidence: !c.applied ? 'No applications yet.'
      : !sufficient ? `Insufficient data: ${c.observed} of ${SUGGEST_MINIMUM} observed outcomes. Not evidence for or against.`
      : positives === 0 ? `Negative evidence: ${c.observed} observed outcomes and no interviews${overallRate ? ` (overall ${Math.round(overallRate * 100)}%)` : ''}.`
      : positives < POSITIVE_MINIMUM ? `Only ${positives} interview, below the ${POSITIVE_MINIMUM} needed to treat this as a positive pattern.`
      : `${positives} interviews in ${c.observed} observed outcomes.`,
  };
}

const SOURCE_WARNINGS = {
  'missing-tracker': 'No tracker file (data/applications.md) yet, so only Plainhand applications are counted.',
  'missing-reports': 'Some linked reports are missing or unreadable; their archetype, narrative and channel are unavailable.',
};

/** Archetype, company, narrative, framing, follow-up channel and portal performance. */
export function patterns(records, { trackerAnalysis } = {}) {
  const applied = records.filter(r => r.applied);
  const overall = counts(applied);
  const overallRate = overall.observed >= SUGGEST_MINIMUM ? rate(overall.interviews, overall.observed) : null;
  const dimensions = DIMENSIONS.map(([field, label, kind]) => {
    const groups = new Map();
    for (const record of applied) {
      const value = record.dimensions?.[field];
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(record);
    }
    const rows = [...groups.entries()].map(([value, group]) => ({ value, ...groupMetric(group, overallRate) }))
      .sort((a, b) => b.observed - a.observed || b.sample - a.sample || a.value.localeCompare(b.value));
    const fromReports = applied.some(r => r.reportDimensions && r.dimensions?.[field]) && !['company', 'portal'].includes(field);
    return { field, label, kind, groups: rows.slice(0, 25), more: Math.max(0, rows.length - 25), fromReports,
      available: rows.length > 0,
      limit: rows.length ? null : field === 'company' ? 'No applications yet.' : field === 'portal' ? 'No application links recorded yet.'
        : `No ${label.toLowerCase()} recorded yet. It comes from the machine summary of a linked report.` };
  });
  return {
    applied: overall.applied, observed: overall.observed, assumed: overall.assumed, overallInterviewRate: overallRate,
    minimum: SUGGEST_MINIMUM, positivesNeeded: POSITIVE_MINIMUM, dimensions,
    // Plain wording, and no absolute paths from the underlying module.
    sourceWarnings: (trackerAnalysis?.warnings || []).filter(w => SOURCE_WARNINGS[w.code]).map(w => ({ code: w.code, message: SOURCE_WARNINGS[w.code] })),
    note: 'Each row shows its sample size. Rates appear only from ' + SUGGEST_MINIMUM + ' observed outcomes; below that a row is insufficient data, which is not evidence either way.',
  };
}

const HOW_TO_APPLY = {
  threshold: 'Nothing changes on its own. If you agree, decide case by case which roles to pursue; below 4/5 Plainhand still asks for your reason.',
  target: 'Nothing changes on its own. To act on it, edit your target roles in Profile or your discovery sources yourself.',
  narrative: 'Nothing changes on its own. To act on it, update your story or narrative in Profile yourself.',
  channel: 'Nothing changes on its own. To act on it, choose that channel when you set your next follow-up.',
  portal: 'Nothing changes on its own. To act on it, adjust your discovery sources yourself.',
};

const SNAPSHOT = (rule, subject, evidence, silenceDays) => ({
  analysisSnapshot: { kind: 'plainhand-insights', version: 1, rule, subject, evidence, silenceDays,
    counts: { observedOutcomes: evidence.observed }, calibration: { minimumObservedForRecommendation: SUGGEST_MINIMUM }, warnings: [] },
  sourceBasis: { sources: ['plainhand workspace jobs', 'data/applications.md'], rule, subject },
});

/**
 * Suggestions the data supports now. Returns { status: 'insufficient-data' } when
 * there are too few observed outcomes; otherwise candidate recommendations, each
 * with the ledger inputs (analysisSnapshot, sourceBasis, candidate) and fingerprint.
 */
export function derive(records, { silenceDays = SILENCE_DAYS } = {}) {
  const applied = records.filter(r => r.applied);
  const overall = counts(applied);
  if (overall.observed < SUGGEST_MINIMUM) {
    return { status: 'insufficient-data', observed: overall.observed, minimum: SUGGEST_MINIMUM, candidates: [],
      message: `Not enough outcomes yet: ${overall.observed} of ${SUGGEST_MINIMUM} observed outcomes (interview, offer or rejection). Keep recording outcomes; silent applications do not count.` };
  }
  const out = [];
  const add = (kind, type, subject, message, evidence, confidence) => {
    const candidate = { type, kind, subject, status: 'candidate', requiresApproval: true, confidence, message, evidence, howToApply: HOW_TO_APPLY[kind] };
    const input = { ...SNAPSHOT(type, subject, evidence, silenceDays), candidate };
    out.push({ ...input, fingerprint: recommendationFingerprint(input) });
  };
  const confidenceOf = observed => observed >= SUGGEST_MINIMUM * 3 ? 'high' : observed >= SUGGEST_MINIMUM * 2 ? 'medium' : 'low';

  // Thresholds: interviews observed below the score where Plainhand asks for a reason.
  const lowPositives = applied.filter(r => r.score !== null && r.score < APPLY_THRESHOLD && (r.reachedInterview || r.offer));
  const below = counts(applied.filter(r => r.score !== null && r.score < APPLY_THRESHOLD));
  if (lowPositives.length >= POSITIVE_MINIMUM && below.observed >= SUGGEST_MINIMUM) {
    const floor = Math.min(...lowPositives.map(r => r.score));
    add('threshold', 'observed-positive-floor', 'apply-threshold',
      `${lowPositives.length} of your interviews came from roles scored below ${APPLY_THRESHOLD}/5, as low as ${floor}. Consider looking closer at roles in that range before you skip them.`,
      { observed: below.observed, interviews: below.interviews, floor, threshold: APPLY_THRESHOLD }, confidenceOf(below.observed));
  }
  // Thresholds: a higher band underperforming a lower one (outcome-intelligence rule).
  const scored = applied.filter(r => r.score !== null);
  const bandStats = BANDS.map(band => ({ band, ...counts(scored.filter(r => bandOf(r.score) === band)) })).filter(b => b.observed >= SUGGEST_MINIMUM);
  for (let i = 1; i < bandStats.length; i++) {
    const lowBand = bandStats[i - 1], highBand = bandStats[i];
    const lowRate = rate(lowBand.interviews, lowBand.observed), highRate = rate(highBand.interviews, highBand.observed);
    if (lowRate > highRate + 0.1) add('threshold', 'review-score-calibration', `${lowBand.band.key}|${highBand.band.key}`,
      `Roles scored ${highBand.band.label} reached interviews less often (${Math.round(highRate * 100)}%) than roles scored ${lowBand.band.label} (${Math.round(lowRate * 100)}%). Review what the higher scores reward before relying on them.`,
      { observed: lowBand.observed + highBand.observed, bands: { [lowBand.band.key]: { observed: lowBand.observed, interviews: lowBand.interviews }, [highBand.band.key]: { observed: highBand.observed, interviews: highBand.interviews } } },
      confidenceOf(Math.min(lowBand.observed, highBand.observed) * 2));
  }
  // Targets, narratives, channels and portals from pattern groups.
  const overallRate = rate(overall.interviews, overall.observed);
  for (const dimension of patterns(records).dimensions) {
    for (const group of dimension.groups) {
      if (group.insufficientData) continue;
      const evidence = { observed: group.observed, interviews: group.interviews, overallObserved: overall.observed, overallInterviews: overall.interviews };
      const name = `${dimension.label.toLowerCase()} "${group.value}"`;
      if (group.sufficientForRecommendation && group.interviewRate >= overallRate + 0.15) {
        add(dimension.kind, `favor-${dimension.field}`, `${dimension.field}:${group.value}`,
          `Applications with ${name} reached interviews ${Math.round(group.interviewRate * 100)}% of the time, against ${Math.round(overallRate * 100)}% overall. Consider giving it more weight.`, evidence, confidenceOf(group.observed));
      } else if (group.interviews === 0 && overall.interviews >= POSITIVE_MINIMUM) {
        add(dimension.kind, `review-${dimension.field}`, `${dimension.field}:${group.value}`,
          `${group.observed} applications with ${name} led to no interviews, while ${Math.round(overallRate * 100)}% did overall. Consider whether to change or drop it.`, evidence, confidenceOf(group.observed));
      }
    }
  }
  return out.length
    ? { status: 'suggestions', observed: overall.observed, minimum: SUGGEST_MINIMUM, candidates: out, message: `${out.length} suggestion${out.length === 1 ? '' : 's'} from ${overall.observed} observed outcomes.` }
    : { status: 'no-suggestions', observed: overall.observed, minimum: SUGGEST_MINIMUM, candidates: [], message: `Your ${overall.observed} observed outcomes do not point to a change right now.` };
}

/** Keys of applications with an observed outcome (used for "new since last review"). */
export const observedKeys = records => records.filter(r => r.applied && r.resolved).map(r => r.key);

/** The small legacy subset kept with the review marker, so the briefing can stay pure. */
export const compactLegacy = records => records.filter(r => r.source === 'tracker' && r.applied).map(r => ({
  key: r.key, source: 'tracker', company: r.company, title: r.title, score: r.score, status: r.status, applied: true,
  reachedInterview: r.reachedInterview, offer: r.offer, rejected: r.rejected, responded: r.responded, resolved: r.resolved, result: r.result,
  dimensions: r.dimensions, reportDimensions: r.reportDimensions,
}));
