// HTML for the owned evaluation portals. The same markup is served to the app's
// production ApplicationBrowser through a Playwright route; it is not reachable
// from the public internet and it never contacts a real employer.
import { portalById, personaById, jobById } from './corpus.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const option = o => `<option value="${escape(o.value)}"${o.value === '' ? ' selected' : ''}>${escape(o.label)}</option>`;

function control(field) {
  const required = field.required ? ' required' : '';
  const common = `name="${field.name}" id="field-${field.name}"${required}`;
  if (field.type === 'textarea') return `<label for="field-${field.name}">${escape(field.label)}<textarea ${common} maxlength="1200"></textarea></label>`;
  if (field.type === 'select-one') return `<label for="field-${field.name}">${escape(field.label)}<select ${common}>${(field.options || []).map(option).join('')}</select></label>`;
  if (field.type === 'radio') return `<fieldset><legend>${escape(field.label)}</legend>${(field.options || []).map((o, idx) => `<label><input type="radio" name="${field.name}" value="${escape(o.value)}"${field.required && idx === 0 ? ' required' : ''}> ${escape(o.label)}</label>`).join('')}</fieldset>`;
  if (field.type === 'file') return `<label for="field-${field.name}">${escape(field.label)}<input type="file" ${common} accept=".pdf"></label>`;
  if (field.type === 'checkbox') return `<label><input type="checkbox" ${common}> ${escape(field.label)}</label>`;
  return `<label for="field-${field.name}">${escape(field.label)}<input type="${field.type || 'text'}" ${common}></label>`;
}

// Repeated education or employment records share a legend, so the app's
// fieldsOn() reports sectionContext.index/count instead of one ambiguous field.
function controls(fields, portal) {
  const repeating = Boolean(portal.records) || fields.some(field => field.section && field.recordIndex !== undefined);
  const html = [];
  let group = null;
  const flush = () => {
    if (!group) return;
    html.push(`<fieldset><legend>${escape(group.section)}</legend>${group.items.map(control).join('')}</fieldset>`);
    group = null;
  };
  for (const field of fields) {
    const grouped = repeating && Boolean(field.section && field.recordIndex !== undefined);
    const key = grouped ? `${field.section}\u0000${field.recordIndex}` : null;
    if (grouped && group && group.key === key) { group.items.push(field); continue; }
    if (grouped && group) flush();
    if (grouped) group = { key, section: field.section, items: [field] };
    else html.push(control(field));
  }
  flush();
  return html.join('');
}

function stepUrl(base, step) { return `${base}?step=${step}`; }

export function renderPortal({ scenario, step = 1 }) {
  const portal = portalById(scenario.portal);
  const persona = personaById(scenario.persona);
  const job = jobById(scenario.job);
  if (!portal || !persona || !job) throw new Error('Unknown evaluation scenario.');
  const base = `https://jobs.lever.co/synthetic/${scenario.id}`;
  const head = `<!doctype html><html lang="en"><head><title>${escape(job.title)} — ${escape(job.company)}</title><style>
    body{font:16px/1.55 system-ui,Arial;margin:40px auto;max-width:700px;color:#26392e;background:#f7f8f5}
    label{display:block;margin:18px 0} input,textarea,select{display:block;width:100%;padding:11px;box-sizing:border-box;border:1px solid #bdc9b4;background:#fff}
    input[type=checkbox]{width:auto;display:inline} button{background:#244c35;color:#fff;padding:12px 24px;border:0;margin-top:8px}
    .note{color:#55665a;font-size:14px} [hidden]{display:none!important}
  </style></head><body><p class="note">EVALUATION SANDBOX · NOT A REAL EMPLOYER</p>
  <h1>${escape(job.title)}</h1><p>${escape(job.company)} · ${escape(job.location)}</p>`;

  if (portal.login) {
    return head + `<p>Welcome! Create an account to manage your application.</p>
      <label>Email<input name="loginEmail" type="email"></label>
      <label>Password<input name="loginPassword" type="password"></label>
      <button type="button">Sign in</button></body></html>`;
  }

  const allFields = (portal.steps[step - 1] || []);
  const fields = portal.conditional ? allFields.filter(field => field.name !== 'employer') : allFields;
  const last = step >= portal.steps.length;
  const challenge = portal.challenge ? '<div data-plainhand-challenge>Complete the CAPTCHA</div>' : '';
  const conditional = portal.conditional && step === 1 ? `<script>
    document.getElementById('field-level').addEventListener('change', () => {
      document.getElementById('row-employer').hidden = document.getElementById('field-level').value !== 'professional';
    });
  </script>` : '';
  const employerRow = portal.conditional && step === 1
    ? `<label id="row-employer" hidden>Most recent employer<input name="employer" id="field-employer" required></label>`
    : '';
  const discardOnce = portal.discardOnce && step === 1
    ? `<script>window.discarded=false;document.querySelector('[name=name]').addEventListener('input',e=>{if(!window.discarded){window.discarded=true;e.target.value='';}});</script>`
    : '';

  const next = last
    ? '<button type="submit" disabled title="Submission is the candidate\'s action">Submit application</button>'
    : `<button type="button" onclick="location.href='${stepUrl(base, step + 1)}'">Continue</button>`;

  return head + challenge + `<form id="application" onsubmit="return false">${controls(fields, portal)}${employerRow}${next}</form>${discardOnce}${conditional}</body></html>`;
}

export function portalDefinition(scenario) {
  const portal = portalById(scenario.portal);
  if (!portal) throw new Error('Unknown portal.');
  return { ...portal, fields: portal.steps.flat() };
}

export const portalUrl = scenario => `https://jobs.lever.co/synthetic/${scenario.id}`;
