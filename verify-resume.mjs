#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { candidateSlugFromProfile, runArtifactContractSelfTests, verifyRealArtifacts } from './artifact-contract-verifier.mjs';
import { containsTerm, evaluateTermRendering, getTailoringRules, loadYaml } from './resume-tailoring-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const sourcePath = resolve(projectRoot, 'data', 'resume-source.yml');
const rulesPath = resolve(projectRoot, 'data', 'resume-rules.yml');

const errors = [];
const warnings = [];

function flattenBullets(source) {
  const bullets = [];
  for (const section of source.sections) {
    if (section.kind !== 'experience') continue;
    for (const entry of section.entries) {
      if (entry.groups) {
        for (const group of entry.groups) {
          bullets.push(...group.bullets);
        }
      } else if (entry.bullets) {
        bullets.push(...entry.bullets);
      }
    }
  }
  return bullets;
}

function collectSectionTitles(source) {
  return source.sections.map((section) => section.title);
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function parseFrontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return yaml.load(match[1]) || {};
}

function readPdfPageCount(pdfPath) {
  const pythonScript = `
from pypdf import PdfReader
reader = PdfReader(r'''${pdfPath}''')
print(len(reader.pages))
`;
  return Number(execFileSync('py', ['-c', pythonScript], { encoding: 'utf8' }).trim());
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function verifyTailoringMetadata(metaName, meta, markdown, reportPath) {
  const requiredMetadata = [
    'role_family',
    'tailoring_score',
    'tailoring_status',
    'required_terms_present',
    'required_terms_missing',
    'scope_policy',
    'scope_summary',
    'blocked_terms',
    'adjacent_terms_used',
    'rejected_rewrites',
    'evidence_trace',
    'tailoring_cap_reason',
    'section_changes',
    'term_decisions',
    'realized_adjacent_terms',
    'unrealized_direct_terms',
    'page_fill_actions',
    'fit_rationale',
    'page_fill_score',
    'page_fill_status',
  ];
  const missingMetadata = requiredMetadata.filter((key) => meta[key] === undefined);
  if (missingMetadata.length > 0) {
    warnings.push(`Tailored resume metadata missing quality fields for ${metaName}: ${missingMetadata.join(', ')}`);
    return;
  }

  const tailoringScore = Number(meta.tailoring_score);
  if (!Number.isFinite(tailoringScore) || tailoringScore < 0 || tailoringScore > 100) {
    errors.push(`Tailored resume metadata has invalid tailoring_score for ${metaName}: ${meta.tailoring_score}`);
  }
  const validStatuses = new Set(['strong', 'acceptable', 'weak']);
  if (!validStatuses.has(String(meta.tailoring_status))) {
    errors.push(`Tailored resume metadata has invalid tailoring_status for ${metaName}: ${meta.tailoring_status}`);
  }
  if (tailoringScore >= 85 && meta.tailoring_status !== 'strong') {
    errors.push(`Tailored resume metadata status mismatch for ${metaName}: score ${tailoringScore} should be strong`);
  } else if (tailoringScore >= 75 && tailoringScore < 85 && meta.tailoring_status !== 'acceptable') {
    errors.push(`Tailored resume metadata status mismatch for ${metaName}: score ${tailoringScore} should be acceptable`);
  } else if (tailoringScore < 75 && meta.tailoring_status !== 'weak') {
    errors.push(`Tailored resume metadata status mismatch for ${metaName}: score ${tailoringScore} should be weak`);
  }
  if (tailoringScore < 75) {
    warnings.push(`Tailored resume quality is weak for ${metaName}: tailoring_score=${tailoringScore}, role_family=${meta.role_family}`);
  }

  const blockedTerms = asArray(meta.blocked_terms);
  for (const term of blockedTerms) {
    if (containsTerm(markdown, term)) {
      errors.push(`Tailored resume leaked blocked term into markdown for ${metaName}: ${term}`);
    }
  }

  const rules = loadYaml(rulesPath);
  const families = Object.fromEntries(getTailoringRules(rules).families.map((family) => [family.id, family]));
  const family = families[meta.role_family];
  const termDecisions = asArray(meta.term_decisions).map((value) => {
    const [term, classification, satisfactionMode, renderedFlag, blockedReason = '', matchedBy = ''] = String(value).split('|');
    return {
      term,
      classification,
      satisfactionMode,
      rendered: renderedFlag === 'rendered',
      blockedReason,
      matchedBy,
      roleFamily: meta.role_family,
    };
  });

  for (const term of asArray(meta.required_terms_present)) {
    const termDecision = termDecisions.find((item) => item.term === term)
      || { term, classification: 'direct', satisfactionMode: 'literal_only', roleFamily: meta.role_family };
    const rendering = evaluateTermRendering(markdown, termDecision, family);
    if (!rendering.rendered) {
      errors.push(`Tailored resume metadata claims missing term is present for ${metaName}: ${term}`);
    }
  }

  const missingTerms = asArray(meta.required_terms_missing);
  if (missingTerms.length > 0) {
    warnings.push(`Tailored resume still has missing target terms for ${metaName}: ${missingTerms.join(', ')}`);
  }
  const adjacentTermsUsed = asArray(meta.adjacent_terms_used);
  const realizedAdjacentTerms = asArray(meta.realized_adjacent_terms);
  const unrealizedDirectTerms = asArray(meta.unrealized_direct_terms);
  const adjacentLeakedAsBlocked = adjacentTermsUsed.filter((term) => blockedTerms.includes(term));
  if (adjacentLeakedAsBlocked.length > 0) {
    errors.push(`Tailored resume metadata marks blocked terms as adjacent for ${metaName}: ${adjacentLeakedAsBlocked.join(', ')}`);
  }
  for (const term of realizedAdjacentTerms) {
    if (!adjacentTermsUsed.includes(term)) {
      warnings.push(`Tailored resume realized adjacent term not tracked in adjacent_terms_used for ${metaName}: ${term}`);
    }
  }
  for (const term of unrealizedDirectTerms) {
    if (asArray(meta.required_terms_present).includes(term)) {
      errors.push(`Tailored resume marks direct term unrealized but also present for ${metaName}: ${term}`);
    }
  }

  const outOfScopeCount = Number(meta.scope_out_of_scope_count);
  const adjacentCount = Number(meta.scope_adjacent_count);
  if (Number.isFinite(outOfScopeCount) && outOfScopeCount >= 3 && meta.tailoring_status !== 'weak') {
    errors.push(`Tailored resume status must be weak when scope_out_of_scope_count is high for ${metaName}: ${outOfScopeCount}`);
  }
  if (Number.isFinite(adjacentCount) && adjacentCount > 3 && meta.tailoring_status === 'strong') {
    errors.push(`Tailored resume cannot be strong with too many adjacent-only terms for ${metaName}: ${adjacentCount}`);
  }
  if (asArray(meta.section_changes).length === 0) {
    warnings.push(`Tailored resume reports no section_changes for ${metaName}; output may be generic`);
  }

  const pageFillScore = Number(meta.page_fill_score);
  if (!Number.isFinite(pageFillScore) || pageFillScore < 1) {
    errors.push(`Tailored resume metadata has invalid page_fill_score for ${metaName}: ${meta.page_fill_score}`);
  } else if (pageFillScore < 88) {
    warnings.push(`Tailored resume page fill is sparse for ${metaName}: page_fill_score=${pageFillScore}`);
  }
  if (!['full', 'acceptable', 'sparse', 'tight'].includes(String(meta.page_fill_status))) {
    errors.push(`Tailored resume metadata has invalid page_fill_status for ${metaName}: ${meta.page_fill_status}`);
  }
  if (meta.page_fill_status === 'sparse' && asArray(meta.page_fill_actions).length === 0) {
    warnings.push(`Tailored resume is sparse with no recorded expansion actions for ${metaName}`);
  }
  if (!String(meta.fit_rationale || '').trim()) {
    errors.push(`Tailored resume metadata missing fit_rationale for ${metaName}`);
  }

  if (reportPath && existsSync(reportPath)) {
    const reportText = readFileSync(reportPath, 'utf8');
    if (meta.role_family === 'quality_engineering' && !/quality|corrective|nonconformance|root cause|rca/i.test(reportText)) {
      warnings.push(`Tailored resume role_family may not match report for ${metaName}: ${meta.role_family}`);
    }
  }
}

function verifyGeneratedFiles(source, rules) {
  const mdPath = resolve(projectRoot, rules.resume.generated_markdown);
  const htmlPath = resolve(projectRoot, rules.resume.generated_html);
  const pdfPath = resolve(projectRoot, rules.resume.generated_pdf);
  const sourceStat = statSync(sourcePath);
  const rulesStat = statSync(rulesPath);

  for (const path of [mdPath, htmlPath]) {
    if (!existsSync(path)) {
      errors.push(`Missing generated file: ${path}`);
    }
  }
  if (!existsSync(pdfPath)) {
    warnings.push(`Missing generated PDF: ${pdfPath}`);
  }

  if (existsSync(mdPath) && existsSync(htmlPath)) {
    const newestInput = Math.max(sourceStat.mtimeMs, rulesStat.mtimeMs);
    for (const path of [mdPath, htmlPath]) {
      if (statSync(path).mtimeMs < newestInput) {
        errors.push(`Generated file is stale: ${path}. Rebuild with node build-resume.mjs`);
      }
    }
  }

  if (existsSync(pdfPath) && existsSync(htmlPath)) {
    if (statSync(pdfPath).mtimeMs < statSync(htmlPath).mtimeMs) {
      errors.push(`Generated PDF is stale: ${pdfPath}. Rebuild with node build-resume.mjs`);
    }
  }

  if (existsSync(mdPath)) {
    const md = readFileSync(mdPath, 'utf8');
    for (const title of collectSectionTitles(source)) {
      if (!md.includes(`## ${title}`)) {
        errors.push(`Markdown missing section title: ${title}`);
      }
    }
    for (const bullet of flattenBullets(source)) {
      if (!md.includes(bullet)) {
        errors.push(`Markdown missing bullet: ${bullet}`);
      }
    }
  }

  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf8');
    const header = source.header;
    for (const token of [header.name, header.location, header.phone, header.email, header.linkedin_display]) {
      if (!html.includes(token)) {
        errors.push(`HTML missing header token: ${token}`);
      }
    }
    for (const bullet of flattenBullets(source)) {
      if (!html.includes(bullet.replaceAll('&', '&amp;').replaceAll('"', '&quot;'))) {
        errors.push(`HTML missing bullet: ${bullet}`);
      }
    }
  }

  if (existsSync(pdfPath)) {
    const pythonScript = `
from pypdf import PdfReader
reader = PdfReader(r'''${pdfPath}''')
text = '\\n'.join(page.extract_text() or '' for page in reader.pages)
print('PAGES=' + str(len(reader.pages)))
print(text)
`;
    const output = execFileSync('py', ['-c', pythonScript], { encoding: 'utf8' });
    const match = output.match(/PAGES=(\\d+)/);
    const pageCount = match ? Number(match[1]) : NaN;
    if (pageCount > rules.resume.max_pages) {
      errors.push(`PDF exceeds max pages: ${pageCount} > ${rules.resume.max_pages}`);
    }
    const text = output.replace(/PAGES=\\d+\\r?\\n/, '');
    for (const phrase of [
      source.header.location,
      source.sections[1].groups[0].label,
      source.sections[2].entries[0].groups[0].bullets[0],
      source.sections[3].entries[0].bullets[1],
    ]) {
      if (!text.includes(phrase)) {
        errors.push(`PDF missing expected text: ${phrase}`);
      }
    }
  }
}

function verifyTailoredArtifactBundles(candidate) {
  const outputDir = resolve(projectRoot, 'output');
  if (!existsSync(outputDir)) return;

  const names = readdirSync(outputDir);
  const tempArtifacts = names.filter((name) => /\.tmp-\d+-\d+\./.test(name));
  for (const name of tempArtifacts) {
    errors.push(`Temporary tailored resume artifact was left behind: ${name}`);
  }

  const resumeMetaNames = names.filter((name) => /^cv-.+-\d{4}-\d{2}-\d{2}\.meta\.md$/.test(name));
  const regressionSummary = [];
  for (const metaName of resumeMetaNames) {
    const metaPath = resolve(outputDir, metaName);
    const meta = parseFrontmatter(metaPath);
    if (!meta || meta.artifact_type !== 'resume' || meta.candidate !== candidate) continue;

    const base = metaName.replace(/\.meta\.md$/, '');
    const mdPath = resolve(outputDir, `${base}.md`);
    const htmlPath = resolve(outputDir, `${base}.html`);
    const pdfPath = resolve(outputDir, `${base}.pdf`);
    if (meta.generator === 'legacy-metadata-backfill' || meta.status !== 'ready') {
      if (!existsSync(pdfPath)) {
        errors.push(`Legacy resume metadata has no matching PDF: ${metaName}`);
        continue;
      }
      const pageCount = readPdfPageCount(pdfPath);
      if (pageCount !== Number(meta.page_count)) {
        errors.push(`Legacy resume metadata page_count mismatch for ${metaName}: ${meta.page_count} != ${pageCount}`);
      }
      continue;
    }

    const required = [mdPath, htmlPath, pdfPath];
    for (const path of required) {
      if (!existsSync(path)) {
        errors.push(`Tailored resume bundle is incomplete: ${basename(path)} missing for ${metaName}`);
      }
    }
    if (required.some((path) => !existsSync(path))) continue;

    const markdown = readFileSync(mdPath, 'utf8');
    const fingerprint = sha256(markdown);
    if (meta.content_fingerprint !== fingerprint) {
      errors.push(`Tailored resume metadata content_fingerprint is stale for ${metaName}`);
    }

    const reportPath = meta.report_path ? resolve(projectRoot, meta.report_path) : null;
    if (!reportPath || !existsSync(reportPath)) {
      errors.push(`Tailored resume metadata references missing report for ${metaName}`);
    }
    verifyTailoringMetadata(metaName, meta, markdown, reportPath);

    const newestSource = Math.max(statSync(mdPath).mtimeMs, statSync(htmlPath).mtimeMs);
    if (statSync(pdfPath).mtimeMs < newestSource) {
      errors.push(`Tailored resume PDF is stale relative to md/html: ${basename(pdfPath)}`);
    }
    if (statSync(metaPath).mtimeMs < statSync(pdfPath).mtimeMs - 2000) {
      errors.push(`Tailored resume metadata is older than generated PDF: ${metaName}`);
    }

    const pageCount = readPdfPageCount(pdfPath);
    if (pageCount !== Number(meta.page_count)) {
      errors.push(`Tailored resume metadata page_count mismatch for ${metaName}: ${meta.page_count} != ${pageCount}`);
    }
    if (/qa-scope-v3/i.test(meta.company || '')) {
      regressionSummary.push(`${meta.company}: ${meta.role_family} | ${meta.tailoring_status} ${meta.tailoring_score} | ${meta.scope_summary} | missing=${asArray(meta.required_terms_missing).join(', ') || 'none'} | page_fill=${meta.page_fill_status}`);
    }
  }

  const candidatePrefix = `cv-${candidate}-`;
  const candidatePdfs = names.filter((name) => name.startsWith(candidatePrefix) && name.endsWith('.pdf'));
  const missingMetadata = [];
  for (const pdfName of candidatePdfs) {
    const metaName = pdfName.replace(/\.pdf$/, '.meta.md');
    if (!names.includes(metaName)) {
      missingMetadata.push(pdfName);
    }
  }
  if (missingMetadata.length > 0) {
    const examples = missingMetadata.slice(0, 5).join(', ');
    const suffix = missingMetadata.length > 5 ? `, +${missingMetadata.length - 5} more` : '';
    warnings.push(`Candidate resume artifacts without metadata will not resolve automatically (${missingMetadata.length}): ${examples}${suffix}`);
  }
  if (regressionSummary.length > 0) {
    console.log('\n=== regression suite ===');
    for (const line of regressionSummary.sort()) console.log(`  ${line}`);
  }
}

function verifyArtifactContract() {
  let profile;
  try {
    profile = loadYaml(resolve(projectRoot, 'config', 'profile.yml'));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    warnings.push('config/profile.yml not found; skipping real artifact contract scan');
    profile = null;
  }
  const candidate = candidateSlugFromProfile(profile);

  if (!candidate) {
    warnings.push('Could not derive candidate slug from config/profile.yml; skipping real artifact contract scan');
  } else {
    const real = verifyRealArtifacts({ projectRoot, candidate });
    for (const message of real.messages) {
      if (message.level === 'pass') {
        console.log(`✅ ${message.text}`);
      } else {
        errors.push(message.text);
      }
    }
  }
  verifyTailoredArtifactBundles(candidate);

  const checks = runArtifactContractSelfTests();
  for (const check of checks) {
    if (check.ok) {
      console.log(`✅ ${check.message}`);
    } else {
      errors.push(`artifact contract self-test failed: ${check.message}`);
    }
  }
}

function main() {
  let source;
  let rules;
  try {
    source = loadYaml(sourcePath);
    rules = loadYaml(rulesPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    console.log('\n=== resume verify ===\n');
    console.log('ERRORS (1):');
    console.log(`  ERROR: ${error.path} not found. Create it with the canonical structured resume source and rules.`);
    console.log('  See DATA_CONTRACT.md for the required files.');
    console.log('');
    process.exit(1);
  }
  verifyGeneratedFiles(source, rules);
  verifyArtifactContract();

  console.log('\n=== resume verify ===\n');
  if (errors.length === 0 && warnings.length === 0) {
    console.log('All checks passed.');
  } else {
    if (errors.length > 0) {
      console.log(`ERRORS (${errors.length}):`);
      for (const error of errors) console.log(`  ERROR: ${error}`);
    }
    if (warnings.length > 0) {
      console.log(`\nWARNINGS (${warnings.length}):`);
      for (const warning of warnings) console.log(`  WARN: ${warning}`);
    }
  }
  console.log('');
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
