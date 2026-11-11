// ATS check on the generated resume PDF. An applicant tracking system reads the text
// layer embedded in the PDF, not the rendered page. After the resume is rendered, this
// extracts that text (Poppler pdftotext, local) and checks it the way a parser sees it.
// Deterministic: no model calls. The posting text comes from providerDescription, never
// the raw description, and keywords the candidate cannot support are only ever reported
// as gaps, never suggested.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './agents.mjs';
import { providerDescription } from './posting-integrity.mjs';

export const INSTALL_HINT = 'Install Poppler (pdftotext) to check how an applicant tracking system reads your resume: sudo apt install poppler-utils, brew install poppler, or scoop install poppler.';

const squash = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const words = value => squash(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = value => String(value ?? '').replace(/\D+/g, '');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\/#-]/g, '\\$&');

// Does the term appear as a whole token (so "C" is not "Cassandra", "Java" is not "JavaScript")?
export function hasTerm(text, term) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

// ---- Check 1: contact details as literal text ----
function contactCheck(text, profile) {
  const flat = squash(text).toLowerCase();
  const missing = [];
  const name = squash(profile?.name).toLowerCase();
  if (name && !flat.includes(name) && !words(text).includes(words(name))) missing.push('name');
  const email = squash(profile?.email).toLowerCase().replace(/\s+/g, '');
  if (email && !flat.replace(/\s+/g, '').includes(email)) missing.push('email');
  const phone = digits(profile?.phone);
  if (phone.length >= 7 && !digits(text).includes(phone.slice(-10))) missing.push('phone');
  return missing.length
    ? { id: 'contact', label: 'Contact details', status: 'fail', detail: `Not found as text in the PDF: ${missing.join(', ')}. A tracking system may file your application without them.` }
    : { id: 'contact', label: 'Contact details', status: 'pass', detail: 'Name, email and phone are readable text.' };
}

// ---- Check 2: garbled glyphs ----
function garbledCheck(text) {
  const replacement = (text.match(/�/g) || []).length;
  const privateUse = (text.match(/[-]/g) || []).length;
  const cid = (text.match(/\(cid:\d+\)/g) || []).length;
  const odd = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length;
  const ratio = text.length ? odd / text.length : 0;
  const problems = [];
  if (replacement) problems.push(`${replacement} replacement character${replacement === 1 ? '' : 's'}`);
  if (privateUse) problems.push(`${privateUse} private-use glyph${privateUse === 1 ? '' : 's'}`);
  if (cid) problems.push(`${cid} unmapped font code${cid === 1 ? '' : 's'}`);
  if (ratio > 0.02) problems.push('many non-printable characters');
  return problems.length
    ? { id: 'garbled', label: 'Readable characters', status: 'fail', detail: `The text layer contains ${problems.join(', ')}. Icons or custom fonts may not survive a parser.` }
    : { id: 'garbled', label: 'Readable characters', status: 'pass', detail: 'No garbled glyphs in the text layer.' };
}

// ---- Check 3: reading order ----
// The first few words of each resume line should be found, mostly in increasing position.
// Multi-column bleed shows up as lines found out of order, or interleaved so they are lost.
function orderCheck(text, lines) {
  const hay = ` ${words(text)} `;
  const probes = lines.map(line => words(line).split(' ').filter(Boolean).slice(0, 6)).filter(w => w.length >= 3).map(w => w.join(' '));
  if (probes.length < 3) return { id: 'order', label: 'Reading order', status: 'skipped', detail: 'Too few lines to compare.' };
  const positions = probes.map(p => hay.indexOf(` ${p} `)).filter(i => i >= 0);
  const foundRatio = positions.length / probes.length;
  let ascending = 0;
  for (let i = 1; i < positions.length; i++) if (positions[i] > positions[i - 1]) ascending++;
  const orderRatio = positions.length > 1 ? ascending / (positions.length - 1) : 1;
  const good = foundRatio >= 0.7 && orderRatio >= 0.85;
  return good
    ? { id: 'order', label: 'Reading order', status: 'pass', detail: 'Lines read top to bottom in the order you wrote them.' }
    : { id: 'order', label: 'Reading order', status: 'fail', detail: `Only ${Math.round(foundRatio * 100)}% of lines were found intact and ${Math.round(orderRatio * 100)}% in order. Columns or tables may be interleaving when a parser reads the PDF.` };
}

// ---- Check 4: keyword coverage ----
const CUES = /\b(?:experience (?:with|in|using)|proficien(?:t|cy) (?:in|with)|familiar(?:ity)? with|knowledge of|skills? in|expertise in|hands-on with|working with|tools? (?:such as|like)|technologies (?:such as|like|including)|such as|including|e\.g\.,?|using)\s+([^.\n;:]{3,160})/gi;
const STOP = new Set(('a an the and or of to in on for with we you our your is are be as at by from this that these those will can may must should have has also etc more other any all new strong good great excellent ability able work team teams role roles job company years year experience skills skill knowledge understanding communication problem solving environment fast paced degree bachelor master students student equal opportunity employer us usa uk eu eeo pto id ok it hr ceo cto vp phd bs ms ba ma mba am pm ai i ii iii iv about what who why how when where while within across using use used such including include includes etc').split(' '));
const SHAPED = [
  /\b[A-Za-z][A-Za-z0-9]*(?:[.+#][A-Za-z0-9+#]+)+/g, // Node.js, C++, ASP.NET
  /\b[A-Za-z]{1,3}(?:\+\+|#)(?![A-Za-z])/g, // C++, C#
  /\b[A-Z]{2,3}\/[A-Z]{2,3}\b/g, // CI/CD, CAD/CAM
  /\b[a-z]+[A-Z][A-Za-z0-9]+\b/g, // iOS-style, camelCase
  /\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g, // JavaScript, PostgreSQL, SolidWorks
  /\b[A-Z]{2,6}\d?\b/g, // SQL, AWS, CAD, FEA
];
const clean = term => term.replace(/^[\s"'(\[]+|[\s"')\].,]+$/g, '').replace(/\.$/, '');
const plausible = term => {
  if (term.length < 2 || term.length > 40) return false;
  const parts = term.toLowerCase().split(/\s+/);
  if (parts.length > 3 || STOP.has(parts[0]) || STOP.has(parts.at(-1)) || parts.every(p => STOP.has(p))) return false;
  return /\p{L}/u.test(term);
};

export function extractKeywords(posting, { limit = 30 } = {}) {
  const text = providerDescription(posting ?? '');
  const seen = new Map();
  const add = raw => { const term = clean(raw); const key = term.toLowerCase(); if (plausible(term) && !seen.has(key)) seen.set(key, term); };
  for (const match of text.matchAll(CUES)) {
    for (const item of match[1].split(/\s+(?:is|are|will|would|can|should|must)\b/i)[0].split(/,|\band\b|\bor\b|\/|\bas well as\b|\(|\)/i)) add(item.trim());
  }
  for (const pattern of SHAPED) for (const match of text.matchAll(pattern)) add(match[0]);
  return [...seen.values()].slice(0, limit);
}

function keywordBuckets(text, posting, supportText) {
  const buckets = { covered: [], suggested: [], gaps: [] };
  for (const term of extractKeywords(posting)) {
    if (hasTerm(text, term)) buckets.covered.push(term);
    else if (supportText && hasTerm(supportText, term)) buckets.suggested.push(term);
    else buckets.gaps.push(term);
  }
  return buckets;
}

// The pure checker. text: the PDF's extracted text. profile: name/email/phone. lines: the
// resume's lines from the packet. posting: the job description (cleaned here). supportText:
// everything the candidate has actually said about themselves (sources, profile).
export function checkResumeText(text, { profile = {}, lines = [], posting = '', supportText = '', at = new Date().toISOString() } = {}) {
  const body = String(text ?? '');
  const checks = [];
  if (!squash(body)) checks.push({ id: 'text', label: 'Text layer', status: 'fail', detail: 'The PDF has no readable text. A tracking system would see an empty resume.' });
  else checks.push({ id: 'text', label: 'Text layer', status: 'pass', detail: 'The PDF contains selectable text.' });
  checks.push(contactCheck(body, profile), garbledCheck(body), orderCheck(body, lines));
  const keywords = keywordBuckets(body, posting, supportText);
  return { state: checks.some(c => c.status === 'fail') ? 'issues' : 'passed', checks, keywords, checkedAt: at };
}

// ---- Extraction ----
// Default reading order (no -layout), which is closest to what a parser sees.
export async function extractPdfText(pdf, { runner = runProcess } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'plainhand-ats-'));
  try {
    const file = path.join(dir, 'resume.pdf');
    await writeFile(file, pdf, { mode: 0o600 });
    try { return { text: (await runner('pdftotext', ['-enc', 'UTF-8', file, '-'], { timeout: 15000 })).stdout }; }
    catch (error) {
      if (error.code === 'ENOENT') return { unavailable: INSTALL_HINT };
      return { unavailable: 'Plainhand could not read the text layer of this PDF, so it was not checked.' };
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// Never throws: a missing tool or unreadable PDF is recorded as state "unavailable".
export async function atsCheckPdf(pdf, input = {}, { extract = extractPdfText } = {}) {
  const at = input.at || new Date().toISOString();
  try {
    const extracted = await extract(pdf);
    if (extracted.unavailable) return { state: 'unavailable', checks: [], keywords: { covered: [], suggested: [], gaps: [] }, hint: extracted.unavailable, checkedAt: at };
    return checkResumeText(extracted.text, { ...input, at });
  } catch {
    return { state: 'unavailable', checks: [], keywords: { covered: [], suggested: [], gaps: [] }, hint: 'The resume text check could not run.', checkedAt: at };
  }
}

// What the pre-submit list shows: only contact and garbling problems (and an empty text layer).
export function documentChecks(atsCheck) {
  return (atsCheck?.checks || []).filter(c => c.status === 'fail' && ['contact', 'garbled', 'text'].includes(c.id))
    .map(c => ({ key: `ats-${c.id}`, label: `Resume PDF: ${c.label.toLowerCase()}`, text: c.detail }));
}
