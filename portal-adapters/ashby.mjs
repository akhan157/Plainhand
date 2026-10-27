// @ts-check
import {
  ADAPTER_RESULT_STATUSES,
  PORTAL_FAMILIES,
  SAFE_ACTIONS,
  assertPortalAdapter,
  createAdapterResult,
} from '../apply-adapter-contract.mjs';
import {
  CONTINUE_RE,
  SAVE_RE,
  blockedResult,
  contextUrl,
  currentUrl,
  findFinalControls,
  fillValue,
  finalControlLabel,
  normalize,
  resultForFill,
  safetyBlockers,
  stepMarker,
  unsupportedResult,
  uploadResume,
  valueForAliases,
  visibleActions,
  visibleControls,
} from './_shared.mjs';

export const ASHBY_URL_RE = /^(?:https?:\/\/)?(?:jobs\.)?(?:[a-z0-9-]+\.)?ashbyhq\.com(?::\d+)?(?:\/|$)/i;

export const ASHBY_FIELD_ALIASES = Object.freeze({
  fullName: ['full name', 'legal name', 'first and last name'],
  firstName: ['first name', 'given name'],
  lastName: ['last name', 'family name', 'surname'],
  email: ['email', 'email address'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
  addressLine1: ['address', 'address line 1', 'street address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  postalCode: ['zip', 'zip code', 'postal code'],
  country: ['country', 'country of residence'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  github: ['github', 'github url', 'github profile'],
  website: ['portfolio', 'personal website', 'website'],
  authorization: ['authorized to work', 'work authorization', 'legally authorized'],
  sponsorship: ['sponsorship', 'require sponsorship', 'visa sponsorship'],
});

export const ASHBY_REPEATER_ALIASES = Object.freeze({
  experience: Object.freeze({
    company: ['company', 'employer', 'organization'],
    title: ['job title', 'title', 'position'],
    startDate: ['start date', 'from date'],
    endDate: ['end date', 'to date'],
    description: ['description', 'responsibilities'],
  }),
  education: Object.freeze({
    school: ['school', 'university', 'institution'],
    degree: ['degree'],
    field: ['field of study', 'major'],
  }),
});

export const ASHBY_RESUME_SELECTORS = Object.freeze([
  'input[type="file"][name*="resume" i]',
  'input[type="file"][name*="cv" i]',
  'input[type="file"][data-testid*="resume" i]',
  'input[type="file"][aria-label*="resume" i]',
]);

function urlBelongsToAshby(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const { hostname } = new URL(url.includes('://') ? url : `https://${url}`);
    const host = hostname.toLowerCase();
    return host === 'ashbyhq.com' || host.endsWith('.ashbyhq.com');
  } catch {
    return false;
  }
}

function aliasesFor(key) {
  return ASHBY_FIELD_ALIASES[key] || [key];
}

async function fieldCandidates(page, aliases) {
  const controls = await visibleControls(page);
  return controls.filter(({ label }) => aliases.some((alias) => {
    const text = normalize(label);
    const target = normalize(alias);
    return target && (text === target || text.includes(target));
  }));
}

async function bestField(page, aliases) {
  const candidates = await fieldCandidates(page, aliases);
  if (!candidates.length) return { field: null, ambiguous: false };
  const scored = candidates.map((candidate) => {
    const text = normalize(candidate.label);
    const score = aliases.reduce((best, alias) => {
      const target = normalize(alias);
      return Math.max(best, text === target ? 3 : text.includes(target) ? 1 : 0);
    }, 0);
    return { ...candidate, score };
  }).sort((a, b) => b.score - a.score);
  return {
    field: scored[0],
    ambiguous: scored.length > 1 && scored[0].score === scored[1].score,
  };
}

function resumePath(context) {
  return context.resumePath
    || context.artifacts?.resumePath
    || context.artifacts?.resume?.path
    || null;
}

async function repeaterFields(context, page, filled, missing, blockers) {
  const repeaters = context.repeaters || context.repeaterValues || {};
  for (const [section, rows] of Object.entries(repeaters)) {
    const aliases = ASHBY_REPEATER_ALIASES[section];
    if (!aliases || !Array.isArray(rows)) {
      blockers.push(`Unsupported or ambiguous Ashby repeater: ${section}.`);
      continue;
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        blockers.push(`Invalid Ashby repeater row: ${section}.`);
        continue;
      }
      for (const [key, value] of Object.entries(row)) {
        if (value === undefined || value === null || value === '') continue;
        const descriptor = aliases[key];
        if (!descriptor) {
          blockers.push(`Unmapped Ashby repeater field requires review: ${section}.${key}.`);
          continue;
        }
        const match = await bestField(page, descriptor);
        if (match.ambiguous) blockers.push(`Ambiguous Ashby repeater control: ${section}.${key}.`);
        else if (!match.field) missing.push(`${section}.${key}`);
        else {
          await fillValue(match.field.locator, value).catch(() => blockers.push(`Could not fill Ashby repeater field: ${section}.${key}.`));
          filled.push(match.field.label || `${section}.${key}`);
        }
      }
    }
  }
}

async function guarded(context, action, fn) {
  const url = await currentUrl(context);
  if (!urlBelongsToAshby(url)) return unsupportedResult(PORTAL_FAMILIES.ASHBY, url);
  const safety = await safetyBlockers(context.page);
  if (safety.blockers.length) return blockedResult(PORTAL_FAMILIES.ASHBY, action, url, safety.blockers);
  return fn(url);
}

const ashbyAdapterDefinition = {
  id: 'ashby-portal',
  portalFamily: PORTAL_FAMILIES.ASHBY,

  matches(context = {}) {
    return urlBelongsToAshby(contextUrl(context));
  },

  async inspect(context = {}) {
    return guarded(context, SAFE_ACTIONS.INSPECT, async (url) => {
      const controls = await visibleControls(context.page);
      const body = await context.page.locator('body').innerText().catch(() => '');
      const missingFields = [];
      for (const key of ['fullName', 'email']) {
        if (!(await bestField(context.page, aliasesFor(key))).field) missingFields.push(key);
      }
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.READY,
        action: SAFE_ACTIONS.INSPECT,
        portalFamily: PORTAL_FAMILIES.ASHBY,
        url,
        step: stepMarker(body),
        missingFields,
        message: `${controls.length} visible Ashby controls inspected.`,
      });
    });
  },

  async fill(context = {}) {
    return guarded(context, SAFE_ACTIONS.FILL, async (url) => {
      const filled = [];
      const missing = [];
      const blockers = [];
      for (const key of Object.keys(ASHBY_FIELD_ALIASES)) {
        const value = valueForAliases(context, [key, ...aliasesFor(key)]);
        if (value === undefined || value === null || value === '') continue;
        const match = await bestField(context.page, aliasesFor(key));
        if (match.ambiguous) blockers.push(`Ambiguous Ashby field control: ${key}.`);
        else if (!match.field) missing.push(key);
        else {
          await fillValue(match.field.locator, value).catch(() => blockers.push(`Could not fill Ashby field: ${key}.`));
          filled.push(match.field.label || key);
        }
      }
      const resume = await fieldCandidates(context.page, ['resume', 'cv', 'curriculum vitae', ...ASHBY_RESUME_SELECTORS]);
      const upload = await uploadResume(resume, resumePath(context));
      if (upload.blocker) blockers.push(upload.blocker);
      else if (upload.uploaded) filled.push(upload.label);
      await repeaterFields(context, context.page, filled, missing, blockers);
      const body = await context.page.locator('body').innerText().catch(() => '');
      return resultForFill(PORTAL_FAMILIES.ASHBY, url, filled, missing, blockers, stepMarker(body));
    });
  },

  async saveDraft(context = {}) {
    return guarded(context, SAFE_ACTIONS.SAVE_DRAFT, async (url) => {
      const actions = await visibleActions(context.page);
      const candidates = actions.filter(({ label }) => SAVE_RE.test(label) && !finalControlLabel(label));
      if (candidates.length !== 1) {
        return blockedResult(PORTAL_FAMILIES.ASHBY, SAFE_ACTIONS.SAVE_DRAFT, url, [
          candidates.length === 0
            ? 'No safe Ashby draft-save control was found.'
            : 'Ambiguous Ashby draft-save controls; candidate review is required.',
        ]);
      }
      await candidates[0].locator.click();
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.SAVED_DRAFT,
        action: SAFE_ACTIONS.SAVE_DRAFT,
        portalFamily: PORTAL_FAMILIES.ASHBY,
        url,
        saved: true,
        step: stepMarker(await context.page.locator('body').innerText().catch(() => '')),
        message: `Clicked safe Ashby draft-save control: ${candidates[0].label}.`,
      });
    });
  },

  async continue(context = {}) {
    return guarded(context, SAFE_ACTIONS.CONTINUE, async (url) => {
      const actions = await visibleActions(context.page);
      const finals = await findFinalControls(actions);
      const candidates = actions.filter(({ label }) => CONTINUE_RE.test(label) && !finalControlLabel(label));
      if (finals.length || candidates.length !== 1) {
        return blockedResult(PORTAL_FAMILIES.ASHBY, SAFE_ACTIONS.CONTINUE, url, [
          ...(finals.length ? ['Final-submit control remains present; continuation is blocked.'] : []),
          ...(candidates.length === 0 ? ['No unambiguous Ashby continuation marker was found.'] : []),
          ...(candidates.length > 1 ? ['Multiple Ashby continuation markers were found.'] : []),
        ]);
      }
      await candidates[0].locator.click();
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.REVIEW_READY,
        action: SAFE_ACTIONS.CONTINUE,
        portalFamily: PORTAL_FAMILIES.ASHBY,
        url,
        step: stepMarker(await context.page.locator('body').innerText().catch(() => '')) || candidates[0].label,
        message: `Clicked safe Ashby continuation marker: ${candidates[0].label}.`,
      });
    });
  },
};

export const ashbyAdapter = assertPortalAdapter(ashbyAdapterDefinition);
export { urlBelongsToAshby };
export default ashbyAdapter;
