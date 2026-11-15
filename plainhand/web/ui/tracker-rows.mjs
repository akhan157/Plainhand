// Rows of an existing career-ops `applications.md` that are not also app jobs.
//
// Pure functions with no imports, so the Applications page (browser) and the
// CSV export (Node) read the legacy tracker by one rule. The tracker file stays
// owned by applications.md; nothing here writes it or turns a row into a job.
//
// Columns after splitting on `|` (the row starts and ends with an empty cell):
// 2 date, 3 company, 4 role, 5 score, 6 status, 7 PDF, 8 report, 9 notes.

export function legacyTrackerRows(state) {
  const rows = String(state?.tracker || '').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
  return rows.map(line => line.split('|').map(cell => cell.trim())).filter(cells => {
    const company = String(cells[3] || '').toLowerCase(), role = String(cells[4] || '').toLowerCase();
    return !(state?.jobs || []).some(job => String(job.company || '').toLowerCase() === company && String(job.title || '').toLowerCase() === role);
  });
}

// The same search rule the page applies to jobs: case-insensitive text match.
export function legacyMatches(row, query) {
  return `${row[4] || ''} ${row[3] || ''}`.toLowerCase().includes(String(query || '').trim().toLowerCase());
}
