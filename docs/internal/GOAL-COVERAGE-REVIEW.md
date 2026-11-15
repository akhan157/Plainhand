# Goal coverage review

**Status:** proposed review map. Not accepted, not self-approved. Written 2026-11-14.
**Purpose:** show where each owner need and recovered decision lands in [UNIFIED-GOAL.md](UNIFIED-GOAL.md), what evidence is missing, and what disposition the reviewer is asked to consider. Dispositions below are **proposals for the reviewer and owner**. The author makes no approval.

## Authoring route

- The scope-document task was first routed to a Go DeepSeek author. That attempt failed with insufficient balance and produced **no verdict and no output**; nothing from it was used.
- The author was then escalated to the subscription-backed `claude-pool` / `claude-sonnet-5-5` at effort high.
- Independent review is assigned to root Codex `gpt-6.1-sol`. The author is a Claude-family model and the orchestrator family is also Claude, so Codex review is the cross-family check. The author does not review or accept its own text.

## Owner needs to acceptance IDs

| Owner need or recovered decision | Where it lands | Missing evidence | Proposed disposition (for reviewer) |
| --- | --- | --- | --- |
| Persistent goal consolidating prior threads, this thread as control plane | UNIFIED-GOAL header; BRANCH-RECONCILIATION threads | Root has not yet integrated these documents on the goal branch | Reviewer confirms IDs and SHAs, then root integrates |
| Finance, tech, STEM and related professionals; not nurses, trades or hourly | UNIFIED-GOAL outcome and scope; U01, U13 (persona set) | The decision file sits on an unmerged branch; no review that every prompt and corpus on main is field-neutral | Accept as stated; check main's corpus for engineering bias in P2 and P4 |
| Master career record canonical; master resume derived and inspectable | U03 | No live validation of master or tailoring (continuation branch) | Keep `in_progress`; first evidence is P3 then P5 |
| Per-job selection and order, no forgetting older relevant roles | U04 | Same as above; no held-out cases yet | Keep `in_progress` |
| Candidate memory: facts, provenance, contradictions and unknowns, preference, voice, several samples, strengths and constraints; editable and deletable; persists across providers and restarts; sharing controls; approved corrections reused; no invented identity | U02 | Existing brain controls exist from 26 Oct claims, on synthetic data; no restart or provider-switch test recorded in the documents read; no contradiction-handling evidence | Keep `in_progress`; reconcile existing claims in P2 |
| Conversational packet revision | U05 | A 27 Oct live revision claim exists (190 to 115 words); not re-run | Keep `in_progress` |
| Reusable source-grounded answers; no repeated questions when sources settle it | U06 | Answer-bank and "source-settled" fill (`edd1f02`) are inherited claims; no repeat-question counter | Keep `in_progress`; add the counter in P4 |
| Evaluation, discovery, truthful documents, reviewed packet, PDF and ATS fidelity | U07, U10 (discovery and tracking) | PDF and ATS-parse checks beyond "real Chromium PDFs" are not described in the documents read | Keep `in_progress` |
| Form fill plus user review; never submit; sensitive decisions candidate-only | U08, U11 | Real-site writes are external; owned portal and local forms are the substitute | Keep `in_progress` |
| Tracking, follow-ups, outcome recommendations | U10 | Competitor-branch features unmerged and untested in this task | Keep `in_progress` after P3 |
| Batches, queues, resume, retry, cancel inside opt-in autonomy and limits | U09 | Queue code is claimed in V1-GOAL (V7); quality-in-queue vs single run was never measured | Keep `in_progress` |
| Stale evidence invalidates approvals; tainted content cannot escalate | U11 | Claimed in older matrix with mutation checks; not re-run | Keep `in_progress` |
| Greenhouse, Lever, Ashby measured separately; Workday best effort; LinkedIn and Indeed existing behavior only | UNIFIED-GOAL decisions; U08 | Per-ATS measurement table does not exist; Workday after sign-in is NOT VERIFIED in the matrix | Keep `in_progress` |
| Unsupported site never blocks preparation; manual kit keeps tracking | UNIFIED-GOAL decisions; U08 | Kit is on the unmerged continuation (`942d80c`, `a46056f`) only | Keep `in_progress` after P3 |
| No blanket all-sites or zero-effort promise | UNIFIED-GOAL "Not promised" | None | Reviewer checks that no row claims either |
| Low-friction onboarding | U01 | No intervention-count baseline | Keep `in_progress` |
| Privacy, release-quality UI and CLI parity, reachability, fresh install, export and import | U11, U12 | No reachability matrix; fresh-install test is from 27 Oct and 5 Nov on older commits | Keep `in_progress` |
| Historical capability parity retained; hosted optional, not a wholesale rebuild | UNIFIED-GOAL decisions; U12 | Status reconciliation of VERIFICATION-MATRIX not done | Keep `in_progress`; do P2 |
| Adjacent work (interview prep, fit and discovery, email status suggestions, learning plans): inventory, do not expand | UNIFIED-GOAL decisions; U12 | Inventory not written. Main contains these from `port/ai-job-search` | Keep `in_progress`; inventory in P2 |
| Evaluation: frozen SHAs, scenarios, rubrics, budgets; negative controls; messy multi-role personas; held-out; paired profiles; baseline vs change | U13 | Nothing frozen. The benchmark thread's live baseline and judge did not run | Keep `in_progress`; P4 before any live run |
| Independent judge family; quote validation; calibration against 20–30 human packets; uncalibrated report without them | U13; external check 1 | No human ratings exist | Open external check. Reports say "uncalibrated" until then |
| Real PDF checks, real-browser DOM readback and upload hash, false-ready, sensitive and unauthorized-submit detectors, access tier | U07, U08, U13 | Harness has several of these (DOM hash, readback, false-ready) per the harness doc; not re-run | Keep `in_progress`; tier labelling is new |
| Measure interventions, repeated questions, rescue burden, success, time, calls, usage, variance; never reward volume | U01, U06, U13 | Rescue burden and calls exist in the harness; repeated-question and intervention counts do not | Keep `in_progress` |
| No invented numerical targets; thresholds pre-registered and approved; release acceptance open | U13; external check 5 | No thresholds frozen | Open until owner approves |
| Historical claims need reconciliation, not blind carry-over | UNIFIED-GOAL status table; U12 | Not done | P2 |
| Commercial write acceptance, user voice validation, human ratings are external; local substitutes first | UNIFIED-GOAL external checks | All three external | Remain open. A substitute is never described as equivalent |
| Provider quotas are an operational blocker, not product failure | U13 | None | Record quota stops as blockers |
| New paid services, real-account writes, main merges, push, release, deploy not authorized | UNIFIED-GOAL safety; ASSIGNMENT | None | Reviewer confirms nothing in these files authorizes any |

## Decisions that supersede older text

| Older assumption | Superseding decision | Source |
| --- | --- | --- |
| "One standard resume and cover letter" (V1-GOAL V3, VISION-GAP part 2) | Master career record plus derived master resume; per-job selection | `PRODUCT-DEFINITION.md` on `t3/competitor-workflow-improvements-1`, adopted in the unified goal |
| Engineering-led personas and demo data (harness corpus, e.g. `mech-grad`) | Audience is finance, tech, STEM and adjacent; field comes from the candidate | Same |
| Workday and long-tail sites described as unsupported or "flag the rest" (VISION-GAP) | A job from an unsupported site is never refused; manual kit | Same |
| Workday listed as a Tier 1 build (VISION-GAP) | Best effort with handoff; Workday after sign-in remains NOT VERIFIED | Matrix, 5 Nov 2026 |
| LinkedIn and Indeed assist mode as new work (VISION-GAP tier 1) | Existing behavior only; no new autonomous-board promise | Owner brief |

Historical evidence is kept. Only the forward-looking assumption changes.

## What the reviewer is asked to check

1. Every owner need above maps to at least one ID, and no ID carries PASS.
2. Each falsifier in the unified goal can actually fail, with named evidence.
3. No document claims a result that was not run in this task.
4. No file authorizes a submission, a main merge, a push, a deploy, a paid service or a real-account write.
5. No host-specific absolute path or user data appears.
6. The two competitor branches are described as siblings with a five-file overlap, and the SHAs match `git`.

## Open points for the owner

- Which unmerged competitor branch merges first, and whether the tracking exports (`867c329`) are wanted at all.
- Whether the 20–30 human ratings are possible, and by whom.
- Who may approve the pre-registered thresholds.
- Which older threads are settled after this review.
