import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationsCsv, calendarIcs, calendarEvents, CSV_COLUMNS } from '../plainhand/exports.mjs';

const job = (overrides = {}) => ({
  id: 'job-1', company: 'Northstar Robotics', title: 'Mechanical Engineer', status: 'Applied',
  url: 'https://jobs.example.invalid/northstar', updatedAt: '2026-11-10T09:00:00.000Z',
  evaluation: { score: 4.2 },
  record: {
    nextAction: { text: 'Send a thank-you note, then ask about timing; cc Dana', due: '2026-11-20' },
    interviews: [
      { id: 'round-1', stage: 'Recruiter screen', date: '2026-11-18', status: 'scheduled', interviewer: 'Dana Lee', preparation: 'Walk through the test plan' },
      { id: 'round-0', stage: 'Phone screen', date: '2026-11-01', status: 'completed', interviewer: 'Sam Rivera' },
    ],
  },
  ...overrides,
});

test('the CSV has the documented header, a UTF-8 mark and the tracker row', () => {
  const csv = applicationsCsv({ jobs: [job()], tracker: '' });
  assert.ok(csv.startsWith('\uFEFF'), 'Excel needs the byte-order mark to read UTF-8');
  const [header, row] = csv.replace('\uFEFF', '').split('\r\n');
  assert.equal(header, CSV_COLUMNS.join(','));
  assert.match(row, /^Northstar Robotics,Mechanical Engineer,Applied,4.2,/);
  assert.ok(csv.endsWith('\r\n'));
});

test('fields with commas, quotes and newlines stay one cell', () => {
  const csv = applicationsCsv({ jobs: [job({ company: 'North, Inc', title: 'The "Lead" Role' })], tracker: '' });
  const row = csv.replace('\uFEFF', '').split('\r\n')[1];
  assert.match(row, /^"North, Inc","The ""Lead"" Role",/);
  assert.ok(!row.includes('\n'));
});

test('a posting title is never exported as a live spreadsheet formula', () => {
  const csv = applicationsCsv({ jobs: [job({ title: '=HYPERLINK("https://evil.invalid","Apply")', company: '@SUM(1+1)' })], tracker: '' });
  const row = csv.replace('\uFEFF', '').split('\r\n')[1];
  assert.ok(row.startsWith(`'@SUM(1+1),"\'=HYPERLINK(""https://evil.invalid"",""Apply"")"`), row);
  assert.doesNotMatch(row, /(^|,)[=@+\-]/, 'no cell may begin a formula');
});

test('rows that only exist in applications.md are exported too', () => {
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '| 7 | 2026-09-02 | Arcwell Energy | Manufacturing Engineer | 3.8/5 | Evaluated | — | [7](reports/7-arcwell.md) | legacy row |',
  ].join('\n');
  const csv = applicationsCsv({ jobs: [], tracker });
  const row = csv.replace('\uFEFF', '').split('\r\n')[1];
  assert.match(row, /^Arcwell Energy,Manufacturing Engineer,Evaluated,3\.8\/5,/);
});

test('the calendar holds next actions and scheduled rounds only', () => {
  const closed = job({ id: 'job-2', status: 'Rejected', record: { nextAction: { text: 'Give up', due: '2026-12-01' }, interviews: [] } });
  const events = calendarEvents({ jobs: [job(), closed] });
  assert.deepEqual(events.map(event => event.summary), [
    'Recruiter screen interview — Northstar Robotics',
    'Send a thank-you note, then ask about timing; cc Dana',
  ]);
  const ics = calendarIcs({ jobs: [job(), closed] }, { now: new Date('2026-11-13T12:00:00Z') });
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.doesNotMatch(ics, /Phone screen/, 'a completed round is not a deadline');
  assert.doesNotMatch(ics, /Give up/, 'a rejected application keeps no deadlines');
});

test('the calendar is RFC 5545 shaped: CRLF, all-day dates, escaped text, folded long lines', () => {
  const ics = calendarIcs({ jobs: [job()] }, { now: new Date('2026-11-13T12:00:00Z') });
  assert.ok(ics.endsWith('\r\n'));
  assert.deepEqual(ics.trim().split('\r\n').filter(line => line.includes('\n')), []);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /DTSTAMP:20261113T120000Z\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261119/);
  assert.match(ics, /SUMMARY:Send a thank-you note\\, then ask about timing\\; cc Dana/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  // Unfolding (dropping CRLF + the single leading space) restores the original text.
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:Send a thank-you note\\, then ask about timing\\; cc Dana/);
});

test('a long description folds without splitting a multi-byte character', () => {
  const long = 'Prüfung der Bewerbung — '.repeat(8);
  const ics = calendarIcs({ jobs: [job({ company: long, title: 'Engineer' })] }, { now: new Date('2026-11-13T12:00:00Z') });
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
    assert.equal(line.includes('\uFFFD'), false);
  }
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(long.replace(/\s/g, ' ').slice(0, 20)));
});

test('an empty workspace still produces valid files', () => {
  const csv = applicationsCsv({ jobs: [], tracker: '' });
  assert.equal(csv.replace('\uFEFF', ''), CSV_COLUMNS.join(',') + '\r\n');
  const ics = calendarIcs({ jobs: [] }, { now: new Date('2026-11-13T12:00:00Z') });
  assert.equal(ics.match(/BEGIN:VEVENT/g), null);
  assert.match(ics, /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR\r\n$/);
});
