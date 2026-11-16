// What the master resume missed.
//
// The master resume is the complete record of what the candidate has done, so
// "did the draft keep everything?" is a question about the candidate's own
// resume and stories, not about wording. This module reads the roles,
// credentials, degrees and number-bearing results out of those sources with the
// same deterministic heading parser the scorer uses (parseDates), then asks
// whether each item appears in the master. A present item reports the master
// entry index it was found in; a missing item is named, so the profile can list
// it instead of silently losing it.
//
// Lexical and deterministic by design: no model decides coverage, so the same
// sources and master always produce the same answer. It is a completeness check,
// not a rewrite: a missing item is reported, never invented into the master.

import { parseDates } from './evaluation/roles.mjs';

const RESUME_SOURCE_IDS = new Set(['cv', 'structured-resume']);
const STORY_SOURCE_IDS = new Set(['interview', 'stories', 'narrative', 'proof-points', 'profile']);
const SEPARATOR = /\s+[—–]\s+|\s+-\s+/;
const GAP_HEADING = /^(?:career break|career gap|family care|parental leave|sabbatical|break|time off|gap)\b/i;
const DEGREE = /\b(?:bachelor|master(?:'s|s)?|mba|ph\.?d|doctor(?:al|ate)?|associate(?:'s|s)?|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree)\b/i;
const CREDENTIAL_HINT = /\b(?:certif\w*|licen[cs]\w*|chartered|six sigma|green belt|accreditation)\b/i;
const DEGREE_WORDS = new Set(['bachelor', 'bachelors', 'master', 'masters', 'doctoral', 'doctor', 'doctorate', 'associate', 'associates', 'philosophy', 'degree', 'major', 'minor']);
const CREDENTIAL_GENERIC = new Set(['certified', 'certification', 'certifications', 'certificate', 'licence', 'licenses', 'license', 'licensed', 'active', 'since', 'earned', 'completed', 'professional', 'the', 'and', 'of', 'in', 'for', 'with', 'year', 'years', 'credential', 'credentials']);
// Contact data is never an accomplishment, even when it carries digits.
const CONTACT = /@|https?:\/\/|\+?\d[\d\s().-]{7,}\d/;
// A bare four-digit year is a date, not a result; "2018 to 2019" alone is not a
// number-bearing result a master must repeat.
const YEAR_ONLY = /^(?:19|20)\d{2}$/;

const clean = value => String(value ?? '').trim();
const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const normalizedLine = value => normalize(value).replace(/\s+/g, ' ');

// Content words: long enough to carry meaning, or a number. Shared with the
// existing lexical coverage check, so the two views agree about what a phrase
// is about.
const contentWords = text => (String(text || '').toLowerCase().match(/[a-z0-9%$&+#.]+/g) || []).map(w => w.replace(/^\.+|\.+$/g, '')).filter(w => w.length >= 4 || /\d/.test(w));

// Identity words for credentials and degrees: short acronyms and field names
// count, generic credential words and years do not.
function identityTokens(text) {
  return (String(text || '').match(/[A-Za-z][A-Za-z0-9&+#.-]*|\d[\d,]*/g) || [])
    .map(token => token.toLowerCase().replace(/^[.-]+|[.,]+$/g, ''))
    .filter(token => token && token.length >= 2 && !CREDENTIAL_GENERIC.has(token) && !YEAR_ONLY.test(token));
}
const acronymsOf = text => [...new Set([...String(text || '').matchAll(/\b([A-Z]{2,6})\b/g)].map(match => match[1].toLowerCase()))];

function numbersOf(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || [])
    .map(token => token.replace(/,/g, '').replace(/\.$/, ''))
    .filter(token => !YEAR_ONLY.test(token));
}
const allNumbers = text => new Set((String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(token => token.replace(/,/g, '').replace(/\.$/, '')));
const isNumberBearing = text => !CONTACT.test(text) && numbersOf(text).length > 0;

// A line that is only a section label ("Experience", "## Certifications:").
function sectionOf(line) {
  const value = clean(line).replace(/^[#>\s*•·\-–—▪◦]+/, '').replace(/[:.]+$/, '').trim().toLowerCase();
  if (!value) return null;
  if (/^(?:experience|employment(?: history)?|work history|professional experience)$/.test(value)) return 'experience';
  if (/^(?:education|training)$/.test(value)) return 'education';
  if (/^(?:certifications?|licen[cs]e?s?|licenses? & certifications|licenses? and certifications|certificates?)$/.test(value)) return 'credentials';
  if (/^(?:projects?|publications?|papers?|awards?|honou?rs?|volunteer\w*)$/.test(value)) return 'other';
  if (/^(?:summary|profile|skills?|interests?|languages?|references?)$/.test(value)) return 'skip';
  return null;
}

const stripLine = line => clean(line).replace(/^[#>\s*•·\-–—▪◦]+/, '').trim();
const splitHeading = line => line.split(SEPARATOR).map(part => part.trim()).filter(Boolean);

function roleItem(parts, sourceId) {
  const dates = parts.at(-1);
  const parsed = parseDates(dates);
  if (!parsed) return null;
  const org = parts[0] || '';
  const title = parts.length >= 3 ? parts[1] : '';
  if (GAP_HEADING.test(org) || GAP_HEADING.test(title)) return { gap: true };
  return { kind: 'role', org, title, dates, start: parsed.start, end: parsed.end, ongoing: parsed.ongoing, label: parts.join(' — '), sourceId };
}

// The roles, credentials, degrees and numbered results the candidate's own
// resume states. Roles are the lines whose last field parses as dates; a dated
// career break is a gap, never a job.
function resumeItems(text, sourceId, items) {
  let section = '';
  let role = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = stripLine(raw);
    if (!line) continue;
    const next = sectionOf(line);
    if (next) { section = next; role = null; continue; }
    if (section === 'experience') {
      const parts = splitHeading(line);
      const heading = parts.length >= 2 ? roleItem(parts, sourceId) : null;
      if (heading) {
        role = heading.gap ? null : heading;
        if (role) items.roles.push(role);
        continue;
      }
      if (role && isNumberBearing(line)) items.results.push({ kind: 'result', text: line, role: role.label, sourceId });
      continue;
    }
    if (section === 'education' || section === 'credentials') {
      if (!isNumberBearing(line) && !DEGREE.test(line) && !CREDENTIAL_HINT.test(line)) continue;
      const parts = splitHeading(line);
      const label = parts.length >= 2 ? parts.join(' — ') : line;
      if (DEGREE.test(line) || section === 'education') items.degrees.push({ kind: 'degree', text: line, label, sourceId });
      else items.certifications.push({ kind: 'credential', text: line, label, sourceId });
      continue;
    }
    if (section === 'other' && isNumberBearing(line)) items.results.push({ kind: 'result', text: line, role: null, sourceId });
  }
}

// Stories and conversation: numbered results and credentials the candidate
// told the app, in their own words. Headings and questions are not claims.
function storyItems(text, sourceId, items) {
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(raw.trim())) continue;
    // One conversation message can carry several facts. A sentence is the
    // smallest claim a master line can be expected to repeat.
    for (const sentence of stripLine(raw).split(/(?<=[.!?])\s+/)) {
      const line = sentence.trim();
      if (!line || line.endsWith('?')) continue;
      if (isNumberBearing(line)) items.results.push({ kind: 'result', text: line, role: null, sourceId });
      if (DEGREE.test(line) && !CONTACT.test(line)) {
        const parts = splitHeading(line);
        const label = parts.length >= 2 ? parts.join(' — ') : line;
        items.degrees.push({ kind: 'degree', text: line, label, sourceId });
      } else if (CREDENTIAL_HINT.test(line) && !CONTACT.test(line)) {
        const parts = splitHeading(line);
        const label = parts.length >= 2 ? parts.join(' — ') : line;
        items.certifications.push({ kind: 'credential', text: line, label, sourceId });
      }
    }
  }
}

function sourceText(source) {
  if (source?.id === 'profile') {
    try { return clean(JSON.parse(source.text)?.story); } catch { return ''; }
  }
  return clean(source?.text);
}

function unique(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function sourceCompletenessItems(sources) {
  const items = { roles: [], certifications: [], degrees: [], results: [] };
  for (const source of Array.isArray(sources) ? sources : []) {
    const text = sourceText(source);
    if (!text) continue;
    if (RESUME_SOURCE_IDS.has(source.id)) resumeItems(text, source.id, items);
    else if (STORY_SOURCE_IDS.has(source.id)) storyItems(text, source.id, items);
  }
  items.roles = unique(items.roles, role => `${normalize(role.org)}|${normalize(role.title)}|${role.start}|${role.end ?? 'present'}|${role.ongoing}`);
  items.certifications = unique(items.certifications, item => normalizedLine(item.text));
  items.degrees = unique(items.degrees, item => normalizedLine(item.text));
  items.results = unique(items.results, item => normalizedLine(item.text));
  return items;
}

const entryHeading = entry => entry?.heading && typeof entry.heading === 'object' ? entry.heading : {};
const entryText = entry => {
  const heading = entryHeading(entry);
  return [entry?.text, entry?.section, heading.org, heading.title, heading.location, heading.dates].filter(Boolean).join(' ');
};

// A source field appears in a master field when it is equal, or when the master
// adds to it ("Example Health Devices, Inc.", "Senior Platform Engineer, ML
// Infrastructure"). A shorter master field does not count.
function fieldPresent(expected, actual) {
  const want = normalize(expected), have = normalize(actual);
  return Boolean(want && have) && (want === have || have.includes(want));
}

function roleIndex(role, master) {
  return master.findIndex(entry => {
    const heading = entryHeading(entry);
    if (!heading.org && !heading.title) return false;
    if (!fieldPresent(role.org, heading.org)) return false;
    if (role.title && !fieldPresent(role.title, heading.title)) return false;
    if (role.dates) {
      const dates = parseDates(heading.dates);
      if (!dates || dates.start !== role.start) return false;
      if (role.ongoing ? !dates.ongoing : dates.ongoing || dates.end !== role.end) return false;
    }
    return true;
  });
}

function resultIndex(result, master) {
  const need = [...new Set(contentWords(result.text))];
  if (!need.length) return -1;
  const numbers = numbersOf(result.text);
  return master.findIndex(entry => {
    const text = entryText(entry), have = new Set(contentWords(text));
    const hit = need.filter(word => have.has(word)).length / need.length;
    if (hit < 0.6) return false;
    const presentNumbers = allNumbers(text);
    return numbers.every(number => presentNumbers.has(number));
  });
}

function credentialIndex(item, master) {
  const acronyms = acronymsOf(item.text);
  const need = [...new Set(identityTokens(item.text))];
  return master.findIndex(entry => {
    const text = entryText(entry), have = new Set(identityTokens(text));
    if (acronyms.length && acronyms.every(acronym => have.has(acronym))) return true;
    return need.length ? need.filter(token => have.has(token)).length / need.length >= 0.7 : false;
  });
}

function degreeIndex(item, master) {
  const parts = splitHeading(item.text);
  const org = parts.length >= 2 ? parts[0] : '';
  const program = parts.length >= 3 ? parts.slice(1, -1).join(' ') : parts.length === 2 ? parts[1] : item.text;
  const fields = [...new Set(identityTokens(program).filter(token => !DEGREE_WORDS.has(token)))];
  return master.findIndex(entry => {
    const text = entryText(entry);
    if (org && !fieldPresent(org, entryHeading(entry).org) && !normalize(text).includes(normalize(org))) return false;
    const have = new Set(identityTokens(text));
    if (!fields.length) return !org || normalize(text).includes(normalize(org));
    const hits = fields.filter(token => have.has(token)).length;
    // A degree is present when its institution and at least one field token are
    // there; without an institution, most of its field words must be.
    return org ? hits >= 1 : hits / fields.length >= 0.6;
  });
}

const outcome = (item, index) => ({ ...item, present: index >= 0, index: index >= 0 ? index : null });

// `sources` is the app's candidate-source list ({id, text}), the same list the
// drafter and reviewer see. `master` is the master draft's resume array.
export function masterCompleteness(sources, master) {
  const entries = Array.isArray(master) ? master : [];
  const source = sourceCompletenessItems(sources);
  const roles = source.roles.map(item => outcome(item, roleIndex(item, entries)));
  const certifications = source.certifications.map(item => outcome(item, credentialIndex(item, entries)));
  const degrees = source.degrees.map(item => outcome(item, degreeIndex(item, entries)));
  const results = source.results.map(item => outcome(item, resultIndex(item, entries)));
  const items = [...roles, ...certifications, ...degrees, ...results];
  const missing = items.filter(item => !item.present).map(item => ({ ...item, label: item.label || item.text }));
  const count = group => ({ total: group.length, present: group.filter(item => item.present).length, missing: group.filter(item => !item.present).length });
  return {
    roles, certifications, degrees, results, items, missing,
    counts: {
      total: items.length,
      present: items.length - missing.length,
      missing: missing.length,
      roles: count(roles),
      certifications: count(certifications),
      degrees: count(degrees),
      results: count(results),
    },
  };
}
