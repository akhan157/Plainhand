import { PORTAL_FAMILIES, detectPortalFamily } from '../apply-adapter-contract.mjs';
import greenhouseAdapter from '../adapters/greenhouse.mjs';
import leverAdapter from '../adapters/lever.mjs';
import ashbyAdapter from './ashby.mjs';
import genericAdapter from './generic.mjs';
import workdayAdapter from './workday.mjs';

/** Dedicated adapters run before the explicitly enabled custom fallback. */
export const PORTAL_ADAPTERS = Object.freeze([
  workdayAdapter,
  ashbyAdapter,
  greenhouseAdapter,
  leverAdapter,
  genericAdapter,
]);

/**
 * Resolve a dedicated adapter when one claims the page. The generic adapter is
 * returned for custom configuration and as a blocked fallback for other URLs.
 */
export function detectPortalAdapter(context = {}) {
  const explicit = typeof context === 'object' && context
    ? String(context.portalFamily || context.portal || '').trim().toLowerCase()
    : '';
  if (explicit === PORTAL_FAMILIES.CUSTOM) return genericAdapter;
  return PORTAL_ADAPTERS.find((candidate) => candidate !== genericAdapter && candidate.matches(context))
    || genericAdapter;
}

export function portalFamilyForAdapter(adapter, context = {}) {
  if (adapter === genericAdapter || adapter?.id === genericAdapter.id) return detectPortalFamily(context);
  return adapter?.portalFamily || PORTAL_FAMILIES.UNKNOWN;
}

export {
  ashbyAdapter,
  genericAdapter,
  greenhouseAdapter,
  leverAdapter,
  workdayAdapter,
};
export { detectPortalFamily };
export default PORTAL_ADAPTERS;
