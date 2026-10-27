// Grounding and rule checks for follow-up drafts. Pure functions: no I/O, no model.
// The sources are the only facts a follow-up may state: the submitted packet, the
// application record (role, submission, recipient, interview rounds) and the
// candidate's own notes for this message. A recruiter's pasted message is shown to
// the model as untrusted data; it may be mentioned (a date they proposed) but never
// cited as evidence for a claim about the candidate.
import { recordOf } from '../../application-record.mjs';

export const KINDS = ['thank-you', 'check-in', 'reply'];
export const KIND_LABELS = { 'thank-you': 'Thank-you note', 'check-in': 'Check-in', reply: 'Reply' };
export const CHANNELS = ['email', 'linkedin', 'portal', 'phone', 'other'];
// Body length in words, per kind. The lower bound catches empty or truncated drafts.
export const LENGTH = { 'thank-you': [25, 170], 'check-in': [25, 160], reply: [12, 220] };
// Phrases the repository's writing rules and the humanizer audit reject outright.
export const BANNED_PHRASES = ['just checking in', 'just following up', 'just wanted to follow up', 'touching base', 'touch base', 'circling back', 'circle back', 'hope this email finds you well', 'hope this message finds you well', 'hope this finds you well', 'i am writing to express', 'delve', 'thrilled', 'esteemed', 'synergy', 'testament to', 'fast-paced world', "don't hesitate to reach out", 'do not hesitate to reach out', 'rest assured', 'i am confident that i would be a great fit', 'passionate about'];
const GENERIC_ADDRESSEE = new Set(['team', 'hiring', 'recruiting', 'talent', 'acquisition', 'there', 'all', 'everyone', 'folks', 'the', 'and', 'manager', 'committee', 'panel', 'mr', 'mrs', 'ms', 'mx', 'dr']);
const CLOSINGS = /^(best|best regards|kind regards|regards|warm regards|warmly|thanks|thank you|many thanks|thanks again|sincerely|cheers|all the best|with thanks|respectfully)[,!.]?$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const words = text => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
const lower = value => String(value || '').toLowerCase();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsWord = (haystack, needle) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(lower(needle))}($|[^\\p{L}\\p{N}])`, 'u').test(lower(haystack));

// The sources a follow-up may cite, each with a stable id the evidence refers to.
export function followupSources(job, { recipient = null, notes = '' } = {}) {
  const sources = [];
  const add = (id, label, text) => { if (typeof text === 'string' && text.trim()) sources.push({ id, label, text: text.trim() }); };
  const packet = job.packet || {};
  add('packet.headline', 'Packet headline', packet.headline);
  (packet.resume || []).forEach((entry, i) => add(`packet.resume.${i + 1}`, `Resume · ${entry.section || 'entry'}`, entry.text));
  (packet.answers || []).forEach((entry, i) => add(`packet.answer.${i + 1}`, `Answer · ${String(entry.question || '').slice(0, 60)}`, `${entry.question}\n${entry.answer}`));
  add('packet.coverLetter', 'Cover letter', packet.coverLetter);
  const submitted = String(job.submittedAt || '').slice(0, 10);
  add('record.application', 'Application record', `Application for ${job.title} at ${job.company}.${submitted ? ` Submitted on ${submitted}.` : ''}${job.status ? ` Status: ${job.status}.` : ''}`);
  if (recipient) add('record.recipient', 'Recipient', `Recipient: ${recipient.name}${recipient.role ? `, ${recipient.role}` : ''} (${recipient.type}) at ${job.company}.`);
  for (const round of recordOf(job).interviews) {
    if (round.status === 'canceled') continue;
    add(`record.interview.${round.id}`, `Interview · ${round.stage}`, `Interview round: ${round.stage} on ${round.date}, ${round.status}${round.interviewer ? `, with ${round.interviewer}` : ''}.`);
  }
  add('notes', 'Your notes', notes);
  return sources;
}

export function hasFollowupEvidence(claim, sources) {
  return Array.isArray(claim?.evidence) && claim.evidence.length > 0 && claim.evidence.length <= 8 && claim.evidence.every(e => e && typeof e.quote === 'string' && e.quote.trim().length >= 8 && sources.some(s => s.id === e.sourceId && s.text.includes(e.quote)));
}

// Calendar dates written in a text, as month-day keys ("10-23"), plus weekdays named.
export function datesIn(text) {
  const found = [];
  const source = String(text || '');
  for (const m of source.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push({ key: `${Number(m[2])}-${Number(m[3])}`, text: m[0] });
  for (const m of source.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'))) found.push({ key: `${MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1}-${Number(m[2])}`, text: m[0] });
  for (const m of source.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, 'gi'))) found.push({ key: `${MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1}-${Number(m[1])}`, text: m[0] });
  for (const m of source.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) found.push({ key: `${Number(m[1])}-${Number(m[2])}`, text: m[0] });
  return found;
}
function weekdaysOfIsoDates(text) {
  const days = new Set();
  for (const m of String(text || '').matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) { const d = new Date(m[1] + 'T12:00:00Z'); if (!Number.isNaN(d.getTime())) days.add(WEEKDAYS[d.getUTCDay()]); }
  return days;
}

function greetingOf(body) {
  const first = String(body || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  const match = /^(hi|hello|dear|hey|good (?:morning|afternoon|evening)|greetings)\b[\s,]*(.*?)[\s,!:.;—-]*$/i.exec(first);
  return match ? { line: first, addressee: match[2].trim() } : null;
}
function signoffOf(body) {
  const lines = String(body || '').split('\n').map(l => l.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  if (lines.length < 2 || CLOSINGS.test(last) || /[.!?:;]$/.test(last) || words(last).length > 4) return null;
  return last;
}

// Rule checks Plainhand applies to every draft, revision and final text. Each issue is a
// plain sentence shown to the candidate when a draft is blocked.
export function checkFollowup(message, { kind, job, recipient, sources, candidateName = '', recruiterMessage = '', otherCompanies = [] }) {
  const issues = [];
  const subject = typeof message?.subject === 'string' ? message.subject.trim() : '';
  const body = typeof message?.body === 'string' ? message.body.trim() : '';
  const text = `${subject}\n${body}`;
  if (!subject || subject.length > 140 || /\n/.test(subject)) issues.push('The subject line must be one line of at most 140 characters.');
  const count = words(body).length, [min, max] = LENGTH[kind] || [12, 220];
  if (count < min) issues.push(`The message is too short for a ${KIND_LABELS[kind] || kind} (${count} words; at least ${min}).`);
  if (count > max) issues.push(`The message is too long for a ${KIND_LABELS[kind] || kind} (${count} words; at most ${max}).`);
  const claims = Array.isArray(message?.claims) ? message.claims : [];
  if (!claims.length) issues.push('The draft lists no claims with evidence.');
  for (const claim of claims) if (!hasFollowupEvidence(claim, sources)) issues.push(`This claim has no exact quote from the packet or the application record: “${String(claim?.text || '').slice(0, 160)}”.`);
  // The company and role must be the record's; another tracked company must not appear.
  if (!containsWord(text, job.company)) issues.push(`The message does not name the company as recorded (${job.company}).`);
  const allowedText = lower([...sources.map(s => s.text), job.company, job.title, recipient?.name || '', candidateName, recruiterMessage].join('\n'));
  for (const other of otherCompanies) {
    if (!other || other.length < 3 || lower(job.company).includes(lower(other)) || containsWord(allowedText, other)) continue;
    if (containsWord(text, other)) issues.push(`The message names ${other}, a different company in your workspace. This application is with ${job.company}.`);
  }
  // Addressing: only the recipient chosen from the record, or the team when none was chosen.
  const greeting = greetingOf(body);
  if (greeting) {
    const named = words(greeting.addressee).filter(w => !GENERIC_ADDRESSEE.has(lower(w)) && !words(job.company).some(c => lower(c) === lower(w)));
    const allowed = new Set(words(recipient?.name || '').map(lower));
    const stray = named.filter(w => !allowed.has(lower(w)));
    if (recipient && !named.some(w => allowed.has(lower(w)))) issues.push(`The greeting (“${greeting.line}”) is not addressed to ${recipient.name}, the recipient you chose.`);
    else if (stray.length) issues.push(recipient ? `The greeting (“${greeting.line}”) names someone other than ${recipient.name}.` : `No recipient was chosen, but the greeting (“${greeting.line}”) names a person. Choose the contact from the record or greet the team.`);
  } else if (recipient && !containsWord(body, words(recipient.name)[0] || recipient.name)) issues.push(`The message is not addressed to ${recipient.name}, the recipient you chose.`);
  const signoff = signoffOf(body);
  if (signoff && candidateName && !words(signoff).some(w => words(candidateName).some(n => lower(n) === lower(w)))) issues.push(`The message is signed “${signoff}”, not with your name.`);
  // Dates, weekdays, numbers, links and addresses must come from the sources (or, for a
  // date or time the recruiter proposed, from their message).
  const mentionable = [...sources.map(s => s.text), job.company, job.title, recipient?.name || '', recruiterMessage].join('\n');
  const allowedDates = new Set(datesIn(mentionable).map(d => d.key));
  const dateMatches = datesIn(text);
  for (const date of dateMatches) if (!allowedDates.has(date.key)) issues.push(`The date “${date.text}” is not in the packet, the record or the message you pasted.`);
  const weekdays = weekdaysOfIsoDates(mentionable);
  for (const day of WEEKDAYS) if (containsWord(text, day) && !containsWord(mentionable, day) && !weekdays.has(day)) issues.push(`“${day[0].toUpperCase() + day.slice(1)}” does not match any date in the record or the message you pasted.`);
  let numeric = text;
  for (const date of dateMatches) numeric = numeric.replace(date.text, ' ');
  for (const m of numeric.matchAll(/\d+(?:[.,]\d+)*%?/g)) {
    const token = m[0].replace(/[.,]$/, '');
    if (!new RegExp(`(^|[^\\d])${escapeRegex(token)}($|[^\\d])`).test(mentionable)) issues.push(`The number “${token}” is not in the packet or the record.`);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]]+|[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi)) if (!lower(mentionable).includes(lower(m[0]).replace(/[.,;]$/, ''))) issues.push(`“${m[0]}” is not a link or address from your packet or record.`);
  if (/\[[^\]]*\]|\{[^}]*\}|<[^>]+>|\bTBD\b|\bX{2,}\b|lorem ipsum/i.test(text)) issues.push('The message contains a placeholder.');
  for (const phrase of BANNED_PHRASES) if (lower(text).includes(phrase)) issues.push(`Remove “${phrase}”: it reads as filler or AI-written.`);
  if ((body.match(/—/g) || []).length > 2) issues.push('Too many em dashes; write plain sentences.');
  if (/\b(i have sent|i've sent|sent you)\b.*\b(already)\b/i.test(body)) issues.push('The message claims something was already sent.');
  return [...new Set(issues)];
}

// Business days after a calendar date (weekends skipped), as YYYY-MM-DD.
export function addBusinessDays(iso, days) {
  const date = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  let left = days;
  while (left > 0) { date.setUTCDate(date.getUTCDate() + 1); if (![0, 6].includes(date.getUTCDay())) left--; }
  return date.toISOString().slice(0, 10);
}
export function businessDaysBetween(fromIso, toIso) {
  const from = new Date(String(fromIso).slice(0, 10) + 'T12:00:00Z'), to = new Date(String(toIso).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 0;
  let count = 0;
  for (const d = new Date(from); d < to;) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) count++; }
  return count;
}
