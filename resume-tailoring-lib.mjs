#!/usr/bin/env node

import { createHash } from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, extname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadResumeModel, renderHtml, renderMarkdown } from './render-resume.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const profilePath = resolve(projectRoot, 'config', 'profile.yml');
const outputDir = resolve(projectRoot, 'output');
const baselinePdfPath = resolve(projectRoot, 'output', 'Resume-latest.pdf');

const DEFAULT_TAILORING_THRESHOLDS = {
  strong: 85,
  acceptable: 75,
};

const ROLE_FAMILY_FALLBACKS = {
  drawings_cad: {
    label: 'Drawings / CAD',
    patterns: ['autocad', 'cad', 'drawing', 'plans', 'revit', 'inventor'],
    required_terms: ['AutoCAD', 'drawings', 'plans'],
    rewrites: [], // personal rewrites live in config/profile.yml (resume.tailoring.role_families)
  },
  project_coordination: {
    label: 'Project Coordination',
    patterns: ['project coordination', 'coordination', 'contractor', 'workflow', 'commercial project'],
    required_terms: ['project coordination', 'contractor coordination'],
    rewrites: [], // personal rewrites live in config/profile.yml (resume.tailoring.role_families)
  },
  inspection_compliance: {
    label: 'Inspection / Compliance',
    patterns: ['inspection', 'regulatory', 'compliance', 'quality', 'documentation', 'records'],
    required_terms: ['inspection', 'compliance', 'documentation'],
    rewrites: [], // personal rewrites live in config/profile.yml (resume.tailoring.role_families)
  },
};

export function parseCliArgs(argv) {
  const args = {};
  const valueOptions = new Set([
    '--report',
    '--company',
    '--role',
    '--date',
    '--format',
    '--job-source',
    '--job-source-type',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!valueOptions.has(current)) {
      throw new Error(`Unknown argument: ${current}`);
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${current}`);
    }
    switch (current) {
      case '--report': args.report = next; index += 1; break;
      case '--company': args.company = next; index += 1; break;
      case '--role': args.role = next; index += 1; break;
      case '--date': args.date = next; index += 1; break;
      case '--format': args.format = next; index += 1; break;
      case '--job-source': args.jobSource = next; index += 1; break;
      case '--job-source-type': args.jobSourceType = next; index += 1; break;
      default: break;
    }
  }
  return args;
}

export function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    || 'unknown';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyPresentationRules(model) {
  const suppressedSchools = new Set(
    model?.rules?.resume?.presentation?.education?.suppress_location_for_schools || []
  );
  if (suppressedSchools.size === 0) return;

  for (const section of model.source.sections || []) {
    if (section.id !== 'education' || !Array.isArray(section.entries)) continue;
    for (const entry of section.entries) {
      if (suppressedSchools.has(entry.school)) {
        entry.location = '';
      }
    }
  }
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentTimestamp() {
  return new Date().toISOString();
}

function validateArtifactDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid artifact date "${value}". Use YYYY-MM-DD.`);
  }
}

function splitEvaluationHeading(heading) {
  const pipeParts = heading.split(/\s+\|\s+/).map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    return {
      company: pipeParts.slice(0, -1).join(' | '),
      role: pipeParts.at(-1),
    };
  }

  const slashParts = heading.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    return {
      company: slashParts.slice(0, -1).join(' / '),
      role: slashParts.at(-1),
    };
  }

  const dashParts = heading.split(/\s+[—-]\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    return {
      company: dashParts[0],
      role: dashParts.slice(1).join(' - '),
    };
  }

  return { company: heading.trim(), role: null };
}

export function parseReport(reportPath) {
  const absolutePath = resolve(reportPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Report not found: ${absolutePath}`);
  }
  const text = readFileSync(absolutePath, 'utf8');
  const headingMatch = text.match(/^# Evaluation:\s+(.+)$/m);
  const numberedHeadingMatch = text.match(/^#\s+#\d+\s+[—-]\s+(.+)$/m);
  const genericHeadingMatch = text.match(/^#\s+(.+)$/m);
  const dateMatch = text.match(/^\*\*Date:\*\*\s+([0-9]{4}-[0-9]{2}-[0-9]{2})$/m);
  const urlMatch = text.match(/^\*\*URL:\*\*\s+(.+)$/m);
  const heading = (headingMatch?.[1] || numberedHeadingMatch?.[1] || genericHeadingMatch?.[1] || basename(absolutePath, extname(absolutePath))).trim();
  const identity = splitEvaluationHeading(heading);

  return {
    absolutePath,
    relativePath: relative(projectRoot, absolutePath).replace(/\\/g, '/'),
    reportId: basename(absolutePath, extname(absolutePath)),
    text,
    heading: heading.replace(/^#\d+\s+[—-]\s+/, ''),
    company: identity.company,
    role: identity.role,
    date: dateMatch ? dateMatch[1] : null,
    url: urlMatch ? urlMatch[1].trim() : null,
  };
}

export function normalizeText(value) {
  return String(value || '').toLowerCase();
}

export function normalizeToken(value) {
  return normalizeText(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CONCEPT_STOPWORDS = new Set([
  'and',
  'or',
  'the',
  'to',
  'of',
  'for',
  'in',
  'with',
  'style',
]);

export function termPattern(term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped.replace(/ /g, '(?:\\\\s+|-)')}(?=$|[^a-z0-9])`, 'i');
}

export function containsTerm(text, term) {
  const normalized = String(text || '');
  if (termPattern(term).test(normalized)) return true;
  if (/^gd&t$/i.test(term)) return /\bgd\s*&\s*t\b|\bgeometric dimensioning\b/i.test(normalized);
  if (/^qms$/i.test(term)) return /\bqms\b|\bquality management system\b/i.test(normalized);
  if (/^rca$/i.test(term)) return /\brca\b|\broot cause\b/i.test(normalized);
  if (/^root cause$/i.test(term)) return /\broot cause\b|\brca\b|\brca-style\b/i.test(normalized);
  if (/^lean\/six sigma$/i.test(term)) return /\blean\b|\bsix sigma\b/i.test(normalized);
  if (/^civil 3d$/i.test(term)) return /\bcivil\s*3d\b/i.test(normalized);
  if (/^plan\/profile maps$/i.test(term)) return /\bplan\s*\/?\s*profile\b|\bplan and profile\b/i.test(normalized);
  return false;
}

export function matchesConcept(text, concept) {
  if (!concept) return false;
  if (containsTerm(text, concept)) return true;
  const conceptTokens = normalizeToken(concept)
    .split(' ')
    .filter((token) => token && !CONCEPT_STOPWORDS.has(token));
  if (conceptTokens.length === 0) return false;
  const textTokens = new Set(normalizeToken(text).split(' ').filter(Boolean));
  return conceptTokens.every((token) => textTokens.has(token));
}

export function getTailoringRules(rules) {
  const configured = rules?.resume?.tailoring?.role_families || {};
  const familySource = Object.keys(configured).length > 0 ? configured : ROLE_FAMILY_FALLBACKS;
  const families = Object.entries(familySource).map(([id, family]) => ({
    id,
    ...family,
    patterns: family.patterns || [],
    required_terms: family.required_terms || [],
    rewrites: family.rewrites || [],
    skill_promotions: family.skill_promotions || {},
    direct_evidence_terms: family.direct_evidence_terms || {},
    adjacent_evidence_terms: family.adjacent_evidence_terms || {},
    blocked_terms: family.blocked_terms || [],
    hard_block_terms: family.hard_block_terms || family.blocked_terms || [],
    concept_satisfaction_terms: family.concept_satisfaction_terms || {},
    adjacent_softened_terms: family.adjacent_softened_terms || {},
    rewrite_targets: family.rewrite_targets || [],
    expansion_candidates: family.expansion_candidates || [],
    compression_priority: family.compression_priority || [],
  }));
  return {
    families,
    strongMin: Number(rules?.resume?.tailoring?.strong_min_score || DEFAULT_TAILORING_THRESHOLDS.strong),
    acceptableMin: Number(rules?.resume?.tailoring?.acceptable_min_score || DEFAULT_TAILORING_THRESHOLDS.acceptable),
    scopePolicy: rules?.resume?.tailoring?.scope_policy || {},
  };
}

function getFamilyById(analysis, roleFamily) {
  return analysis.activeFamilies.find((family) => family.id === roleFamily)
    || analysis.activeFamilies[0]
    || null;
}

function getTermConfig(term, family) {
  const conceptTerms = family?.concept_satisfaction_terms?.[term] || [];
  const adjacentTerms = family?.adjacent_softened_terms?.[term] || [];
  const hardBlocked = [...(family?.hard_block_terms || []), ...(family?.blocked_terms || [])]
    .some((item) => normalizeToken(item) === normalizeToken(term));
  let satisfactionMode = 'literal_only';
  if (adjacentTerms.length > 0) satisfactionMode = 'adjacent_softened_bundle';
  else if (conceptTerms.length > 0) satisfactionMode = 'concept_bundle';
  return {
    term,
    conceptTerms,
    adjacentTerms,
    hardBlocked,
    satisfactionMode,
  };
}

function matchAnyConcept(text, concepts) {
  return (concepts || []).find((concept) => matchesConcept(text, concept)) || null;
}

export function evaluateTermRendering(markdown, termDecision, family) {
  const config = getTermConfig(termDecision.term, family);
  const literalMatch = containsTerm(markdown, termDecision.term);
  const conceptMatch = matchAnyConcept(markdown, config.conceptTerms);
  const adjacentMatch = termDecision.classification === 'adjacent'
    ? matchAnyConcept(markdown, config.adjacentTerms)
    : null;
  const rendered = literalMatch || Boolean(conceptMatch) || Boolean(adjacentMatch);
  const matchedBy = literalMatch
    ? termDecision.term
    : (conceptMatch || adjacentMatch || null);
  return {
    rendered,
    matchedBy,
    satisfactionMode: config.satisfactionMode,
    blockedReason: config.hardBlocked && termDecision.classification !== 'direct'
      ? 'hard_blocked_without_direct_evidence'
      : '',
  };
}

function scoreFamily(reportText, family) {
  const text = normalizeText(reportText);
  let score = 0;
  for (const pattern of family.patterns || []) {
    if (containsTerm(text, pattern)) score += 3;
  }
  for (const term of family.required_terms || []) {
    if (containsTerm(text, term)) score += 2;
  }
  return score;
}

function extractEvidenceCatalog(model) {
  const evidence = [];
  for (const section of model.source.sections || []) {
    if (section.kind === 'skills') {
      for (const group of section.groups || []) {
        for (const item of group.items || []) {
          evidence.push({
            type: 'skill',
            sectionId: section.id,
            label: group.label,
            text: item,
            ref: `${section.id}:${group.label}:${item}`,
          });
        }
      }
      continue;
    }

    if (section.kind === 'education') {
      for (const entry of section.entries || []) {
        for (const course of entry.coursework || []) {
          evidence.push({
            type: 'coursework',
            sectionId: section.id,
            label: entry.school,
            text: course,
            ref: `${section.id}:${entry.school}:${course}`,
          });
        }
      }
      continue;
    }

    if (section.kind !== 'experience') continue;
    for (const entry of section.entries || []) {
      if (entry.company) {
        evidence.push({
          type: 'company',
          sectionId: section.id,
          label: entry.role,
          text: entry.company,
          ref: `${section.id}:${entry.role}:company`,
        });
      }
      evidence.push({
        type: 'role',
        sectionId: section.id,
        label: entry.company || entry.role,
        text: entry.role,
        ref: `${section.id}:${entry.role}:role`,
      });
      const bulletGroups = entry.groups
        ? entry.groups.flatMap((group) => group.bullets.map((bullet) => ({ subtitle: group.subtitle, bullet })))
        : (entry.bullets || []).map((bullet) => ({ subtitle: null, bullet }));
      for (const [index, item] of bulletGroups.entries()) {
        evidence.push({
          type: 'bullet',
          sectionId: section.id,
          label: entry.role,
          text: item.bullet,
          ref: `${section.id}:${entry.role}:bullet${index + 1}`,
          subtitle: item.subtitle,
        });
      }
    }
  }
  return evidence;
}

function findEvidenceMatches(evidenceCatalog, concepts) {
  const hits = [];
  for (const concept of concepts || []) {
    for (const evidence of evidenceCatalog) {
      if (matchesConcept(evidence.text, concept)) {
        hits.push(evidence);
      }
    }
  }
  const unique = new Map();
  for (const hit of hits) unique.set(hit.ref, hit);
  return [...unique.values()];
}

function classifyTerm(term, family, evidenceCatalog, scopePolicy) {
  const blockedTerms = new Set([
    ...(scopePolicy.blocked_claim_terms || []),
    ...(family.hard_block_terms || family.blocked_terms || []),
  ].map((item) => String(item)));
  const directConcepts = family.direct_evidence_terms?.[term] || [term];
  const adjacentConcepts = family.adjacent_evidence_terms?.[term] || [];
  const directEvidence = findEvidenceMatches(evidenceCatalog, directConcepts);
  const adjacentEvidence = findEvidenceMatches(evidenceCatalog, adjacentConcepts);
  const termBlocked = [...blockedTerms].some((blocked) => normalizeToken(blocked) === normalizeToken(term));

  if (termBlocked && directEvidence.length === 0) {
    return {
      term,
      classification: 'out_of_scope',
      evidenceSources: [],
      allowedRewriteMode: 'blocked',
      notes: 'Blocked claim term without direct source-resume evidence.',
    };
  }

  if (directEvidence.length > 0) {
    return {
      term,
      classification: 'direct',
      evidenceSources: directEvidence.map((item) => item.ref),
      allowedRewriteMode: 'literal',
      notes: 'Direct source-resume evidence found.',
    };
  }

  if ((scopePolicy.allow_adjacent_softening ?? true) && adjacentEvidence.length > 0) {
    return {
      term,
      classification: 'adjacent',
      evidenceSources: adjacentEvidence.map((item) => item.ref),
      allowedRewriteMode: 'softened',
      notes: 'Adjacent source-resume evidence found; only softened wording is allowed.',
    };
  }

  return {
    term,
    classification: 'out_of_scope',
    evidenceSources: [],
    allowedRewriteMode: 'blocked',
    notes: 'No supporting source-resume evidence found.',
  };
}

function analyzeReport(reportText, rules) {
  const tailoring = getTailoringRules(rules);
  const scored = tailoring.families
    .map((family) => ({ family, score: scoreFamily(reportText, family) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.family.id.localeCompare(b.family.id));
  const primary = scored[0]?.family || tailoring.families[0] || { id: 'general', label: 'General', required_terms: [] };
  const primaryScore = scored[0]?.score || 0;
  const activeFamilies = scored
    .filter((item, index) => index === 0 || item.score >= Math.max(4, Math.ceil(primaryScore * 0.6)))
    .slice(0, 2)
    .map((item) => item.family);
  if (!activeFamilies.some((family) => family.id === primary.id)) {
    activeFamilies.unshift(primary);
  }

  const reportTargetTerms = [];
  for (const family of activeFamilies) {
    for (const term of family.required_terms || []) {
      if (containsTerm(reportText, term) || reportTargetTerms.length < 4) {
        if (!reportTargetTerms.includes(term)) reportTargetTerms.push(term);
      }
    }
  }

  return {
    roleFamily: primary.id,
    roleFamilyLabel: primary.label || primary.id,
    activeFamilies,
    targetTerms: reportTargetTerms,
    familyScore: scored[0]?.score || 0,
    scopePolicy: tailoring.scopePolicy,
  };
}

function buildScopeDecisionContext(model, analysis) {
  const evidenceCatalog = extractEvidenceCatalog(model);
  const termDecisions = [];
  for (const family of analysis.activeFamilies) {
    for (const term of family.required_terms || []) {
      if (termDecisions.some((decision) => decision.term === term)) continue;
      const termConfig = getTermConfig(term, family);
      termDecisions.push({
        term,
        roleFamily: family.id,
        satisfactionMode: termConfig.satisfactionMode,
        ...classifyTerm(term, family, evidenceCatalog, analysis.scopePolicy),
      });
    }
  }
  const counts = {
    direct: termDecisions.filter((item) => item.classification === 'direct').length,
    adjacent: termDecisions.filter((item) => item.classification === 'adjacent').length,
    out_of_scope: termDecisions.filter((item) => item.classification === 'out_of_scope').length,
  };
  return {
    evidenceCatalog,
    termDecisions,
    counts,
    blockedTerms: termDecisions.filter((item) => item.classification === 'out_of_scope').map((item) => item.term),
  };
}

function applyBulletRewrites(section, activeFamilies, scopeContext, changes, sectionChanges, rejectedRewrites, evidenceTrace, adjacentTermsUsed) {
  for (const entry of section.entries) {
    const bulletContainers = entry.groups
      ? entry.groups.map((group) => group.bullets)
      : (entry.bullets ? [entry.bullets] : []);

    for (const bullets of bulletContainers) {
      for (let index = 0; index < bullets.length; index += 1) {
        const current = bullets[index];
        const candidates = [];
        for (const family of activeFamilies) {
          for (const rewrite of family.rewrites || []) {
            const sectionId = rewrite.section_id || rewrite.sectionId;
            if (sectionId !== section.id) continue;
            if (current !== rewrite.match || current === rewrite.replace) continue;
            const requiredTerms = rewrite.required_support_terms || [];
            const termDecisions = requiredTerms.map((term) => scopeContext.termDecisions.find((decision) => decision.term === term)).filter(Boolean);
            const hasBlocked = termDecisions.some((decision) => decision.classification === 'out_of_scope');
            const hasAdjacent = termDecisions.some((decision) => decision.classification === 'adjacent');
            const allDirect = termDecisions.length === 0 || termDecisions.every((decision) => decision.classification === 'direct');
            let nextText = null;
            let variant = 'direct';

            if (!hasBlocked && allDirect) {
              nextText = rewrite.replace;
            } else if (!hasBlocked && hasAdjacent && rewrite.max_claim_level === 'adjacent_softened' && rewrite.softened_replace) {
              nextText = rewrite.softened_replace;
              variant = 'adjacent';
            }

            if (!nextText) {
              rejectedRewrites.push(`${family.id}:${section.id}:bullet${index + 1}`);
              continue;
            }

            const targetBonus = requiredTerms.filter((term) => scopeContext.termDecisions.some((decision) => decision.term === term)).length * 3;
            const directBonus = termDecisions.filter((decision) => decision.classification === 'direct').length * 3;
            const adjacentBonus = termDecisions.filter((decision) => decision.classification === 'adjacent').length * 2;
            const sectionTargetBonus = (family.rewrite_targets || []).includes(section.id) ? 2 : 0;
            candidates.push({
              family,
              rewrite,
              termDecisions,
              nextText,
              variant,
              score: targetBonus + directBonus + adjacentBonus + sectionTargetBonus,
            });
          }
        }
        const selected = candidates.sort((a, b) => b.score - a.score || a.family.id.localeCompare(b.family.id))[0];
        if (!selected) continue;
        bullets[index] = selected.nextText;
        changes.push(`${selected.family.id}: ${section.id} bullet ${index + 1}`);
        sectionChanges.add(section.id);
        if (selected.variant === 'adjacent') {
          for (const decision of selected.termDecisions.filter((item) => item.classification === 'adjacent')) {
            if (!adjacentTermsUsed.includes(decision.term)) adjacentTermsUsed.push(decision.term);
          }
        }
        for (const decision of selected.termDecisions) {
          for (const ref of decision.evidenceSources || []) {
            evidenceTrace.push(`${selected.family.id}:${section.id}:bullet${index + 1} <= ${decision.term} <= ${ref}`);
          }
        }
      }
    }
  }
}

function promoteSkills(model, activeFamilies, changes, sectionChanges, scopeContext) {
  const skills = model.source.sections.find((section) => section.id === 'technical_skills');
  if (!skills?.groups) return;
  for (const family of activeFamilies) {
    for (const [groupLabel, promotedItems] of Object.entries(family.skill_promotions || {})) {
      const group = skills.groups.find((candidate) => candidate.label === groupLabel);
      if (!group) continue;
      const before = group.items.join('|');
      const priority = promotedItems.filter((item) => group.items.includes(item));
      const rest = group.items.filter((item) => !priority.includes(item));
      group.items = [...priority, ...rest];
      const familyBlocked = (family.blocked_terms || []).some((term) => priority.some((item) => normalizeToken(item) === normalizeToken(term)));
      if (!familyBlocked && before !== group.items.join('|')) {
        changes.push(`${family.id}: promoted ${priority.join(', ')} in ${groupLabel}`);
        sectionChanges.add('technical_skills');
      }
    }
  }
}

function applyExpansionCandidates(model, analysis, scopeContext, changes, sectionChanges, pageFill, baseMarkdown, rules) {
  const actions = [];
  const fillRules = rules?.resume?.page_fill || {};
  const targetMin = Number(fillRules.target_min_score || 92);
  if (pageFill.score >= targetMin) {
    return actions;
  }
  for (const family of analysis.activeFamilies) {
    for (const candidate of family.expansion_candidates || []) {
      const requiredTerms = (candidate.required_support_terms || [])
        .map((term) => scopeContext.termDecisions.find((decision) => decision.term === term))
        .filter(Boolean);
      const blocked = requiredTerms.some((decision) => decision.classification === 'out_of_scope');
      if (blocked) continue;
      const nextText = requiredTerms.some((decision) => decision.classification === 'adjacent') && candidate.softened_expand
        ? candidate.softened_expand
        : candidate.expand;
      if (!nextText) continue;
      const section = model.source.sections.find((item) => item.id === candidate.section_id);
      if (!section?.entries) continue;
      let applied = false;
      for (const entry of section.entries) {
        const bulletContainers = entry.groups
          ? entry.groups.map((group) => group.bullets)
          : (entry.bullets ? [entry.bullets] : []);
        for (const bullets of bulletContainers) {
          const index = bullets.findIndex((bullet) => bullet === candidate.match);
          if (index === -1) continue;
          bullets[index] = nextText;
          changes.push(`${family.id}: expanded ${section.id} bullet ${index + 1}`);
          sectionChanges.add(section.id);
          actions.push(`${family.id}:${section.id}:bullet${index + 1}`);
          applied = true;
          break;
        }
        if (applied) break;
      }
      if (!applied) continue;
      const candidateMarkdown = renderMarkdown(model);
      const candidateFill = measurePageFill(candidateMarkdown, baseMarkdown, rules);
      if (candidateFill.score >= targetMin) {
        return actions;
      }
    }
  }
  return actions;
}

export function evaluateTailoring(analysis, scopeContext, markdown, changes, sectionChanges, rules) {
  const realized = [];
  const unrealizedDirect = [];
  const present = [];
  const missing = [];
  const termDecisions = scopeContext.termDecisions.map((decision) => {
    const family = getFamilyById(analysis, decision.roleFamily);
    const rendering = evaluateTermRendering(markdown, decision, family);
    const enriched = { ...decision, ...rendering };
    if (enriched.classification === 'adjacent' && enriched.rendered) realized.push(enriched.term);
    if (enriched.classification === 'direct' && !enriched.rendered) unrealizedDirect.push(enriched.term);
    if (analysis.targetTerms.includes(enriched.term)) {
      if (enriched.rendered) present.push(enriched.term);
      else missing.push(enriched.term);
    }
    return enriched;
  });

  const realizedDirect = termDecisions.filter((item) => item.classification === 'direct' && item.rendered).length;
  const realizedAdjacent = termDecisions.filter((item) => item.classification === 'adjacent' && item.rendered).length;
  const targetCount = Math.max(termDecisions.length, 1);
  const directScore = realizedDirect * 12;
  const adjacentScore = realizedAdjacent * 6;
  const changeScore = Math.min(20, changes.length * 4);
  const sectionScore = Math.min(15, sectionChanges.size * 5);
  const confidenceScore = Math.min(5, analysis.familyScore);
  let score = Math.min(100, 20 + directScore + adjacentScore + changeScore + sectionScore + confidenceScore);
  const tailoring = getTailoringRules(rules);
  let capReason = '';
  if (missing.length >= 5) {
    score = Math.min(score, tailoring.acceptableMin - 1);
    capReason = 'Too many high-signal JD terms still remain unsupported in the final resume.';
  } else if (missing.length >= 3) {
    score = Math.min(score, tailoring.strongMin - 1);
    capReason = 'Several JD terms still remain unsupported, so strong tailoring is not justified.';
  }
  if (scopeContext.counts.out_of_scope >= Number(tailoring.scopePolicy.max_out_of_scope_terms_before_force_weak || 3)) {
    score = Math.min(score, tailoring.acceptableMin - 1);
    capReason = 'Too many core JD terms are out of scope for truthful tailoring.';
  } else if (scopeContext.counts.adjacent > Number(tailoring.scopePolicy.max_adjacent_terms_before_cap_strong || 3)) {
    score = Math.min(score, tailoring.strongMin - 1);
    capReason = 'Role relies on too many adjacent-only claims to justify strong tailoring.';
  }
  const status = score >= tailoring.strongMin
    ? 'strong'
    : (score >= tailoring.acceptableMin ? 'acceptable' : 'weak');

  return {
    score,
    status,
    present,
    missing,
    capReason,
    termDecisions,
    realizedAdjacentTerms: [...new Set(realized)],
    unrealizedDirectTerms: [...new Set(unrealizedDirect)],
    fitRationale: present.length > missing.length
      ? 'Tailoring surfaced more supported role signals than unsupported ones.'
      : 'Tailoring remains constrained by unsupported high-signal JD requirements.',
  };
}

function measurePageFill(markdown, baseMarkdown, rules) {
  const fillRules = rules?.resume?.page_fill || {};
  const baselineLength = Math.max(String(baseMarkdown || '').length, 1);
  const score = Math.round((String(markdown || '').length / baselineLength) * 100);
  const targetMin = Number(fillRules.target_min_score || 92);
  const acceptableMin = Number(fillRules.acceptable_min_score || 88);
  const maxBeforeTight = Number(fillRules.max_score_before_tight || 104);
  let status = 'full';
  if (score > maxBeforeTight) status = 'tight';
  if (score < targetMin) status = score >= acceptableMin ? 'acceptable' : 'sparse';
  const notes = status === 'sparse'
    ? 'Content is materially shorter than the source resume; expand truthful role-relevant context before use.'
    : (status === 'tight' ? 'Content is close to the one-page ceiling; PDF page count remains authoritative.' : 'Content length is close to the source resume page-fill target.');
  return {
    score,
    status,
    notes,
    method: fillRules.method || 'markdown_length_vs_baseline',
  };
}

export function buildTailoredModel(baseModel, reportText) {
  const model = clone(baseModel);
  const changes = [];
  const sectionChanges = new Set();
  const analysis = analyzeReport(reportText, baseModel.rules);
  const scopeContext = buildScopeDecisionContext(model, analysis);
  const rejectedRewrites = [];
  const evidenceTrace = [];
  const adjacentTermsUsed = [];

  for (const section of model.source.sections) {
    if (section.kind === 'experience') {
      applyBulletRewrites(section, analysis.activeFamilies, scopeContext, changes, sectionChanges, rejectedRewrites, evidenceTrace, adjacentTermsUsed);
    }
  }
  promoteSkills(model, analysis.activeFamilies, changes, sectionChanges, scopeContext);

  return {
    model,
    changes,
    sectionChanges: [...sectionChanges],
    analysis,
    scopeContext,
    rejectedRewrites,
    evidenceTrace: [...new Set(evidenceTrace)],
    adjacentTermsUsed: [...new Set(adjacentTermsUsed)],
    activeFamilies: analysis.activeFamilies.map((family) => family.id),
  };
}

function loadProfile() {
  if (!existsSync(profilePath)) {
    return null;
  }
  return loadYaml(profilePath);
}

function applyProfileToHeader(model, profile) {
  if (!profile) return;

  const header = model.source.header;
  const candidate = profile.candidate || {};
  const location = profile.location || {};

  header.name = candidate.full_name || header.name;
  header.location = candidate.location || location.city || header.location;
  if (location.willing_to_relocate && !header.location.includes('Willing to relocate')) {
    header.location = `${header.location} (Willing to relocate)`;
  }
  header.phone = candidate.phone || header.phone;
  header.email = candidate.email || header.email;
  header.linkedin_display = candidate.linkedin || header.linkedin_display;
  const linkedinValue = candidate.linkedin || header.linkedin_url;
  header.linkedin_url = String(linkedinValue).startsWith('http')
    ? linkedinValue
    : `https://${linkedinValue}`;
}

function resolveCandidateSlug(profile, baseModel) {
  const name = profile?.candidate?.full_name || baseModel.source.header.name;
  return slugify(name);
}

function detectPaperFormat(report, fallbackFormat) {
  const text = report.text;
  if (/\b(United States|USA|U\.S\.|Queens, NY|Corona, NY|California|Texas|Michigan|Canada)\b/i.test(text)) {
    return 'letter';
  }
  if (/\b(New Zealand|Auckland|United Kingdom|London|Germany|France|Spain|Italy|Netherlands|India|Singapore|Australia)\b/i.test(text)) {
    return 'a4';
  }
  return fallbackFormat || 'letter';
}

function normalizeFormat(value) {
  const format = String(value || 'letter').toLowerCase();
  if (!['letter', 'a4'].includes(format)) {
    throw new Error(`Invalid resume format "${value}". Use letter or a4.`);
  }
  return format;
}

function normalizeJobSourceType(value) {
  const sourceType = String(value || 'jd_file');
  if (!['url', 'jd_file', 'manual'].includes(sourceType)) {
    throw new Error(`Invalid job source type "${value}". Use url, jd_file, or manual.`);
  }
  return sourceType;
}

function resolveIdentity(args, report, profile, baseModel) {
  const company = args.company || report.company;
  const role = args.role || report.role;
  if (!company || !role) {
    throw new Error('Could not resolve exact company and role identity from the report. Pass --company and --role explicitly.');
  }

  const artifactDate = args.date || report.date || currentDate();
  validateArtifactDate(artifactDate);
  return {
    candidate: resolveCandidateSlug(profile, baseModel),
    company,
    companySlug: slugify(company),
    role,
    roleSlug: slugify(role),
    artifactDate,
  };
}

function ensureOutputDir() {
  mkdirSync(outputDir, { recursive: true });
}

function cleanupTempArtifacts(paths) {
  for (const path of Object.values(paths)) {
    rmSync(path, { force: true });
  }
}

function publishArtifacts(tempPaths, finalPaths) {
  for (const finalPath of Object.values(finalPaths)) {
    rmSync(finalPath, { force: true });
  }
  for (const [key, tempPath] of Object.entries(tempPaths)) {
    renameSync(tempPath, finalPaths[key]);
  }
}

function getGeneratorVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function ensurePdfPageCount(pdfPath, maxPages) {
  const pythonScript = `
from pypdf import PdfReader
reader = PdfReader(r'''${pdfPath}''')
print(len(reader.pages))
`;
  const output = execFileSync('py', ['-c', pythonScript], { encoding: 'utf8' }).trim();
  const pages = Number(output);
  if (!Number.isFinite(pages) || pages < 1) {
    throw new Error(`Could not read page count for ${pdfPath}`);
  }
  if (pages > maxPages) {
    throw new Error(`Tailored resume exceeds max pages: ${pages} > ${maxPages}`);
  }
  return pages;
}

function toFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${String(item).replace(/"/g, '\\"')}"`).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `"${String(value ?? '').replace(/"/g, '\\"')}"`;
}

function writeMetaFile(metaPath, fields, changes) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${toFrontmatterValue(value)}`);
  }
  lines.push('---', '', '# Resume Artifact', '');
  lines.push(`Generated for ${fields.company} - ${fields.role}.`);
  if (changes.length > 0) {
    lines.push('', '## Applied Rewrites', '');
    for (const change of changes) {
      lines.push(`- ${change}`);
    }
  }
  writeFileSync(metaPath, `${lines.join('\n')}\n`);
}

export function buildBaselineResume() {
  const model = loadResumeModel();
  applyPresentationRules(model);
  const markdown = renderMarkdown(model);
  const html = renderHtml(model);
  const mdPath = resolve(projectRoot, model.rules.resume.generated_markdown);
  const htmlPath = resolve(projectRoot, model.rules.resume.generated_html);
  mkdirSync(dirname(mdPath), { recursive: true });
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(mdPath, markdown);
  writeFileSync(htmlPath, html);
  return { model, markdown, html, mdPath, htmlPath };
}

export function buildTailoredResume(args = {}) {
  if (!args.report) {
    throw new Error('Tailored resume generation requires --report <report.md>.');
  }

  const report = parseReport(args.report);
  const profile = loadProfile();
  const baseModel = loadResumeModel();
  applyPresentationRules(baseModel);
  const baseMarkdown = renderMarkdown(baseModel);
  const { model, changes, activeFamilies, analysis, sectionChanges, scopeContext, rejectedRewrites, evidenceTrace, adjacentTermsUsed } = buildTailoredModel(baseModel, report.text);
  applyProfileToHeader(model, profile);
  const sectionChangeSet = new Set(sectionChanges);

  const identity = resolveIdentity(args, report, profile, baseModel);
  const format = normalizeFormat(args.format || detectPaperFormat(report, model.rules.resume.format));
  const baseName = `cv-${identity.candidate}-${identity.companySlug}-${identity.roleSlug}-${identity.artifactDate}`;
  const markdownPath = resolve(outputDir, `${baseName}.md`);
  const htmlPath = resolve(outputDir, `${baseName}.html`);
  const pdfPath = resolve(outputDir, `${baseName}.pdf`);
  const metaPath = resolve(outputDir, `${baseName}.meta.md`);
  const tempBaseName = `${baseName}.tmp-${process.pid}-${Date.now()}`;
  const tempPaths = {
    markdown: resolve(outputDir, `${tempBaseName}.md`),
    html: resolve(outputDir, `${tempBaseName}.html`),
    pdf: resolve(outputDir, `${tempBaseName}.pdf`),
    meta: resolve(outputDir, `${tempBaseName}.meta.md`),
  };
  const finalPaths = {
    markdown: markdownPath,
    html: htmlPath,
    pdf: pdfPath,
    meta: metaPath,
  };

  ensureOutputDir();
  let markdown = renderMarkdown(model);
  let pageFill = measurePageFill(markdown, baseMarkdown, baseModel.rules);
  const pageFillActions = applyExpansionCandidates(model, analysis, scopeContext, changes, sectionChangeSet, pageFill, baseMarkdown, baseModel.rules);
  markdown = renderMarkdown(model);
  const html = renderHtml(model);
  const tailoringEvaluation = evaluateTailoring(analysis, scopeContext, markdown, changes, sectionChangeSet, baseModel.rules);
  pageFill = measurePageFill(markdown, baseMarkdown, baseModel.rules);
  let metaFields;
  try {
    writeFileSync(tempPaths.markdown, markdown);
    writeFileSync(tempPaths.html, html);

    const pdfResult = spawnSync(
      process.execPath,
      [resolve(projectRoot, 'generate-pdf.mjs'), tempPaths.html, tempPaths.pdf, `--format=${format}`],
      { cwd: projectRoot, stdio: 'inherit' }
    );
    if (pdfResult.status !== 0) {
      throw new Error(`PDF generation failed with exit code ${pdfResult.status ?? 1}`);
    }
    if (pdfResult.error) {
      throw pdfResult.error;
    }

    const pageCount = ensurePdfPageCount(tempPaths.pdf, model.rules.resume.max_pages || 1);
    const generatedAt = currentTimestamp();
    const jobSource = args.jobSource || report.url || report.absolutePath;
    const jobSourceType = normalizeJobSourceType(args.jobSourceType || (report.url ? 'url' : 'jd_file'));
    metaFields = {
      artifact_type: 'resume',
      candidate: identity.candidate,
      company: identity.company,
      company_slug: identity.companySlug,
      role: identity.role,
      role_slug: identity.roleSlug,
      artifact_date: identity.artifactDate,
      generated_at: generatedAt,
      source_baseline: relative(projectRoot, baselinePdfPath).replace(/\\/g, '/'),
      job_source: jobSource,
      job_source_type: jobSourceType,
      report_path: report.relativePath,
      report_id: report.reportId,
      jd_fingerprint: sha256(`${jobSource}\n${report.text}`),
      content_fingerprint: sha256(markdown),
      generator: 'build-resume.mjs',
      generator_version: getGeneratorVersion(),
      status: 'ready',
      page_count: pageCount,
      template_id: 'cv-template-watson',
      format,
      role_family: analysis.roleFamily,
      role_family_label: analysis.roleFamilyLabel,
      tailoring_score: tailoringEvaluation.score,
      tailoring_status: tailoringEvaluation.status,
      required_terms_present: tailoringEvaluation.present,
      required_terms_missing: tailoringEvaluation.missing,
      scope_policy: String(analysis.scopePolicy.strictness || 'balanced'),
      scope_summary: `direct=${scopeContext.counts.direct}; adjacent=${scopeContext.counts.adjacent}; out_of_scope=${scopeContext.counts.out_of_scope}`,
      scope_direct_count: scopeContext.counts.direct,
      scope_adjacent_count: scopeContext.counts.adjacent,
      scope_out_of_scope_count: scopeContext.counts.out_of_scope,
      blocked_terms: scopeContext.blockedTerms,
      adjacent_terms_used: adjacentTermsUsed,
      rejected_rewrites: rejectedRewrites,
      evidence_trace: evidenceTrace,
      tailoring_cap_reason: tailoringEvaluation.capReason,
      section_changes: [...sectionChangeSet],
      term_decisions: tailoringEvaluation.termDecisions.map((decision) => `${decision.term}|${decision.classification}|${decision.satisfactionMode}|${decision.rendered ? 'rendered' : 'missing'}${decision.blockedReason ? `|${decision.blockedReason}` : ''}${decision.matchedBy ? `|${decision.matchedBy}` : ''}`),
      realized_adjacent_terms: tailoringEvaluation.realizedAdjacentTerms,
      unrealized_direct_terms: tailoringEvaluation.unrealizedDirectTerms,
      page_fill_actions: pageFillActions,
      fit_rationale: tailoringEvaluation.fitRationale,
      page_fill_score: pageFill.score,
      page_fill_status: pageFill.status,
      page_fill_method: pageFill.method,
      page_fill_notes: pageFill.notes,
    };
    writeMetaFile(tempPaths.meta, metaFields, changes);
    publishArtifacts(tempPaths, finalPaths);
  } catch (error) {
    cleanupTempArtifacts(tempPaths);
    throw error;
  }

  return {
    report,
    identity,
    format,
    changes,
    activeFamilies,
    artifacts: {
      markdown: markdownPath,
      html: htmlPath,
      pdf: pdfPath,
      meta: metaPath,
    },
  };
}
