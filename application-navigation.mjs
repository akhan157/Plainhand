/**
 * Safe browser navigation for multi-step application forms.
 *
 * Only an unambiguous, explicitly non-final Continue/Next control may be
 * clicked. Review, finalizing, authentication, and ambiguous states are
 * returned as handoffs; this module never guesses.
 */

import { assertSafeAction } from './workflow-contract.mjs';
export const FINAL_CONTROL_RE = /\b(submit|apply|send|finish|complete|finali[sz]e|review\s*(?:and|&)\s*submit)\b/i;

export const CONTINUE_CONTROL_RE = /^(?:continue|next|continue\s+(?:to|with)\s+(?:application|application\s+form|next\s+step)|continue\s+to\s+next\s+step|next\s+step|save\s*(?:&|and)\s*continue)$/i;
export const REVIEW_CONTROL_RE = /\b(review|preview|check\s+(?:your\s+)?application|view\s+(?:your\s+)?application)\b/i;
export const AUTH_HANDOFF_RE = /\b(?:sign\s*in|log\s*in|login|authenticate|one[-\s]?time\s+(?:password|passcode)|otp|multi[-\s]?factor|two[-\s]?factor|verification\s+code|captcha)\b/i;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}


export function isFinalizingControl(label, type = '') {
  return FINAL_CONTROL_RE.test(`${text(label)} ${text(type)}`);
}
export function normalizeControlLabel(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^\da-z&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function isReviewControl(label) {
  return REVIEW_CONTROL_RE.test(text(label));
}

export function isNonFinalContinue(label, type = '') {
  const normalized = normalizeControlLabel(label);
  return Boolean(normalized) && CONTINUE_CONTROL_RE.test(normalized)
    && !isFinalizingControl(normalized, type)
    && !isReviewControl(normalized);
}

export function classifyNavigationControl({ label = '', type = '', disabled = false } = {}) {
  const normalized = text(label);
  if (isFinalizingControl(normalized, type)) return 'final';
  if (isReviewControl(normalized)) return 'review';
  if (isNonFinalContinue(normalized, type)) return disabled ? 'disabled_continue' : 'continue';
  return 'other';
}

async function readControl(page, locator, index) {
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return null;
  const label = text([
    await locator.innerText().catch(() => ''),
    await locator.getAttribute('aria-label'),
    await locator.getAttribute('title'),
    await locator.getAttribute('value'),
  ].filter(Boolean).join(' '));
  const type = text(await locator.getAttribute('type'));
  const disabled = await locator.isDisabled().catch(() => false);
  return {
    index,
    label,
    type,
    disabled,
    classification: classifyNavigationControl({ label, type, disabled }),
  };
}

async function visiblePageText(page) {
  return text(await page.locator('body').innerText().catch(() => ''));
}

/**
 * Snapshot the current page without clicking anything.
 * `manualAuthentication` is intentionally a handoff signal: credentials,
 * OTPs, CAPTCHA, and similar controls remain candidate-owned.
 */
export async function inspectNavigation(page) {
  const locator = page.locator('button, input[type="button"], input[type="submit"], a, [role="button"]');
  const controls = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const control = await readControl(page, locator.nth(index), index);
    if (control) controls.push(control);
  }

  const body = await visiblePageText(page);
  const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
  const authText = AUTH_HANDOFF_RE.test(body) && /\b(?:sign\s*in|log\s*in|login|otp|passcode|captcha|verification\s+code)\b/i.test(body);
  const manualAuthentication = passwordCount > 0 || authText;
  const finalControls = controls.filter(({ classification }) => classification === 'final');
  const reviewControls = controls.filter(({ classification }) => classification === 'review');
  const continueControls = controls.filter(({ classification }) => classification === 'continue');
  const disabledContinueControls = controls.filter(({ classification }) => classification === 'disabled_continue');

  return {
    controls,
    finalControls,
    reviewControls,
    continueControls,
    disabledContinueControls,
    manualAuthentication,
    bodyText: body,
    status: manualAuthentication
      ? 'manual_authentication'
      : (finalControls.length || reviewControls.length) ? 'review_required'
        : continueControls.length === 1 ? 'continuation_available'
          : continueControls.length > 1 ? 'ambiguous'
            : 'checkpoint',
  };
}

/**
 * Advance exactly one application step, or return a non-clicking handoff.
 * A dry run still performs all ambiguity/finalization checks.
 */
export async function advanceApplicationPage(page, { dryRun = false } = {}) {
  const snapshot = await inspectNavigation(page);
  if (snapshot.manualAuthentication) {
    return {
      status: 'manual_authentication',
      action: 'handoff_authentication',
      reason: 'authentication or verification must be completed manually',
      controls: snapshot.controls,
    };
  }
  if (snapshot.finalControls.length || snapshot.reviewControls.length) {
    return {
      status: 'review_required',
      action: 'handoff_review',
      reason: 'review/finalizing control detected; navigation stops before candidate submission',
      controls: [...snapshot.finalControls, ...snapshot.reviewControls],
    };
  }
  if (snapshot.continueControls.length > 1) {
    return {
      status: 'ambiguous',
      action: 'handoff_review',
      reason: 'multiple non-final Continue/Next controls are visible',
      controls: snapshot.continueControls,
    };
  }
  if (snapshot.continueControls.length === 0) {
    return {
      status: snapshot.disabledContinueControls.length ? 'blocked' : 'checkpoint',
      action: 'handoff_review',
      reason: snapshot.disabledContinueControls.length
        ? 'the only continuation control is disabled'
        : 'no unambiguous non-final Continue/Next control is available',
      controls: snapshot.disabledContinueControls,
    };
  }

  assertSafeAction('continue_non_final');
  const candidate = snapshot.continueControls[0];
  if (dryRun) return { status: 'planned', action: 'continue_non_final', control: candidate };
  const controls = page.locator('button, input[type="button"], input[type="submit"], a, [role="button"]');
  const liveControl = controls.nth(candidate.index);
  await liveControl.click();
  return { status: 'clicked', action: 'continue_non_final', control: candidate };
}

export const navigateApplicationPage = advanceApplicationPage;
