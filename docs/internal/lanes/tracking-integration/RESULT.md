# Lane result: tracking integration (implementation)

Status: **implementation and focused checks done on the lane; awaiting independent
root review. Nothing here is self-accepted and this is not a product pass.**

## State

| Item | Value |
|---|---|
| Worktree | T3 isolated checkout for `t3/tracking-integration-design` |
| Lane branch | `t3/tracking-integration-design` |
| Goal base (unchanged) | `e4da45fa2d21ce1f5945ce11662a73afda03b53f` |
| Tracking merge (already present, not repeated) | `99ebf25` = merge of `867c32956a38788a3099b045b19be450fcd16a86` |
| HEAD at implementation start | `c0ef7b4710b01f8153a9bae3f5e2854a29118940` (root fallback record) |
| Continuation `a46056f` | **not merged** |
| Result commit | the commit that adds this file on the lane; root reads it with `git log --oneline -1` |

Author route: Claude Sonnet implementation stopped on provider rate limit after
`99ebf25` plus partial `exports.mjs`/`tracker-rows.mjs`; root recorded the switch
to Pi DeepSeek V4.1 Flash thinking max in `REVIEW.md`. This run resumed that
partial state on the same checkout and did not re-merge, discard or stash it.

## What changed

Production:

- `plainhand/exports.mjs` — all line-break forms (CRLF, LF, bare CR, NEL, LS, PS)
  become one space in CSV cells and one escaped `\n` in ICS text before any
  other step. The original formula guard (`^[=+\-@\t\r]`) is kept and a
  whitespace-prefixed formula guard is added; the union is strictly stricter.
  The legacy tracker row rule now comes from one shared module and is re-exported
  for Node consumers.
- `plainhand/web/ui/tracker-rows.mjs` (new, pure, no imports) — one
  `legacyTrackerRows` rule for the browser and the CSV, plus `legacyMatches`, the
  case-insensitive role+company search rule.
- `plainhand/web/ui/applications.mjs` — legacy rows obey the page search box in
  both views, so the subtitle count equals what is on screen; the Board renders
  them in a read-only section below the columns (no card, stage, drop target,
  select or button). The local duplicate helper is gone. `moveTo`,
  `StatusSelect`, `STATUSES` and the Applied confirmation are unchanged.
- `plainhand/cloud/app.mjs` — two explicit authenticated GET routes,
  `/api/applications.csv` and `/api/calendar.ics`, that build the same bytes as
  the local routes from `contextFor(session.userId)` only: `workspace.load()`
  plus `workspace.read('data/applications.md')` for the CSV. No limiter write, no
  mutation, explicit `Content-Type`, attachment filename and `Cache-Control:
  no-store`; the global nosniff/CSP/XFO headers stay in force. No `DOWNLOADS`
  dispatcher (root struck it).
- `plainhand/web/css/app.css` — five rules for `.board-legacy`, on the existing
  surface/border/radius tokens; no new colors, no layout rewrite.
- `CHANGELOG.md`, `docs/PLAINHAND-BROWSER-APP.md` — one truthful sentence each
  for the read-only board section and the hosted downloads.

Tests (only these files):

- `tests/test-exports.mjs` — RFC 4180 record parser in the test; bare-CR record
  split regression; all line-break/formula/comma/quote combinations parsed as one
  cell each; tab guard and whitespace-formula guard both asserted; ICS bare-CR
  property-injection case; shared legacy-row rule and search helper.
- `tests/test-cloud-app.mjs` — hosted downloads against disposable Postgres:
  exact headers and filenames, BOM bytes, contents, legacy row, rejected job
  excluded from the calendar, two-user isolation, unsigned 401, missing/wrong and
  cross-user page token 403, and no mutation (revision, `workspace_files` row
  count and `max(updated_at)`, tracker file bytes, audit file, auth emails).
- `tests/test-plainhand-ui.mjs` — a real tracker row appended to
  `data/applications.md` during the flow: CSV includes it, Board shows the
  read-only section with exactly that row, canonical column headings, column
  counts sum to app jobs only, search filters jobs and legacy rows with matching
  subtitle counts in both views, empty search state, keyboard Applied guard on a
  board card (ArrowDown after selecting `Apply`) and the same control writing a
  non-Applied stage. Screenshots below.

## Checks that actually ran

Environment: 15 GiB host; `free -h` showed 4.6-5.2 GiB available before every
suite. No suite used more than one file at a time; `--test-concurrency=2` where
the runner accepts it. Workspace and screenshots on disk under
`~/.cache/plainhand-eval-tmp/tracking-lane/`.

| Command | Result |
|---|---|
| `node --test tests/test-exports.mjs` | 12 tests, 12 pass, 0 fail, 0 skipped |
| `node --test --test-concurrency=2 tests/test-web-modules.mjs tests/test-css.mjs` | 3 tests, 3 pass, 0 fail, 0 skipped |
| `PLAINHAND_TEST_DATABASE_URL=postgres://postgres:plainhand-local-test-only@127.0.0.1:32769/postgres node --test --test-concurrency=2 tests/test-cloud-app.mjs` | 18 tests, 18 pass, 0 fail, 0 skipped (includes the new hosted-downloads test) |
| `TMPDIR=~/.cache/plainhand-eval-tmp/tracking-lane/tmp PLAINHAND_UI_OUTPUT=~/.cache/plainhand-eval-tmp/tracking-lane/shots node tests/test-plainhand-ui.mjs` | exited 0; printed the full-browser workflow pass; 40 PNGs; `workflow-proof.json` has `browserErrors: []` |

Browser evidence (real headless Chromium against the local server serving the
shared UI bundle, synthetic fixture agent, no provider call):

- `~/.cache/plainhand-eval-tmp/tracking-lane/shots/06d-board.png` — dark desktop (1440x1050), board with the read-only tracker section.
- `~/.cache/plainhand-eval-tmp/tracking-lane/shots/06d-board-legacy-light.png` — light desktop, same state.
- `~/.cache/plainhand-eval-tmp/tracking-lane/shots/06e-board-legacy-mobile.png` — 390x844; stage columns scroll inside the board, the tracker section fits (`boundingBox().width <= 390`) and page `scrollWidth <= innerWidth`.
- `06-tracker.png`, `06b-followups.png`, `06c-application-record.png`, `09-mobile-panel-record.png`, `20-{dark,light}-*.png` were regenerated by the same run.

The UI test's final assertion is `assert.deepEqual(errors, [])`, collecting
`pageerror` and console errors, so a CSP violation or script error fails the run.

## Failed attempts kept (no assertion was weakened)

1. First exports run failed to import: `exports.mjs` re-exported only
   `legacyTrackerRows`, not `legacyMatches`. Fixed by re-exporting both from the
   shared module.
2. Second exports run: 1 failure in the new ICS test. The fixture text had no
   comma while the expected regex required an escaped one. The fixture and
   expectation were corrected to include and assert `\,`; the product code was
   right.
3. First cloud run: 17/18, failure on `csv.text().startsWith('\uFEFF')`.
   `Response.text()` strips a leading UTF-8 BOM by specification. The test now
   checks the first three bytes (`EF BB BF`) and decodes with
   `Buffer.toString('utf8')`; the BOM requirement itself is unchanged.
4. First UI run: 1 failure because the canonical-heading assertion used
   `innerText`, which returns the CSS-uppercased labels. Switched to
   `allTextContents()` (DOM text). The board still renders the canonical labels
   and CSS still uppercases them visually.

## Deliberately not done / open

- No push, no main/goal-branch merge, no register/manifest/board/handoff edit,
  no deploy, no provider or model call, no external network/accounts.
- No container or service was started, stopped or restarted. The root-owned
  `plainhand-goal-tracking-pg` was used read/write only through the supplied
  `PLAINHAND_TEST_DATABASE_URL`; `tests/cloud-test-db.mjs` created and dropped
  its own uniquely named database.
- The full `test:plainhand`/`test:cloud` suites were not run; only the focused
  files above. No conclusion is drawn about unrelated checks.
- **Hosted browser remains open.** The Chromium evidence is the local server's
  shared bundle; hosted routes are covered at the HTTP level (signed-in,
  cross-user, unsigned, headers, no mutation), not by signing into the cloud app
  in Chromium. Root's hosted-browser acceptance is not claimed.
- The mobile screenshot shows the board at its first column with the tracker
  section below; the other columns are reachable by the board's own horizontal
  scroll (by design) and the page itself does not overflow.
- Existing local app/test servers and containers that belong to other work were
  left untouched (e.g. `scripts/browser-smoke.mjs`, hireloop ports, other
  Postgres containers); this lane stopped its own app and browser in the test's
  `finally`.

## For root

1. Read the production diff separately from tests, then re-run the four commands
   above; the cloud one needs the still-running test container.
2. Re-run the built UI and view the three screenshot files; the hosted-browser
   gap is stated, not hidden.
3. Accept, amend or reject on the lane; no acceptance is claimed here.
