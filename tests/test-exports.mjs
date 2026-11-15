import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationsCsv, calendarIcs, calendarEvents, CSV_COLUMNS, legacyTrackerRows, legacyMatches } from '../plainhand/exports.mjs';

// RFC 4180 records, where a record ends at CRLF, LF or a bare CR *outside* quotes.
// A cell that leaked a raw line break therefore splits into more records, which is
// exactly the failure this parser is here to catch.
function records(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += char; i += 1; continue;
    }
    if (char === '"') { quoted = true; i += 1; continue; }
    if (char === ',') { row.push(field); field = ''; i += 1; continue; }
    if (char === '\r' || char === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
      i += char === '\r' && source[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += char; i += 1;
  }
  row.push(field); rows.push(row);
  return rows.filter(cells => !(cells.length === 1 && cells[0] === ''));
}

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

test('a bare CR is normalized before quoting and cannot start a new record', () => {
  const csv = applicationsCsv({ jobs: [job({ company: 'Safe\r=1+1' })], tracker: '' });
  const rows = records(csv);
  assert.equal(rows.length, 2, 'one header and one record: a bare CR must not split the row');
  assert.equal(rows[1].length, CSV_COLUMNS.length);
  assert.equal(rows[1][0], 'Safe =1+1');
  for (const cells of rows) for (const value of cells) assert.doesNotMatch(value, /[\r\n\u0085\u2028\u2029]/);
});

test('every line-break form, formula and separator character stays inside one parsed cell', () => {
  const cases = [
    { company: 'CRLF\r\nBreak', title: 'Comma, "quote"' },
    { company: '\r=1+1', title: ' =1+1' },
    { company: '\tPlain tab text', title: '=SUM(1+1)' },
    { company: 'Bare\rCR', title: 'Line\nLF' },
  ];
  const csv = applicationsCsv({ jobs: cases.map((overrides, index) => job({ id: 'job-' + index, ...overrides })), tracker: '' });
  const rows = records(csv);
  assert.equal(rows.length, 1 + cases.length, 'no cell may create a record boundary');
  for (const cells of rows) assert.equal(cells.length, CSV_COLUMNS.length);
  const [, crlf, leadingFormula, tab, breaks] = rows;
  assert.equal(crlf[0], 'CRLF Break');
  assert.equal(crlf[1], 'Comma, "quote"');
  assert.equal(leadingFormula[0], "' =1+1", 'a formula after a removed CR is still neutralised');
  assert.equal(leadingFormula[1], "' =1+1", 'whitespace before a formula is neutralised too');
  assert.equal(tab[0], "'\tPlain tab text", 'the original tab guard still prefixes tab-prefixed text');
  assert.equal(tab[1], "'=SUM(1+1)");
  assert.equal(breaks[0], 'Bare CR');
  assert.equal(breaks[1], 'Line LF');
  for (const cells of rows) for (const value of cells) assert.doesNotMatch(value, /^\s*[=+\-@]/);
});

test('a bare CR in calendar text cannot start a new property line', () => {
  const event = job({ record: { nextAction: { text: 'Acme\rATTENDEE:mailto:evil@example.invalid,cc Dana', due: '2026-11-20' }, interviews: [] } });
  const ics = calendarIcs({ jobs: [event] }, { now: new Date('2026-11-13T12:00:00Z') });
  for (const line of ics.split('\r\n')) assert.doesNotMatch(line, /[\r\n\u0085\u2028\u2029]/);
  assert.ok(!ics.split('\r\n').some(line => line.startsWith('ATTENDEE')));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:Acme\\nATTENDEE:mailto:evil@example\.invalid\\,cc Dana/);
});

test('imported job and interview ids cannot inject calendar properties', () => {
  const state = { jobs: [job({ id: 'job\r\nATTENDEE:evil', record: {
    nextAction: { text: 'Review', due: '2026-11-20' },
    interviews: [{ id: 'round\rATTENDEE:other', status: 'scheduled', date: '2026-11-21', stage: 'First' }],
  } })] };
  const ics = calendarIcs(state).replace(/\r\n /g, '');
  assert.equal(ics.split('\r\n').filter(line => line.startsWith('UID:')).length, 2);
  assert.ok(!ics.split('\r\n').some(line => line.startsWith('ATTENDEE:')));
  for (const line of ics.split('\r\n')) assert.doesNotMatch(line, /[\r\n]/);
  assert.match(ics, /UID:job\\nATTENDEE:evil-round\\nATTENDEE:other@plainhand/);
});

test('the shared tracker rule keeps only rows that are not also app jobs', () => {
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '| 1 | 2026-09-01 | Northstar Robotics | Mechanical Engineer | 4.2/5 | Applied | — | — | same job, different case below |',
    '| 2 | 2026-09-02 | northstar robotics | mechanical engineer | 4.2/5 | Applied | — | — | duplicate of an app job |',
    '| 3 | 2026-09-03 | Arcwell Energy | Manufacturing Engineer | 3.8/5 | Evaluated | — | — | legacy row |',
  ].join('\n');
  const rows = legacyTrackerRows({ jobs: [job()], tracker });
  assert.equal(rows.length, 1);
  assert.equal(rows[0][3], 'Arcwell Energy');
  assert.equal(rows[0][4], 'Manufacturing Engineer');
  assert.equal(legacyMatches(rows[0], 'arcwell'), true);
  assert.equal(legacyMatches(rows[0], 'MANUFACTURING'), true);
  assert.equal(legacyMatches(rows[0], 'northstar'), false, 'search covers the legacy role and company only');
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
