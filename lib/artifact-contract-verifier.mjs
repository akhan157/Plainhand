import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

const REQUIRED_FIELDS = [
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
];
const TYPE_SPECIFIC_FIELDS = {
  resume: ['page_count', 'template_id', 'format'],
  cover_letter: ['variants'],
  answers: ['answer_sources'],
};
const ALLOWED_STATUSES = new Set(['ready', 'stale', 'superseded', 'blocked']);
const ALLOWED_JOB_SOURCE_TYPES = new Set(['url', 'jd_file', 'manual']);

const ARTIFACT_PATTERNS = {
  resume_pdf: /^cv-(.+)-(\d{4}-\d{2}-\d{2})\.pdf$/,
  resume_meta: /^cv-(.+)-(\d{4}-\d{2}-\d{2})\.meta\.md$/,
  cover_letter_html: /^cover-letter-(.+)-(\d{4}-\d{2}-\d{2})\.html$/,
  cover_letter_pdf: /^cover-letter-(.+)-(\d{4}-\d{2}-\d{2})\.pdf$/,
  cover_letter_meta: /^cover-letter-(.+)-(\d{4}-\d{2}-\d{2})\.meta\.md$/,
  answers_md: /^answers-(.+)-(\d{4}-\d{2}-\d{2})\.md$/,
  answers_meta: /^answers-(.+)-(\d{4}-\d{2}-\d{2})\.meta\.md$/,
};

const EXTENSION_TO_TYPE = new Map([
  ['resume_pdf', { artifactType: 'resume', format: 'pdf' }],
  ['resume_meta', { artifactType: 'resume', format: 'meta' }],
  ['cover_letter_html', { artifactType: 'cover_letter', format: 'html' }],
  ['cover_letter_pdf', { artifactType: 'cover_letter', format: 'pdf' }],
  ['cover_letter_meta', { artifactType: 'cover_letter', format: 'meta' }],
  ['answers_md', { artifactType: 'answers', format: 'md' }],
  ['answers_meta', { artifactType: 'answers', format: 'meta' }],
]);

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function candidateSlugFromProfile(profile) {
  if (profile?.candidate?.slug) return slugify(profile.candidate.slug);
  if (profile?.candidate?.full_name) return slugify(profile.candidate.full_name);
  return '';
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return yaml.load(match[1]) || {};
}

export function parseArtifactFileName(name) {
  for (const [kind, pattern] of Object.entries(ARTIFACT_PATTERNS)) {
    const match = name.match(pattern);
    if (!match) continue;
    const [, stem, artifact_date] = match;
    return {
      kind,
      ...EXTENSION_TO_TYPE.get(kind),
      stem,
      artifact_date,
    };
  }
  return null;
}

function readMetadata(metaPath) {
  if (!existsSync(metaPath)) {
    return { error: `metadata missing (${path.basename(metaPath)})` };
  }
  const meta = parseFrontmatter(readFileSync(metaPath, 'utf8'));
  if (!meta || typeof meta !== 'object') {
    return { error: `metadata frontmatter missing or invalid (${path.basename(metaPath)})` };
  }
  return { meta };
}

function validateRequiredMetadata(meta, artifactType) {
  const missing = [];
  for (const field of [...REQUIRED_FIELDS, ...TYPE_SPECIFIC_FIELDS[artifactType]]) {
    const value = meta[field];
    if (value === undefined || value === null || value === '') missing.push(field);
  }
  return missing;
}

function validateMetadataValues(meta, artifactType) {
  const errors = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.artifact_date || '')) || Number.isNaN(Date.parse(`${meta.artifact_date}T00:00:00Z`))) {
    errors.push(`invalid artifact_date (${meta.artifact_date})`);
  }
  if (Number.isNaN(Date.parse(String(meta.generated_at || '')))) {
    errors.push(`invalid generated_at (${meta.generated_at})`);
  }
  if (!ALLOWED_STATUSES.has(meta.status)) {
    errors.push(`invalid status (${meta.status})`);
  }
  if (!ALLOWED_JOB_SOURCE_TYPES.has(meta.job_source_type)) {
    errors.push(`invalid job_source_type (${meta.job_source_type})`);
  }
  if (artifactType === 'cover_letter' && (!Array.isArray(meta.variants) || meta.variants.length === 0)) {
    errors.push('variants must be a non-empty array');
  }
  if (artifactType === 'answers' && (!Array.isArray(meta.answer_sources) || meta.answer_sources.length === 0)) {
    errors.push('answer_sources must be a non-empty array');
  }

  return errors;
}

function buildMetaPath(outputDir, parsed) {
  const base = parsed.artifactType === 'resume'
    ? `cv-${parsed.stem}-${parsed.artifact_date}`
    : parsed.artifactType === 'cover_letter'
      ? `cover-letter-${parsed.stem}-${parsed.artifact_date}`
      : `answers-${parsed.stem}-${parsed.artifact_date}`;
  return path.join(outputDir, `${base}.meta.md`);
}

function collectArtifacts(outputDir) {
  if (!existsSync(outputDir)) return [];
  const names = readdirSync(outputDir);
  const artifacts = [];
  for (const name of names) {
    const parsed = parseArtifactFileName(name);
    if (!parsed || parsed.format === 'meta') continue;
    const filePath = path.join(outputDir, name);
    const metaPath = buildMetaPath(outputDir, parsed);
    const metadata = readMetadata(metaPath);
    artifacts.push({
      ...parsed,
      path: filePath,
      name,
      metaPath,
      meta: metadata.meta || null,
      metadataError: metadata.error || null,
      mtimeMs: existsSync(filePath) ? statSync(filePath).mtimeMs : 0,
    });
  }
  return artifacts;
}

function buildArtifactBaseName(artifactType, meta) {
  const prefix = artifactType === 'resume'
    ? 'cv'
    : artifactType === 'cover_letter'
      ? 'cover-letter'
      : 'answers';
  return `${prefix}-${meta.candidate}-${meta.company_slug}-${meta.role_slug}-${meta.artifact_date}`;
}

function buildArtifactPrefix(artifactType, candidate, companySlug, roleSlug) {
  const prefix = artifactType === 'resume'
    ? 'cv'
    : artifactType === 'cover_letter'
      ? 'cover-letter'
      : 'answers';
  return `${prefix}-${candidate}-${companySlug}-${roleSlug}`;
}

function checkFilenameMetadataIdentity(artifact, meta) {
  const expectedBase = buildArtifactBaseName(artifact.artifactType, meta);
  const actualBase = artifact.name.replace(/\.(meta\.md|pdf|html|md)$/, '');
  if (expectedBase !== actualBase) return 'filename/meta identity mismatch';
  return null;
}

function compareGeneratedAt(a, b) {
  const left = Date.parse(a.meta.generated_at || '');
  const right = Date.parse(b.meta.generated_at || '');
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  return right - left;
}

function resolveExistingArtifact({
  artifactType,
  candidate,
  companySlug,
  roleSlug,
  reportPath,
  reportId,
  outputDir,
  requireCoverLetter = false,
}) {
  if (artifactType === 'resume' && path.basename(path.normalize(outputDir)) === 'Resume-latest.pdf') {
    return {
      status: 'blocked',
      next: 'generate',
      reason: 'Resume-latest.pdf is never a default upload target',
      candidates: [],
    };
  }

  const prefix = buildArtifactPrefix(artifactType, candidate, companySlug, roleSlug);
  const companyPrefix = artifactType === 'resume'
    ? `cv-${candidate}-${companySlug}-`
    : artifactType === 'cover_letter'
      ? `cover-letter-${candidate}-${companySlug}-`
      : `answers-${candidate}-${companySlug}-`;
  const artifacts = collectArtifacts(outputDir).filter((artifact) => artifact.artifactType === artifactType);
  const exactCandidates = artifacts.filter((artifact) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.`).test(artifact.name));
  const wrongRoleCandidates = artifacts.filter((artifact) => artifact.name.startsWith(companyPrefix) && !artifact.name.startsWith(prefix));

  const candidates = exactCandidates.map((artifact) => ({ ...artifact, rejections: [] }));
  for (const artifact of candidates) {
    if (artifact.metadataError) {
      artifact.rejections.push(artifact.metadataError);
      continue;
    }
    const missing = validateRequiredMetadata(artifact.meta, artifactType);
    if (missing.length > 0) artifact.rejections.push(`missing fields: ${missing.join(', ')}`);
    const invalid = validateMetadataValues(artifact.meta, artifactType);
    if (invalid.length > 0) artifact.rejections.push(...invalid);
    const identityMismatch = checkFilenameMetadataIdentity(artifact, artifact.meta);
    if (identityMismatch) artifact.rejections.push(identityMismatch);
    if (artifact.meta.candidate !== candidate) artifact.rejections.push(`candidate mismatch (${artifact.meta.candidate})`);
    if (artifact.meta.company_slug !== companySlug) artifact.rejections.push(`company_slug mismatch (${artifact.meta.company_slug})`);
    if (artifact.meta.role_slug !== roleSlug) artifact.rejections.push(`role_slug mismatch (${artifact.meta.role_slug})`);
    if (artifact.meta.artifact_type !== artifactType) artifact.rejections.push(`artifact_type mismatch (${artifact.meta.artifact_type})`);
    if (reportPath && artifact.meta.report_path !== reportPath) artifact.rejections.push(`report_path mismatch (${artifact.meta.report_path})`);
    if (reportId && artifact.meta.report_id !== reportId) artifact.rejections.push(`report_id mismatch (${artifact.meta.report_id})`);
    if (!['ready'].includes(artifact.meta.status)) artifact.rejections.push(`status ${artifact.meta.status}`);
    const referencedReport = artifact.meta.report_path ? path.resolve(path.dirname(outputDir), artifact.meta.report_path) : null;
    if (!referencedReport || !existsSync(referencedReport)) artifact.rejections.push('referenced report missing');
  }

  const ready = candidates.filter((artifact) => artifact.rejections.length === 0);
  ready.sort(compareGeneratedAt);

  if (ready.length === 1) {
    return {
      status: 'resolved',
      next: 'use_artifact',
      artifact: ready[0],
      candidates,
    };
  }

  if (ready.length > 1) {
    const newest = ready[0];
    const tied = ready.filter((artifact) => compareGeneratedAt(artifact, newest) === 0);
    if (tied.length === 1) {
      return {
        status: 'resolved',
        next: 'use_artifact',
        artifact: newest,
        candidates,
      };
    }
    return {
      status: 'blocked',
      next: 'manual_review',
      reason: 'multiple ready exact matches tied on generated_at',
      candidates,
    };
  }

  if (artifactType === 'resume') {
    const reason = wrongRoleCandidates.length > 0
      ? 'same-company artifacts exist but all are for the wrong role'
      : 'no exact ready resume exists';
    return {
      status: 'blocked',
      next: 'generate',
      reason,
      candidates,
    };
  }

  if (artifactType === 'cover_letter') {
    return {
      status: 'blocked',
      next: 'generate',
      reason: 'no exact ready cover letter exists',
      candidates,
    };
  }

  return {
    status: 'blocked',
    next: 'manual_review',
    reason: 'no exact ready artifact exists',
    candidates,
  };
}

export function resolveArtifact({
  artifactType,
  candidate,
  companySlug,
  roleSlug,
  reportPath,
  reportId,
  outputDir,
  requireCoverLetter = false,
}) {
  if (artifactType === 'cover_letter' && !requireCoverLetter) {
    const ready = resolveExistingArtifact({ artifactType, candidate, companySlug, roleSlug, reportPath, reportId, outputDir, requireCoverLetter: true });
    if (ready.status === 'resolved') return ready;
    return {
      status: 'skip',
      next: 'skip_optional_cover_letter',
      reason: 'cover letter not required',
      candidates: ready.candidates,
    };
  }

  if (artifactType === 'answers') {
    const exact = resolveExistingArtifact({ artifactType, candidate, companySlug, roleSlug, reportPath, reportId, outputDir, requireCoverLetter: true });
    if (exact.status === 'blocked') {
      return {
        status: 'synthesize',
        next: 'synthesize_answers',
        reason: 'no exact ready answers artifact',
        candidates: exact.candidates,
      };
    }
    return exact;
  }

  return resolveExistingArtifact({ artifactType, candidate, companySlug, roleSlug, reportPath, reportId, outputDir, requireCoverLetter });
}

function makeMeta(overrides = {}) {
  return {
    artifact_type: 'resume',
    candidate: 'test-candidate',
    company: 'Example Corp',
    company_slug: 'example-corp',
    role: 'Mechanical Engineer',
    role_slug: 'mechanical-engineer',
    artifact_date: '2026-06-19',
    generated_at: '2026-06-19T12:00:00.000Z',
    source_baseline: 'output/Resume-latest.pdf',
    job_source: 'https://example.com/jobs/123',
    job_source_type: 'url',
    report_path: 'reports/123-example-corp-mechanical-engineer-2026-06-19.md',
    report_id: '123-example-corp-mechanical-engineer-2026-06-19',
    jd_fingerprint: 'jd-123',
    content_fingerprint: 'content-123',
    generator: 'tailor-resume.mjs',
    generator_version: 'test',
    status: 'ready',
    page_count: 1,
    template_id: 'watson',
    format: 'pdf',
    ...overrides,
  };
}

function writeMeta(metaPath, meta) {
  writeFileSync(metaPath, `---\n${yaml.dump(meta)}---\n`);
}

function createFixtureArtifact(outputDir, name, meta, content = 'fixture artifact') {
  const parsed = parseArtifactFileName(name);
  const artifactPath = path.join(outputDir, name);
  writeFileSync(artifactPath, content);
  if (parsed) {
    writeMeta(buildMetaPath(outputDir, parsed), meta);
  }
  return artifactPath;
}

function makeFixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'career-ops-artifact-contract-'));
  const outputDir = path.join(root, 'output');
  const reportsDir = path.join(root, 'reports');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  return { root, outputDir, reportsDir };
}

export function runArtifactContractSelfTests() {
  const { root, outputDir, reportsDir } = makeFixtureRoot();
  const checks = [];
  const expect = (condition, message) => checks.push({ ok: Boolean(condition), message });

  try {
    const reportPath = 'reports/123-example-corp-mechanical-engineer-2026-06-19.md';
    writeFileSync(path.join(root, reportPath), '# fixture report\n');

    expect(parseArtifactFileName('cv-test-candidate-example-corp-mechanical-engineer-2026-06-19.pdf')?.artifactType === 'resume', 'resume filename follows exact schema');
    expect(parseArtifactFileName('cover-letter-test-candidate-example-corp-mechanical-engineer-2026-06-19.html')?.artifactType === 'cover_letter', 'cover-letter HTML filename follows exact schema');
    expect(parseArtifactFileName('answers-test-candidate-example-corp-mechanical-engineer-2026-06-19.md')?.artifactType === 'answers', 'answers filename follows exact schema');
    expect(parseArtifactFileName('Resume-latest.pdf') === null, 'non-contract filenames are rejected');

    createFixtureArtifact(outputDir, 'cv-test-candidate-example-corp-mechanical-engineer-2026-06-19.pdf', makeMeta());
    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-example-corp-field-engineer-2026-06-19.pdf',
      makeMeta({ role: 'Field Engineer', role_slug: 'field-engineer', report_path: reportPath, report_id: '123-field' }),
    );
    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-example-corp-mechanical-engineer-2026-06-18.pdf',
      makeMeta({ artifact_date: '2026-06-18', generated_at: '2026-06-18T12:00:00.000Z', status: 'superseded' }),
    );
    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-example-corp-mechanical-engineer-2026-06-20.pdf',
      makeMeta({ artifact_date: '2026-06-20', generated_at: '2026-06-20T12:00:00.000Z' }),
    );
    createFixtureArtifact(
      outputDir,
      'cover-letter-test-candidate-example-corp-mechanical-engineer-2026-06-19.pdf',
      { ...makeMeta({ artifact_type: 'cover_letter', generator: 'generate-cover-letter.mjs', format: undefined }), variants: ['pdf'], status: 'ready' },
    );
    createFixtureArtifact(
      outputDir,
      'answers-test-candidate-example-corp-mechanical-engineer-2026-06-19.md',
      { ...makeMeta({ artifact_type: 'answers', generator: 'generate-answers.mjs', format: undefined }), answer_sources: ['report section g', 'data/application-answers.md'] },
    );
    writeFileSync(path.join(outputDir, 'Resume-latest.pdf'), 'baseline resume');

    const resume = resolveArtifact({
      artifactType: 'resume',
      candidate: 'test-candidate',
      companySlug: 'example-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: '123-example-corp-mechanical-engineer-2026-06-19',
      outputDir,
    });
    expect(resume.status === 'resolved', 'newest ready exact resume resolves');
    expect(resume.artifact?.name === 'cv-test-candidate-example-corp-mechanical-engineer-2026-06-20.pdf', 'newest ready exact resume wins');

    const wrongRole = resolveArtifact({
      artifactType: 'resume',
      candidate: 'test-candidate',
      companySlug: 'example-corp',
      roleSlug: 'process-engineer',
      reportPath,
      reportId: '123-example-corp-process-engineer-2026-06-19',
      outputDir,
    });
    expect(wrongRole.status === 'blocked' && /wrong role/.test(wrongRole.reason), 'same-company wrong-role resumes are rejected');

    const coverOptional = resolveArtifact({
      artifactType: 'cover_letter',
      candidate: 'test-candidate',
      companySlug: 'missing-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: 'missing',
      outputDir,
      requireCoverLetter: false,
    });
    expect(coverOptional.status === 'skip', 'optional missing cover letter is skippable');

    const coverRequired = resolveArtifact({
      artifactType: 'cover_letter',
      candidate: 'test-candidate',
      companySlug: 'missing-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: 'missing',
      outputDir,
      requireCoverLetter: true,
    });
    expect(coverRequired.status === 'blocked', 'required missing cover letter blocks');

    const answersResolved = resolveArtifact({
      artifactType: 'answers',
      candidate: 'test-candidate',
      companySlug: 'example-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: '123-example-corp-mechanical-engineer-2026-06-19',
      outputDir,
    });
    expect(answersResolved.status === 'resolved', 'exact answers artifact is reused when present');

    const answersSynthesized = resolveArtifact({
      artifactType: 'answers',
      candidate: 'test-candidate',
      companySlug: 'missing-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: 'missing',
      outputDir,
    });
    expect(answersSynthesized.status === 'synthesize', 'answers fall back to in-session synthesis instead of wrong-role reuse');

    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-ambiguous-corp-mechanical-engineer-2026-06-21.pdf',
      makeMeta({
        company: 'Ambiguous Corp',
        company_slug: 'ambiguous-corp',
        artifact_date: '2026-06-21',
        generated_at: '2026-06-21T12:00:00.000Z',
        report_path: reportPath,
        report_id: 'ambiguous-1',
      }),
    );
    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-ambiguous-corp-mechanical-engineer-2026-06-22.pdf',
      makeMeta({
        company: 'Ambiguous Corp',
        company_slug: 'ambiguous-corp',
        artifact_date: '2026-06-22',
        generated_at: '2026-06-21T12:00:00.000Z',
        report_path: reportPath,
        report_id: 'ambiguous-1',
      }),
    );
    const ambiguous = resolveArtifact({
      artifactType: 'resume',
      candidate: 'test-candidate',
      companySlug: 'ambiguous-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: 'ambiguous-1',
      outputDir,
    });
    expect(ambiguous.status === 'blocked', 'ambiguous exact matches block instead of guessing');

    createFixtureArtifact(
      outputDir,
      'cv-test-candidate-bad-meta-corp-mechanical-engineer-2026-06-23.pdf',
      makeMeta({
        company: 'Bad Meta Corp',
        company_slug: 'bad-meta-corp',
        artifact_date: '2026-06-23',
        generated_at: 'not-a-date',
        report_path: reportPath,
        report_id: 'bad-meta-1',
      }),
    );
    const badMeta = resolveArtifact({
      artifactType: 'resume',
      candidate: 'test-candidate',
      companySlug: 'bad-meta-corp',
      roleSlug: 'mechanical-engineer',
      reportPath,
      reportId: 'bad-meta-1',
      outputDir,
    });
    expect(badMeta.status === 'blocked', 'invalid generated_at blocks exact-match resolution');

    const realVerifierRoot = makeFixtureRoot();
    writeFileSync(path.join(realVerifierRoot.root, reportPath), '# fixture report\n');
    createFixtureArtifact(
      realVerifierRoot.outputDir,
      'cv-test-candidate-real-check-corp-mechanical-engineer-2026-06-24.pdf',
      makeMeta({
        company: 'Real Check Corp',
        company_slug: 'real-check-corp',
        artifact_date: '2026-06-24',
        generated_at: '2026-06-24T12:00:00.000Z',
        report_path: reportPath,
        report_id: 'real-check-1',
        generator_version: '',
      }),
    );
    const realVerifier = verifyRealArtifacts({ projectRoot: realVerifierRoot.root, candidate: 'test-candidate' });
    expect(realVerifier.errors > 0, 'real-artifact verification catches candidate-matching metadata errors');
    rmSync(realVerifierRoot.root, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return checks;
}

export function verifyRealArtifacts({ projectRoot, candidate }) {
  const outputDir = path.join(projectRoot, 'output');
  const reportsDir = path.join(projectRoot, 'reports');
  const messages = [];
  let errors = 0;

  if (existsSync(path.join(outputDir, 'Resume-latest.pdf'))) {
    messages.push({ level: 'pass', text: 'Resume baseline exists but is treated as source-only, not an exact artifact' });
  }

  const artifacts = collectArtifacts(outputDir);
  for (const artifact of artifacts) {
    if (artifact.meta?.candidate !== candidate) continue;
    if (artifact.metadataError) {
      messages.push({ level: 'error', text: `${artifact.name}: ${artifact.metadataError}` });
      errors += 1;
      continue;
    }
    const missing = validateRequiredMetadata(artifact.meta, artifact.artifactType);
    if (missing.length > 0) {
      messages.push({ level: 'error', text: `${artifact.name}: missing metadata fields ${missing.join(', ')}` });
      errors += 1;
    } else {
      messages.push({ level: 'pass', text: `${artifact.name}: metadata fields present` });
    }
    const invalid = validateMetadataValues(artifact.meta, artifact.artifactType);
    if (invalid.length > 0) {
      messages.push({ level: 'error', text: `${artifact.name}: ${invalid.join('; ')}` });
      errors += 1;
    } else {
      messages.push({ level: 'pass', text: `${artifact.name}: metadata values are valid` });
    }
    const identityMismatch = checkFilenameMetadataIdentity(artifact, artifact.meta);
    if (identityMismatch) {
      messages.push({ level: 'error', text: `${artifact.name}: filename/meta identity mismatch (${identityMismatch})` });
      errors += 1;
    }
    const reportFile = artifact.meta.report_path ? path.resolve(projectRoot, artifact.meta.report_path) : null;
    if (!reportFile || !existsSync(reportFile)) {
      messages.push({ level: 'error', text: `${artifact.name}: referenced report missing` });
      errors += 1;
    }
    if (['stale', 'superseded', 'blocked'].includes(artifact.meta.status)) {
      messages.push({ level: 'pass', text: `${artifact.name}: non-ready status (${artifact.meta.status}) will not auto-resolve` });
    }
  }

  if (existsSync(reportsDir)) {
    messages.push({ level: 'pass', text: 'reports/ directory exists for contract-linked artifacts' });
  }

  return { errors, messages };
}
