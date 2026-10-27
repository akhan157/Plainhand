#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, isAbsolute, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { buildTailoredResume, parseReport, slugify } from './resume-tailoring-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = __dirname;
const PROFILE_PATH = 'config/profile.yml';
const OUTPUT_DIR = 'output';
const BASELINE_RESUME = 'output/Resume-latest.pdf';
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

function resolveProjectPath(projectRoot, targetPath) {
  if (!targetPath) return null;
  return isAbsolute(targetPath) ? targetPath : resolve(projectRoot, targetPath);
}

function readYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

function readFrontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('missing YAML frontmatter');
  }
  return yaml.load(match[1]);
}

function loadCandidateSlug(projectRoot, explicitCandidate) {
  if (explicitCandidate) return slugify(explicitCandidate);
  const profilePath = resolve(projectRoot, PROFILE_PATH);
  if (!existsSync(profilePath)) {
    return null;
  }
  const profile = readYaml(profilePath);
  const candidate = profile?.candidate || {};
  return slugify(candidate.slug || candidate.full_name || '');
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function makeCandidateRecord(path, metaPath, filename, reasons, metadata = null) {
  return {
    path,
    metaPath,
    filename,
    metadata,
    reasons,
  };
}

function parseTargetIdentity(options) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  let report = null;
  if (options.reportPath) {
    const absoluteReportPath = resolveProjectPath(projectRoot, options.reportPath);
    report = {
      ...parseReport(absoluteReportPath),
      absolutePath: absoluteReportPath,
      relativePath: relative(projectRoot, absoluteReportPath).replace(/\\/g, '/'),
    };
  }

  const company = options.company || report?.company || null;
  const role = options.role || report?.role || null;
  const reportPath = report?.relativePath || options.reportPath || null;
  const reportId = report?.reportId || options.reportId || null;
  const candidate = loadCandidateSlug(projectRoot, options.candidate);

  return {
    projectRoot,
    company,
    companySlug: company ? slugify(company) : null,
    role,
    roleSlug: role ? slugify(role) : null,
    candidate,
    report,
    reportPath,
    reportId,
  };
}

function validateMetadata(projectRoot, metadata, target) {
  const reasons = [];

  for (const field of REQUIRED_RESUME_METADATA_FIELDS) {
    if (metadata?.[field] === undefined || metadata?.[field] === null || metadata?.[field] === '') {
      reasons.push(`missing metadata field ${field}`);
    }
  }

  if (metadata?.artifact_type && metadata.artifact_type !== 'resume') {
    reasons.push(`artifact_type=${metadata.artifact_type}`);
  }
  if (target.candidate && metadata?.candidate && metadata.candidate !== target.candidate) {
    reasons.push(`candidate mismatch (${metadata.candidate})`);
  }
  if (target.companySlug && metadata?.company_slug && metadata.company_slug !== target.companySlug) {
    reasons.push(`company_slug mismatch (${metadata.company_slug})`);
  }
  if (target.roleSlug && metadata?.role_slug && metadata.role_slug !== target.roleSlug) {
    reasons.push(`role_slug mismatch (${metadata.role_slug})`);
  }
  if (target.reportId && metadata?.report_id && metadata.report_id !== target.reportId) {
    reasons.push(`report_id mismatch (${metadata.report_id})`);
  }
  if (target.reportPath && metadata?.report_path && metadata.report_path !== target.reportPath.replace(/\\/g, '/')) {
    reasons.push(`report_path mismatch (${metadata.report_path})`);
  }
  if (metadata?.status && metadata.status !== 'ready') {
    reasons.push(`status=${metadata.status}`);
  }
  if (metadata?.report_path) {
    const reportPath = resolveProjectPath(projectRoot, metadata.report_path);
    if (!existsSync(reportPath)) {
      reasons.push(`missing report path ${metadata.report_path}`);
    }
  }

  return reasons;
}

function collectResumeCandidates(target) {
  const outputDir = resolve(target.projectRoot, OUTPUT_DIR);
  const sameCompanyPrefix = target.candidate && target.companySlug
    ? `cv-${target.candidate}-${target.companySlug}-`
    : null;
  if (!sameCompanyPrefix || !existsSync(outputDir)) {
    return [];
  }

  return readdirSync(outputDir)
    .filter((name) => name.endsWith('.pdf'))
    .filter((name) => name.startsWith(sameCompanyPrefix))
    .map((name) => {
      const path = join(outputDir, name);
      const metaPath = path.replace(/\.pdf$/i, '.meta.md');
      const reasons = [];
      let metadata = null;

      if (!target.roleSlug || !name.startsWith(`cv-${target.candidate}-${target.companySlug}-${target.roleSlug}-`)) {
        reasons.push('same-company wrong-role artifact');
      }

      if (!existsSync(metaPath)) {
        reasons.push('missing metadata file');
        return makeCandidateRecord(path, metaPath, name, reasons, metadata);
      }

      try {
        metadata = readFrontmatter(metaPath);
      } catch (error) {
        reasons.push(`invalid metadata (${error.message})`);
        return makeCandidateRecord(path, metaPath, name, reasons, metadata);
      }

      reasons.push(...validateMetadata(target.projectRoot, metadata, target));
      return makeCandidateRecord(path, metaPath, name, reasons, metadata);
    });
}

function summarizeCandidates(candidates) {
  return candidates.map((candidate) => ({
    filename: candidate.filename,
    reasons: candidate.reasons,
    metaPath: candidate.metaPath,
  }));
}

export function summarizeArtifactBlocker(result) {
  if (result.ok) {
    return `resolved ${result.artifact.relativePdfPath}`;
  }
  const prefix = `${result.artifactType} blocker for ${result.company || 'unknown company'} / ${result.role || 'unknown role'}`;
  if (!result.candidates.length) {
    return `${prefix}: no exact candidates`;
  }
  const first = result.candidates[0];
  return `${prefix}: ${first.filename} rejected (${first.reasons.join('; ')})`;
}

export function resolveResumeArtifact(options = {}) {
  const target = parseTargetIdentity(options);
  if (!target.company) {
    return {
      ok: false,
      artifactType: 'resume',
      company: null,
      role: target.role,
      candidates: [],
      generationPossible: false,
      blocker: 'company identity is unclear',
    };
  }
  if (!target.role) {
    return {
      ok: false,
      artifactType: 'resume',
      company: target.company,
      role: null,
      candidates: [],
      generationPossible: false,
      blocker: 'role identity is unclear',
    };
  }
  if (!target.candidate) {
    return {
      ok: false,
      artifactType: 'resume',
      company: target.company,
      role: target.role,
      candidates: [],
      generationPossible: false,
      blocker: 'candidate identity is unclear',
    };
  }

  const candidates = collectResumeCandidates(target);
  const readyCandidates = candidates.filter((candidate) => candidate.reasons.length === 0);

  if (readyCandidates.length === 1) {
    const winner = readyCandidates[0];
    return {
      ok: true,
      generated: false,
      artifactType: 'resume',
      company: target.company,
      role: target.role,
      artifact: {
        pdfPath: winner.path,
        relativePdfPath: relative(target.projectRoot, winner.path).replace(/\\/g, '/'),
        metaPath: winner.metaPath,
        relativeMetaPath: relative(target.projectRoot, winner.metaPath).replace(/\\/g, '/'),
        metadata: winner.metadata,
      },
      candidates: summarizeCandidates(candidates),
    };
  }

  if (readyCandidates.length > 1) {
    const sorted = [...readyCandidates].sort((left, right) => {
      const rightTs = normalizeTimestamp(right.metadata?.generated_at) ?? -1;
      const leftTs = normalizeTimestamp(left.metadata?.generated_at) ?? -1;
      return rightTs - leftTs;
    });
    const [winner, runnerUp] = sorted;
    const winnerTs = normalizeTimestamp(winner.metadata?.generated_at);
    const runnerUpTs = normalizeTimestamp(runnerUp?.metadata?.generated_at);
    if (winnerTs !== null && winnerTs !== runnerUpTs) {
      return {
        ok: true,
        generated: false,
        artifactType: 'resume',
        company: target.company,
        role: target.role,
        artifact: {
          pdfPath: winner.path,
          relativePdfPath: relative(target.projectRoot, winner.path).replace(/\\/g, '/'),
          metaPath: winner.metaPath,
          relativeMetaPath: relative(target.projectRoot, winner.metaPath).replace(/\\/g, '/'),
          metadata: winner.metadata,
        },
        candidates: summarizeCandidates(candidates),
      };
    }
    return {
      ok: false,
      artifactType: 'resume',
      company: target.company,
      role: target.role,
      candidates: summarizeCandidates(candidates),
      generationPossible: Boolean(target.reportPath),
      blocker: 'multiple ready exact matches remain with conflicting freshness metadata',
    };
  }

  if (options.generateIfMissing && target.reportPath) {
    buildTailoredResume({
      report: resolveProjectPath(target.projectRoot, target.reportPath),
      company: target.company,
      role: target.role,
    });
    const regenerated = resolveResumeArtifact({ ...options, generateIfMissing: false, projectRoot: target.projectRoot });
    if (regenerated.ok) {
      regenerated.generated = true;
    }
    return regenerated;
  }

  const fallbackExists = existsSync(resolve(target.projectRoot, BASELINE_RESUME));
  const candidatesSummary = summarizeCandidates(candidates);
  if (fallbackExists) {
    candidatesSummary.push({
      filename: 'Resume-latest.pdf',
      metaPath: resolve(target.projectRoot, BASELINE_RESUME),
      reasons: ['generic baseline exists but is a forbidden fallback'],
    });
  }

  return {
    ok: false,
    artifactType: 'resume',
    company: target.company,
    role: target.role,
    candidates: candidatesSummary,
    generationPossible: Boolean(target.reportPath),
    blocker: candidates.length > 0
      ? 'no ready exact-match resume artifact remains after contract checks'
      : 'no exact-match resume artifacts found',
  };
}
