# P2 inventory result (companion to CURRENT-CAPABILITY-INVENTORY.md)

**Status:** P2 source inventory accepted with root corrections; product acceptance remains open. Author proposals below are retained as proposals, not register decisions. Root Codex independently reviewed Claude/DeepSeek authorship.
**Base pin:** `e4da45fa2d21ce1f5945ce11662a73afda03b53f` on `t3/p2-capability-inventory`. No source file differs from main `fb396422d49e3f76f4fed5beb710397950ffa973`: `git diff --name-only` lists only ASSIGNMENT.md, EVIDENCE.json, GOAL-HANDOFF.md, RESULT.md, REVIEW.md and four `docs/internal/` files.
**Author lineage.** First pass: Claude Sonnet 5.5, which wrote the inventory draft then ended in an API 429 rate limit before reporting. That run produced **no verdict and no acceptance**; its partial draft was preserved. Resume: Pi DeepSeek V4.1 Flash thinking max, on root's explicit fallback selection after the 429. Root Codex reviews. No content here inherits approval from either author.
**Tip references:** `867c32956a38788a3099b045b19be450fcd16a86` (tracking) and `a46056fdc53a4159f5b30eae9b3de578efb3767d` (continuation). Read with `git show` only; neither was checked out, merged or executed.

## Scope split

| Class | Items | What closes it |
| --- | --- | --- |
| Local (this lane could run) | All U01–U13 source mechanisms; the 18 probes; the six review-stop falsifiers | Bounded fictional workspace + the probe commands; no live model call required for the structural probes |
| Root decision (not a blocker) | Integration order of `867c329` then `a46056f` (P3); thresholds/budgets/held-out design (P4); how to verify restart persistence and explicit resume against U09 | Root records the choice; no external input |
| External (no lane can close) | A real candidate's own voice and human acceptance; 20–30 human packet ratings for judge calibration; higher-access commercial/CAPTCHA checks only where authorized | Human writing/ratings or authorized access for that tier. Local realistic fixtures and handoffs proceed. Existing authorized provider runs are operationally quota-dependent, not automatically an owner decision. Real employer submission is prohibited and not required |

No row below treats a root threshold/integration choice as an owner blocker.

## VERIFICATION-MATRIX reconciliation

`docs/VERIFICATION-MATRIX.md` is dated evidence, not current capability. Classification: **carryable** = the mechanism still exists on base or a merged lane and can be re-measured; **re-run** = the number/result is dated, environment-bound, or has no artifact in the repo; **obsolete** = a premise current design or a recorded decision has replaced.

| Dated section | Claim summarized | Classification | Anchor / note |
| --- | --- | --- | --- |
| Harness, 10 Nov | Controlled 28/30, profile triples, 27/27 evaluation, journey, edge cases | Carryable mechanism, **re-run** for any current number | Harness lanes merged (`e351344`, `c7cd29c`, `2bb6f68`); controlled deltas are zero by design |
| Harness, 10 Nov | Live profile-effect subset 3/6 | **Re-run**; a product signal, not a pass | `VERIFICATION-MATRIX.md:12`; no current-code live run |
| 1.1.1/1.1.2, 5–6 Nov | Live Claude/Codex workflows 10/10, installers, real sites read-only, live-site bug fixes | Carryable mechanisms; **re-run** for live claims; installer checks are CI-path evidence | Workday after sign-in NOT VERIFIED `:38`; employer submission prohibited; candidate simulation remains local |
| Local rerun, 3 Nov | Core 304/304, full suite 42/44 (Go missing), UI/themes, dashboard, benchmarks | **Re-run**; environment-bound (no Go, no user workspace) | Numbers are not artifacts in this tree |
| 1.0, 27 Oct | Live 1.0 flow, profile building, claim calibration, humanizer, resume format, fresh-copy install | Mechanisms carryable; **numbers re-run**; "one standard resume" is **obsolete** | Replaced prospectively by master record, only on `a46056f` |
| Lifecycle, 26 Oct | Campaigns, grounded follow-ups, insights bands, sharing controls, import, mutation checks | Carryable mechanisms; **re-run** mutation/live follow-up checks | Outcome-module open issues `:109-112` not re-checked |
| Agent layer, 25 Oct | Working states 1–7, injection 76 tests, tier mutation checks, streaming fixture | Carryable mechanisms; **re-run** (this inventory counts 59 `test(` declarations, not 76) | Session reuse still not implemented; real CLI stream unverified |
| Results, 19 Oct | CPU transcription, CAPTCHA blocked, commercial extraction observed, fictional voice retest | Mostly **obsolete/re-run**; voice retest is same-family, one call, not human acceptance | External boundaries below |
| Full suite/warnings | Nine warnings inspected; not failures | **Re-run**; warning count is environment-specific | Do not restate as zero warnings |
| CAPTCHA / commercial page boundary | Provider refused automation; offline native-field checks only | **External**; no source change would close it | No retries/proxies were attempted |
| Voice defect/budget | One corrected same-family judge call matched A/B; 35 tracked calls | **Carryable** as a dated probe; **not** evidence of user voice | User voice OUT OF SCOPE `:165-167` |
| Next blockers | Authorized ATS access, permitted CAPTCHA environment | **External** | Named again in the scope split |

## Adjacent already-merged features

From `port/ai-job-search` (`439b1934b251fc47faf035db15a174132a705efa`, ancestor of main). Producers/storage/consumers are in `WORKFLOW.md:148-175`. None is re-run here.

| Feature | Implementing commit | Producer / storage / consumers | Tests declared | Gap |
| --- | --- | --- | --- | --- |
| Interview prep | `d2b177ef0cddf030e2ec400ea54456a382d75e43` | `interviewPrep.start` task writes `job.interviewPrep[roundId]` (`features/interview-prep.mjs`, registry `:221-235`); Record tab, `interviewPrep.packs`, attention | `tests/test-feature-interview-prep.mjs:75-289` (11) | Scripted provider only; `modes/interview-prep.md` is a separate CLI mode; recap quotes validated, answer truth not judged |
| Fit and discovery | 1.0 baseline `485668cbf3ce4181c3457ada8419a3d05493620d`, `69a7aa9320757f8e052d29bb150788f7cc248381` | `discover`/`evaluate` tasks (`workflow.mjs:172-222`), campaigns; score and recommendation on `job.evaluation` | `tests/test-plainhand.mjs:229`, `tests/test-feature-campaigns.mjs`, `tests/test-requirement-evidence.mjs`, `tests/test-calibration.mjs` | Level-aware prompt for junior roles (`agents.mjs:239`); no borderline/hard-blocked cases across career stages |
| Email status proposals | `14a5fd65d34574dddc7ab63fdd738779197d0258` | `inbox.add` (write), `inbox.apply` (candidate) (`features/inbox.mjs:366-455`); `state.inbox` | `tests/test-feature-inbox.mjs:61-271` (13) | Rule matching plus provider proposals; scripted provider; no real mail by design |
| Skill-gap and learning plan | `7132d625b296fb31218dac0c9e9fca580cc9253d` | `skillPlan.build` task, `state.skillPlan`; `clusterGaps` (`profile-strength.mjs:44`) | `tests/test-feature-skill-plan.mjs:54-159` (7) | Lexical clustering (Jaccard 0.4); never writes the profile (tested `:146`) |

## Gaps no U row fully covers

- **User intervention and repeated fact questions.** No counter exists; the harness rescue count is for form fields (`score.mjs:218`), not onboarding turns or repeats. No measure of "turns to a reviewed record plus first packet".
- **Full versus conversation-built memory comparison.** Profile-effect triples compare minimal/built/seeded *profiles*, not two memory stores across a restart or move; import/transfer drops keys (inventory finding 1).
- **Voice, preference and correction reuse across providers.** The provider-switch test checks hash, approval, conversation, record and understanding equality (`tests/test-brain-controls.mjs:104-122`); no test that a writing sample or approved correction changes a later packet under provider B, and the bank is absent from provider context (finding 3).
- **Semantic relevance and order.** Only lexical measures exist: kept/changed/added (`standard.mjs:37-50`), `tailoringOf` required-fact presence and `leadShare` (`a46056f:plainhand/evaluation/score.mjs:46-88`). The judge rubric has a relevance dimension (`judge.mjs:11`) but needs a raw packet and a live judge; no held-out semantic case.
- **PDF and DOM uploads.** Harness readback plus SHA-256 covers DOM uploads (`evaluation/portals.mjs`); the extension upload path has no located hash check. Layout/page-count is not checked; text extraction only (`ats-check.mjs:118-159`).
- **Judge calibration.** No human ratings exist; any report is "uncalibrated" (`EVALUATION-JUDGE.md`); self-judged runs are flagged (`benchmark-judge.mjs:66-67`) but not blocked.
- **Contradiction surfacing.** No structured fact/provenance/contradiction store; planted contradictions are not surfaced by a located mechanism (finding 6).

## Unmerged-branch review stops (root-confirmed)

Evidence class: source inspection at the cited tips; the root probe is named but was not re-executed here. None is a PASS or FAIL of the branch as a whole.

| Stop | Tip:line | Falsifier | State |
| --- | --- | --- | --- |
| Hosted Export CSV/calendar 404 (shared UI, local-only routes) | `867c329:plainhand/web/ui/applications.mjs:118-119`, `867c329:plainhand/cloud/app.mjs:400,508`, `867c329:plainhand-server.mjs:197,202` | Click either export in hosted; file vs `Not found.` | Tracking lane fixing after Gate 1; tip still carries it |
| CSV bare CR stays a record boundary | `867c329:plainhand/exports.mjs:28-30` | Tracker row with embedded `\r`; parse; count records | Same |
| Legacy tracker rows vanish in Board | `867c329:plainhand/web/ui/applications.mjs:48-50,113,128,136` | One legacy row; switch Table→Board; expect a card/notice | Same |
| Indeed generic `/viewjob` path matches any saved job | `a46056f:plainhand/cloud/extension-api.mjs:92-99,110-118` | Save A, load B (`jk` differs), then unknown id; expect no match/B | Continuation acceptance stopped; no fix in this lane |
| Master digest omits a consumed heading | `a46056f:plainhand/standard.mjs:11,21,30`; resets only on task rewrite `a46056f:plainhand/workflow.mjs:268` | Approve; retitle Analyst→Director; `standardStatus` still `approved` | Same |
| Employer-vocabulary number exemption ignores claim subject | `a46056f:plainhand/claim-calibration.mjs:54-58,68` | "I led teams in 28 countries at your company" with 28 only in the posting; expect `number-not-in-sources`, observe none | Same |

## Probes (concrete, no new features)

Each probe runs on a bounded fictional workspace; none was run for this inventory.

| # | Rows | Input / command shape | Artifact |
| --- | --- | --- | --- |
| 1 | U01 | Scripted-candidate onboarding, non-engineering persona; count turns, repeated questions, manual edits; separate clean-machine install | Transcript + counters |
| 2 | U02 | Fill memory, restart process, reload; diff memory and approvals | Before/after state JSON |
| 3 | U02, U12 | Export, import into an empty workspace; diff `writingSamples`, `claimLine`, `standard`, `resumeFormat`, `settings`, answer bank, corrections | Key-by-key diff |
| 4 | U02 | Plant a CV/story contradiction; run prepare; search packet and questions for any surfacing | Packet + search result |
| 5 | U03 | Multi-role master with planted old role, license, gap; `masterCoverage` vs judge; assert master byte-identical across `tasks.prepare` | Coverage list, hash before/after |
| 6 | U04 | Paired jobs where correct selection differs; plant old relevant role; `tailoringOf` + judged relevance | Two packets, scores |
| 7 | U05 | Two contrastive sample sets, same persona/job; blind judged attribution (synthetic, not user voice); then "shorter" revision; assert review re-ran and quotes survive | Labelled outputs, review records |
| 8 | U06 | Two applications, settled and unsettled facts; count every question, flag repeats; include a re-worded label | Question log |
| 9 | U07 | Render controlled packet to PDF; `pdftotext` diff vs reviewed text; planted claims through the independent checker | Text diff, claim verdicts |
| 10 | U08 | Harness once per ATS shape; three-row table with access tier and host | Table + evidence dir |
| 11 | U08 | Manual kit on unsupported host with tracker intact (needs P3) | Screenshot + tracker diff |
| 12 | U09 | Enqueue three tasks, kill mid-task, restart; record states and lost work | Task state dump |
| 13 | U09 | Same inputs single vs queued; same scorers and the P4-frozen bound | Scored comparison |
| 14 | U10 | CSV/calendar from a fictional workspace with a hostile company name; re-import workspace JSON; diff tracker | Files + tracker diff |
| 15 | U10 | Insights at 5 and 25 outcomes; assert no rate under the minimum | Rendered bands |
| 16 | U11 | `context.exclude` set; capture every provider input in one full run; grep excluded values/contacts; re-run matrix mutation checks | Captured inputs, mutation results |
| 17 | U12 | Reachability table for ~81 registry actions × UI/agent/MCP/CLI | Matrix |
| 18 | U13 | Judge CLI over one controlled evidence dir with a fake judge; confirm raw packet and template exist before any live call | `judge.json`, template |

Structural probes for the six stops: S1 hosted export click, S2 bare-CR parse, S3 legacy board switch, S4 Indeed `jk` A/B/unknown, S5 approve→retitle→status, S6 first-person posted number. Each is minutes, no model call.

## Checks actually run for this document

`git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, `git status --short`, `git diff --name-only fb396422 e4da45f` (nine records/docs paths, no source), `git diff --stat fb396422 e4da45f -- plainhand lib tests adapters extension benchmarks modes` (empty), `git show <tip>:<file>` and `git grep` over the two unmerged tips, `wc -l` on both docs. **Not run deliberately:** no test suite, benchmark, browser, server, live provider or model; no merge, checkout, push, register/handoff/manifest/board edit; no provider switch beyond the root-directed fallback.

## Proposed dispositions (root decides)

U01–U12 `in_progress`, U13 `not_run`. No row is proposed `PASS`; no stop above is a row verdict. Counts: 12 in_progress, 1 not_run, 0 PASS. This author does not accept its own work; root Codex reviews the diff, and only root updates the register.

**Docs commit:** the single commit on `t3/p2-capability-inventory` that adds this file and the inventory; exact SHA is reported to root and is not restated here.
