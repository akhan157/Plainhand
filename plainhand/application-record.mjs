import { randomUUID } from 'node:crypto';

// The people, interview rounds and next step for one exact company and role.
// It lives on the job under `record`, so it cannot drift onto another role, and
// it is stripped before every provider call: contacts are third parties and
// interview notes are not candidate evidence.
// Field names follow application-timeline.mjs canonicalContact/canonicalInterview.

export const CONTACT_TYPES = ['recruiter', 'hiring manager', 'interviewer', 'referral', 'other'];
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'canceled'];
export const ACTIVE_STATUSES = ['Applied', 'Responded', 'Interview', 'Offer'];
const LIMIT = 30;

const today = () => new Date().toISOString().slice(0, 10);
function text(value, label, max, { required = false, multiline = false } = {}) {
  const raw = String(value ?? '');
  const result = (multiline ? raw.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n') : raw.replace(/\s+/g, ' ')).trim();
  if (required && !result) throw new Error(`Add the ${label}.`);
  if (result.length > max) throw new Error(`The ${label} is too long.`);
  return result || null;
}
export function calendarDate(value, label, { required = false } = {}) {
  const result = String(value ?? '').trim();
  if (!result) { if (required) throw new Error(`Add the ${label}.`); return null; }
  const parsed = new Date(result + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(`Record the ${label} as a real date (YYYY-MM-DD).`);
  return result;
}
function choice(value, options, fallback, label) {
  const result = String(value || fallback).trim().toLowerCase();
  if (!options.includes(result)) throw new Error(`Choose a valid ${label}.`);
  return result;
}

export function recordOf(job) {
  const record = job?.record || {};
  return {
    contacts: Array.isArray(record.contacts) ? record.contacts : [],
    interviews: Array.isArray(record.interviews) ? record.interviews : [],
    nextAction: record.nextAction?.text ? record.nextAction : null,
  };
}
function writable(job) { return (job.record = recordOf(job)); }

export function addContact(job, input, { id = randomUUID(), at = new Date().toISOString() } = {}) {
  const record = writable(job);
  if (record.contacts.length >= LIMIT) throw new Error('This application already has the maximum number of contacts.');
  const email = text(input?.email, 'email', 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address or leave it empty.');
  const linkedin = text(input?.linkedin, 'profile link', 500);
  if (linkedin) { let url; try { url = new URL(linkedin); } catch {} if (url?.protocol !== 'https:') throw new Error('Use an https:// profile link or leave it empty.'); }
  const contact = {
    id, name: text(input?.name, 'contact name', 200, { required: true }), role: text(input?.role, 'contact role', 200),
    type: choice(input?.type, CONTACT_TYPES, 'recruiter', 'contact type'), email, phone: text(input?.phone, 'phone', 50), linkedin,
    notes: text(input?.notes, 'contact notes', 2000, { multiline: true }), date: at.slice(0, 10), addedAt: at,
  };
  const key = c => `${c.name.toLowerCase()}\0${(c.email || '').toLowerCase()}`;
  if (record.contacts.some(c => key(c) === key(contact))) throw new Error('This contact is already recorded for this application.');
  record.contacts.push(contact);
  return contact;
}

export function addInterview(job, input, { id = randomUUID(), at = new Date().toISOString() } = {}) {
  const record = writable(job);
  if (record.interviews.length >= LIMIT) throw new Error('This application already has the maximum number of interview rounds.');
  const interview = {
    id, stage: text(input?.stage, 'interview stage', 200, { required: true }), date: calendarDate(input?.date, 'interview date', { required: true }),
    status: choice(input?.status, INTERVIEW_STATUSES, 'scheduled', 'interview status'), interviewer: text(input?.interviewer, 'interviewer', 200),
    preparation: text(input?.preparation, 'preparation notes', 2000, { multiline: true }), notes: text(input?.notes, 'interview notes', 4000, { multiline: true }), addedAt: at,
  };
  record.interviews.push(interview);
  record.interviews.sort((a, b) => a.date.localeCompare(b.date) || a.addedAt.localeCompare(b.addedAt));
  return interview;
}

export function setInterviewStatus(job, id, status) {
  const interview = recordOf(job).interviews.find(item => item.id === id);
  if (!interview) throw new Error('Interview round not found.');
  interview.status = choice(status, INTERVIEW_STATUSES, '', 'interview status');
  return interview;
}

export function removeEntry(job, kind, id) {
  if (!['contacts', 'interviews'].includes(kind)) throw new Error('Unknown application record entry.');
  const record = writable(job);
  const before = record[kind].length;
  record[kind] = record[kind].filter(item => item.id !== id);
  if (record[kind].length === before) throw new Error(kind === 'contacts' ? 'Contact not found.' : 'Interview round not found.');
}

// An empty text clears the next action rather than storing a blank reminder.
export function setNextAction(job, input, { at = new Date().toISOString() } = {}) {
  const record = writable(job);
  const action = text(input?.text, 'next action', 500);
  record.nextAction = action ? { text: action, due: calendarDate(input?.due, 'due date'), setAt: at } : null;
  return record.nextAction;
}

// What reaches a provider: the posting and its evaluation state, never the
// candidate's private application record.
export function providerJob(job) {
  const { record, ...rest } = job;
  return rest;
}

export function trackerNote(job) {
  const base = job.note || job.stage || '';
  const next = recordOf(job).nextAction;
  if (!next) return base;
  return [base, `next: ${next.text}${next.due ? ' by ' + next.due : ''}`].filter(Boolean).join(' · ');
}

// Dated next actions first (overdue at the top), then undated ones, then active
// applications that have no next action at all, oldest change first.
export function followUpQueue(jobs, { asOf = today(), limit = 8 } = {}) {
  const items = [];
  for (const job of jobs) {
    const next = recordOf(job).nextAction;
    const last = (job.statusHistory || []).at(-1)?.at || job.submittedAt || job.updatedAt || job.createdAt || '';
    if (next) items.push({ job, action: next.text, due: next.due, overdue: Boolean(next.due && next.due < asOf), dueToday: next.due === asOf, last });
    else if (ACTIVE_STATUSES.includes(job.status)) items.push({ job, action: null, due: null, overdue: false, dueToday: false, last });
  }
  const rank = item => item.action ? (item.due ? 0 : 1) : 2;
  items.sort((a, b) => rank(a) - rank(b) || String(a.due || '').localeCompare(String(b.due || '')) || String(a.last).localeCompare(String(b.last)));
  return items.slice(0, limit);
}

export function upcomingInterview(job, { asOf = today() } = {}) {
  return recordOf(job).interviews.find(item => item.status === 'scheduled' && item.date >= asOf) || null;
}
