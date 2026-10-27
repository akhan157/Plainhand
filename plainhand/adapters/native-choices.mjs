// Native radio groups. Deliberately narrow: no legal, demographic, sponsorship or
// compensation choice is ever selected automatically.
import { isSensitiveLabel } from '../field-policy.mjs';

export async function nativeChoices(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('input[type=radio]')], groups = new Map();
    for (const [index, node] of nodes.entries()) {
      if (!node.name || !node.checkVisibility() || node.disabled) continue;
      const section = node.closest('fieldset,[role=radiogroup]');
      const label = section?.getAttribute('aria-label') || section?.querySelector('legend')?.textContent?.trim() || node.name;
      const field = groups.get(node.name) || { key: 'native-radio:' + node.name, name: node.name, type: 'radio', label, required: false, options: [], sectionContext: null };
      field.required ||= node.required;
      const optionLabel = node.labels?.[0]?.textContent?.trim() || node.value;
      field.options.push({ value: node.value, label: optionLabel, index });
      groups.set(node.name, field);
    }
    return [...groups.values()];
  });
}

export async function fillNativeChoices(page, fields, answers) {
  const result = { filled: [], skipped: [], failed: [] };
  for (const field of fields.filter(f => f.type === 'radio')) {
    if (isSensitiveLabel(field.label + ' ' + field.options.map(option => option.label).join(' '))) { result.skipped.push(field.label); continue; }
    const choice = field.options.find(option => option.value === answers[field.key]);
    if (!choice) { result.skipped.push(field.label); continue; }
    const locator = page.locator('input[type=radio]').nth(choice.index);
    const facts = await locator.evaluate(node => ({ name: node.name, value: node.value }));
    if (facts.name !== field.name || facts.value !== choice.value) { result.failed.push(field.label); continue; }
    try { await locator.check(); (await locator.isChecked() ? result.filled : result.failed).push(field.label); }
    catch { result.failed.push(field.label); }
  }
  return result;
}
