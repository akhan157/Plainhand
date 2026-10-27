#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveResumeArtifact, summarizeArtifactBlocker } from './apply-artifact-resolver.mjs';
import { detectPortalFamily } from './apply-adapter-contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFTS_PATH = join(__dirname, 'data/application-drafts.md');
const HEADER = [
  '| Updated | Company | Role | Portal | Draft Status | Resume | Referral | Resume URL | Notes |',
  '|---------|---------|------|--------|--------------|--------|----------|------------|-------|',
];
const ALLOWED_STATUSES = new Set([
  'saved_draft',
  'review_ready',
  'filled_not_saved',
  'blocked_before_save',
  'not_started',
]);

function printHelp() {
  console.log(`Usage:
  node application-drafts.mjs list
  node application-drafts.mjs get --company <name> --role <name>
  node application-drafts.mjs upsert --company <name> --role <name> [options]

Options for upsert:
  --portal <name>           Portal family, e.g. oracle_hcm
  --draft-status <status>   One of: ${Array.from(ALLOWED_STATUSES).join(', ')}
  --resume <path-or-name>   Resume artifact used for this role
  --report <path>           Matching report path for exact artifact resolution
  --candidate <slug>        Candidate slug override for resolver use
  --generate-resume         Generate an exact per-job resume if none exists
  --referral <value>        Referral used, e.g. Joel Thottam
  --resume-url <url>        Resume/app resume URL or resumable portal URL
  --notes <text>            Freeform notes
  --role-url <url>          Original job/app URL (stored in notes if provided)

If --portal is omitted but --role-url is present, portal is inferred.

  node application-drafts.mjs recover --company <name> --role <name>
  node application-drafts.mjs blockers --company <name> --role <name>

Recovery and blocker reporting:
  recover returns the persisted resumable URL, exact resume artifact, and
  next safe action. blockers returns only blockers recorded for the draft.

Resolver:
  node application-drafts.mjs resolve-resume --company <name> --role <name> --report <path> [--generate-resume]`);
}

function extractRoleUrl(notes) {
  const match = String(notes || '').match(/(?:^|;\s*)role_url=(\S+)/);
  return match ? match[1] : '';
}

function splitNotes(notes) {
  return String(notes || '')
    .split(/\s*;\s*/)
    .map((note) => note.trim())
    .filter((note) => note && !note.startsWith('role_url='));
}

function draftRecoveryReport(row) {
  if (!row) {
    return {
      ok: false,
      status: 'not_found',
      blockers: ['no persisted draft matches the exact company and role'],
      nextAction: 'Create or verify the exact company and role draft before recovery',
    };
  }

  const resumableUrl = row.resumeUrl || extractRoleUrl(row.notes);
  const blockers = splitNotes(row.notes);
  const hasResumableState = ['saved_draft', 'review_ready'].includes(row.draftStatus);
  if (!hasResumableState) {
    blockers.push(`draft status ${row.draftStatus || 'unknown'} is not resumable`);
  } else if (!resumableUrl) {
    blockers.push('saved draft has no resumable URL');
  }

  return {
    ok: blockers.length === 0,
    company: row.company,
    role: row.role,
    portal: row.portal,
    status: row.draftStatus,
    updated: row.updated,
    resumableUrl: resumableUrl || null,
    resume: row.resume || null,
    referral: row.referral || null,
    blockers,
    nextAction: blockers.length
      ? 'Resolve every blocker before reopening the application'
      : 'Open the resumable URL, inspect the saved draft, and hand off before submission',
  };
}

function findRow(rows, company, role) {
  const idx = findRowIndex(rows, company, role);
  return idx >= 0 ? rows[idx] : null;
}

function parseArgs(argv) {
  const [,, command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    return { command: null, help: true };
  }
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const next = rest[i + 1];
    switch (key) {
      case '--company': args.company = next; i += 1; break;
      case '--role': args.role = next; i += 1; break;
      case '--portal': args.portal = next; i += 1; break;
      case '--draft-status': args.draftStatus = next; i += 1; break;
      case '--resume': args.resume = next; i += 1; break;
      case '--report': args.report = next; i += 1; break;
      case '--candidate': args.candidate = next; i += 1; break;
      case '--referral': args.referral = next; i += 1; break;
      case '--resume-url': args.resumeUrl = next; i += 1; break;
      case '--notes': args.notes = next; i += 1; break;
      case '--role-url': args.roleUrl = next; i += 1; break;
      case '--generate-resume':
        args.generateResume = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown arg: ${key}`);
    }
  }
  return args;
}

function normalizeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .trim();
}

function normalizeKey(value) {
  return normalizeCell(value).toLowerCase().replace(/\s+/g, ' ');
}


function ensureFile() {
  if (!existsSync(DRAFTS_PATH)) {
    writeFileSync(DRAFTS_PATH, `${HEADER.join('\n')}\n`, 'utf8');
    return;
  }

  const content = readFileSync(DRAFTS_PATH, 'utf8').trimEnd();
  if (!content) {
    writeFileSync(DRAFTS_PATH, `${HEADER.join('\n')}\n`, 'utf8');
  }
}

function parseTable() {
  ensureFile();
  const lines = readFileSync(DRAFTS_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (HEADER.includes(line.trim())) continue;
    const parts = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (parts.length !== 9) continue;
    rows.push({
      updated: parts[0],
      company: parts[1],
      role: parts[2],
      portal: parts[3],
      draftStatus: parts[4],
      resume: parts[5],
      referral: parts[6],
      resumeUrl: parts[7],
      notes: parts[8],
    });
  }
  return rows;
}

function writeTable(rows) {
  const lines = [...HEADER];
  for (const row of rows) {
    lines.push([
      '|',
      normalizeCell(row.updated),
      '|',
      normalizeCell(row.company),
      '|',
      normalizeCell(row.role),
      '|',
      normalizeCell(row.portal),
      '|',
      normalizeCell(row.draftStatus),
      '|',
      normalizeCell(row.resume),
      '|',
      normalizeCell(row.referral),
      '|',
      normalizeCell(row.resumeUrl),
      '|',
      normalizeCell(row.notes),
      '|',
    ].join(' '));
  }
  writeFileSync(DRAFTS_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function requireIdentity(args) {
  if (!args.company) throw new Error('--company required');
  if (!args.role) throw new Error('--role required');
}

function nowIsoMinute() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function findRowIndex(rows, company, role) {
  const targetCompany = normalizeKey(company);
  const targetRole = normalizeKey(role);
  return rows.findIndex(
    (row) => normalizeKey(row.company) === targetCompany
      && normalizeKey(row.role) === targetRole,
  );
}

function upsertRow(args) {
  requireIdentity(args);
  if (!args.draftStatus) throw new Error('--draft-status required');
  if (!ALLOWED_STATUSES.has(args.draftStatus)) {
    throw new Error(`invalid --draft-status: ${args.draftStatus}`);
  }

  const rows = parseTable();
  const idx = findRowIndex(rows, args.company, args.role);
  const roleUrlNote = args.roleUrl ? `role_url=${args.roleUrl}` : '';
  const mergedNotes = [args.notes, roleUrlNote].filter(Boolean).join(' ; ');
  const portal = args.portal || detectPortalFamily(args.roleUrl || args.resumeUrl) || '';
  let resolvedResume = args.resume || '';

  if ((!resolvedResume || resolvedResume === 'auto') && args.report) {
    const resolution = resolveResumeArtifact({
      company: args.company,
      role: args.role,
      reportPath: args.report,
      candidate: args.candidate,
      generateIfMissing: Boolean(args.generateResume),
    });
    if (!resolution.ok) {
      throw new Error(summarizeArtifactBlocker(resolution));
    }
    resolvedResume = resolution.artifact.relativePdfPath;
  }

  const updated = {
    updated: nowIsoMinute(),
    company: args.company,
    role: args.role,
    portal,
    draftStatus: args.draftStatus,
    resume: resolvedResume,
    referral: args.referral || '',
    resumeUrl: args.resumeUrl || '',
    notes: mergedNotes,
  };

  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...updated };
  } else {
    rows.push(updated);
  }
  rows.sort((a, b) => `${a.company} ${a.role}`.localeCompare(`${b.company} ${b.role}`));
  if (!args.silent) console.log(JSON.stringify(updated, null, 2));
}

function getRow(args) {
  requireIdentity(args);
  const rows = parseTable();
  const idx = findRowIndex(rows, args.company, args.role);
  if (idx < 0) {
    console.log('{}');
    process.exit(1);
  }
  console.log(JSON.stringify(rows[idx], null, 2));
}

function recoverDraft(args) {
  requireIdentity(args);
  const row = findRow(parseTable(), args.company, args.role);
  const report = draftRecoveryReport(row);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

function reportDraftBlockers(args) {
  requireIdentity(args);
  const row = findRow(parseTable(), args.company, args.role);
  const report = draftRecoveryReport(row);
  console.log(JSON.stringify({
    company: report.company || args.company,
    role: report.role || args.role,
    status: report.status,
    blockers: report.blockers,
    nextAction: report.nextAction,
  }, null, 2));
  process.exitCode = report.blockers.length ? 1 : 0;
}

function resolveResume(args) {
  requireIdentity(args);
  if (!args.report) throw new Error('--report required');
  const resolution = resolveResumeArtifact({
    company: args.company,
    role: args.role,
    reportPath: args.report,
    candidate: args.candidate,
    generateIfMissing: Boolean(args.generateResume),
  });
  console.log(JSON.stringify(resolution, null, 2));
  process.exit(resolution.ok ? 0 : 1);
}

function listRows() {
  const rows = parseTable();
  console.log(JSON.stringify(rows, null, 2));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  switch (args.command) {
    case 'list':
      listRows();
      return;
    case 'get':
      getRow(args);
      return;
    case 'upsert':
      upsertRow(args);
      return;
    case 'recover':
      recoverDraft(args);
      return;
    case 'blockers':
      reportDraftBlockers(args);
      return;
    case 'resolve-resume':
      resolveResume(args);
      return;
    default:
      throw new Error(`unknown command: ${args.command}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}

export {
  draftRecoveryReport,
  parseTable,
  upsertRow,
};
