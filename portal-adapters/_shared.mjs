/**
 * Shared DOM helpers for dedicated portal-family adapters.
 *
 * These helpers intentionally expose only pre-submit interactions. They do not
 * know about the generic application engine or any portal outside this folder.
 */
import {
  ADAPTER_RESULT_STATUSES,
  SAFE_ACTIONS,
  createAdapterResult,
} from '../apply-adapter-contract.mjs';

export const FINAL_CONTROL_RE = /\b(?:submit|apply|send|finish|complete|finali[sz]e|review\s*(?:and|&)\s*submit)\b/i;
export const AUTH_RE = /\b(?:sign\s*in|log\s*in|login|password|authenticate|authentication|one[- ]time\s+(?:passcode|password|code)|otp|captcha|recaptcha|verify\s+(?:you(?:'re| are)\s+)?human)\b/i;
export const SAVE_RE = /\b(?:save(?:\s+(?:draft|application|for later))?|save\s*(?:&|and)\s*(?:continue|close))\b/i;
export const CONTINUE_RE = /\b(?:continue|next(?:\s*:\s*[^\n]+)?|proceed|save\s*(?:&|and)\s*continue)\b/i;

const CONTROL_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[role="combobox"]',
  '[contenteditable="true"]',
].join(', ');
const ACTION_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="submit"]',
].join(', ');

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function textMatches(value, aliases) {
  const text = normalize(value);
  return aliases.some((alias) => {
    const candidate = normalize(alias);
    return candidate && (text === candidate || text.includes(candidate));
  });
}

export function contextUrl(context = {}) {
  if (typeof context.url === 'string' && context.url) return context.url;
  if (typeof context.roleUrl === 'string' && context.roleUrl) return context.roleUrl;
  return null;
}

export async function currentUrl(context = {}) {
  const explicit = contextUrl(context);
  if (explicit) return explicit;
  if (context.page && typeof context.page.url === 'function') {
    return context.page.url();
  }
  return null;
}

export async function visible(locator) {
  return locator.isVisible().catch(() => false);
}

export async function attr(locator, name) {
  return locator.getAttribute(name).catch(() => null);
}

export async function controlLabel(locator) {
  return locator.evaluate((element) => {
    const labels = [];
    if (element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicit) labels.push(explicit.innerText);
    }
    const parent = element.closest('label');
    if (parent) labels.push(parent.innerText);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) labels.push(node.innerText);
      }
    }
    for (const key of [
      'aria-label',
      'placeholder',
      'name',
      'data-automation-id',
      'data-testid',
    ]) {
      const value = element.getAttribute(key);
      if (value) labels.push(value);
    }
    const nearby = element.closest('[data-automation-id], fieldset, section, form');
    if (nearby && nearby !== element) labels.push((nearby.innerText || '').slice(0, 240));
    return labels.filter(Boolean).join(' | ');
  }).catch(() => '');
}

export async function actionLabel(locator) {
  const text = (await locator.innerText().catch(() => ''))
    || (await attr(locator, 'aria-label'))
    || (await attr(locator, 'value'))
    || (await attr(locator, 'data-automation-id'))
    || '';
  return String(text).trim();
}

export async function visibleControls(page, selector = CONTROL_SELECTOR) {
  const controls = [];
  const locator = page.locator(selector);
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await visible(item)) controls.push({ locator: item, index, label: await controlLabel(item) });
  }
  return controls;
}

export async function visibleActions(page) {
  const actions = [];
  const locator = page.locator(ACTION_SELECTOR);
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await visible(item)) actions.push({ locator: item, index, label: await actionLabel(item) });
  }
  return actions;
}

export function finalControlLabel(label, type = '') {
  return FINAL_CONTROL_RE.test(`${label} ${type}`) || normalize(type) === 'submit';
}

export async function finalControls(actions) {
  return findFinalControls(actions);
}

export async function findFinalControls(actions) {
  const result = [];
  for (const action of actions) {
    const type = await attr(action.locator, 'type');
    if (finalControlLabel(action.label, type || '')) result.push(action);
  }
  return result;
}

export async function pageText(page) {
  return page.locator('body').innerText().catch(() => '');
}

export async function safetyBlockers(page) {
  const body = await pageText(page);
  const blockers = [];
  if (AUTH_RE.test(body)) {
    blockers.push('Authentication, OTP, or CAPTCHA control detected; candidate must take over.');
  }
  const actions = await visibleActions(page);
  const finals = await findFinalControls(actions);
  if (finals.length) {
    blockers.push(`Final-submit control detected and intentionally untouched: ${finals.map(({ label }) => label || 'unnamed control').join(', ')}.`);
  }
  return { blockers, actions, finals };
}

export function unsupportedResult(family, url, message = 'URL is outside this adapter family.') {
  return createAdapterResult({
    status: ADAPTER_RESULT_STATUSES.UNSUPPORTED,
    action: SAFE_ACTIONS.INSPECT,
    portalFamily: family,
    url,
    blockers: [message],
  });
}

export function blockedResult(family, action, url, blockers, extra = {}) {
  return createAdapterResult({
    status: ADAPTER_RESULT_STATUSES.BLOCKED,
    action,
    portalFamily: family,
    url,
    blockers,
    ...extra,
  });
}

function flattenValues(value, prefix = '', output = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenValues(child, path, output);
    else output[path] = child;
  }
  return output;
}

export function valuesFrom(context = {}) {
  const values = context.values && typeof context.values === 'object' ? context.values : {};
  const profile = context.profile && typeof context.profile === 'object' ? context.profile : {};
  return flattenValues({ ...profile, ...values });
}

export function valueForAliases(context, aliases) {
  const values = valuesFrom(context);
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(values, alias) && values[alias] !== undefined) return values[alias];
  }
  const normalized = Object.entries(values).map(([key, value]) => [normalize(key), value]);
  for (const alias of aliases) {
    const key = normalize(alias);
    const found = normalized.find(([candidate]) => candidate === key || candidate.endsWith(` ${key}`));
    if (found && found[1] !== undefined) return found[1];
  }
  return undefined;
}

export async function uploadResume(candidates, resumePath) {
  if (!resumePath) return { blocker: 'No exact resume artifact was supplied.' };
  if (candidates.length !== 1) {
    return { blocker: candidates.length === 0
      ? 'No unambiguous resume upload control was found.'
      : 'Multiple resume upload controls were found; candidate review is required.' };
  }
  try {
    await candidates[0].locator.setInputFiles(resumePath);
  } catch {
    return { blocker: 'The exact resume artifact could not be uploaded.' };
  }
  return { uploaded: true, label: candidates[0].label || 'resume upload' };
}

export async function fillValue(locator, value) {
  const type = (await attr(locator, 'type')) || '';
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
  if (type === 'checkbox' || type === 'radio') {
    const yes = value === true || ['yes', 'true', '1'].includes(normalize(value));
    if (yes) await locator.check();
    else if (type === 'checkbox') await locator.uncheck();
    return;
  }
  if (tag === 'select') {
    const options = await locator.locator('option').allTextContents();
    const wanted = normalize(value);
    const option = options.find((candidate) => normalize(candidate) === wanted)
      || options.find((candidate) => normalize(candidate).includes(wanted));
    if (!option) throw new Error(`no select option matches ${value}`);
    await locator.selectOption({ label: option });
    return;
  }
  await locator.fill(String(value));
}

export function stepMarker(text) {
  const match = String(text || '').match(/\b(?:step|stage|page)\s*\d+(?:\s*(?:of|\/)\s*\d+)?\b/i);
  return match ? match[0] : null;
}

export function resultForFill(family, url, filledFields, missingFields, blockers, step) {
  if (blockers.length || missingFields.length) {
    return blockedResult(family, SAFE_ACTIONS.FILL, url, [
      ...blockers,
      ...missingFields.map((field) => `Required field has no approved value: ${field}.`),
    ], { filledFields, missingFields, step });
  }
  return createAdapterResult({
    status: ADAPTER_RESULT_STATUSES.FILLED,
    action: SAFE_ACTIONS.FILL,
    portalFamily: family,
    url,
    filledFields,
    step,
  });
}

export { ACTION_SELECTOR, CONTROL_SELECTOR };
