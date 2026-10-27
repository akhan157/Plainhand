# Plainhand next build plan: finishing the lifecycle

**Status:** N1–N6 delivered 2026-10-26; real-world validation pending (see the [verification matrix](VERIFICATION-MATRIX.md))
**Within:** [Product buildout goal](PRODUCT-BUILDOUT-GOAL.md) · follows the [agent build plan](AGENT-BUILD-PLAN.md)
**Contracts:** [Agent contracts](AGENT-CONTRACTS.md), especially §6 feature modules

## Goal

Close the loop the buildout goal describes, **apply → follow up → learn**, and
make Plainhand easy for someone else to run. Each capability is reachable from
its screen, from the conversation and (where the tier allows) from MCP, through
the same registry rules. Real-world validation with a real candidate follows
this plan; it is not replaced by it.

## Milestones

| # | Milestone | Phase | Done when |
| --- | --- | --- | --- |
| N1 | Discovery campaigns | 3 + 4 | Named campaigns (terms, locations, exclusions, sources, schedule, daily evaluation limit) live in one place and can be paused or changed from the screen or by conversation. Scheduled scans run while Plainhand runs. Liveness is on by default. Only new, live, eligible roles are surfaced, each with why and from where; a role is not surfaced again without a meaningful change. Scan health is visible. Optional desktop notification. Auto-evaluation stays within the daily limit; nothing is prepared or applied automatically |
| N2 | Grounded follow-ups | 2 | A follow-up or thank-you draft for a submitted application uses only claims from the submitted packet and the application record, passes a factual check and a style audit (draft → audit → final), and is never marked sent until the candidate says it was sent; sending records the activity and sets the next action |
| N3 | Outcome insights | 5 | An Insights page and agent actions show whether score bands correlate with interviews, distinguish insufficient data from negative evidence and observed outcomes from assumptions, and turn suggestions (targets, thresholds, narratives) into recommendations the candidate approves, rejects or defers, without changing configuration on their own |
| N4 | Candidate brain controls | Brain | The candidate sees exactly which sources go to the provider and can exclude any of them (the exclusion changes the context fingerprint and invalidates approvals); an answer-bank editor; switching provider keeps all memory |
| N5 | Easy to run | Activation | `npm run setup` checks and installs what is needed with clear next steps; a workspace export can be imported/restored into a new workspace with a backup first; first-run guidance in the app |
| N6 | Integration and verification | — | Full suite green, screenshots reviewed in both themes and mobile, verification matrix and goal docs updated |

## Execution

Parallel workers in git worktrees (layout and rules as in the
[agent build plan](AGENT-BUILD-PLAN.md#parallel-worktrees)); the orchestrator
owns the core, reviews, merges and pushes.

| Worktree | Owner | Milestone | Owns |
| --- | --- | --- | --- |
| main checkout | Orchestrator | N4, N5, N6 | Core files (`plainhand/*.mjs` outside features, server), merges |
| `.worktrees/campaigns` | Worker D | N1 | `plainhand/features/campaigns.mjs` (+ helpers under `plainhand/features/campaigns/`), `plainhand/web/ui/campaigns.mjs`, `test-feature-campaigns*.mjs` |
| `.worktrees/followups` | Worker E | N2 | `plainhand/features/followups.mjs`, follow-up UI inside `plainhand/web/ui/jobpanel.mjs` Record tab (new component file preferred), `test-feature-followups*.mjs` |
| `.worktrees/insights` | Worker F | N3 | `plainhand/features/insights.mjs`, `plainhand/web/ui/insights.mjs`, `test-feature-insights*.mjs` |

Shared touch points, kept to one line each and resolved by the orchestrator at
merge: the `FEATURES` list in `plainhand/features/index.mjs`, navigation entries
in `plainhand/web/app.js` / `ui/core.mjs` `VIEWS`, CSS additions appended to
`plainhand/web/css/app.css`, and the `test:plainhand` script.

Every worker reuses the existing system-layer contracts rather than rewriting
them: `campaign-state.mjs`, `plainhand/scan-runner.mjs`,
`notification-delivery.mjs`, `plainhand/notification-channels.mjs` (N1);
`application-record.mjs`, the packet and reviewer flow in `workflow.mjs` (N2);
`outcome-intelligence.mjs`, `score-calibration.mjs`,
`outcome-recommendation-state.mjs` (N3).

## Rules that carry over

- Guardrails in code: new actions declare tiers; anything that sends text to
  an employer, approves, or records a submission is candidate-only.
- Recruiter-facing text follows the repository's humanizer process
  (draft → audit → final); in the app that is a drafting pass, an audit pass
  for unsupported claims and AI-sounding phrasing, and a final pass.
- Untrusted text (postings, emails, notes) is data: reads of it taint the turn.
- No automatic submission, no automatic sending, no configuration change
  without candidate approval.
- Every worker hands back with `test:plainhand`, the browser suites and
  `test:full` passing, and reviewed screenshots for UI work.
