/**
 * Read-only workflow projections for dashboard consumers.
 * This module accepts a canonical application timeline payload and never reads or
 * writes files. It intentionally does not alter the dashboard data contract.
 */
import { applicationKey } from './application-timeline.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function dateValue(value) {
  const clean = text(value);
  return DATE_RE.test(clean) ? clean : null;
}

function classify(date, asOf) {
  if (!date || !asOf) return 'undated';
  if (date < asOf) return 'overdue';
  if (date === asOf) return 'due';
  return 'upcoming';
}

function sourceAvailability(sources = {}) {
  return Object.fromEntries(['contacts', 'interviews', 'followUps'].map((name) => {
    const source = sources?.[name];
    return [name, {
      status: source?.status || 'absent',
      rows: Number.isFinite(source?.rows) ? source.rows : 0,
      available: source?.status === 'present',
    }];
  }));
}

function identity(app) {
  const company = text(app?.company);
  const role = text(app?.role);
  const key = text(app?.key);
  const expected = company && role ? applicationKey(company, role) : null;
  const missing = !company || !role;
  const ambiguous = missing || !key || !expected || key !== expected;
  return {
    company: company || null,
    role: role || null,
    key: key || expected,
    identityStatus: missing ? 'missing' : ambiguous ? 'ambiguous' : 'exact',
  };
}

function stableCompare(a, b) {
  return `${a.company || ''}\0${a.role || ''}\0${a.key || ''}\0${a.date || ''}\0${a.action || ''}\0${a.contact || ''}\0${a.sourceRow || 0}`
    .localeCompare(`${b.company || ''}\0${b.role || ''}\0${b.key || ''}\0${b.date || ''}\0${b.action || ''}\0${b.contact || ''}\0${b.sourceRow || 0}`);
}

/**
 * Build deterministic queue, next-action, health, availability, and provenance
 * views from a supplied canonical timeline. `asOf` is optional; without it no
 * dated item is called overdue, due, or upcoming.
 */
export function buildWorkflowProjection(timeline, options = {}) {
  const payload = timeline && typeof timeline === 'object' ? timeline : {};
  const asOf = dateValue(options.asOf);
  const apps = Array.isArray(payload.applications) ? payload.applications : [];
  const queue = [];
  const nextActions = [];
  const health = {
    applications: 0,
    applicationsWithNextAction: 0,
    overdue: 0,
    due: 0,
    upcoming: 0,
    undated: 0,
    missingIdentity: 0,
    ambiguousIdentity: 0,
  };

  for (const app of apps) {
    const id = identity(app);
    health.applications += 1;
    if (id.identityStatus === 'missing') health.missingIdentity += 1;
    if (id.identityStatus === 'ambiguous') health.ambiguousIdentity += 1;
    const action = text(app?.nextAction);
    if (action) {
      health.applicationsWithNextAction += 1;
      nextActions.push({ ...id, action, status: text(app?.status) || null });
    }
    const history = Array.isArray(app?.followUp?.history) ? app.followUp.history : [];
    const items = history.map((record, index) => {
      const date = text(record?.nextDate || record?.date) || null;
      const state = classify(dateValue(date), asOf);
      if (state === 'overdue') health.overdue += 1;
      else if (state === 'due') health.due += 1;
      else if (state === 'upcoming') health.upcoming += 1;
      else health.undated += 1;
      return {
        ...id,
        date,
        classification: state,
        action: text(record?.nextAction) || null,
        channel: text(record?.channel) || null,
        contact: text(record?.contact) || null,
        note: text(record?.note) || null,
        sourceRow: Number.isFinite(record?.__line) ? record.__line : index + 1,
      };
    });
    items.sort(stableCompare);
    if (items.length) queue.push({ ...id, items });
  }

  queue.sort((a, b) => stableCompare({ ...a, date: a.items[0]?.date }, { ...b, date: b.items[0]?.date }));
  nextActions.sort(stableCompare);
  const provenance = Object.fromEntries(Object.entries(payload.sources || {}).map(([name, source]) => [name, {
    name: source?.name || name,
    path: source?.path || null,
    status: source?.status || 'absent',
    rows: Number.isFinite(source?.rows) ? source.rows : 0,
  }]));

  return {
    contractVersion: 1,
    asOf,
    followUpQueue: queue,
    nextActions,
    availability: sourceAvailability(payload.sources),
    health,
    provenance,
  };
}

export const projectWorkflow = buildWorkflowProjection;
export default buildWorkflowProjection;
