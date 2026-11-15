# Plainhand personal engine: unified goal

**Status:** scope document, proposed. Not accepted. Written 2026-11-14 by a scope-document author; the owner or the control-plane thread accepts it, not the author.
**Control plane:** thread `f3b1cc2a-de89-4fc8-9a17-5e96a84d34a6`. **Goal branch:** `goal/plainhand-personal-engine`, created from `main` at `fb396422d49e3f76f4fed5beb710397950ffa973`.
**Companions:** [BRANCH-RECONCILIATION.md](BRANCH-RECONCILIATION.md), [GOAL-COVERAGE-REVIEW.md](GOAL-COVERAGE-REVIEW.md).

## How this document relates to older ones

This document supersedes conflicting product assumptions in older goal documents
**prospectively**. It does not rewrite them and it does not erase their evidence.
Older documents stay as history and keep their status labels.

| Older document | What stays | What this document replaces going forward |
| --- | --- | --- |
| [PRODUCT-BUILDOUT-GOAL](PRODUCT-BUILDOUT-GOAL.md), [AGENT-BUILD-PLAN](AGENT-BUILD-PLAN.md), [NEXT-BUILD-PLAN](NEXT-BUILD-PLAN.md) | Capability list, phases, boundaries, action registry and tier model | Their "done" claims are inputs to reconcile (U12), not results |
| [V1-GOAL](V1-GOAL.md), [VISION-GAP](VISION-GAP.md) | Site decisions, no-submission rule, autonomy default of "ask per application" | "One standard resume and cover letter" becomes a master career record and master resume (below). LinkedIn and Indeed wording follows "Sites" below |
| [EVALUATION-HARNESS](EVALUATION-HARNESS.md), [EVALUATION-JUDGE](EVALUATION-JUDGE.md) | Mechanisms, tiers, scorers, judge design | A controlled run stays a regression gate, never a quality score. Release acceptance needs the frozen design in U13 |
| [VERIFICATION-MATRIX](../VERIFICATION-MATRIX.md) | Every dated row as a record of what was run | Carry-over of old PASS rows as current truth. Each historical claim needs status reconciliation against current code and evidence (U12) |
| `PRODUCT-DEFINITION.md` on `t3/competitor-workflow-improvements-1` (decided 2026-11-14, not on main) | Adopted here as the audience, master-record and manual-path decision | It reaches the goal branch only when that branch is integrated (see BRANCH-RECONCILIATION) |

## Outcome

An evidence-grounded **personal job-search agent** for finance, technology, STEM
and related professional and knowledge roles. Out of scope: nursing and clinical
roles, skilled trades, retail and hourly or shift work. Nothing should break for
those users, but nothing is designed, demoed or measured for them.

The product holds:

1. A complete **master career record** that is the canonical evidence.
2. A **master resume** that is an inspectable, derived, complete representation
   of that record.
3. A **tailored resume per job** that selects and orders relevant experience for
   that job without forgetting older relevant roles.
4. **Candidate memory**: facts with provenance, contradictions and unknowns,
   preferences, voice and taste, several writing samples, strengths and
   constraints. It is editable and deletable, persists across providers and
   restarts, has sharing controls, and uses approved corrections later. It never
   invents identity.

On top of that it does the work of a job search:

- Evaluation and discovery.
- Truthful CV, resume, cover letter and answers; a reviewed packet; PDF and ATS
  fidelity.
- Conversational packet revision and reusable, source-grounded answers, so the
  candidate is not asked what the sources already settle.
- Form fill with a final field-by-field check by the user.
- Tracking, follow-ups and outcome recommendations.
- Batches, queues, resume, retry and cancel, within opt-in autonomy and limits.

**It never submits or sends anything to an employer.** Sensitive decisions are
the candidate's. Stale evidence invalidates approvals. Tainted content cannot
escalate authority.

## Scope and decisions

| Topic | Decision |
| --- | --- |
| Audience | Finance, tech, STEM and adjacent professionals, intern to director. Benchmark personas run from new graduate to senior manager. Licenses and certifications are first-class evidence. The field comes from the candidate, never from a default |
| Master record | One complete record, approved by the candidate in wording they stand behind. It replaces the "standard resume" as the thing every application starts from. Tailoring selects, orders and adapts from it and never edits it |
| Supported ATS | Greenhouse, Lever and Ashby are measured **separately**, each at the support actually in the code. Workday is best effort with handoff (owner brief; the verification matrix only records Workday after sign-in as NOT VERIFIED). No claim beyond measured support |
| LinkedIn and Indeed | Save, prepare, manual kit, or user-driven extension, **within existing behavior**. No new autonomous-board promise. Which baseline counts as "existing" is an open owner point: V1-GOAL says no automation of those pages, while unmerged `a46056f` matches board postings in the extension (see GOAL-COVERAGE-REVIEW) |
| Unsupported site | Never prevents packet preparation. The complete manual kit (link, tailored PDFs, each answer with a copy control) is produced and tracking continues |
| Autonomy | Ask per application by default. Preparing on its own is opt-in, within limits, and never submits |
| Wording line | Market-norm default from V1-GOAL stays: own your part of a result, rounding stated as rounding, titles, employers, dates, degrees and level exact |
| Hosted | Optional. Not a wholesale rebuild and not required for any row below |
| Historical parity | The capability set in PRODUCT-BUILDOUT-GOAL, AGENT-BUILD-PLAN and NEXT-BUILD-PLAN is retained. Parity is checked in U12, not assumed |
| Adjacent career work | Interview prep, fit and discovery, email status suggestions, learning plans: **inventory what exists** (U12). Do not expand by default |
| Not promised | A blanket "all sites" promise, a "zero-effort" promise, automatic submission, automatic sending |

## Acceptance table

Every row is **`in_progress` / `not_run`**. No row has PASS. A row changes only
when the evidence named in its third column exists and an independent reviewer,
not the author of the work, accepts it. Test counts and PASS lines inherited from
older documents or branch reports are claims to re-check, not evidence.

| ID | Requirement | Status | Evidence required | Falsifier (any one fails the row) |
| --- | --- | --- | --- | --- |
| U01 | **Low-friction onboarding.** A new candidate reaches a reviewed master record and a first prepared packet by conversation and import, with few interventions | in_progress / not_run | Fresh install on a clean machine, fictional persona, run end to end. Counts of user turns, repeated questions, manual edits and rescues. Time and calls. Variance across repeats | A required step needs a hand-edited file. The same known fact is asked twice. Onboarding assumes a field, degree or career stage. Interventions are not measured |
| U02 | **Durable candidate memory.** Facts with provenance, contradictions and unknowns, preferences, voice and taste, several writing samples, strengths and constraints. Editable and deletable. Survives restart and a provider switch. Sharing controls. Approved corrections reused later. No invented identity | in_progress / not_run | Restart and provider-switch test on memory contents. Edit and delete tests with downstream effect. A planted contradiction is surfaced, not silently resolved. An approved correction changes a later packet. An excluded source leaves provider context and clears approvals | Memory differs after restart or provider switch. A deleted fact still appears in a packet. A contradiction is resolved without the candidate. A fact has no source. Identity detail appears that no source holds |
| U03 | **Master completeness.** The master record is complete and canonical. The master resume is derived from it, inspectable, with no length limit, and lists what it missed | in_progress / not_run | Multi-role, multi-stage fictional personas with older roles, certifications and a career gap. Check each source role, result and credential appears in the master or is listed as missing. Tailoring leaves the master byte-identical | A source role, result or credential is silently absent. The master adds an unsupported line. Tailoring changes the master. The old standard resume is treated as current without a flag |
| U04 | **Per-job relevance and order.** Each tailored resume selects and orders for the job and keeps older relevant roles | in_progress / not_run | Paired jobs with the same persona where the right selection differs. Held-out cases. Scored selection and order, plus an old-but-relevant role planted. Judge on relevance with quote validation | An older role that matches the job is dropped. An irrelevant role leads. Two different jobs produce the same selection. Selection is correct only because the job vocabulary was copied |
| U05 | **Voice and conversational revision.** Several writing samples shape voice. "Shorter", "lead with X" revise a packet by conversation and re-run review | in_progress / not_run | Revision tests that re-run factual review and rendering. Synthetic contrastive voice samples as the local substitute. User voice validation is external (see External checks) | A revision breaks a verified claim. Revision skips review. Output ignores the sample. A synthetic result is reported as user-voice acceptance |
| U06 | **Grounded reusable answers with uncertainty.** Answers cite sources, flag what is unsettled, and are reused. No repeated question when sources settle it | in_progress / not_run | Repeat-question counter over a multi-application run. Planted settled and unsettled facts. Answers given to flagged fields offered to the answer bank | A settled fact is asked again. An unsettled fact is answered without a flag. An answer cannot be traced to a source. A sensitive answer is reused without the candidate |
| U07 | **Packet fidelity.** Truthful CV, resume, cover letter and answers. Reviewed packet. Real rendered PDF text, layout and ATS checks | in_progress / not_run | Independent claim check with validated source quotes. Planted unsupported claims are caught (negative controls). Real PDF text extraction, layout and ATS-parse checks against rendered files | A planted unsupported claim passes. A PDF drops or reorders text. The reviewed packet differs from what is attached. Claim numbers are matched without the source |
| U08 | **Application and site paths.** Greenhouse, Lever and Ashby measured separately; Workday best effort with handoff; LinkedIn and Indeed save, prepare and manual kit; unsupported sites never block preparation. Form fill ends in a user review with provenance for each field. Never submits | in_progress / not_run | Real-browser DOM readback and upload-hash check per supported ATS on local realistic forms and owned portals. Manual-kit run on an unsupported site with tracking intact. False-ready, sensitive-field and unauthorized-submission detectors with planted failures. Access tier recorded per run: local fixture, offline capture, or real-site read-only | A field is filled without recorded provenance. A sensitive field is auto-filled. A submit control is clicked. Ready is reported while the DOM disagrees. An unsupported site blocks packet creation. A fixture result is cited as real-site support |
| U09 | **Quality-preserving queues and autonomy.** Batches and queues, resume, retry, cancel, opt-in autonomy within limits | in_progress / not_run | Interrupt-and-resume, per-item retry and cancel tests. Daily limit honored. Packet quality in a queued run compared with a single run on the same inputs | Quality drops in a queue relative to a single run. A limit is exceeded. Autonomy is on by default. Cancel leaves a confirmable action. A restart loses queue state |
| U10 | **Tracking and learning.** Tracker, contacts, calendar, imports and exports, follow-ups, outcome recommendations | in_progress / not_run | Round-trip import and export. Stage board, contact roll-up, calendar and CSV from the unmerged branches, re-tested. Follow-ups cite the submitted packet. Recommendations remain candidates until approved and show insufficient data | A follow-up is marked sent without the candidate. Insufficient data is shown as a rate. A recommendation changes configuration unapproved. An import corrupts the tracker |
| U11 | **Privacy, approval and injection safety.** Candidate-only decisions, stale evidence invalidates approvals, tainted content cannot escalate | in_progress / not_run | Adversarial postings and notes. Approval invalidated by a changed source or exclusion. Tier checks mutation-tested. Provider-context contents inspected. No user data in tracked files | Posting text causes an unconfirmed write or tier escalation. An approval survives a changed source. Contact detail reaches a provider by default. A candidate-only action runs from an agent |
| U12 | **Release-quality product.** UI and CLI parity and reachability, fresh install, export and import, historical capability parity and status reconciliation, hosted optional, adjacent-work inventory | in_progress / not_run | Reachability matrix for each registry action across screen, conversation, CLI and MCP. Fresh clone `setup` then `start`. Workspace export and import into a new workspace. Each row of the VERIFICATION-MATRIX re-checked against current code and marked carried, re-run or retired. Inventory of interview prep, fit and discovery, email status suggestions, learning plan, listing what exists and its evidence | A capability exists in only one surface. A fresh install needs undocumented steps. Import loses data. A historical PASS is carried over with no current evidence. Hosted is required for any row |
| U13 | **Evaluation harness and independent measurement.** Pre-registered, repeatable, independent of the builder | in_progress / not_run | See "Evaluation acceptance" below | See below |

U13 is the measurement row the others depend on. It is numbered after U12 so the
twelve product rows stay U01–U12.

## Evaluation acceptance (U13)

Frozen **before** any live run, recorded in the repository: target SHAs,
scenarios, rubrics, budgets, and the judge and judge-prompt versions.

- **Controls.** Negative controls and planted failures that the scorers must
  catch. A scorer that cannot fail is not evidence.
- **Personas.** Messy, contradictory, multi-role and multi-stage careers across
  the audience fields. Held-out cases not used while tuning.
- **Pairs.** Repeated paired runs of minimal, conversation-built and full
  profiles on the same jobs. Baseline against changes, same judge and prompt.
- **Judge.** A different model family from the one under test. Source quotes
  validated by code. A claim of "calibrated" requires 20–30 packets rated by a
  human with the same rubric and the existing calibration run. **Without human
  ratings the report says "uncalibrated" and lists the open external check.**
  Synthetic and local substitutes come first and are not described as
  equivalent.
- **Real artifacts.** Real rendered PDF checks; real-browser DOM readback and
  upload hash; false-ready, sensitive-field and unauthorized-submission
  detectors; the access tier recorded (local fixture, offline capture, owned
  portal, real-site read-only).
- **Measures.** User interventions, repeated known-fact questions, manual edit
  and rescue burden, task success, time, calls and usage, and variance. Raw
  volume (more applications, more packets) is never a reward.
- **Thresholds.** No numerical target is invented here. Thresholds are
  pre-registered during baseline design, then approved and frozen. **Release
  acceptance stays open until that approval.**
- **Provider quotas** are an operational blocker, recorded as such, not as a
  product failure and not as a skipped pass.

## Next packets and gates

Order matters; each packet ends in a reviewer's disposition, never self-accept.

| # | Packet | Gate before it starts | Output |
| --- | --- | --- | --- |
| P1 | Root integrates these three documents into the goal branch and writes any handoff or register | Root reads the diff independently | Committed scope on the goal branch |
| P2 | Reconcile the VERIFICATION-MATRIX and the historical claims against current code. Read-only inventory of adjacent features (U12). Start from `WORKFLOW.md`, which already names producers and consumers for interview prep, the skill-gap plan, email status proposals and the PDF ATS check | P1 | Table per claim: carried, re-run or retired. No new PASS |
| P3 | Decide integration of the two unmerged competitor branches (siblings; a read-only merge-tree of the two shows one content conflict, in `package.json`; see BRANCH-RECONCILIATION). Merge into the goal branch only, then re-run their tests fresh | Owner or root approves the order; main merges are not authorized | A merged goal branch with fresh test evidence, or a documented decision not to merge |
| P4 | Freeze the evaluation design (U13): SHAs, scenarios, rubrics, budgets, controls, held-out set, threshold-setting protocol | P3 so the target SHA is final | Frozen design document, committed before any live run |
| P5 | Gap work on memory and master/tailoring (U02–U04) against the frozen scenarios, including a deterministic elicitation checklist (prompt wording alone failed in the analyst case) | P4 | Code and tests. Rows stay `in_progress` |
| P6 | Live baseline, then change comparison, with a judge family different from the provider under test, and the quota plan | P4, provider quota available, budget approved | Evidence directories. Rows move only by reviewer disposition |
| P7 | Application-path measurements on local realistic forms and owned portals, per ATS (U07, U08) | P4 | Per-ATS table with access tier |
| P8 | Queues, autonomy, recovery, tracking and learning (U09, U10) | P5 | Tests and evidence |
| P9 | Release pass: UI and CLI parity, fresh install, export and import (U12) | P3 onward | Reachability matrix and install log |

## External checks (not completed by this work)

These need a human, a site or an owner decision. Setup does not authorize them.

1. A person rates 20–30 packets for judge calibration.
2. Voice validation by the actual user with their own writing.
3. Real-candidate validation on onboarded, reviewed data. The main working
   checkout is system-only; per the owner brief, `doctor` reports `cv.md`,
   `config/profile.yml` and `portals.yml` missing (not re-run by the author).
   That does not block fictional development.
4. Commercial-site write acceptance: an authorized vendor test account or an
   explicitly chosen real role with reviewed data. Final submission stays with
   the person.
5. Approval of the pre-registered thresholds.
6. New paid services, real-account writes, pushes, releases, deploys and merges
   to main.

## Safety and authority

- No submission, no sending to an employer, by any packet. A control that might
  submit is not clicked.
- Candidate-only actions stay candidate-only. Untrusted text taints the turn.
- Recruiter-facing text follows the humanizer process (draft, audit, final).
- No fictional application is sent to a real employer. No real-employer write
  without the external authorization above.
- The author of a piece of work cannot accept it. Acceptance is an independent
  reviewer's disposition recorded outside the author's own report.
- Older threads are settled by the owner after the coverage review. This
  document settles, archives and deletes nothing.
- Records carry thread IDs and SHAs, and no host-specific absolute paths or
  user data.
