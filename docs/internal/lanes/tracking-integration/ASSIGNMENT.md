# Lane assignment: tracking-integration (Gate 1 design)

Status: **design only, awaiting root Gate 1 approval.** Nothing below has been implemented, merged or run. This file is a proposal by the design sub-agent; it is not an acceptance record and nothing in it is self-accepted.

## 1. Exact base and branch

| Item | Value |
|---|---|
| Worktree | `/home/ak/.t3/worktrees/Plainhand/t3-ab261a42-466069d59d930d8a` |
| Lane branch | `t3/tracking-integration-design` (the implementation continues on this branch after approval) |
| Base HEAD (confirmed) | `e4da45fa2d21ce1f5945ce11662a73afda03b53f` |
| Integration source | `867c32956a38788a3099b045b19be450fcd16a86` (`t3/competitor-workflow-improvements`, one commit `867c329`, parent `fb39642`) |
| Merge base of the two | `fb396422d49e3f76f4fed5beb710397950ffa973` |
| Out of this lane | continuation `a46056fdc53a4159f5b30eae9b3de578efb3767d`: never merged or cherry-picked here |

Dry run read-only (`git merge-tree --write-tree HEAD 867c329`): clean, no conflicts. HEAD only added `docs/internal/*`, `ASSIGNMENT.md`, `EVIDENCE.json`, `GOAL-HANDOFF.md`, `RESULT.md`, `REVIEW.md` since the merge base. The tracking commit touches none of those paths. (That command writes tree objects to the object store only; no ref or worktree change.)

Environment at design time: `free -h` available 5.0Gi (>2GiB gate). No servers running by this agent.

## 2. Scope

### In scope (files this lane owns)

From the tracking commit (arrives by merge, content unchanged unless listed in §5):
`plainhand/exports.mjs`, `plainhand/web/ui/applications.mjs`, `plainhand/web/ui/core.mjs` (`downloadFile`), `plainhand/web/css/app.css` (board/people block), `plainhand-server.mjs` (two GET routes), `tests/test-exports.mjs`, `tests/test-plainhand-ui.mjs` (people/export/board block), `package.json` (adds `tests/test-exports.mjs` to `test:plainhand`), `CHANGELOG.md`, `docs/PLAINHAND-BROWSER-APP.md`, `docs/internal/COMPETITIVE-LANDSCAPE.md`.

Added by this lane (proposed):
- `plainhand/cloud/app.mjs`: two authenticated GET routes (finding 1).
- `plainhand/web/ui/tracker-rows.mjs` (new, ~25 lines, pure, no imports): single source for legacy tracker rows (finding 3 and de-duplication).
- `tests/test-cloud-app.mjs`: download route cases (finding 1).
- `docs/internal/lanes/tracking-integration/` (this file; later `RESULT.md` only if root asks).

### Out of scope

- Continuation `a46056f` and the five files it shares with tracking (not named here; root owns the reconciliation).
- Register, manifest, board, handoff, `GOAL-*`, `REVIEW.md`, `EVIDENCE.json` edits.
- `data/applications.md` ownership and format; `merge-tracker.mjs` and any tracker writer. The legacy tracker is read-only for the app.
- Any new status, any change to `templates/states.yml` or `STATUS_VALUES`.
- Push, main merge, network, accounts, models, deploy.

## 3. Source citations (what the design rests on)

Findings were re-verified against source, not taken only from the brief.

**Finding 1: hosted routes missing.**
- UI buttons: `applications.mjs` on `867c329` renders `Export CSV` and `Deadlines to calendar` when `!store.demo`; they call `downloadFile('applications.csv'|'calendar.ics', …)` (`core.mjs`), which fetches `/api/applications.csv` and `/api/calendar.ics` with header `X-Plainhand-Token`.
- Local routes exist only in `plainhand-server.mjs` (tracking commit, after `/api/export`).
- Hosted `plainhand/cloud/app.mjs`: `api()` GET block (`/api/connection-check`, `/state`, `/account`, `/events`, `/providers`, `/export`, `/artifact`) ends with `json(res, 404, 'Not found.')` at line 310 of HEAD. So both new paths hit 404 for a signed-in user, while the shared UI shows the buttons (store.state.cloud is true, store.demo is false).
- Auth chain for `/api/*` in cloud (`route()`): no session → 401 `Sign in to continue.` (line 490); session but `x-plainhand-token` (or `?token=` on GET) not equal to the per-session CSRF value → 403 (line 513-514); then `api(…, contextFor(session.userId))`, so a user's `workspace` is always theirs. Global headers set in `handler()`: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, CSP, `X-Frame-Options`, etc. Existing `/api/artifact` shows the `send(res, 200, data, {Content-Disposition, Content-Type})` pattern.
- `stateFor()` already reads the legacy tracker via `workspace.read('data/applications.md')`; the CSV route does the same read.
- Existing hosted test harness: `tests/test-cloud-app.mjs` (`start()`, `client().signIn()`, `c.api(path)`, `c.request(path)`; two-user precedent at the "one user can never read…" test), skipped unless `PLAINHAND_TEST_DATABASE_URL` is set (`tests/cloud-test-db.mjs`, creates and drops a `plainhand_test_<hex>` database).
- Local Postgres availability probed: no `postgres`/`initdb`/`pg_ctl` binaries on PATH or under `/usr/lib/postgresql`; no `pglite`/`embedded-postgres`; `docker` 29.9.3 with a reachable daemon and **images already cached locally: `postgres:17`, `postgres:17-alpine`**. The `postgres` npm client is present in the main checkout's `node_modules` (this worktree has no `node_modules`; `node_modules/` is gitignored).

**Finding 2: bare CR.** `exports.mjs` `cell()` normalizes `/\r?\n/g` only, so a lone `\r` survives; the quote test is `/[",\n]/` (no `\r`), so a bare CR is emitted unquoted as a raw record separator. Formula guard `/^[=+\-@\t\r]/` runs after the replace. Root probe `company: 'Safe\r=1+1'` therefore yields `Safe`, CR, `=1+1`: a second record starting with `=`. The same bug class exists in the ICS writer: `escapeText` also replaces only `/\r?\n/g`, so a lone CR inside SUMMARY/DESCRIPTION ends the content line and the remainder parses as a new property line. Same file, same fix, so it is included (flagged as an addition to the brief; see §8).

**Finding 3: legacy rows vanish in Board.** `ApplicationsPage` computes `legacy = legacyRows(state)` and counts them in the Tracker subtitle (`N from your existing tracker`), and the Table view renders them as `tr.legacy` rows. `Board` receives only `jobs` and iterates `STATUSES`, so legacy rows never appear while the subtitle still says they exist. Also in the table, legacy rows are **not** filtered by the search box (only `jobs` are), so count and visibility already disagree on search. `legacyRows` (UI) and `legacyTrackerRows` (`exports.mjs`) are two copies of one rule.

**Applied candidate-only.** `moveTo()` (drag) and `StatusSelect.change` (`jobpanel.mjs:316-323`, used inside every board card, so keyboard/select path) both route `Applied` to `openDialog({type:'confirm-submit'})` without writing. Server also refuses: `/api/jobs/update` throws unless `confirmSubmitted === true` (local `plainhand-server.mjs:305`, cloud `app.mjs:358`); registry `jobs.setStatus` raises `candidate_only` for `Applied` (`actions.mjs:411`). Tracking's UI test covers the drag path only; **the keyboard/select path on a board card has no test**. This lane adds one and changes no behaviour.

## 4. Invariants (must hold after the lane)

1. **Applied is candidate-only** for drag, board-card stage select (keyboard), table select, and API. No path writes `Applied` without `confirmSubmitted === true` through the confirmation dialog. No change to `moveTo`, `StatusSelect`, `STATUS_VALUES`.
2. **Canonical states only**: board columns remain `STATUSES` (`Evaluated, Apply, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP`). No new status, no free-text column.
3. **Exports are pure and read-only**: `exports.mjs` takes state and returns text. No filesystem, network, child process, model/provider call, workspace mutation, usage record, audit entry or revision bump on download.
4. **Hosted downloads are per-user**: bytes derive only from `contextFor(session.userId).workspace`. Unsigned → 401; wrong/missing page token → 403; no `?token=`-in-URL requirement added (UI keeps the header).
5. **Response hygiene** on both routes: exact `Content-Type`, exact attachment `filename`, `Cache-Control: no-store`, global nosniff/CSP/XFO headers intact (route must not override them).
6. **Legacy tracker stays read-only and owned by `applications.md`.** Legacy rows are never turned into jobs, never given a stage, never counted in board column counts, never writable from the board.
7. **Spreadsheet safety only gets stricter**: every existing formula-guard assertion still passes unchanged; no new path lets a cell begin a formula or contain a raw CR/LF.
8. **Counts equal what is on screen** in both views: subtitle legacy count == legacy rows rendered; search applies to both lists with one rule.
9. **CSP**: no inline script/style, no `eval`, no new origin. The new web module is a same-origin `.mjs` under `plainhand/web/ui/` (cloud `ASSET_TYPES` serves `.mjs`; `tests/test-web-modules.mjs` requires `.mjs` for import/export files).
10. **User data / privacy**: no export content logged; no new storage; the CSV/ICS contain only what the Applications page already shows (plus report path and posting URL, as in tracking).

## 5. Proposed implementation

Order is deliberate: merge first (clean), then small fix commits so each finding is reviewable alone.

### Step 0: merge (after Gate 1)
`git merge --no-ff 867c32956a38788a3099b045b19be450fcd16a86` on the lane branch. No conflict expected (see §1). Verify `git diff --stat` equals the 11 files listed. Do not merge `a46056f`.

### Step 1: shared export dispatch (small, avoids drift between local and hosted)
In `plainhand/exports.mjs` add:

```js
export const DOWNLOADS = {
  'applications.csv': { type: 'text/csv; charset=utf-8', filename: 'plainhand-applications.csv', needsTracker: true,  build: applicationsCsv },
  'calendar.ics':     { type: 'text/calendar; charset=utf-8', filename: 'plainhand-calendar.ics', needsTracker: false, build: state => calendarIcs(state) },
};
export function downloadHeaders(entry) { return { 'Content-Type': entry.type, 'Content-Disposition': `attachment; filename="${entry.filename}"`, 'Cache-Control': 'no-store' }; }
```
Local `plainhand-server.mjs` and hosted `cloud/app.mjs` both look up `DOWNLOADS[p.slice('/api/'.length)]`. Local routes keep identical bytes/headers to tracking (no behaviour change). This is the only structural edit to tracking code; it is optional: if root prefers a zero-touch merge, inline the two routes in cloud instead (same behaviour, a second copy of the filenames).

### Step 2: hosted routes (finding 1)
In `plainhand/cloud/app.mjs` `api()` GET block, after `/api/export`, before the final 404:

```js
const download = DOWNLOADS[p.replace(/^\/api\//, '')];
if (download) {
  const state = await workspace.load();
  const input = download.needsTracker ? { ...state, tracker: await workspace.read('data/applications.md') } : state;
  return send(res, 200, download.build(input), downloadHeaders(download));
}
```
- No `limiter.hit` (GET, same as `/api/export`/`/api/artifact`).
- `send` is the existing cloud helper; `Cache-Control` is set explicitly and also by the global header.
- `workspace.load()` and `read()` are existing read paths (`/api/export` and `stateFor` use them); no `mutate`.
- Not added to `LOCAL_ONLY`; shared UI works unchanged.

### Step 3: CSV bare CR (finding 2), `exports.mjs` `cell()` and `escapeText()`
```js
const LINE_BREAKS = /\r\n|[\r\n\u0085  ]/g;
const cell = value => {
  let text = String(value ?? '').replace(LINE_BREAKS, ' ');      // normalize ALL line-break forms first
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;               // formula guard, now also after leading whitespace
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
```
- Order unchanged in spirit: line breaks are removed **before** the formula test, so `'\r=1+1'` becomes `' =1+1'`, and the guard (now whitespace-tolerant) prefixes `'`. The original guard `[=+\-@\t\r]` is a strict subset of the new one (tab/CR are whitespace), so nothing is weakened.
- After normalization no CR/LF can remain, so quoting only needs `"` and `,`; keeping `\n` in the quote class is harmless; I keep `/[",\r\n]/` as belt and braces.
- `escapeText()` (ICS) uses the same `LINE_BREAKS` → `\\n`.
- Values keep their other content untouched (no trimming), only line breaks become one space.

### Step 4: legacy rows shared + visible in Board (finding 3)
New `plainhand/web/ui/tracker-rows.mjs` (pure, no imports):

```js
// Tracker rows that are in applications.md but not also app jobs.
export function legacyTrackerRows(state) { /* body moved verbatim from exports.mjs */ }
export const legacyMatches = (row, query) => `${row[4]} ${row[3]}`.toLowerCase().includes(String(query || '').trim().toLowerCase());
```
- `exports.mjs` imports and re-exports `legacyTrackerRows` from `../web/ui/tracker-rows.mjs` (keeps `tests/test-exports.mjs` import surface). `applications.mjs` imports it and deletes its private `legacyRows`.
- `ApplicationsPage`: `const legacy = legacyTrackerRows(state).filter(row => legacyMatches(row, query));` used for both views and the subtitle. Behaviour change in Table view: legacy rows now respect the search box (previously always shown); this is what makes count and visibility agree. Flagged in §8.
- `Board({ jobs, legacy })`: after the columns, if `legacy.length`, render read-only:

```html
<section class="board-legacy" aria-labelledby="board-legacy-title">
  <h3 id="board-legacy-title">From your existing tracker <span class="board-count">N</span></h3>
  <p class="board-hint">These rows live in applications.md. Change them there; they are not shown as stages.</p>
  <ul class="plain-list"> <li> role · company · fit · status text · <Pill>Existing tracker</Pill> </li> … </ul>
</section>
```
No `draggable`, no `<select>`, no buttons, no stage mapping. Legacy status text is shown verbatim as text (it may be non-canonical). CSS: ~8 lines in the existing board block, reusing tokens (`--surface-2`, `--border`, `--text-2`) so light/dark/mobile follow the existing theme.
- Board column counts and the "by stage" part of the subtitle remain job-only; the legacy count stays its own clause.

### Step 5: docs
`CHANGELOG.md` / `docs/PLAINHAND-BROWSER-APP.md` (arrive from tracking): one added sentence each that hosted accounts get the same two downloads and that the Board lists existing-tracker rows read-only. Only after behaviour is verified; no claim before.

### Proposed changed files (beyond the merge)
| File | Change |
|---|---|
| `plainhand/exports.mjs` | `DOWNLOADS`/`downloadHeaders`, `cell` + `escapeText` fix, import legacy helper |
| `plainhand/web/ui/tracker-rows.mjs` | new, pure helper |
| `plainhand/web/ui/applications.mjs` | use shared helper, filtered `legacy`, `Board` legacy section |
| `plainhand/web/css/app.css` | ~8 lines for `.board-legacy` |
| `plainhand-server.mjs` | the two routes use `DOWNLOADS` (same bytes/headers) |
| `plainhand/cloud/app.mjs` | hosted download routes |
| `tests/test-exports.mjs` | new cases (§6) |
| `tests/test-cloud-app.mjs` | hosted download cases (§6) |
| `tests/test-plainhand-ui.mjs` | board keyboard/Applied, legacy-in-board, search, screenshots (§6) |

## 6. Test design and falsifiers

Each test is written so a specific wrong implementation makes it fail. "Falsifier" names that wrong implementation.

### 6a. `tests/test-exports.mjs` (pure, no services)
1. **Parsed-cell regression (finding 2).** Add a ~20-line RFC 4180 parser in the test (quote-aware; record separators are CRLF, LF or bare CR *outside quotes*). Fixture jobs with company/title/next-action text containing: bare CR (`Safe\r=1+1`), CRLF, LF, ` `, leading `=`/`+`/`-`/`@`, leading-space-then-formula (`' =1+1'`), comma, double quotes, and combinations (`'a,\r"b"\n=c'`). Assert: record count == jobs + header; every record has exactly 9 fields; no field contains CR/LF; no field *starts* with `=+-@` (ignoring leading whitespace) unless it starts with `'`; and the parsed cell equals the expected normalized string (e.g. `'Safe =1+1'` for the root probe — no apostrophe needed since `=` is mid-cell, but `'\r=1+1'` → `"' =1+1"`).
   - Falsifier: current `/\r?\n/` code fails (raw CR splits the record: 3 records, field `=1+1`). Falsifier for over-correction: a version that drops the formula guard fails the formula rows.
2. **Existing three CSV tests unchanged and still passing** (comma/quote/newline, formula guard string-equality, legacy row).
3. **ICS bare CR.** Company `Acme\rATTENDEE:evil` → after unfold, no content line begins with `ATTENDEE`; every `ics.split('\r\n')` line has no bare `\r`/`\n`; SUMMARY contains `\\n`. Falsifier: old `escapeText`.
4. **No side-effect imports.** Read `exports.mjs` and `tracker-rows.mjs` source; assert every `import` specifier is within an allow-list (`./…`/`../web/ui/tracker-rows.mjs`; no `node:fs`, `node:net`, `node:child_process`, `http(s)`, `fetch(`). Falsifier: someone adds a provider/network call to the export path.
5. **Legacy helper parity.** One tracker fixture with 3 rows (one duplicating a job, one with mixed-case duplicate, one malformed row without `|`-id) through `legacyTrackerRows`; assert identical to the old UI rule (company+role case-insensitive) and that `legacyMatches` is case-insensitive over role+company.
6. **`DOWNLOADS` metadata.** Exact types and filenames for both entries.

### 6b. `tests/test-cloud-app.mjs` (hosted; needs disposable Postgres, see §7)
New test `hosted downloads are per-user…` using the existing harness (`app.client().signIn()` twice):
- User A: add job `Acme`, set `evaluation = {score: 4.1}` and a `record.nextAction {text, due}` via `wa.mutate`; add a rejected job with a due date (must be excluded from ICS). User B: job `Beta` only.
- `GET /api/applications.csv` as A with A's token: `200`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="plainhand-applications.csv"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; body starts `﻿`, has the header row, contains `Acme`, never `Beta`. Likewise `/api/calendar.ics`: `text/calendar; charset=utf-8`, filename `plainhand-calendar.ics`, `BEGIN:VCALENDAR`, A's next-action SUMMARY and DTSTART, no rejected-job text, no `Beta`.
- B symmetric (contains `Beta`, never `Acme`).
- **Unsigned** (`c.request('/api/applications.csv')` with no cookie): `401`, body JSON error, no file headers, no content leakage. Same for `.ics`.
- **Signed in, no/wrong page token**: `403`; A's cookie with B's token: `403` (same as existing state test).
- **No mutation**: before/after downloads, `workspace.load().revision` equal and `select count(*), max(updated_at)` on `plainhand.workspace_files` for A unchanged; `app.auth.emails/deleted` unchanged. No usage/audit rows added (`AuditLog.list` length equal).
- Legacy tracker row: write `data/applications.md` for A with one legacy row; it appears in A's CSV and not in B's.
- Falsifiers: missing route → 404 fails status; a route placed above the session check → unsigned test fails; a route reading a global/default workspace → isolation fails; dropping `no-store` fails header assertion; mutating on read fails the revision assertion.

### 6c. `tests/test-plainhand-ui.mjs` (real Chromium, local app, synthetic workspace)
Add to the tracking block (keep its drag test untouched):
1. **Keyboard/select Applied guard on a board card.** In Board view: focus the card's `Status for …` select, `selectOption('Applied')` / keyboard ArrowDown+Enter; assert the `Confirm your submission` dialog opens, select value reverts to the prior status, `workspace.load()` status unchanged; click `Not yet`; still unchanged. Then select `Interview` through the same control: status written. Falsifier: any change that routes `Applied` through `jobs/update` without the dialog.
2. **Legacy rows in Board.** Seed `data/applications.md` with one legacy row not matching any job and one duplicating a job. In Board view assert: a `From your existing tracker` section with exactly the non-duplicate row, no `draggable` attribute and no `<select>`/`<button>` inside it, subtitle `1 from your existing tracker`; column counts sum == job count (legacy not included). Switch to Table: same legacy row present.
3. **Search coherence.** Type the legacy company into `Search applications`: the legacy row shows in both views and the subtitle count matches; type a nonsense string: both lists empty in both views and the subtitle shows `0 evaluated roles` with no legacy clause. Falsifier: rendering legacy only in Table, or filtering jobs but not legacy.
4. **Canonical states.** Board column headings equal `STATUSES` (with `SKIP` shown as `Skip`) and legacy status text never creates a column.
5. **Screenshots** (real Chromium, the existing harness `shot()`; evidence dir via `PLAINHAND_UI_OUTPUT`): Board with legacy section in light desktop (1440×1050), dark (`emulateMedia colorScheme: 'dark'`), and mobile 390×844 (board horizontal scroll plus legacy section reachable and not clipped; assert `document.documentElement.scrollWidth <= innerWidth`). File names continue the `06d-board*.png` scheme. These are real renders of the shipped UI against a synthetic workspace, not mock HTML.
6. **CSP check**: collect `page.on('console'|'pageerror')`; assert no CSP violation messages while exercising Board/exports.

Hosted-UI limitation to state honestly: the Chromium run is the **local** server serving the same shared UI bundle. A Chromium check of the *hosted* button needs Postgres plus the cloud harness; I propose only the HTTP-level cloud test above (6b) unless root wants a hosted Chromium spec added (`tests/playwright-onboarding.config.mjs` exists and could carry it; not proposed by default to keep the lane small).

### 6d. Not changed
No change to `tests/test-web-modules.mjs` expected (new file is `.mjs`). `package.json` test script already includes `test-exports.mjs` from the tracking commit; cloud tests stay in `test:cloud`.

## 7. Validation plan and resource rules (run only after Gate 1)

1. `free -h` before every build/test/browser run; stop if available < 2GiB. Max 2 workers (`--test-concurrency=2`, Playwright `--workers=1`).
2. Focused, in order: `node --test tests/test-exports.mjs` → `node --test tests/test-web-modules.mjs tests/test-css.mjs` → `node tests/test-plainhand-ui.mjs` (Chromium, evidence to a temp dir; `TMPDIR=/home/ak/.cache/plainhand-eval-tmp` per the memory note) → cloud suite (below).
3. **Postgres for `tests/test-cloud-app.mjs` (needs root approval to start a local service).** Verified available: cached image `postgres:17` and a reachable Docker daemon; no host Postgres binaries. Plan: `docker run --rm -d --pull never --name plainhand-lane-pg -p 127.0.0.1:<free port>:5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=<random, kept in an env var only> postgres:17`, wait for readiness, set `PLAINHAND_TEST_DATABASE_URL` to `postgresql://postgres:…@127.0.0.1:<port>/postgres`, run only `node --test tests/test-cloud-app.mjs`, then `docker stop` and confirm `docker ps` shows nothing of ours. Loopback only, no pull (`--pull never`), no external cloud, data on tmpfs and destroyed with the container. This worktree has no `node_modules`; the run needs the same dependency tree the main checkout uses, via a local symlink to its `node_modules` (gitignored, no network). If root declines the container, cloud tests are reported as **not run** (skip is never reported as pass) and the hosted route is then covered only by code review plus the exports unit tests; that gap would be stated in the result.
4. No servers or containers left running; verify with `ss -ltn`/`docker ps` at the end of each run.
5. Root will independently re-run the focused tests and the built UI after merge; the lane result will list exact commands, output tails and screenshot paths, and will not claim acceptance.

## 8. Risks, decisions needed, and honest unknowns

- **Table-view behaviour change (decision for root):** legacy rows will now obey the search box (today they ignore it). This is the minimal way to make counts and visibility coherent in both views. Alternative: never filter legacy rows and state "N from your existing tracker (not filtered)"; I do not recommend it.
- **Addition beyond the brief:** the ICS bare-CR fix (same bug class, same file). Easy to drop if root wants strictly three findings.
- **Cross-layer import:** `plainhand/exports.mjs` imports a pure helper from `plainhand/web/ui/`. Chosen over a third copy; the helper has no imports so it is safe in Node and the browser. Alternative is keeping two copies plus the parity test in 6a-5.
- **Formula guard widening** (`^\s*[=+\-@]`) goes beyond the brief's "normalize line breaks first". It is strictly stricter and needed because normalization turns a leading CR/LF into a leading space.
- **Not covered:** fullwidth/Unicode lookalike formula characters; ICS `due` values that are not dates (`day()` slices the first 10 chars). Not part of the findings; noted, not fixed.
- **Hosted ID/params:** `?token=` on GET downloads is accepted by existing cloud code; the UI uses the header. I do not change that.
- **Unverified until run:** that `workspace.read` returns `''`/null cleanly for a hosted account with no tracker file (the `String(state?.tracker || '')` guard suggests yes) and the exact `send()` signature/string handling for a BOM body. Both are covered by 6b/6a and will be confirmed when run.

## 9. Gate 1 asks of root

1. Approve the merge of `867c329` only (no `a46056f`).
2. Approve Steps 1-5, or strike Step 1 (shared `DOWNLOADS`), the ICS fix, or the Table search change.
3. Approve starting the loopback `postgres:17` container (cached, no pull) for `tests/test-cloud-app.mjs`, plus the local `node_modules` symlink; or decline and accept "cloud tests not run".
4. Confirm the screenshot set (light/dark/mobile board with legacy section) and the real-Chromium local-UI scope.
