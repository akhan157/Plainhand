# VERIFICATION-MATRIX reconciliation (U12)

Row-by-row re-check of [`docs/VERIFICATION-MATRIX.md`](../../../VERIFICATION-MATRIX.md)
against this checkout at `60211d758f21a00a81cdf3fca677156b1447ae8c` (product tip;
the only later commits are these lane documents). Each row is **carried**
(inherited claim, not re-run; the reason says why), **re-run** (command and result
here) or **retired** (the artifact it measured no longer exists).

Nothing in the matrix is deleted or rewritten. A re-run supersedes a count for the
current tree; a carried row keeps its historical result and gains no new verdict.

Commands were run with `TMPDIR=/home/ak/.cache/plainhand-eval-tmp`, one browser
suite at a time, no live provider, no paid call.

## Evaluation harness, 10 November 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Controlled end-to-end evaluation (28/30 then) | **re-run**, 64/67 | `node benchmarks/benchmark-eval.mjs --concurrency 2` → `64/67 scenarios passed (3 expected failures, 0 unexpected)`, 153 s. Evidence `output/evaluation-controlled-2026-11-16T03-10-11-286Z` |
| Profile effectiveness triples | **re-run**, in the same run | The three failures are exactly `profile-effect-{fin,analyst,sci}-minimal` (expected lower-bound controls); every built and seeded triple passed |
| Evaluation scoring (27/27) | **re-run**, in the same run | Section scores are part of every evaluation scenario; 0 unexpected failures. The older 27/27 count is not re-derived separately |
| Connected journey (1/1) | **re-run** | `journey-sci` and `holdout-journey-stem` / `holdout2-journey-stem` passed in the same run |
| Application edge cases | **re-run** | `tests/test-bench-eval.mjs` passed inside `npm run test:plainhand` (581/581); the sandbox scenarios in the run above cover the same paths |
| Live profile-effect subset (PARTIAL 3/6) | **carried** | Live model run: no live provider was authorized in this lane |
| Harness regression test (13/13) | **re-run** | `tests/test-bench-eval.mjs` passed in `test:plainhand` |
| Profile benchmark regression (7/7) | **re-run** | `tests/test-profile-bench.mjs` passed in `test:plainhand` |

## Plainhand 1.1.1 and 1.1.2, 5–6 November 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Full repository suite (Go dashboard, cloud) | **carried** | `npm run test:full` is broader than U12, needs Docker Postgres and network; `go` is not installed here (`go: command not found`). Core and UI gates were re-run separately |
| Hosted Postgres workspace store (6/6) | **carried** | Needs a Postgres instance; no database was started in this lane |
| Live workflow, Claude (10/10) | **carried** | Live model call, not authorized |
| Live workflow, ChatGPT (10/10) | **carried** | Live model call, not authorized |
| Windows installer | **carried** | Produced on GitHub's Windows runner; not reproducible from this host |
| macOS installer | **carried** | Produced on GitHub's macOS runner; not reproducible from this host |
| Real employer sites, read only | **carried** | Live employers and network; no such access in this lane |
| Bugs found on live sites (Lever hCaptcha, Lever labels, Workday wall, embedded form) | **re-run** | `tests/test-plainhand-real-portal-regressions.mjs` passed inside `test:plainhand` |
| Workday after sign-in | **carried** | Requires a real Workday account; still fixture-only |
| Real submission by a user | **carried** | By design only a person submits; no user action here |

## Local rerun, 3 November 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Plainhand core (304/304) | **re-run**, 581/581 | `npm run test:plainhand`, 49.0 s, 0 failures (file list grew; includes the new reachability test) |
| Full repository suite (42 of 44 jobs) | **carried** | Historical count; superseded by later full runs, not re-run here (same Go/Docker reasons) |
| Browser workflow and themes | **re-run** | `npm run test:plainhand-ui` passed (61.8 s: desktop/mobile, light/dark/system, real PDFs, form fill/upload/handoff); plus the U12 browser review, 0 defects |
| Insights band table after fix | **re-run** | `node tests/test-feature-insights-ui.mjs` passed (4.9 s): insufficient states, bands with legacy rows, candidate decisions, light/dark/mobile |
| Remote view (local stand-in) | **re-run**, 6/6 | `npm run test:remote`: 6 pass, 1.1 s |
| Dashboard build | **carried** | Blocked by the missing Go toolchain (`go: command not found`); not a code failure |
| Static dashboard link projection | **re-run**, 2/2 | `node --test tests/test-application-timeline.mjs tests/test-dashboard-data.mjs`: 2 pass |
| Dependency audit | **carried** | `npm audit` needs the registry; no network call made |
| Benchmarks (49/49 simulation, 3/3 invariants, 16/16 controlled, 18/27 calibration) | **partially re-run** | Controlled evaluation re-run above (64/67). Simulation, invariants and calibration were not re-run in this lane; their historical counts stand |
| Real Vercel deploy | **carried** | External account and deploy authority |
| Live provider benchmarks | **carried** | No live provider authorized |

## Plainhand 1.0, 27 October 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Full repository suite | **carried** | See Go/Docker reasons above |
| Live agent on a real CLI (Claude) | **carried** | Live model call |
| Live 1.0 flow end to end (Claude) | **carried** | Live model call |
| Profile building (Claude) | **carried** | Live model call |
| Claim calibration (Claude) | **carried** | Live model call |
| Resume format from the candidate's PDF | **re-run** (renderer and format logic) | `tests/test-resume-format.mjs` passed inside `test:plainhand`; the visual format-card check is covered by `test:plainhand-ui`, not by a byte comparison |
| Real employer sites, inspection only | **carried** | Live employers |
| Fresh copy installs and starts | **re-run** | Fresh `git clone` of `60211d75`: `npm ci` 7.9 s, `npm run setup` 1.2 s, `npm start -- --port 3311` ready in 1.2 s, `GET /` 200, `GET /api/state` 200 (30 keys), server stops with exit 0, `git status --short` empty. No documentation error found |
| Personal data in tracked files | **carried** | One-off human audit; no automated invariant. This lane's diff is code, tests and internal docs and adds no personal data |
| Real submission by a user | **carried** | Design: only the person submits |
| Drafts on first pass (KNOWN) | **carried** | Live model quality, not measured here |

## Finishing the lifecycle, 26 October 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Full repository regression | **carried** | Not re-run (Go/Docker/network) |
| N1 campaigns: one place, pause, schedule | **re-run** | `tests/test-feature-campaigns.mjs` in `test:plainhand` |
| N1 only new, live, eligible roles, never twice | **re-run** | Same file: liveness, dedup, repost/title change, per-role reason |
| N1 nothing prepared or applied | **re-run** | Same file: daily limit across runs and days |
| N2 follow-ups grounded in the submitted packet | **re-run** | `tests/test-feature-followups.mjs` in `test:plainhand` |
| N2 never sent, never marked sent by the agent | **re-run** | Same file: `followups.markSent` candidate-only |
| N3 insufficient data is not 0% | **re-run** | `tests/test-feature-insights.mjs` and `test-feature-insights-ui.mjs` |
| N3 suggestions change nothing | **re-run** | Same two files: byte-for-byte state check, candidate-only decisions |
| N4 sharing controls | **re-run** | `tests/test-actions.mjs` (context exclude/include, approvals cleared) |
| N5 setup and import | **re-run** | `tests/test-setup.mjs` in `test:plainhand`; `node --test tests/test-workspace-import.mjs` 3/3 |
| Proposal safety | **re-run** | `tests/test-agent-*.mjs` in `test:plainhand` |
| Feature data survives tasks | **re-run** | Same agent tests |
| Stylesheet integrity | **re-run** | `tests/test-css.mjs` in `test:plainhand` |
| Profile building by conversation | **carried** | One live run; live model |
| Claim calibration | **carried** | Live model |
| Profile strength card | **re-run** | `tests/test-profile-strength.mjs` in `test:plainhand`; the browser card is exercised by `test:plainhand-ui` |
| Real job boards, real providers, real employer sites | **carried** | External |
| Follow-up rule checks on real model output | **carried** | Not measured; needs live output |

## Agent layer, 25 October 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Full repository regression | **carried** | Not re-run |
| Working state 1: briefing + conversation | **re-run** | `node tests/test-plainhand-agent-ui.mjs` passed (10.8 s) |
| Working state 2: link → Applied by conversation | **re-run** | Same suite (candidate-only approval and confirmation), plus `test-actions` |
| Working state 3: grouped proposal, accept, undo | **re-run** | Same suite (edit, undo, reload) |
| Working state 4: question answered from the digest | **re-run** | Same suite (thread, streaming) |
| Working state 5: own agent over MCP | **re-run** | `tests/test-plainhand-mcp.mjs` 4/4 and `test-actions` MCP bridge test passed |
| Working state 6: injection safety (76 tests) | **re-run** | `tests/test-agent-injection.mjs` passed inside `test:plainhand` |
| Working state 7: front end matches or beats previous | **re-run** (layout and accessibility only) | U12 browser review: 36 captures at 1440 light, 1440 dark and 390 wide; no overflow, focus, console or provenance defect. This is not a pixel comparison with the old front end |
| Tier enforcement, mutation-checked | **re-run** | `tests/test-actions.mjs` in `test:plainhand` |
| Claude streaming (fixture) | **re-run** | `tests/test-agent-streaming.mjs` in `test:plainhand` |
| Live provider conversation | **carried** | Live |
| Session reuse between turns | **re-checked in source** | Still one fresh CLI process per call (`spawn` in `plainhand/agents.mjs`; Claude is invoked with `--no-session-persistence`). Not implemented, as recorded |
| Conversation latency | **carried** | Not measured |

## 19 October 2026

| Check | Disposition | Evidence this lane |
| --- | --- | --- |
| Current system repository/build regression (system-only copy, 298 passed) | **retired** | Measured a system-only mirror plus later overlays that are not part of this checkout; the row cannot be reproduced from this tree and its counts were superseded by later full-suite rows |
| Proposed incremental candidate full regression (overlay) | **retired** | The three-module experimental overlay is not present here |
| Dependency vulnerabilities (zero) | **carried** | Needs the registry |
| Actual CPU speech transcription | **carried** | The mechanism is the optional local CAPTCHA audio solver (`lib/setup-captcha.mjs`, `plainhand/solvers/local-audio.mjs`); its Python model is not installed here and was not re-run |
| Actual Google reCAPTCHA demo acceptance | **carried** | BLOCKED in the matrix; provider-side, unchanged |
| Public commercial ATS field extraction | **carried** | Live pages; the app-side regressions are re-run above |
| Native text entry on real rendered ATS markup | **carried** | Offline live-page run, not reproduced |
| Live React/custom dropdown/server validation | **carried** | Still not verified |
| Owned real HTTPS PDF/draft persistence | **carried** | Needs the owned backend run |
| Commercial vendor upload/draft acceptance | **carried** | BLOCKED: access missing |
| Readiness, source/packet and submission safeguards | **re-run** | `tests/test-presubmit.mjs`, `tests/test-application-record.mjs`, `tests/test-actions.mjs` in `test:plainhand` |
| Exact-page process recovery | **carried** | Needs the process-kill probe; not run here |
| Exactly-once side effects / SPA restoration | **carried** | Still not verified |
| Fictional direct/warm hard constraints | **carried** | One-off fixture output |
| Fictional answer factual grounding | **carried** | One-off controlled review |
| Label-blinded fictional voice comparison | **carried** | Two model calls in the original record; not repeated |
| Actual user's voice | **carried** | Out of scope by the matrix |
| Universal architecture winner / 90% autonomy | **carried** | Not established, as recorded |

## Arithmetic

Rows by section: evaluation harness 8, 1.1.1/1.1.2 10, local rerun 11, 1.0 11,
finishing the lifecycle 18, agent layer 13, 19 October 18 — **89 rows**. This lane
re-ran **38**, partially re-ran **1** (the offline benchmark group), carried **47**,
retired **2**, and re-checked **1** (session reuse) in source. No row was marked PASS
by this lane; re-running a check does not accept the register row that cites it.
