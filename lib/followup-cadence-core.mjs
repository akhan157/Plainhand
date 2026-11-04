#!/usr/bin/env node
/**
 * Pure, local-first follow-up cadence analysis.
 *
 * This module reads an explicit root only. It never writes ledgers, and a draft
 * record is never counted as confirmed outreach activity.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  applicationKey,
  buildApplicationTimeline,
  identityPart,
} from './application-timeline.mjs';

const SOURCE_CANDIDATES = Object.freeze({
  tracker: ['applications.md', 'data/applications.md'],
  contacts: ['contacts.md', 'contacts.json', 'data/contacts.md', 'data/contacts.json'],
  followUps: [
    'follow-ups.md', 'followups.md', 'follow-ups.json', 'followups.json',
    'data/follow-ups.md', 'data/followups.md', 'data/follow-ups.json', 'data/followups.json',
  ],
  drafts: [
    'application-drafts.md', 'application-drafts.json',
    'data/application-drafts.md', 'data/application-drafts.json',
  ],
  interviews: [
    'interviews.md', 'interview-records.md', 'interviews.json', 'interview-records.json',
    'data/interviews.md', 'data/interview-records.md', 'data/interviews.json', 'data/interview-records.json',
  ],
});

const DEFAULT_CADENCE = Object.freeze({
  appliedFirst: 7,
  appliedSubsequent: 7,
  appliedMaxFollowups: 2,
  respondedInitial: 1,
  respondedSubsequent: 3,
  interviewThankYou: 1,
});

const URGENCY_ORDER = Object.freeze({ urgent: 0, overdue: 1, due: 2, upcoming: 3, cold: 4 });

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function headerKey(value) {
  return text(value).toLocaleLowerCase().replace(/[?]/g, '').replace(/[()/_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function valueOf(record, names) {
  const wanted = names.map(headerKey);
  for (const [key, value] of Object.entries(record)) {
    if (key === '__line') continue;
    if (wanted.includes(headerKey(key)) && text(value)) return text(value);
  }
  return '';
}

function splitTableLine(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of value) {
    if (character === '|' && !escaped) {
      cells.push(cell.replace(/\\\|/g, '|').trim());
      cell = '';
      continue;
    }
    escaped = character === '\\' && !escaped;
    cell += character;
  }
  cells.push(cell.replace(/\\\|/g, '|').trim());
  return cells;
}

function isSeparator(line) {
  return /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function parseMarkdown(content) {
  const lines = String(content || '').split(/\r?\n/).map((line) => line.trimEnd());
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('|'));
  if (headerIndex < 0) return [];
  const headers = splitTableLine(lines[headerIndex]).map(headerKey);
  const rows = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|') || isSeparator(line)) continue;
    const cells = splitTableLine(line);
    if (cells.length !== headers.length || cells.every((cell) => !cell)) continue;
    const row = { __line: index + 1 };
    headers.forEach((header, column) => { row[header] = cells[column]; });
    rows.push(row);
  }
  return rows;
}

function parseRecords(path) {
  const content = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`${path} contains malformed JSON: ${error.message}`);
    }
    const records = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.records) ? parsed.records : [];
    return records.filter((record) => record && typeof record === 'object' && !Array.isArray(record))
      .map((record, index) => ({ ...record, __line: index + 1 }));
  }
  return parseMarkdown(content);
}

function locate(root, candidates) {
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function sourceInfo(name, path, rows = 0) {
  return { name, path: path || null, status: path ? 'present' : 'absent', rows };
}

function validDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dateCompare(a, b) {
  return (a || '~').localeCompare(b || '~');
}

function compareStable(a, b) {
  return dateCompare(a.date, b.date) || (a.__line || 0) - (b.__line || 0)
    || text(a.channel).localeCompare(text(b.channel));
}

function normalizeCadence(options) {
  const input = options && typeof options === 'object' ? options : {};
  const values = {
    appliedFirst: input.appliedFirst ?? input.applied_first,
    appliedSubsequent: input.appliedSubsequent ?? input.applied_subsequent,
    appliedMaxFollowups: input.appliedMaxFollowups ?? input.applied_max_followups,
    respondedInitial: input.respondedInitial ?? input.responded_initial,
    respondedSubsequent: input.respondedSubsequent ?? input.responded_subsequent,
    interviewThankYou: input.interviewThankYou ?? input.interview_thankyou,
  };
  return Object.freeze(Object.fromEntries(Object.entries(DEFAULT_CADENCE).map(([key, fallback]) => {
    const number = Number(values[key]);
    return [key, Number.isFinite(number) && number >= 0 ? number : fallback];
  })));
}

function normalizeAsOf(value) {
  const asOf = validDate(value);
  if (!asOf) throw new TypeError('asOf must be an ISO date (YYYY-MM-DD)');
  return asOf;
}

function appNumber(record) {
  return valueOf(record, ['application number', 'application', 'app num', 'application #', 'app #']);
}

function identityFor(record) {
  const company = valueOf(record, ['company', 'employer', 'organization']);
  const role = valueOf(record, ['role', 'position', 'job']);
  return { company, role, key: company && role ? applicationKey(company, role) : null };
}

function matchesApplication(record, app) {
  const number = appNumber(record);
  if (number && app.applicationNumber && number === app.applicationNumber) return true;
  const identity = identityFor(record);
  return Boolean(identity.key) && identity.key === app.key;
}

function canonicalActivity(record) {
  const identity = identityFor(record);
  return {
    confirmed: true,
    date: validDate(valueOf(record, ['date', 'when', 'sent', 'sent date'])) || null,
    channel: valueOf(record, ['channel', 'method']) || null,
    contact: valueOf(record, ['contact', 'person', 'name']) || null,
    note: valueOf(record, ['note', 'notes']) || null,
    applicationNumber: appNumber(record) || null,
    company: identity.company || null,
    role: identity.role || null,
    sourceLine: record.__line || null,
  };
}

function canonicalDraft(record) {
  const identity = identityFor(record);
  const status = valueOf(record, ['draft status', 'status', 'state']) || null;
  const notes = valueOf(record, ['notes', 'note']) || null;
  return {
    kind: 'saved-draft',
    confirmed: false,
    date: validDate(valueOf(record, ['updated', 'date', 'created'])) || null,
    status,
    company: identity.company || null,
    role: identity.role || null,
    applicationNumber: appNumber(record) || null,
    note: notes,
    sourceLine: record.__line || null,
  };
}

function canonicalInterview(record) {
  return {
    date: validDate(valueOf(record, ['date', 'when', 'scheduled'])) || null,
    stage: valueOf(record, ['stage', 'round', 'type']) || null,
    status: valueOf(record, ['status', 'state']) || null,
    sourceLine: record.__line || null,
  };
}

function appDate(app) {
  return validDate(app.appliedDate) || app.statusHistory.map((entry) => validDate(entry.date)).filter(Boolean).at(-1) || null;
}

function statusName(status) {
  return text(status).toLocaleLowerCase();
}

function nextDateFor(status, applicationDate, lastSentDate, count, cadence) {
  if (!applicationDate) return null;
  if (status === 'applied') {
    if (count >= cadence.appliedMaxFollowups) return null;
    return addDays(lastSentDate || applicationDate, lastSentDate ? cadence.appliedSubsequent : cadence.appliedFirst);
  }
  if (status === 'responded') return addDays(lastSentDate || applicationDate, lastSentDate ? cadence.respondedSubsequent : cadence.respondedSubsequent);
  if (status === 'interview') return addDays(lastSentDate || applicationDate, cadence.interviewThankYou);
  return null;
}

function urgencyFor(status, applicationDate, nextDate, asOf, count, cadence) {
  if (status === 'applied' && count >= cadence.appliedMaxFollowups) return 'cold';
  if (!nextDate) return 'upcoming';
  if (status === 'responded' && count === 0 && applicationDate) {
    const age = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${applicationDate}T00:00:00Z`)) / 86400000);
    if (age < cadence.respondedInitial) return 'urgent';
  }
  if (nextDate < asOf) return 'overdue';
  if (nextDate === asOf) return 'due';
  return 'upcoming';
}

function daysUntil(date, asOf) {
  if (!date) return null;
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86400000);
}

function draftBlockers(drafts) {
  const blockers = [];
  for (const draft of drafts) {
    if (draft.status === 'blocked_before_save') blockers.push('draft status blocked_before_save');
    if (draft.status === 'filled_not_saved') blockers.push('draft status filled_not_saved');
  }
  return [...new Set(blockers)].sort();
}

function sourceProvenance(sources, matched) {
  return Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, {
    path: source.path,
    status: source.status,
    matchedRows: matched[name] || 0,
  }]));
}

function compareQueue(a, b) {
  return (URGENCY_ORDER[a.urgency] ?? 99) - (URGENCY_ORDER[b.urgency] ?? 99)
    || dateCompare(a.nextFollowupDate, b.nextFollowupDate)
    || identityPart(a.company).localeCompare(identityPart(b.company))
    || identityPart(a.role).localeCompare(identityPart(b.role))
    || a.key.localeCompare(b.key);
}

/**
 * Analyze follow-up cadence under an explicit local root.
 * `options.asOf` is required to keep scheduling deterministic.
 */
export function analyzeFollowupCadence(root, options = {}) {
  const rootConfig = typeof root === 'object' && root !== null ? root : {};
  const explicitRoot = typeof root === 'object' && root !== null
    ? root.root ?? root.rootDir ?? root.directory
    : root;
  if (typeof explicitRoot !== 'string' || !text(explicitRoot)) throw new TypeError('an explicit root directory is required');
  const rootPath = resolve(explicitRoot);
  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) throw new TypeError(`cadence root is not a directory: ${explicitRoot}`);
  const config = options && typeof options === 'object' && Object.keys(options).length ? options : rootConfig;
  const asOf = normalizeAsOf(config.asOf ?? rootConfig.asOf);
  const cadence = normalizeCadence(config.cadence || rootConfig.cadence || config);
  const timeline = buildApplicationTimeline(rootPath);

  const sources = { tracker: timeline.sources.tracker };
  const records = {};
  for (const name of ['contacts', 'followUps', 'drafts', 'interviews']) {
    const path = locate(rootPath, SOURCE_CANDIDATES[name]);
    if (!path) {
      sources[name] = sourceInfo(name, null, 0);
      records[name] = [];
      continue;
    }
    records[name] = parseRecords(path);
    sources[name] = sourceInfo(name, path, records[name].length);
  }

  const applications = timeline.applications.map((app) => {
    const applicationNumber = app.statusHistory.at(-1)?.applicationNumber || app.statusHistory.find((entry) => entry.applicationNumber)?.applicationNumber || null;
    const identity = { ...app, applicationNumber };
    const matched = { tracker: 1, contacts: 0, followUps: 0, drafts: 0, interviews: 0 };
    const sent = records.followUps.filter((record) => matchesApplication(record, identity)).map(canonicalActivity).sort(compareStable);
    const drafts = records.drafts.filter((record) => matchesApplication(record, identity)).map(canonicalDraft).sort(compareStable);
    const interviews = records.interviews.filter((record) => matchesApplication(record, identity)).map(canonicalInterview).sort(compareStable);
    const contacts = records.contacts.filter((record) => matchesApplication(record, identity));
    matched.contacts = contacts.length;
    matched.followUps = sent.length;
    matched.drafts = drafts.length;
    matched.interviews = interviews.length;
    const status = statusName(app.currentStatus || app.status);
    const applicationDate = appDate(app);
    const lastSentDate = sent.map((item) => item.date).filter(Boolean).at(-1) || null;
    const nextFollowupDate = nextDateFor(status, applicationDate, lastSentDate, sent.length, cadence);
    const urgency = ['applied', 'responded', 'interview'].includes(status)
      ? urgencyFor(status, applicationDate, nextFollowupDate, asOf, sent.length, cadence)
      : null;
    const recommendation = nextFollowupDate ? {
      kind: 'cadence-recommendation',
      confirmed: false,
      action: urgency === 'overdue' || urgency === 'due' || urgency === 'urgent' ? 'Prepare a follow-up; do not treat this recommendation as sent' : 'Plan a follow-up for the scheduled date',
      dueDate: nextFollowupDate,
      source: 'cadence',
    } : null;
    const draftRecommendations = recommendation ? [recommendation, ...drafts] : drafts;
    const blockers = draftBlockers(drafts);
    const entry = {
      key: app.key,
      applicationNumber,
      company: app.company,
      role: app.role,
      status,
      applicationDate,
      confirmedSentActivity: sent,
      confirmedActivity: sent,
      confirmedSentCount: sent.length,
      lastConfirmedSentDate: lastSentDate,
      draftRecommendations,
      persistedDrafts: drafts,
      activity: {
        confirmedSent: sent,
        draftRecommendations,
      },
      interviewActivity: interviews,
      blockers,
      nextFollowupDate,
      daysUntilNext: daysUntil(nextFollowupDate, asOf),
      urgency,
      sourceProvenance: sourceProvenance(sources, matched),
    };
    return entry;
  });

  const queue = applications.filter((entry) => entry.urgency).sort(compareQueue);
  const counts = (value) => queue.filter((entry) => entry.urgency === value).length;
  return {
    contractVersion: 1,
    asOf,
    cadence,
    sources,
    metadata: {
      totalTracked: applications.length,
      actionable: queue.length,
      urgent: counts('urgent'),
      overdue: counts('overdue'),
      due: counts('due'),
      upcoming: counts('upcoming'),
      cold: counts('cold'),
    },
    applications: applications.sort((a, b) => a.key.localeCompare(b.key)),
    queue,
  };
}

export { DEFAULT_CADENCE };
export default analyzeFollowupCadence;
