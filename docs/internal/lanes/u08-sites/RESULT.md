# Lane result: U08 — application and site paths

Status: **implemented on this lane; awaiting root review.** This author does not
accept its own work. It did not edit `GOAL-HANDOFF.md`, `EVIDENCE.json`,
`docs/internal/GOAL-ACCEPTANCE.json`, any `REVIEW.md`, or
`docs/internal/baseline/*`. It did not edit `plainhand/evaluation/*` or
`benchmarks/*`. No push, merge or deploy. No live or paid model call. No real
employer site or application was contacted or submitted.

## 1. Pin, route, environment

| Item | Value |
| --- | --- |
| Branch | `t3/u08-site-paths` |
| Dispatch HEAD | `81126ab3079e859d68694d0b7ade6e0bbe8b2cda` (clean at start) |
| Author | implementation sub-agent |
| Reviewer | root, different model family |
| TMPDIR | `/home/ak/.cache/plainhand-eval-tmp` |
| Dependencies | `npm ci --no-audit --no-fund` in this lane (162 packages, cached) |
| Resources | `free -h` checked before every gate: 7.5 GiB available at dispatch, never below 3.5 GiB. Chromium suites ran one at a time, test concurrency 2 |
| Live calls | none. Every provider call is the repository fixture agent |

## 2. Files changed

| File | Change |
| --- | --- |
| `plainhand/test-site-fixtures.mjs` | new: local HTTPS portals on real ATS hostnames and path grammar, request/POST recording, the `__plainhandPlantSubmit` test hook, the Chromium launcher |
| `tests/test-u08-sites.mjs` | new suite: per-ATS fill, Workday handoff, LinkedIn/Indeed manual kit, unsupported site, three detectors with mutations, access tiers |
| `plainhand/manual-kit.mjs` | new: writes the posting links, approved documents and approved answers to `output/manual-kit/<company-role-id>/` |
| `plainhand/actions.mjs` | registers `jobs.manualKit` |
| `plainhand-server.mjs` | `POST /api/jobs/manual-kit` |
| `plainhand/web/ui/jobpanel.mjs` | “Save kit files” action in the manual kit, showing the written folder |
| `plainhand/field-policy.mjs` | **fix**: SSN / social security is a sensitive label (see §9) |
| `tests/test-field-policy.mjs` | covers `Social Security Number` and `SSN` |
| `tests/test-plainhand-ui.mjs` | clicks the new kit action and waits for the saved folder |
| `tests/test-agent-injection.mjs` | adds `jobs.manualKit` to the brute-force write/task catalogue |
| `package.json` | adds `test:u08-sites` (`node --test --test-concurrency=1 tests/test-u08-sites.mjs`) |
| `docs/internal/lanes/u08-sites/RESULT.md` | this result |

No production host list, guard, upload policy or measurement file was changed.

## 3. Fixture design and why it is a real host test

`plainhand/test-site-fixtures.mjs` starts one HTTPS server bound to
`127.0.0.1:0`. It serves the real public hostnames and path grammar:

| Shape | Host | Paths |
| --- | --- | --- |
| Greenhouse | `boards.greenhouse.io` | `/acme/jobs/1234`, `/acme/jobs/1234/apply` (plus `/acme/jobs/4040/apply` with a planted required field) |
| Lever | `jobs.lever.co` | `/acme/<uuid>`, `/acme/<uuid>/apply` |
| Ashby | `jobs.ashbyhq.com` | `/acme/<uuid>/application` |
| Workday | `acme.wd5.myworkdayjobs.com` | posting, `/apply/autofillWithResume`, `/login` |
| LinkedIn | `www.linkedin.com` | `/jobs/view/4401234567/` |
| Indeed | `www.indeed.com` | `/viewjob?jk=u08fixture` |
| Unknown | `careers.acme-u08.invalid` | `/jobs/graduate-engineer` |

Chromium is launched with `--host-resolver-rules=MAP <host> 127.0.0.1:<port>` for
those names, and the test launcher adds `ignoreHTTPSErrors` for the per-run
self-signed SAN certificate (generated with `openssl`). The product's own
`ATS_HOSTS`, `portalRoot`/`portalFrame`, `isBoardUrl`, submission guard, resume
transfer policy and request allowlist run **unchanged** against the real names.
The server records every request; a POST is a submission. This is the access
tier `local-fixture`: the transport is local, the host and DOM are shaped like
the target.

The DOM is hand-written to each product's field naming and wrapper classes:
Greenhouse `job_application[...]` names and `application_form`; Lever
`application-question` wrappers and `name`/`email`/`urls[...]`; Ashby
`_systemfield_*` names and `_fieldEntry` wrappers; Workday
`data-automation-id` attributes and a separate sign-in step.

## 4. Per-ATS results (access tier `local-fixture`)

Evidence written by the suite to `output/u08/u08-sites.json` (gitignored), which
also carries `accessTier: "local-fixture"` and
`realSiteReadOnly: "unverified by design; no real employer site was contacted"`.

| ATS | Host / path | Fields | Filled | Flagged | Ready | Resume hash | Cover hash | Provenance | POSTs | Ends at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Greenhouse | `boards.greenhouse.io/acme/jobs/1234/apply` | 9 | 8 | 1 (sponsorship, sensitive) | yes | equal | equal | profile + approved resume + packet materials | 0 | user review |
| Lever | `jobs.lever.co/acme/9f8e…/apply` | 14 | 7 | 7 (5 sensitive + 2 unanswered optional) | yes | equal | equal | profile + approved resume + packet materials | 0 | user review |
| Ashby | `jobs.ashbyhq.com/acme/9f8e…/application` | 7 | 7 | 0 | yes | equal | equal | profile + approved resume + packet materials | 0 | user review |

Every filled item in the saved checkpoint carries a non-empty `source`; the test
fails if any is missing. Each field is read back from the live DOM with the
product's own `data-co-field` selector and compared with the planned answer.
The uploaded resume and cover letter are read back through `File.arrayBuffer()`
and compared byte-for-byte with the approved PDFs, and with the product's
`job.pdfHash`. The page script's `window.submissions` stayed 0, no POST reached
the fixture, and the URL stayed on the form. `browser/advance` and the final
navigation found no next control, so the run returned the “review” observation.

The one flagged Greenhouse field is the optional sponsorship select; it is
sensitive and deliberately left to the candidate. Lever's optional Current
company and Portfolio fields are unanswered, plus its five sensitive controls.
Readiness stays true because none of those are required.

## 5. Workday (best effort, then a candidate handoff)

Run: `acme.wd5.myworkdayjobs.com` → Apply → `autofillWithResume` step 1.

- Step 1 filled 5 fields (first name, last name, email, phone, approved resume)
  and journalled the checkpoint.
- “Save and Continue” advanced to the portal's sign-in wall.
- The returned observation is `login`, message: “Create an account or sign in
  for this portal, then resume inspection. Filled answers are preserved.”
- `browser/attention` returns: “Sign in to acme.wd5.myworkdayjobs.com or
  complete verification, then use Resume inspection.”
- Packet, PDF/hash, status `Apply` and the `data/applications.md` row remain.
  0 POSTs.

This proves the handoff path, not real Workday coverage: the fixture is a
two-page synthetic flow with one tenant host.

## 6. LinkedIn, Indeed and an unknown careers host

| Case | Save path | Preparation | Manual kit | Tracking | Browser opened |
| --- | --- | --- | --- | --- | --- |
| LinkedIn (`www.linkedin.com/jobs/view/4401234567/`) | `jobs.add` (board is never opened; `applicationTarget` throws) | packet + PDFs, status `Apply` | `posting.md`, `resume.pdf`, `cover-letter.pdf`, `cover-letter.md`, `answers.md`, `kit.json` | tracker row with number, status `Apply` | no |
| Indeed (`www.indeed.com/viewjob?jk=u08fixture`) | same import path | same | same six files | same | no |
| Unknown (`careers.acme-u08.invalid/jobs/graduate-engineer`) | `jobs.add`; `supportedUrl` false, `isBoardUrl` false, `portalRoot` `acme-u08.invalid` | same | same six files | same | no |

The kit resume and cover letter are byte-identical to the approved artifacts;
`answers.md` contains every approved packet answer; `posting.md` contains the
posting link. The manual kit is also a UI action: “Save kit files” in the
Apply-by-hand section writes the folder and shows its path. The existing UI gate
clicks it and waits for the toast.

No board was automated: no LinkedIn or Indeed page was opened, and no
Easy Apply flow was driven. The owner's review-first rule and the current
extension scope are unchanged.

## 7. Detectors with planted failures and mutations

| Detector | Planted failure | Observed | Mutation that must flip it |
| --- | --- | --- | --- |
| False-ready | `/acme/jobs/4040/apply` adds a required `Portfolio URL` with no profile or packet value | page state `ready`, `check.ready` **false**, `requiredFlagged` 1 | answering the missing key → `ready` true; a readback value that disagrees with the plan → `mismatch`/`changed-on-page`, `ready` false |
| Sensitive field | Lever form asks SSN, date of birth, race (radio), disability, salary history; the packet has a matching answer for SSN | every control empty, race unchecked, all five flagged `sensitive`, no filled label matches them | the same values under neutral labels (Employee reference code, Program start date, Project budget) fill; `isSensitiveLabel` is true for all five sensitive labels and false for the three neutral ones |
| Unauthorized submission | fixture hook `window.__plainhandPlantSubmit()` clicks the real submit button | guard armed (`__plainhandBlockSubmission` true), `browser/advance` returns no advance and clicks nothing, 0 POSTs, page script `submissions` 0, URL unchanged | after `browser/handoff` the guard is off and the same click produces exactly 1 POST at the fixture |

`browser/advance` deliberately only considers `button[type=button]` controls
labelled next/continue; the submit control is never a navigation candidate. The
DOM interlock blocks the submit event and `submit()`/`requestSubmit()`; the
network guard independently aborts non-GET writes.

## 8. Access tier per run

Every row above was produced by the suite with `accessTier: "local-fixture"` in
`output/u08/u08-sites.json`, printed in the suite log and named in §4–§7. The
tier `real-site read-only` is **not** verified: the suite never resolves or
connects to a real employer, and no real-site evidence is cited here. Offline
capture was not needed.

## 9. Product fixes

1. **Sensitive-label gap (real defect).** `isSensitiveLabel` matched “date of
   birth” and “salary” but not “Social Security Number” or “SSN”. A packet
   answer with an SSN question would have been filled by `suggestFormAnswers`.
   Added `\bssn\b|social security` and covered it in `test-field-policy.mjs`.
   The browser-level detector above fails against the old policy and passes now.
2. **Manual kit export.** The product had a UI manual kit but no produced
   artifact. `plainhand/manual-kit.mjs` + `jobs.manualKit` + the API route +
   “Save kit files” now write the posting, documents and answers to a folder.
   It requires a prepared packet, never submits, and writes only under
   `output/`.

No host list, submission guard, upload policy, threshold or scoring rule was
changed to make a check pass.

## 10. Gates

| Gate | Command | Result |
| --- | --- | --- |
| U08 Chromium suite | `TMPDIR=… node --test --test-concurrency=1 tests/test-u08-sites.mjs` | **10/10 pass**, 69 s |
| Product suite | `npm run test:plainhand` (`--test-concurrency=2`) | **595/595 pass**, 0 fail |
| UI suite | `npm run test:plainhand-ui` | pass; full workflow incl. the kit action, 47 s |
| Controlled benchmark | `node benchmarks/benchmark-eval.mjs --concurrency 2` | **64/67**, 3 expected failures (`profile-effect-{fin,analyst,sci}-minimal`), 0 unexpected; evidence `output/evaluation-controlled-2026-11-16T03-01-27-978Z` |

The U08 suite is a separate script because it launches seven real Chromium
sessions and generates a local certificate; it is not part of `test:plainhand`.

## 11. Residuals and limits

- **Real-site read-only stays unverified by design.** No real employer site was
  resolved, opened or read. The `local-fixture` rows must never be cited as
  real-site support.
- **Workday is best effort only.** The fixture covers one two-page flow. Real
  Workday tenants, SPA rendering, SSO and multi-step validation are not measured;
  the candidate handoff is proven against a synthetic sign-in wall.
- **LinkedIn and Indeed are import + manual kit.** No board page is opened and no
  Easy Apply path exists in this lane (deliberate, review-first).
- **Fixture DOMs are hand-written**, not captured production HTML. Field naming,
  wrapper classes and paths follow the targets, but selector drift on the real
  sites is not detected by this suite.
- **The suite depends on `openssl`** for the per-run certificate and on
  Chromium's host resolver mapping. The certificate is generated under TMPDIR and
  removed with the server; `ignoreHTTPSErrors` is limited to the test launcher.
- **The kit is a folder, not a zip**, and its files are not served through
  `/api/artifact` (that route only serves a job's registered artifacts); the UI
  shows the directory. The `accessTier` lives in the gitignored test JSON, not in
  the product run record.
- **No self-acceptance.** Root must read the diff, confirm the fixture host/path
  claims, and decide whether the SSN policy fix and kit export belong in the
  accepted increment.
