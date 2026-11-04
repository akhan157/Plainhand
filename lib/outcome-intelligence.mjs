#!/usr/bin/env node
/**
 * Phase 5 — Outcome intelligence.
 *
 * This module is deliberately read-only. It reads a caller-supplied career-ops
 * root, its canonical applications tracker, and linked report machine summaries.
 * It never writes tracker, report, or configuration data.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

export const PHASE = 5;
export const PHASE_6_CAPABILITY = Object.freeze({
  enabled: false,
  status: 'disabled',
  hosted: false,
  ecosystem: false,
  reason: 'Phase 6 ecosystem and hosted surfaces are intentionally disabled by default.',
});

export const DEFAULT_SCORE_BANDS = Object.freeze([
  Object.freeze({ key: '0.0-2.9', label: '0.0–2.9', min: 0, max: 2.9 }),
  Object.freeze({ key: '3.0-3.4', label: '3.0–3.4', min: 3, max: 3.4 }),
  Object.freeze({ key: '3.5-3.9', label: '3.5–3.9', min: 3.5, max: 3.9 }),
  Object.freeze({ key: '4.0-4.4', label: '4.0–4.4', min: 4, max: 4.4 }),
  Object.freeze({ key: '4.5-5.0', label: '4.5–5.0', min: 4.5, max: 5 }),
]);

const DEFAULTS = Object.freeze({
  minimumObservedPerBand: 5,
  minimumObservedForRecommendation: 8,
  minimumPositiveForRecommendation: 2,
  // Silence is an assumption, not an observed rejection. Callers may disable
  // it with null/false or make it stricter for a particular report date.
  assumeSilenceAfterDays: 30,
  asOf: null,
  scoreBands: DEFAULT_SCORE_BANDS,
});

const STATUS_ALIASES = Object.freeze({
  evaluated: 'evaluated', apply: 'apply', applied: 'applied', sent: 'applied',
  responded: 'responded', interview: 'interview', interviewed: 'interview',
  offer: 'offer', offered: 'offer', rejected: 'rejected', rejection: 'rejected',
  discarded: 'discarded', skip: 'skip', skipped: 'skip',
  evaluada: 'evaluated', condicional: 'evaluated', hold: 'evaluated',
  aplicado: 'applied', aplicada: 'applied', enviada: 'applied',
  respondido: 'responded', entrevista: 'interview', oferta: 'offer',
  rechazado: 'rejected', rechazada: 'rejected', descartado: 'discarded',
  descartada: 'discarded', cerrada: 'discarded', cancelada: 'discarded',
  'no aplicar': 'skip', no_aplicar: 'skip', monitor: 'skip',
});

const OUTCOME_ALIASES = Object.freeze({
  offer: 'offer', offered: 'offer', hired: 'offer', accepted: 'offer',
  interview: 'interview', interviewed: 'interview',
  rejection: 'rejection', rejected: 'rejection', decline: 'rejection', declined: 'rejection',
  silence: 'silence', silent: 'silence', no_response: 'silence',
  'no response': 'silence', ghosted: 'silence', ghost: 'silence',
  responded: 'response', response: 'response', recruiter_response: 'response',
  pending: 'pending', applied: 'pending', evaluated: 'pending',
});

const OUTCOME_KEYS = Object.freeze(['offer', 'interview', 'rejection', 'silence', 'response', 'pending']);
const EXCLUDED_STATUSES = new Set(['discarded', 'skip']);
const POSITIVE_OUTCOMES = new Set(['offer', 'interview']);

function asText(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeStatus(value) {
  const clean = asText(value).replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim().toLowerCase();
  return STATUS_ALIASES[clean] || clean;
}

function normalizeOutcome(value) {
  const clean = asText(value).replace(/\*\*/g, '').trim().toLowerCase().replace(/[ -]+/g, '_');
  return OUTCOME_ALIASES[clean] || null;
}

function parseScore(value) {
  const match = asText(value).replace(/\*\*/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const score = Number(match[1]);
  return Number.isFinite(score) && score >= 0 && score <= 5 ? score : null;
}

function parseDate(value) {
  const text = asText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeBand(value, index) {
  const min = Number(value?.min);
  const max = Number(value?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new TypeError(`Invalid score band at index ${index}`);
  }
  return {
    key: asText(value.key) || `${min}-${max}`,
    label: asText(value.label) || `${min}–${max}`,
    min,
    max,
  };
}

// A score belongs to the highest band whose minimum it reaches, so values between
// one band's max and the next band's min (3.45, 4.45) are never dropped.
function scoreBand(score, bands) {
  if (!Number.isFinite(score) || !bands.length) return null;
  const top = Math.max(...bands.map((band) => band.max));
  if (score > top) return null;
  return bands.filter((band) => score >= band.min).sort((a, b) => b.min - a.min)[0] || null;
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((part) => part.trim());
}

/** Parse canonical applications.md rows without changing the source text. */
export function parseTrackerRows(content) {
  const rows = [];
  if (typeof content !== 'string') return rows;
  for (const [lineNumber, line] of content.split(/\r?\n/).entries()) {
    const parts = splitMarkdownRow(line);
    if (parts.length < 8 || /^[-:]+$/.test(parts[0])) continue;
    const num = Number.parseInt(parts[0], 10);
    if (!Number.isInteger(num)) continue;
    rows.push({
      num,
      date: parts[1] || null,
      company: parts[2] || '',
      role: parts[3] || '',
      scoreText: parts[4] || '',
      score: parseScore(parts[4]),
      status: parts[5] || '',
      normalizedStatus: normalizeStatus(parts[5]),
      pdf: parts[6] || '',
      reportLink: parts[7] || '',
      notes: parts.slice(8).join(' | '),
      source: { kind: 'tracker', line: lineNumber + 1 },
    });
  }
  return rows;
}

function machineSummaryObject(content) {
  if (typeof content !== 'string') return null;
  const fence = content.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  const raw = fence ? fence[1].trim() : content.trim();
  if (!raw) return null;
  try {
    const parsed = parseYaml(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse the optional structured machine summary embedded in a report. */
export function parseMachineSummary(content) {
  const parsed = machineSummaryObject(content);
  if (!parsed) return null;
  const dimensions = parsed.dimensions && typeof parsed.dimensions === 'object' && !Array.isArray(parsed.dimensions)
    ? parsed.dimensions
    : {};
  return { ...parsed, ...dimensions };
}

function reportPathsFromLink(root, trackerPath, reportLink) {
  const match = asText(reportLink).match(/\]\(([^)]+)\)/);
  const link = match ? match[1].split('#', 1)[0] : '';
  if (!link || /^https?:\/\//i.test(link)) return [];
  const rootResolved = resolve(root);
  const candidates = link.startsWith('reports/')
    ? [resolve(rootResolved, link), resolve(dirname(trackerPath), link)]
    : [resolve(dirname(trackerPath), link), resolve(rootResolved, link)];
  return [...new Set(candidates)].filter((candidate) => {
    const rel = relative(rootResolved, candidate);
    return !(rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel));
  });
}

function reportPathFromLink(root, trackerPath, reportLink) {
  return reportPathsFromLink(root, trackerPath, reportLink).find((candidate) => existsSync(candidate))
    || reportPathsFromLink(root, trackerPath, reportLink)[0]
    || null;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function reportDimensions(summary) {
  if (!summary) return {};
  const aliases = {
    archetype: ['archetype', 'archetype_name'],
    company: ['company', 'company_name'],
    narrative: ['narrative', 'narrative_variant', 'narrative_angle'],
    resumeFraming: ['resume_framing', 'resumeFraming', 'resume_variant', 'cv_framing'],
    followUpChannel: ['follow_up_channel', 'followup_channel', 'followUpChannel', 'channel'],
    portal: ['portal', 'portal_name', 'portal_configuration', 'portal_config'],
  };
  return Object.fromEntries(Object.entries(aliases)
    .map(([name, keys]) => [name, asText(firstValue(summary, keys)) || null])
    .filter(([, value]) => value));
}

function explicitSummaryOutcome(summary) {
  return normalizeOutcome(firstValue(summary, [
    'outcome', 'outcome_status', 'application_outcome', 'result', 'observed_outcome',
  ]));
}

function readReport(root, trackerPath, row) {
  const paths = reportPathsFromLink(root, trackerPath, row.reportLink);
  const path = paths.find((candidate) => existsSync(candidate)) || paths[0] || null;
  if (!path) return { path: null, summary: null, missing: false };
  try {
    const content = readFileSync(path, 'utf8');
    return { path, summary: parseMachineSummary(content), missing: false };
  } catch {
    return { path, summary: null, missing: true };
  }
}

function confidenceFor(count, minimum) {
  if (count >= minimum * 3) return 'high';
  if (count >= minimum) return 'medium';
  return 'low';
}

function emptyOutcomeCounts() {
  return Object.fromEntries(OUTCOME_KEYS.map((key) => [key, 0]));
}
function evidenceMetrics(records, minimum) {
  const observed = records.filter((record) => record.evidence === 'observed').length;
  const assumed = records.filter((record) => record.evidence === 'assumed').length;
  const pending = records.filter((record) => record.outcome === 'pending').length;
  const outcomes = emptyOutcomeCounts();
  for (const record of records) {
    if (Object.hasOwn(outcomes, record.outcome)) outcomes[record.outcome] += 1;
  }
  const evidenceCount = observed + assumed;
  const progressed = outcomes.offer + outcomes.interview;
  return {
    total: records.length,
    observed,
    assumed,
    evidenceCount,
    pending,
    outcomes,
    interviewRate: evidenceCount ? round(outcomes.interview / evidenceCount) : null,
    offerRate: evidenceCount ? round(outcomes.offer / evidenceCount) : null,
    progressionRate: evidenceCount ? round(progressed / evidenceCount) : null,
    observedProgressionRate: observed ? round(records.filter((r) => r.evidence === 'observed' && POSITIVE_OUTCOMES.has(r.outcome)).length / observed) : null,
    confidence: confidenceFor(observed, minimum),
  };
}

function metricForGroup(records, minimum, minimumPositive) {
  const metric = evidenceMetrics(records, minimum);
  const positiveObserved = records.filter((r) => r.evidence === 'observed' && POSITIVE_OUTCOMES.has(r.outcome)).length;
  return {
    ...metric,
    positiveObserved,
    sufficientForRecommendation: metric.observed >= minimum && positiveObserved >= minimumPositive,
  };
}

function groupMetrics(records, field, options) {
  const groups = new Map();
  for (const record of records) {
    const value = field === 'company' ? record.company : record.dimensions?.[field];
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return Object.fromEntries([...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([value, group]) => [value, metricForGroup(group, options.minimumObservedForRecommendation, options.minimumPositiveForRecommendation)]));
}

function calibrationRecommendations(bands, options) {
  const observedBands = bands.filter((band) => band.observed >= options.minimumObservedForRecommendation);
  const recommendations = [];
  if (observedBands.length < 2) {
    recommendations.push({
      type: 'insufficient-data',
      status: 'insufficient-data',
      confidence: 'low',
      requiresApproval: true,
      message: `At least two score bands need ${options.minimumObservedForRecommendation} observed outcomes before calibrating thresholds.`,
    });
    return recommendations;
  }

  const ordered = [...observedBands].sort((a, b) => a.min - b.min);
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1];
    const higher = ordered[index];
    if (lower.observedProgressionRate !== null && higher.observedProgressionRate !== null
      && lower.observedProgressionRate > higher.observedProgressionRate + 0.1) {
      recommendations.push({
        type: 'review-score-calibration',
        status: 'candidate',
        direction: 'higher-score-underperforming',
        bands: [lower.key, higher.key],
        confidence: higher.confidence === 'high' && lower.confidence === 'high' ? 'high' : 'medium',
        requiresApproval: true,
        message: `${higher.label} has a lower observed progression rate than ${lower.label}; review score inflation or missing context before changing thresholds.`,
      });
    }
  }

  const positiveScores = ordered.flatMap((band) => band.records
    .filter((record) => record.evidence === 'observed' && POSITIVE_OUTCOMES.has(record.outcome))
    .map((record) => record.score));
  if (positiveScores.length >= options.minimumPositiveForRecommendation) {
    const floor = Math.min(...positiveScores);
    recommendations.push({
      type: 'observed-positive-floor',
      status: 'candidate',
      score: floor,
      confidence: positiveScores.length >= options.minimumObservedForRecommendation ? 'medium' : 'low',
      requiresApproval: true,
      message: `Observed interviews/offers include scores as low as ${floor}; do not raise the apply threshold above this without more evidence.`,
    });
  }
  return recommendations;
}

function resolveOptions(options = {}) {
  const merged = { ...DEFAULTS, ...options };
  merged.minimumObservedPerBand = Math.max(1, Number(merged.minimumObservedPerBand) || DEFAULTS.minimumObservedPerBand);
  merged.minimumObservedForRecommendation = Math.max(1, Number(merged.minimumObservedForRecommendation) || DEFAULTS.minimumObservedForRecommendation);
  merged.minimumPositiveForRecommendation = Math.max(1, Number(merged.minimumPositiveForRecommendation) || DEFAULTS.minimumPositiveForRecommendation);
  if (merged.assumeSilenceAfterDays !== null && merged.assumeSilenceAfterDays !== false) {
    merged.assumeSilenceAfterDays = Math.max(1, Number(merged.assumeSilenceAfterDays) || DEFAULTS.assumeSilenceAfterDays);
  }
  merged.scoreBands = (merged.scoreBands || DEFAULT_SCORE_BANDS).map(normalizeBand);
  return merged;
}

function locateTracker(root, options) {
  if (options.trackerPath) return resolve(root, options.trackerPath);
  const candidates = [resolve(root, 'data/applications.md'), resolve(root, 'applications.md')];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function makeRecord(root, trackerPath, row, options) {
  const report = readReport(root, trackerPath, row);
  const summary = report.summary;
  const summaryScore = parseScore(firstValue(summary, ['score', 'global_score']));
  const score = row.score ?? summaryScore;
  const status = row.normalizedStatus;
  let outcome = null;
  let evidence = 'none';
  let outcomeSource = 'none';
  const summaryOutcome = explicitSummaryOutcome(summary);
  if (summaryOutcome && !['pending', 'response'].includes(summaryOutcome)) {
    outcome = summaryOutcome;
    evidence = 'observed';
    outcomeSource = 'report';
  } else if (status === 'offer') {
    outcome = 'offer'; evidence = 'observed'; outcomeSource = 'tracker';
  } else if (status === 'interview') {
    outcome = 'interview'; evidence = 'observed'; outcomeSource = 'tracker';
  } else if (status === 'rejected') {
    outcome = 'rejection'; evidence = 'observed'; outcomeSource = 'tracker';
  } else if (summaryOutcome === 'response' || status === 'responded') {
    outcome = 'response'; evidence = 'observed'; outcomeSource = summaryOutcome ? 'report' : 'tracker';
  }

  const date = parseDate(row.date);
  const asOf = options.asOf ? parseDate(options.asOf) || new Date(options.asOf) : new Date();
  const ageDays = date && !Number.isNaN(asOf.getTime()) ? Math.floor((asOf - date) / 86400000) : null;
  if (!outcome && options.assumeSilenceAfterDays !== null && options.assumeSilenceAfterDays !== false
    && status === 'applied' && ageDays !== null && ageDays >= options.assumeSilenceAfterDays) {
    outcome = 'silence'; evidence = 'assumed'; outcomeSource = 'silence-age-assumption';
  }
  if (!outcome) {
    // Evaluated or Apply (intent) rows were never submitted: they are not pending applications.
    outcome = EXCLUDED_STATUSES.has(status) ? 'excluded' : ['evaluated', 'apply'].includes(status) ? 'not-applied' : 'pending';
  }

  return {
    ...row,
    score,
    normalizedStatus: status,
    outcome,
    evidence,
    outcomeSource,
    ageDays,
    reportPath: report.path,
    reportFound: Boolean(report.path && !report.missing),
    machineSummary: summary,
    dimensions: reportDimensions(summary),
  };
}

/** Return the read-only capability surface for Phase 5 consumers. */
export function getCapabilityReport() {
  return {
    phase: PHASE,
    outcomeIntelligence: true,
    readOnly: true,
    hosted: false,
    ecosystem: false,
    phase6: { ...PHASE_6_CAPABILITY },
  };
}

/**
 * Analyze tracker outcomes from an explicit root. No implicit cwd or process
 * environment is consulted, and no input file is mutated.
 */
export function analyzeOutcomes(root, options = {}) {
  if (!root || typeof root !== 'string') throw new TypeError('analyzeOutcomes requires an explicit root path');
  const rootPath = resolve(root);
  const resolved = resolveOptions(options);
  const trackerPath = locateTracker(rootPath, resolved);
  const trackerExists = existsSync(trackerPath);
  const rows = trackerExists ? parseTrackerRows(readFileSync(trackerPath, 'utf8')) : [];
  const records = rows.map((row) => makeRecord(rootPath, trackerPath, row, resolved));
  const scored = records.filter((record) => Number.isFinite(record.score));
  const eligible = scored.filter((record) => !['excluded', 'not-applied'].includes(record.outcome));
  const excluded = scored.filter((record) => record.outcome === 'excluded');
  const bands = resolved.scoreBands.map((band) => {
    const bandRecords = eligible.filter((record) => scoreBand(record.score, resolved.scoreBands) === band);
    const metric = metricForGroup(bandRecords, resolved.minimumObservedPerBand, resolved.minimumPositiveForRecommendation);
    const { records: _records, ...publicMetric } = metric;
    return { ...band, ...publicMetric, records: bandRecords };
  });
  const publicBands = bands.map(({ records: _records, ...band }) => band);
  const observed = records.filter((record) => record.evidence === 'observed' && !['excluded', 'not-applied'].includes(record.outcome));
  const assumed = records.filter((record) => record.evidence === 'assumed' && !['excluded', 'not-applied'].includes(record.outcome));
  const missingReports = records.filter((record) => record.reportPath && !record.reportFound).map((record) => record.num);
  const excludedMetrics = evidenceMetrics(excluded, resolved.minimumObservedPerBand);
  const overall = metricForGroup(eligible, resolved.minimumObservedPerBand, resolved.minimumPositiveForRecommendation);
  const calibration = {
    bands: publicBands,
    recommendations: calibrationRecommendations(bands, resolved),
    minimumObservedPerBand: resolved.minimumObservedPerBand,
    minimumObservedForRecommendation: resolved.minimumObservedForRecommendation,
    approvalRequired: true,
  };
  const dimensions = {};
  for (const field of ['archetype', 'company', 'narrative', 'resumeFraming', 'followUpChannel', 'portal']) {
    dimensions[field] = groupMetrics(eligible, field, resolved);
  }
  const warnings = [];
  if (!trackerExists) warnings.push({ code: 'missing-tracker', severity: 'error', message: `No applications tracker found under explicit root ${rootPath}.` });
  if (rows.length === 0) warnings.push({ code: 'no-tracker-rows', severity: 'warning', message: 'No canonical tracker rows were found.' });
  if (scored.length === 0) warnings.push({ code: 'no-scored-rows', severity: 'warning', message: 'No usable scores are available; score-band metrics cannot be calibrated.' });
  if (observed.length < resolved.minimumObservedForRecommendation) {
    warnings.push({ code: 'insufficient-observed-outcomes', severity: 'warning', observed: observed.length, minimum: resolved.minimumObservedForRecommendation, message: 'Observed outcomes are insufficient for confident calibration recommendations.' });
  }
  if (assumed.length > 0) {
    warnings.push({ code: 'assumed-silence', severity: 'info', count: assumed.length, message: 'Silence is inferred from elapsed time and is not treated as observed rejection evidence.' });
  }
  for (const band of publicBands) {
    if (band.observed < resolved.minimumObservedPerBand && band.total > 0) {
      warnings.push({ code: 'insufficient-band-data', severity: 'warning', band: band.key, observed: band.observed, minimum: resolved.minimumObservedPerBand, message: `${band.label} has insufficient observed outcomes for calibration.` });
    }
  }
  if (missingReports.length > 0) warnings.push({ code: 'missing-reports', severity: 'info', rows: missingReports, message: 'Linked reports were missing or unreadable; tracker fields remain observed, report dimensions are unavailable.' });

  return {
    phase: PHASE,
    root: rootPath,
    trackerPath,
    readOnly: true,
    capability: getCapabilityReport(),
    counts: {
      trackerRows: rows.length,
      scoredRows: scored.length,
      eligibleRows: eligible.length,
      excludedRows: excluded.length,
      observedOutcomes: observed.length,
      assumedOutcomes: assumed.length,
      pendingRows: eligible.filter((record) => record.outcome === 'pending').length,
    },
    overall,
    scoreBands: publicBands,
    calibration,
    dimensions,
    excluded: excludedMetrics,
    evidence: {
      observed: observed.map((record) => record.num),
      assumed: assumed.map((record) => record.num),
      pending: eligible.filter((record) => record.outcome === 'pending').map((record) => record.num),
      distinction: 'Observed outcomes come from tracker statuses or explicit report outcomes; assumed outcomes currently mean elapsed-time silence only.',
    },
    records,
    warnings,
  };
}

export const analyze = analyzeOutcomes;
export const capabilityReport = getCapabilityReport;
export default analyzeOutcomes;

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node outcome-intelligence.mjs <explicit-career-ops-root>');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(analyzeOutcomes(root), null, 2));
  }
}
