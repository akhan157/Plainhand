// @ts-check

import {
  ADAPTER_RESULT_STATUSES,
  PORTAL_FAMILIES,
  SAFE_ACTIONS,
  assertPortalAdapter,
  createAdapterResult,
  detectPortalFamily,
} from '../apply-adapter-contract.mjs';
import {
  continuePortalStep,
  currentUrl,
  fillPortalPage,
  inspectPortalPage,
  savePortalDraft,
} from '../adapters/_portal-utils.mjs';

/**
 * Generic controls are safe only for an explicitly configured custom portal.
 * Unknown and known-but-unsupported ATS families must not receive guessed
 * field mappings or guessed navigation.
 */
function isExplicitCustom(context = {}) {
  const family = typeof context === 'object' && context
    ? context.portalFamily || context.portal
    : null;
  return String(family || '').trim().toLowerCase() === PORTAL_FAMILIES.CUSTOM;
}

async function unsupported(context, action) {
  const portalFamily = detectPortalFamily(context);
  const url = await currentUrl(context);
  const familyLabel = portalFamily === PORTAL_FAMILIES.UNKNOWN
    ? 'unknown'
    : portalFamily;
  return createAdapterResult({
    status: ADAPTER_RESULT_STATUSES.UNSUPPORTED,
    action,
    portalFamily,
    url,
    blockers: [`No dedicated safe adapter is configured for ${familyLabel}; generic field mapping and navigation are disabled.`],
  });
}

async function guardedGeneric(context, action, operation) {
  if (!isExplicitCustom(context)) return unsupported(context, action);
  return operation();
}

/**
 * Last-resort adapter for an explicitly configured custom portal. It uses only
 * the shared safe controls: visible fields, approved values, draft-save
 * controls, and non-final next controls. Finalizing controls remain blockers
 * and are never clicked.
 */
const genericAdapterDefinition = {
  id: 'generic-portal',
  portalFamily: PORTAL_FAMILIES.UNKNOWN,

  matches() {
    return true;
  },

  async inspect(context = {}) {
    return guardedGeneric(
      context,
      SAFE_ACTIONS.INSPECT,
      () => inspectPortalPage(context, detectPortalFamily(context)),
    );
  },

  async fill(context = {}) {
    return guardedGeneric(
      context,
      SAFE_ACTIONS.FILL,
      () => fillPortalPage(context, detectPortalFamily(context)),
    );
  },

  async saveDraft(context = {}) {
    return guardedGeneric(
      context,
      SAFE_ACTIONS.SAVE_DRAFT,
      () => savePortalDraft(context, detectPortalFamily(context)),
    );
  },

  async continue(context = {}) {
    return guardedGeneric(
      context,
      SAFE_ACTIONS.CONTINUE,
      () => continuePortalStep(context, detectPortalFamily(context)),
    );
  },
};

export const genericAdapter = assertPortalAdapter(genericAdapterDefinition);
export default genericAdapter;

