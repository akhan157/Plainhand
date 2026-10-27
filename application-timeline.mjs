#!/usr/bin/env node
/**
 * Read-only application operating-system primitives.
 *
 * The tracker is the canonical source of company/role identity. Optional
 * ledgers enrich that identity but never create a second application record.
 * This module intentionally performs no writes and does not sort caller-owned
 * values in place.
 */

import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_STATUSES = Object.freeze([
  'Evaluated', 'Applied', 'Responded', 'Interview', 'Offer',
  'Rejected', 'Discarded', 'SKIP',
]);

const STATUS_ALIASES = Object.freeze({
  evaluated: 'Evaluated', evaluada: 'Evaluated', condicional: 'Evaluated',
  hold: 'Evaluated', evaluar: 'Evaluated', verificar: 'Evaluated',
  apply: 'Applied', applied: 'Applied', aplicado: 'Applied', aplicada: 'Applied',
  enviada: 'Applied', sent: 'Applied',
  responded: 'Responded', respondido: 'Responded',
  interview: 'Interview', entrevista: 'Interview',
  offer: 'Offer', oferta: 'Offer',
  rejected: 'Rejected', rechazado: 'Rejected', rechazada: 'Rejected',
  discarded: 'Discarded', descartado: 'Discarded', descartada: 'Discarded',
  cerrada: 'Discarded', cancelada: 'Discarded',
  skip: 'SKIP', 'no aplicar': 'SKIP', no_aplicar: 'SKIP', monitor: 'SKIP',
  'geo blocker': 'SKIP',
});

const OPTIONAL_SOURCES = Object.freeze({
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

export class ApplicationTimelineInputError extends Error {
  constructor(message, { code = 'APPLICATION_TIMELINE_MALFORMED', source = null, path = null, required = false } = {}) {
    super(message);
    this.name = 'ApplicationTimelineInputError';
    this.code = code;
    this.source = source;
    this.path = path;
    this.required = required;
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function cleanCell(value) {
  return text(value).replace(/\\\|/g, '|').replace(/\r?\n/g, ' ');
}

export function identityPart(value) {
  return text(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function applicationKey(company, role) {
  return `${identityPart(company)}::${identityPart(role)}`;
}

function headerKey(value) {
  return cleanCell(value)
    .toLocaleLowerCase()
    .replace(/[?]/g, '')
    .replace(/[()/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSeparator(line) {
  return /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
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
      cells.push(cleanCell(cell));
      cell = '';
      continue;
    }
    if (character === '\\' && !escaped) {
      escaped = true;
      cell += character;
      continue;
    }
    escaped = false;
    cell += character;
  }
  cells.push(cleanCell(cell));
  return cells;
}

function parseMarkdownTable(content, source, { required = false } = {}) {
  const rawContent = typeof content === 'string' ? content : '';
  const lines = rawContent.split(/\r?\n/).map((line) => line.trimEnd());
  const tableLines = lines.filter((line) => line.trim().startsWith('|'));
  if (!tableLines.length) {
    if (required || rawContent.trim()) throw malformed(`${source} has no markdown table`, source);
    return { headers: [], rows: [] };
  }

  const headerLineIndex = lines.findIndex((line) => line.trim().startsWith('|'));
  const headers = splitTableLine(lines[headerLineIndex]);
  if (headers.length === 0 || headers.every((header) => !header)) {
    throw malformed(`${source} has an empty table header`, source);
  }
  const normalizedHeaders = headers.map(headerKey);
  const rows = [];
  for (let index = headerLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|') || isSeparator(line)) continue;
    const cells = splitTableLine(line);
    if (cells.length !== headers.length) {
      throw malformed(`${source} row ${index + 1} has ${cells.length} fields; expected ${headers.length}`, source);
    }
    if (cells.every((cell) => !cell)) continue;
    const row = {};
    for (let cellIndex = 0; cellIndex < normalizedHeaders.length; cellIndex += 1) {
      row[normalizedHeaders[cellIndex]] = cells[cellIndex];
    }
    row.__line = index + 1;
    rows.push(row);
  }
  return { headers: normalizedHeaders, rows };
}

function malformed(message, source, path = null) {
  return new ApplicationTimelineInputError(message, { source, path, required: source === 'applications' });
}

function missingTracker(path) {
  return new ApplicationTimelineInputError(`required tracker file not found under ${path}`, {
    code: 'APPLICATION_TIMELINE_TRACKER_MISSING',
    source: 'applications',
    path,
    required: true,
  });
}

function locate(root, candidates) {
  for (const candidate of candidates) {
    const path = join(root, candidate);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function trackerPath(root) {
  return locate(root, ['applications.md', 'data/applications.md']);
}

function sourceRecord(name, path, status, rows = 0) {
  return Object.freeze({ name, path: path || null, status, rows });
}

function valueOf(row, names) {
  for (const name of names) {
    const wanted = headerKey(name);
    const direct = row[name];
    if (direct != null && text(direct)) return cleanCell(direct);
    const match = Object.entries(row).find(([key, value]) => key !== '__line' && headerKey(key) === wanted && value != null && text(value));
    if (match) return cleanCell(match[1]);
  }
  return '';
}

function requireColumns(rows, headers, source, names) {
  const missing = names.filter((name) => !headers.some((header) => name.includes(header) || header.includes(name)));
  if (missing.length) throw malformed(`${source} is missing required columns: ${missing.join(', ')}`, source);
  if (!rows.every((row) => names.every((name) => valueOf(row, [name])))) {
    throw malformed(`${source} contains a row with missing required identity fields`, source);
  }
}

function dateSortValue(value) {
  const clean = text(value);
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(clean) ? clean : `~${clean}`;
}

function compareDateThenLine(a, b) {
  const dateComparison = dateSortValue(a.date).localeCompare(dateSortValue(b.date));
  return dateComparison || (a.__line || 0) - (b.__line || 0);
}

function normalizeStatus(value) {
  const clean = text(value).replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const canonical = STATUS_ALIASES[clean.toLocaleLowerCase()];
  if (canonical) return canonical;
  if (CANONICAL_STATUSES.includes(clean)) return clean;
  throw new ApplicationTimelineInputError(`unknown tracker status: ${clean || '(empty)'}`, {
    source: 'applications', required: true,
  });
}

function linkPath(value) {
  const clean = text(value);
  const markdown = clean.match(/\[[^\]]*\]\(([^)]+)\)/);
  return markdown ? markdown[1].trim() : clean || null;
}

function trackerRows(content, path) {
  const parsed = parseMarkdownTable(content, 'applications', { required: true });
  const { rows, headers } = parsed;
  requireColumns(rows, headers, 'applications', ['company', 'role', 'status']);
  return rows.map((row) => {
    const company = valueOf(row, ['company']);
    const role = valueOf(row, ['role']);
    const date = valueOf(row, ['date', 'submitted', 'created', 'updated']);
    const status = normalizeStatus(valueOf(row, ['status', 'state']));
    const num = valueOf(row, ['#', 'num', 'id']);
    return {
      __line: row.__line,
      num: num || null,
      date: date || null,
      company,
      role,
      score: valueOf(row, ['score']) || null,
      status,
      pdf: linkPath(valueOf(row, ['pdf', 'resume', 'cv'])),
      report: linkPath(valueOf(row, ['report', 'evaluation'])),
      notes: valueOf(row, ['notes', 'note']) || null,
      key: applicationKey(company, role),
    };
  });
}

function parseJsonRecords(content, source) {
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw malformed(`${source} contains malformed JSON: ${error.message}`, source);
  }
  if (!Array.isArray(value)) {
    if (value && Array.isArray(value.records)) value = value.records;
    else throw malformed(`${source} JSON must be an array or {records: []}`, source);
  }
  return value.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw malformed(`${source} JSON record ${index + 1} is not an object`, source);
    }
    return { ...record, __line: index + 1 };
  });
}

function optionalRows(content, path, source) {
  if (path.endsWith('.json')) return parseJsonRecords(content, source);
  const parsed = parseMarkdownTable(content, source);
  return parsed.rows;
}

function standardOptionalRecord(row, source) {
  const company = valueOf(row, ['company', 'employer', 'organization']);
  const role = valueOf(row, ['role', 'position', 'job']);
  const date = valueOf(row, ['date', 'updated', 'created', 'when', 'scheduled']);
  return {
    ...row,
    company,
    role,
    date: date || null,
    key: company && role ? applicationKey(company, role) : null,
    __source: source,
    __line: row.__line || null,
  };
}

function readOptional(root, name) {
  const path = locate(root, OPTIONAL_SOURCES[name]);
  if (!path) return { records: [], source: sourceRecord(name, null, 'absent') };
  const content = readFileSync(path, 'utf8');
  const records = optionalRows(content, path, name).map((row) => standardOptionalRecord(row, name));
  return { records, source: sourceRecord(name, path, 'present', records.length) };
}

function matches(record, app) {
  const applicationNumber = valueOf(record, ['application number', 'application', 'app num', 'application #', 'app #']);
  if (applicationNumber && app.num && applicationNumber === app.num) return true;
  if (record.key) return record.key === app.key;
  const company = identityPart(record.company);
  return Boolean(company) && company === identityPart(app.company);
}

function recordLabel(record) {
  return text(record.name || record.contact || record.interviewer || record.person || record.email) || null;
}

function canonicalContact(record) {
  return {
    name: recordLabel(record),
    email: text(record.email) || null,
    phone: text(record.phone) || null,
    type: text(record.type || record.kind || record.contact_type) || null,
    linkedin: text(record.linkedin || record.linkedin_url || record.profile) || null,
    company: record.company || null,
    role: record.role || null,
    notes: text(record.notes || record.note) || null,
    date: record.date || null,
  };
}

function canonicalFollowUp(record) {
  const nextAction = valueOf(record, ['next action', 'next_action', 'action']);
  return {
    date: record.date || null,
    channel: valueOf(record, ['channel', 'method']) || null,
    contact: valueOf(record, ['contact', 'person', 'name']) || null,
    note: valueOf(record, ['notes', 'note']) || null,
    nextDate: valueOf(record, ['next date', 'next_date', 'follow up date']) || null,
    nextAction: nextAction || null,
    appNum: valueOf(record, ['app num', 'application', 'application number', 'application #', 'app #', 'num']) || null,
  };
}

function canonicalInterview(record) {
  return {
    date: record.date || null,
    stage: valueOf(record, ['stage', 'round', 'type']) || null,
    status: valueOf(record, ['status', 'state']) || null,
    interviewer: valueOf(record, ['interviewer', 'contact', 'person', 'name']) || null,
    preparation: valueOf(record, ['prep', 'preparation', 'prep link', 'preparation link']) || null,
    notes: valueOf(record, ['notes', 'note']) || null,
  };
}
function draftArtifact(record) {
  const resume = valueOf(record, ['resume', 'cv', 'artifact', 'resume path']);
  const status = valueOf(record, ['draft status', 'status', 'state']);
  if (!resume && !status) return null;
  return { kind: 'draft', path: resume || null, status: status || null, updated: record.date || valueOf(record, ['updated']) || null };
}

function addArtifact(artifacts, artifact) {
  if (!artifact?.path && !artifact?.status) return;
  const duplicate = artifacts.some((item) => item.kind === artifact.kind && item.path === artifact.path && item.status === artifact.status);
  if (!duplicate) artifacts.push(artifact);
}

function nextActionFor(app, followUps, drafts, interviews) {
  for (const followUp of [...followUps].sort(compareDateThenLine).reverse()) {
    const action = valueOf(followUp, ['next action', 'next_action', 'action']);
    if (action) return action;
  }
  const latestDraft = [...drafts].sort(compareDateThenLine).reverse()[0];
  if (latestDraft) {
    const status = valueOf(latestDraft, ['draft status', 'status', 'state']).toLocaleLowerCase();
    if (status === 'saved_draft' || status === 'review_ready') return 'Review the saved draft before candidate submission';
    if (status === 'blocked_before_save') return 'Resolve the saved-draft blockers before reopening the application';
  }
  if (app.status === 'Interview') {
    const latestInterview = [...interviews].sort(compareDateThenLine).reverse()[0];
    return latestInterview?.preparation ? 'Review interview preparation before the next interview' : 'Prepare for the next interview stage';
  }
  if (app.status === 'Applied' || app.status === 'Responded') return 'Follow up with the recruiting contact';
  if (app.status === 'Evaluated') return 'Decide whether to apply';
  return null;
}

function buildApplication(app, optional) {
  const trackerHistory = optional.trackerRows.filter((row) => row.key === app.key).sort(compareDateThenLine);
  const contacts = optional.contacts.filter((record) => matches(record, app)).map(canonicalContact);
  const followUps = optional.followUps.filter((record) => matches(record, app));
  const interviews = optional.interviews.filter((record) => matches(record, app));
  const drafts = optional.drafts.filter((record) => matches(record, app));
  const artifacts = [];
  for (const row of trackerHistory) {
    addArtifact(artifacts, row.pdf && { kind: 'resume', path: row.pdf });
    addArtifact(artifacts, row.report && { kind: 'report', path: row.report });
  }
  for (const draft of drafts) addArtifact(artifacts, draftArtifact(draft));
  artifacts.sort((a, b) => `${a.kind}\0${a.path || ''}\0${a.status || ''}`.localeCompare(`${b.kind}\0${b.path || ''}\0${b.status || ''}`));
  const latest = trackerHistory[trackerHistory.length - 1];
  const statusHistory = trackerHistory.map((row) => ({
    status: row.status,
    date: row.date,
    applicationNumber: row.num,
    source: 'applications.md',
    row: row.__line,
  }));
  const followUpHistory = followUps.sort(compareDateThenLine).map(canonicalFollowUp);
  const latestFollowUp = followUpHistory[followUpHistory.length - 1] || null;
  const followUp = {
    history: followUpHistory,
    last: latestFollowUp,
    nextDate: latestFollowUp?.nextDate || null,
  };
  contacts.sort((a, b) => `${a.name || ''}\0${a.email || ''}`.localeCompare(`${b.name || ''}\0${b.email || ''}`));
  const canonicalInterviews = interviews.sort(compareDateThenLine).map(canonicalInterview);
  return {
    key: app.key,
    company: app.company,
    role: app.role,
    status: latest.status,
    currentStatus: latest.status,
    appliedDate: trackerHistory.find((row) => row.status === 'Applied')?.date || trackerHistory[0].date || null,
    statusHistory,
    artifacts,
    contacts,
    interviews: canonicalInterviews,
    followUp,
    nextAction: nextActionFor(latest, followUps, drafts, interviews),
  };
}

/**
 * Build the canonical, deterministic timeline under an explicit root.
 * `root` may contain applications.md directly or a data/applications.md file.
 */
export function buildApplicationTimeline(root, options = {}) {
  const explicitRoot = typeof root === 'object' && root !== null
    ? (root.root ?? root.rootDir ?? root.directory)
    : root;
  if (typeof explicitRoot !== 'string' || !text(explicitRoot)) {
    throw new ApplicationTimelineInputError('an explicit root directory is required', { code: 'APPLICATION_TIMELINE_ROOT_REQUIRED' });
  }
  const rootPath = resolve(explicitRoot);
  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    throw new ApplicationTimelineInputError(`timeline root is not a directory: ${explicitRoot}`, { code: 'APPLICATION_TIMELINE_ROOT_INVALID', path: rootPath });
  }
  const path = trackerPath(rootPath);
  if (!path) throw missingTracker(rootPath);
  const rows = trackerRows(readFileSync(path, 'utf8'), path);
  const optional = {
    trackerRows: rows,
    contacts: [],
    followUps: [],
    drafts: [],
    interviews: [],
  };
  const sources = { tracker: sourceRecord('tracker', path, 'present', rows.length) };
  for (const name of Object.keys(OPTIONAL_SOURCES)) {
    const loaded = readOptional(rootPath, name);
    optional[name] = loaded.records;
    sources[name] = loaded.source;
  }
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, row);
    else {
      const current = byKey.get(row.key);
      if (compareDateThenLine(current, row) <= 0) byKey.set(row.key, row);
    }
  }
  const applications = [...byKey.values()]
    .sort((a, b) => `${identityPart(a.company)}\0${identityPart(a.role)}`.localeCompare(`${identityPart(b.company)}\0${identityPart(b.role)}`))
    .map((app) => buildApplication(app, { ...optional, sources }));
  const result = {
    contractVersion: 1,
    applications,
    sources,
  };
  if (options.freeze === true) return deepFreeze(result);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const buildTimeline = buildApplicationTimeline;
export const readApplicationTimeline = buildApplicationTimeline;

function parseCli(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex >= 0) return argv[rootIndex + 1];
  return argv.find((value) => !value.startsWith('-')) || null;
}
export const loadApplicationTimeline = buildApplicationTimeline;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = parseCli(process.argv.slice(2));
    if (!root || process.argv.includes('--help') || process.argv.includes('-h')) {
      console.error('Usage: node application-timeline.mjs --root <directory>');
      process.exitCode = root ? 0 : 2;
    } else {
      console.log(JSON.stringify(buildApplicationTimeline(root), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code || 'APPLICATION_TIMELINE_ERROR', message: error.message, source: error.source || null, path: error.path || null } }, null, 2));
    process.exitCode = 1;
  }
}

export default buildApplicationTimeline;
