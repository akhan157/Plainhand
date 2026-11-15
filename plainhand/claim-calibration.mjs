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
// Each occurrence is kept with its position, because whose number it is depends on
// where it sits, not only on its value.
export function numberOccurrences(text) {
  return [...String(text || '').matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)]
    .map(match => ({ raw: match[0], value: match[0].replace(/[$,]/g, ''), index: match.index }))
    .filter(occurrence => occurrence.value);
}
export function numbersIn(text) {
  return [...new Set(numberOccurrences(text).map(occurrence => occurrence.value))];
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

// Whose number is it? A posting number may be repeated only where the employer is
// that number's subject: "your 28-bed unit", "the position's 12-hour shifts",
// "your company operates in 28 countries". A number in an explicit application-
// intent sentence is about the role too ("I am applying to lead your 25
// engineers"). Anywhere else it is the candidate's claim, even with no "I" in
// front of it: "Led your 25 engineers", "Managed your team of 25", "My experience
// includes leading your 25 engineers", "We currently manage your team of 25".
const EMPLOYER_NOUN = '(?:your|yours|the (?:role|position|posting|job|team|unit|department|store|program|programme|organization|organisation|company))';
const EMPLOYER_REF = new RegExp(`\\b${EMPLOYER_NOUN}(?:['\u2019]s)?\\b`, 'gi');
const EMPLOYER_START = new RegExp(`^\\s*(?:(?:at|for|in|with|across|inside|within|joining)\\s+)?${EMPLOYER_NOUN}\\b`, 'i');
const INTENT = /\b(?:applying|application for|writing to apply|hope to|hoping to|excited to|would like to|would love to|want to|keen to|eager to|interested in|looking to)\b/gi;
const CANDIDATE_SUBJECT = /\b(?:i|we|my|our|me)\b/i;
// Past and present accomplishment verbs. A present-tense role verb after "applying
// to" is stripped below, so "I am applying to lead your 25 engineers" stays a role
// fact while "We currently manage your team of 25" does not.
const CLAIM_VERB = /\b(?:led|lead|leads|leading|manag(?:e|es|ed|ing)|build|builds|built|building|ran|run|runs|running|own|owns|owned|owning|direct|directs|directed|directing|head|heads|headed|heading|design|designs|designed|designing|develop|develops|developed|developing|increase|increases|increased|increasing|reduce|reduces|reduced|reducing|cut|cuts|cutting|grow|grows|grew|growing|save|saves|saved|saving|deliver|delivers|delivered|delivering|achiev(?:e|es|ed|ing)|driv(?:e|es|ing)|drove|driven|oversee|oversees|oversaw|overseen|overseeing|supervis(?:e|es|ed|ing)|found|founded|founding|launch(?:es|ed|ing)?|negoti(?:ate|ates|ated|ating)|train(?:s|ed|ing)?|hir(?:e|es|ed|ing)|mentor(?:s|ed|ing)?|coordinat(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|implement(?:s|ed|ing)?|analy(?:ze|zes|zed|zing|se|ses|sed|sing)|test(?:s|ed|ing)?|maintain(?:s|ed|ing)?|support(?:s|ed|ing)?)\b/i;
const MEASURE = /\b(?:by|from)\s*$/i;
// A clause boundary is sentence punctuation, a newline, or a comma that is not
// inside a number ("2,000").
const CLAUSE_BOUNDARY = /(?<!\d)[.;!?,\n](?!\d)/g;
function clauseBefore(text, index) {
  let start = 0;
  for (const match of text.matchAll(CLAUSE_BOUNDARY)) { if (match.index < index) start = match.index + 1; else break; }
  return text.slice(start, index);
}
function lastEmployerRef(tail) {
  let last = null;
  for (const match of tail.matchAll(EMPLOYER_REF)) last = match;
  return last;
}
// The employer starts the clause and no candidate subject or accomplishment governs it.
function employerFactFrame(tail) {
  return EMPLOYER_START.test(tail) && !CANDIDATE_SUBJECT.test(tail) && !CLAIM_VERB.test(tail);
}
// An application-intent frame: the role verb after the intent is not a claim about
// the candidate's history.
function intentFrame(tail) {
  const intents = [...tail.matchAll(INTENT)];
  const match = intents.at(-1);
  if (!match) return false;
  let rest = tail.slice(match.index + match[0].length);
  rest = /\bto\s*$/i.test(match[0]) ? rest.replace(/^\s+[A-Za-z][A-Za-z'\u2019-]*\b/, '') : rest.replace(/^\s+to\s+[A-Za-z][A-Za-z'\u2019-]*\b/i, '');
  return !CANDIDATE_SUBJECT.test(rest) && !CLAIM_VERB.test(rest) && !MEASURE.test(rest);
}
function employerAttributed(text, occurrence, postingNumbers) {
  if (!postingNumbers.has(occurrence.value)) return false;
  const tail = clauseBefore(text, occurrence.index);
  const ref = lastEmployerRef(tail);
  if (!ref) return false;
  const between = tail.slice(ref.index + ref[0].length);
  if ((between.match(/[A-Za-z0-9'\u2019.-]+/g) || []).length > 3) return false;
  return employerFactFrame(tail) || intentFrame(tail);
}

// Rule-based signals for one claim against its own evidence quotes and all source text.
export function claimSignals(text, quotes, sourceText, jobText = '') {
  const evidence = quotes.join('\n');
  const signals = [];
  const sourceNumbers = new Set(numbersIn(sourceText));
  const postingNumbers = new Set(numbersIn(jobText));
  // A number near one in the claim's own evidence is rounding (stretched); otherwise invented.
  const evidenceNumbers = numbersIn(quotes.join('\n')).map(parseFloat).filter(Number.isFinite);
  const checked = new Set();
  for (const occurrence of numberOccurrences(text)) {
    const n = occurrence.value;
    if (sourceNumbers.has(n) || employerAttributed(text, occurrence, postingNumbers) || checked.has(n)) continue;
    checked.add(n);
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
export function gradePacket(packet, sources, modelRatings = [], line = null, { jobText = '' } = {}) {
  const sourceText = sources.map(s => s.text).join('\n');
  const clip = value => typeof value === 'string' ? value.slice(0, 1000) : '';
  const rated = Array.isArray(modelRatings) ? modelRatings.slice(0, 200).filter(r => r && RATINGS.includes(r.rating)).map(r => ({ id: clip(r.id), claim: clip(r.claim), rating: r.rating, kind: KINDS.includes(r.kind) ? r.kind : 'other', reason: clip(r.reason), suggestion: clip(r.suggestion) })) : [];
  const claims = claimsOf(packet);
  const fromModel = claim => rated.find(r => r.id === claim.id) || rated.find(r => typeof r.claim === 'string' && r.claim.trim() === String(claim.text).trim());
  for (const r of rated) if (/^cover/i.test(String(r.id || '')) && typeof r.claim === 'string' && lower(packet.coverLetter).includes(lower(r.claim).trim()))
    claims.push({ id: `cover:${claims.filter(c => c.part === 'cover').length}`, part: 'cover', label: 'Cover letter', text: r.claim, quotes: [] });
  // Numbers in the cover letter are checked even when the reviewer rates nothing there.
  // Each occurrence is judged where it sits: one employer fact does not exempt a
  // second, candidate-owned use of the same number.
  const sourceNumbers = new Set(numbersIn(sourceText)), postingNumbers = new Set(numbersIn(jobText));
  for (const occurrence of numberOccurrences(packet.coverLetter)) {
    if (sourceNumbers.has(occurrence.value) || employerAttributed(packet.coverLetter, occurrence, postingNumbers)) continue;
    const text = sentenceAt(packet.coverLetter, occurrence.index);
    if (claims.some(claim => claim.part === 'cover' && claim.text === text)) continue;
    claims.push({ id: `cover:${claims.filter(c => c.part === 'cover').length}`, part: 'cover', label: 'Cover letter', text, quotes: [] });
  }

  const results = claims.map(claim => {
    const model = fromModel(claim);
    const signals = claimSignals(claim.text, claim.quotes, sourceText, jobText);
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

function sentenceAt(text, index) {
  const value = String(text);
  const before = value.slice(0, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
  const endInSentence = value.slice(index).search(/[.!?]/);
  const end = endInSentence < 0 ? value.length : index + endInSentence + 1;
  return value.slice(start, end).trim() || value;
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
