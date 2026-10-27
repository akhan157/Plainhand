#!/usr/bin/env node

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { resolveResumeArtifact } from './apply-artifact-resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PROFILE_PATH = join(__dirname, 'config/profile.yml');
const ANSWERS_PATH = join(__dirname, 'data/application-answers.md');
const DRAFTS_PATH = join(__dirname, 'data/application-drafts.md');
const CONTACTS_PATH = join(__dirname, 'data/contacts.md');
const CV_PATH = join(__dirname, 'cv.md');
const APPLICATIONS_PATH = join(__dirname, 'data/applications.md');
const OUTPUT_DIR = join(__dirname, 'output');

const REQUIRED_RESUME_METADATA_FIELDS = [
  'artifact_type',
  'candidate',
  'company',
  'company_slug',
  'role',
  'role_slug',
  'artifact_date',
  'generated_at',
  'source_baseline',
  'job_source',
  'job_source_type',
  'report_path',
  'report_id',
  'jd_fingerprint',
  'content_fingerprint',
  'generator',
  'generator_version',
  'status',
  'page_count',
  'template_id',
  'format',
];

let errors = 0;
let warnings = 0;

function pass(msg) {
  console.log(`✅ ${msg}`);
}

function fail(msg) {
  console.log(`❌ ${msg}`);
  errors += 1;
}

function warn(msg) {
  console.log(`⚠️  ${msg}`);
  warnings += 1;
}

function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

function get(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => acc && acc[key], obj);
}

function parseTrackerEntries() {
  const content = readUtf8(APPLICATIONS_PATH);
  const entries = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    const num = Number(parts[1]);
    if (!Number.isFinite(num)) continue;
    entries.push({
      num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      pdf: parts[7],
      report: parts[8],
      notes: parts[9] || '',
    });
  }

  return entries;
}

function resolveReportPath(reportCell) {
  const match = reportCell.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  return join(__dirname, match[1]);
}

function extractReportUrl(reportPath) {
  const text = readUtf8(reportPath);
  const match = text.match(/^\*\*URL:\*\*\s+(.+)$/m);
  return {
    text,
    url: match ? match[1].trim() : null,
  };
}

function readFrontmatter(path) {
  const text = readUtf8(path);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('missing YAML frontmatter');
  }
  const yaml = require('js-yaml');
  return yaml.load(match[1]);
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      pass('Playwright Chromium is installed');
      return;
    }
  } catch {
    // fall through
  }
  fail('Playwright Chromium is not installed');
}

function validateRequiredFiles() {
  for (const path of [PROFILE_PATH, ANSWERS_PATH, CONTACTS_PATH, CV_PATH, APPLICATIONS_PATH]) {
    if (existsSync(path)) pass(`${path.replace(`${__dirname}\\`, '')} exists`);
    else fail(`${path.replace(`${__dirname}\\`, '')} is missing`);
  }

  if (existsSync(DRAFTS_PATH)) {
    pass('data/application-drafts.md exists');
  } else {
    warn('data/application-drafts.md does not exist yet; it will be created on first draft-save write');
  }
}

function validateProfile() {
  const yaml = require('js-yaml');
  const profile = yaml.load(readUtf8(PROFILE_PATH));
  const requiredKeys = [
    'candidate.full_name',
    'candidate.email',
    'candidate.phone',
    'candidate.linkedin',
    'address.line1',
    'address.city',
    'address.state',
    'address.zip',
    'eeo.us_citizen',
    'eeo.sponsorship_required',
    'location.visa_status',
    'location.willing_to_relocate',
    'compensation.target_range',
    'routine.constraint_value',
  ];

  for (const key of requiredKeys) {
    if (get(profile, key) === undefined || get(profile, key) === null || get(profile, key) === '') {
      fail(`profile.yml missing required apply key: ${key}`);
    } else {
      pass(`profile.yml key present: ${key}`);
    }
  }

  if (!Array.isArray(profile.languages) || profile.languages.length === 0) {
    fail('profile.yml languages must be a non-empty array');
  } else {
    pass(`profile.yml languages loaded (${profile.languages.length})`);
  }

  if (!Array.isArray(profile.references) || profile.references.length === 0) {
    fail('profile.yml references must be a non-empty array');
  } else {
    pass(`profile.yml references loaded (${profile.references.length})`);
  }
}

function validateAnswerBank() {
  const text = readUtf8(ANSWERS_PATH);
  for (let i = 1; i <= 15; i += 1) {
    const marker = new RegExp(`^## Q${i}\\b`, 'm');
    if (marker.test(text)) pass(`application-answers.md contains Q${i}`);
    else fail(`application-answers.md missing Q${i}`);
  }
}

function validateDraftLedger() {
  if (!existsSync(DRAFTS_PATH)) return;
  const text = readUtf8(DRAFTS_PATH);
  const expectedHeader = '| Updated | Company | Role | Portal | Draft Status | Resume | Referral | Resume URL | Notes |';
  if (!text.includes(expectedHeader)) {
    fail('data/application-drafts.md missing expected table header');
    return;
  }
  pass('data/application-drafts.md header is valid');

  const allowedStatuses = new Set([
    'saved_draft',
    'review_ready',
    'filled_not_saved',
    'blocked_before_save',
    'not_started',
  ]);

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    if (line.includes('| Updated |') || line.includes('|---------|')) continue;
    const parts = line.split('|').slice(1, -1).map((s) => s.trim());
    if (parts.length !== 9) {
      fail(`data/application-drafts.md row has unexpected column count: ${line}`);
      continue;
    }
    if (!allowedStatuses.has(parts[4])) {
      fail(`data/application-drafts.md row has invalid draft status: ${parts[4]}`);
    }
  }
}

function validateContractMetadataFiles() {
  if (!existsSync(OUTPUT_DIR)) {
    warn('output/ does not exist yet; skipping contract metadata scan');
    return;
  }

  const metaFiles = readdirSync(OUTPUT_DIR).filter((name) => name.endsWith('.meta.md'));
  if (metaFiles.length === 0) {
    warn('No contract-managed artifact metadata files found in output/');
    return;
  }

  for (const name of metaFiles) {
    const path = join(OUTPUT_DIR, name);
    let metadata;
    try {
      metadata = readFrontmatter(path);
    } catch (error) {
      fail(`${name}: invalid frontmatter (${error.message})`);
      continue;
    }

    const missing = REQUIRED_RESUME_METADATA_FIELDS.filter((field) => metadata?.[field] === undefined || metadata?.[field] === null || metadata?.[field] === '');
    if (metadata.artifact_type === 'resume') {
      if (missing.length > 0) {
        fail(`${name}: missing required resume metadata fields (${missing.join(', ')})`);
      } else {
        pass(`${name}: resume metadata fields present`);
      }
    } else {
      pass(`${name}: metadata file present for artifact_type=${metadata.artifact_type || 'unknown'}`);
    }
  }
}

function describeResolutionFailure(resolution) {
  if (!resolution.candidates?.length) {
    return resolution.blocker;
  }
  const sample = resolution.candidates[0];
  return `${resolution.blocker}; ${sample.filename}: ${sample.reasons.join(', ')}`;
}

function validateApplyRows(entries) {
  const applyEntries = entries.filter((entry) => entry.status.toLowerCase() === 'apply');
  pass(`Found ${applyEntries.length} Apply rows`);

  for (const entry of applyEntries) {
    const prefix = `#${entry.num} ${entry.company} - ${entry.role}`;
    const reportPath = resolveReportPath(entry.report);

    if (!reportPath || !existsSync(reportPath)) {
      fail(`${prefix}: report missing (${entry.report})`);
      continue;
    }
    pass(`${prefix}: report exists`);

    const { text: reportText, url } = extractReportUrl(reportPath);
    if (!url) {
      fail(`${prefix}: report missing **URL:** line`);
    } else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          fail(`${prefix}: report URL is not http/https (${url})`);
        } else {
          pass(`${prefix}: report URL parsed`);
        }
      } catch {
        fail(`${prefix}: report URL is invalid (${url})`);
      }
    }

    if (!/\*\*Score:?\*?\*?\s+.+/.test(reportText) && !/\*\*Score:\s*.+\*\*/.test(reportText)) {
      fail(`${prefix}: report missing **Score:** line`);
    } else {
      pass(`${prefix}: report score line present`);
    }

    const resolution = resolveResumeArtifact({
      company: entry.company,
      role: entry.role,
      reportPath,
    });

    if (resolution.ok) {
      pass(`${prefix}: exact resume resolves to ${resolution.artifact.relativePdfPath}`);
      continue;
    }

    if (entry.pdf === '✅') {
      warn(`${prefix}: tracker marks a tailored PDF, but contract resolution is blocked (${describeResolutionFailure(resolution)})`);
    } else if (entry.pdf === '❌') {
      pass(`${prefix}: no exact ready resume yet; generation or fresh tailoring is still required before fill`);
    } else {
      warn(`${prefix}: unexpected PDF column value (${entry.pdf})`);
    }
  }

  if (applyEntries.length === 0) {
    fail('No Apply rows found in data/applications.md');
  }
}

function writeFixtureMeta(path, fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    const serialized = typeof value === 'number' ? String(value) : `"${String(value)}"`;
    lines.push(`${key}: ${serialized}`);
  }
  lines.push('---', '', '# Fixture');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function createFixtureProject(label) {
  const root = mkdtempSync(join(tmpdir(), `career-ops-apply-${label}-`));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  mkdirSync(join(root, 'output'), { recursive: true });

  writeFileSync(join(root, 'config/profile.yml'), [
    'candidate:',
    '  full_name: "Test Candidate"',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'output/Resume-latest.pdf'), 'baseline', 'utf8');
  writeFileSync(join(root, 'reports/001-acme-role-2026-06-20.md'), [
    '# Evaluation: Acme Corp - Mechanical Engineer',
    '',
    '**Date:** 2026-06-20',
    '**URL:** https://example.com/job',
    '**Score:** 4.0/5',
    '',
  ].join('\n'), 'utf8');

  return root;
}

function baseMeta(overrides = {}) {
  return {
    artifact_type: 'resume',
    candidate: 'test-candidate',
    company: 'Acme Corp',
    company_slug: 'acme-corp',
    role: 'Mechanical Engineer',
    role_slug: 'mechanical-engineer',
    artifact_date: '2026-06-20',
    generated_at: '2026-06-20T12:00:00Z',
    source_baseline: 'output/Resume-latest.pdf',
    job_source: 'https://example.com/job',
    job_source_type: 'url',
    report_path: 'reports/001-acme-role-2026-06-20.md',
    report_id: '001-acme-role-2026-06-20',
    jd_fingerprint: 'jd',
    content_fingerprint: 'content',
    generator: 'build-resume.mjs',
    generator_version: 'test',
    status: 'ready',
    page_count: 1,
    template_id: 'cv-template-watson',
    format: 'letter',
    ...overrides,
  };
}

function writeFixtureResume(root, filename, metadata, withMeta = true) {
  const pdfPath = join(root, 'output', filename);
  writeFileSync(pdfPath, 'fixture-pdf', 'utf8');
  if (withMeta) {
    writeFixtureMeta(pdfPath.replace(/\.pdf$/i, '.meta.md'), metadata);
  }
}

function validateResolverFixtures() {
  {
    const root = createFixtureProject('newest-ready');
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-20.pdf',
      baseMeta({ generated_at: '2026-06-20T10:00:00Z', content_fingerprint: 'older' }),
    );
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-21.pdf',
      baseMeta({
        artifact_date: '2026-06-21',
        generated_at: '2026-06-21T10:00:00Z',
        content_fingerprint: 'newer',
      }),
    );
    const result = resolveResumeArtifact({
      projectRoot: root,
      company: 'Acme Corp',
      role: 'Mechanical Engineer',
      reportPath: 'reports/001-acme-role-2026-06-20.md',
    });
    if (!result.ok || !result.artifact.relativePdfPath.endsWith('2026-06-21.pdf')) {
      fail('resolver fixture: newest ready exact match should win');
    } else {
      pass('resolver fixture: newest ready exact match wins');
    }
  }

  {
    const root = createFixtureProject('wrong-role');
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-field-engineer-2026-06-20.pdf',
      baseMeta({
        role: 'Field Engineer',
        role_slug: 'field-engineer',
      }),
    );
    const result = resolveResumeArtifact({
      projectRoot: root,
      company: 'Acme Corp',
      role: 'Mechanical Engineer',
      reportPath: 'reports/001-acme-role-2026-06-20.md',
    });
    if (result.ok || !result.candidates.some((candidate) => candidate.reasons.includes('same-company wrong-role artifact'))) {
      fail('resolver fixture: same-company wrong-role artifact must be rejected');
    } else {
      pass('resolver fixture: same-company wrong-role artifact is rejected');
    }
    if (result.candidates.some((candidate) => candidate.filename === 'Resume-latest.pdf')) {
      pass('resolver fixture: Resume-latest.pdf is surfaced only as a forbidden fallback');
    } else {
      fail('resolver fixture: forbidden Resume-latest.pdf fallback should be reported');
    }
  }

  {
    const root = createFixtureProject('stale');
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-20.pdf',
      baseMeta({ status: 'stale' }),
    );
    const result = resolveResumeArtifact({
      projectRoot: root,
      company: 'Acme Corp',
      role: 'Mechanical Engineer',
      reportPath: 'reports/001-acme-role-2026-06-20.md',
    });
    if (result.ok || !result.candidates.some((candidate) => candidate.reasons.includes('status=stale'))) {
      fail('resolver fixture: stale exact artifact must not resolve');
    } else {
      pass('resolver fixture: stale exact artifact is rejected');
    }
  }

  {
    const root = createFixtureProject('missing-meta');
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-20.pdf',
      baseMeta(),
      false,
    );
    const result = resolveResumeArtifact({
      projectRoot: root,
      company: 'Acme Corp',
      role: 'Mechanical Engineer',
      reportPath: 'reports/001-acme-role-2026-06-20.md',
    });
    if (result.ok || !result.candidates.some((candidate) => candidate.reasons.includes('missing metadata file'))) {
      fail('resolver fixture: exact artifacts without metadata must be rejected');
    } else {
      pass('resolver fixture: missing metadata blocks resolution');
    }
  }

  {
    const root = createFixtureProject('tie');
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-20.pdf',
      baseMeta({ generated_at: '2026-06-20T10:00:00Z', content_fingerprint: 'a' }),
    );
    writeFixtureResume(
      root,
      'cv-test-candidate-acme-corp-mechanical-engineer-2026-06-21.pdf',
      baseMeta({
        artifact_date: '2026-06-21',
        generated_at: '2026-06-20T10:00:00Z',
        content_fingerprint: 'b',
      }),
    );
    const result = resolveResumeArtifact({
      projectRoot: root,
      company: 'Acme Corp',
      role: 'Mechanical Engineer',
      reportPath: 'reports/001-acme-role-2026-06-20.md',
    });
    if (result.ok || !String(result.blocker).includes('multiple ready exact matches')) {
      fail('resolver fixture: freshness ties must block as ambiguous');
    } else {
      pass('resolver fixture: freshness ties block as ambiguous');
    }
  }
}

async function main() {
  console.log('verify-apply-mode');
  console.log('=================\n');

  validateRequiredFiles();
  await checkPlaywright();

  if (existsSync(PROFILE_PATH)) validateProfile();
  if (existsSync(ANSWERS_PATH)) validateAnswerBank();
  validateDraftLedger();
  validateContractMetadataFiles();
  if (existsSync(APPLICATIONS_PATH)) validateApplyRows(parseTrackerEntries());
  validateResolverFixtures();

  console.log('\n' + '='.repeat(50));
  console.log(`Apply Mode Health: ${errors} errors, ${warnings} warnings`);

  if (errors > 0) {
    console.log('🔴 Apply mode verification failed');
    process.exit(1);
  }

  if (warnings > 0) {
    console.log('🟡 Apply mode verification passed with warnings');
    process.exit(0);
  }

  console.log('🟢 Apply mode verification passed');
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
