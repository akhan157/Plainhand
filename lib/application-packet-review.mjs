/**
 * Read-only application packet manifest and reviewer gate.
 *
 * This contract validates caller-supplied metadata and claims. It does not
 * read candidate files, rewrite a master CV, open a browser, or submit forms.
 */

export const PACKET_ARTIFACT_TYPES = Object.freeze(['resume', 'cover_letter', 'answers']);
const REQUIRED_METADATA = Object.freeze([
  'artifact_type', 'candidate', 'company', 'company_slug', 'role', 'role_slug',
  'artifact_date', 'generated_at', 'source_baseline', 'job_source',
  'job_source_type', 'report_path', 'report_id', 'jd_fingerprint',
  'content_fingerprint', 'generator', 'generator_version', 'status',
]);
const STATUSES = new Set(['ready', 'stale', 'superseded', 'blocked']);
const SOURCE_TYPES = new Set(['url', 'jd_file', 'manual']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const TYPE_FIELDS = Object.freeze({
  resume: ['page_count', 'template_id', 'format'],
  cover_letter: ['variants'],
  answers: ['answer_sources'],
});

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function slugify(value) {
  return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeTarget(input = {}) {
  const target = input.target && typeof input.target === 'object' ? input.target : input;
  return {
    company: text(target.company),
    role: text(target.role),
    companySlug: text(target.companySlug || target.company_slug) || slugify(target.company),
    roleSlug: text(target.roleSlug || target.role_slug) || slugify(target.role),
    roleUrl: text(target.roleUrl || target.role_url || target.url) || null,
  };
}

function artifactFilenameIdentity(path) {
  const name = text(path).split('/').pop() || '';
  const match = name.match(/^(?:cv|cover-letter|answers)-(.+)-([0-9]{4}-[0-9]{2}-[0-9]{2})(?:\.meta)?\.(?:pdf|html|md)$/);
  if (!match) return null;
  return { name, suffix: match[1], date: match[2] };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeArtifact(value, artifactType) {
  const artifact = value && typeof value === 'object' ? value : { path: value };
  return {
    type: artifactType,
    path: text(artifact.path || artifact.artifactPath),
    metadataPath: text(artifact.metadataPath || artifact.metaPath) || null,
    metadata: artifact.metadata && typeof artifact.metadata === 'object' ? clone(artifact.metadata) : null,
  };
}

function metadataProblems(artifact, target, report) {
  const problems = [];
  const meta = artifact.metadata;
  if (!artifact.path) problems.push({ code: 'artifact_path_missing', message: `${artifact.type} artifact path is missing` });
  if (!meta) return [...problems, { code: 'metadata_missing', message: `${artifact.type} metadata is missing` }];
  for (const field of REQUIRED_METADATA) {
    if (meta[field] === undefined || meta[field] === null || (typeof meta[field] === 'string' && !text(meta[field]))) {
      problems.push({ code: 'metadata_field_missing', field, message: `${artifact.type} metadata field ${field} is required` });
    }
  }
  for (const field of TYPE_FIELDS[artifact.type] || []) {
    const value = meta[field];
    const valid = Array.isArray(value) ? value.length > 0 : text(value) || (typeof value === 'number' && Number.isFinite(value));
    if (!valid) problems.push({ code: 'metadata_type_field_missing', field, message: `${artifact.type} metadata field ${field} is required` });
  }
  if (meta.artifact_type !== artifact.type) problems.push({ code: 'metadata_type_mismatch', message: `${artifact.type} metadata has the wrong artifact_type` });
  if (meta.company_slug !== target.companySlug || meta.role_slug !== target.roleSlug || meta.company !== target.company || meta.role !== target.role) {
    problems.push({ code: 'wrong_role_or_company', message: `${artifact.type} metadata does not match the exact company and role` });
  }
  if (meta.report_path !== report.path || meta.report_id !== report.id) {
    problems.push({ code: 'report_provenance_mismatch', message: `${artifact.type} metadata does not reference the packet report` });
  }
  if (!validDate(meta.artifact_date)) problems.push({ code: 'metadata_date_invalid', message: `${artifact.type} metadata artifact_date is malformed` });
  if (Number.isNaN(Date.parse(meta.generated_at))) problems.push({ code: 'metadata_timestamp_invalid', message: `${artifact.type} metadata generated_at is malformed` });
  if (!SOURCE_TYPES.has(meta.job_source_type)) problems.push({ code: 'metadata_source_type_invalid', message: `${artifact.type} metadata job_source_type is invalid` });
  if (!STATUSES.has(meta.status)) problems.push({ code: 'metadata_status_invalid', message: `${artifact.type} metadata status is invalid` });
  if (meta.status !== 'ready') problems.push({ code: 'artifact_not_ready', message: `${artifact.type} artifact is ${meta.status || 'not ready'}` });
  const filename = artifactFilenameIdentity(artifact.path);
  if (!filename) problems.push({ code: 'artifact_filename_malformed', message: `${artifact.type} artifact filename is malformed` });
  return problems;
}

/**
 * Create a serializable packet manifest. No filesystem check is performed;
 * reviewApplicationPacket performs deterministic metadata and claim checks.
 */
export function createPacketManifest(input = {}) {
  const target = normalizeTarget(input);
  const reportInput = input.report && typeof input.report === 'object' ? input.report : {};
  const report = {
    path: text(reportInput.path || reportInput.reportPath),
    id: text(reportInput.id || reportInput.reportId),
  };
  const artifactsInput = input.artifacts && typeof input.artifacts === 'object' ? input.artifacts : {};
  const artifacts = {
    resume: normalizeArtifact(artifactsInput.resume, 'resume'),
    cover_letter: normalizeArtifact(artifactsInput.cover_letter || artifactsInput.coverLetter, 'cover_letter'),
    answers: normalizeArtifact(artifactsInput.answers, 'answers'),
  };
  const provenance = {
    reportPath: report.path || null,
    reportId: report.id || null,
    sourceBaseline: text(input.sourceBaseline || input.source_baseline) || null,
    generatedAt: text(input.generatedAt || input.generated_at) || null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? clone(input.evidenceRefs) : [],
  };
  return {
    manifestVersion: 1,
    identity: target,
    report,
    artifacts,
    provenance,
    claims: Array.isArray(input.claims) ? clone(input.claims) : [],
    reviewerOutput: clone(input.reviewerOutput || input.reviewer_output) || null,
  };
}

function claimEvidenceIds(claim) {
  const ids = claim?.evidenceIds || claim?.evidence_ids || claim?.evidence;
  if (Array.isArray(ids)) return ids.map(text).filter(Boolean);
  const one = text(ids);
  return one ? [one] : [];
}

function reviewClaims(claims, evidence) {
  const evidenceById = new Map((Array.isArray(evidence) ? evidence : []).map((item) => [text(item?.id), item]));
  const checks = (Array.isArray(claims) ? claims : []).map((claim, index) => {
    const claimText = text(claim?.text || claim?.claim);
    const ids = claimEvidenceIds(claim);
    const linked = ids.map((evidenceId) => evidenceById.get(evidenceId)).filter(Boolean);
    const unsupported = !claimText || !ids.length || linked.length !== ids.length
      || linked.some((item) => item.verified !== true && item.status !== 'verified' || !text(item.source?.ref || item.source?.path || item.source));
    return {
      claimId: text(claim?.id) || `claim-${index + 1}`,
      claim: claimText,
      evidenceIds: ids,
      status: unsupported ? 'blocked' : 'supported',
      code: unsupported ? 'unsupported_claim' : null,
      message: unsupported ? 'claim must cite existing verified evidence with a source reference' : 'claim has verified source evidence',
    };
  });
  return checks;
}

/**
 * Review a manifest and claims. Every problem is retained in the returned
 * reviewer output so a human can correct a packet without losing history.
 */
export function reviewApplicationPacket(input = {}) {
  const manifest = input.manifest && typeof input.manifest === 'object'
    ? clone(input.manifest)
    : createPacketManifest(input);
  const target = normalizeTarget(manifest.identity || {});
  const report = {
    path: text(manifest.report?.path),
    id: text(manifest.report?.id),
  };
  const checks = [];
  if (!target.company || !target.role || !target.companySlug || !target.roleSlug) {
    checks.push({ code: 'packet_identity_missing', message: 'exact company, role, and normalized identity are required', blocking: true });
  }
  if (!report.path || !report.id) checks.push({ code: 'report_reference_missing', message: 'packet must reference exactly one report path and report id', blocking: true });
  for (const artifactType of PACKET_ARTIFACT_TYPES) {
    const artifact = manifest.artifacts?.[artifactType];
    if (!artifact || !artifact.path || !artifact.metadata) {
      checks.push({ code: 'packet_artifact_missing', artifactType, message: `${artifactType} reference and metadata are required`, blocking: true });
      continue;
    }
    for (const problem of metadataProblems(artifact, target, report)) checks.push({ ...problem, artifactType, blocking: true });
  }
  const claimChecks = reviewClaims(input.claims || manifest.claims, input.evidence || []);
  for (const check of claimChecks.filter((item) => item.status === 'blocked')) checks.push({ ...check, blocking: true });
  const reviewerOutput = {
    ...(manifest.reviewerOutput && typeof manifest.reviewerOutput === 'object' ? clone(manifest.reviewerOutput) : {}),
    ...(input.reviewerOutput && typeof input.reviewerOutput === 'object' ? clone(input.reviewerOutput) : {}),
    checks: clone(checks),
    claims: clone(claimChecks),
  };
  return {
    ok: checks.length === 0,
    status: checks.length ? 'blocked' : 'ready_for_review',
    manifest: clone(manifest),
    checks,
    claims: claimChecks,
    reviewerOutput,
    preservesMasterCv: true,
    submissionPerformed: false,
  };
}
export const buildPacketManifest = createPacketManifest;
export const validateApplicationPacket = reviewApplicationPacket;
export const reviewPacket = reviewApplicationPacket;

export function assertApplicationPacket(input = {}) {
  const result = reviewApplicationPacket(input);
  if (!result.ok) {
    const error = new Error(result.checks.map((check) => check.message).join('; '));
    error.code = 'APPLICATION_PACKET_REVIEW_BLOCKED';
    error.checks = result.checks;
    error.reviewerOutput = result.reviewerOutput;
    throw error;
  }
  return result;
}