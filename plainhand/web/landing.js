/* Plainhand landing page script.
   Loaded in <head> without defer, so this first block runs before first paint:
   it adds the "js" class and applies a saved theme choice (no light flash for
   people who chose Dark). Everything else waits for DOMContentLoaded.
   The theme key is shared with the app (theme.js), so a choice made here carries
   over after sign-in. */
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  let pref = 'system';
  try { const saved = localStorage.getItem('plainhand.theme'); if (saved === 'light' || saved === 'dark' || saved === 'system') pref = saved; } catch { /* storage blocked */ }
  root.dataset.themePreference = pref;
  if (pref !== 'system') root.dataset.theme = pref;
})();

document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;
  motionQuery.addEventListener('change', e => { reduced = e.matches; });
  const EASE = 'cubic-bezier(.2,.7,.2,1)';

  // One polite live region for demo results.
  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);
  let liveTimer = 0;
  const announce = text => { live.textContent = ''; clearTimeout(liveTimer); liveTimer = setTimeout(() => { live.textContent = text; }, 60); };

  // Roving tablist with arrow keys, Home and End. onSelect(index, tab).
  function tablist(list, tabs, onSelect, { vertical = false } = {}) {
    list.addEventListener('keydown', e => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const prev = vertical ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft'];
      const next = vertical ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight'];
      let j = null;
      if (next.includes(e.key)) j = (i + 1) % tabs.length;
      else if (prev.includes(e.key)) j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      e.stopPropagation();
      tabs[j].focus();
      onSelect(j, tabs[j]);
    });
    tabs.forEach((t, i) => t.addEventListener('click', () => onSelect(i, t)));
  }
  function markTabs(tabs, index) {
    tabs.forEach((t, i) => { t.setAttribute('aria-selected', String(i === index)); t.tabIndex = i === index ? 0 : -1; });
  }

  /* ---------- Theme: Light / Dark / System ---------- */
  (() => {
    const buttons = $$('[data-theme-choice]');
    const metas = $$('meta[name="theme-color"]');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const names = { light: 'Light', dark: 'Dark', system: 'System' };
    function paint() {
      const pref = root.dataset.themePreference || 'system';
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === pref)));
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      const color = dark ? '#0f0f10' : '#f5f6f1';
      metas.forEach(m => { m.content = color; });
    }
    buttons.forEach(b => b.addEventListener('click', () => {
      const pref = b.dataset.themeChoice;
      root.dataset.themePreference = pref;
      if (pref === 'system') delete root.dataset.theme; else root.dataset.theme = pref;
      try { localStorage.setItem('plainhand.theme', pref); } catch { /* storage blocked */ }
      paint();
      announce(`Theme set to ${names[pref]}.`);
    }));
    media.addEventListener('change', paint);
    paint();
  })();

  /* ---------- Progressive Web App shell registration ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }

  /* ---------- Header: scrolled state, active section, mobile menu ---------- */
  (() => {
    const header = $('#site-header'), btn = $('.menu-btn'), menu = $('#site-menu');
    const links = $$('.nav a');
    const sections = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const small = matchMedia('(max-width: 1080px)');
    let ticking = false;
    function onScroll() {
      ticking = false;
      header.classList.toggle('is-scrolled', scrollY > 8);
      const line = innerHeight * 0.35;
      let active = null;
      for (const s of sections) if (s.getBoundingClientRect().top <= line) active = s;
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) active = sections[sections.length - 1];
      links.forEach(a => { if (active && a.getAttribute('href') === `#${active.id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    addEventListener('resize', onScroll);
    onScroll();

    const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
    function setOpen(open, { returnFocus = false } = {}) {
      btn.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('is-open', open);
      if (open) requestAnimationFrame(() => links[0].focus());
      else if (returnFocus) btn.focus();
    }
    btn.addEventListener('click', () => setOpen(!isOpen()));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) setOpen(false, { returnFocus: true }); });
    menu.addEventListener('click', e => { if (small.matches && e.target.closest('a')) setOpen(false); });
    document.addEventListener('pointerdown', e => { if (isOpen() && !header.contains(e.target)) setOpen(false); });
    header.addEventListener('focusout', e => { if (isOpen() && e.relatedTarget && !header.contains(e.relatedTarget)) setOpen(false); });
    small.addEventListener('change', () => setOpen(false));
  })();

  /* ---------- Scroll reveals ---------- */
  (() => {
    const items = $$('.reveal');
    items.forEach(el => {
      const sibs = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
      el.style.setProperty('--i', String(Math.min(sibs.indexOf(el), 6)));
    });
    if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    items.forEach(el => io.observe(el));
  })();

  /* ---------- Hero: the application folder ---------- */
  (() => {
    const art = $('#hero-art'), scene = $('#folder'), caption = $('#art-caption');
    const tabs = $$('.doc-tab');
    const names = ['resume', 'letter', 'answers'];
    const sheets = Object.fromEntries(names.map(n => [n, document.getElementById(`doc-${n}`)]));
    const captions = {
      resume: 'Resume, tailored for Northstar Robotics. The projects line was rewritten after calibration.',
      letter: "Cover letter in Alex's voice. The highlighted clause replaced a stretched line.",
      answers: 'Form answers, plus the list Plainhand shows before you submit. Work authorization is left for Alex.',
    };
    let current = 'resume', timer = 0;
    const stack = (front, back) => {
      names.forEach(n => { sheets[n].style.zIndex = n === front ? '5' : n === back ? '3' : '2'; });
    };
    stack('resume', 'letter');

    function select(name) {
      if (name === current) return;
      const prev = current;
      current = name;
      markTabs(tabs, names.indexOf(name));
      names.forEach(n => {
        const on = n === name;
        if (on) { sheets[n].removeAttribute('aria-hidden'); sheets[n].tabIndex = 0; }
        else { sheets[n].setAttribute('aria-hidden', 'true'); sheets[n].removeAttribute('tabindex'); }
      });
      caption.textContent = captions[name];
      clearTimeout(timer);
      names.forEach(n => { if (n !== prev && n !== name) sheets[n].dataset.state = 'tucked'; });
      if (reduced) { stack(name, prev); sheets[prev].dataset.state = 'tucked'; sheets[name].dataset.state = 'front'; return; }
      // Put the open sheet back into the pocket first, then pull the chosen one out.
      sheets[prev].dataset.state = 'sunk';
      timer = setTimeout(() => {
        stack(name, prev);
        sheets[prev].dataset.state = 'tucked';
        sheets[name].dataset.state = 'front';
      }, 250);
    }
    tablist($('.doc-tabs'), tabs, i => select(names[i]));
    names.forEach(n => sheets[n].addEventListener('click', () => { if (sheets[n].dataset.state !== 'front') select(n); }));

    // Gentle tilt and parallax that follows a mouse or pen.
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    function tick() {
      cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09;
      scene.style.setProperty('--mx', cx.toFixed(4));
      scene.style.setProperty('--my', cy.toFixed(4));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : 0;
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    art.addEventListener('pointermove', e => {
      if (reduced || e.pointerType === 'touch') return;
      const r = scene.getBoundingClientRect();
      tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.1, 1.1);
      ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.1, 1.1);
      kick();
    });
    art.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
    motionQuery.addEventListener('change', () => { if (reduced) { tx = ty = cx = cy = 0; scene.style.setProperty('--mx', '0'); scene.style.setProperty('--my', '0'); } });
  })();

  /* ---------- Calibration explorer ---------- */
  (() => {
    const STORY = 'Our Formula SAE chassis. I owned the design and ran the physical tests with two teammates.';
    const STORY_SRC = 'Your story · profile conversation';
    const CLAIMS = {
      c1: { n: 1, where: 'Resume, Projects', rating: 'undersold', text: 'Formula SAE: Designed and tested a lightweight chassis for the team.', why: 'Your story says you owned the design and test loop; this reads like a supporting role.', quote: STORY, src: STORY_SRC, sugg: 'Formula SAE: Owned the design and test loop for a lightweight chassis.' },
      c2: { n: 2, where: 'Resume, Education', rating: 'balanced', text: 'B.S. Mechanical Engineering, Example University, 2027.', why: 'Matches your resume. The degree, school and year are locked, so they are copied exactly.', quote: 'B.S. Mechanical Engineering, Example University, 2027.', src: 'Your resume · Alex_Morgan_Resume.pdf', sugg: '', locks: ['B.S. Mechanical Engineering', 'Example University', '2027'] },
      c3: { n: 3, where: 'Answer, project you are proud of', rating: 'balanced', text: 'I designed and tested a lightweight chassis for our Formula SAE team.', why: 'Matches your story.', quote: STORY, src: STORY_SRC, sugg: '' },
      c4: { n: 4, where: 'Cover letter, paragraph 1', rating: 'stretched', text: 'Through Formula SAE, I designed and tested a lightweight chassis and learned to connect design decisions with what happens in the workshop.', why: 'Nothing in your sources says you worked in the workshop yourself.', quote: STORY, src: STORY_SRC, sugg: 'Through Formula SAE, I designed and tested a lightweight chassis with the teammates who built it.' },
      c5: { n: 5, where: 'Resume, draft line', rating: 'unsupported', text: 'Led a team of 12 through the chassis build.', why: 'No source mentions leading a team, or the number 12. Your story says you ran the tests with two teammates.', quote: '', src: 'No matching source', sugg: 'Remove this line.' },
    };
    const LABEL = { undersold: 'Undersold', balanced: 'Balanced', stretched: 'Stretched', unsupported: 'Unsupported', removed: 'Removed' };
    const ICON = { undersold: 'i-up', balanced: 'i-check', stretched: 'i-down', unsupported: 'i-ban', removed: 'i-ban' };
    const LEARN = {
      'c1:used': 'States ownership fully when your story backs it up (took the stronger wording).',
      'c1:kept': 'Keeps some lines modest even when the evidence supports more.',
      'c4:used': 'Holds claims to the evidence (chose the closer wording).',
      'c4:kept': 'Accepts this kind of stretch in a cover letter.',
    };
    const ids = Object.keys(CLAIMS);
    const fresh = () => Object.fromEntries(ids.map(id => [id, { rating: CLAIMS[id].rating, text: CLAIMS[id].text, decision: null }]));
    let state = fresh(), sel = 'c1', learned = [], busy = 0;

    const tabs = $$('.claim'), panel = $('#cal-panel');
    const el = { where: $('#cal-where'), line: $('#cal-line'), rating: $('#cal-rating'), why: $('#cal-why'), quote: $('#cal-quote'), src: $('#cal-src'), suggRow: $('#cal-sugg-row'), sugg: $('#cal-sugg'), use: $('#cal-use'), keep: $('#cal-keep'), note: $('#cal-note') };

    const svgUse = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `#${id}`); s.append(u); return s; };
    function chip(r) {
      const c = document.createElement('span'); c.className = 'chip'; c.dataset.r = r;
      const t = document.createElement('span'); t.className = 'chip-t'; t.textContent = LABEL[r];
      c.append(svgUse(ICON[r]), t); return c;
    }
    function lineNodes(text, id, cls = '') {
      // Words as spans so a rewrite can animate; locked facts get a lock mark.
      const frag = document.createDocumentFragment();
      const locks = CLAIMS[id].locks || [];
      if (locks.length && text === CLAIMS[id].text) {
        let rest = text;
        locks.forEach(lk => {
          const i = rest.indexOf(lk);
          if (i < 0) return;
          if (i) frag.append(rest.slice(0, i));
          const s = document.createElement('span'); s.className = 'lockword'; s.textContent = lk; s.append(svgUse('i-lock'));
          frag.append(s);
          rest = rest.slice(i + lk.length);
        });
        if (rest) frag.append(rest);
        return frag;
      }
      text.split(/(\s+)/).forEach((w, i) => {
        if (/^\s+$/.test(w)) { frag.append(w); return; }
        const s = document.createElement('span'); s.className = `w ${cls}`; s.textContent = w; s.style.setProperty('--d', String(i / 2));
        frag.append(s);
      });
      return frag;
    }

    function renderTally() {
      const counts = { undersold: 0, balanced: 0, stretched: 0, unsupported: 0 };
      let total = 0;
      ids.forEach(id => { const r = state[id].rating; if (r in counts) { counts[r]++; total++; } });
      Object.entries(counts).forEach(([k, n]) => {
        const seg = $(`.seg[data-seg="${k}"]`);
        seg.style.flexGrow = String(n);
        seg.classList.toggle('is-empty', n === 0);
        const b = $(`[data-count="${k}"]`);
        if (b.textContent !== String(n)) { b.textContent = String(n); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
      });
      const visible = Object.entries(counts).filter(([, n]) => n > 0).map(([k]) => k);
      $$('.seg').forEach(s => s.style.setProperty('border-right-width', visible[visible.length - 1] === s.dataset.seg || s.classList.contains('is-empty') ? '0px' : '2px'));
      const usable = total - counts.unsupported;
      $('#tally-usable').textContent = `${usable} of ${total} lines can be used`;
      return { counts, usable, total };
    }
    function tallySentence() {
      const { counts } = renderTally();
      return `Tally: ${counts.undersold} undersold, ${counts.balanced} balanced, ${counts.stretched} stretched, ${counts.unsupported} unsupported.`;
    }
    function renderLearned(newKey) {
      const list = $('#learned-list');
      list.replaceChildren();
      if (!learned.length) {
        const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Nothing yet. Decide on a flagged line and your choice shows up here.'; list.append(li); return;
      }
      learned.forEach(k => { const li = document.createElement('li'); li.textContent = LEARN[k]; if (k === newKey && !reduced) li.classList.add('is-new'); list.append(li); });
    }
    function renderTab(id) {
      const t = tabs.find(b => b.dataset.claim === id), s = state[id];
      t.dataset.rating = s.rating;
      t.querySelector('.chip').replaceWith(chip(s.rating));
      t.querySelector('.claim-text').textContent = s.text;
      t.classList.toggle('is-removed', s.decision === 'removed');
      t.classList.toggle('is-kept', s.decision === 'kept');
    }
    function renderPanel(id, { animateLine = false } = {}) {
      const c = CLAIMS[id], s = state[id];
      panel.setAttribute('aria-labelledby', `claim-${id}`);
      panel.dataset.rating = s.rating;
      el.where.textContent = `Line ${c.n} of 5 · ${c.where}`;
      if (!animateLine) { el.line.replaceChildren(lineNodes(s.text, id)); }
      el.line.classList.toggle('is-removed', s.decision === 'removed');
      el.rating.replaceChildren(chip(s.rating));
      el.why.textContent = s.decision === 'used' ? `Rewritten from your suggestion. ${c.why}` : c.why;
      if (c.quote) { el.quote.hidden = false; el.quote.textContent = c.quote; } else { el.quote.hidden = true; }
      el.src.textContent = c.src;
      const hasSugg = !!c.sugg && !s.decision;
      el.suggRow.classList.toggle('is-empty', !hasSugg);
      el.sugg.textContent = hasSugg ? c.sugg : s.decision ? 'Done. See the note below.' : 'No change suggested.';

      el.use.hidden = false; el.keep.hidden = false;
      el.keep.removeAttribute('aria-disabled');
      el.use.textContent = 'Use suggestion'; el.keep.textContent = 'Keep mine';
      if (s.decision) {
        el.use.hidden = true;
        el.keep.textContent = 'Undo';
        el.note.textContent = s.decision === 'used' ? 'Suggestion used. The line now matches your evidence.'
          : s.decision === 'kept' ? 'Kept as written. Plainhand noted where you drew the line.'
          : 'Removed. It will not appear in any application.';
      } else if (s.rating === 'balanced') {
        el.use.hidden = true; el.keep.hidden = true;
        el.note.textContent = 'Balanced. Nothing to decide on this line.';
      } else if (s.rating === 'unsupported') {
        el.use.textContent = 'Remove line';
        el.keep.setAttribute('aria-disabled', 'true');
        el.note.textContent = "Plainhand doesn't use anything you can't back up, so this line can only be removed.";
      } else {
        el.note.textContent = 'Choose one. Either way, Plainhand notes where you drew the line.';
      }
    }
    function select(i, focus = false) {
      sel = ids[i];
      markTabs(tabs, i);
      if (focus) tabs[i].focus();
      renderPanel(sel);
    }
    tablist($('.claims'), tabs, i => select(i), { vertical: true });

    function rewrite(id, nextText) {
      const oldWords = new Set(state[id].text.toLowerCase().split(/\s+/));
      if (reduced) { el.line.replaceChildren(lineNodes(nextText, id)); return; }
      $$('.w', el.line).forEach((w, i) => { w.classList.add('w-out'); w.style.setProperty('--d', String(i)); });
      busy++;
      setTimeout(() => {
        busy--;
        if (sel !== id) return;
        el.line.replaceChildren(lineNodes(nextText, id, 'w-in'));
        $$('.w', el.line).forEach(w => { if (!oldWords.has(w.textContent.toLowerCase())) w.classList.add('w-new'); });
      }, 380);
    }

    el.use.addEventListener('click', () => {
      const id = sel, c = CLAIMS[id], s = state[id];
      if (s.decision || !c.sugg) return;
      if (s.rating === 'unsupported') {
        s.decision = 'removed'; s.rating = 'removed';
        renderTab(id); renderPanel(id);
        announce(`Line removed. Unsupported lines are never used. ${tallySentence()}`);
        return;
      }
      s.decision = 'used'; s.rating = 'balanced';
      rewrite(id, c.sugg);
      s.text = c.sugg;
      learned.push(`${id}:used`);
      renderTab(id); renderPanel(id, { animateLine: true }); renderLearned(`${id}:used`);
      el.keep.focus();
      announce(`Suggestion used. The line now reads: ${c.sugg} Rated balanced. ${tallySentence()}`);
    });
    el.keep.addEventListener('click', () => {
      const id = sel, c = CLAIMS[id], s = state[id];
      if (el.keep.getAttribute('aria-disabled') === 'true') {
        el.note.textContent = "Keep mine is off for this line. If it's true, tell Plainhand about it in your story first, so there's a source to trace it to.";
        el.keep.classList.remove('lock', 'is-tried'); void el.keep.offsetWidth; el.keep.classList.add('lock', 'is-tried');
        setTimeout(() => el.keep.classList.remove('lock', 'is-tried'), 500);
        announce(el.note.textContent);
        return;
      }
      if (s.decision) { // Undo
        const was = s.decision;
        learned = learned.filter(k => k !== `${id}:${was}`);
        const prevText = s.text;
        s.decision = null; s.rating = c.rating;
        if (was === 'used') { const oldWords = new Set(prevText.toLowerCase().split(/\s+/)); s.text = c.text; if (!reduced) { el.line.replaceChildren(lineNodes(c.text, id, 'w-in')); $$('.w', el.line).forEach(w => { if (!oldWords.has(w.textContent.toLowerCase())) w.classList.add('w-new'); }); } }
        renderTab(id); renderPanel(id, { animateLine: was === 'used' && !reduced }); renderLearned();
        (el.use.hidden ? el.keep : el.use).focus();
        announce(`Undone. The line is ${LABEL[c.rating].toLowerCase()} again. ${tallySentence()}`);
        return;
      }
      if (!c.sugg) return;
      s.decision = 'kept';
      learned.push(`${id}:kept`);
      renderTab(id); renderPanel(id); renderLearned(`${id}:kept`);
      el.keep.focus();
      announce(`Kept as written. Still rated ${LABEL[s.rating].toLowerCase()}. ${tallySentence()}`);
    });
    // Keep the tally in step with every render path.
    const origRenderTab = renderTab;
    renderTab = id => { origRenderTab(id); renderTally(); }; // eslint-disable-line no-func-assign

    $('#cal-reset').addEventListener('click', () => {
      state = fresh(); learned = [];
      ids.forEach(renderTab); renderLearned(); select(0);
      announce('Demo reset. All five lines are back to their first ratings.');
    });

    // Locked facts
    const LOCKS = {
      titles: 'A job title appears exactly as your sources state it, even when the line around it is reworded.',
      employers: 'Employer names are copied from your resume as written.',
      dates: 'Dates stay exact. Class of 2027 stays 2027 wherever it appears.',
      degrees: 'Degrees appear as your resume has them. "B.S. Mechanical Engineering, Example University, 2027" stays exactly that.',
    };
    const locks = $$('.lock[data-lock]'), note = $('#lock-note');
    locks.forEach(b => b.addEventListener('click', () => {
      locks.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      note.textContent = `Locked. ${LOCKS[b.dataset.lock]}`;
      b.classList.remove('is-tried'); void b.offsetWidth; b.classList.add('is-tried');
      if (sel === 'c2' && (b.dataset.lock === 'degrees' || b.dataset.lock === 'dates')) $$('.lockword', el.line).forEach(w => w.animate?.([{ boxShadow: 'inset 0 -2px 0 transparent, 0 0 0 3px rgb(169 209 138 / .9)' }, { boxShadow: 'inset 0 -2px 0 transparent, 0 0 0 0 transparent' }], { duration: reduced ? 1 : 900, easing: EASE }));
    }));

    ids.forEach(renderTab);
    renderPanel('c1');
  })();

  /* ---------- How it works: route switch and stepper ---------- */
  (() => {
    const how = $('#how'), stepper = $('#stepper');
    const tabs = $$('.step-tab'), steps = $$('.step');
    const prev = $('#step-prev'), next = $('#step-next'), count = $('#step-count'), fill = $('#step-fill');
    const rail = $('.step-rail');
    let cur = -1;
    const title = i => [...tabs[i].querySelectorAll('.step-t > span, .step-t')].map(n => n.offsetParent !== null || n.children.length === 0 ? n : null).filter(Boolean).pop()?.textContent.trim() || tabs[i].textContent.trim();
    function go(i, { focusTab = false, say = true } = {}) {
      i = clamp(i, 0, steps.length - 1);
      const changed = i !== cur;
      cur = i;
      markTabs(tabs, i);
      tabs.forEach((t, k) => t.classList.toggle('is-done', k < i));
      steps.forEach((s, k) => { s.hidden = k !== i; });
      if (changed && !reduced) { steps[i].classList.remove('is-entering'); void steps[i].offsetWidth; steps[i].classList.add('is-entering'); }
      rail.style.setProperty('--prog', String(i / (steps.length - 1)));
      fill.style.setProperty('--prog', String((i + 1) / steps.length));
      count.textContent = `Step ${i + 1} of ${steps.length}`;
      const atStart = i === 0, atEnd = i === steps.length - 1;
      if (atStart && document.activeElement === prev) next.focus();
      prev.disabled = atStart;
      next.firstChild.textContent = atEnd ? 'Start over' : 'Next';
      if (focusTab) tabs[i].focus();
      if (say && changed) announce(`Step ${i + 1} of ${steps.length}: ${title(i)}`);
    }
    tablist(rail, tabs, i => go(i), { vertical: true });
    prev.addEventListener('click', () => go(cur - 1));
    next.addEventListener('click', () => go(cur === steps.length - 1 ? 0 : cur + 1));
    $('.step-stage').addEventListener('keydown', e => {
      if (e.target.closest('input, .os-tabs, [role="tablist"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
    });
    stepper.addEventListener('focusin', () => {}, { passive: true });
    go(0, { say: false });

    // Route switch (CSS :has() swaps the copy; this keeps state and announces it)
    const radios = $$('input[name="route"]');
    function setRoute(value, say = true) {
      how.dataset.route = value;
      if (!reduced) { const s = steps[cur]; s.classList.remove('is-entering'); void s.offsetWidth; s.classList.add('is-entering'); }
      if (say) announce(value === 'local' ? 'Showing the steps for your own computer, with the install command below the steps.' : 'Showing the steps for the website.');
    }
    radios.forEach(r => r.addEventListener('change', () => { if (r.checked) setRoute(r.value); }));
    $$('[data-route-link]').forEach(a => a.addEventListener('click', () => {
      const r = radios.find(x => x.value === a.dataset.routeLink);
      if (r && !r.checked) { r.checked = true; setRoute(r.value, false); }
      go(0, { say: false });
      announce('Showing the steps for your own computer. The install command is below the steps.');
    }));

    // OS tabs, with a guess from the visitor's platform
    const osTabs = $$('.os-tab'), osPanels = ['os-unix', 'os-win'].map(id => document.getElementById(id));
    function os(i) { markTabs(osTabs, i); osPanels.forEach((p, k) => { p.hidden = k !== i; }); }
    tablist($('.os-tabs'), osTabs, i => os(i));
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    os(/win/i.test(platform) ? 1 : 0);

    // Copy with feedback and fallbacks
    const status = $('#copy-status');
    async function copyText(text) {
      try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr';
        document.body.append(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
    $$('.copy-btn').forEach(btn => btn.addEventListener('click', async () => {
      const code = document.getElementById(btn.dataset.copy);
      const ok = await copyText(code.textContent.trim());
      btn.focus();
      const label = btn.querySelector('.copy-t');
      if (ok) {
        btn.classList.add('is-copied'); label.textContent = 'Copied';
        status.textContent = 'Copied. Paste it into your terminal and press Enter.';
      } else {
        const range = document.createRange(); range.selectNodeContents(code);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        label.textContent = 'Selected';
        status.textContent = `Your browser blocked copying. The command is selected: press ${/mac/i.test(platform) ? 'Command' : 'Ctrl'}+C.`;
      }
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.classList.remove('is-copied'); label.textContent = 'Copy'; }, 2200);
    }));
  })();

  /* ---------- Fit, with evidence ---------- */
  (() => {
    const ROLES = {
      northstar: { co: 'Northstar Robotics', title: 'Mechanical Engineer, New Graduate · Boston, MA', score: 4.6, rec: 'apply', recT: 'Apply', match: 'Hands-on mechanical design and testing experience.', quote: 'Designed and tested a lightweight chassis for the Formula SAE team.', src: 'Your resume', gaps: ['Industry experience is not yet documented.'] },
      fieldwork: { co: 'Fieldwork Systems', title: 'Associate Product Design Engineer · Denver, CO', score: 4.4, rec: 'apply', recT: 'Apply', match: 'Design iteration grounded in physical testing.', quote: 'Designed and tested a lightweight chassis for the Formula SAE team.', src: 'Your resume', gaps: ['Consumer product experience is not yet documented.'] },
      tidewater: { co: 'Tidewater Instruments', title: 'Test Engineer I · Providence, RI', score: 4.3, rec: 'apply', recT: 'Apply', match: 'Physical test planning and analysis.', quote: STORY_Q(), src: 'Your story', gaps: [] },
      arcwell: { co: 'Arcwell Energy', title: 'Graduate Manufacturing Engineer · Austin, TX', score: 3.7, rec: 'investigate', recT: 'Investigate', match: 'Experience building and testing a physical system.', quote: 'Designed and tested a lightweight chassis for the Formula SAE team.', src: 'Your resume', gaps: ['Production-line experience is not documented.'], q: 'Have you worked with production tooling?' },
      lumen: { co: 'Lumen Aerospace', title: 'Structures Engineer, Early Career · Seattle, WA', score: null, rec: 'new', recT: 'Not scored yet', match: 'Saved to your inbox. Before the AI reads it, Plainhand checks that the posting is still live.', quote: '', src: '', gaps: [] },
    };
    function STORY_Q() { return 'I owned the design and ran the physical tests with two teammates.'; }
    const tabs = $$('.fit-role'), panel = $('#fit-panel');
    const big = $('#fit-big-num'), of = $('#fit-big-of'), bigWrap = $('.fit-big');
    let anim = 0;
    function countTo(v) {
      cancelAnimationFrame(anim);
      if (v === null) { big.textContent = 'New'; of.textContent = ''; bigWrap.classList.add('is-empty'); return; }
      bigWrap.classList.remove('is-empty'); of.textContent = '/5';
      if (reduced) { big.textContent = v.toFixed(1); return; }
      const from = parseFloat(big.textContent) || 0, t0 = performance.now(), dur = 520;
      const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); big.textContent = (from + (v - from) * e).toFixed(1); if (k < 1) anim = requestAnimationFrame(step); };
      anim = requestAnimationFrame(step);
    }
    function show(i) {
      const key = tabs[i].dataset.role, r = ROLES[key];
      markTabs(tabs, i);
      panel.setAttribute('aria-labelledby', tabs[i].id);
      countTo(r.score);
      $('#fit-panel-co').textContent = r.co;
      $('#fit-panel-title').textContent = r.title;
      const rec = $('#fit-rec'); rec.dataset.rec = r.rec; rec.textContent = r.recT;
      $('#fit-match').textContent = r.match;
      const q = $('#fit-quote'), qs = $('#fit-quote-src');
      q.hidden = !r.quote; qs.hidden = !r.quote; q.textContent = r.quote; qs.textContent = r.src;
      const gaps = $('#fit-gaps'); gaps.replaceChildren();
      const add = (text, cls) => { const li = document.createElement('li'); li.textContent = text; if (cls) li.className = cls; gaps.append(li); };
      r.gaps.forEach(g => add(g));
      if (r.q) add(r.q, 'q');
      if (!r.gaps.length && !r.q) add(r.score === null ? 'Nothing to show until it is scored.' : 'No gaps flagged for this role.', 'none');
      if (!reduced) { panel.classList.remove('is-swapping'); void panel.offsetWidth; panel.classList.add('is-swapping'); }
      announce(r.score === null ? `${r.co}: not scored yet.` : `${r.co}: fit ${r.score} out of 5, ${r.recT}.`);
    }
    tablist($('.fit-list'), tabs, i => show(i), { vertical: true });
  })();

  /* ---------- Format and humanizer toggles ---------- */
  (() => {
    const fmt = $('#fmt'), fmtBtns = $$('[data-view]').filter(b => b.classList.contains('seg-btn'));
    fmtBtns.forEach(b => b.addEventListener('click', () => {
      fmtBtns.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      fmt.dataset.view = b.dataset.view;
    }));
    const hz = $('#hz'), hzBtns = $$('[data-hz]').filter(b => b.classList.contains('seg-btn'));
    hzBtns.forEach(b => b.addEventListener('click', () => {
      hzBtns.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      hz.dataset.hz = b.dataset.hz;
    }));
  })();

  /* ---------- Job sites: search and filter, with FLIP ---------- */
  (() => {
    const input = $('#site-q'), items = $$('.site'), filters = $$('.filter');
    const count = $('#sites-count'), empty = $('#sites-empty');
    const names = new Map(items.map(li => [li, li.querySelector('.site-name').textContent]));
    const kindLabel = { fill: 'that fill the form', signin: 'that stop at sign-in', link: 'never opened' };
    let kind = 'all';
    function paintName(li, term) {
      const nameEl = li.querySelector('.site-name'), name = names.get(li);
      const i = term ? name.toLowerCase().indexOf(term) : -1;
      if (i < 0) { nameEl.textContent = name; return; }
      const m = document.createElement('mark'); m.textContent = name.slice(i, i + term.length);
      nameEl.replaceChildren(name.slice(0, i), m, name.slice(i + term.length));
    }
    function apply() {
      const term = input.value.trim().toLowerCase();
      const first = new Map(items.map(li => [li, li.hidden ? null : li.getBoundingClientRect()]));
      let shown = 0;
      items.forEach(li => {
        const hay = `${names.get(li)} ${li.dataset.keys}`.toLowerCase();
        const ok = (kind === 'all' || li.dataset.kind === kind) && (!term || hay.includes(term));
        li.hidden = !ok;
        if (ok) shown++;
        paintName(li, term);
      });
      if (!reduced) items.forEach(li => {
        if (li.hidden) return;
        const f = first.get(li), l = li.getBoundingClientRect();
        if (!f) { li.animate([{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE }); return; }
        const dx = f.left - l.left, dy = f.top - l.top;
        if (dx || dy) li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
      });
      const raw = input.value.trim();
      count.textContent = shown === items.length ? `Showing all ${items.length}` : `Showing ${shown} of ${items.length}${kind !== 'all' ? `, ${kindLabel[kind]}` : ''}${raw ? `, matching "${raw}"` : ''}`;
      empty.hidden = shown > 0;
      if (!shown) empty.textContent = raw
        ? `No site matches "${raw}" here. If an application moves to a site Plainhand doesn't support, it says so and you finish by hand.`
        : 'No sites in this group.';
    }
    input.addEventListener('input', apply);
    input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } });
    filters.forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.filter;
      filters.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      apply();
    }));
  })();

  /* ---------- Control: what the AI sees ---------- */
  (() => {
    const NEEDS = { fit: ['resume', 'story', 'prefs'], letter: ['resume', 'story', 'voice', 'packet'], form: ['packet', 'resume', 'prefs'] };
    const FIXED = {
      fit: ['Job posting', 'Northstar Robotics, checked live before reading'],
      letter: ['Job posting', 'Northstar Robotics, Mechanical Engineer, New Graduate'],
      form: ['Application form', 'Northstar Robotics, on Greenhouse'],
    };
    const NAMES = { resume: 'Resume', story: 'Your story', voice: 'Writing samples', packet: 'Approved application', prefs: 'Preferences' };
    const on = { resume: true, story: true, voice: true, packet: true, prefs: true };
    let task = 'fit';
    const list = $('#slips'), count = $('#ctl-count');
    const slips = Object.fromEntries($$('.slip', list).map(s => [s.dataset.slip, s]));
    const order = ['resume', 'story', 'voice', 'packet', 'prefs'];
    function render(changed) {
      const first = new Map(Object.values(slips).map(s => [s, s.getBoundingClientRect()]));
      const need = NEEDS[task];
      const [fName, fText] = FIXED[task];
      slips.posting.querySelector('.slip-name').textContent = fName;
      slips.posting.querySelector('.slip-x').textContent = fText;
      const rank = { sent: 0, idle: 1, off: 2 };
      const states = {};
      order.forEach(k => {
        const st = !on[k] ? 'off' : need.includes(k) ? 'sent' : 'idle';
        states[k] = st;
        slips[k].dataset.state = st;
        slips[k].querySelector('.slip-state').textContent = st === 'sent' ? 'Sent' : st === 'off' ? 'Off, never sent' : 'Not needed for this task';
      });
      const sorted = order.slice().sort((a, b) => rank[states[a]] - rank[states[b]] || need.indexOf(a) - need.indexOf(b) || order.indexOf(a) - order.indexOf(b));
      list.append(slips.posting, ...sorted.map(k => slips[k]));
      if (!reduced) Object.values(slips).forEach(s => {
        const f = first.get(s), l = s.getBoundingClientRect();
        const dy = f.top - l.top;
        if (dy) s.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 460, easing: EASE });
      });
      if (changed && slips[changed] && !reduced) { slips[changed].classList.remove('flash'); void slips[changed].offsetWidth; slips[changed].classList.add('flash'); }
      const sent = order.filter(k => states[k] === 'sent').length;
      const offNeeded = need.filter(k => !on[k]).length;
      count.textContent = `The ${fName.toLowerCase()} and ${sent} of your 5 sources${offNeeded ? ` (${offNeeded} switched off by you)` : ''}`;
    }
    $$('input[name="task"]').forEach(r => r.addEventListener('change', () => { if (r.checked) { task = r.value; render(); } }));
    $$('.switch[data-src]').forEach(sw => sw.addEventListener('click', () => {
      const k = sw.dataset.src;
      on[k] = !on[k];
      sw.setAttribute('aria-checked', String(on[k]));
      render(k);
      announce(`${NAMES[k]} ${on[k] ? 'on' : 'off'}. ${count.textContent}.`);
    }));
    render();
  })();

  /* ---------- FAQ: open or close all ---------- */
  (() => {
    const btn = $('#faq-toggle'), items = $$('.qa');
    const sync = () => { btn.textContent = items.every(d => d.open) ? 'Close all answers' : 'Open all answers'; };
    btn.addEventListener('click', () => { const open = !items.every(d => d.open); items.forEach(d => { d.open = open; }); sync(); });
    items.forEach(d => d.addEventListener('toggle', sync));
  })();

  /* ---------- CTA spotlight follows the pointer ---------- */
  (() => {
    const card = $('#cta-card');
    let raf = 0, px = 70, py = 30;
    card.addEventListener('pointermove', e => {
      if (reduced || e.pointerType === 'touch') return;
      const r = card.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width) * 100; py = ((e.clientY - r.top) / r.height) * 100;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; card.style.setProperty('--x', `${px.toFixed(1)}%`); card.style.setProperty('--y', `${py.toFixed(1)}%`); });
    });
  })();
});
