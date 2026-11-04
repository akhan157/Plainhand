/**
 * Local-first requirement/evidence decision contract.
 *
 * The module only normalizes caller-supplied values. It never reads or writes
 * candidate files, calls a provider, or infers support from keyword overlap.
 */

export const RECOMMENDATIONS = Object.freeze(['apply', 'investigate', 'skip']);
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

const MIN_APPLY_SCORE = 4;
const MIN_APPLY_COVERAGE = 70;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function id(value, fallback) {
  return text(value) || fallback;
}

function normalizeConfidence(value) {
  if (typeof value === 'number') {
    if (value >= 0.8) return 'high';
    if (value >= 0.5) return 'medium';
    return 'low';
  }
  const normalized = text(value).toLowerCase();
  return CONFIDENCE_LEVELS.includes(normalized) ? normalized : 'low';
}

function confidenceRank(value) {
  return { low: 1, medium: 2, high: 3 }[value] || 1;
}

function normalizeRequirement(value, index) {
  const requirement = value && typeof value === 'object' ? value : {};
  const requirementId = id(requirement.id || requirement.key, `requirement-${index + 1}`);
  return {
    id: requirementId,
    text: text(requirement.text || requirement.requirement || requirement.label) || requirementId,
    priority: text(requirement.priority).toLowerCase() || (requirement.hardBlocker || requirement.required ? 'must' : 'preferred'),
    hardBlocker: requirement.hardBlocker === true || requirement.required === true || text(requirement.priority).toLowerCase() === 'must',
    weight: Number.isFinite(Number(requirement.weight)) && Number(requirement.weight) > 0 ? Number(requirement.weight) : 1,
  };
}

function evidenceRequirementIds(value) {
  const source = value?.requirementIds || value?.requirements || value?.requirementId;
  if (Array.isArray(source)) return source.map(text).filter(Boolean);
  const one = text(source);
  return one ? [one] : [];
}

function normalizeEvidence(value, index) {
  const evidence = value && typeof value === 'object' ? value : {};
  const evidenceId = id(evidence.id || evidence.key, `evidence-${index + 1}`);
  const source = evidence.source && typeof evidence.source === 'object'
    ? clone(evidence.source)
    : { ref: text(evidence.source || evidence.path || evidence.locator) };
  const sourceRef = text(source.ref || source.path || source.file || source.url || source.locator);
  const verified = evidence.verified === true || evidence.status === 'verified';
  return {
    id: evidenceId,
    claim: text(evidence.claim || evidence.text || evidence.description),
    source: { ...source, ref: sourceRef || null },
    requirementIds: evidenceRequirementIds(evidence),
    confidence: normalizeConfidence(evidence.confidence),
    verified,
    supports: evidence.supports !== false,
  };
}

function confidenceForEvidence(items) {
  if (!items.length) return 'low';
  const rank = Math.min(...items.map((item) => confidenceRank(item.confidence)));
  return rank === 3 ? 'high' : rank === 2 ? 'medium' : 'low';
}

/**
 * Map each requirement to explicit candidate evidence. Evidence is considered
 * supporting only when it names the requirement, has a source, is verified,
 * and has not explicitly been marked as non-supporting.
 */
export function mapRequirementsToEvidence(input = {}) {
  const rawRequirements = Array.isArray(input.requirements) ? input.requirements : [];
  const requirements = rawRequirements.map(normalizeRequirement);
  const inlineEvidence = rawRequirements.flatMap((requirement, index) => (
    Array.isArray(requirement?.evidence)
      ? requirement.evidence.map((item) => ({ ...item, requirementIds: [requirements[index].id] }))
      : []
  ));
  const evidence = [...(Array.isArray(input.evidence) ? input.evidence : []), ...inlineEvidence].map(normalizeEvidence);
  const known = new Set(requirements.map((requirement) => requirement.id));
  const mappedEvidence = evidence.map((item) => ({
    ...item,
    requirementIds: item.requirementIds.filter((requirementId) => known.has(requirementId)),
  }));
  return requirements.map((requirement) => {
    const allEvidence = mappedEvidence.filter((item) => item.requirementIds.includes(requirement.id));
    const supportingEvidence = allEvidence.filter((item) => item.supports && item.verified && item.source.ref);
    const unverifiedEvidence = allEvidence.filter((item) => item.supports && (!item.verified || !item.source.ref));
    return {
      ...requirement,
      evidence: clone(allEvidence),
      supportingEvidence: clone(supportingEvidence),
      unverifiedEvidence: clone(unverifiedEvidence),
      covered: supportingEvidence.length > 0,
      confidence: confidenceForEvidence(supportingEvidence),
      status: supportingEvidence.length ? 'supported' : unverifiedEvidence.length ? 'unverified' : 'uncovered',
    };
  });
}

/**
 * Build evidence coverage, confidence, gaps, and hard blockers without
 * changing the requirement or evidence arrays supplied by the caller.
 */
export function assessRequirementEvidence(input = {}) {
  const mappedRequirements = mapRequirementsToEvidence(input);
  const totalWeight = mappedRequirements.reduce((sum, item) => sum + item.weight, 0);
  const coveredWeight = mappedRequirements.filter((item) => item.covered).reduce((sum, item) => sum + item.weight, 0);
  const evidenceCoverage = totalWeight ? Math.round((coveredWeight / totalWeight) * 100) : 0;
  const covered = mappedRequirements.filter((item) => item.covered);
  const confidence = covered.length
    ? confidenceForEvidence(covered.flatMap((item) => item.supportingEvidence))
    : 'low';
  const unverifiedRequirements = mappedRequirements
    .filter((item) => !item.covered)
    .map((item) => ({ id: item.id, text: item.text, status: item.status, hardBlocker: item.hardBlocker }));
  const hardBlockers = mappedRequirements
    .filter((item) => item.hardBlocker && !item.covered)
    .map((item) => ({
      code: item.status === 'unverified' ? 'requirement_unverified' : 'requirement_uncovered',
      requirementId: item.id,
      message: `${item.text} lacks verified candidate evidence`,
      blocking: true,
    }));
  return {
    requirements: mappedRequirements,
    evidence: clone(Array.isArray(input.evidence) ? input.evidence : []),
    evidenceCoverage,
    evidenceCoverageRatio: evidenceCoverage / 100,
    confidence,
    unverifiedRequirements,
    hardBlockers,
    ok: hardBlockers.length === 0,
  };
}

export const evaluateEvidence = assessRequirementEvidence;
export const buildEvidenceAssessment = assessRequirementEvidence;

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : null;
}

/**
 * Recommend apply/investigate/skip. A caller may request an override, but a
 * reason is mandatory and hard blockers still require explicit acknowledgement.
 */
export function recommendApplication(input = {}) {
  const assessment = input.assessment || assessRequirementEvidence(input);
  const score = normalizeScore(input.score);
  const reasons = [];
  let recommendation = 'apply';
  if (assessment.hardBlockers.length) {
    recommendation = 'skip';
    reasons.push('one or more hard requirements lack verified evidence');
  } else if (score !== null && score < MIN_APPLY_SCORE) {
    recommendation = 'skip';
    reasons.push(`fit score ${score}/5 is below the ${MIN_APPLY_SCORE}/5 apply threshold`);
  } else if (assessment.evidenceCoverage < MIN_APPLY_COVERAGE || assessment.confidence === 'low' || assessment.unverifiedRequirements.length) {
    recommendation = 'investigate';
    reasons.push('evidence coverage or confidence is insufficient for an apply recommendation');
  } else {
    reasons.push('requirements have verified evidence with sufficient coverage and confidence');
  }
  const requested = text(input.override?.recommendation || input.overrideRecommendation).toLowerCase();
  const overrideReason = text(input.override?.reason || input.overrideReason);
  const overrideRequested = requested && RECOMMENDATIONS.includes(requested) && requested !== recommendation;
  const overrideRequirements = [];
  if (score !== null && score < MIN_APPLY_SCORE) overrideRequirements.push('candidate_score_override_reason');
  if (assessment.hardBlockers.length) overrideRequirements.push('candidate_hard_blocker_acknowledgement');
  if (overrideRequested && overrideReason === '') overrideRequirements.push('non_empty_override_reason');
  const overrideRequired = Boolean(overrideRequested || overrideRequirements.length);
  const overrideAccepted = Boolean(overrideRequested && overrideReason
    && (assessment.hardBlockers.length === 0 || input.override?.acknowledgeHardBlockers === true));
  if (overrideRequested) {
    if (overrideAccepted) {
      recommendation = requested;
      reasons.push(`explicit override: ${overrideReason}`);
    } else {
      reasons.push('requested override requires a non-empty reason and explicit hard-blocker acknowledgement');
    }
  }
  return {
    recommendation,
    reasons,
    score,
    confidence: assessment.confidence,
    evidenceCoverage: assessment.evidenceCoverage,
    unverifiedRequirements: clone(assessment.unverifiedRequirements),
    overrideRequirements,
    hardBlockers: clone(assessment.hardBlockers),
    overrideRequired,
    overrideAccepted,
    override: overrideAccepted ? { recommendation: requested, reason: overrideReason, acknowledgeHardBlockers: input.override?.acknowledgeHardBlockers === true } : null,
    allowed: recommendation !== 'apply' || (assessment.hardBlockers.length === 0 && (!overrideRequired || overrideAccepted)),
  };
}

export const evaluateRequirementEvidence = assessRequirementEvidence;
export const createEvidenceAssessment = assessRequirementEvidence;
export const makeApplicationRecommendation = recommendApplication;
export const decideApplication = recommendApplication;
