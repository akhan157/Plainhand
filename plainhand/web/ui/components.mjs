// Shared building blocks: buttons, fields, notices, dialogs, tabs and pills.
import { html, useEffect, useRef, useState, Icon, toast, focusables, initials } from './core.mjs';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Spinner({ label }) {
  return html`<span class="spinner" role=${label ? 'status' : undefined} aria-label=${label} aria-hidden=${label ? undefined : 'true'}></span>`;
}

// A button that runs an async action, disables itself while it runs and shows
// any error in the status region. Use it for every server call.
export function ActionButton({ onClick, class: className = '', icon, children, disabled, busyLabel, spin = true, type = 'button', ...rest }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  async function run(event) {
    if (busy) return;
    setBusy(true);
    try { await onClick?.(event); } catch (error) { toast(error.message, true); } finally { if (mounted.current) setBusy(false); }
  }
  return html`<button type=${type} class=${cx('button', className)} disabled=${disabled || busy} aria-busy=${busy ? 'true' : undefined} onClick=${run} ...${rest}>
    ${busy && spin ? html`<${Spinner} />` : icon ? html`<${Icon} name=${icon} />` : null}${busy && busyLabel ? busyLabel : children}
  </button>`;
}

export function Button({ class: className = '', icon, iconEnd, children, type = 'button', ...rest }) {
  return html`<button type=${type} class=${cx('button', className)} ...${rest}>${icon ? html`<${Icon} name=${icon} />` : null}${children}${iconEnd ? html`<${Icon} name=${iconEnd} />` : null}</button>`;
}
export function IconButton({ icon, label, class: className = '', ...rest }) {
  return html`<button type="button" class=${cx('icon-button', className)} aria-label=${label} title=${label} ...${rest}><${Icon} name=${icon} /></button>`;
}
export function LinkButton({ href, icon, iconEnd, children, class: className = '', external, ...rest }) {
  return html`<a class=${cx('button', className)} href=${href} target=${external ? '_blank' : undefined} rel=${external ? 'noreferrer' : undefined} ...${rest}>${icon ? html`<${Icon} name=${icon} />` : null}${children}${iconEnd || external ? html`<${Icon} name=${iconEnd || 'external'} />` : null}</a>`;
}

export function Pill({ tone = 'neutral', children, icon }) {
  return html`<span class=${'pill tone-' + tone}>${icon ? html`<${Icon} name=${icon} />` : null}${children}</span>`;
}

export function Notice({ tone = 'neutral', icon, title, children, class: className = '' }) {
  const glyph = icon || ({ success: 'checkCircle', danger: 'alert', warn: 'alert', info: 'info' })[tone] || 'info';
  return html`<div class=${cx('notice', 'tone-' + tone, className)}><${Icon} name=${glyph} /><div class="notice-body">${title ? html`<strong>${title}</strong>` : null}${children}</div></div>`;
}

export function Empty({ icon = 'inbox', title, children, action, compact }) {
  return html`<div class=${cx('empty', compact && 'compact')}>${!compact ? html`<span class="empty-icon"><${Icon} name=${icon} /></span>` : null}${title ? html`<h3>${title}</h3>` : null}${children ? html`<p>${children}</p>` : null}${action || null}</div>`;
}

export function Card({ title, subtitle, icon, actions, children, class: className = '', headingLevel = 2, id }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return html`<section class=${cx('card', className)} aria-labelledby=${title && id ? id : undefined}>
    ${title ? html`<header class="card-head"><div class="card-title">${icon ? html`<span class="card-icon"><${Icon} name=${icon} /></span>` : null}<div><${Heading} id=${id}>${title}</${Heading}>${subtitle ? html`<p>${subtitle}</p>` : null}</div></div>${actions ? html`<div class="card-actions">${actions}</div>` : null}</header>` : null}
    ${children}
  </section>`;
}

export function PageHeading({ title, subtitle, actions, eyebrow }) {
  return html`<header class="page-heading"><div>${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : null}<h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : null}</div>${actions ? html`<div class="page-actions">${actions}</div>` : null}</header>`;
}

// Labelled form controls. `form` prefixes the id so several forms can share names.
export function Field({ form = 'f', name, label, value = '', onInput, type = 'text', area, large, hint, required, placeholder, full, options, disabled, autocomplete, id, labelExtra }) {
  const fieldId = id || `${form}-${name}`;
  const hintId = hint ? fieldId + '-hint' : undefined;
  const handle = event => onInput?.(event.currentTarget.value, event);
  let control;
  if (options) control = html`<select id=${fieldId} name=${name} value=${value} onChange=${handle} required=${required} disabled=${disabled} aria-describedby=${hintId}>${options.map(([v, l]) => html`<option value=${v} selected=${v === value}>${l}</option>`)}</select>`;
  else if (area) control = html`<textarea id=${fieldId} name=${name} value=${value} onInput=${handle} required=${required} placeholder=${placeholder} class=${large ? 'large' : ''} disabled=${disabled} aria-describedby=${hintId}></textarea>`;
  else control = html`<input id=${fieldId} name=${name} type=${type} value=${value} onInput=${handle} required=${required} placeholder=${placeholder} disabled=${disabled} autocomplete=${autocomplete} aria-describedby=${hintId} />`;
  return html`<div class=${cx('field', full && 'full')}><label for=${fieldId}>${label}${labelExtra || null}</label>${control}${hint ? html`<small id=${hintId}>${hint}</small>` : null}</div>`;
}

// Modal dialog: labelled, focus trapped, focus restored on close. Escape is
// handled by the shell so only the topmost layer closes.
export function Dialog({ title, onClose, children, size = 'md', description }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const first = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector('input:not([type=file]):not([type=checkbox]),textarea,select') || focusables(ref.current)[1] || ref.current;
    first?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return html`<div class="layer dialog-layer"><div class="scrim" onClick=${onClose}></div>
    <section ref=${ref} class=${'dialog size-' + size} role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1" onKeyDown=${event => trapTab(event, ref.current)}>
      <header class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description ? html`<p>${description}</p>` : null}</div><${IconButton} icon="close" label="Close dialog" onClick=${onClose} /></header>
      <div class="dialog-body">${children}</div>
    </section></div>`;
}
export function trapTab(event, root) {
  if (event.key !== 'Tab' || !root) return;
  const items = focusables(root);
  if (!items.length) return;
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function Tabs({ tabs, value, onChange, label, idPrefix = 'tab' }) {
  const ref = useRef();
  function key(event) {
    const index = tabs.findIndex(t => t[0] === value);
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next][0]);
    queueMicrotask(() => ref.current?.querySelector(`#${idPrefix}-${tabs[next][0]}`)?.focus());
  }
  return html`<div class="tabs" role="tablist" aria-label=${label} ref=${ref} onKeyDown=${key}>${tabs.map(([id, text, badge]) => html`<button type="button" role="tab" id=${`${idPrefix}-${id}`} aria-controls=${`${idPrefix}-panel`} aria-selected=${value === id ? 'true' : 'false'} tabindex=${value === id ? 0 : -1} class=${cx('tab', value === id && 'active')} onClick=${() => onChange(id)}>${text}${badge !== undefined && badge !== null ? html`<span class="tab-badge">${badge}</span>` : null}</button>`)}</div>`;
}

export function Disclosure({ label, icon = 'plus', open, onToggle, children, id }) {
  return html`<div class=${cx('disclosure', open && 'open')}>
    <button type="button" class="button ghost small" aria-expanded=${open ? 'true' : 'false'} aria-controls=${id} onClick=${onToggle}><${Icon} name=${open ? 'chevronDown' : icon} />${label}</button>
    ${open ? html`<div id=${id} class="disclosure-body">${children}</div>` : null}
  </div>`;
}

export function CompanyMark({ name, index = 0 }) {
  const hue = [...(name || '')].reduce((sum, c) => sum + c.charCodeAt(0), index) % 4 + 1;
  return html`<span class=${'company-mark m' + hue} aria-hidden="true">${initials(name)}</span>`;
}

export function Score({ value, size = 'sm' }) {
  if (typeof value !== 'number') return null;
  const tone = value >= 4 ? 'good' : value >= 3 ? 'mid' : 'low';
  return html`<span class=${`score score-${size} score-${tone}`} title="Fit score out of 5"><strong>${value.toFixed(1)}</strong><span>/5</span></span>`;
}

export function stage(job) {
  if (job.stale) return ['warn', 'Needs refresh'];
  if (job.status === 'Applied') return ['info', 'Applied'];
  if (['Responded', 'Interview', 'Offer'].includes(job.status)) return ['success', job.status];
  if (['Rejected', 'Discarded', 'SKIP'].includes(job.status)) return ['neutral', job.status === 'SKIP' ? 'Skipped' : job.status];
  if (job.stage === 'awaiting-answer') return ['warn', 'Needs your input'];
  if (job.stage === 'review-blocked') return ['danger', 'Review needed'];
  if (job.stage === 'approved' || job.stage === 'awaiting-user-submit') return ['success', 'Ready to apply'];
  if (job.packet) return ['accent', 'Ready for review'];
  if (job.selected) return ['info', 'Selected'];
  if (job.evaluation) return [job.evaluation.recommendation === 'Skip' ? 'neutral' : job.evaluation.recommendation === 'Apply' ? 'success' : 'warn', job.evaluation.recommendation];
  return ['neutral', 'Not evaluated'];
}
export function StagePill({ job }) {
  const [tone, text] = stage(job);
  return html`<${Pill} tone=${tone}>${text}</${Pill}>`;
}

export function Meter({ value, max, label }) {
  const pct = max ? Math.round(value / max * 100) : 0;
  return html`<div class="meter" role="progressbar" aria-label=${label} aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value}><span class=${'meter-fill w' + Math.round(pct / 5) * 5}></span></div>`;
}
