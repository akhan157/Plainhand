// The pre-submit check: one list per application page, so the candidate's final
// review is quick. Every field is filled (and from what), flagged with the reason
// Plainhand left it to them, or mismatched (the page did not keep the value, or the
// attached resume is not the approved one). Nothing here clicks or submits.
import { isSensitiveLabel } from './field-policy.mjs';

const RESUME = '__resume__';
const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function sourceOf(value, profile) {
  if (value === RESUME) return 'your approved resume';
  const v = norm(value);
  if (!v) return null;
  if (['name', 'email', 'phone', 'location'].some(key => norm(profile?.[key]) === v || (key === 'name' && norm(profile?.name).split(' ').includes(v))) || (v.length > 8 && norm(profile?.links).includes(v))) return 'your profile';
  return 'your application materials';
}

function flagReason(field, question) {
  if (isSensitiveLabel(field.label)) return { reason: 'sensitive', text: 'Answer this yourself; Plainhand never does.' };
  if (question) return { reason: 'no-information', text: question.question };
  if (field.type === 'file') return { reason: 'document', text: 'Attach this document yourself.' };
  if (['select-one', 'combobox', 'radio'].includes(field.type)) return { reason: 'choice', text: 'Choose the option that applies to you.' };
  return { reason: 'no-information', text: 'Plainhand has nothing in your profile for this.' };
}

// fields: the page's inspected fields. answers: what Plainhand planned to enter (key → value).
// questions: what it asked the candidate. fill: the last fill result (filled, skipped, failed
// labels). readback: current values read from the page (key → value), when available.
// resume: { attached, approved } file hashes, when known.
export function presubmitCheck({ fields = [], answers = {}, questions = [], fill = null, readback = null, profile = {}, resume = null } = {}) {
  const asked = new Map(questions.map(q => [q.key, q]));
  const failed = new Set(fill?.failed || []);
  const items = fields.map(field => {
    const planned = answers[field.key];
    const base = { key: field.key, label: field.label, required: Boolean(field.required), type: field.type };
    if (planned !== undefined && planned !== '' && planned !== null) {
      if (failed.has(field.label)) return { ...base, status: 'mismatch', reason: 'not-kept', text: 'The page did not keep this answer. Check it before submitting.' };
      if (planned === RESUME && resume && resume.attached && resume.approved && resume.attached !== resume.approved) return { ...base, status: 'mismatch', reason: 'resume-changed', text: 'The attached resume is not the one you approved.' };
      if (readback && planned !== RESUME && Object.hasOwn(readback, field.key) && norm(readback[field.key]) !== norm(planned) && !norm(readback[field.key]).includes(norm(planned)))
        return { ...base, status: 'mismatch', reason: 'changed-on-page', text: 'The page now shows something different from what Plainhand entered.' };
      return { ...base, status: 'filled', source: sourceOf(planned, profile) };
    }
    if (readback && norm(readback[field.key])) return { ...base, status: 'filled', source: 'you, on the page' };
    return { ...base, status: 'flagged', ...flagReason(field, asked.get(field.key)) };
  });
  const count = pred => items.filter(pred).length;
  const summary = {
    total: items.length,
    filled: count(i => i.status === 'filled'),
    flagged: count(i => i.status === 'flagged'),
    mismatched: count(i => i.status === 'mismatch'),
    requiredFlagged: count(i => i.status === 'flagged' && i.required),
  };
  // Ready means nothing required is left and nothing disagrees; the candidate still checks and submits.
  return { items, summary, ready: summary.requiredFlagged === 0 && summary.mismatched === 0 };
}
