# Career-Ops Product Strategy and Roadmap

**Document type:** Product strategy brief, product requirements outline, and phased roadmap
**Product:** Career-Ops
**Status:** Directional plan
**Last updated:** 2026-08-11
**Related research:** [Competitive Landscape](COMPETITIVE-LANDSCAPE.md)
**Buildout goal:** [Product Buildout Goal](PRODUCT-BUILDOUT-GOAL.md)
**Plainhand direction:** [Candidate Brain and Autonomous Execution](CANDIDATE-BRAIN-AND-AUTONOMY.md)

The Plainhand direction adds a persistent, reviewed candidate model—experience,
evidence, goals, personal context, and writing voice—as the foundation for
provider-portable application work. It specifies the profile-first build sequence
and records candidate-selected automatic submission as a future proposal;
current manual-submission rules remain in force.

The [Plainhand browser application](PLAINHAND-BROWSER-APP.md) now implements a
local candidate interview, CLI provider connections, on-demand ATS discovery,
evidence-linked evaluation, reviewed PDF packets, standard-field browser
assistance, and tracker integration. Its automated acceptance tests use explicit
synthetic providers; live account/site compatibility and the documented remaining
limits must not be presented as completed roadmap capabilities.

This document turns the current Career-Ops capabilities, competitive research, and build recommendations into one product direction. It separates what exists today from what is planned. Planned items are goals, not claims about current functionality.

## 1. Executive summary

Career-Ops is a local-first AI job-search operating system. It helps a candidate discover roles, verify that postings are live, decide whether a role deserves their time, generate truthful role-specific application materials, track the application, prepare for interviews, and follow up.

The product should not compete as another generic resume writer, Kanban tracker, or unattended auto-apply bot. Those categories already have strong alternatives. Career-Ops should compete on:

```text
Fewer applications
Better decisions
Stronger evidence
Safer automation
More control
```

The central product promise is:

> **Career-Ops helps serious candidates decide which jobs deserve their time, create evidence-backed application materials, and manage the full search without surrendering their data or final decisions to an automated bot.**

The strategy is to make one job flow exceptionally trustworthy first, then add proactive discovery, CRM capabilities, controlled automation, and outcome-based calibration around that core.

## 2. Product definition

### 2.1 What Career-Ops is

Career-Ops is a candidate-side system that combines:

- Job discovery through ATS and career-page adapters
- Live-posting verification
- Qualitative fit evaluation against a candidate profile and evidence base
- Score-based apply/investigate/skip recommendations
- Per-role resumes, cover letters, and application answers
- Application tracking and pipeline integrity checks
- Browser-assisted draft application workflows
- Interview preparation, outreach, and follow-up
- Batch processing through AI coding CLI workers
- Local dashboards and inspectable files

### 2.2 What Career-Ops is not

Career-Ops is not:

- A blind mass-application system
- A replacement for candidate judgment
- A promise that an AI score predicts hiring outcomes perfectly
- A generic resume-template marketplace
- A hosted recruiting CRM by default
- A system that should submit applications without human approval

### 2.3 Product category

The most accurate category description is:

> **Local-first, fit-first AI job-search operating system.**

A shorter user-facing description is:

> **An AI command center that filters jobs, builds truthful application packets, and keeps the candidate in control.**

## 3. Problem statement

Job seekers currently assemble a fragmented workflow from:

- Job boards and company career pages
- Browser bookmarks
- Spreadsheets or ad hoc trackers
- Resume editors
- Cover-letter generators
- Application autofill tools
- Email and calendar
- Interview notes
- Follow-up reminders

This creates five costly problems:

1. **Poor prioritization** — candidates spend time on roles that are weak fits, stale, misleading, or strategically irrelevant.
2. **Repeated work** — every role requires resume edits, cover letters, answers, uploads, and tracking.
3. **Evidence drift** — generated materials can overstate experience, invent metrics, or use the wrong role-specific artifact.
4. **Fragmented state** — the candidate loses track of which resume was used, what was submitted, who was contacted, and what happens next.
5. **Unsafe automation** — fully autonomous agents can submit incorrect answers, duplicate applications, send unwanted outreach, or expose personal information.

Career-Ops addresses these problems as one connected lifecycle rather than as isolated utilities.

## 4. Target users

### 4.1 Primary audience

Career-Ops should initially target:

- Technical professionals
- Senior or specialized candidates
- Career changers with a distinctive domain background
- Privacy-conscious users
- Candidates applying to a limited number of high-value roles
- Candidates who need strategic filtering rather than maximum application volume

This includes transitions such as:

- Mechanical engineering → applied AI
- Engineering → robotics or simulation software
- Manufacturing → industrial AI
- Research or science → engineering software
- Technical specialist → product, forward-deployed, or solutions engineering

### 4.2 Secondary audience

Potential later audiences include:

- Graduate students applying to technical roles
- Independent consultants and freelancers
- Career coaches managing a small number of clients
- Open-source contributors who want local, inspectable career tooling
- University or workforce programs that need a customizable workflow

The secondary audience should not drive the initial architecture. The first product must work well for an individual candidate with a real search.

### 4.3 User profile

The ideal user values:

- Truthful self-representation
- High signal over high volume
- Local data control
- Custom career strategy
- Explainable recommendations
- Ability to inspect and edit generated files
- Human approval before external actions

## 5. Jobs to be done

When I find a job posting, I want to know whether it is worth pursuing before spending an hour on it.

When I decide to pursue a job, I want a truthful application packet tailored to that role without rewriting my entire CV manually.

When I apply, I want to know exactly which resume, cover letter, answers, and contacts belong to that role.

When I reach an interview, I want preparation grounded in the actual posting and the materials the employer saw.

When a search produces outcomes, I want the system to learn which roles, scores, narratives, and channels actually work for me.

## 6. Product principles

### 6.1 Fit before volume

The system should recommend fewer, better applications. A role below the configured threshold should generally be discarded unless the candidate records an explicit override reason.

### 6.2 Evidence before persuasion

Every resume claim, score, recommendation, and answer should be grounded in candidate-provided evidence. The system must flag gaps rather than hide them.

### 6.3 Human control at irreversible boundaries

AI may discover, evaluate, draft, fill, and save. The candidate reviews and submits. If a control could finalize an application and there is uncertainty, the system stops.

### 6.4 Local-first by default

Personal data, reports, trackers, generated documents, and application history should remain inspectable and portable. A future hosted product must be additive, not required for the core workflow.

### 6.5 One source of truth per concern

- Candidate identity and constraints: `config/profile.yml`
- Canonical resume evidence: `cv.md` and structured resume source
- Candidate narrative and strategy: `modes/_profile.md`
- Applications: `data/applications.md`
- Job inbox: `data/pipeline.md`
- Reports: `reports/`
- Generated artifacts: `output/`
- Application draft state: `data/application-drafts.md`

### 6.6 Inspectable artifacts

A user must be able to open, understand, edit, and retain every important output without needing the AI system to reconstruct it.

### 6.7 Automation must be resumable

Long-running scans, batches, and application sessions need state, retries, clear checkpoints, and safe recovery rather than opaque background activity.

## 7. Current product foundation

The current project already provides a substantial foundation:

### Discovery

- Configurable portal and company scanning
- Greenhouse, Ashby, Lever, and other adapters
- Local parsers for custom career pages
- URL inbox through `data/pipeline.md`
- Playwright-based posting liveness checks

### Evaluation

- Auto-pipeline from URL or JD text
- Structured evaluation blocks
- Weighted 1–5 scoring
- CV matching and gap analysis
- Level, compensation, and personalization analysis
- Interview preparation
- Posting-legitimacy checks

### Tailoring

- Per-role tailored PDF generation
- HTML templates rendered through Chromium
- Cover-letter generation
- Application answer drafts
- Artifact naming and exact-role resolution rules
- Resume and artifact verification tools

### Tracking and analysis

- Canonical application tracker
- Batch TSV additions and merge process
- Deduplication and status normalization
- Report links and pipeline verification
- Pattern analysis and follow-up cadence
- Go terminal dashboard

### Application assistance

- Browser-based form filling
- Profile and answer-bank inputs
- Draft-save support where portals allow it
- Portal adapters and application navigation
- Mandatory stop before final submission

### Extensibility

- AI coding CLI modes
- Provider/CLI flexibility
- Markdown and YAML configuration
- Node.js scripts
- Playwright browser automation
- Optional Go dashboard
- Language-specific modes

### Current roadmap contract status

The current system layer also includes local/dependency-injected contracts for
notification scheduling/delivery, explicit approval state, durable browser
checkpoints, one-job stage coordination, and two narrow live bridges. These
modules persist only caller-selected local state, journals, staged tracker
additions, or outbox records and are covered by focused tests:

- `one-job-runner.mjs` requires explicit results/adapters for every provider,
  liveness, evaluation, decision, tailoring, packet-review, and tracker stage.
  It stages a nine-column TSV but does not merge into the canonical tracker or
  generate PDFs.
- `scheduler-runner.mjs` accepts only an explicit fixture or `roles` plus
  `scanState` JSON and an optional local-JSONL channel; it has no provider,
  network, scan, email, desktop, or OS-notification default.
- `apply-browser.mjs` requires exact approval/checkpoint identity before draft
  save and never submits an application.

They are not provider-backed orchestration: they do not create PDFs, write the
canonical tracker, send real external or OS notifications, open browsers as a
default, call external providers, or submit applications. Phase 3 and Phase 4
remain roadmap work for the corresponding end-to-end integrations, with
explicit channels and human approval still required.

Additional contracts are intentionally read-only or approval-gated rather than
full workflow completion:

- `onboarding-plan.mjs` provides review/preview-only onboarding plans and
  proposed user-layer patches. It never applies writes.
- `outcome-recommendation-state.mjs` records analysis-backed candidates and
  requires explicit candidate approval before an actionable recommendation can
  become approved. Its ledger never mutates configuration, tracker, reports,
  or source analysis.
- `followup-cadence-core.mjs` requires an explicit root and deterministic
  `asOf`; confirmed sent activity is separate from draft recommendations and
  persisted drafts.
- `dashboard-workflow.mjs` provides a read-only queue/health projection,
  exposed additively as `payload.workflow` by `dashboard-data.mjs`. Optional
  ledgers can be absent and are reported through availability metadata.

These capabilities do not claim full user workflow completion. Phase 6 remains
deferred pending the demand gate for hosted or ecosystem extensions.

## 8. Core product loop

The product should organize every feature around this loop:

```text
1. DISCOVER
   A job enters from a scanner, referral, URL, or pasted JD.

2. VERIFY
   The system confirms that the posting is live and legitimate enough to evaluate.

3. EVALUATE
   The system compares the role with the candidate's evidence, goals, constraints, and deal-breakers.

4. DECIDE
   The system recommends apply, investigate, or skip with reasons and confidence.

5. TAILOR
   The system creates a role-specific resume, cover letter, and answers using supported evidence only.

6. REVIEW
   A reviewer pass checks factuality, fit, ATS parseability, and role/company correctness.

7. TRACK
   The exact role, artifacts, score, status, and next action enter the canonical tracker.

8. APPLY
   The system may fill and save a draft; the candidate reviews and submits manually.

9. FOLLOW UP
   Contacts, interviews, reminders, outcomes, and lessons are recorded.

10. LEARN
    Outcomes calibrate scoring, targeting, narrative, and future recommendations.
```

## 9. Product architecture

```text
                    ┌───────────────────────────┐
                    │ Candidate profile + evidence│
                    │ CV, constraints, narrative  │
                    └──────────────┬────────────┘
                                   │
┌───────────────┐       ┌──────────▼──────────┐       ┌───────────────┐
│ Portal scans  │──────▶│ Verify + evaluate   │──────▶│ Apply decision │
│ URLs/referrals│       │ evidence-backed fit │       │ apply/skip/deep│
└───────────────┘       └──────────┬──────────┘       └───────┬───────┘
                                   │                          │
                          ┌────────▼────────┐        ┌────────▼────────┐
                          │ Tailored packet │        │ Canonical tracker│
                          │ CV/cover/answers│        │ role/status/next │
                          └────────┬────────┘        └────────┬────────┘
                                   │                          │
                          ┌────────▼────────┐        ┌────────▼────────┐
                          │ Reviewer + gates │        │ Apply draft      │
                          │ factuality/ATS   │        │ browser/manual   │
                          └────────┬────────┘        └────────┬────────┘
                                   └──────────────┬───────────┘
                                                  ▼
                              ┌────────────────────────────────┐
                              │ Interview, follow-up, outcomes │
                              │ calibration and learning       │
                              └────────────────────────────────┘
```

### System layers

- **User layer:** CV, profile, tracker, reports, output artifacts, answers, portal configuration, and personal notes.
- **System layer:** modes, scripts, templates, adapters, dashboard, verification rules, and documentation.
- **Integration layer:** AI coding CLIs, Playwright, ATS APIs, local parsers, optional notifications, and optional dashboards.

The data contract must remain intact while the product evolves. System updates must not overwrite personal data.

## 10. Feature breakdown

### 10.1 Job discovery and inbox

**Goal:** Surface relevant, live roles without overwhelming the user.

**Current:** Configured scanners, ATS adapters, local parsers, pipeline inbox, liveness checks.

**Planned:**

- Scheduled scans
- New-role deduplication before notification
- Threshold-based alerts
- Scan summaries instead of raw job dumps
- Source/date/provenance for every posting
- Clear expired and uncertain states
- User-configurable search campaigns

**Acceptance criteria:**

- A scan never creates duplicate company+role records.
- Expired roles are clearly marked before evaluation.
- Notifications contain enough context to decide whether to open the report.
- A user can pause or change a scan without editing multiple files.

### 10.2 Evaluation and decision support

**Goal:** Make the apply/skip decision more accurate and explainable.

**Current:** Structured report, 1–5 weighted score, gap analysis, compensation and legitimacy sections.

**Planned:**

- Evidence links from requirements to CV/profile proof points
- Confidence value alongside the score
- Evidence coverage percentage
- Explicit hard blockers
- Unverified requirement list
- Apply/investigate/skip decision with override reason
- Score calibration based on actual outcomes
- Separate fit score from strategic value score

**Proposed output:**

```text
Score: 4.2/5
Confidence: Medium
Evidence coverage: 78%
Hard blockers: None
Unverified requirements: Kubernetes, large-scale ML deployment
Recommendation: Apply
Reason: Strong domain and Python evidence; infrastructure gap is learnable.
```

**Acceptance criteria:**

- A report identifies both supporting evidence and meaningful gaps.
- A user can understand why the recommendation differs from the raw score.
- A low score cannot be silently converted into an apply recommendation.
- Overrides are recorded rather than discarded.

### 10.3 Tailored application packet

**Goal:** Produce truthful, role-specific materials with traceable provenance.

**Current:** Tailored CV PDFs, cover letters, application answers, artifact contract, exact-match resolution.

**Planned:**

- Drafter–reviewer pipeline
- Factuality and unsupported-claim checks
- Requirement-to-bullet traceability
- Visible packet manifest
- Side-by-side source evidence and generated claim
- Packet preview before any browser session
- Automatic warning when an artifact is stale or for a different role

**Packet manifest example:**

```text
Company: Example Robotics
Role: Applied AI Engineer
Report: reports/042-example-robotics-2026-08-11.md
Resume: output/cv-candidate-example-robotics-applied-ai-engineer-2026-08-11.pdf
Cover letter: output/cover-letter-candidate-example-robotics-applied-ai-engineer-2026-08-11.pdf
Answers: output/answers-candidate-example-robotics-applied-ai-engineer-2026-08-11.md
Review: passed with 2 warnings
```

**Acceptance criteria:**

- No generated claim lacks candidate evidence or an explicit warning.
- A role-specific packet cannot resolve to a same-company wrong-role artifact.
- Reviewer output is preserved with the packet.
- ATS and factuality failures block apply-mode progression.

### 10.4 Application assistance

**Goal:** Remove repetitive form work while preserving human control.

**Current:** Playwright browser workflow, adapters, profile data, answer bank, draft-save handling, stop-before-submit policy.

**Planned:**

- Reusable answer bank with source and review date
- Sensitive-field confirmation gates
- Portal-family learnings stored in portal notes
- Clear preflight checklist
- Save-and-resume checkpoints
- Per-field audit log
- Human review screen before every external transition

**Always-confirm fields:**

- Salary expectations
- Work authorization and sponsorship
- Relocation and location
- Start date
- Legal attestations
- Demographic information
- Disability/veteran status
- Questions requiring a personal judgment

**Acceptance criteria:**

- Final submission controls are never clicked by default.
- Ambiguous submit-like controls stop the workflow.
- Draft-save results are verified and recorded.
- The exact artifact selected is shown before upload.

### 10.5 Tracker, contacts, and timeline

**Goal:** Make the tracker the operational spine of the search.

**Current:** Markdown tracker, canonical statuses, deduplication, merge, verification, reports, follow-ups.

**Planned:**

- Unified application timeline
- Contacts and recruiter records
- Interview stages and dates
- Last activity and next action
- Role-specific artifact links
- Follow-up reminders
- Application campaign grouping
- Outcome notes and source references

**Acceptance criteria:**

- Every application has one canonical company+role record.
- The tracker shows the current next action.
- Documents, contacts, interviews, and follow-ups resolve from the application record.
- Status changes preserve a useful history rather than erasing context.

### 10.6 Dashboard and local UX

**Goal:** Make the powerful file-based system approachable without sacrificing local ownership.

**Current:** Go TUI and web dashboard components.

**Planned:**

- First-run setup wizard
- Job inbox with score and decision filters
- Auto-pipeline stepper
- Live scan/batch logs
- Report and artifact deep links
- Packet preview
- Tracker timeline
- Follow-up queue
- Doctor and integrity actions from the UI
- Copy-paste CLI prompts when no provider API is configured

**Acceptance criteria:**

- A new user can complete onboarding and evaluate one job in under ten minutes.
- The UI reads the existing local source of truth.
- Every destructive or external action shows a confirmation gate.
- The CLI remains fully usable without the UI.

### 10.7 Batch processing and campaigns

**Goal:** Scale evaluation without losing state or quality.

**Current:** Headless workers, batch runner, state files, retries, tracker additions.

**Planned:**

- Named campaigns with role/company criteria
- Daily review limits
- Pause/resume
- Retry failed items
- Campaign journal
- Batch quality summary
- Per-item reviewer status
- Notification after a batch reaches a decision threshold

Campaigns may automate evaluation and drafting. They must not bypass human submission approval.

### 10.8 Interviews, follow-up, and learning

**Goal:** Close the loop after the application is created.

**Current:** Interview preparation, story bank, follow-up cadence, outreach, pattern analysis.

**Planned:**

- Stage-specific preparation from the exact submitted packet
- Interviewer/contact context
- Follow-up drafting grounded in submitted claims
- Outcome capture from email proposals with user approval
- Score-band conversion metrics
- Rejection-pattern analysis
- Narrative and targeting recommendations based on outcomes

**Acceptance criteria:**

- Interview prep references the exact role and artifacts used.
- Follow-up drafts use only verified candidate claims.
- Email-derived status changes require approval.
- Pattern reports distinguish insufficient data from negative evidence.

## 11. Roadmap

The roadmap is capability-based rather than calendar-based. A phase is complete when its acceptance criteria and measurable outcomes are met, not merely when code exists.

### Phase 0 — Product foundation and first value

**Objective:** Make the existing end-to-end workflow understandable and reliable for a new user.

**Deliverables:**

- Guided onboarding for CV, profile, role targets, location, compensation, and deal-breakers
- One-job auto-pipeline that reliably runs URL → verify → evaluate → decision → packet → tracker
- Clear first-run sample or demo mode without personal data
- Consistent CLI output and failure messages
- Local dashboard entry point for inbox, reports, artifacts, and tracker
- Product documentation that explains the lifecycle and data contract

The current `onboarding-plan.mjs` contract is review/preview only: it returns
presence state and a proposed user-layer patch, but never applies writes.

**Exit criteria:**

- A new user can configure the system and evaluate one job in under ten minutes.
- A valid job URL produces a report, recommendation, tracker entry, and role-specific artifact or a clear blocker.
- The user can understand what to do next without reading every mode file.

### Phase 1 — Trustworthy evaluation and application packets

**Objective:** Make recommendations and generated materials explainable and safe.

**Deliverables:**

- Evidence-backed scoring
- Confidence, evidence coverage, blockers, and unverified requirements
- Apply/investigate/skip recommendation model
- Drafter–reviewer loop
- Factuality and unsupported-claim checks
- Requirement-to-evidence mapping
- Packet manifest and preview
- Exact artifact verification before apply-mode navigation

**Exit criteria:**

- Every recommendation includes reasons, evidence, gaps, and confidence.
- Reviewer checks run before a packet can enter apply mode.
- Wrong-role artifacts and malformed metadata block progression.
- The master CV remains unchanged by tailoring.

### Phase 2 — Application operating system

**Objective:** Make the tracker, contacts, interviews, and follow-ups one coherent workflow.

**Deliverables:**

- Unified application timeline
- Contact and recruiter records
- Interview stages and preparation links
- Reusable answer bank with sensitive-field controls

- Follow-up queue and next-action field
- Portal notes and durable portal-family learnings
- Local dashboard views for timeline and follow-up work

The current follow-up cadence core is explicit-root/read-only and requires a
deterministic `asOf`; confirmed sent activity remains separate from draft
recommendations and persisted drafts. Dashboard workflow projections are
read-only, and absent optional ledgers are nonfatal.

**Exit criteria:**

- A user can open one application and find its report, artifacts, contacts, interview history, next follow-up, and status.
- Sensitive answers require explicit confirmation.
- Follow-up drafts are grounded in the submitted packet.

### Phase 3 — Proactive discovery and notifications

**Objective:** Surface high-value roles without creating noise.

**Deliverables:**

- Scheduled scan configuration
- New-role deduplication and liveness filtering
- Threshold-based notifications
- Notification channels such as desktop, email, or Telegram
- Scan summaries and source provenance
- User-configurable campaigns
- Pause/resume and scan health status

**Exit criteria:**

- Notifications are limited to new, live, eligible roles.
- A user can understand why a role was surfaced from the notification alone.
- The same role is not repeatedly surfaced without a meaningful state change.

### Phase 4 — Controlled campaigns and resilient automation

**Objective:** Scale evaluation and drafting while preserving human checkpoints.

**Deliverables:**

- Named campaigns
- Daily review limits
- Batch journals
- Pause/resume/retry controls
- Per-role reviewer state
- Application preflight checklist
- Save-and-resume browser checkpoints
- Clear external-action audit log

**Exit criteria:**

- A campaign can be paused and resumed without losing state.
- Failed roles can be retried independently.
- No campaign can bypass final human submission approval.
- Every external action has a visible reason and artifact reference.

### Phase 5 — Outcome intelligence and adaptive strategy

**Objective:** Improve targeting based on real application outcomes.

**Deliverables:**

- Interview, offer, rejection, and silence metrics by score band
- Calibration reports for score thresholds
- Archetype and company-pattern analysis
- Resume framing and narrative performance analysis
- Follow-up channel performance
- Recommendations for target-role and portal configuration updates
- Explicit insufficient-data warnings

Current recommendation records remain candidates until explicit candidate
approval, rejection, or deferral. The approval ledger never mutates
configuration, the canonical tracker, reports, or analysis source files.

**Exit criteria:**

- The system can show whether score bands correlate with interviews for the user.
- Recommendations distinguish observed outcomes from model assumptions.
- The candidate can approve or reject suggested changes to targeting and narrative.

### Phase 6 — Optional ecosystem and hosted extensions

**Objective:** Extend reach only after the local workflow proves value.

**Status:** Deferred. Do not claim hosted, ecosystem, collaboration, or remote
sync capability until the demand gate is met; the current local contracts do
not constitute Phase 6 or full workflow completion.

**Possible deliverables:**

- Optional hosted sync with explicit privacy controls
- Shareable read-only dashboards
- Coach or small-team workspaces
- Plugin/adapter registry
- Community-maintained portal adapters
- Export/import formats for other job-search tools

**Gate:** This phase should not begin because a cloud product is fashionable. It requires evidence of repeated local use, retention, and demand for collaboration or remote access.

## 12. Prioritization framework

### P0: Build now

- Reliable one-job auto-pipeline
- Guided onboarding
- Evidence/confidence/blocker scoring
- Drafter–reviewer packet validation
- Exact artifact and factuality gates
- Clear local UI for the core loop

### P1: Build next

- Unified timeline
- Contacts and interview records
- Reusable answers and sensitive-field controls
- Scheduled scans and high-signal notifications
- Campaign pause/resume/retry

### P2: Build after core proof

- Outcome calibration
- Advanced pattern analysis
- More portal adapters
- Additional notification integrations
- Campaign analytics
- Optional read-only hosted views

### Explicit non-goals

- Unattended application submission
- Mass application optimization as the primary success metric
- Generic template competition
- A cloud backend required for local operation
- Supporting every portal before reliability is proven
- AI-generated claims without evidence

## 13. Success metrics

The product should measure user value, not generated volume.

### Activation

- Time from install to first completed evaluation
- Percentage of users completing profile setup
- Percentage of users completing the first auto-pipeline
- Time from job URL to reviewable report and packet

### Decision quality

- Apply rate by score band
- Interview rate by score band
- User agreement with apply/investigate/skip recommendations
- Number of low-fit applications avoided
- Percentage of recommendations with sufficient evidence

### Artifact quality

- Factuality warnings per packet
- Unsupported claims caught before review
- ATS parse failures
- Wrong-role artifact blocks
- Percentage of applications with exact packet provenance

### Workflow quality

- Duplicate tracker entries prevented
- Draft-save success rate
- Application sessions resumed successfully
- Follow-up completion rate
- Time spent per completed application packet

### Learning quality

- Score calibration changes over time
- Outcome data completeness
- Interview conversion improvement after calibration
- Rejection patterns identified with sufficient evidence

## 14. Safety, privacy, and operational risks

### Application integrity

Risk: The model invents experience or submits inaccurate information.
Control: Evidence mapping, reviewer pass, factuality checks, sensitive-field confirmation, and manual final submission.

### Wrong artifact selection

Risk: A same-company resume for another role is uploaded.
Control: Exact company+role artifact contract, metadata validation, and preflight resolution.

### Portal and employer policies

Risk: Scanning or automation violates portal terms or overwhelms employers.
Control: Respect portal terms, throttle scanning, avoid spam, use user-configured sources, and keep the candidate responsible for final actions.

### Personal data exposure

Risk: CV, contact, salary, or application data reaches an unintended provider.
Control: Local-first data contract, explicit provider configuration, no unnecessary telemetry, and clear external-service disclosure.

### False confidence in scoring

Risk: A numerical score is treated as objective truth.
Control: Confidence, evidence coverage, blockers, uncertainty language, and outcome calibration.

### Automation complexity

Risk: A failed browser session leaves unclear state or duplicate work.
Control: Preflight checks, checkpoints, draft ledger, retries, idempotent tracker operations, and visible journals.

## 15. Release strategy

Each release should answer one user-facing question:

- **Foundation:** Can a new user get from setup to a useful first decision?
- **Trust:** Can the user understand and verify why the system recommended applying?
- **Packet quality:** Can the system produce the right truthful materials for the exact role?
- **Workflow:** Can the user manage contacts, interviews, and follow-ups without leaving the application record?
- **Discovery:** Can the system surface a small number of high-value roles automatically?
- **Learning:** Does the system improve based on actual outcomes?

A release is not complete when a script exists. It is complete when the user can perform the intended workflow, inspect the resulting artifacts, recover from failure, and understand the next action.

## 16. Final product thesis

The strongest version of Career-Ops is not a mechanical application generator and not an autonomous job bot.

It is a candidate-side decision and execution system that combines:

```text
Job discovery
+ live verification
+ evidence-backed fit evaluation
+ apply/skip strategy
+ role-specific artifacts
+ reviewer and safety gates
+ local pipeline management
+ controlled browser assistance
+ interviews and follow-up
+ outcome-based learning
```

The product wins when it helps a candidate apply to **fewer roles with higher conviction and better evidence**, while preserving ownership of personal data and the final decision to submit.
