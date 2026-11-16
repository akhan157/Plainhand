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
export function pluralScopeIssues(packet, { sources = [] } = {}) {
  const resume = Array.isArray(packet?.resume) ? packet.resume : [];
  const answers = Array.isArray(packet?.answers) ? packet.answers : [];
  const issues = [];
  resume.forEach((entry, index) => {
    if (!String(entry?.text ?? '').trim()) return;
    issues.push(...scanItem({ kind: 'resume', index, text: entry.text, quotes: quotesOf(entry) }));
  });
  answers.forEach((entry, index) => {
    if (!String(entry?.answer ?? '').trim()) return;
    issues.push(...scanItem({ kind: 'answer', index, text: entry.answer, quotes: quotesOf(entry) }));
  });
  const sourceText = (Array.isArray(sources) ? sources : []).map(source => String(source?.text ?? '')).filter(Boolean);
  const letterQuotes = sourceText.length ? sourceText : [...resume.flatMap(quotesOf), ...answers.flatMap(quotesOf)];
  if (letterQuotes.length && String(packet?.coverLetter ?? '').trim()) {
    sentence(packet.coverLetter).forEach(text => issues.push(...scanItem({ kind: 'cover', index: null, text, quotes: letterQuotes })));
  }
  return issues;
}

const label = issue => issue.kind === 'cover' ? 'Cover letter sentence' : issue.kind === 'answer' ? `Answer ${issue.index + 1}` : `Resume entry ${issue.index + 1}`;
const excerpt = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);

export function scopeRetryFeedback(issues) {
  if (!issues.length) return [];
  return [
    'Keep counts and number exactly as the sources state: a plural the evidence does not use is a scope stretch.',
    ...issues.map(issue => `${label(issue)}: "${issue.word}" must stay "${issue.singular}" unless the evidence states a count; the cited evidence says "${issue.singular}". Sentence: "${excerpt(issue.text)}"`),
  ];
}

export function scopeSuggestions(issues) {
  // Quote the line, never an index: a reviewer counting entries from zero would read
  // "Resume entry 2" as a different line and reject the note as false.
  return issues.map(issue => `Scope check (not a factual issue): ${issue.kind === 'cover' ? 'the cover-letter sentence' : issue.kind === 'answer' ? 'the answer' : 'the resume line'} "${excerpt(issue.text)}" says "${issue.word}" where its cited evidence says "${issue.singular}". Keep the singular or add evidence for more than one.`);
}
