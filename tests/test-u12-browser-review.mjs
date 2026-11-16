// U12 browser review: the main screens in light, dark and a 390 px mobile viewport.
// For every page it checks horizontal overflow, keyboard reach with a visible focus
// indicator, and console errors; it also checks that the form-review page shows where
// each filled field came from. Screenshots go to output/u12-browser (gitignored).
//
//   node tests/test-u12-browser-review.mjs
//
// Fixtures only: a scripted agent, a local synthetic employer page and a temporary
// workspace. No provider, network or employer is contacted.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPlainhand } from '../plainhand-server.mjs';
import { Workspace } from '../plainhand/store.mjs';
import { AnswerBank } from '../plainhand/answer-bank.mjs';
import { Corrections } from '../plainhand/corrections.mjs';
import { candidate, fixtureAgent, fixtureProviders } from '../plainhand/test-fixtures.mjs';
import { fixtureApplicationBrowser } from '../plainhand/test-browser-fixture.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = process.env.PLAINHAND_U12_SHOTS || path.join(HERE, '..', 'output', 'u12-browser');
const VIEWPORTS = [
  { id: 'light-desktop', width: 1440, height: 1000, theme: 'light' },
  { id: 'dark-desktop', width: 1440, height: 1000, theme: 'dark' },
  { id: 'light-mobile', width: 390, height: 844, theme: 'light' },
];
// The navigation screens, in the order a person meets them.
const PAGES = ['home', 'jobs', 'campaigns', 'applications', 'insights', 'profile', 'activity', 'usage', 'connections', 'workspace'];
const INTERACTIVE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

const root = await mkdtemp(path.join(tmpdir(), 'plainhand-u12-browser-'));
await mkdir(SHOTS, { recursive: true });
console.log(`Browser evidence: ${SHOTS}`);

const ats = fixtureApplicationBrowser({ gated: true });
const app = await createPlainhand({ root, providers: fixtureProviders, browser: ats.application, workflowOptions: {
  agent: fixtureAgent,
  verifier: async () => ({ state: 'active', legitimacy: 'official-ats-unconfirmed-employer', description: 'Graduate engineering design and testing role. '.repeat(15), checkedAt: new Date().toISOString(), reason: 'Synthetic test browser snapshot.' }),
  scanner: async () => [],
} });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const call = async (endpoint, input) => {
  const response = await fetch(`${base}/api/${endpoint}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Plainhand-Token': app.token, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  return { status: response.status, data: await response.json() };
};
const ui = (name, input) => app.registry.run(name, input);

const defects = [];
const fail = (viewport, where, kind, detail) => defects.push({ viewport, where, kind, detail });

try {
  // ── Seed a workspace with something on every screen ───────────────────────
  let state = await app.workspace.load();
  await app.workspace.saveProfile({ ...state.profile, ...candidate }, state.revision);
  await app.workspace.mutate(mutate => { mutate.provider = 'codex'; });
  const seed = async (company, title, url) => (await ui('jobs.add', { company, title, url })).result.id;
  const jobId = await seed('Acme Robotics', 'Graduate Engineer', 'https://jobs.lever.co/test/123');
  const submittedId = await seed('Northwind Labs', 'Hardware Engineer', 'https://jobs.lever.co/test/456');
  // Role answers are the candidate's own words and so part of the profile context:
  // set them before evaluating, or the evaluation and packet go stale.
  await ui('jobs.setContext', { jobId: submittedId, roleAnswers: 'I would like to work on hardware that ships to real users.' });
  for (const id of [jobId, submittedId]) { await ui('tasks.evaluate', { jobId: id }); await app.workflow.queue; }
  await ui('record.setNextAction', { jobId: submittedId, text: 'Send references to the recruiter', due: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
  await ui('record.addContact', { jobId: submittedId, name: 'Dana Lee', role: 'University recruiter', type: 'recruiter', email: 'dana@example.invalid' });
  await ui('record.addInterview', { jobId: submittedId, stage: 'Recruiter screen', date: new Date().toISOString().slice(0, 10), status: 'scheduled', interviewer: 'Dana Lee' });
  await ui('jobs.confirmSubmitted', { jobId: submittedId });
  await ui('jobs.select', { jobId, selected: true });
  await ui('tasks.prepare', { jobId }); await app.workflow.queue;
  await ui('packet.approve', { jobId });
  await ui('campaigns.create', { name: 'Graduate hardware', terms: ['engineer'], locations: [], exclusions: [], dailyEvaluationLimit: 0 }).catch(() => null);
  await ui('inbox.add', { from: 'Dana Lee <dana@northwind.invalid>', subject: 'Interview next week', date: new Date().toISOString().slice(0, 10), body: 'Hello, we would like to invite you to an interview for the Hardware Engineer role at Northwind Labs next Tuesday.' }).catch(() => null);
  await new AnswerBank(new Workspace(root)).add({ question: 'Describe a hands-on project', answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis' }], status: 'needs-review', verifiedAt: null, needsReview: true });
  await new Corrections(new Workspace(root)).save([{ id: 'correction-1', jobId: submittedId, question: 'Describe a hands-on project', previous: null, answer: 'I designed and tested a lightweight chassis.', evidence: [{ sourceId: 'cv', quote: 'Designed and tested a lightweight chassis' }], scope: 'global', status: 'proposed', proposedAt: new Date().toISOString() }]);

  // A real form checkpoint: inspect and fill the synthetic employer page once, so the
  // Apply tab shows the field provenance a candidate reads before submitting.
  const inspected = await call('browser/open', { id: jobId });
  assert.equal(inspected.status, 200, JSON.stringify(inspected.data));
  const filled = await call('browser/autofill', { id: jobId });
  assert.equal(filled.status, 200, JSON.stringify(filled.data));
  const checkpoint = (await app.workspace.load()).jobs.find(job => job.id === jobId).browserCheckpoint;
  assert.ok(checkpoint?.check?.items?.length, `autofill should save a form checkpoint: ${JSON.stringify(filled.data).slice(0, 600)}`);
  const provenanceSources = checkpoint.check.items.filter(item => item.status === 'filled' && item.source).map(item => item.source);
  assert.ok(provenanceSources.length, 'the filled form records where each answer came from');

  // ── Checks ────────────────────────────────────────────────────────────────
  // Clipped by an ancestor that owns the scrolling counts as contained, not overflowing.
  const overflow = page => page.evaluate(() => {
    const width = window.innerWidth;
    const clipped = element => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX) && parent.clientWidth > 0) return true;
        if (style.position === 'fixed') return false;
      }
      return false;
    };
    const offenders = [];
    for (const element of document.querySelectorAll('main *, body > .app > *')) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      if (clipped(element)) continue;
      if (getComputedStyle(element).position === 'absolute' && rect.top + window.scrollY < 0) continue;
      offenders.push(`${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className && typeof element.className === 'string' ? '.' + element.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''} right=${Math.round(rect.right)} left=${Math.round(rect.left)}`);
      if (offenders.length >= 6) break;
    }
    return { page: document.documentElement.scrollWidth - width, offenders };
  });

  // Every visible control must be reachable by Tab and show focus: outline or box-shadow,
  // on the control or the wrapper that paints its focus ring (file inputs use :has()).
  // An open sheet is a modal dialog: its focus trap is the contract, so the walk stays
  // inside it and the background controls are out of scope until it closes.
  const keyboard = async page => {
    // Focus the document itself so Chromium's sequential-focus starting point is the
    // top of the page. Blurring alone keeps the last panel heading as that point.
    const openedInDialog = await page.evaluate(selector => {
      const dialog = document.querySelector('[aria-modal="true"]');
      if (!dialog) {
        document.documentElement.setAttribute('tabindex', '-1');
        document.documentElement.focus();
        document.documentElement.removeAttribute('tabindex');
        window.scrollTo(0, 0);
        return false;
      }
      // The trap's order starts after whatever is focused. Focus the first control in
      // the dialog and count it, then continue with Tab; the trap keeps the walk inside.
      const first = [...dialog.querySelectorAll(selector)].find(element => element.tabIndex >= 0 && (element.checkVisibility
        ? element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })
        : element.offsetParent !== null));
      first?.focus();
      window.scrollTo(0, 0);
      return true;
    }, 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])');
    await page.waitForTimeout(120);
    const scope = openedInDialog;
    const expectedElements = await page.evaluate(`(() => {
      const selector = ${JSON.stringify('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')};
      const root = document.querySelector('[aria-modal="true"]') || document;
      const all = [...document.querySelectorAll('*')];
      // checkVisibility also excludes a closed <details>, whose children keep an
      // offsetParent but are skipped by Tab.
      // tabIndex < 0 is deliberate: inactive ARIA tabs are arrow-key reachable, and a
      // roving tabindex is the pattern, not a missing control.
      return [...root.querySelectorAll(selector)].filter(element => element.tabIndex >= 0 && (element.checkVisibility
        ? element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })
        : element.offsetParent !== null)).map(element => ({
          key: all.indexOf(element) + ':' + element.tagName,
          label: element.tagName.toLowerCase() + ' "' + (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 40) + '"',
        }));
    })()`);
    const expected = expectedElements.length;
    const seen = new Map();
    let previous = null, stuck = 0, escaped = false;
    const indicator = () => {
      const element = document.activeElement;
      if (!element || element === document.body || element === document.documentElement) return null;
      const all = [...document.querySelectorAll('*')];
      const index = all.indexOf(element);
      const label = `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''} "${(element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 50)}"`;
      const shows = style => (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      const self = shows(getComputedStyle(element));
      const wrapper = element.parentElement ? shows(getComputedStyle(element.parentElement)) : false;
      const modal = element.closest('[aria-modal="true"]');
      return { key: `${index}:${element.tagName}`, label, indicator: self || wrapper, inModal: Boolean(modal) };
    };
    let firstKey = null;
    if (scope) {
      const first = await page.evaluate(indicator);
      if (first) { seen.set(first.key, first); firstKey = first.key; }
    }
    // Walk until the document ends (non-modal) or the first control comes round again
    // (a trapped dialog); a stuck count only guards against a focus loop.
    // A date input keeps focus across its day/month/year segments, so repeated keys are
    // expected; only a long repeat means focus is genuinely stuck.
    for (let i = 0; i < Math.min(expected + 40, 300); i++) {
      await page.keyboard.press('Tab');
      const found = await page.evaluate(indicator);
      if (!found) break;
      if (scope && !found.inModal) { escaped = true; break; }
      if (firstKey && found.key === firstKey && seen.size > 3) break;
      if (!firstKey) firstKey = found.key;
      if (found.key === previous) { stuck += 1; if (stuck > 8) break; } else stuck = 0;
      previous = found.key;
      if (!seen.has(found.key)) seen.set(found.key, found);
    }
    const missing = [...seen.values()].filter(item => !item.indicator).map(item => item.label);
    const unreached = expectedElements.filter(item => !seen.has(item.key)).map(item => item.label);
    return { expected, reached: seen.size, missing, unreached, escaped, seen: [...seen.values()].map(item => item.label) };
  };

  const settle = async page => {
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The role panel moves focus to its heading when it opens. Start the keyboard walk
    // after that, or the walk begins mid-panel.
    await page.waitForFunction(() => !document.querySelector('.job-panel') || document.activeElement?.classList?.contains('panel-title'), null, { timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(180);
  };

  const browser = await chromium.launch({ headless: true });
  const review = async (page, viewport, where, { expectProvenance = false } = {}) => {
    await settle(page);
    const layout = await overflow(page);
    if (layout.page > 1) fail(viewport.id, where, 'overflow', `document scrolls ${layout.page}px past the ${viewport.width}px viewport`);
    for (const offender of layout.offenders) fail(viewport.id, where, 'overflow-element', offender);
    const keys = await keyboard(page);
    if (keys.missing.length) fail(viewport.id, where, 'focus-indicator', keys.missing.join(' · '));
    if (keys.reached < keys.expected) fail(viewport.id, where, 'tab-reach', `${keys.reached} of ${keys.expected} visible controls reached; unreached: ${keys.unreached.slice(0, 6).join(', ')}; seen: ${keys.seen.slice(0, 8).join(', ')}`);
    if (keys.escaped) fail(viewport.id, where, 'focus-trap', 'Tab left the open dialog');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, `${viewport.id}-${where.replace(/[^\w-]+/g, '_')}.png`), fullPage: true });
    if (expectProvenance) {
      const details = page.locator('section[aria-labelledby="ap-check"] details.cal-within').first();
      await details.locator('summary').click();
      const text = await details.textContent();
      if (!/filled by Plainhand/.test(await details.locator('summary').textContent())) fail(viewport.id, where, 'provenance', 'the filled-field details summary does not name Plainhand');
      if (!/from \S/.test(text)) fail(viewport.id, where, 'provenance', 'no "from <source>" text on a filled field');
      for (const source of provenanceSources.slice(0, 3)) if (!text.includes(source)) fail(viewport.id, where, 'provenance', `source "${source}" is missing on the page`);
    }
  };

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.addInitScript(theme => { try { localStorage.setItem('plainhand.theme', theme); } catch {} }, viewport.theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    const mark = () => errors.length;
    for (const view of PAGES) {
      const start = mark();
      await page.goto(`${base}/#${view}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main h1, main h2', { timeout: 20000 });
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      if (theme !== viewport.theme) fail(viewport.id, view, 'theme', `expected ${viewport.theme}, rendered ${theme}`);
      await review(page, viewport, view);
      if (errors.length > start) fail(viewport.id, view, 'console', errors.slice(start).join(' · '));
    }
    // The mobile navigation is a sheet: open it and audit its links too.
    if (viewport.width < 900) {
      const start = mark();
      await page.goto(`${base}/#home`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main h1, main h2');
      const toggle = page.locator('#nav-toggle,[aria-controls="nav"],button[aria-label*="menu" i]').first();
      if (await toggle.count()) {
        await toggle.click();
        await settle(page);
        await review(page, viewport, 'mobile-navigation');
      }
      if (errors.length > start) fail(viewport.id, 'mobile-navigation', 'console', errors.slice(start).join(' · '));
    }
    // The Apply tab after a real fill: the form review and its field provenance.
    {
      const start = mark();
      await page.goto(`${base}/?job=${jobId}&tab=apply#applications`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'Apply', exact: true }).waitFor({ timeout: 20000 });
      const opened = await page.getByRole('tab', { name: 'Apply', exact: true }).getAttribute('aria-selected');
      if (opened !== 'true') fail(viewport.id, 'apply', 'deep-link', 'the agent link did not open the Apply tab');
      await page.getByRole('heading', { name: 'Before you submit', exact: true }).waitFor({ timeout: 20000 });
      await review(page, viewport, 'apply-form-review', { expectProvenance: true });
      if (errors.length > start) fail(viewport.id, 'apply', 'console', errors.slice(start).join(' · '));
    }
    // The packet and record tabs render too; the record tab carries the next action.
    {
      const start = mark();
      await page.goto(`${base}/?job=${submittedId}&tab=record#applications`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Timeline', exact: true }).waitFor({ timeout: 20000 });
      await review(page, viewport, 'record');
      if (errors.length > start) fail(viewport.id, 'record', 'console', errors.slice(start).join(' · '));
    }
    await context.close();
  }
  await browser.close();

  await writeFile(path.join(SHOTS, 'defects.json'), JSON.stringify({ at: new Date().toISOString(), defects }, null, 2));
  if (defects.length) {
    console.error(`\n${defects.length} defect(s):`);
    for (const defect of defects) console.error(`- [${defect.viewport}] ${defect.where} · ${defect.kind}: ${defect.detail}`);
  } else console.log('No layout, focus, console or provenance defects found.');
  assert.deepEqual(defects, [], `${defects.length} browser defects (see output/u12-browser/defects.json)`);
} finally {
  await app.close();
  await rm(root, { recursive: true, force: true });
}
