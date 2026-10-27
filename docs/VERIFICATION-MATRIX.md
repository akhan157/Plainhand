# Plainhand verification matrix


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

Automated evidence for [NEXT-BUILD-PLAN](NEXT-BUILD-PLAN.md) (N1–N6), with the
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
([plan](AGENT-BUILD-PLAN.md), [contracts](AGENT-CONTRACTS.md)). All runs use
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
