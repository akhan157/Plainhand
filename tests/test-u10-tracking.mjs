// U10 tracking and learning: tracker round-trip, stage board, per-company contact
// roll-up, calendar times, follow-ups citing the submitted packet, and outcome
// recommendations that stay candidates until the candidate approves them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace, digest, syncTracker } from '../plainhand/store.mjs';
import { createRegistry } from '../plainhand/actions.mjs';
import { FEATURES } from '../plainhand/features/index.mjs';
import { applicationsCsv, calendarIcs, legacyTrackerRows, CSV_COLUMNS } from '../plainhand/exports.mjs';
import { packetIdentity } from '../plainhand/workflow.mjs';
import { exportWorkspace, importWorkspace, TRACKER_FILE } from '../plainhand/workspace-import.mjs';
import { contactsByCompany } from '../plainhand/web/ui/people.mjs';
import { candidate } from '../plainhand/test-fixtures.mjs';
import { sufficientJobs, syntheticJob } from './test-feature-insights-fixtures.mjs';

const NOW = new Date('2026-11-13T12:00:00Z');
const TRACKER_HEADER = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u10-'));
  const workspace = new Workspace(root);
  const registry = createRegistry({ workspace, workflow: null, features: FEATURES });
  await workspace.saveProfile({ ...candidate }, 0);
  return {
    root, workspace, registry,
    run: (name, input = {}, options) => registry.run(name, input, options),
    close: async () => rm(root, { recursive: true, force: true }),
  };
}

const job = (overrides = {}) => ({
  id: randomUUID(),
  company: 'Acme Robotics',
  title: 'Mechanical Engineer',
  url: 'https://jobs.lever.co/acme/42',
  description: 'A graduate mechanical engineering role designing and testing hardware.',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  stage: 'evaluated',
  status: 'Evaluated',
  note: 'Referral from the test team',
  evaluation: { score: 4.6, recommendation: 'Apply', summary: 'Relevant.', matches: [], gaps: [], questions: [], legitimacyNotes: [] },
  ...overrides,
});

const packet = () => ({
  headline: 'Mechanical Engineering Graduate',
  resume: [{ section: 'Projects', text: 'Designed and tested a lightweight chassis.', evidence: [] }],
  coverLetter: 'I would like to bring my design and testing experience to this role.',
  answers: [],
  questions: [],
});

const setTracker = async (workspace, state) => {
  await workspace.write(TRACKER_FILE, TRACKER_HEADER);
  await syncTracker(workspace, state);
};

// RFC 4180 records, where a record ends at CRLF, LF or a bare CR outside quotes.
function csvRecords(text) {
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

const unfold = ics => ics.replace(/\r\n /g, '');

function vevents(ics) {
  const lines = unfold(ics).split('\r\n');
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = []; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue; }
    if (current) current.push(line);
  }
  return events;
}

const property = (event, name) => event.find(line => line === name || line.startsWith(name + ':') || line.startsWith(name + ';'));

test('export, import and re-export: stages, dates, contacts and notes survive; CSV and ICS stay valid', async () => {
  const source = await harness(), target = await harness();
  try {
    const interview = { id: 'round-1', stage: 'Technical screen', date: '2026-11-18', time: '14:30', status: 'scheduled', interviewer: 'Dana Lee', preparation: 'Review the test plan', notes: 'First line\nSecond line', addedAt: '2026-10-03T09:00:00.000Z' };
    const contact = { id: 'contact-1', name: 'Dana, Lee', role: 'Technical "recruiter"', type: 'recruiter', email: 'dana@example.invalid', phone: null, linkedin: null, notes: 'Met at the career fair.\nFollow up Friday.', date: '2026-10-03', addedAt: '2026-10-03T09:00:00.000Z' };
    const active = job({
      company: 'North, "Star" Robotics', title: 'Mechanical Engineer, Systems',
      status: 'Interview', stage: 'submitted', submittedAt: '2026-10-05T12:00:00.000Z', approvedHash: digest('approved-packet'),
      reportPath: 'reports/hl-1-northstar.md',
      record: { contacts: [contact], interviews: [interview], nextAction: { text: 'Send a thank-you note, then ask "about timing"', due: '2026-11-20', setAt: '2026-11-01T10:00:00.000Z' } },
      statusHistory: [{ from: 'Evaluated', to: 'Apply', at: '2026-10-04T09:00:00.000Z' }, { from: 'Apply', to: 'Applied', at: '2026-10-05T12:00:00.000Z' }, { from: 'Applied', to: 'Interview', at: '2026-10-10T09:00:00.000Z' }],
    });
    const closed = job({
      id: 'job-closed', company: 'Closed Co', title: 'Test Engineer', status: 'Rejected', stage: 'submitted',
      submittedAt: '2026-09-20T12:00:00.000Z', statusHistory: [{ from: 'Applied', to: 'Rejected', at: '2026-09-30T09:00:00.000Z' }],
      record: { contacts: [], interviews: [], nextAction: { text: 'Give up', due: '2026-12-01', setAt: '2026-10-01T09:00:00.000Z' } },
    });
    await source.workspace.mutate(state => { state.jobs.push(active, closed); });
    const sourceState = await source.workspace.load();
    await setTracker(source.workspace, sourceState);
    const legacy = '| 7 | 2026-09-02 | Arcwell, Energy "Ltd" | Manufacturing Engineer | 3.8/5 | Evaluated | — | [7](reports/7-arcwell.md) | legacy, row with "quotes" |';
    await source.workspace.write(TRACKER_FILE, (await source.workspace.read(TRACKER_FILE)).trimEnd() + '\n' + legacy + '\n');

    const exported = await exportWorkspace(source.workspace);
    assert.ok(exported.files[TRACKER_FILE].includes('Arcwell'), 'the tracker travels in the workspace export');
    const sourceLoaded = await source.workspace.load();
    const sourceTracker = await source.workspace.read(TRACKER_FILE);
    const sourceCsv = applicationsCsv({ ...sourceLoaded, tracker: sourceTracker });
    const sourceIcs = calendarIcs(sourceLoaded, { now: NOW });
    assert.ok(sourceCsv.startsWith('\uFEFF'));
    const parsed = csvRecords(sourceCsv);
    assert.equal(parsed.length, 1 + 2 + 1, 'header, app jobs and the tracker-only row');
    assert.ok(parsed.every(row => row.length === CSV_COLUMNS.length));
    assert.equal(parsed[1][0], 'North, "Star" Robotics');
    assert.equal(parsed[1][1], 'Mechanical Engineer, Systems');
    assert.equal(parsed[1][4], 'Send a thank-you note, then ask "about timing"', 'a comma, a quote and the removed line break stay one cell');
    assert.equal(parsed[3][0], 'Arcwell, Energy "Ltd"');

    const summary = await importWorkspace({ workspace: target.workspace, data: exported });
    assert.equal(summary.jobs, 2);
    const targetState = await target.workspace.load();
    const targetTracker = await target.workspace.read(TRACKER_FILE);
    assert.deepEqual(legacyTrackerRows({ jobs: targetState.jobs, tracker: targetTracker }).map(row => row[3]), ['Arcwell, Energy "Ltd"']);
    const targetActive = targetState.jobs.find(item => item.id === active.id);
    assert.equal(targetActive.status, 'Interview');
    assert.equal(targetActive.submittedAt, active.submittedAt);
    assert.equal(targetActive.createdAt, active.createdAt);
    assert.deepEqual(targetActive.statusHistory, active.statusHistory);
    assert.deepEqual(targetActive.record, active.record, 'contacts, interviews, notes and the next action are identical');
    assert.deepEqual(targetState.jobs.find(item => item.id === closed.id).record, closed.record);

    const targetCsv = applicationsCsv({ ...targetState, tracker: targetTracker });
    assert.equal(targetCsv, sourceCsv, 'a re-export is byte-identical');
    const targetIcs = calendarIcs(targetState, { now: NOW });
    assert.equal(targetIcs, sourceIcs, 'the calendar is identical, including times and folded lines');

    // Structure, not just equality: CRLF, folding, required VEVENT fields, and an
    // all-day next action next to a timed interview in UTC.
    assert.ok(targetIcs.endsWith('\r\n'));
    assert.equal(targetIcs.includes('\r\r'), false);
    for (const line of targetIcs.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
    assert.ok(targetIcs.split('\r\n').slice(1).some(line => line.startsWith(' ')), 'a long description is folded');
    const events = vevents(targetIcs);
    assert.equal(events.length, 2, 'the open application has a next action and one scheduled interview; the rejected application is omitted');
    for (const event of events) {
      for (const field of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY']) assert.ok(property(event, field), `${field} is required`);
      assert.match(property(event, 'DTSTAMP'), /^DTSTAMP:\d{8}T\d{6}Z$/);
    }
    const timed = events.find(event => property(event, 'SUMMARY')?.includes('Technical screen interview'));
    assert.ok(property(timed, 'DTSTART').endsWith('Z'), 'the interview start is UTC');
    assert.match(property(timed, 'DTSTART'), /^DTSTART:20261118T193000Z$/, '14:30 America/New_York is 19:30 UTC');
    assert.match(property(timed, 'DTEND'), /^DTEND:20261118T203000Z$/, 'a one-hour round');
    const allDay = events.find(event => property(event, 'SUMMARY')?.includes('Send a thank-you'));
    assert.match(property(allDay, 'DTSTART'), /^DTSTART;VALUE=DATE:20261120$/);
    assert.doesNotMatch(targetIcs, /Give up/, 'a closed application keeps no deadline');
  } finally { await source.close(); await target.close(); }
});

test('status moves are recorded, invalid values are refused, and Applied needs the candidate', async () => {
  const h = await harness();
  try {
    const role = job();
    await h.workspace.mutate(state => { state.jobs.push(role); });
    const statusOf = async () => (await h.workspace.load()).jobs.find(item => item.id === role.id).status;
    const historyOf = async () => (await h.workspace.load()).jobs.find(item => item.id === role.id).statusHistory;

    const agentApplied = await h.run('jobs.setStatus', { jobId: role.id, status: 'Applied' }, { actor: 'agent', confirmed: true }).catch(error => error);
    assert.equal(agentApplied.code, 'candidate_only', 'an agent cannot record a submission');
    const uiApplied = await h.run('jobs.setStatus', { jobId: role.id, status: 'Applied' }).catch(error => error);
    assert.equal(uiApplied.code, 'candidate_only', 'even the UI reaches Applied only through the confirmation action');
    assert.equal(await statusOf(), 'Evaluated', 'nothing was written');
    assert.equal(h.registry.candidateOnly('jobs.setStatus', { status: 'Applied' }), true);

    const invalid = await h.run('jobs.setStatus', { jobId: role.id, status: 'Hired' }).catch(error => error);
    assert.equal(invalid.code, 'invalid_input', 'a value outside templates/states.yml is refused');
    assert.equal(await statusOf(), 'Evaluated');

    await h.run('jobs.setStatus', { jobId: role.id, status: 'Apply' });
    await h.run('jobs.setStatus', { jobId: role.id, status: 'Responded' });
    await h.run('jobs.setStatus', { jobId: role.id, status: 'Interview' });
    assert.deepEqual((await historyOf()).map(entry => [entry.from, entry.to]), [
      ['Evaluated', 'Apply'], ['Apply', 'Responded'], ['Responded', 'Interview'],
    ]);
    assert.match(await h.workspace.read(TRACKER_FILE), /\| Acme Robotics \| Mechanical Engineer \| 4\.6\/5 \| Interview \|/, 'the tracker row follows the move');

    const confirmAgent = await h.run('jobs.confirmSubmitted', { jobId: role.id }, { actor: 'agent', confirmed: true }).catch(error => error);
    assert.equal(confirmAgent.code, 'candidate_only');
    await h.run('jobs.confirmSubmitted', { jobId: role.id });
    const applied = (await h.workspace.load()).jobs.find(item => item.id === role.id);
    assert.equal(applied.status, 'Applied');
    assert.equal(applied.submissionSource, 'candidate-confirmed');
    assert.deepEqual(applied.statusHistory.at(-1).from, 'Interview');
    assert.deepEqual(applied.statusHistory.at(-1).to, 'Applied');
    assert.match(await h.workspace.read(TRACKER_FILE), /\| Acme Robotics \| Mechanical Engineer \| 4\.6\/5 \| Applied \|/);
  } finally { await h.close(); }
});

test('contacts at several roles of one company roll up by company and leave when removed', async () => {
  const h = await harness();
  try {
    const first = job({ company: 'Acme Robotics', title: 'Mechanical Engineer' });
    const second = job({ company: 'acme robotics', title: 'Test Engineer' });
    const other = job({ company: 'Beta Works', title: 'Designer' });
    await h.workspace.mutate(state => { state.jobs.push(first, second, other); });
    const dana = (await h.run('record.addContact', { jobId: first.id, name: 'Dana Lee', role: 'Recruiter' })).result;
    const sam = (await h.run('record.addContact', { jobId: second.id, name: 'Sam Ortiz', role: 'Hiring manager' })).result;
    await h.run('record.addContact', { jobId: other.id, name: 'Riley Chen', role: 'Referral' });

    let groups = contactsByCompany(await h.workspace.load());
    assert.deepEqual(groups.map(group => group.company.toLowerCase()).sort(), ['acme robotics', 'beta works']);
    const acme = groups.find(group => group.company.toLowerCase() === 'acme robotics');
    assert.equal(acme.contacts.length, 2, 'two roles at the same company share one company roll-up');
    assert.deepEqual(acme.contacts.map(contact => contact.job.title).sort(), ['Mechanical Engineer', 'Test Engineer']);
    assert.deepEqual(groups.find(group => group.company === 'Beta Works').contacts.map(contact => contact.name), ['Riley Chen']);

    await h.run('record.removeContact', { jobId: first.id, entryId: dana.id });
    groups = contactsByCompany(await h.workspace.load());
    assert.deepEqual(groups.find(group => group.company.toLowerCase() === 'acme robotics').contacts.map(contact => contact.name), ['Sam Ortiz'], 'removing a contact updates the roll-up');
    await h.run('record.removeContact', { jobId: second.id, entryId: sam.id });
    groups = contactsByCompany(await h.workspace.load());
    assert.equal(groups.some(group => group.company.toLowerCase() === 'acme robotics'), false, 'the company disappears when it has no contacts');
    assert.deepEqual(groups.map(group => group.company), ['Beta Works']);
  } finally { await h.close(); }
});

test('an interview with a time is a UTC event in the calendar and carries its time in the digest', async () => {
  const h = await harness();
  try {
    const role = job();
    await h.workspace.mutate(state => { state.jobs.push(role); });
    // A fixed future date: the digest reads the real clock, so a 2026 date expired on 2026-11-19.
    const first = (await h.run('record.addInterview', { jobId: role.id, stage: 'Technical screen', date: '2099-11-18', time: '14:30', status: 'scheduled' })).result;
    assert.equal(first.time, '14:30');
    await h.run('record.addInterview', { jobId: role.id, stage: 'Summer screen', date: '2026-07-15', time: '09:00', status: 'scheduled' });
    const invalid = await h.run('record.addInterview', { jobId: role.id, stage: 'Bad time', date: '2099-11-19', time: '25:00' }).catch(error => error);
    assert.match(invalid.message, /real time/, 'an impossible time is refused');

    const state = await h.workspace.load();
    const digestState = (await h.run('workspace.digest')).result;
    const digestJob = digestState.jobs.find(item => item.id === role.id);
    assert.deepEqual(digestJob.upcomingInterview, { stage: 'Technical screen', date: '2099-11-18', time: '14:30' }, 'the upcoming-interview digest includes the time');
    assert.ok(digestState.attention.some(item => item.kind === 'interview' && item.text.includes('at 14:30')), 'the briefing says the time');

    const ics = calendarIcs(state, { now: NOW });
    const events = vevents(ics);
    const november = events.find(event => property(event, 'SUMMARY')?.includes('Technical screen'));
    const july = events.find(event => property(event, 'SUMMARY')?.includes('Summer screen'));
    assert.match(property(november, 'DTSTART'), /^DTSTART:20991118T193000Z$/, 'EST is five hours behind UTC');
    assert.match(property(july, 'DTSTART'), /^DTSTART:20260715T130000Z$/, 'EDT is four hours behind UTC, across a DST change');
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
    assert.match(ics, /\r\n$/);

    // The fallback without a timezone stays a valid floating local time.
    const floating = calendarIcs({ ...state, profile: { ...state.profile, timezone: '' } }, { now: NOW });
    assert.match(floating, /DTSTART:20991118T143000\r\n/, 'without a zone the wall-clock time is written as a floating local time');
    assert.match(floating, /DTEND:20991118T153000\r\n/, 'a floating event ends in floating local time, not UTC');
  } finally { await h.close(); }
});

test('a follow-up cites the packet version submitted, even after a later revision', async () => {
  const h = await harness();
  try {
    const role = job({ packet: packet(), contextHash: 'context-1', pdfHash: 'pdf-1' });
    role.approvedHash = packetIdentity(role);
    await h.workspace.mutate(state => { state.jobs.push(role); });
    await h.run('record.setNextAction', { jobId: role.id, text: 'Check in with the recruiter', due: '2026-11-20' });
    await h.run('jobs.confirmSubmitted', { jobId: role.id });

    const submitted = (await h.workspace.load()).jobs.find(item => item.id === role.id);
    assert.ok(submitted.submittedPacket, 'confirmation freezes the submitted packet identity');
    assert.equal(submitted.submittedPacket.approvedHash, role.approvedHash);
    assert.equal(submitted.submittedPacket.packetHash, digest(role.packet));
    let item = (await h.run('workspace.digest')).result.followUps.find(entry => entry.jobId === role.id);
    assert.deepEqual(item.submittedPacket, submitted.submittedPacket, 'the follow-up queue item references it');

    // A later revision (the product refuses one after submission, but a stored packet
    // could still be edited by an import or a future feature) must not rewrite history.
    const later = { ...role.packet, coverLetter: 'A later, unsubmitted revision.' };
    await h.workspace.mutate(state => { const current = state.jobs.find(entry => entry.id === role.id); current.packet = later; current.approvedHash = digest('later-approval'); });
    item = (await h.run('workspace.digest')).result.followUps.find(entry => entry.jobId === role.id);
    assert.equal(item.submittedPacket.approvedHash, role.approvedHash, 'the submitted approval is not the later one');
    assert.equal(item.submittedPacket.packetHash, digest(role.packet));
    assert.notEqual(item.submittedPacket.packetHash, digest(later), 'the submitted version is not the later revision');
    assert.equal((await h.run('jobs.get', { jobId: role.id })).result.submittedPacket.packetHash, digest(role.packet));

    // Confirming again keeps the first submission record.
    await h.run('jobs.confirmSubmitted', { jobId: role.id });
    assert.deepEqual((await h.workspace.load()).jobs.find(entry => entry.id === role.id).submittedPacket.packetHash, digest(role.packet));
  } finally { await h.close(); }
});

test('outcome recommendations stay candidates, need enough data, and only the candidate can approve', async () => {
  const h = await harness();
  try {
    const empty = (await h.run('insights.suggest')).result;
    assert.equal(empty.status, 'insufficient-data');
    assert.match(empty.message, /Not enough outcomes yet: 0 of 8/);
    assert.equal((await h.run('insights.recommendations')).result.data.status, 'insufficient-data');
    assert.equal(await h.workspace.read('data/plainhand/insights/outcome-recommendation-state.json'), '', 'nothing is saved without enough outcomes');

    await h.workspace.mutate(state => { state.jobs.push(...Array.from({ length: 5 }, (_, index) => syntheticJob({ score: 4.2, outcome: 'rejected', company: `Few ${index}` }))); });
    const five = (await h.run('insights.suggest')).result;
    assert.equal(five.status, 'insufficient-data');
    assert.match(five.message, /5 of 8 observed outcomes/);
    assert.equal((await h.run('insights.recommendations')).result.pending.length, 0);

    await h.workspace.mutate(state => { state.jobs = sufficientJobs(); });
    const enough = (await h.run('insights.suggest')).result;
    assert.equal(enough.status, 'suggestions');
    assert.ok(enough.created >= 1, JSON.stringify(enough));
    assert.equal(enough.minimum, 8);
    const listed = (await h.run('insights.recommendations')).result;
    assert.ok(listed.pending.length >= 1);
    assert.ok(listed.pending.every(item => item.status === 'candidate' && item.evidence?.observed >= 8), 'each suggestion is a candidate with its sample size');
    assert.match(listed.note, /Approving records your decision only/);

    const target = listed.pending[0];
    for (const actor of ['agent', 'mcp']) {
      const refused = await h.run('insights.approve', { id: target.id }, { actor, confirmed: true }).catch(error => error);
      assert.equal(refused.code, 'candidate_only', `${actor} cannot approve`);
      assert.deepEqual(refused.panel, { type: 'insights' });
    }
    assert.equal(h.registry.candidateOnly('insights.approve', { id: target.id }), true);
    assert.equal((await h.run('insights.recommendations')).result.pending.find(item => item.id === target.id).status, 'candidate', 'still a candidate after refusals');

    const jobsBefore = JSON.stringify((await h.workspace.load()).jobs);
    const approved = (await h.run('insights.approve', { id: target.id })).result;
    assert.equal(approved.status, 'approved');
    assert.match(approved.message, /Nothing was changed/);
    const after = (await h.run('insights.recommendations')).result;
    assert.equal(after.pending.some(item => item.id === target.id), false);
    assert.equal(after.approved.find(item => item.id === target.id).status, 'approved');
    assert.equal(JSON.stringify((await h.workspace.load()).jobs), jobsBefore, 'approving changes no job, score or status');
  } finally { await h.close(); }
});
