// @ts-check

import {
  PORTAL_FAMILIES,
  assertPortalAdapter,
} from '../apply-adapter-contract.mjs';
import {
  continuePortalStep,
  fillPortalPage,
  inspectPortalPage,
  savePortalDraft,
} from './_portal-utils.mjs';

/** Greenhouse-hosted application and embedded job application hosts. */
const GREENHOUSE_HOST_RE = /^(?:boards|job-boards|job-boards\.eu)\.greenhouse\.io$/i;

export function isGreenhouseUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && GREENHOUSE_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

export const GREENHOUSE_RESUME_UPLOAD_SELECTORS = Object.freeze([
  'input[type="file"][name="resume"]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"][id*="resume" i]',
  'input[type="file"][name*="cv" i]',
  'input[type="file"][id*="cv" i]',
  'input[type="file"][aria-label*="resume" i]',
  'input[type="file"][aria-label*="cv" i]',
]);

export const GREENHOUSE_CONTINUATION_MARKERS = Object.freeze([
  'Continue',
  'Next',
  'Save & Continue',
  'Save and Continue',
]);

const greenhouseAdapter = {
  id: 'greenhouse',
  portalFamily: PORTAL_FAMILIES.GREENHOUSE,

  matches(context = {}) {
    const url = typeof context === 'string' ? context : context.url || context.roleUrl || context.page?.url?.();
    return isGreenhouseUrl(url);
  },

  async inspect(context) {
    return inspectPortalPage(context, PORTAL_FAMILIES.GREENHOUSE);
  },

  async fill(context) {
    return fillPortalPage(context, PORTAL_FAMILIES.GREENHOUSE);
  },

  async saveDraft(context) {
    return savePortalDraft(context, PORTAL_FAMILIES.GREENHOUSE);
  },

  async continue(context) {
    return continuePortalStep(context, PORTAL_FAMILIES.GREENHOUSE);
  },
};

export default assertPortalAdapter(greenhouseAdapter);
export { greenhouseAdapter };
