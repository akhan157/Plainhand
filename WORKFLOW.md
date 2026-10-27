# WORKFLOW.md — The Per-Application Lifecycle

This is the end-to-end story of what happens when one job goes through the
system. Read this BEFORE designing, auditing, or integrating anything — the
modes catalog in CLAUDE.md tells you what files exist; this tells you how
they flow. Every artifact below is produced by one mode and consumed by
another; breaking a link silently breaks the chain.

## The lifecycle

```
DISCOVER → EVALUATE → TAILOR → TRACK → APPLY → FOLLOW UP
```

### Local lifecycle preflight checkpoints

`lifecycle-runner.mjs` provides a read-only local checkpoint envelope for one
explicit job. Its preferred object API is:

```js
runLifecycle({
  root,
  job: { url, company, role },
  targetStage: 'evaluate',
  results: { verify: { status: 'verified' } },
  requirements,
  evidence,
  score,
  override,
  packetManifest,
  claims,
  packetEvidence,
});
```

The `evaluate` checkpoint requires explicit non-empty requirements and evidence
arrays, preserves the evidence assessment, and blocks uncovered hard
requirements. The `decide` checkpoint preserves the apply/investigate/skip
recommendation, reasons, confidence, coverage, and override requirements;
`investigate` never authorizes apply. The `review` checkpoint requires an
explicit packet or packet manifest and preserves all packet checks and reviewer
output, including wrong-role, stale, malformed, and unsupported-claim failures.
All three checkpoints are local and serializable; no URL provider, network,
browser, notification, tailoring, tracker, approval, or submission action is
claimed or performed. Demo mode retains deterministic simulated transitions.

### System-layer integration contracts

- `onboarding-plan.mjs` produces a deterministic review/preview plan for the
  user-owned prerequisites. It checks presence metadata and normalizes caller
  answers, but does not read file contents, write files, or apply a patch.
- `outcome-recommendation-state.mjs` stores outcome-analysis recommendations as
  candidates. The candidate must explicitly approve, reject, or defer each
  recommendation; stale source/analysis fingerprints block approval. The
  local ledger never mutates configuration, tracker, reports, or analysis
  sources.
- `followup-cadence-core.mjs` requires an explicit root and deterministic
  `asOf` value. It is read-only and keeps confirmed sent activity separate from
  draft recommendations and persisted drafts; recommendations are not sent
  activity.
- `dashboard-workflow.mjs` projects queue, next actions, source availability,
  provenance, and health from the canonical timeline. `dashboard-data.mjs`
  exposes this additively as `payload.workflow`; optional ledgers may be absent
  without failing the projection, and the dashboard surface remains read-only.

The roadmap modules below are explicit local/dependency-injected contracts,
not an end-to-end provider orchestration:

- `notification-scheduler.mjs` consumes scan-state roles and emits
  deterministic candidates. `notification-delivery.mjs` delivers only through
  caller-configured channel adapters; no channels means pending local state,
  with no network default. The bundled adapter writes a local JSONL outbox,
  not email, desktop, Telegram, or another external channel.
- `scheduler-runner.mjs` runs one deterministic cycle only from an explicit
  fixture file or caller-supplied `roles` and `scanState` JSON. Its optional
  `local-jsonl` channel is local-only; it does not invoke scans, providers,
  network services, or OS notifications.
- `approval-state.mjs` records exact role/report/packet/artifact approval
  requests and transitions. It rejects final-submit action types and requires
  explicit reviewer/approver and sensitive-field confirmations; it never opens
  a browser or submits an application.
- `browser-checkpoints.mjs` records safe browser-run steps, save/verify-save
  state, resumability, failure recovery, and handoff under an explicit local
  root. It stores no user field values, makes no network requests, and never
  authorizes submission.
- `one-job-coordinator.mjs` coordinates provider, liveness, evaluation,
  decision, review, and track *results* supplied by injected adapters/callers,
  writing only an append-only stage journal. It does not call providers,
  create PDFs, write `data/applications.md`, send notifications, open
  browsers, or submit applications.
- `one-job-runner.mjs` is the live bridge around that coordinator. Provider,
  liveness, evaluation, decision, tailoring, packet-review, and tracker
  stages require explicit results or injected adapters. It writes a staged
  nine-column tracker TSV only; it does not merge the TSV into the canonical
  tracker, generate PDFs, call providers, or submit applications.
- `apply-browser.mjs` requires exact company/role/report/packet and artifact
  identity, a matching approval ledger record, and a matching durable browser
  checkpoint before opening draft-save flow. It may fill and save a draft but
  never submits; finalizing controls remain blocked.

These primitives preserve the candidate boundary. The live bridge does not
provide full provider/PDF/network/OS-notification automation: provider-backed
orchestration, external delivery, browser control, canonical tracker mutation,
and artifact generation remain separate capabilities requiring explicit
integrations. Final submission always remains manual.

### 1. DISCOVER — a job enters the system
- Sources: `scan.mjs` (portal APIs), indeed-scan, linkedin-scan, manual URL paste, referrals
- URL lands in `data/pipeline.md` (inbox) or goes straight to evaluation
- Liveness verified via Playwright (NEVER WebFetch) before any work is spent

### 2. EVALUATE — the job is scored
- Mode: `oferta` (or auto-pipeline when a URL/JD is pasted)
- Output: report in `reports/{###}-{company-slug}-{date}.md` — Blocks A–G,
  Machine Summary YAML, legitimacy tier
- Section G holds draft answers for that specific application
- Score < 4.0/5 → recommend against applying

### 3. TAILOR — per-job artifacts are generated
- Mode: `pdf` (or `latex`)
- **Every application gets its own tailored resume.** The general resume
  (`output/Resume-latest.pdf`) is the tailoring SOURCE, never the upload.
- Contract: `docs/artifact-contract.md` defines exact naming, metadata,
  freshness, and apply-resolution behavior for all per-job artifacts
- Contract enforcement now treats malformed metadata values as blockers too,
  not just missing files or missing fields
- Resume output: `output/cv-{candidate}-{company-slug}-{role-slug}-{date}.pdf`
- Cover letters: `output/cover-letter-{candidate}-{company-slug}-{role-slug}-{date}.html/pdf`
- Per-job answers: `output/answers-{candidate}-{company-slug}-{role-slug}-{date}.md`
- ALL prose passes through /humanizer before delivery (CLAUDE.md rule)

### 4. TRACK — the tracker is the spine
- `data/applications.md` — one row per company+role, NEVER duplicated
- New entries via TSV in `batch/tracker-additions/` + `merge-tracker.mjs`;
  status updates edited in place
- PDF column ✅ means a tailored CV exists, but apply mode still must resolve an
  exact role match via `docs/artifact-contract.md`
- Canonical states: `templates/states.yml`

### 5. APPLY — forms get filled
- Mode: `apply` (see modes/apply.md for the pre-submit apply engine)
- Preconditions: role is live, approved to apply, tracker/referral state is
  known, and the exact resume upload path is resolved before any tab opens
- Inputs consumed: `config/profile.yml` (PII — gitignored),
  `data/application-answers.md` (Q1–Q15 answer bank — gitignored),
  `data/application-drafts.md` (draft-save state — gitignored),
  `data/portal-notes/*.md` (portal-family learnings),
  the tailored CV from step 3 (resolved per job, generated if missing)
- Apply mode must use the exact-match artifact rules in
  `docs/artifact-contract.md`; same-company wrong-role artifacts do not count
- If multiple same-company role candidates remain plausible or metadata values
  are malformed, apply mode must stop instead of guessing
- Claude fills everything, explicitly saves a portal draft before switching
  roles or pausing when the portal supports drafts, verifies the save result,
  then stops at review screen or the safest resumable checkpoint.
- Any durable portal learning discovered during the run must be written back to
  `data/portal-notes/` so the next application starts with that knowledge.
- Final submission is always manual. The agent must never click any control
  that sends, applies, or finalizes the application. If a button or page state
  could plausibly submit the application and there is any uncertainty, stop and
  hand off to the candidate instead of clicking.
- Candidate submits. Draft-save state is operational only; it does not change
  canonical tracker status.
- After submit: status → Applied, entry added to `data/follow-ups.md`

### 6. FOLLOW UP — the loop closes
- `followup` mode + `followup-cadence.mjs` schedule outreach; the
  `followup-cadence-core.mjs` analysis requires an explicit root and
  deterministic `asOf`, and is read-only.
- Confirmed sent activity is distinct from draft recommendations and persisted
  drafts. A cadence recommendation means prepare/plan and is never treated as
  sent or delivered activity.
- `contacto` mode finds humans at the company
- Rejections feed `patterns` mode → targeting improves

## Data layers (summary — full contract in DATA_CONTRACT.md)

- **User layer (gitignored, PII lives ONLY here):** `config/profile.yml`,
  `cv.md`, `data/*`, `output/*`, `reports/*`, `modes/_profile.md`
- **System layer (committed, NO user data ever):** `modes/*`, `CLAUDE.md`,
  scripts, templates — this file too

## System-Change Protocol (MANDATORY)

Any request to audit, improve, integrate with, or build on this system:

1. Read this file fully
2. List every artifact the change touches
3. For each artifact, name its producer mode and consumer mode(s)
4. If any producer/consumer is unknown → read that mode file before designing
5. Only then design the change

This protocol exists because of a real failure (2026-06-11): the apply
workflow was designed with the general resume hardwired as the upload file,
missing that step 3 generates a tailored CV per job. The evidence was in
output/ and CLAUDE.md the whole time — it wasn't consumed.
