// Which credentials the candidate already holds are relevant to a posting, and
// whether the packet kept them. Lexical and deterministic: the posting's own words
// decide relevance, never a model. The table below is deliberately small and
// documented; it covers the certifications the evaluation corpus and live packets
// have shown (Kubernetes, accounting, investment, project, process improvement and
// data analytics), not every credential in the world.
import { credentialIdentity, credentialIndex, sourceCredentials } from './master-completeness.mjs';

const CREDENTIAL_WORD = /\b(?:certif\w*|licen[cs]\w*|certificate)\b/i;
const CREDENTIAL_SECTION = /certif|licen[cs]|certificate/i;
const DEGREE = /\b(?:bachelor|master(?:'s|s)?|mba|ph\.?d|doctor(?:al|ate)?|associate(?:'s|s)?|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree)\b/i;
// Identity words too generic to make a credential relevant on their own: they
// describe the document, not the field ("certified", "professional", "level").
const RELEVANCE_GENERIC = new Set([
  'certified', 'certification', 'certifications', 'certificate', 'certificates',
  'license', 'licenses', 'licence', 'licences', 'licensed', 'professional',
  'specialist', 'level', 'institute', 'active', 'since', 'earned', 'completed',
  'passed', 'registered', 'training', 'program', 'programme', 'course', 'courses',
]);

// credential: how the candidate's own entry names the credential.
// posting: the kind of work that makes that credential relevant.
export const CREDENTIAL_ASSOCIATIONS = [
  { credential: /\b(?:cka|cks|ckad|kubernetes)\b/i, posting: /\bkubernetes\b/i, kind: 'Kubernetes' },
  { credential: /\b(?:cpa|certified public accountant)\b/i, posting: /\b(?:accounting|accountant|audit|auditing|assurance|tax)\b/i, kind: 'CPA' },
  { credential: /\b(?:cfa|chartered financial analyst)\b/i, posting: /\b(?:investment|investments|valuation|equity|portfolio|financial analysis)\b/i, kind: 'CFA' },
  { credential: /\b(?:pmp|project management professional)\b/i, posting: /\bproject\b/i, kind: 'PMP' },
  { credential: /\b(?:six sigma|green belt|black belt)\b/i, posting: /\b(?:process improvement|quality|lean|continuous improvement)\b/i, kind: 'Six Sigma' },
  { credential: /\bdata analytics\b/i, posting: /\b(?:data|analytics)\b/i, kind: 'Data Analytics' },
];

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordHit = (word, text) => word && new RegExp(`(?:^|[^a-z0-9])${escape(word)}(?:[^a-z0-9]|$)`).test(text);

const heading = entry => entry?.heading && typeof entry.heading === 'object' ? entry.heading : {};

// The master resume's credential entries: certification, license and certificate
// sections, plus a credential line that sits elsewhere (the Google Data Analytics
// Certificate often lives under Education). Degrees are not credentials.
export function masterCredentials(master) {
  return (Array.isArray(master) ? master : []).flatMap(entry => {
    const h = heading(entry);
    const text = clean([entry?.text, h.org, h.title].filter(Boolean).join(' '));
    if (!text) return [];
    const named = CREDENTIAL_WORD.test(text);
    if (!named && !CREDENTIAL_SECTION.test(String(entry?.section ?? ''))) return [];
    if (!named && DEGREE.test(text)) return [];
    return [{ kind: 'credential', text, label: text }];
  });
}

export function credentialRelevant(text, postingText) {
  const posting = String(postingText ?? '').toLowerCase();
  if (!posting.trim()) return false;
  const { tokens } = credentialIdentity(text);
  if (tokens.some(token => token.length >= 3 && !RELEVANCE_GENERIC.has(token) && wordHit(token, posting))) return true;
  return CREDENTIAL_ASSOCIATIONS.some(rule => rule.credential.test(text) && rule.posting.test(posting));
}

function uniqueCredentials(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = clean(item.text).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Master credentials when the candidate approved a master; otherwise the same
// parse of their own sources, so a packet prepared before a master exists still
// keeps a credential the posting needs.
export function relevantMissingCredentials({ master = null, sources = [], packet = null, jobText = '' }) {
  const credentials = uniqueCredentials(master?.resume ? masterCredentials(master.resume) : sourceCredentials(sources));
  const resume = Array.isArray(packet?.resume) ? packet.resume : [];
  return credentials.filter(item => credentialRelevant(item.text, jobText) && !packetHasCredential(item, resume));
}

// Whether a packet's resume names a credential, decided by the credential's own
// name, not word overlap with the master's whole line. Overlap misread both ways: a
// split "Passed CFA Level I ...; Advanced Excel and SQL" line looked dropped, and
// "Google Sheets" plus "data analytics" looked like the Google Data Analytics
// Certificate. The own name is the line before its first comma, parenthesis or dash:
// "Project Management Professional (PMP), PMI, 2021" is "Project Management
// Professional", abbreviated "PMP"; "PMI" is the issuer and never stands in for it.
const LEADING_VERB = new Set(['passed', 'earned', 'completed', 'obtained', 'received', 'holds', 'hold', 'have', 'has', 'registered', 'active', 'i', 'a', 'an', 'the', 'my']);
const TRAILING_GENERIC = new Set(['certificate', 'certificates', 'certification', 'certifications', 'license', 'licence', 'licenses', 'licences', 'credential']);
const NOT_ACRONYM = new Set(['I', 'II', 'III', 'IV', 'US', 'USA', 'UK', 'LLC', 'INC', 'LTD', 'PLC', 'LLP', 'GMBH']);
const ACRONYM_SECTION = /certif|licen[cs]|credential|education|training|professional development/i;
const normalizedText = value => ` ${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const entryLine = entry => [entry?.text, entry?.heading?.org, entry?.heading?.title].filter(Boolean).join(' ');
export function credentialName(text) {
  // An issuer written first ("(ISC)2 CISSP, 2021") is not the name.
  const value = clean(text).replace(/^\([^)]*\)\S*\s*/, '');
  const own = value.split(/\s*[,(;]\s*|\s+[—–-]\s+/)[0] || value;
  // Generic trailing words ("PE license", "CPA license") are not part of the name.
  const ownWords = own.split(/\s+/).filter(Boolean);
  while (ownWords.length > 1 && TRAILING_GENERIC.has(ownWords.at(-1).toLowerCase())) ownWords.pop();
  const isAcronym = word => /^[A-Z][A-Z0-9-]{1,7}$/.test(word) && !NOT_ACRONYM.has(word);
  // Its abbreviations: the parenthesised group right after the own name ("(PMP)",
  // "(ASQ CSSGB)"), every acronym of an all-acronym name ("PMP", "PE license"), and an
  // acronym after the first word ("Kubernetes CKA", "Passed CFA Level I"). A first-word
  // acronym in a longer name is a prefix ("AWS Certified Solutions Architect"), and an
  // issuer field after a comma ("PMI", "(ISC)2") is never the credential.
  // A parenthesised designation follows a word ("Professional (PMP)", "ASQ (CSSGB)");
  // a group standing alone in its field ("(ISC)2") is the issuer. A spaced group is
  // written issuer first ("ASQ CSSGB", "IASSC LSSBB", "PMI PMP"): its last token is the
  // designation.
  const paren = [...value.matchAll(/([A-Za-z])\s*\(([^)]*)\)/g)].flatMap(match => {
    const tokens = match[2].split(/[\s/]+/).filter(isAcronym);
    return tokens.length ? [tokens.at(-1)] : [];
  });
  const ownIsAcronym = ownWords.length >= 1 && ownWords.every(isAcronym);
  const inner = ownIsAcronym ? ownWords : ownWords.slice(1).filter(isAcronym);
  const acronyms = [...new Set([...paren, ...inner])];
  // Its written-out name: the longest capitalised run of the own name, without a
  // leading verb (while two words remain, so "Registered Nurse" stays) or a trailing
  // generic word, matched as one contiguous phrase within a single resume line
  // ("Google Data Analytics Professional Certificate" holds "Google Data Analytics";
  // "led project management" does not hold "Project Management Professional").
  const runs = [...ownWords.join(' ').matchAll(/\b[A-Z][A-Za-z0-9&+-]*(?:\s+(?:of|and|&|in|for)?\s*[A-Z][A-Za-z0-9&+-]*)*/g)].map(match => {
    const words = match[0].split(/\s+/);
    while (words.length > 2 && LEADING_VERB.has(words[0].toLowerCase())) words.shift();
    while (words.length && TRAILING_GENERIC.has(words.at(-1).toLowerCase())) words.pop();
    return words.join(' ');
  }).filter(run => run.split(' ').length >= 2 && !run.split(' ').every(isAcronym));
  const phrase = runs.sort((a, b) => b.length - a.length)[0] || '';
  return { acronyms, phrase };
}
export function packetHasCredential(item, resume) {
  const entries = Array.isArray(resume) ? resume : [];
  const lines = entries.map(entry => normalizedText(entryLine(entry)));
  // The same line, copied.
  const whole = normalizedText(item?.text);
  if (whole.trim() && lines.some(line => line.includes(whole))) return true;
  const { acronyms, phrase } = credentialName(item?.text);
  if (phrase && lines.some(line => line.includes(normalizedText(phrase)))) return true;
  // Its own abbreviation counts where credentials or schooling are listed: "AWS" or
  // "PMP" in a Skills list is a keyword, not the credential.
  if (acronyms.length && entries.some((entry, index) => (ACRONYM_SECTION.test(String(entry?.section ?? '')) || CREDENTIAL_WORD.test(entryLine(entry)))
    && acronyms.some(acronym => lines[index].includes(` ${acronym.toLowerCase()} `)))) return true;
  if (phrase || acronyms.length) return false;
  // No name could be read: only a credential entry may hold it.
  return credentialIndex(item, entries.filter(entry => ACRONYM_SECTION.test(String(entry?.section ?? '')) || CREDENTIAL_WORD.test(entryLine(entry)))) >= 0;
}

// The approved master's own rows for the given missing credentials, matched by the
// same text masterCredentials reads, so the packet can carry the row (with its
// heading and exact source quote) instead of shipping without a needed credential.
export function masterCredentialRows(masterResume, items) {
  const wanted = new Set((Array.isArray(items) ? items : []).map(item => clean(item?.text).toLowerCase()));
  return (Array.isArray(masterResume) ? masterResume : []).filter(entry => {
    const found = masterCredentials([entry])[0];
    return found && wanted.has(clean(found.text).toLowerCase());
  });
}

export function credentialRetryFeedback(items) {
  if (!items.length) return [];
  return [
    'A credential the posting names or relates to is missing from the resume: keep each one.',
    ...items.map(item => `Keep the relevant credential: ${clean(item.label || item.text)}`),
  ];
}

export function credentialSuggestion(item) {
  return `Left out: ${clean(item.label || item.text)}. It relates to this posting, so a resume line naming it would strengthen the application.`;
}
