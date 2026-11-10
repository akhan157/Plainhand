# Plainhand verification matrix

## Evaluation harness, 10 November 2026

| Check | Result | Evidence |
| --- | --- | --- |
| Controlled end-to-end evaluation | PASS, 28/30 (2 expected lower-bound controls) | `node benchmarks/benchmark-eval.mjs --concurrency 2`: 3 profile, 6 resume, 11 application, 2 submission, 1 evaluation, 6 profile-effect and 1 journey scenario on fictional candidates and an owned loopback sandbox; 0 unexpected failures, 0 false-ready, 0 sensitive auto-fills, 17/17 candidate-confirmed submissions accepted with matching approved resume hashes (and the cover-letter hash where attached), tracker confirmed `Applied`; real Chromium PDFs |
| Profile effectiveness triples | PASS, 4/4 built+seeded; 2/2 minimal controls failed as expected | Minimal seed vs conversation-built vs seeded full profile on two matched jobs; built and seeded covered the required facts and completed the application, minimal failed packet coverage. Controlled deltas are zero by design; live deltas are the quality signal |
| Evaluation scoring | PASS, 27/27 | Every evaluation had a valid score, the expected recommendation, the correct band and source evidence for each match; the below-4/5 role returned `Skip` and `prepare` was refused without an override |
| Connected journey | PASS, 1/1 | `journey-mech` passed profile conversation, approved understanding, approved standard, evaluation, packet, portal fill and candidate confirmation in one workspace |
| Application edge cases | PASS | Repeating employment records filled both `Employment` fieldsets; the native radio degree group filled; the discard-once portal detected the first-pass loss and recovered on retry; a form-agent warning is reported as `agent-warning` |
| Live profile-effect subset | PARTIAL, 1/6 | Antigravity on the six matched profile-effect scenarios: built profiles captured all revealed facts (1.00), the analyst seeded scenario passed, the mechanical built and seeded packets were blocked by start-date/role questions, and the analyst built form answer was a true project rejected by the old narrow field expectation (now fixed to accept any persona fact). The minimal controls failed as intended. This is a product signal, not a harness pass; a full live rerun is pending |
| Harness regression test | PASS, 13/13 | `node --test tests/test-bench-eval.mjs`: sandbox ground-truth rejection (name, degree, repeating records), number-word/phone normalization, false-ready and plan-answer leaks, baseline regressions vs pre-existing failures, repeat flakiness, records markup, `Skip` evaluation guard, live preflight, profile-effect pairing, and a controlled resume + submission run |
| Profile benchmark regression test | PASS, 7/7 | `node --test tests/test-profile-bench.mjs` |

The controlled run proves the harness and workflow, not model quality. A first
live Antigravity attempt completed 9/24 scenarios, but 12 failures were the old
180-second per-call timeout under two concurrent live scenarios, not model
failures. Live runs now default to one scenario, use a 600-second timeout and a
preflight, and a live rerun is pending. Claude was at its 5-hour limit and Codex
at its usage limit. Real employer acceptance remains unmeasured.

## Plainhand 1.1.1 and 1.1.2, 5–6 November 2026

Run on Linux with Node.js 26.11.1, Playwright Chromium, Go 1.27.3 and Postgres 17
in Docker. The live AI runs used a fictional candidate and a local test employer.

| Check | Result | Evidence |
| --- | --- | --- |
| Full repository suite | PASS, all checks | `npm run test:full`, including the Go dashboard build and `go test ./...` (Go was missing in the 3 November rerun) |
| Hosted Postgres workspace store | PASS | `test:cloud` against Postgres 17: **6/6** (skipped in earlier runs for lack of a database) |
| Live workflow, Claude | PASS | `test-plainhand-live.mjs --provider claude`: 10/10 stages, from provider connection to evaluation, packet with independent factual review, real PDF, approval, browser fields filled with the PDF uploaded, handoff before submission, tracker left unsubmitted |
| Live workflow, ChatGPT (Codex) | PASS | Same test with `--provider codex`: 10/10 stages |
| Windows installer | PASS | `installer-check.yml` on GitHub's Windows runner: `irm … install.ps1 \| iex`, `plainhand --check`, app served HTTP 200 |
| macOS installer | PASS | Same workflow on GitHub's macOS runner: `curl … install.sh \| sh`, `--check`, HTTP 200 |
| Real employer sites, read only | PASS after fixes | The app's own `ApplicationBrowser` opened live postings without typing or submitting. Greenhouse (Figma: 19 fields), Lever (Spotify: 11, Palantir: 21), Ashby (Ramp: 13, Linear: 13) and Airbnb's careers site with an embedded Greenhouse form (19) were read as ready. Workday (NVIDIA, Salesforce) reached its sign-in step and handed off. |
| Bugs found on live sites | FIXED | Lever's invisible preloaded hCaptcha frames counted as a challenge, so every Lever form stalled; hidden status text polluted Lever's resume label; Workday's sign-in wall rendered after the check and was reported as "review"; an embedded form whose Submit button painted first opened with 0 fields. Each has a test in `tests/test-plainhand-real-portal-regressions.mjs` that fails on the old code. |
| Workday after sign-in | NOT VERIFIED LIVE | Needs a real Workday account; the multi-step Workday adapter is covered by fixture tests only |
| Real submission by a user | NOT VERIFIED | By design only a person submits |

## Local rerun, 3 November 2026

This checkout had no user workspace (`node lib/doctor.mjs` reports the four expected
onboarding files missing) and no Go toolchain. Results below were produced on
Node.js 26.11.1 with the installed Playwright Chromium.

| Check | Result | Evidence |
| --- | --- | --- |
| Plainhand core | PASS | `npm run test:plainhand`: **304/304** |
| Full repository suite | PASS except two environment checks | `npm run test:full`: **42 of 44 jobs passed**; repository checks **350 passed, 1 failed, 2 warnings**. The failures are `go` missing: the Go dashboard build and `go test ./...` (`spawn go ENOENT`). |
| Browser workflow and themes | PASS | `test-plainhand-ui`: desktop/mobile, light/dark/system, real PDFs, form fill/upload/handoff |
| Insights band table | PASS after fix | `test-feature-insights-ui`; the table exceeded its card by 4 px at 1440 px and was tightened |
| Remote view (local stand-in) | PASS | `npm run test:remote`: sign-in link capture, build, deploy arguments, password redirect, wrong-password rejection, signed-in `dashboard-data.json` |
| Dashboard build | PASS | Missing optional `fonts/` no longer fails; `--data-root` uses the app shell; tracker-relative `../reports/...` links resolve; only artifacts the payload links are copied |
| Static dashboard link projection | PASS | `test-application-timeline`, `test-dashboard-data` |
| Dependency audit | PASS | `npm audit --audit-level=high` |
| Benchmarks | PASS, offline | 49/49 simulation, 3/3 invariants, 16/16 controlled subset, rules-only calibration 18/27; see [the local rerun](METRICS-INVENTORY.md#7-local-rerun-3-november-2026) |
| Real Vercel deploy | PASS, 4 November 2026 | Production deployment reached `READY`; the project has Vercel Authentication enabled, so Plainhand verified the dashboard password gate through `vercel curl` (302 to `/login/`, accepted password, HTTP 200 `dashboard-data.json`). The snapshot has 0 applications because this checkout has no tracker data. |
| Live provider benchmarks | NOT RUN | No signed-in Claude/Codex/Antigravity account; live runs use account quota and remain opt-in. |

The two Go failures are not code failures; CI installs Go 1.26 and runs the same
suite. Re-run `npm run test:full` on a machine with Go before claiming a clean
local suite.

## Plainhand 1.0, 27 October 2026

| Check | Result | Evidence |
| --- | --- | --- |
| Full repository suite | PASS | `npm run test:full`: core, quick and seven browser suites; core `test:plainhand` 290/290 |
| Live agent on a real CLI (Claude) | PASS, first run | `test:agent-live`: briefing (first text 2.7 s), interview logged as a confirmed proposal, injected posting instructions ignored and flagged |
| Live 1.0 flow end to end (Claude) | PASS | `test-plainhand-e2e-live.mjs`: understanding → standard (16/16 claims balanced) → evaluate (4.0) → prepare from standard (5/5 entries kept, 17/17 balanced, real PDFs) → "under 120 words" revised 190 → 115 words, resume unchanged · 8 calls |
| Profile building (Claude) | PASS | 13/13 revealed facts captured verbatim, nothing invented, 76% one-question turns |
| Claim calibration (Claude) | PASS | Combined grader 26/27 exact, 100% right direction, no missed inflation, no false alarms; the strict and comfortable lines move drafts as intended |
| Humanizer pass (Claude) | PASS | Live end to end: every draft went through it; 1 part rewritten, no rewrite rejected for changing a fact, 0 AI-writing tells left; 17 calls for the whole flow |
| Resume format from the candidate's PDF | PASS | Two fictional resumes in different formats rendered to real PDFs; page, margins, fonts, sizes, spacing, heading case and names, date position and bullets all read correctly (`test-resume-format.mjs`); format card checked in the browser |
| Real employer sites, inspection only | PASS | `benchmark-real-sites.mjs`: Greenhouse, Lever, Ashby forms read live; 5–7 fields filled without a model, rest flagged with reasons; Workday stops at its Apply/sign-in step |
| Fresh copy installs and starts | PASS | Clean clone → `npm run setup` → `npm start` → app loads with no errors, git status clean |
| Personal data in tracked files | PASS | None (name, school, employer lines, account names removed) |
| Real submission by a user | NOT VERIFIED | By design only a person submits; first real applications are the next check |
| Drafts on first pass | KNOWN | 1 of 3 fresh drafts balanced on first pass; stretches are mostly cover-letter motivation lines; the factual review fails them and the correction pass removes them |

## Finishing the lifecycle, 26 October 2026

Automated evidence for [NEXT-BUILD-PLAN](internal/NEXT-BUILD-PLAN.md) (N1–N6), with the
scripted or fixture agent and synthetic job boards. **No real provider, job
board or employer site was used.**

| Claim | Status | What the evidence establishes |
| --- | --- | --- |
| Full repository regression | PASS | `npm run test:full`: every check, including seven browser suites (workflow, assistant, brain controls, follow-ups, insights, campaigns) and npm audit. Core `test:plainhand` 251/251 |
| N1 campaigns: one place, pause, schedule | PASS | Config in one file; fake-clock schedule with a single catch-up run after downtime |
| N1 only new, live, eligible roles, never twice | PASS, synthetic boards | Liveness on by default; dedup across workspace, history and campaigns; re-surfaced only after a repost or title change; every role carries its reason; source errors isolated |
| N1 nothing prepared or applied | PASS | Daily evaluation limit honoured across runs and days; no prepare/apply path |
| N2 follow-ups grounded in the submitted packet | PASS | Claims need quotes from packet, record or notes; wrong recipient/company, invented dates or numbers and filler are blocked by rule checks; draft → audit → final |
| N2 never sent, never marked sent by the agent | PASS | No network code; `followups.markSent` candidate-only (agent and MCP refused) |
| N3 insufficient data is not 0% | PASS | Bands below the minimum show no rate; provisional until 20 outcomes; silence (21 days) never counted as rejection |
| N3 suggestions change nothing | PASS | Byte-for-byte snapshot of profile, config, tracker and reports after suggest/approve/reject/defer; decisions candidate-only |
| N4 sharing controls | PASS | Excluded sources/fields leave the provider context and clear approvals; agent can narrow, never widen |
| N5 setup and import | PASS | Setup checks unit-tested; export → import round trip across two workspaces with backup and approval reset |
| Proposal safety | PASS, mutation-checked | Stale proposals refused; failed groups rolled back and retryable |
| Feature data survives tasks | PASS, mutation-checked | Task commits apply only fields the task changed |
| Stylesheet integrity | PASS | A merge dropped two `@media` closing braces; fixed, and `test-css.mjs` now fails on any unbalanced stylesheet |
| Profile building by conversation | PASS on one live run | `benchmark:profile` on the Claude CLI, three fictional personas: 13 of 13 revealed facts captured in the candidate's words, 0 invented, 85% one-question turns ([details](METRICS-INVENTORY.md#5-profile-building-benchmark)) |
| Claim calibration (undersold ↔ stretched) | PASS on two live runs | Combined grader 24/24 on labelled claims, rules alone 16/24 with no false alarms; a strict candidate's draft had 0 stretched claims, a comfortable one's stretches were all within their line ([details](METRICS-INVENTORY.md#6-claim-calibration-benchmark)) |
| Profile strength card | PASS | Unit-tested, approve/build log verified in the browser suite, both themes and mobile reviewed |
| Real job boards, real providers, real employer sites | NOT VERIFIED | Needs the candidate's machine and accounts |
| Follow-up rule checks on real model output | NOT MEASURED | Expect some false blocks (for example a weekday not in the sources); the blocked card lists each issue |

Outcome module fixes (26 October): `outcome-intelligence.mjs` now places a
score between band edges (3.45, 4.45) in the highest band it reaches, treats
`Evaluated` and `Apply` rows as not applied, and assumes silence only for
`Applied` rows (regression test in `test-outcome-intelligence.mjs`). Still open:
silence ages from the role's saved date and uses current status only;
`outcome-recommendation-state.mjs` refuses any recommendation when any band is
thin and treats `deferred` as final; `score-calibration.mjs` uses different band
edges.

## Agent layer, 25 October 2026

Automated evidence for the conversational agent layer
([plan](internal/AGENT-BUILD-PLAN.md), [contracts](AGENT-CONTRACTS.md)). All runs use
the fixture or scripted agent; **no real provider was called**.

| Claim | Status | What the evidence establishes |
| --- | --- | --- |
| Full repository regression | PASS | `npm run test:full`: every check passed, including Go, adapters, both browser suites and npm audit (0 vulnerabilities). Core `test:plainhand` 200/200 |
| Working state 1: opens on briefing + conversation | PASS, browser | `test-plainhand-agent-ui.mjs` with a connected (scripted) provider |
| Working state 2: link → Applied by conversation | PASS, browser and API | Agent proposes save, evaluate, choose, prepare; the candidate approves the packet in its panel and confirms Applied in the dialog. Form autofill/handoff remain covered by `test-plainhand-ui.mjs`, not driven by conversation |
| Working state 3: grouped proposal, accept, undo | PASS | Interview + contact + next action in one card; undo persists across reload |
| Working state 4: question answered from the digest | PASS | One model call, no actions, streamed text |
| Working state 5: own agent over MCP | PASS, in-process client | Real stdio MCP server and SDK client against a live Plainhand; Claude Code/Codex CLIs not exercised |
| Working state 6: injection safety | PASS, 76 adversarial tests | No unconfirmed write, no tier escalation, no candidate-only result, taint on posting/evaluation/packet/record reads, contact details out of model input by default, budgets hold, cancel leaves nothing confirmable. Four bugs found by this suite were fixed |
| Working state 7: front end matches or beats previous | PASS, reviewed screenshots | Light, dark and mobile for every screen and the conversation |
| Tier enforcement in code | PASS, mutation-checked | Disabling each guard (confirmation, candidate-only, MCP task refusal, undo staleness, own-words evidence, action budget) makes a test fail |
| Claude streaming | PASS, fixture stream | Recorded stream-json shape split across chunks; real CLI stream shape **not verified** |
| Live provider conversation | NOT VERIFIED | Needs a signed-in CLI on the candidate's machine: `npm run test:agent-live -- --provider claude` |
| Session reuse between turns | NOT IMPLEMENTED | Deferred; each model call is a fresh CLI process |
| Conversation latency | NOT MEASURED | The live check records time to first text and per turn |

---

## 19 October 2026

**Not every claim is verified.** All currently accessible checks were run; blocked
provider behavior, unavailable commercial test access and an inconclusive evaluation
remain explicit. Production source was not changed or promoted.

## Results

| Claim | Status | What evidence actually establishes |
| --- | --- | --- |
| Current system repository/build regression | PASS | System-only copy: 21/21 top-level checks; repository suite 298 passed, zero failed, nine reviewed warnings; Go build/package tests, adapters, UI and dependency audit passed |
| Proposed incremental candidate full regression | PASS | Same full system mirror with experimental three-module overlay: 21/21 checks passed; no live model inference in suite |
| Dependency vulnerabilities | PASS, current audit | npm audit reports zero vulnerabilities at run time; not a guarantee of no security bugs |
| Actual CPU speech transcription | PASS, one clip | Previously skipped installed-model test now runs: official public Whisper JFK audio correctly transcribed inside complete local fixture; grouped browser/usage/audio suite 45/45 |
| Actual Google reCAPTCHA demo acceptance | BLOCKED | One live attempt; Google displays “Try again later” and automated-query warning. No usable accepted challenge; no retries/proxies or paid fallback |
| Public commercial ATS field extraction | PASS, observed pages | Greenhouse 19, Lever 15, Ashby 6 fields observed on specific public postings, not complete vendor-wide coverage |
| Native text entry on real rendered ATS markup | PASS, offline only | Greenhouse four, Lever three, Ashby three canonical native fields retained test values; scripts disabled and network locked before typing; zero post-lock HTTP completion |
| Live React/custom dropdown/server validation | NOT VERIFIED | Offline native input does not exercise portal application state or accepted server writes |
| Owned real HTTPS PDF/draft persistence | PASS with declared extension | Real Codex case, actual disk/HTTP receipts and exact PDF hash; positive draft save uses explicit sandbox-only adapter, not native arbitrary write permission |
| Commercial vendor upload/draft acceptance | BLOCKED, access missing | No authorized vendor test posting/account or reviewed real candidate application was provided; owned backend cannot prove vendor acceptance |
| Readiness, source/packet and submission safeguards | PASS, tested cases | Retained regression/fresh readiness cases, private cursor tests, real owned backend, explicit blocked submission and stale-source probes |
| Exact-page process recovery | PASS, tested URL forms | Whole app Node termination resumes correct URL after navigation; no earlier page/upload replay in those cases |
| Exactly-once side effects / non-URL SPA restoration | NOT VERIFIED | Same-page retry reuploaded same PDF and backend deduplicated; this is not exactly-once network action or arbitrary SPA recovery |
| Fictional direct/warm hard constraints | PASS, two outputs | Direct 45 words, max sentence 13; warm 79 words, max sentence 19; both first-person, preserve 8→2, no invented numbers, exact evidence references |
| Fictional answer factual grounding | PASS, controlled review | Separate source reviewer returned passed:true, issues:[] for both outputs |
| Label-blinded fictional voice comparison | PASS on targeted retest (INCONCLUSIVE originally) | Initial judge omitted CV context and returned neither. With separate user authorization for exactly one call, corrected retest with original CV provided correctly matched A=direct, B=warm (retest-report.json). Same-family model; not external human voice acceptance |
| Actual user's voice | OUT OF SCOPE | User explicitly chose fictional checks, no personal writing or human acceptance supplied |
| Universal architecture winner / 90% autonomy | NOT ESTABLISHED | No representative commercial population, independent human voice assessment or complete production migration; limited cases do not justify those claims |

## Full suite and warnings

Both source snapshots pass the full runner, including Go, four legacy adapter
families, browser workflow/themes and npm audit. The current Plainhand browser bridge
still only advertises its implemented host list; passing Workday adapter fixtures
is not live Workday workflow evidence.

Nine repository warnings were inspected: one expected absent-CV warning in the
system-only mirror; eight public upstream-author attribution references in operating
guide/translated README. They are not nine failing tests and must not be concealed
as zero warnings or removed as if they were leaked current-user data. Actual user
CV, profile, narrative, portals, trackers and browser credentials were not copied.
The existing public CPU model cache was linked only for local offline inference.

## CAPTCHA boundary

Installed transcription succeeding on public test audio does not imply Google's
verification service will accept automation. The official demo refused the live
attempt with an automated-query warning. This is direct evidence of a provider
block, not a successful CAPTCHA solve. Test stopped after one attempt. Other
CAPTCHA types/providers and real employer acceptance remain unverified.

## Offline commercial page boundary

Public pages loaded without any candidate profile. Before typing fictional native
field values, page script execution was disabled, all further requests were
aborted and browser context was offline; sockets were blocked. Only browser-native
values were checked. No file, draft, legal choice or submission was attempted.
This deliberately does not prove React state, dropdown fetching or remote acceptance.

Initial Lever smoke rejected labels such as `Full name✱` because test harness only
recognized ASCII required markers. A separate retained follow-up normalized known
Unicode markers and verified three fields. Product code was not modified to make
that test pass. Original failure and corrected measurement both remain available.

## Why commercial test access is needed

An ATS sandbox is a vendor-hosted test account, not our local imitation. It is a
**development verification requirement, not something ordinary Plainhand applicants
need to own**. Real applicants normally use public application forms. Testing with
fictional candidates requires an authorized test environment to avoid writing fake
records or files into actual employers' systems. Alternatively, real preparation
needs an explicitly chosen role and reviewed real candidate data, with final
submission still performed only by the person.

[Greenhouse documents](https://support.greenhouse.io/hc/en-us/articles/17053185557787-Use-a-sandbox)
its sandbox as a separate credentialed environment (Pro tier) with separate API
keys. [Ashby documents](https://developers.ashbyhq.com/reference/authentication)
credential/permission requirements for its integration APIs. This does not mean
all public applicant endpoints require administrator keys. No account signup,
vendor contact, payment, production API mutation or credential search was performed.

## Voice evaluation defect, budget and targeted retest

Initial four authorized calls used: two generations, blinded classifier,
then separate factual review. Both generations satisfied deterministic source/style
checks and factual review, but the original blinded comparison was inconclusive
because the judge prompt omitted the candidate CV required by the rubrics.

Following explicit user authorization ("Allow one extra call"), exactly one targeted
retest call was executed with the original CV included alongside the frozen answers and
rubrics. The model correctly classified A=direct and B=warm with matching reasons
(`fictional-voice/retest-report.json`). All word-count, sentence-length, 8-to-2,
evidence, factual review, and blinded rubric labels matched.

The separate retest ledger (`fictional-voice/retest-budget.json`) recorded 1/1 calls used
(15,730 input / 109 output tokens). Total tracked Codex test calls across all experimental
phases is now **35** (22 benchmark + 12 owned/voice + 1 voice retest). No provider fallback
or retries. Personal candidate voice was not evaluated (user chose fictional samples).

## Next blockers, not hidden completion

- Authorized commercial ATS test access, or selected real role with reviewed real data.
- Permitted usable CAPTCHA environment; current official demo refuses automation.

These prevent declaring “all verified.” They do not justify changing production
architecture wholesale. `Evidence index`
retains passes, negative outcomes, screenshots, telemetry and input fingerprints.
