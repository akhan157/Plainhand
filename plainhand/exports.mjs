// Spreadsheet and calendar exports of the application table.
//
// Pure functions: workspace state in, text out. No model call, no network, no
// filesystem. The CSV is the same table the Applications page shows, including
// rows that came from an existing career-ops tracker. The calendar holds the
// commitments the app already tracks: each application's next action and each
// scheduled interview round. Closed applications are left out of the calendar
// because their dates are no longer things to keep.

import { legacyTrackerRows, legacyMatches } from './web/ui/tracker-rows.mjs';

export const CSV_COLUMNS = ['Company', 'Role', 'Status', 'Fit', 'Next action', 'Due', 'Updated', 'Posting URL', 'Report'];
export const CLOSED = new Set(['Rejected', 'Discarded', 'SKIP']);

// Tracker rows from an existing career-ops `applications.md` that are not also
// app jobs. The Applications page reads them by the same rule.
export { legacyTrackerRows, legacyMatches };

// Every form of line break (CRLF, LF, a bare CR, NEL, LS, PS) becomes one space,
// so no cell can carry a record boundary or hide a formula after one.
const LINE_BREAKS = /\r\n|[\r\n\u0085\u2028\u2029]/g;

// A spreadsheet treats a cell that starts with = + - @ as a formula. Company
// names and posting text are not written by the candidate, so neutralise those
// with a leading apostrophe rather than exporting a live formula. Two guards,
// both kept: a leading tab or CR is neutralised whatever follows, and so is a
// formula that follows other leading whitespace.
const FORMULA_START = /^[=+\-@\t\r]|^\s*[=+\-@]/;
const cell = value => {
  let text = String(value ?? '').replace(LINE_BREAKS, ' ');
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// A UTF-8 byte-order mark so Excel reads the file as UTF-8 rather than guessing.
export function applicationsCsv(state) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const job of state.jobs || []) {
    if (!job.evaluation) continue;
    const next = job.record?.nextAction;
    lines.push([job.company, job.title, job.status, job.evaluation.score, next?.text, next?.due, job.submittedAt || job.updatedAt, job.url, job.reportPath].map(cell).join(','));
  }
  for (const row of legacyTrackerRows(state)) {
    lines.push([row[3], row[4], row[6], row[5], '', '', row[2], '', row[8]].map(cell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ── iCalendar (RFC 5545) ────────────────────────────────────────────────────
const escapeText = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(LINE_BREAKS, '\\n');

// Content lines are limited to 75 octets; a continuation starts with one space.
// Split on character boundaries so a multi-byte character is never cut.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return [line];
  const out = [];
  let rest = line, first = true;
  while (true) {
    const limit = first ? 75 : 74;
    let taken = '', size = 0;
    for (const char of rest) {
      const width = Buffer.byteLength(char, 'utf8');
      if (size + width > limit) break;
      taken += char;
      size += width;
    }
    out.push(first ? taken : ' ' + taken);
    if (taken.length === rest.length) break;
    rest = rest.slice(taken.length);
    first = false;
  }
  return out;
}

const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const day = iso => String(iso).slice(0, 10).replace(/-/g, '');
const nextDay = iso => {
  const date = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return day(date.toISOString());
};

// The wall clock a time zone shows at one instant, as a UTC-midnight-based number.
function wallClock(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const value = type => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
}

// A calendar date and a wall-clock time in the candidate's zone, as a UTC instant.
// Two passes settle a date near a daylight-saving change. No zone (or an invalid
// one) returns null and the event stays floating local time, which RFC 5545 allows.
function zonedInstant(date, time, timeZone) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || !timeZone) return null;
  try {
    let instant = wall;
    for (let pass = 0; pass < 2; pass++) instant = wall - (wallClock(timeZone, new Date(instant)) - instant);
    return instant;
  } catch { return null; }
}

function timedStart(event) {
  if (event.start !== null && event.start !== undefined) return `DTSTART:${stamp(new Date(event.start))}`;
  return `DTSTART:${day(event.date)}T${String(event.time).replace(':', '')}00`;
}

// One hour is the default round length; the record stores a start, not an end.
function timedEnd(event) {
  const start = event.start !== null && event.start !== undefined
    ? event.start
    : Date.parse(`${event.date}T${event.time}:00Z`);
  const end = start + 3600000;
  // A floating start must have a floating end; a UTC start keeps its Z.
  return event.start !== null && event.start !== undefined
    ? `DTEND:${stamp(new Date(end))}`
    : `DTEND:${new Date(end).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}`;
}

export function calendarEvents(state) {
  const events = [];
  const jobs = (state.jobs || []).filter(job => !CLOSED.has(job.status));
  for (const job of jobs) {
    const title = `${job.company} — ${job.title}`;
    const next = job.record?.nextAction;
    if (next?.due) {
      events.push({
        uid: `${job.id}-next-action@plainhand`,
        date: next.due,
        summary: next.text,
        description: `${title}${job.url ? `\n${job.url}` : ''}`,
      });
    }
    for (const round of job.record?.interviews || []) {
      if (round.status !== 'scheduled' || !round.date) continue;
      const details = [title, round.interviewer && `With ${round.interviewer}`, round.preparation && `Prep: ${round.preparation}`].filter(Boolean).join('\n');
      events.push({ uid: `${job.id}-${round.id}@plainhand`, date: round.date, time: round.time || null,
        start: round.time ? zonedInstant(round.date, round.time, state.profile?.timezone) : null,
        summary: `${round.stage} interview — ${job.company}`, description: details });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

export function calendarIcs(state, { now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Plainhand//Application deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Plainhand deadlines',
  ];
  const dtstamp = stamp(now);
  for (const event of calendarEvents(state)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${dtstamp}`,
      ...(event.time ? [timedStart(event), timedEnd(event)] : [`DTSTART;VALUE=DATE:${day(event.date)}`, `DTEND;VALUE=DATE:${nextDay(event.date)}`]),
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join('\r\n') + '\r\n';
}
