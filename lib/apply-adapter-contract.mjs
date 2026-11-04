/**
 * Shared contract for safe, pre-submit browser adapters.
 *
 * This module contains system-layer types and guards only. Portal-specific
 * selectors and interaction behavior belong in dedicated adapter modules.
 */

/**
 * Supported ATS families. `custom` is an explicitly configured family and
 * `unknown` means that no safe adapter has claimed the URL.
 */
export const PORTAL_FAMILIES = Object.freeze({
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  WORKDAY: 'workday',
  ASHBY: 'ashby',
  SMARTRECRUITERS: 'smartrecruiters',
  ICIMS: 'icims',
  ORACLE_HCM: 'oracle_hcm',
  WORKABLE: 'workable',
  RECRUITEE: 'recruitee',
  CUSTOM: 'custom',
  UNKNOWN: 'unknown',
});

const PORTAL_FAMILY_VALUES = Object.freeze(Object.values(PORTAL_FAMILIES));

function contextValue(value, keys) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  if (value.page && typeof value.page.url === 'function') {
    try {
      const candidate = value.page.url();
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    } catch {
      // Fall back to the supplied context values.
    }
  }
  return '';
}

function parsePortalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Detect the ATS family from an explicit family or a portal URL.
 *
 * The detector is intentionally conservative: branded career domains remain
 * `unknown`, while known hosted ATS domains receive a stable family value.
 *
 * @param {string|object} [context]
 * @returns {string}
 */
export function detectPortalFamily(context = {}) {
  if (typeof context === 'object' && context) {
    const explicit = String(context.portalFamily || context.portal || '').trim().toLowerCase();
    if (PORTAL_FAMILY_VALUES.includes(explicit) && explicit !== PORTAL_FAMILIES.UNKNOWN) return explicit;
  }

  const value = contextValue(context, ['url', 'roleUrl', 'applicationUrl', 'resumeUrl']);
  const url = parsePortalUrl(value);
  if (!url) return PORTAL_FAMILIES.UNKNOWN;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === 'oraclecloud.com' || host.endsWith('.oraclecloud.com') || path.includes('/candidateexperience/')) {
    return PORTAL_FAMILIES.ORACLE_HCM;
  }
  if (host === 'myworkdayjobs.com' || host.endsWith('.myworkdayjobs.com')
    || host === 'workday.com' || host.endsWith('.workday.com')) {
    return PORTAL_FAMILIES.WORKDAY;
  }
  if (host === 'ashbyhq.com' || host.endsWith('.ashbyhq.com')) return PORTAL_FAMILIES.ASHBY;
  if (host === 'boards.greenhouse.io' || host === 'boards-api.greenhouse.io'
    || host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    return PORTAL_FAMILIES.GREENHOUSE;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return PORTAL_FAMILIES.LEVER;
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    return PORTAL_FAMILIES.SMARTRECRUITERS;
  }
  if (host === 'apply.workable.com') return PORTAL_FAMILIES.WORKABLE;
  if (host === 'icims.com' || host.endsWith('.icims.com')) return PORTAL_FAMILIES.ICIMS;
  if (host.endsWith('.recruitee.com')) return PORTAL_FAMILIES.RECRUITEE;
  return PORTAL_FAMILIES.UNKNOWN;
}

export const detectATSFamily = detectPortalFamily;
export const portalFamilyForUrl = detectPortalFamily;


/**
 * Actions an adapter may expose. `continue` is safe only while the adapter
 * proves that the next control is not a finalizing control.
 */
export const SAFE_ACTIONS = Object.freeze({
  OPEN: 'open',
  INSPECT: 'inspect',
  FILL: 'fill',
  UPLOAD_RESUME: 'upload_resume',
  SAVE_DRAFT: 'save_draft',
  CONTINUE: 'continue',
  PAUSE: 'pause',
  REPORT: 'report',
  HANDOFF: 'handoff',
});

const SAFE_ACTION_VALUES = Object.freeze(Object.values(SAFE_ACTIONS));

/**
 * Finalizing actions are deliberately not part of SAFE_ACTIONS. Keeping the
 * vocabulary here lets callers reject a button label before any click occurs.
 */
export const NO_SUBMIT_ACTIONS = Object.freeze([
  'submit',
  'apply',
  'send',
  'finish',
  'complete',
  'finalize',
  'finalise',
  'review_and_submit',
]);

/**
 * Machine-readable invariants for adapter implementations and reviewers.
 */
export const NO_SUBMIT_INVARIANTS = Object.freeze({
  NEVER_SUBMIT: 'Adapters never submit, apply, send, finish, or complete an application.',
  AMBIGUOUS_FINAL_CONTROL_BLOCKS: 'An ambiguous or potentially finalizing control is a hard blocker.',
  CANDIDATE_OWNS_FINAL_CLICK: 'The candidate performs any final submission action manually.',
  SAVE_BEFORE_PAUSE: 'Save a draft when the portal exposes a safe draft-save action before pausing.',
});

/**
 * Result statuses intentionally mirror the existing draft ledger while adding
 * explicit adapter outcomes. There is no submitted status by design.
 */
export const ADAPTER_RESULT_STATUSES = Object.freeze({
  READY: 'ready',
  FILLED: 'filled',
  SAVED_DRAFT: 'saved_draft',
  REVIEW_READY: 'review_ready',
  PAUSED: 'paused',
  BLOCKED: 'blocked',
  UNSUPPORTED: 'unsupported',
});

const ADAPTER_RESULT_STATUS_VALUES = Object.freeze(Object.values(ADAPTER_RESULT_STATUSES));
const BLOCKING_STATUSES = new Set([
  ADAPTER_RESULT_STATUSES.BLOCKED,
  ADAPTER_RESULT_STATUSES.UNSUPPORTED,
]);

/**
 * @typedef {object} AdapterContext
 * @property {unknown} page       Visible browser page or browser-harness handle.
 * @property {string} url         Current role/application URL.
 * @property {string} [roleUrl]   Canonical role URL, when different from url.
 * @property {object} [role]      Resolved company/role identity.
 * @property {object} [artifacts] Exact per-role artifacts already resolved.
 */

/**
 * @typedef {object} AdapterResult
 * @property {boolean} ok
 * @property {string} status
 * @property {string} action
 * @property {string} portalFamily
 * @property {string|null} url
 * @property {string|null} step
 * @property {string[]} filledFields
 * @property {string[]} missingFields
 * @property {boolean} saved
 * @property {string|null} resumableUrl
 * @property {string[]} blockers
 * @property {string|null} message
 */

/**
 * @typedef {object} PortalAdapter
 * @property {string} id                       Stable adapter identifier.
 * @property {string} portalFamily             One of PORTAL_FAMILIES values.
 * @property {(context: AdapterContext) => (boolean|Promise<boolean>)} matches
 * @property {(context: AdapterContext) => Promise<AdapterResult>} inspect
 * @property {(context: AdapterContext) => Promise<AdapterResult>} fill
 * @property {(context: AdapterContext) => Promise<AdapterResult>} saveDraft
 * @property {(context: AdapterContext) => Promise<AdapterResult>} [continue]
 */

function normalizeAction(action) {
  return String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Return true when an action is explicitly finalizing or submission-like.
 * @param {unknown} action
 */
export function isFinalizingAction(action) {
  const normalized = normalizeAction(action);
  return NO_SUBMIT_ACTIONS.includes(normalized);
}

/**
 * Return true only for actions permitted by the adapter contract.
 * @param {unknown} action
 */
export function isSafeAction(action) {
  const normalized = normalizeAction(action);
  return SAFE_ACTION_VALUES.includes(normalized) && !isFinalizingAction(normalized);
}

/**
 * Reject unsupported and finalizing actions before a browser interaction.
 * @param {unknown} action
 * @returns {string}
 */
export function assertSafeAction(action) {
  const normalized = normalizeAction(action);
  if (isFinalizingAction(normalized)) {
    throw new Error(`adapter action "${action}" is forbidden: final submission is candidate-only`);
  }
  if (!isSafeAction(normalized)) {
    throw new Error(`adapter action "${action}" is not in the safe adapter contract`);
  }
  return normalized;
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Build the stable result shape shared by the generic apply engine and portal
 * adapters. Results never contain a submitted/finalized outcome.
 *
 * @param {Partial<AdapterResult>} [input]
 * @returns {AdapterResult}
 */
export function createAdapterResult(input = {}) {
  const status = input.status || ADAPTER_RESULT_STATUSES.BLOCKED;
  if (!ADAPTER_RESULT_STATUS_VALUES.includes(status)) {
    throw new Error(`unknown adapter result status: ${status}`);
  }

  const action = assertSafeAction(input.action || SAFE_ACTIONS.INSPECT);
  const portalFamily = input.portalFamily || PORTAL_FAMILIES.UNKNOWN;
  if (!PORTAL_FAMILY_VALUES.includes(portalFamily)) {
    throw new Error(`unknown portal family: ${portalFamily}`);
  }

  const blockers = list(input.blockers);
  if (BLOCKING_STATUSES.has(status) && blockers.length === 0) {
    blockers.push(status === ADAPTER_RESULT_STATUSES.UNSUPPORTED
      ? 'No safe adapter supports this portal family.'
      : 'The adapter could not safely complete this action.');
  }

  return Object.freeze({
    ok: !BLOCKING_STATUSES.has(status),
    status,
    action,
    portalFamily,
    url: typeof input.url === 'string' ? input.url : null,
    step: typeof input.step === 'string' ? input.step : null,
    filledFields: list(input.filledFields),
    missingFields: list(input.missingFields),
    saved: Boolean(input.saved),
    resumableUrl: typeof input.resumableUrl === 'string' ? input.resumableUrl : null,
    blockers,
    message: typeof input.message === 'string' ? input.message : null,
  });
}

/**
 * Validate the structural part of a portal adapter without invoking it.
 * @param {PortalAdapter} adapter
 * @returns {PortalAdapter}
 */
export function assertPortalAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('portal adapter must be an object');
  }
  if (typeof adapter.id !== 'string' || !adapter.id.trim()) {
    throw new Error('portal adapter id must be a non-empty string');
  }
  if (!PORTAL_FAMILY_VALUES.includes(adapter.portalFamily)) {
    throw new Error(`portal adapter ${adapter.id} has an unknown portal family`);
  }
  for (const method of ['matches', 'inspect', 'fill', 'saveDraft']) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`portal adapter ${adapter.id} must implement ${method}()`);
    }
  }

  for (const forbidden of NO_SUBMIT_ACTIONS) {
    if (typeof adapter[forbidden] === 'function') {
      throw new Error(`portal adapter ${adapter.id} exposes forbidden action ${forbidden}()`);
    }
  }
  return adapter;
}

export default Object.freeze({
  PORTAL_FAMILIES,
  SAFE_ACTIONS,
  NO_SUBMIT_ACTIONS,
  NO_SUBMIT_INVARIANTS,
  ADAPTER_RESULT_STATUSES,
  detectPortalFamily,
  detectATSFamily,
  portalFamilyForUrl,
  isFinalizingAction,
  isSafeAction,
  assertSafeAction,
  createAdapterResult,
  assertPortalAdapter,
});
