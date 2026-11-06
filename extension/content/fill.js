// Plainhand page helper. Injected only when the candidate clicks a button in the
// popup (never in the background), after vendor/plainhand-vendor.js.
//
//   __plainhand.read()            the form's questions (labels, types, options) and
//                                 the frames on the page, for the popup
//   __plainhand.fill(request)     enters the approved answers into this frame
//   __plainhand.posting()         company, title and description of a job posting
//
// It never submits. The only clicks it makes open a dropdown or choose one of its
// options, and each target is refused unless the shared submit guard says it is not
// a submit control. Radios and checkboxes are set directly (with a non-activating
// event React listens for), and file inputs get the approved PDF through
// DataTransfer, so nothing else on the page is ever pressed.
(() => {
  'use strict';
  if (globalThis.__plainhand) return;
  const V = globalThis.__plainhandVendor;
  if (!V) throw new Error('Plainhand helpers did not load.');

  const RESUME = '__resume__';
  const COVER = '__cover_letter__';
  const MAX_TEXT = 20000;
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ctx = { evaluate: async fn => fn(), url: () => location.href };

  // The extractor's types, in the names the server (presubmit, suggestFormAnswers) uses.
  const typeOf = field => field.combobox ? 'combobox' : field.type === 'select' ? 'select-one' : field.type;

  async function read() {
    const form = await V.extractForm(ctx);
    const fields = form.fields.map(field => ({
      id: field.id,
      label: norm(field.label) || norm(field.nativeName) || norm(field.nativeId) || 'Unlabelled field',
      type: typeOf(field),
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options.map(norm).filter(Boolean).slice(0, 200) : [],
      maxLength: field.maxLength || undefined,
      filled: field.type === 'file' ? false : Boolean(norm(field.value)),
    }));
    // Frames that may hold the form: the popup asks for access to known
    // application sites the first time one appears.
    const frames = [...document.querySelectorAll('iframe[src]')]
      .map(frame => { try { return new URL(frame.src, location.href).href; } catch { return null; } })
      .filter(src => src && /^https:/.test(src));
    return { url: location.href, title: document.title, top: window === window.top, fields, frames: [...new Set(frames)].slice(0, 20) };
  }

  // ── never submit ────────────────────────────────────────────────────────────
  // Every click goes through here. A target the shared submit guard recognises as
  // a submit control (by type, by HTML's default for a typeless button in a form,
  // or by its wording in any language the guard knows) is refused.
  const refusals = [];
  function safeToClick(el) {
    if (!el || !(el instanceof Element)) return false;
    let facts;
    try { facts = V.factsOf(el, null); } catch { return false; }
    if (V.isSubmitControl(facts)) { refusals.push(norm(facts.aria || facts.text || facts.value).slice(0, 80) || facts.tag); return false; }
    return true;
  }
  function press(el) {
    if (!safeToClick(el)) return false;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }
  const key = (el, name) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

  // ── React-safe value setting ────────────────────────────────────────────────
  // React keeps its own copy of an input's value; assigning el.value updates that
  // copy too, so React thinks nothing changed and puts the old value back. The
  // prototype's setter changes only the DOM, and the input event then tells React.
  function nativeSet(el, prop, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, prop)?.set;
    if (setter) setter.call(el, value); else el[prop] = value;
  }
  const fire = (el, ...types) => { for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true })); };

  function setText(el, value) {
    el.focus?.();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      fire(el, 'change');
    } else {
      nativeSet(el, 'value', value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      fire(el, 'change');
    }
    el.blur?.();
    return norm(el.isContentEditable ? el.textContent : el.value) === norm(value);
  }

  // Radios and checkboxes: set checked, then a plain (non-activating) click event,
  // which is what React's onChange for these inputs listens for, plus input/change.
  function setChecked(el, checked) {
    if (!safeToClick(el)) return false;
    nativeSet(el, 'checked', checked);
    el.dispatchEvent(new Event('click', { bubbles: true }));
    fire(el, 'input', 'change');
    return el.checked === checked;
  }

  function setSelect(el, value) {
    const options = [...el.options].filter(o => !o.disabled && norm(o.textContent) && !/^(select|choose|--)/i.test(norm(o.textContent)));
    let index = V.pickComboboxOption(options.map(o => o.textContent), value);
    if (index < 0) index = options.findIndex(o => norm(o.value).toLowerCase() === norm(value).toLowerCase());
    if (index < 0) return 'no-match';
    nativeSet(el, 'value', options[index].value);
    fire(el, 'input', 'change');
    return el.value === options[index].value ? 'filled' : 'failed';
  }

  const visible = el => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
  function optionsFor(el) {
    const ids = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    const lists = ids.map(id => document.getElementById(id)).filter(Boolean);
    const scoped = lists.flatMap(list => [...list.querySelectorAll('[role="option"]')]).filter(visible);
    return scoped.length ? scoped : [...document.querySelectorAll('[role="option"]')].filter(visible);
  }
  function comboboxShows(el, value) {
    const group = el.closest('[class*="select__container"], [class*="field-entry"], [class*="form-group"], [class*="question"], label') || el.parentElement;
    const display = group?.querySelector('[class*="singleValue"], [class*="single-value"], [data-selected-value]');
    const seen = [el.getAttribute('aria-valuetext'), el.value, el.tagName === 'INPUT' ? '' : el.textContent, display?.textContent].filter(Boolean);
    return V.pickComboboxOption(seen, value) >= 0;
  }
  async function setCombobox(el, value) {
    el.focus?.();
    if (!press(el)) return 'refused';
    if (el.tagName === 'INPUT') { nativeSet(el, 'value', value.slice(0, 200)); el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); }
    let options = [];
    for (let i = 0; i < 20 && !options.length; i++) { await sleep(75); options = optionsFor(el); }
    const index = V.pickComboboxOption(options.map(o => o.textContent), value);
    const close = () => { if (el.tagName === 'INPUT' && el.value) { nativeSet(el, 'value', ''); fire(el, 'input'); } key(el, 'Escape'); };
    if (index < 0) { close(); return 'no-match'; }
    if (!press(options[index])) { close(); return 'refused'; }
    await sleep(50);
    return comboboxShows(el, value) ? 'filled' : 'failed';
  }

  function attach(el, file) {
    const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, { type: 'application/pdf' }));
    el.files = transfer.files;
    fire(el, 'input', 'change');
    return el.files?.[0]?.name === file.name;
  }

  // request: { fields: [{ id, label, type }] as read, answers: { id: value },
  //            identity: [id] (name fields Plainhand may fill despite a sensitive word),
  //            files: { resume?: { name, base64 }, cover?: { name, base64 } } }
  async function fill(request) {
    refusals.length = 0;
    const { fields = [], answers = {}, identity = [], files = {} } = request || {};
    const filled = [], skipped = [], failed = [];
    const skip = (field, reason) => skipped.push({ id: field.id, label: field.label, reason });
    // Read again: if the page changed since the plan, a stale answer must never land in a different question.
    const now = new Map((await read()).fields.map(field => [field.id, field]));
    for (const field of fields) {
      const value = answers[field.id];
      const current = now.get(field.id);
      if (!current || current.label !== field.label || current.type !== field.type) { if (value !== undefined) skip(field, 'changed'); continue; }
      const options = field.type === 'radio' ? ' ' + current.options.join(' ') : '';
      if (V.isSensitiveLabel(field.label + options) && !(identity.includes(field.id) && ['text', 'textarea', 'email', 'tel', 'url'].includes(field.type))) { skip(field, 'sensitive'); continue; }
      if (typeof value !== 'string' || !value.trim()) { skip(field, field.type === 'file' ? 'document' : 'no-answer'); continue; }
      const nodes = [...document.querySelectorAll(`[data-co-field="${CSS.escape(field.id)}"]`)];
      const el = nodes[0];
      if (!el) { skip(field, 'changed'); continue; }
      try {
        if (field.type === 'file') {
          const wanted = value === RESUME ? files.resume : value === COVER ? files.cover : null;
          const fits = value === RESUME ? V.isResumeLabel(field.label) : value === COVER ? /cover.?letter/i.test(field.label) : false;
          if (!wanted || !fits) { skip(field, 'document'); continue; }
          if (el.files?.length) { skip(field, 'kept-yours'); continue; }
          (attach(el, wanted) ? filled : failed).push({ id: field.id, label: field.label });
          continue;
        }
        if (value === RESUME || value === COVER) { skip(field, 'document'); continue; }
        const text = value.slice(0, field.maxLength > 0 ? Math.min(field.maxLength, MAX_TEXT) : MAX_TEXT);
        let outcome;
        if (field.type === 'radio') {
          const index = V.pickComboboxOption(nodes.map(node => node.getAttribute('data-co-option') || node.value), text);
          if (index < 0) outcome = 'no-match';
          else if (nodes.some(node => node.checked)) outcome = 'kept-yours';
          else outcome = setChecked(nodes[index], true) ? 'filled' : 'failed';
        } else if (field.type === 'checkbox') {
          if (!/^(yes|true|checked|on)$/i.test(text.trim())) outcome = 'no-answer';
          else if (el.checked) outcome = 'kept-yours';
          else outcome = setChecked(el, true) ? 'filled' : 'failed';
        } else if (field.type === 'select-one') {
          outcome = el.selectedIndex > 0 && norm(el.value) ? 'kept-yours' : setSelect(el, text);
        } else if (field.type === 'combobox') {
          if (el.tagName === 'SELECT') outcome = el.selectedIndex > 0 ? 'kept-yours' : setSelect(el, text);
          else outcome = comboboxShows(el, text) ? 'filled' : await setCombobox(el, text);
        } else {
          if (current.filled && norm(el.isContentEditable ? el.textContent : el.value) !== norm(text)) outcome = 'kept-yours';
          else outcome = setText(el, text) ? 'filled' : 'failed';
        }
        if (outcome === 'filled') filled.push({ id: field.id, label: field.label });
        else if (outcome === 'failed') failed.push({ id: field.id, label: field.label });
        else skip(field, outcome);
      } catch { failed.push({ id: field.id, label: field.label }); }
    }
    return { url: location.href, filled, skipped, failed, refused: [...refusals] };
  }

  // A job posting's company, title and description, for "Save this job". The
  // posting's own JobPosting data first, then the page's heading and main text.
  function posting() {
    const text = node => norm(node?.innerText || node?.textContent || '');
    const fromHtml = html => { const box = document.createElement('div'); box.innerHTML = String(html || ''); return (box.innerText || box.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
    let ld = null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const list = [].concat(data, data?.['@graph'] || []);
        ld = list.find(item => item && [].concat(item['@type']).includes('JobPosting')) || ld;
      } catch {}
    }
    const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
    const host = location.hostname.replace(/^www\./, '');
    const company = norm(ld?.hiringOrganization?.name || (typeof ld?.hiringOrganization === 'string' ? ld.hiringOrganization : '') || meta('og:site_name') || host.split('.')[0]);
    const title = norm(ld?.title || text(document.querySelector('h1')) || meta('og:title') || document.title);
    const main = document.querySelector('main, [role="main"], article, #content, .content') || document.body;
    const description = (ld?.description ? fromHtml(ld.description) : (main.innerText || main.textContent || '')).slice(0, 45000);
    return { company: company.slice(0, 200), title: title.slice(0, 300), url: location.href, description };
  }

  globalThis.__plainhand = Object.freeze({ read, fill, posting });
})();
