# Career-Ops Product Buildout Goal

**Status:** Proposed execution goal
**Product:** Career-Ops
**Primary reference:** [Product Strategy and Roadmap](PRODUCT-STRATEGY-AND-ROADMAP.md)
**Supporting reference:** [Competitive Landscape](COMPETITIVE-LANDSCAPE.md)
**Plainhand direction:** [Candidate Brain and Autonomous Execution](CANDIDATE-BRAIN-AND-AUTONOMY.md)
**Interaction direction:** [Conversational agent layer](AGENT-LAYER-DIRECTION.md)

The Plainhand build should prioritize the reviewed candidate model and voice,
portable provider context, and one real candidate-selected application workflow
described in that direction. Its automatic-submission end state is proposed;
this goal does not override the operating guide's manual final submission rule.

## Objective

Build Career-Ops from its current local-first foundation into a trustworthy,
end-to-end job-search operating system that helps a candidate move through the
complete lifecycle:

```text
onboard → discover → verify → evaluate → decide → tailor → review
        → track → apply with approval → follow up → learn
```

The finished product should help a candidate pursue **fewer roles with higher
conviction and better evidence**, while keeping personal data local and the
final decision to submit under human control.

This goal covers the complete capability roadmap. A phase is complete only when
its user-facing acceptance criteria and measurable outcomes are demonstrated;
code existing by itself is not completion evidence.

## Current implementation note

The repository includes local/dependency-injected system-layer contracts for
notification scheduling/delivery, explicit approval state, durable browser
checkpoints, one-job stage coordination, and two narrow live bridges. These
primitives make state and human-boundary behavior testable, but they do not
complete the roadmap phases:

- `one-job-runner.mjs` accepts explicit provider, liveness, evaluation,
  decision, tailoring, packet-review, and tracker results or adapters. It
  writes a staged nine-column tracker TSV only; it does not merge the TSV into
  the canonical tracker or create PDFs.
- `scheduler-runner.mjs` accepts an explicit fixture or caller-supplied
  `roles`/`scanState` JSON and optionally writes local JSONL. It does not invoke
  providers, scans, network services, or OS notification channels.
- `apply-browser.mjs` requires exact approval identity and artifact identity
  plus a matching durable browser checkpoint before draft-save work. It may
  fill and save a draft but never submits.

No full provider/PDF/network/OS-notification automation is claimed here.

The conversational agent layer (2026-10-25) adds an action registry with
code-enforced tiers behind the screens, an in-app agent that proposes changes
for the candidate to confirm, a local MCP server for the candidate's own
agent, and a conversation-first front end. It is verified with scripted and
fixture agents only; live provider behaviour is recorded as unverified in the
[verification matrix](VERIFICATION-MATRIX.md).

The lifecycle build (2026-10-26, [next build plan](NEXT-BUILD-PLAN.md)) adds
discovery campaigns with scheduled scans (Phases 3 and 4), grounded follow-up
drafts (Phase 2), outcome insights with candidate-approved recommendations
(Phase 5), sharing controls for the candidate brain, one-command setup and
workspace import. Each phase's code exists and is tested; its exit evidence
still requires use by a real candidate, which this note does not claim.

Additional local contracts are intentionally narrower than the finished
workflow:

- `onboarding-plan.mjs` is review/preview only. It checks prerequisite
  presence metadata and returns a proposed patch, but never writes or applies
  user-layer files.
- `outcome-recommendation-state.mjs` keeps recommendations in a candidate
  state until explicit candidate approval (or rejection/defer). It never
  mutates configuration, the canonical tracker, reports, or analysis sources.
- `followup-cadence-core.mjs` requires an explicit root and deterministic
  `asOf`; it is read-only, and draft recommendations remain distinct from
  confirmed sent activity.
- `dashboard-workflow.mjs` and the additive `payload.workflow` projection are
  read-only. Optional ledgers may be absent; availability is reported rather
  than treated as a write or a failure.

Phase 6 remains deferred. No hosted, ecosystem, collaboration, or remote-sync
capability is part of this implementation note, and these contracts do not
claim full user workflow completion.
Remaining provider and user-layer integrations must preserve the local-first
and manual-candidate boundaries below.

## Product outcome

A candidate should be able to:

1. Configure identity, evidence, targets, constraints, and deal-breakers.
2. Bring in a job from a scanner, referral, URL, or pasted description.
3. Confirm that the posting is live and legitimate enough to evaluate.
4. Receive an explainable fit and strategy recommendation with evidence,
   confidence, blockers, gaps, and any recorded override.
5. Generate and inspect a truthful, role-specific application packet with
   provenance from source evidence to generated claims.
6. Track the exact role, artifacts, contacts, stages, status, and next action
   from one canonical application record.
7. Use browser assistance to prepare or save a draft without bypassing a human
   review or final submission decision.
8. Prepare for interviews, draft grounded follow-ups, capture outcomes, and use
   sufficient outcome data to improve future targeting and recommendations.
9. Do all of the above by conversation: describe what they want to an agent on
   their own AI subscription, inside Plainhand or from their own agent over MCP,
   with screens reserved for reading, reviewing and signing off.

## Interaction model

The [conversational agent layer](AGENT-LAYER-DIRECTION.md) is the adopted way
candidates reach every phase below. Plainhand remains the foundation that does
the work and enforces the rules; the agent proposes actions from a single
action registry with code-set confirmation tiers. The phases keep their exit
evidence; each phase is complete for the agent layer when its actions are in
the registry and reachable by conversation. Execution is planned in the
[agent build plan](AGENT-BUILD-PLAN.md).

## Non-negotiable boundaries

- **Fit before volume:** optimize for decision quality, not application count.
- **Evidence before persuasion:** unsupported claims become warnings or blocks;
  they are never silently invented.
- **Human control at irreversible boundaries:** the system may discover,
  evaluate, draft, fill, and save, but must not submit an application by
  default or bypass explicit approval.
- **Local-first operation:** personal data, history, reports, and generated
  artifacts remain inspectable and portable; hosted features are optional.
- **One source of truth per concern:** preserve the documented profile, resume,
  narrative, pipeline, application, report, output, and draft-state contracts.
- **Inspectable artifacts:** users can open, understand, edit, and retain every
  important output without reconstructing it through the AI system.
- **Resumable automation:** scans, batches, and browser sessions expose state,
  checkpoints, retries, and safe recovery.
- **Safe external behavior:** respect portal terms, throttle discovery, avoid
  spam, disclose provider use, and keep sensitive-field confirmation gates.

## Roadmap delivery plan

### Phase 0 — Foundation and first value

**Objective:** Make the existing workflow understandable and reliable for a
new user.

**Build:**

- Guided onboarding for CV, profile, targets, location, compensation, and
  deal-breakers.
- A reliable one-job path from URL through verification, evaluation, decision,
  packet, and tracker entry.
- Personal-data-free sample or demo mode.
- Consistent CLI output and actionable failure messages.
- A local dashboard entry point for inbox, reports, artifacts, and tracker.
- Lifecycle and data-contract documentation.

**Exit evidence:**

- A new user configures the system and evaluates one job in under ten minutes.
- A valid URL produces a report, recommendation, tracker entry, and
  role-specific artifact, or a clear blocker.
- The next action is understandable without reading every mode file.

**Dependency:** None. This is the product entry gate.

### Phase 1 — Trustworthy evaluation and application packets

**Objective:** Make recommendations and generated materials explainable,
truthful, and safe to use.

**Build:**

- Evidence links from requirements to candidate proof points.
- Confidence, evidence coverage, explicit hard blockers, and unverified
  requirements.
- Apply/investigate/skip recommendations with recorded override reasons.
- Drafter–reviewer flow with factuality and unsupported-claim checks.
- Requirement-to-evidence traceability, packet manifest, and packet preview.
- Exact company-and-role artifact verification before apply-mode navigation.

**Exit evidence:**

- Every recommendation includes reasons, evidence, gaps, and confidence.
- Reviewer checks run before a packet can enter apply mode.
- Wrong-role artifacts and malformed metadata block progression.
- Tailoring never changes the master CV.

**Dependency:** Phase 0's one-job lifecycle and local artifact entry points.

### Phase 2 — Application operating system

**Objective:** Make applications, contacts, interviews, and follow-ups one
coherent workflow.

**Build:**

- Unified application timeline and canonical company-plus-role record.
- Contacts, recruiter records, interview stages, dates, and preparation links.
- Reusable answer bank with source, review date, and sensitive-field controls.
- Follow-up queue, next-action field, and grounded follow-up drafts. Cadence
  analysis is explicit-root/read-only; confirmed sent activity is never
  conflated with drafts or recommendations.
- Durable portal notes and portal-family learnings.
- Dashboard views for timeline and follow-up work. Dashboard projections are
  read-only and optional ledger absence is nonfatal.

**Exit evidence:**

- Opening an application exposes its report, artifacts, contacts, interview
  history, next follow-up, and current status.
- Sensitive answers require explicit confirmation.
- Follow-up drafts use only verified claims from the submitted packet.
- Status changes preserve useful history instead of erasing context.

**Dependency:** Phase 1 packet provenance and apply preflight contracts.

### Phase 3 — Proactive discovery and notifications

**Objective:** Surface a small number of high-value roles without creating
noise.

**Build:**

- Scheduled scan configuration and user-configurable search campaigns.
- New-role deduplication, liveness filtering, and clear expired/uncertain
  states.
- Threshold-based notifications with source, date, and provenance.
- Desktop, email, Telegram, or other explicitly configured notification
  channels.
- Scan summaries, pause/resume controls, and scan health status.

**Exit evidence:**

- Notifications contain only new, live, eligible roles.
- Each notification explains why the role was surfaced without requiring the
  user to reconstruct the scan.
- A role is not repeatedly surfaced without a meaningful state change.
- Pausing or changing a scan does not require editing multiple files.

**Dependency:** Phase 1 decision fields and Phase 2 canonical application
records; notifications must not create a second source of truth.

### Phase 4 — Controlled campaigns and resilient automation

**Objective:** Scale evaluation and drafting without losing state, quality, or
human checkpoints.

**Build:**

- Named campaigns with role/company criteria and daily review limits.
- Batch journals, per-role reviewer state, and quality summaries.
- Pause, resume, independent retry, and failure recovery controls.
- Application preflight checklist and save-and-resume browser checkpoints.
- Visible external-action audit log with reason and artifact reference.

**Exit evidence:**

- A campaign pauses and resumes without losing state.
- Failed roles can be retried independently.
- No campaign bypasses final human submission approval.
- Every external action has a visible reason and artifact reference.

**Dependency:** Phase 1 reviewer gates and Phase 2 application/draft state.

### Phase 5 — Outcome intelligence and adaptive strategy

**Objective:** Improve targeting and recommendations using real application
outcomes without overstating what the data proves.

**Build:**

- Interview, offer, rejection, and silence metrics by score band.
- Score-threshold calibration reports.
- Archetype, company, narrative, resume-framing, and follow-up-channel
  performance analysis.
- Recommendations for target roles, narratives, and portal configuration.
- Explicit insufficient-data warnings and candidate approval/rejection of
  suggested changes.
- Recommendation records remain candidates until explicit candidate approval;
  recording or deciding them does not mutate configuration, tracker, reports,
  or outcome source files.

**Exit evidence:**

- The system shows whether score bands correlate with interviews for the user.
- Reports distinguish observed outcomes from model assumptions.
- Suggested targeting or narrative changes require candidate approval.
- Pattern reports distinguish insufficient data from negative evidence.

**Dependency:** Phase 2 outcome capture and Phase 3/4 durable campaign and
notification state.

### Phase 6 — Optional ecosystem and hosted extensions

**Status:** Deferred. This phase does not ship as part of the current local
workflow; its gate remains evidence of repeated local use, retention, and a
concrete need for collaboration or remote access.

**Objective:** Extend reach only after repeated local use proves demand for
collaboration, remote access, or interoperability.

**Possible build:**

- Optional hosted sync with explicit privacy controls.
- Shareable read-only dashboards.
- Coach or small-team workspaces.
- Plugin or adapter registry and community-maintained adapters.
- Export/import formats for other job-search tools.

**Gate:** Do not start this phase because cloud functionality is fashionable.
Start only after evidence of repeated local use, retention, and a concrete need
for collaboration or remote access. Local operation remains complete without
these extensions.

## Cross-cutting workstreams

Every phase must preserve and extend these seams rather than create competing
models:

| Workstream | Required result |
| --- | --- |
| Data contract | System updates never overwrite personal data; paths and ownership remain clear. |
| Provenance | Reports, claims, artifacts, tracker records, and follow-ups resolve to their source evidence. |
| Safety gates | Sensitive fields, external transitions, ambiguous controls, and final submission stop for review. |
| Resumability | Long-running work records checkpoints, retries, state transitions, and recoverable failures. |
| Local UX | CLI remains fully usable; dashboard reads the existing local source of truth. |
| Verification | Automated checks defend duplicate prevention, liveness, factuality, exact-role resolution, and tracker integrity. |
| Documentation | Each released capability explains lifecycle behavior, setup, data ownership, limitations, and next action. |
| Measurement | Activation, decision quality, artifact quality, workflow quality, and learning quality are measured from user value rather than generated volume. |
| Agent layer | Every capability is one registry action with a code-set tier; buttons, conversation and MCP share it; tainted turns never write unconfirmed. |

## Capability-to-phase map

| Roadmap capability | Primary phase | Later extension |
| --- | --- | --- |
| Job discovery and inbox | Phase 3 | Phase 4 campaigns |
| Evaluation and decision support | Phase 1 | Phase 5 calibration |
| Tailored application packet | Phase 1 | Phase 4 batch quality |
| Application assistance | Phase 2 | Phase 4 resilient automation |
| Tracker, contacts, and timeline | Phase 2 | Phase 5 outcome analysis |
| Dashboard and local UX | Phase 0 | Phases 2–4 workflow views |
| Batch processing and campaigns | Phase 4 | Phase 5 campaign analytics |
| Interviews, follow-up, and learning | Phase 2 | Phase 5 adaptive strategy |
| Hosted/ecosystem extensions | Phase 6 | Only after the phase gate passes |

## Definition of done

The buildout is complete when all of the following are true:

- Phases 0–5 meet their documented exit evidence, and Phase 6 has either passed
  its demand gate or remains explicitly deferred.
- The core lifecycle works from onboarding through learning using local,
  inspectable artifacts.
- Recommendations expose evidence, confidence, gaps, blockers, and overrides.
- Generated packets preserve factuality, exact-role identity, and provenance.
- The tracker remains canonical for application state and next action.
- Scans, campaigns, and browser sessions are resumable and auditable.
- No external action silently crosses a human approval boundary.
- Success is evaluated with the roadmap's activation, decision-quality,
  artifact-quality, workflow-quality, and learning-quality measures.

This goal is a buildout contract, not a claim that the planned capabilities are
already implemented. Current versus planned behavior remains authoritative in
the [Product Strategy and Roadmap](PRODUCT-STRATEGY-AND-ROADMAP.md).
