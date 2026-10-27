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

/** Lever-hosted application pages, including the EU host. */
const LEVER_HOST_RE = /^jobs(?:\.eu)?\.lever\.co$/i;

export function isLeverUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && LEVER_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

export const LEVER_RESUME_UPLOAD_SELECTORS = Object.freeze([
  'input[type="file"][name="resume"]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"][id*="resume" i]',
  'input[type="file"][name*="cv" i]',
  'input[type="file"][id*="cv" i]',
  'input[type="file"][aria-label*="resume" i]',
  'input[type="file"][aria-label*="cv" i]',
]);

export const LEVER_CONTINUATION_MARKERS = Object.freeze([
  'Continue',
  'Next',
  'Save & Continue',
  'Save and Continue',
]);

const leverAdapter = {
  id: 'lever',
  portalFamily: PORTAL_FAMILIES.LEVER,

  matches(context = {}) {
    const url = typeof context === 'string' ? context : context.url || context.roleUrl || context.page?.url?.();
    return isLeverUrl(url);
  },

  async inspect(context) {
    return inspectPortalPage(context, PORTAL_FAMILIES.LEVER);
  },

  async fill(context) {
    return fillPortalPage(context, PORTAL_FAMILIES.LEVER);
  },

  async saveDraft(context) {
    return savePortalDraft(context, PORTAL_FAMILIES.LEVER);
  },

  async continue(context) {
    return continuePortalStep(context, PORTAL_FAMILIES.LEVER);
  },
};

export default assertPortalAdapter(leverAdapter);
export { leverAdapter };
