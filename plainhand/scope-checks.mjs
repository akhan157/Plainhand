import { FACTUAL_SOURCE_IDS } from './store.mjs';
// A scope stretch the reviewer and calibration have missed: the source says one
// assay and the packet says "assays" because the posting uses the plural. This is
// lexical and local: an item's own evidence quote is the only reference text, so
// the check never asks the posting or an unrelated source line to license a count.
const UNCOUNTABLE = new Set([
  'accommodation', 'advice', 'advertising', 'art', 'assistance', 'automation',
  'baggage', 'biology', 'cash', 'chemistry', 'communication', 'compliance',
  'confidence', 'consulting', 'content', 'cooperation', 'courage', 'coursework',
  'data', 'design', 'documentation', 'education', 'energy', 'engineering',
  'equipment', 'evidence', 'experience', 'feedback', 'finance', 'furniture',
  'hardware', 'health', 'help', 'homework', 'honesty', 'hospitality',
  'information', 'insurance', 'knowledge', 'leadership', 'learning', 'logistics',
  'luggage', 'machinery', 'management', 'marketing', 'mathematics', 'media',
  'music', 'news', 'nursing', 'oxygen', 'patience', 'physics', 'pollution',
  'research', 'respect', 'safety', 'science', 'software', 'staff', 'statistics',
  'support', 'teamwork', 'technology', 'training', 'transport', 'travel', 'trust',
  'understanding', 'validation', 'wealth', 'welfare', 'work', 'writing',
]);
const PLURAL_ONLY = new Set([
  'belongings', 'clothes', 'congratulations', 'credentials', 'earnings', 'goods',
  'headquarters', 'means', 'outskirts', 'pants', 'premises', 'proceedings',
  'proceeds', 'regards', 'riches', 'savings', 'scissors', 'series', 'species',
  'thanks', 'trousers', 'valuables', 'whereabouts',
]);
// Third-person verb forms and function words that would otherwise look like a
// plural noun. The check stays conservative: a missed stretch costs less than a
// retry that asks the drafter to change a correct verb.
const NOT_A_NOUN = new Set([
  'adds', 'allows', 'applies', 'becomes', 'begins', 'brings', 'builds', 'calls',
  'carries', 'comes', 'contains', 'continues', 'creates', 'delivers',
  'demonstrates', 'develops', 'enables', 'ensures', 'explains', 'focuses',
  'gets', 'gives', 'helps', 'includes', 'increases', 'keeps', 'leads',
  'maintains', 'makes', 'manages', 'meets', 'needs', 'offers', 'owns',
  'performs', 'provides', 'reduces', 'requires', 'runs', 'serves', 'shows',
  'takes', 'trains', 'uses', 'works', 'writes', 'achieves', 'coordinates',
  'drives', 'grows', 'hires', 'holds', 'improves', 'introduces', 'launches',
  'mentors', 'negotiates', 'partners', 'plans', 'presents', 'produces',
  'promotes', 'proposes', 'protects', 'publishes', 'reads', 'records',
  'recruits', 'reports', 'reviews', 'schedules', 'sells', 'solves', 'starts',
  'studies', 'teaches', 'tests', 'tracks', 'treats', 'wins',
  'add', 'allow', 'apply', 'become', 'begin', 'bring', 'build', 'call',
  'carry', 'come', 'contain', 'continue', 'create', 'deliver', 'demonstrate',
  'develop', 'enable', 'ensure', 'explain', 'focus', 'get', 'give', 'help',
  'include', 'increase', 'keep', 'lead', 'maintain', 'make', 'manage', 'meet',
  'need', 'offer', 'own', 'perform', 'provide', 'reduce', 'require', 'run',
  'serve', 'show', 'take', 'train', 'use', 'work', 'write', 'achieve',
  'coordinate', 'drive', 'grow', 'hire', 'hold', 'improve', 'introduce',
  'launch', 'mentor', 'negotiate', 'partner', 'plan', 'present', 'produce',
  'promote', 'propose', 'protect', 'publish', 'read', 'record', 'recruit',
  'report', 'review', 'schedule', 'sell', 'solve', 'start', 'study', 'teach',
  'test', 'track', 'treat', 'win',
]);
const IRREGULAR = new Map([
  ['person', ['people']], ['child', ['children']], ['man', ['men']], ['woman', ['women']],
  ['foot', ['feet']], ['tooth', ['teeth']], ['mouse', ['mice']], ['goose', ['geese']],
  ['analysis', ['analyses']], ['basis', ['bases']], ['crisis', ['crises']],
  ['thesis', ['theses']], ['hypothesis', ['hypotheses']], ['diagnosis', ['diagnoses']],
  ['synthesis', ['syntheses']], ['emphasis', ['emphases']], ['axis', ['axes']],
  ['criterion', ['criteria']], ['phenomenon', ['phenomena']], ['datum', ['data']],
  ['medium', ['media']], ['index', ['indices', 'indexes']], ['vertex', ['vertices']],
  ['matrix', ['matrices']], ['appendix', ['appendices']], ['knife', ['knives']],
  ['life', ['lives']], ['wife', ['wives']], ['shelf', ['shelves']], ['half', ['halves']],
  ['wolf', ['wolves']], ['calf', ['calves']], ['thief', ['thieves']], ['loaf', ['loaves']],
  ['scarf', ['scarves']], ['leaf', ['leaves']],
]);
const VERB_BEFORE = new Set([
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'who', 'that', 'which', 'to',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'do',
  'does', 'did', 'not', 'never', 'also', 'then', 'first', 'please',
]);
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'over', 'under', 'about',
  'after', 'before', 'between', 'through', 'during', 'against', 'within',
  'without', 'across', 'along', 'around', 'because', 'while', 'when', 'where',
  'whose', 'this', 'these', 'those', 'there', 'their', 'them', 'they', 'your',
  'yours', 'our', 'ours', 'his', 'her', 'hers', 'its', 'my', 'mine', 'been',
  'being', 'was', 'were', 'are', 'is', 'has', 'have', 'had', 'can', 'could',
  'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'not', 'but',
  'all', 'any', 'some', 'many', 'much', 'more', 'most', 'less', 'least', 'very',
  'each', 'every', 'both', 'few', 'several', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'ten', 'per', 'via', 'out', 'off',
]);

const words = text => (String(text ?? '').toLowerCase().replace(/[\u2019']s\b/g, '').match(/[a-z][a-z'-]*/g) || []);
const isVerbContext = (list, index) => index > 0 && VERB_BEFORE.has(list[index - 1]);

// The singular forms a plural token could have come from. Both the full
// "companies" -> "company" and the shorter "processes" -> "process" are tried,
// so a conservative match only needs the quote to contain one of them.
function singularCandidates(token) {
  if (IRREGULAR.size) {
    for (const [singular, plurals] of IRREGULAR) if (plurals.includes(token)) return [singular];
  }
  const candidates = [];
  if (/ies$/.test(token)) candidates.push(token.slice(0, -3) + 'y');
  if (/es$/.test(token)) candidates.push(token.slice(0, -2));
  if (/s$/.test(token)) candidates.push(token.slice(0, -1));
  return [...new Set(candidates)].filter(word => word.length >= 3);
}

function wordTokens(text) {
  const list = words(text);
  return { list, set: new Set(list) };
}

// One issue per flagged word per item. `quote` is the evidence span that says the
// singular, so the retry feedback can show the drafter exactly what it contradicted.
function scanItem({ kind, index, text, quotes }) {
  const packet = wordTokens(text), reference = wordTokens(quotes.join(' '));
  const issues = [];
  const seen = new Set();
  packet.list.forEach((token, at) => {
    if (seen.has(token) || token.length < 4 || !/s$/.test(token) || /ss$/.test(token)) return;
    if (UNCOUNTABLE.has(token) || PLURAL_ONLY.has(token) || NOT_A_NOUN.has(token) || STOP.has(token)) return;
    if (isVerbContext(packet.list, at)) return;
    for (const singular of singularCandidates(token)) {
      if (seen.has(token) || UNCOUNTABLE.has(singular) || PLURAL_ONLY.has(singular) || NOT_A_NOUN.has(singular) || STOP.has(singular)) continue;
      // The source must use the singular and must not use this plural itself.
      const atSource = reference.list.indexOf(singular);
      if (atSource < 0 || reference.set.has(token) || isVerbContext(reference.list, atSource)) continue;
      seen.add(token);
      issues.push({ kind, index, word: token, singular, text: String(text ?? ''), quote: quotes.find(quote => words(quote).includes(singular)) || '' });
      break;
    }
  });
  return issues;
}

const sentence = text => String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map(part => part.trim()).filter(Boolean);
const quotesOf = item => (Array.isArray(item?.evidence) ? item.evidence : []).map(entry => String(entry?.quote ?? '')).filter(Boolean);

// Every resume line and answer is checked against its own evidence quote. A cover
// letter has no per-sentence evidence, so its reference is the candidate's whole
// source context when the caller supplies it; a plural any source uses is allowed.
// Without sources, the packet's evidence quotes are the fallback reference.
// Raised verbs: a line that says the candidate built, led or managed something when
// its own evidence never says so, in that verb or an equal-strength one ("designed
// and tested a chassis" becomes "built a chassis"). Only a verb in verb position
// counts: at the start of a line or clause, or after a subject or auxiliary, never a
// hyphenated word ("built-in"), an adjective ("a managed service") or an acronym
// ("LED"). Each entry: the verb, the forms that raise it, the forms that support it.
const RAISED_VERBS = [
  ['built', /^(?:build|builds|built|building)$/, /\b(?:build|builds|built|building|builder|construct\w*|assembled|fabricated|developed|implemented|created)\b/],
  ['led', /^(?:lead|leads|led|leading)$/, /\b(?:lead|leads|led|leading|leader|leadership|headed|chaired|directed)\b/],
  ['managed', /^(?:manage|manages|managed|managing)$/, /\b(?:manage|manages|managed|managing|manager|management|responsible for|in charge of|oversaw|oversee|oversees|owned|ran)\b/],
  ['launched', /^(?:launch|launches|launched|launching)$/, /\b(?:launch|launches|launched|launching|released|shipped|introduced)\b/],
  ['founded', /^(?:founded|co-founded|cofounded)$/, /\b(?:founded|founder|co-founded|cofounded|started|established)\b/],
  ['headed', /^(?:headed|heads)$/, /\b(?:head|heads|headed|heading|chair|chaired|led|lead)\b/],
  ['directed', /^(?:direct|directs|directed|directing)$/, /\b(?:direct|directs|directed|directing|director|led|headed)\b/],
  ['architected', /^(?:architect|architects|architected)$/, /\b(?:architect|architects|architected|architecture|designed)\b/],
  ['spearheaded', /^(?:spearhead|spearheads|spearheaded)$/, /\b(?:spearhead\w*|led|lead|initiated|started)\b/],
  ['oversaw', /^(?:oversee|oversees|oversaw|overseeing)$/, /\b(?:oversee|oversees|oversaw|overseen|overseeing|oversight|managed|supervised|responsible for)\b/],
  ['supervised', /^(?:supervise|supervises|supervised|supervising)$/, /\b(?:supervise\w*|supervisor|managed|oversaw)\b/],
];
// Words that put the next word in verb position: a subject or auxiliary, including
// a contraction ("I've built"). A -ly adverb between them is transparent ("I
// single-handedly built"). After "and" or a comma only a past-tense raised form
// counts, so a list noun ("CI/CD, build tooling, and ...") is never read as a verb.
const VERB_SLOT = new Set(["i", "we", "who", "also", "then", "that", "which", "have", "has", "had", "to", "jointly", "personally", "successfully", "later", "now", "currently", "i've", "we've", "i'd", "we'd", "i've", "we've"]);
// People and places a raised verb acts on ("lead analysts", "manage vendors"); an
// abstract plural ("reports", "optimizations") is not an object.
const ROLE_OBJECT = /^(?:analysts?|technicians?|auditors?|vendors?|customers?|clients?|scientists?|associates?|contractors?|labs?|sites?|locations?|interns?|developers?|nurses?|operators?|managers?|accountants?|researchers?|students?|volunteers?|suppliers?|partners?|stakeholders?|teams?|crews?|squads?)$/;
const OBJECT_START = new Set(['a', 'an', 'the', 'our', 'my', 'their', 'its', 'this', 'that', 'these', 'those', 'every', 'all', 'two', 'three', 'four', 'five', 'several', 'multiple', 'weekly', 'daily', 'monthly', 'new', 'cross-functional', 'teams', 'team', 'people', 'staff', 'engineers', 'projects', 'programs', 'programmes']);
const PAST_RAISED = /^(?:built|led|managed|launched|founded|co-founded|cofounded|headed|directed|architected|spearheaded|oversaw|supervised|co-led)$/;
function raisedTokens(text) {
  const value = String(text ?? '').replace(/[\u2018\u2019]/g, "'");
  const found = [];
  for (const match of value.matchAll(/[A-Za-z][A-Za-z'-]*/g)) {
    let word = match[0];
    const at = match.index;
    if (word.length > 1 && word === word.toUpperCase()) continue;
    // "co-led", "co-founded": the raised verb after the prefix counts; any other
    // hyphenated word ("built-in", "single-handedly") is a modifier, not a verb.
    if (word.includes('-')) {
      const co = word.toLowerCase().match(/^co-(led|founded|managed|directed|headed|launched|built)$/);
      if (!co) continue;
      word = co[1];
    }
    const before = value.slice(0, at);
    const previousWords = before.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
    let back = previousWords.length - 1;
    while (back >= 0 && /ly$/.test(previousWords[back]) && previousWords[back].length > 3 && !VERB_SLOT.has(previousWords[back])) back--;
    const previous = back >= 0 ? previousWords[back] : null;
    const lower = word.toLowerCase();
    // An opener that is itself a slot word ("Successfully built") leaves the line start
    // before it; the slot word then puts the verb in position.
    const lineStart = /^[\s•·\-–—*]*$/.test(before) || /[.;:!?]\s*$/.test(before);
    const softStart = /,\s*$/.test(before) || previous === 'and';
    // A present-tense form must take an object to be a verb: "Lead the stand-up",
    // never "Build tooling ownership".
    const following = value.slice(at + match[0].length).toLowerCase().match(/^\s+([a-z][a-z'-]*)/)?.[1];
    // An object: a determiner, possessive, number or quantity word, or a capitalised
    // name after a lower-case verb ("lead QA"); a bare plural is not enough, so
    // "Direct reports" and "lead optimizations" stay nouns.
    const nextRaw = value.slice(at + match[0].length).match(/^\s+([A-Za-z][A-Za-z'-]*)/)?.[1] || '';
    const takesObject = Boolean(following) && (OBJECT_START.has(following) || /^[A-Z]/.test(nextRaw) || (ROLE_OBJECT.test(following) && !(lower === 'direct' && /^(?:client|customer|account|partner)$/.test(following))) || /^(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|several|many|both)$/.test(following));
    // After a subject ("I oversee", "who leads") the word is a verb whatever follows.
    const afterSubject = previous && /^(?:i|we|who|i've|we've|i'd|we'd)$/.test(previous);
    const verbal = PAST_RAISED.test(lower) || /(?:ing)$/.test(lower) || takesObject || afterSubject;
    if (!verbal) continue;
    if (lineStart || (previous && VERB_SLOT.has(previous)) || (softStart && (PAST_RAISED.test(lower) || takesObject || (/ing$/.test(lower) && /,\s*$/.test(before))))) found.push(lower);
  }
  return found;
}
function verbItem({ kind, index, text, quotes }) {
  const reference = quotes.join(' ').toLowerCase();
  if (!reference.trim()) return [];
  const tokens = raisedTokens(text);
  return RAISED_VERBS.flatMap(([verb, raised, supported]) => {
    const word = tokens.find(token => raised.test(token));
    return word && !supported.test(reference) ? [{ kind, index, word, verb, text: String(text ?? ''), quote: quotes[0] || '' }] : [];
  });
}

// A count written as a word that no source states ("one Raleigh role", "two teams")
// is a number claim like any digit. Values are compared, not spellings: "twenty-five"
// matches 25, "a dozen" 12, "twice" 2. A digit counts only standing alone, never
// inside "CO2", "3D", "5S" or "24/7". Uses that are not counts are skipped on both
// sides: "one of the", "one-page", "one-third", "one-on-one", "no one".
const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SPECIAL = { dozen: 12, twice: 2, thrice: 3, couple: 2, pair: 2, hundred: 100, thousand: 1000 };
const NUMBER_WORD = new RegExp(`\\b(?:(${Object.keys(UNITS).slice(0, 9).join('|')})\\s+(hundred|thousand)|(${Object.keys(TENS).join('|')})(?:[-\\s](${Object.keys(UNITS).slice(0, 9).join('|')}))?|(${Object.keys(UNITS).join('|')})|(${Object.keys(SPECIAL).join('|')}))\\b`, 'gi');
// Not a count: a partitive, a compound modifier, a fraction, or a fixed phrase.
const NOT_A_COUNT_AFTER = /^(?:-(?!(?:one|two|three|four|five|six|seven|eight|nine)\b)[a-z]|\s*-?\s*(?:half|third|thirds|quarter|quarters|fifth|fifths)\b|\s+another\b|\s+(?:or|to)\s+(?:two|three|more)\b)/i;
const NOT_A_COUNT_BEFORE = /(?:\bno|\bany|\bevery|\bsome|\bthe only|-)\s*$/i;
// `all` reads every number word, including compounds ("a two-person team" states
// two): what a source states. Without it, uses that are not counts are skipped:
// what a line claims.
const COUNT_COMPOUND = /^-(?:person|people|member|site|lab|team|location|product|program|programme|plant|line|store|country|state|office|client|customer|engineer|analyst|scientist|squad|unit|clinic|hospital|school|campus|region|market|brand|vendor)s?\b/i;
function countValues(text, { all = false } = {}) {
  const value = String(text ?? '');
  const values = [];
  for (const match of value.matchAll(NUMBER_WORD)) {
    const after = value.slice(match.index + match[0].length), before = value.slice(0, match.index);
    const word = match[0].toLowerCase();
    // "one of", "no one", "someone" never state a count, on either side.
    if ((word === 'one' && /^\s+of\b/i.test(after)) || NOT_A_COUNT_BEFORE.test(before)) continue;
    // A source states a count through a compound of countable things ("a two-person
    // team", "a three-site rollout"), never a duration or fraction ("three-hour",
    // "two-year", "one-third").
    if (NOT_A_COUNT_AFTER.test(after) && !(all && COUNT_COMPOUND.test(after))) continue;
    const number = match[1] ? UNITS[match[1].toLowerCase()] * (match[2].toLowerCase() === 'hundred' ? 100 : 1000)
      : match[3] ? TENS[match[3].toLowerCase()] + (match[4] ? UNITS[match[4].toLowerCase()] : 0)
        : match[5] ? UNITS[match[5].toLowerCase()] : SPECIAL[match[6].toLowerCase()];
    values.push({ word, number });
  }
  return values;
}
const digitValues = text => new Set([...String(text ?? '').matchAll(/(?<![A-Za-z0-9/.,])(\d{1,3}(?:,\d{3})*|\d+)(?![A-Za-z0-9/]|[.,]\d)/g)].map(match => Number(match[1].replace(/,/g, ''))));
function numberWordItem({ kind, index, text, reference }) {
  const stated = new Set([...digitValues(reference), ...countValues(reference, { all: true }).map(item => item.number)]);
  const seen = new Set();
  return countValues(text).filter(item => !stated.has(item.number) && !seen.has(item.word) && seen.add(item.word))
    .map(item => ({ kind, index, word: item.word, number: String(item.number), text: String(text ?? ''), quote: '' }));
}

// numbers: false on a revision, where the candidate's request is checked by review.
export function pluralScopeIssues(packet, { sources = [], allowVerbs = false, jobText = '', numbers = true } = {}) {
  const verbs = item => (allowVerbs ? [] : verbItem(item));
  const resume = Array.isArray(packet?.resume) ? packet.resume : [];
  const answers = Array.isArray(packet?.answers) ? packet.answers : [];
  const issues = [];
  resume.forEach((entry, index) => {
    if (!String(entry?.text ?? '').trim()) return;
    issues.push(...scanItem({ kind: 'resume', index, text: entry.text, quotes: quotesOf(entry) }), ...verbs({ kind: 'resume', index, text: entry.text, quotes: quotesOf(entry) }));
  });
  answers.forEach((entry, index) => {
    if (!String(entry?.answer ?? '').trim()) return;
    issues.push(...scanItem({ kind: 'answer', index, text: entry.answer, quotes: quotesOf(entry) }), ...verbs({ kind: 'answer', index, text: entry.answer, quotes: quotesOf(entry) }));
  });
  const sourceText = (Array.isArray(sources) ? sources : []).map(source => String(source?.text ?? '')).filter(Boolean);
  // A raised verb in the letter is checked against factual sources only: writing
  // samples and the reviewed understanding never support a fact.
  const factualText = (Array.isArray(sources) ? sources : []).filter(source => FACTUAL_SOURCE_IDS.includes(source?.id)).map(source => String(source?.text ?? '')).filter(Boolean);
  // Number words are checked only when the factual sources are known; the posting
  // may state a number the letter repeats.
  const numberReference = numbers && factualText.length ? `${factualText.join(' ')} ${jobText}` : '';
  // Resume lines and answers are checked against their own cited evidence, the
  // letter against the factual sources and the posting.
  if (numberReference) {
    resume.forEach((entry, index) => { if (String(entry?.text ?? '').trim()) issues.push(...numberWordItem({ kind: 'resume', index, text: entry.text, reference: quotesOf(entry).join(' ') || numberReference })); });
    answers.forEach((entry, index) => { if (String(entry?.answer ?? '').trim()) issues.push(...numberWordItem({ kind: 'answer', index, text: entry.answer, reference: quotesOf(entry).join(' ') || numberReference })); });
  }
  const letterQuotes = sourceText.length ? sourceText : [...resume.flatMap(quotesOf), ...answers.flatMap(quotesOf)];
  if (letterQuotes.length && String(packet?.coverLetter ?? '').trim()) {
    sentence(packet.coverLetter).forEach(text => issues.push(...scanItem({ kind: 'cover', index: null, text, quotes: letterQuotes }), ...verbs({ kind: 'cover', index: null, text, quotes: factualText.length ? factualText : letterQuotes }),
      ...(numberReference ? numberWordItem({ kind: 'cover', index: null, text, reference: numberReference }) : [])));
  }
  return issues;
}

const label = issue => issue.kind === 'cover' ? 'Cover letter sentence' : issue.kind === 'answer' ? `Answer ${issue.index + 1}` : `Resume entry ${issue.index + 1}`;
// The part of the line around the flagged word, so a quoted line always contains it.
function around(text, word) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= 180) return value;
  const at = Math.max(0, value.toLowerCase().indexOf(String(word ?? '').toLowerCase()));
  const from = Math.max(0, Math.min(at - 80, value.length - 180));
  return `${from > 0 ? '…' : ''}${value.slice(from, from + 180)}${from + 180 < value.length ? '…' : ''}`;
}

export function scopeRetryFeedback(issues) {
  if (!issues.length) return [];
  return [
    'Keep counts, number and verbs exactly as the sources state: a plural or a stronger verb (built, led, managed) the evidence does not use is a scope stretch.',
    ...issues.map(issue => issue.number
      ? `${label(issue)}: "${issue.word}" states a number (${issue.number}) no source gives; write "a" or "a single", or leave the count out. Sentence: "${around(issue.text, issue.word)}"`
      : issue.verb
      ? `${label(issue)}: "${issue.word}" is a stronger verb than the cited evidence uses; use the evidence's own verb (for example "designed", "tested", "worked on") unless a source says "${issue.verb}". Sentence: "${around(issue.text, issue.word)}"`
      : `${label(issue)}: "${issue.word}" must stay "${issue.singular}" unless the evidence states a count; the cited evidence says "${issue.singular}". Sentence: "${around(issue.text, issue.word)}"`),
  ];
}

export function scopeSuggestions(issues) {
  // Quote the line, never an index: a reviewer counting entries from zero would read
  // "Resume entry 2" as a different line and reject the note as false.
  const where = issue => issue.kind === 'cover' ? 'the cover-letter sentence' : issue.kind === 'answer' ? 'the answer' : 'the resume line';
  return issues.map(issue => issue.number
    ? `Scope check (not a factual issue): ${where(issue)} "${around(issue.text, issue.word)}" says "${issue.word}", a number no source states. Write "a" or leave the count out.`
    : issue.verb
    ? `Scope check (not a factual issue): ${where(issue)} "${around(issue.text, issue.word)}" says "${issue.word}", a verb its cited evidence does not use. Use the evidence's own verb or add a source that says "${issue.verb}".`
    : `Scope check (not a factual issue): ${where(issue)} "${around(issue.text, issue.word)}" says "${issue.word}" where its cited evidence says "${issue.singular}". Keep the singular or add evidence for more than one.`);
}
