// Contradictions and settled questions, bounded and deterministic.
//
// The candidate's sources are compared locally, never by a model. A finding always
// carries the two exact quotes and their source ids; a decision records only which
// source is right, plus digests, so the ledger never copies the facts it is about.
// Detection covers five material cases and nothing else: the same employer with a
// different title, dates that overlap but disagree, a different degree or graduation
// year, different numbers on the same kind of claim, and conflicting location or
// eligibility. Ordinary settled facts (one employer, one date, one degree) yield
// nothing. A semantic "these two sentences mean different things" check is measured
// work, not part of this module.
//
// The question lookup is separate: before a packet asks the candidate something, the
// profile, an exact approved reusable answer and this packet's own answers are checked
// first. A question those already settle is answered, not asked, and the occurrence is
// counted so a repeated question is visible across applications.

import { digest, factualSource } from './store.mjs';
import { AnswerBank, normalizeQuestion } from './answer-bank.mjs';

export const CONFLICT_LIMIT = 20;
export const QUESTION_LIMIT = 200;

const SOURCE_LABEL = {
  profile: 'Profile details', cv: 'Resume', interview: 'Your interview answers and stories',
  'structured-resume': 'Structured resume', narrative: 'Career narrative', 'proof-points': 'Proof points', stories: 'Story bank',
};
const labelFor = sourceId => SOURCE_LABEL[sourceId] || sourceId;
const MAX_QUOTE = 400;

// Sentences are sliced back out of the source text, so every quote is an exact substring.
// A period after a single capital letter (B.S., Ph.D., U.S.) does not end a sentence;
// splitting there would hide a degree from the year and institution that qualify it.
const ABBREVIATION = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'inc', 'ltd', 'co', 'vs', 'etc']);
// A degree abbreviation ends a sentence only before a word that starts a new clause:
// "M.Sc. Computer Science — 2018" and "MSc. in Biology" continue, "I completed my MSc.
// I then worked" does not.
const DEGREE_ABBREVIATION = new Set(['m.sc', 'b.sc', 'ph.d', 'msc', 'bsc']);
function sentences(text) {
  const source = String(text || '');
  const found = [];
  let start = 0;
  const push = end => {
    const quote = source.slice(start, end).trim();
    if (quote.length >= 8) found.push(quote.slice(0, MAX_QUOTE));
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const terminal = char === '\n' || ('.!?'.includes(char) && (index + 1 >= source.length || /\s/.test(source[index + 1])));
    if (!terminal) continue;
    if (char === '.') {
      const before = source.slice(start, index);
      const word = before.match(/([A-Za-z.]+)$/)?.[1] || '';
      if (/\b[A-Z]$/.test(before) || ABBREVIATION.has(word.toLowerCase())) continue;
      if (DEGREE_ABBREVIATION.has(word.toLowerCase()) && !/^\s*(?:I|We|They|It|He|She|My|Our|This|That|Then|After|Later|Next|Since|From)\b/.test(source.slice(index + 1))) continue;
    }
    push(index + 1);
    start = index + 1;
  }
  push(source.length);
  return found;
}

const YEAR = /(?<![$\d])\b(?:19|20)\d{2}\b(?![%\d])/g;
const RANGE = /\b((?:19|20)\d{2})\s*(?:[–—-]|to|until)\s*((?:19|20)\d{2}|present|current|now)\b/i;
const yearOf = text => { const match = String(text || '').match(YEAR); return match ? Number(match[0]) : null; };
function rangeOf(text) {
  const match = String(text || '').match(RANGE);
  if (!match) return null;
  const end = /^\d{4}$/.test(match[2]) ? Number(match[2]) : new Date().getFullYear();
  const start = Number(match[1]);
  return start <= end ? { start, end } : { start: end, end: start };
}
// A range that ends in the same year the next begins is a handover, not an overlap.
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const sameRange = (a, b) => a.start === b.start && a.end === b.end;
const normalizeOrg = value => String(value || '').toLowerCase().replace(/[.,'’]/g, '').replace(/\s+/g, ' ').trim().replace(/\s+(?:inc|llc|ltd|corp|corporation|co)$/, '');
const normalizeTitle = value => String(value || '').toLowerCase().replace(/[.,'’]/g, '').replace(/\s+/g, ' ').trim();
const normalizePlace = value => {
  const city = String(value || '').toLowerCase().split(',')[0].replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
  return city;
};
const placeMatches = (a, b) => Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));

const NOT_TITLE = new Set(['worked', 'work', 'working', 'served', 'serving', 'employed', 'based', 'located', 'living', 'residing', 'graduated', 'studied', 'interned', 'joined', 'joining', 'left', 'leaving', 'moved', 'moving', 'i', 'we', 'my', 'our']);
// A bare "Associate" or "Master" is a job title ("Senior Research Associate", "Scrum
// Master"), not a degree: those words count only as "Associate's", "Master of ..." or
// "... degree".
const DEGREE_TOKEN = /\b(Ph\.?\s?D\.?|Doctorate|Doctor of [A-Za-z]+|MBA|M\.?B\.?A\.?|M\.\s?Sc?\.?|M\.A\.?|M\.?Eng\.?|Master(?:’s|'s|s)(?:\s+(?:degree|(?:of|in)\s+[A-Za-z ]+))?|Master\s+(?:degree|of\s+[A-Za-z ]+|in\s+(?!(?:the|a|an|our|my|this|that|their|his|her)\b)[A-Za-z ]+)|B\.\s?Sc?\.?|B\.A\.?|B\.?Eng\.?|Bachelor(?:’s|'s|s)?(?:\s+of\s+[A-Za-z ]+)?|Associate(?:’s|'s|s)(?:\s+(?:degree|(?:of|in)\s+[A-Za-z ]+))?|Associate\s+(?:degree|of\s+[A-Za-z ]+|in\s+(?:Arts|Science|Applied|General|Fine|Business|Nursing|Occupational)\b[A-Za-z ]*))\b/i;
// The two- and three-letter abbreviations are case-sensitive (no i flag), so "50 ms in
// 2018" or "MS Excel" are not degrees, and need a degree shape after them: "MS in
// Chemistry", "BSc Physics", or a comma and a field that ends the heading field
// ("BA, economics — 2018"), never a comma before more prose ("BA, Pilot study in").
const DEGREE_ABBR = /\b(MSc|BSc|MS|MA|BS|BA)\.?(?=\s+(?:in|of)\s+[A-Za-z]|\s+[A-Z][a-z]+\s*[—–,]|,\s*[A-Za-z]+(?:\s+[A-Za-z]+)?\s*(?:[—–]|$|\.\s*$|,\s*(?:19|20)\d{2}))/;
const degreeMatch = text => String(text ?? '').match(DEGREE_TOKEN) || String(text ?? '').match(DEGREE_ABBR);
const INSTITUTION = /\b((?:[A-Z][\w'’.-]*\s+){0,3}(?:University|College|Institute|School|Polytechnic|Academy)(?:\s+of\s+[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*)*)?)\b/;

function cleanTitle(value) {
  const title = String(value || '').replace(/[.,;:]+$/, '').trim();
  if (!title || title.length > 80) return null;
  const words = title.split(/\s+/);
  if (words.length > 4 || words.some(word => NOT_TITLE.has(word.toLowerCase()))) return null;
  if (/\b(?:19|20)\d{2}\b/.test(title)) return null;
  if (degreeMatch(title) || INSTITUTION.test(title)) return null;
  return title;
}
function cleanOrg(value) {
  return String(value || '').replace(/[.,;:]+$/, '').trim().replace(/\s+(?:as|in|for|to|at|of|and|&|the)$/i, '').trim();
}

const ROLE_AT = /\b([A-Z][\w&./’'-]*(?:\s+(?:[A-Z][\w&./’'-]*|of|and|&)){0,3})\s+(?:at|@)\s+([A-Z][\w&.’'-]*(?:\s+(?:[A-Z][\w&.’'-]*|of|and|&|the)){0,4})/g;
const WORKED_AS = /\b[Ww]orked\s+at\s+([A-Z][\w&.’'-]*(?:\s+(?:[A-Z][\w&.’'-]*|of|and|&|the)){0,4})\s+as\s+([A-Z][\w&./’'-]*(?:\s+(?:[A-Z][\w&./’'-]*|of|and|&)){0,3})/g;

function employmentFacts(sourceId, sentence) {
  const facts = [];
  const add = (titleRaw, orgRaw) => {
    const title = cleanTitle(titleRaw), org = cleanOrg(orgRaw);
    if (!title || !org || org.length < 2) return;
    facts.push({ sourceId, quote: sentence, org, title, range: rangeOf(sentence) });
  };
  for (const match of sentence.matchAll(WORKED_AS)) add(match[2], match[1]);
  for (const match of sentence.matchAll(ROLE_AT)) add(match[1], match[2]);
  return facts;
}

const PEOPLE_ACTION = /\b(?:led|lead|leading|managed|managing|coordinated|coordinating|supervised|supervising|oversaw|overseeing|directed|directing|ran|running|trained|training|mentored|mentoring|hired|hiring)\b/i;
const TEAM_OF = /\b(?:a\s+|an\s+)?team\s+of\s+(\d{1,3})\b/i;
const PEOPLE_COUNT = /\b(\d{1,3})\s+(?:contractors?|interns?|engineers?|analysts?|people|employees?|staff|students?|volunteers?|members?|reports?)\b/i;
function numberFact(sourceId, sentence) {
  if (!PEOPLE_ACTION.test(sentence)) return null;
  const match = sentence.match(TEAM_OF) || sentence.match(PEOPLE_COUNT);
  if (!match) return null;
  const count = Number(match[1]);
  if (!(count > 0)) return null;
  return { sourceId, quote: sentence, count };
}

function degreeLevel(match) {
  const value = match.toLowerCase().replace(/[’']/g, '');
  if (/^ph|doctor/.test(value)) return 'doctorate';
  if (/mba|^m\.?b/.test(value)) return 'masters';
  if (/^m\.?[sa]|^m\.?eng|master/.test(value)) return 'masters';
  if (/^b\.?[sa]|^b\.?eng|bachelor/.test(value)) return 'bachelors';
  if (/^associate/.test(value)) return 'associate';
  return null;
}
function degreeFact(sourceId, sentence) {
  const degree = degreeMatch(sentence);
  if (!degree) return null;
  const institution = sentence.match(INSTITUTION);
  return {
    sourceId, quote: sentence, level: degreeLevel(degree[0]),
    year: yearOf(sentence), org: institution ? normalizeOrg(institution[1]) : null,
  };
}
function profileGraduationFact(profile) {
  const text = String(profile?.graduation || '').trim();
  if (!text) return null;
  const degree = degreeMatch(text);
  const year = yearOf(text);
  if (!degree && !year) return null;
  const institution = text.match(INSTITUTION);
  return {
    sourceId: 'profile', quote: text, level: degree ? degreeLevel(degree[0]) : null,
    year, org: institution ? normalizeOrg(institution[1]) : null,
  };
}

const CURRENT_PLACE = /\b(?:I(?:'m| am)|currently)\s+(?:based|located|living|residing|live)\s+in\s+([A-Z][A-Za-z.'’ -]{1,40}?)(?=[,.;\n]|$)/i;
function placeFact(sourceId, sentence) {
  const match = sentence.match(CURRENT_PLACE);
  if (!match) return null;
  const place = normalizePlace(match[1]);
  return place ? { sourceId, quote: sentence, place } : null;
}

const AUTHORIZED = /\b(?:authori[sz]ed|eligible|permitted)\s+to\s+work\s+in\s+(?:the\s+)?([A-Z][A-Za-z. ]{1,30}?)(?=[,.;\n]|$)/i;
const NEEDS_SPONSORSHIP = /\b(?:requires?|needs?|requiring)\s+(?:a\s+|an\s+)?(?:visa\s+)?sponsorship\b/i;
const NO_SPONSORSHIP = /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b|\b(?:do(?:es)? not require|don't require)\s+(?:a\s+|an\s+)?(?:visa\s+)?sponsorship\b/i;
const CITIZEN = /\b(?:US|U\.S\.)\s+citizen\b/i;
function eligibilityFact(sourceId, sentence) {
  const authorized = sentence.match(AUTHORIZED);
  const citizen = CITIZEN.test(sentence);
  const needs = NEEDS_SPONSORSHIP.test(sentence);
  const none = NO_SPONSORSHIP.test(sentence);
  if (!authorized && !citizen && !needs && !none) return null;
  const country = authorized ? authorized[1].trim().replace(/\s+/g, ' ').toLowerCase() : citizen ? 'us' : null;
  return {
    sourceId, quote: sentence, country,
    needsSponsorship: needs ? true : authorized || citizen || none ? false : null,
  };
}

const sameCountry = (a, b) => {
  const norm = value => String(value || '').toLowerCase().replace(/[.]/g, '').replace(/^(the|a)\s+/, '').trim();
  const left = norm(a), right = norm(b);
  return left && right && (left === right || left.startsWith(right) || right.startsWith(left));
};

function finding(kind, topic, quoteA, quoteB) {
  const quotes = [quoteA, quoteB];
  const id = digest({
    conflict: kind,
    topic: topic.toLowerCase(),
    quotes: quotes.map(item => [item.sourceId, digest(item.quote)]).sort(),
  });
  return { id, kind, topic, sourceIds: [...new Set(quotes.map(item => item.sourceId))], quotes };
}

// Pairs from different sources only: one source varying internally is not a
// contradiction between what the candidate told different places.
function sourcePairs(facts) {
  const pairs = [];
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      if (facts[i].sourceId !== facts[j].sourceId) pairs.push([facts[i], facts[j]]);
    }
  }
  return pairs;
}

function textSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter(source => source?.id !== 'profile' && factualSource(source.id) && typeof source.text === 'string');
}

export function findConflicts({ sources = [], profile = {}, decisions = [], excludedSources = [] } = {}) {
  const facts = Array.isArray(decisions) ? decisions.filter(item => item?.id) : [];
  const decided = new Set(facts.map(item => item.id));
  const excluded = new Set(excludedSources || []);
  const findings = [];
  const employment = [], numbers = [], degrees = [], places = [], eligibilities = [];

  for (const source of textSources(sources)) {
    for (const sentence of sentences(source.text)) {
      employment.push(...employmentFacts(source.id, sentence));
      const count = numberFact(source.id, sentence);
      if (count) numbers.push(count);
      const degree = degreeFact(source.id, sentence);
      if (degree) degrees.push(degree);
      const place = placeFact(source.id, sentence);
      if (place) places.push(place);
      const eligibility = eligibilityFact(source.id, sentence);
      if (eligibility) eligibilities.push(eligibility);
    }
  }
  const graduation = profileGraduationFact(profile);
  if (graduation) degrees.push(graduation);
  if (String(profile?.location || '').trim()) places.push({ sourceId: 'profile', quote: String(profile.location).trim(), place: normalizePlace(profile.location) });
  if (String(profile?.eligibility || '').trim()) {
    const eligibility = eligibilityFact('profile', String(profile.eligibility).trim());
    if (eligibility) eligibilities.push(eligibility);
  }

  for (const [a, b] of sourcePairs(employment)) {
    if (a.org !== b.org || a.title === b.title) continue;
    // A promotion is two non-overlapping ranges. Without dates it cannot be ruled out.
    if (a.range && b.range && !overlaps(a.range, b.range)) continue;
    findings.push(finding('employer', `the job title at ${a.org}`, { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
  }
  for (const [a, b] of sourcePairs(employment)) {
    if (a.org !== b.org || a.title !== b.title || !a.range || !b.range) continue;
    if (sameRange(a.range, b.range) || !overlaps(a.range, b.range)) continue;
    findings.push(finding('dates', `the dates at ${a.org}`, { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
  }
  // A source may list several degrees; only the highest one is the claim. Comparing
  // every pair would call an older bachelor's a contradiction of a later master's.
  const degreeGroups = new Map();
  for (const fact of degrees) degreeGroups.set(fact.sourceId, [...(degreeGroups.get(fact.sourceId) || []), fact]);
  const degreeRank = { doctorate: 4, masters: 3, bachelors: 2, associate: 1 };
  const bestDegree = list => list.reduce((best, item) => {
    if (!best) return item;
    const delta = (degreeRank[item.level] || 0) - (degreeRank[best.level] || 0);
    if (delta > 0 || (delta === 0 && (item.year || 0) > (best.year || 0))) return item;
    return best;
  }, null);
  const degreeSources = [...degreeGroups.entries()];
  for (let i = 0; i < degreeSources.length; i++) {
    for (let j = i + 1; j < degreeSources.length; j++) {
      const [leftId, leftFacts] = degreeSources[i], [rightId, rightFacts] = degreeSources[j];
      const a = bestDegree(leftFacts), b = bestDegree(rightFacts);
      if (!a || !b) continue;
      // The profile stores one graduation year. It is settled when any degree in the
      // other source has that year; the older degrees are a history, not a conflict.
      const profile = a.sourceId === 'profile' ? a : b.sourceId === 'profile' ? b : null;
      const otherFacts = profile ? (a.sourceId === 'profile' ? rightFacts : leftFacts) : null;
      if (profile && profile.year && otherFacts.some(item => item.year === profile.year)) continue;
      const sameInstitution = a.org && b.org && a.org === b.org;
      const differentLevel = a.level && b.level && a.level !== b.level;
      const differentYear = a.year && b.year && a.year !== b.year;
      // Two different degrees at different schools and different years are a normal
      // history, not a contradiction. Same school, same year, or one shared level is.
      if (differentLevel && !sameInstitution && !(a.year && b.year && a.year === b.year)) continue;
      if (!differentLevel && !differentYear) continue;
      const topic = sameInstitution ? `your degree at ${a.org.replace(/\b\w/g, c => c.toUpperCase())}` : 'your degree or graduation year';
      findings.push(finding('degree', topic, { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
    }
  }
  for (const [a, b] of sourcePairs(numbers)) {
    if (a.count === b.count) continue;
    findings.push(finding('number', 'how many people you led or coordinated', { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
  }
  for (const [a, b] of sourcePairs(places)) {
    if (placeMatches(a.place, b.place)) continue;
    findings.push(finding('location', 'your current location', { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
  }
  for (const [a, b] of sourcePairs(eligibilities)) {
    if (a.needsSponsorship === null || b.needsSponsorship === null || a.needsSponsorship === b.needsSponsorship) continue;
    if (a.country && b.country && !sameCountry(a.country, b.country)) continue;
    findings.push(finding('eligibility', 'your work authorization', { sourceId: a.sourceId, quote: a.quote }, { sourceId: b.sourceId, quote: b.quote }));
  }

  const seen = new Set();
  const unique = [];
  for (const item of findings) {
    if (decided.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push({ ...item, excluded: item.sourceIds.filter(id => excluded.has(id)) });
  }
  return unique.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, CONFLICT_LIMIT);
}

// The blocking question names the topic. It quotes only sources that are shared, so
// an excluded source can cause the block but its text never reaches the provider.
export function conflictQuestion(item, excludedSources = []) {
  const excluded = new Set(excludedSources || []);
  const shown = (item?.quotes || []).filter(quote => !excluded.has(quote.sourceId)).map(quote => {
    const text = quote.quote.length > 140 ? quote.quote.slice(0, 140) + '…' : quote.quote;
    return `“${text}” (${labelFor(quote.sourceId)})`;
  });
  const what = item?.topic || 'one of your facts';
  return `Your sources disagree about ${what}.${shown.length ? ` They say ${shown.join(' and ')}.` : ''} Edit the source or record which is right before this application can be approved.`;
}

export const questionDigest = question => digest(['settled-question', normalizeQuestion(question)]);

const PROFILE_QUESTION = [
  ['email', /\b(?:e-?mail(?:\s+address)?)\b/i],
  ['phone', /\b(?:phone|telephone|mobile)(?:\s+number)?\b/i],
  ['location', /\b(?:location|where\s+(?:are|do)\s+you\s+(?:based|live|located)|current\s+(?:city|location)|city)\b/i],
  ['timezone', /\b(?:time\s?zone)\b/i],
  ['eligibility', /\b(?:work\s+authori[sz]ation|eligib(?:le|ility)|visa|sponsor(?:ship)?|authori[sz]ed\s+to\s+work)\b/i],
  ['compensation', /\b(?:compensation|salary|pay\s+(?:range|expectations?)|expected\s+pay)\b/i],
  ['graduation', /\b(?:graduat(?:e|ion)|degree|education)\b/i],
  ['name', /\b(?:full\s+name|legal\s+name|your\s+name)\b/i],
  ['roles', /\b(?:target|desired|preferred)\s+(?:roles?|positions?|jobs?)\b/i],
];
const FOREIGN_SUBJECT = /\b(?:job|role|position|company|employer|posting|office|organization|organisation)\b/i;

// Why a question is already answered, or null when the sources do not settle it.
// profile -> exact approved reusable answer -> this packet's own answer.
export function settledQuestion(question, { profile = {}, bank = [], packet = null, job = null, asOf = null } = {}) {
  const text = String(question || '').trim();
  if (!text) return null;
  const foreign = FOREIGN_SUBJECT.test(text);
  for (const [field, pattern] of PROFILE_QUESTION) {
    if (!pattern.test(text) || !String(profile?.[field] || '').trim()) continue;
    // A question about the employer's location, degree or sponsorship is not the
    // candidate's own answer, even when the field name matches.
    if (foreign && ['location', 'compensation', 'graduation', 'eligibility', 'roles'].includes(field)) continue;
    return { by: 'profile', topic: field };
  }
  if (AnswerBank.match(bank, { label: text, job, asOf })) return { by: 'answer-bank', topic: 'approved answer' };
  const answer = (packet?.answers || []).find(item => normalizeQuestion(item?.question) === normalizeQuestion(text) && String(item?.answer || '').trim());
  if (answer) return { by: 'packet-answer', topic: 'this packet’s answer' };
  return null;
}

// Runs before a packet is saved: answers settled questions instead of asking them,
// then blocks on any unresolved conflict that a claim in this packet cites.
export function prepareMemoryCheck({ packet, sources = [], profile = {}, decisions = [], excludedSources = [], bank = [], job = null, asOf = null } = {}) {
  if (!packet || !Array.isArray(packet.questions)) return { blocking: [], settled: [], open: [] };
  const settled = [];
  packet.questions = packet.questions.filter(question => {
    const answer = settledQuestion(question, { profile, bank, packet, job, asOf });
    if (!answer) return true;
    settled.push({ digest: questionDigest(question), by: answer.by, topic: answer.topic });
    return false;
  });
  const open = findConflicts({ sources, profile, decisions, excludedSources });
  const cited = new Set();
  for (const item of [...(packet.resume || []), ...(packet.answers || [])]) for (const evidence of Array.isArray(item?.evidence) ? item.evidence : []) {
    if (evidence?.sourceId) cited.add(evidence.sourceId);
  }
  const blocking = open.filter(item => item.sourceIds.some(id => cited.has(id)));
  for (const item of blocking) {
    const question = conflictQuestion(item, excludedSources);
    if (!packet.questions.includes(question)) packet.questions.push(question);
  }
  return { blocking, settled, open };
}

export function recordQuestionChecks(state, checks, { jobId = null, at = new Date().toISOString() } = {}) {
  const entries = (Array.isArray(checks) ? checks : []).filter(check => check?.digest);
  if (!entries.length) return 0;
  const review = state.conflictReview && typeof state.conflictReview === 'object' ? state.conflictReview : {};
  const questionChecks = [...(Array.isArray(review.questionChecks) ? review.questionChecks : []), ...entries.map(check => ({ digest: check.digest, by: check.by, at, jobId }))];
  state.conflictReview = { ...review, questionChecks: questionChecks.slice(-QUESTION_LIMIT) };
  return entries.length;
}

export function questionStats(review) {
  const checks = Array.isArray(review?.questionChecks) ? review.questionChecks : [];
  const counts = new Map();
  for (const check of checks) counts.set(check.digest, (counts.get(check.digest) || 0) + 1);
  const repeated = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return { asked: checks.length, distinct: counts.size, repeated };
}

// A question count can only be built from the state's own memory. File-backed sources
// are compared by the server and by prepare; the digest count is the portable subset.
export function stateSources(state) {
  const sources = [];
  if (String(state?.profile?.resume || '').trim()) sources.push({ id: 'cv', text: state.profile.resume });
  const interview = (state?.conversation || []).filter(message => message?.role === 'user' && typeof message.text === 'string').map(message => message.text).join('\n\n');
  if (interview) sources.push({ id: 'interview', text: interview });
  return sources;
}

export function memoryReport(state, sources = stateSources(state)) {
  const decisions = Array.isArray(state?.conflictReview?.decisions) ? state.conflictReview.decisions : [];
  const open = findConflicts({ sources, profile: state?.profile || {}, decisions, excludedSources: state?.contextPrefs?.excludedSources || [] });
  return {
    conflicts: { open: open.length, resolved: decisions.length },
    questions: questionStats(state?.conflictReview),
    open,
  };
}

// The decision stores what is needed to recognize the same conflict later and what the
// candidate chose, never the quote text. A source edit changes the quotes, and therefore
// the conflict id, so an old decision cannot suppress a new disagreement.
export function conflictDecision(item, sourceId, at = new Date().toISOString()) {
  return {
    id: item.id,
    kind: item.kind,
    sourceIds: [...item.sourceIds],
    quoteDigests: item.quotes.map(quote => digest(quote.quote)),
    disposition: { sourceId },
    at,
  };
}
