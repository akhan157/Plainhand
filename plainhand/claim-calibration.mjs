// Claim calibration: is each application claim as strong as the candidate's evidence,
// no stronger and no weaker? Every resume entry, answer and cover-letter claim is rated
//   undersold   - says less than the evidence supports (drops a result, number or ownership)
//   balanced    - same strength as the evidence; reframing and emphasis are fine
//   stretched   - stronger verb, scope, level or number than the evidence
//   unsupported - nothing in the sources backs it
// Ratings come from the reviewer model when it gives them, checked against rule-based
// signals that can't be argued with (a number no source contains, "led" from "helped").
// The candidate's line (claim-line.mjs) then marks stretches they chose to keep.
import { applyLine, calibrationFor, KINDS } from './claim-line.mjs';

export const RATINGS = ['undersold', 'balanced', 'stretched', 'unsupported'];
const SEVERITY = { undersold: -1, balanced: 0, stretched: 1, unsupported: 2 };

// Ownership verbs by strength; a claim may reword within a tier but not climb one.
const VERB_TIERS = [
  ['assisted', 'helped', 'supported', 'contributed', 'participated', 'shadowed', 'observed', 'learned'],
  ['built', 'wrote', 'designed', 'redesigned', 'developed', 'ran', 'tested', 'created', 'implemented', 'analyzed', 'coordinated', 'organized', 'presented', 'fixed', 'machined', 'held'],
  ['led', 'owned', 'managed', 'directed', 'headed', 'spearheaded', 'drove', 'oversaw', 'architected', 'founded', 'supervised'],
];
const LEVEL_TIERS = [
  ['learning', 'familiar', 'exposure', 'basic', 'introductory', 'beginner', 'coursework'],
  ['comfortable', 'proficient', 'experienced', 'skilled'],
  ['expert', 'advanced', 'mastery', 'extensive', 'authority'],
];

const lower = text => String(text || '').toLowerCase();
const tierOf = (text, tiers) => {
  const words = new Set(lower(text).match(/[a-z]+/g) || []);
  let tier = -1;
  tiers.forEach((list, i) => { if (list.some(w => words.has(w))) tier = i; });
  return tier;
};
// Numbers as written ("18%", "$2,000", "40", "7075"), normalized; years are dates, not results.
export function numbersIn(text) {
  return [...new Set((String(text || '').match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || []).map(n => n.replace(/[$,]/g, '')).filter(Boolean))];
}
const isYear = n => /^(19|20)\d\d$/.test(n);
// "about 20%", "nearly $2,000", "~40": rounding the reader is told about.
const HEDGE = /(?:about|around|approximately|approx\.?|roughly|nearly|almost|close to|~)\s*\$?\s*$/i;
function roundingContext(text, normalized) {
  const raw = (String(text).match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || []).find(m => m.replace(/[$,]/g, '') === normalized);
  const at = raw ? String(text).indexOf(raw) : -1;
  return at < 0 ? '' : String(text).slice(Math.max(0, at - 20), at);
}

// Stock phrasing hiring managers name as a sign of generic, AI-written applications.
export const GENERIC_PHRASES = ['results-driven', 'results-oriented', 'proven track record', 'track record of success', 'passionate about', 'team player', 'detail-oriented', 'self-starter', 'go-getter', 'synergy', 'dynamic', 'spearheaded', 'leveraged', 'hard-working', 'hardworking', 'think outside the box', 'fast-paced environment', 'best-in-class', 'cutting-edge', 'excellent communication skills', 'strong work ethic', 'i am writing to express my interest', 'thrilled to', 'delve', 'tapestry', 'wealth of experience', 'unique blend', 'seamlessly'];
export function genericPhrases(text) {
  const lowerText = String(text || '').toLowerCase();
  return GENERIC_PHRASES.filter(p => new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lowerText));
}

// Rule-based signals for one claim against its own evidence quotes and all source text.
export function claimSignals(text, quotes, sourceText) {
  const evidence = quotes.join('\n');
  const signals = [];
  const sourceNumbers = new Set(numbersIn(sourceText));
  // A number near one in the claim's own evidence is rounding (stretched); otherwise invented.
  const evidenceNumbers = numbersIn(quotes.join('\n')).map(parseFloat).filter(Number.isFinite);
  for (const n of numbersIn(text)) {
    if (sourceNumbers.has(n)) continue;
    const value = parseFloat(n), near = evidenceNumbers.find(e => e && Math.abs(value - e) / e <= 0.25);
    const stated = near !== undefined && HEDGE.test(roundingContext(text, n));
    signals.push(stated ? { rating: 'stretched', code: 'number-rounded-stated', detail: `${n} is stated as rounding the evidence's ${near}` } : near !== undefined ? { rating: 'stretched', code: 'number-rounded', detail: `${n} rounds the evidence's ${near} without saying so` } : { rating: 'unsupported', code: 'number-not-in-sources', detail: `${n} is not in any source` });
  }
  if (quotes.length) {
    const claimNumbers = new Set(numbersIn(text));
    const dropped = numbersIn(evidence).filter(n => !isYear(n) && !claimNumbers.has(n));
    if (dropped.length && !claimNumbers.size) signals.push({ rating: 'undersold', code: 'result-dropped', detail: `the evidence gives ${dropped.join(', ')}; the claim leaves it out` });
    const verbClaim = tierOf(text, VERB_TIERS), verbEvidence = tierOf(evidence, VERB_TIERS);
    if (verbClaim > verbEvidence && verbEvidence >= 0) signals.push({ rating: 'stretched', code: 'ownership-raised', detail: `"${VERB_TIERS[verbClaim].find(w => lower(text).match(new RegExp(`\\b${w}\\b`)))}" is stronger than the evidence` });
    if (verbClaim >= 0 && verbClaim < verbEvidence) signals.push({ rating: 'undersold', code: 'ownership-lowered', detail: 'the evidence shows more ownership than the claim' });
    const levelClaim = tierOf(text, LEVEL_TIERS), levelEvidence = tierOf(evidence, LEVEL_TIERS);
    if (levelClaim > levelEvidence && levelEvidence >= 0) signals.push({ rating: 'stretched', code: 'level-raised', detail: 'claims a higher skill level than the evidence' });
  }
  return signals;
}

const claimsOf = packet => [
  ...(packet.resume || []).map((item, i) => ({ id: `resume:${i}`, part: 'resume', label: item.section || 'Resume', text: item.text, quotes: (item.evidence || []).map(e => e.quote) })),
  ...(packet.answers || []).map((item, i) => ({ id: `answer:${i}`, part: 'answer', label: item.question || 'Answer', text: item.answer, quotes: (item.evidence || []).map(e => e.quote) })),
];

// The reviewer's ratings are matched to claims by id ("resume:0", "answer:2") or exact text;
// cover-letter ratings arrive as their own claims.
export function gradePacket(packet, sources, modelRatings = [], line = null) {
  const sourceText = sources.map(s => s.text).join('\n');
  const clip = value => typeof value === 'string' ? value.slice(0, 1000) : '';
  const rated = Array.isArray(modelRatings) ? modelRatings.slice(0, 200).filter(r => r && RATINGS.includes(r.rating)).map(r => ({ id: clip(r.id), claim: clip(r.claim), rating: r.rating, kind: KINDS.includes(r.kind) ? r.kind : 'other', reason: clip(r.reason), suggestion: clip(r.suggestion) })) : [];
  const claims = claimsOf(packet);
  const fromModel = claim => rated.find(r => r.id === claim.id) || rated.find(r => typeof r.claim === 'string' && r.claim.trim() === String(claim.text).trim());
  for (const r of rated) if (/^cover/i.test(String(r.id || '')) && typeof r.claim === 'string' && lower(packet.coverLetter).includes(lower(r.claim).trim()))
    claims.push({ id: `cover:${claims.filter(c => c.part === 'cover').length}`, part: 'cover', label: 'Cover letter', text: r.claim, quotes: [] });
  // Numbers in the cover letter are checked even when the reviewer rates nothing there.
  for (const n of numbersIn(packet.coverLetter)) if (!numbersIn(sourceText).includes(n) && !claims.some(c => c.part === 'cover' && numbersIn(c.text).includes(n)))
    claims.push({ id: `cover:${claims.filter(c => c.part === 'cover').length}`, part: 'cover', label: 'Cover letter', text: sentenceWith(packet.coverLetter, n), quotes: [] });

  const results = claims.map(claim => {
    const model = fromModel(claim);
    const signals = claimSignals(claim.text, claim.quotes, sourceText);
    // Inflation signals always count. Undersell signals count only without a model rating:
    // a skills list or a short answer may rightly leave a number out, which takes judgment.
    const candidates = [model?.rating || 'balanced', ...signals.filter(s => s.rating !== 'undersold' || !model).map(s => s.rating)];
    // The most inflated rating wins; undersold only stands when nothing points the other way.
    const worst = candidates.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'balanced');
    let rating = worst !== 'balanced' ? worst : candidates.includes('undersold') ? 'undersold' : 'balanced';
    // Titles, employers, dates, degrees and level are checked by employers: no stretch.
    const verifiable = rating === 'stretched' && model?.kind === 'verifiable' && !signals.some(s => s.rating === 'stretched');
    if (verifiable) rating = 'unsupported';
    return { id: claim.id, part: claim.part, kind: model?.kind || 'other', label: claim.label, text: claim.text, rating, generic: genericPhrases(claim.text), reason: verifiable ? `Titles, employers, dates and degrees must be exact. ${String(model.reason || '')}`.trim() : model?.rating === rating ? String(model.reason || '') : (signals.find(s => s.rating === rating)?.detail || String(model?.reason || '')),
      suggestion: model?.rating === rating && typeof model.suggestion === 'string' ? model.suggestion : '', signals: signals.map(s => s.code), source: model ? (signals.length ? 'model+rules' : 'model') : 'rules' };
  });
  return applyLine({ claims: results, modelRated: rated.length > 0, letterGeneric: genericPhrases(packet.coverLetter) }, line, summarize);
}

export function currentCalibration(state, job) {
  return calibrationFor(state, job, summarize);
}

function sentenceWith(text, number) {
  return (String(text).match(/[^.!?]+[.!?]?/g) || [String(text)]).find(s => numbersIn(s).includes(number))?.trim() || number;
}

// The band counts only claims outside the candidate's line; unsupported always counts.
export function summarize(results) {
  const count = rating => results.filter(r => r.rating === rating).length;
  const outside = rating => results.filter(r => r.rating === rating && !r.withinLine).length;
  const counts = { ...Object.fromEntries(RATINGS.map(r => [r, count(r)])), withinLine: results.filter(r => r.withinLine).length, generic: results.filter(r => r.generic?.length).length };
  const total = results.length || 1;
  const inflated = counts.unsupported > 0 || (outside('stretched') / total) >= 0.15;
  const modest = (outside('undersold') / total) >= 0.3;
  const band = inflated && modest ? 'mixed' : inflated ? 'inflated' : modest ? 'undersold' : 'balanced';
  return { counts, total: results.length, balancedShare: results.length ? Math.round(counts.balanced / results.length * 100) / 100 : null, band };
}
