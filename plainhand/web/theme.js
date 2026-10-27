// Runs before styles load so a saved dark preference never flashes a light page.
(() => {
  const key = 'plainhand.theme';
  const allowed = new Set(['light', 'dark', 'system']);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { const saved = localStorage.getItem(key); if (allowed.has(saved)) preference = saved; } catch {}
  let ready = false;
  function apply() {
    // Switch colours instantly: no component transitions mid-change.
    if (ready) { document.documentElement.classList.add('theme-changing'); requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('theme-changing'))); }
    ready = true;
    const theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0e1511' : '#f5f6f1';
    window.dispatchEvent(new CustomEvent('plainhand:theme', { detail: { theme, preference } }));
  }
  window.plainhandTheme = {
    get preference() { return preference; },
    get resolved() { return document.documentElement.dataset.theme; },
    set(value) { if (!allowed.has(value)) return; preference = value; try { localStorage.setItem(key, value); } catch {} apply(); },
  };
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = allowed.has(event.newValue) ? event.newValue : 'system';
    apply();
  });
  apply();
})();
