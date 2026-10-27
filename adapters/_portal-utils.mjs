// @ts-check

import { existsSync } from 'node:fs';
import {
  ADAPTER_RESULT_STATUSES,
  SAFE_ACTIONS,
  createAdapterResult,
} from '../apply-adapter-contract.mjs';

export const FINAL_CONTROL_RE = /\b(?:submit|apply|send|finish|complete|finali[sz]e)\b|\breview\s+(?:and|&)\s+submit\b/i;
export const RESUME_FIELD_RE = /(?:resume|curriculum\s+vitae|\bcv\b)/i;
export const RESUME_UPLOAD_SELECTORS = Object.freeze([
  'input[type="file"][name*="resume" i]',
  'input[type="file"][id*="resume" i]',
  'input[type="file"][name*="cv" i]',
  'input[type="file"][id*="cv" i]',
  'input[type="file"][aria-label*="resume" i]',
  'input[type="file"][aria-label*="cv" i]',
]);

const PROFILE_ALIASES = Object.freeze([
  [['full name', 'legal name', 'name'], ['candidate.full_name', 'candidate.name', 'full_name', 'name']],
  [['first name', 'given name', 'forename'], ['candidate.first_name', 'candidate.given_name', 'first_name']],
  [['last name', 'surname', 'family name'], ['candidate.last_name', 'candidate.surname', 'last_name']],
  [['email', 'email address', 'e mail'], ['candidate.email', 'contact.email', 'email']],
  [['phone', 'phone number', 'mobile', 'telephone'], ['candidate.phone', 'contact.phone', 'phone']],
  [['linkedin', 'linkedin url', 'linkedin profile'], ['candidate.linkedin', 'links.linkedin', 'linkedin']],
  [['github', 'github url', 'github profile'], ['candidate.github', 'links.github', 'github']],
  [['portfolio', 'portfolio url', 'website', 'personal website'], ['candidate.portfolio_url', 'links.portfolio', 'portfolio_url', 'website']],
  [['address', 'street address', 'address line 1'], ['address.line1', 'candidate.address', 'address']],
  [['address line 2', 'apt', 'suite', 'unit'], ['address.line2', 'address.unit']],
  [['city', 'town'], ['address.city', 'location.city', 'city']],
  [['state', 'province', 'region'], ['address.state', 'location.state', 'state']],
  [['zip', 'zip code', 'postal code', 'postcode'], ['address.zip', 'location.postal_code', 'zip', 'postal_code']],
  [['country', 'country of residence'], ['location.country', 'address.country', 'country']],
  [['timezone', 'time zone'], ['location.timezone', 'timezone']],
  [['minimum salary', 'salary minimum'], ['compensation.minimum', 'salary_minimum']],
  [['salary', 'salary expectation', 'desired salary', 'compensation'], ['compensation.target_range', 'compensation.salary', 'salary']],
  [['authorized to work', 'work authorization', 'legally authorized', 'eligible to work'], ['eeo.us_citizen', 'eeo.work_authorization', 'work_authorization']],
  [['sponsorship', 'require sponsorship', 'visa sponsorship'], ['eeo.sponsorship_required', 'sponsorship_required']],
  [['relocate', 'willing to relocate', 'relocation'], ['location.willing_to_relocate', 'willing_to_relocate']],
]);

const CONTINUE_RE = /^(?:continue|next(?:\s+step)?|continue\s+(?:application|to\b.*)|save\s+(?:and|&)\s+continue)$/i;
const SAVE_RE = /^(?:save(?:\s+(?:draft|application|progress))?|save\s+(?:and|&)\s+(?:continue|exit)|save\s+for\s+later|continue\s+later)$/i;

export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function flatten(value, prefix = '', output = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, output);
    else if (child !== undefined && child !== null && child !== '') output[path] = child;
  }
  return output;
}

function aliasesForControl(control) {
  return [control.label, control.name, control.id, control.placeholder, control.ariaLabel]
    .filter(Boolean)
    .map(normalize)
    .filter(Boolean);
}

function directValue(values, aliases) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined;
  const flat = flatten(values);
  for (const alias of aliases) {
    for (const [key, value] of Object.entries(flat)) {
      const normalizedKey = normalize(key);
      if (normalizedKey === alias || normalize(key.split('.').at(-1)) === alias) return value;
    }
  }
  return undefined;
}

export function valueForControl(control, context = {}) {
  const aliases = aliasesForControl(control);
  const sources = [context.values, context.fields, context.profile, context.candidate];
  for (const source of sources) {
    const direct = directValue(source, aliases);
    if (direct !== undefined) return direct;
  }

  const profile = context.profile || {};
  const flat = flatten(profile);
  for (const [names, keys] of PROFILE_ALIASES) {
    if (!names.some((name) => aliases.some((alias) => alias === normalize(name) || alias.includes(normalize(name))))) continue;
    for (const key of keys) if (flat[key] !== undefined) return flat[key];
  }

  const answers = context.answers;
  if (Array.isArray(answers)) {
    const answer = answers.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const answerLabel = normalize(entry.label || entry.question || entry.name || '');
      return answerLabel && aliases.some((alias) => alias.includes(answerLabel) || answerLabel.includes(alias));
    });
    if (answer) return answer.value ?? answer.text ?? answer.answer;
  } else {
    const directAnswer = directValue(answers, aliases);
    if (directAnswer !== undefined) return directAnswer;
  }
  return undefined;
}

export function currentUrl(context = {}) {
  if (context.page && typeof context.page.url === 'function') {
    try { return context.page.url(); } catch { /* use supplied URL */ }
  }
  return typeof context.url === 'string' ? context.url : null;
}

async function visible(locator) {
  return typeof locator?.isVisible === 'function' && await locator.isVisible().catch(() => false);
}

async function attribute(locator, name) {
  return typeof locator?.getAttribute === 'function' ? locator.getAttribute(name).catch(() => null) : null;
}

export async function controlLabel(locator) {
  if (!locator) return '';
  return locator.evaluate((element) => {
    const labels = [];
    if (element.id) {
      const explicit = [...document.querySelectorAll('label')].find((label) => label.htmlFor === element.id);
      if (explicit) labels.push(explicit.textContent || '');
    }
    const parent = element.closest('label');
    if (parent) labels.push(parent.textContent || '');
    const fieldset = element.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend) labels.push(legend.textContent || '');
    for (const attr of ['aria-label', 'placeholder', 'name', 'id', 'data-testid']) {
      const value = element.getAttribute(attr);
      if (value) labels.push(value);
    }
    return [...new Set(labels.map((value) => value.trim()).filter(Boolean))].join(' | ');
  }).catch(async () => (await attribute(locator, 'aria-label')) || (await attribute(locator, 'name')) || '');
}

export async function controlInfo(locator, index) {
  const type = (await attribute(locator, 'type')) || 'text';
  const [label, name, id, placeholder, ariaLabel, required, disabled] = await Promise.all([
    controlLabel(locator),
    attribute(locator, 'name'),
    attribute(locator, 'id'),
    attribute(locator, 'placeholder'),
    attribute(locator, 'aria-label'),
    attribute(locator, 'required'),
    attribute(locator, 'disabled'),
  ]);
  return {
    index,
    locator,
    type: type.toLowerCase(),
    label,
    name: name || '',
    id: id || '',
    placeholder: placeholder || '',
    ariaLabel: ariaLabel || '',
    required: required !== null,
    disabled: disabled !== null,
  };
}

export async function visibleControls(page) {
  const locator = page.locator('input, textarea, select');
  const controls = [];
  for (let index = 0; index < await locator.count(); index += 1) {
    const item = locator.nth(index);
    if (!(await visible(item))) continue;
    controls.push(await controlInfo(item, index));
  }
  return controls;
}

export function isFinalControl(label, type = '') {
  return FINAL_CONTROL_RE.test(`${label} ${type}`);
}

export function isResumeUpload(control) {
  return control.type === 'file' && RESUME_FIELD_RE.test(`${control.label} ${control.name} ${control.id} ${control.ariaLabel}`);
}

export function artifactPath(context = {}) {
  const artifacts = context.artifacts || {};
  const candidate = artifacts.resumePath || artifacts.resume || artifacts.cvPath || context.resumePath || context.resume;
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object' && typeof candidate.path === 'string') return candidate.path;
  return null;
}

async function buttonInfo(locator, index) {
  const [inner, textContent, ariaLabel, value, name, type] = await Promise.all([
    locator.innerText().catch(() => ''),
    locator.textContent().catch(() => ''),
    attribute(locator, 'aria-label'),
    attribute(locator, 'value'),
    attribute(locator, 'name'),
    attribute(locator, 'type'),
  ]);
  return {
    index,
    locator,
    label: String(inner || textContent || ariaLabel || value || name || '').trim(),
    ariaLabel: ariaLabel || '',
    type: (type || '').toLowerCase(),
  };
}

export async function visibleButtons(page) {
  const locator = page.locator('button, input[type="button"], input[type="submit"]');
  const buttons = [];
  for (let index = 0; index < await locator.count(); index += 1) {
    const item = locator.nth(index);
    if (!(await visible(item))) continue;
    buttons.push(await buttonInfo(item, index));
  }
  return buttons;
}

export function isSafeSaveControl(button) {
  return SAVE_RE.test(normalize(button.label || button.ariaLabel));
}

export function isSafeContinueControl(button) {
  const normalized = normalize(button.label || button.ariaLabel);
  return CONTINUE_RE.test(normalized) && !isFinalControl(normalized, button.type);
}

export async function finalControlBlockers(page) {
  const blockers = [];
  for (const button of await visibleButtons(page)) {
    if (isFinalControl(button.label || button.ariaLabel, button.type)) {
      blockers.push(`final submission control detected and intentionally untouched: ${button.label || `unnamed ${button.type || 'button'} control`}`);
    }
  }
  return blockers;
}

export async function stepMarker(page, url = null) {
  const selectors = '[aria-current="step"], [data-step], [data-step-number], [data-testid*="step" i], .step, .steps';
  try {
    const marker = page.locator(selectors).first();
    if (await visible(marker)) {
      const text = (await marker.innerText().catch(() => '')) || (await marker.getAttribute('aria-label').catch(() => null)) || (await marker.getAttribute('data-step').catch(() => null));
      if (text?.trim()) return text.trim();
    }
  } catch { /* marker is optional */ }
  try {
    const match = String(url || (typeof page.url === 'function' ? page.url() : '')).match(/[?&#/](?:step|page)[=_/-]?(\d+)/i);
    if (match) return `step ${match[1]}`;
  } catch { /* marker is optional */ }
  return null;
}

async function fillControl(control, value) {
  const { locator } = control;
  if (control.type === 'file') return false;
  if (control.type === 'checkbox' || control.type === 'radio') {
    const checked = value === true || ['true', 'yes', 'y', '1'].includes(normalize(value));
    if (checked && typeof locator.check === 'function') await locator.check();
    else if (!checked && control.type === 'checkbox' && typeof locator.uncheck === 'function') await locator.uncheck();
    return true;
  }
  if (control.type === 'select-one' || await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '') === 'select') {
    const options = await locator.locator('option').allTextContents();
    const normalizedValue = normalize(value);
    const option = options.find((candidate) => normalize(candidate) === normalizedValue)
      || options.find((candidate) => normalize(candidate).includes(normalizedValue));
    if (!option) return false;
    await locator.selectOption({ label: option });
    return true;
  }
  await locator.fill(String(value));
  return true;
}

export async function fillPortalPage(context, portalFamily) {
  const { page } = context;
  const blockers = await finalControlBlockers(page);
  const hardBlockers = [];
  const filledFields = [];
  const missingFields = [];
  for (const control of await visibleControls(page)) {
    const label = control.label || control.name || control.id || `unnamed ${control.type} field`;
    if (control.disabled) continue;
    if (isFinalControl(label, control.type)) continue;

    if (control.type === 'file') {
      if (!isResumeUpload(control)) {
        if (control.required) missingFields.push(label);
        continue;
      }
      const resumePath = artifactPath(context);
      if (!resumePath) {
        const blocker = `resume upload field found but no resolved resume artifact was supplied: ${label}`;
        blockers.push(blocker);
        hardBlockers.push(blocker);
      } else if (!existsSync(resumePath)) {
        const blocker = `resume artifact does not exist: ${resumePath}`;
        blockers.push(blocker);
        hardBlockers.push(blocker);
      } else if (typeof control.locator.setInputFiles !== 'function') {
        const blocker = `resume upload control cannot accept an artifact: ${label}`;
        blockers.push(blocker);
        hardBlockers.push(blocker);
      } else {
        await control.locator.setInputFiles(resumePath);
        filledFields.push(label);
      }
      continue;
    }

    const value = valueForControl(control, context);
    if (value === undefined) {
      if (control.required) {
        const blocker = `required field has no approved value: ${label}`;
        missingFields.push(label);
        blockers.push(blocker);
        hardBlockers.push(blocker);
      }
      continue;
    }
    if (await fillControl(control, value)) filledFields.push(label);
    else if (control.required) {
      const blocker = `approved value does not match an option: ${label}`;
      blockers.push(blocker);
      hardBlockers.push(blocker);
    }
  }

  const url = currentUrl(context);
  return createAdapterResult({
    status: hardBlockers.length ? ADAPTER_RESULT_STATUSES.BLOCKED : ADAPTER_RESULT_STATUSES.FILLED,
    action: SAFE_ACTIONS.FILL,
    portalFamily,
    url,
    step: await stepMarker(page, url),
    filledFields,
    missingFields,
    blockers,
    message: blockers.length ? 'Form values were filled where safe; candidate review is required.' : 'Approved fields filled; final submission remains candidate-only.',
  });
}

export async function inspectPortalPage(context, portalFamily) {
  const { page } = context;
  const controls = await visibleControls(page);
  const missingFields = controls
    .filter((control) => control.required && !control.disabled)
    .filter((control) => !isFinalControl(control.label, control.type))
    .map((control) => control.label || control.name || control.id || `unnamed ${control.type} field`);
  const blockers = await finalControlBlockers(page);
  const url = currentUrl(context);
  return createAdapterResult({
    status: ADAPTER_RESULT_STATUSES.READY,
    action: SAFE_ACTIONS.INSPECT,
    portalFamily,
    url,
    step: await stepMarker(page, url),
    missingFields,
    blockers,
    message: blockers.length ? 'Finalizing controls are present and were not clicked.' : 'Portal step inspected without finalizing actions.',
  });
}

export async function savePortalDraft(context, portalFamily) {
  const { page } = context;
  const finalBlockers = await finalControlBlockers(page);
  const candidates = (await visibleButtons(page)).filter(isSafeSaveControl);
  if (candidates.length === 0) {
    return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.BLOCKED, action: SAFE_ACTIONS.SAVE_DRAFT, portalFamily, url: currentUrl(context), step: await stepMarker(page), blockers: ['No unambiguous safe draft-save control was found.'], message: 'Values may remain unsaved; candidate review is required.' });
  }
  if (candidates.length > 1) {
    return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.BLOCKED, action: SAFE_ACTIONS.SAVE_DRAFT, portalFamily, url: currentUrl(context), step: await stepMarker(page), blockers: [`Multiple safe draft-save controls found: ${candidates.map((candidate) => candidate.label).join(', ')}`], message: 'Draft save was not attempted because the control was ambiguous.' });
  }
  await candidates[0].locator.click();
  const url = currentUrl(context);
  return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.SAVED_DRAFT, action: SAFE_ACTIONS.SAVE_DRAFT, portalFamily, url, resumableUrl: url, step: await stepMarker(page, url), saved: true, blockers: finalBlockers, message: `Draft saved using ${candidates[0].label}; final submission remains candidate-only.` });
}

export async function continuePortalStep(context, portalFamily) {
  const { page } = context;
  const blockers = await finalControlBlockers(page);
  if (blockers.length) {
    return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.BLOCKED, action: SAFE_ACTIONS.CONTINUE, portalFamily, url: currentUrl(context), step: await stepMarker(page), blockers, message: 'Continuation blocked because a finalizing control is present.' });
  }
  const candidates = (await visibleButtons(page)).filter(isSafeContinueControl);
  if (candidates.length === 0) {
    return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.BLOCKED, action: SAFE_ACTIONS.CONTINUE, portalFamily, url: currentUrl(context), step: await stepMarker(page), blockers: ['No safe multi-step continuation control was found.'], message: 'The candidate must review this step manually.' });
  }
  if (candidates.length > 1) {
    return createAdapterResult({ status: ADAPTER_RESULT_STATUSES.BLOCKED, action: SAFE_ACTIONS.CONTINUE, portalFamily, url: currentUrl(context), step: await stepMarker(page), blockers: [`Multiple continuation controls found: ${candidates.map((candidate) => candidate.label).join(', ')}`], message: 'Continuation was not attempted because the next control was ambiguous.' });
  }
  await candidates[0].locator.click();
  const url = currentUrl(context);
  const postClickBlockers = await finalControlBlockers(page);
  return createAdapterResult({ status: postClickBlockers.length ? ADAPTER_RESULT_STATUSES.BLOCKED : ADAPTER_RESULT_STATUSES.READY, action: SAFE_ACTIONS.CONTINUE, portalFamily, url, resumableUrl: url, step: await stepMarker(page, url), blockers: postClickBlockers, message: postClickBlockers.length ? 'Continuation reached a final review step; candidate owns the final click.' : `Continued using ${candidates[0].label}.` });
}

export { PROFILE_ALIASES };
