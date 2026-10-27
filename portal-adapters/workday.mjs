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

export const WORKDAY_URL_RE = /^(?:https?:\/\/)?(?:[^/]+\.)?(?:myworkdayjobs\.com|workday\.com)(?::\d+)?(?:\/|$)/i;

/** Labels used by Workday's native and data-automation-id controls. */
export const WORKDAY_FIELD_ALIASES = Object.freeze({
  fullName: ['full name', 'legal name', 'first and last name'],
  firstName: ['first name', 'given name', 'legalNameSection_firstName'],
  lastName: ['last name', 'family name', 'surname', 'legalNameSection_lastName'],
  email: ['email', 'email address', 'emailAddress'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
  addressLine1: ['address line 1', 'street address', 'addressSection_addressLine1'],
  city: ['city', 'town', 'addressSection_city'],
  state: ['state', 'province', 'region', 'addressSection_countryRegion'],
  postalCode: ['zip', 'zip code', 'postal code', 'addressSection_postalCode'],
  country: ['country', 'country region', 'addressSection_country'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  website: ['portfolio', 'personal website', 'website'],
  authorization: ['authorized to work', 'work authorization', 'legally authorized'],
});

/** Workday repeater aliases; values may be supplied as context.repeaters[key]. */
export const WORKDAY_REPEATER_ALIASES = Object.freeze({
  experience: Object.freeze({
    company: ['company', 'employer', 'work experience company', 'workExperience_company'],
    title: ['job title', 'title', 'position', 'work experience title', 'workExperience_jobTitle'],
    startDate: ['start date', 'from date', 'workExperience_startDate'],
    endDate: ['end date', 'to date', 'workExperience_endDate'],
    description: ['description', 'responsibilities', 'workExperience_description'],
  }),
  education: Object.freeze({
    school: ['school', 'university', 'institution', 'education_school'],
    degree: ['degree', 'education_degree'],
    field: ['field of study', 'major', 'education_fieldOfStudy'],
  }),
});

export const WORKDAY_RESUME_SELECTORS = Object.freeze([
  'input[type="file"][data-automation-id*="resume" i]',
  'input[type="file"][data-automation-id*="cv" i]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"][name*="cv" i]',
]);

function urlBelongsToWorkday(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const { hostname } = new URL(url.includes('://') ? url : `https://${url}`);
    const host = hostname.toLowerCase();
    return host === 'workday.com'
      || host.endsWith('.workday.com')
      || host === 'myworkdayjobs.com'
      || host.endsWith('.myworkdayjobs.com');
  } catch {
    return false;
  }
}

function aliasesFor(key) {
  return WORKDAY_FIELD_ALIASES[key] || [key];
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

function valuesForRepeater(context) {
  const repeaters = context.repeaters || context.repeaterValues || {};
  return Object.entries(repeaters).flatMap(([section, rows]) => (
    Array.isArray(rows) ? rows.map((row) => ({ section, row })) : []
  ));
}

async function repeaterFields(context, page, filled, missing, blockers) {
  for (const { section, row } of valuesForRepeater(context)) {
    const aliases = WORKDAY_REPEATER_ALIASES[section];
    if (!aliases || !row || typeof row !== 'object') {
      blockers.push(`Unsupported or ambiguous Workday repeater: ${section}.`);
      continue;
    }
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value === null || value === '') continue;
      const descriptor = aliases[key];
      if (!descriptor) {
        blockers.push(`Unmapped Workday repeater field requires review: ${section}.${key}.`);
        continue;
      }
      const match = await bestField(page, descriptor);
      if (match.ambiguous) {
        blockers.push(`Ambiguous Workday repeater control: ${section}.${key}.`);
      } else if (!match.field) {
        missing.push(`${section}.${key}`);
      } else {
        await fillValue(match.field.locator, value).catch(() => blockers.push(`Could not fill Workday repeater field: ${section}.${key}.`));
        filled.push(match.field.label || `${section}.${key}`);
      }
    }
  }
}

async function guarded(context, action, fn) {
  const url = await currentUrl(context);
  if (!urlBelongsToWorkday(url)) return unsupportedResult(PORTAL_FAMILIES.WORKDAY, url);
  const safety = await safetyBlockers(context.page);
  if (safety.blockers.length) return blockedResult(PORTAL_FAMILIES.WORKDAY, action, url, safety.blockers);
  return fn(url);
}

const workdayAdapterDefinition = {
  id: 'workday-portal',
  portalFamily: PORTAL_FAMILIES.WORKDAY,

  matches(context = {}) {
    return urlBelongsToWorkday(contextUrl(context));
  },

  async inspect(context = {}) {
    return guarded(context, SAFE_ACTIONS.INSPECT, async (url) => {
      const controls = await visibleControls(context.page);
      const missingFields = [];
      for (const key of ['fullName', 'email', 'phone']) {
        if (!(await bestField(context.page, aliasesFor(key))).field) missingFields.push(key);
      }
      const body = await context.page.locator('body').innerText().catch(() => '');
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.READY,
        action: SAFE_ACTIONS.INSPECT,
        portalFamily: PORTAL_FAMILIES.WORKDAY,
        url,
        step: stepMarker(body),
        missingFields,
        message: `${controls.length} visible Workday controls inspected.`,
      });
    });
  },

  async fill(context = {}) {
    return guarded(context, SAFE_ACTIONS.FILL, async (url) => {
      const filled = [];
      const missing = [];
      const blockers = [];
      const keys = Object.keys(WORKDAY_FIELD_ALIASES);
      for (const key of keys) {
        const value = valueForAliases(context, [key, ...aliasesFor(key)]);
        if (value === undefined || value === null || value === '') continue;
        const match = await bestField(context.page, aliasesFor(key));
        if (match.ambiguous) {
          blockers.push(`Ambiguous Workday field control: ${key}.`);
        } else if (!match.field) {
          missing.push(key);
        } else {
          await fillValue(match.field.locator, value).catch(() => blockers.push(`Could not fill Workday field: ${key}.`));
          filled.push(match.field.label || key);
        }
      }
      const resume = await fieldCandidates(context.page, ['resume', 'cv', 'curriculum vitae', ...WORKDAY_RESUME_SELECTORS]);
      const upload = await uploadResume(resume, resumePath(context));
      if (upload.blocker) blockers.push(upload.blocker);
      else if (upload.uploaded) filled.push(upload.label);
      await repeaterFields(context, context.page, filled, missing, blockers);
      const body = await context.page.locator('body').innerText().catch(() => '');
      return resultForFill(PORTAL_FAMILIES.WORKDAY, url, filled, missing, blockers, stepMarker(body));
    });
  },

  async saveDraft(context = {}) {
    return guarded(context, SAFE_ACTIONS.SAVE_DRAFT, async (url) => {
      const actions = await visibleActions(context.page);
      const candidates = actions.filter(({ label }) => SAVE_RE.test(label) && !finalControlLabel(label));
      if (candidates.length !== 1) {
        return blockedResult(PORTAL_FAMILIES.WORKDAY, SAFE_ACTIONS.SAVE_DRAFT, url, [
          candidates.length === 0
            ? 'No safe Workday draft-save control was found.'
            : 'Ambiguous Workday draft-save controls; candidate review is required.',
        ]);
      }
      await candidates[0].locator.click();
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.SAVED_DRAFT,
        action: SAFE_ACTIONS.SAVE_DRAFT,
        portalFamily: PORTAL_FAMILIES.WORKDAY,
        url,
        saved: true,
        step: stepMarker(await context.page.locator('body').innerText().catch(() => '')),
        message: `Clicked safe Workday draft-save control: ${candidates[0].label}.`,
      });
    });
  },

  async continue(context = {}) {
    return guarded(context, SAFE_ACTIONS.CONTINUE, async (url) => {
      const actions = await visibleActions(context.page);
      const finals = await findFinalControls(actions);
      const candidates = actions.filter(({ label }) => CONTINUE_RE.test(label) && !finalControlLabel(label));
      if (finals.length || candidates.length !== 1) {
        return blockedResult(PORTAL_FAMILIES.WORKDAY, SAFE_ACTIONS.CONTINUE, url, [
          ...(finals.length ? ['Final-submit control remains present; continuation is blocked.'] : []),
          ...(candidates.length === 0 ? ['No unambiguous Workday continuation marker was found.'] : []),
          ...(candidates.length > 1 ? ['Multiple Workday continuation markers were found.'] : []),
        ]);
      }
      await candidates[0].locator.click();
      return createAdapterResult({
        status: ADAPTER_RESULT_STATUSES.REVIEW_READY,
        action: SAFE_ACTIONS.CONTINUE,
        portalFamily: PORTAL_FAMILIES.WORKDAY,
        url,
        step: stepMarker(await context.page.locator('body').innerText().catch(() => '')) || candidates[0].label,
        message: `Clicked safe Workday continuation marker: ${candidates[0].label}.`,
      });
    });
  },
};

export const workdayAdapter = assertPortalAdapter(workdayAdapterDefinition);
export { urlBelongsToWorkday };
export default workdayAdapter;
