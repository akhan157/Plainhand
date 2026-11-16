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

// Whether a packet's resume names a credential. Word overlap with the master's whole
// line misreads both ways: a packet that splits "Passed CFA Level I ...; Advanced
// Excel and SQL" across lines looks like it dropped the CFA, and "Google Sheets" plus
// "data analytics" in Skills looks like the Google Data Analytics Certificate. So the
// credential's own name decides: its acronyms (CFA, CPA, CKS) anywhere in the resume,
// or else its capitalised name, without generic words, as one phrase.
const LEADING_VERB = new Set(['passed', 'earned', 'completed', 'obtained', 'received', 'holds', 'hold', 'have', 'has', 'registered', 'active', 'certified']);
const NOT_ACRONYM = new Set(['I', 'II', 'III', 'IV', 'US', 'USA', 'UK']);
const normalizedText = value => ` ${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
export function credentialName(text) {
  const value = String(text ?? '');
  const acronyms = [...new Set([...value.matchAll(/\b([A-Z]{2,6})\b/g)].map(match => match[1]).filter(word => !NOT_ACRONYM.has(word)))];
  const runs = [...value.matchAll(/\b[A-Z][A-Za-z0-9&+-]*(?:\s+(?:of|and|&|in|for)?\s*[A-Z][A-Za-z0-9&+-]*)*/g)].map(match => match[0]
    .split(/\s+/).filter(word => !LEADING_VERB.has(word.toLowerCase()) && !RELEVANCE_GENERIC.has(word.toLowerCase())).join(' '))
    .filter(run => run.split(' ').length >= 2);
  const phrase = runs.sort((a, b) => b.length - a.length)[0] || '';
  return { acronyms, phrase };
}
export function packetHasCredential(item, resume) {
  const entries = Array.isArray(resume) ? resume : [];
  const textOf = list => normalizedText(list.map(entry => [entry?.text, entry?.heading?.org, entry?.heading?.title].filter(Boolean).join(' ')).join(' | '));
  const { acronyms, phrase } = credentialName(item?.text);
  // The written-out name anywhere is the credential.
  if (phrase && textOf(entries).includes(normalizedText(phrase))) return true;
  // An acronym counts only where credentials are listed: "AWS" in Skills is a tool,
  // not the AWS certification. Any one of the line's acronyms is enough, since a
  // master line also names its issuer or exam code (PMP, PMI; CSSGB).
  if (acronyms.length) {
    const credentialText = textOf(entries.filter(entry => CREDENTIAL_SECTION.test(String(entry?.section ?? '')) || CREDENTIAL_WORD.test([entry?.text, entry?.heading?.org, entry?.heading?.title].filter(Boolean).join(' '))));
    if (acronyms.some(acronym => credentialText.includes(` ${acronym.toLowerCase()} `))) return true;
  }
  if (phrase || acronyms.length) return false;
  return credentialIndex(item, entries) >= 0;
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
