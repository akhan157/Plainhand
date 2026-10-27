# Scripts Reference

All scripts live in the project root as `.mjs` modules and are exposed via `npm run <name>`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |
| `npm run sandbox:demo` | `sandbox-demo.mjs` | Build a personal-data-free local dashboard sandbox |
| `npm run test:sandbox` | `test-sandbox.mjs` | End-to-end sandbox, lifecycle, API, and browser smoke test |
| `npm run test:lifecycle` | `test-lifecycle-runner.mjs` | Lifecycle preflight contract |
| `npm run test:onboarding-plan` | `test-onboarding-plan.mjs` | Review/preview-only onboarding plan contract |
| `npm run test:outcome-recommendation-state` | `test-outcome-recommendation-state.mjs` | Candidate approval ledger for outcome recommendations |
| `npm run test:dashboard-workflow` | `test-dashboard-workflow.mjs` | Read-only dashboard queue/health projection |
| `npm run test:followup-cadence-core` | `test-followup-cadence-core.mjs` | Explicit-root read-only follow-up cadence analysis |
| `npm run test:dashboard-data` | `test-dashboard-data.mjs` | Dashboard timeline projection contract |
| `npm run test:scan-state` | `test-scan-state.mjs` | Scan persistence and journal contract |
| `npm run test:notification-delivery` | `test-notification-delivery.mjs` | Local notification delivery/scheduling contract |
| `npm run test:approval-state` | `test-approval-state.mjs` | Explicit approval ledger contract |
| `npm run test:browser-checkpoints` | `test-browser-checkpoints.mjs` | Durable browser checkpoint contract |
| `npm run test:one-job-coordinator` | `test-one-job-coordinator.mjs` | Dependency-injected one-job coordinator contract |
| `npm run test:one-job-runner` | `test-one-job-runner.mjs` | Live one-job bridge contract with staged tracker TSV |
| `npm run test:scheduler-runner` | `test-scheduler-runner.mjs` | Fixture/local-JSONL scheduler bridge contract |
| `npm run test:roadmap` | `test-*.mjs` | Run focused contract tests for the implemented roadmap primitives |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required files (`cv.md`, `config/profile.yml`, `portals.yml`), fonts directory, and auto-creates `data/`, `output/`, `reports/` if missing.

```bash
npm run doctor
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `data/applications.md` against seven rules: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `batch/tracker-additions/`, and no markdown bold in scores.

```bash
npm run verify
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize             # apply changes
npm run normalize -- --dry-run  # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `applications.md` by grouping on normalized company name + fuzzy role match. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup             # apply changes
npm run dedup -- --dry-run  # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`batch/tracker-additions/*.tsv`) into `applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge                 # apply merge
npm run merge -- --dry-run    # preview without writing
npm run merge -- --verify     # merge then run verify-pipeline
```

Processed TSVs are moved to `batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- input.html output.pdf
npm run pdf -- input.html output.pdf --format=letter   # US letter
npm run pdf -- input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## sync-check

Validates that the career-ops setup is internally consistent: `cv.md` exists and is not too short, `config/profile.yml` exists with required fields, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, and company size from `data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports.

```bash
npm run patterns
npm run patterns -- --summary
npm run patterns -- --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Outputs JSON to stdout:

```bash
npm run update:check
```

Possible JSON responses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a timestamped backup branch (`backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. The timestamp is derived from UTC ISO time with separators and milliseconds removed (for example, `backup-pre-update-1.8.1-20260608T071302Z`). User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update. Rollback prefers the newest timestamped branch matching `backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>` and still accepts legacy `backup-pre-update-<version>` branches for older installs.

```bash
npm run rollback
```

**Exit codes:** `0` success, `1` no backup branch found or git error.

---

## liveness

Tests whether job posting URLs are still live using headless Chromium. Detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence. Supports multi-language expired patterns (English, German, French).

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Runs configured local parsers for SSR/static career pages and hits ATS APIs (Greenhouse, Ashby, Lever) directly — no LLM tokens consumed. Reads `portals.yml` for target companies, outputs matching listings to stdout, and optionally appends to `data/pipeline.md`.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git; `.gitkeep` placeholders are the only exception for preserving directory structure.

```bash
npm run scan
```

**Exit codes:** `0` scan completed, `1` configuration error or no portals.yml found.

---

## roadmap primitives

The current roadmap buildout includes local-first system-layer primitives. They
operate on caller-supplied paths, keep user data inspectable, and preserve the
human boundary before any external application action. They are not a complete
end-to-end roadmap implementation.

### onboarding

Inspect, initialize safe runtime directories, or validate the four required
user-owned prerequisite paths without creating personal data:

```bash
node onboarding.mjs --status --root /path/to/career-ops
node onboarding.mjs --init --root /path/to/career-ops
node onboarding.mjs --validate --root /path/to/career-ops
node onboarding.mjs --demo --output /tmp/career-ops-demo
```

`--demo` is the only file-writing mode and writes synthetic fixtures only under
the explicit output path.

### application timeline

Build a deterministic, read-only timeline from `applications.md` and optional
local contacts, follow-up, draft, and interview ledgers:

```bash
node application-timeline.mjs --root /path/to/career-ops
```

The API entry point is `buildApplicationTimeline(root, options)` from
`application-timeline.mjs`.

### onboarding plan

`onboarding-plan.mjs` creates a deterministic review/preview plan for the
four user-owned prerequisite files. It checks path existence and normalizes
caller answers, but never reads file contents, writes files, or applies a
proposed patch. Use the focused contract test:

```bash
npm run test:onboarding-plan
```

Any user-layer write remains a separate explicit caller-approved operation.

### dashboard workflow projection

`dashboard-workflow.mjs` builds a read-only queue, next-action list, source
availability, provenance, and identity/health summary from a supplied timeline.
`dashboard-data.mjs` exposes this additively as `payload.workflow`; absent
optional ledgers are nonfatal. It has no write path and the local dashboard UI
only displays the projection.

```bash
npm run test:dashboard-workflow
```



### follow-up cadence core

`followup-cadence-core.mjs` requires an explicit local root and deterministic
`asOf` value. It is read-only and keeps confirmed sent activity separate from
draft recommendations and persisted drafts; recommendations are preparation
plans, not sent activity.

```bash
npm run test:followup-cadence-core
```

### campaign state

Campaign state is an API-only local state and append-only journal primitive; it
has no standalone CLI. Import `createCampaignState`, `ingestRoles`,
`getReviewQueue`, the review transition functions, and
`CampaignStateStore` from `campaign-state.mjs`. External actions remain
`human_approval_required` until a person explicitly approves them.

### outcome intelligence

Analyze tracker outcomes and linked report summaries without mutating source
files:

```bash
node outcome-intelligence.mjs /path/to/career-ops
```

The API entry points are `analyzeOutcomes(root, options)` and
`getCapabilityReport()` from `outcome-intelligence.mjs`. Outcome assumptions
(such as elapsed-time silence) are labeled separately from observed outcomes.
Phase 6 hosted and ecosystem capabilities are disabled by default.

### outcome recommendation state

`outcome-recommendation-state.mjs` records analysis-backed recommendations as
`candidate` records until the candidate explicitly approves, rejects, or defers
them. Analysis and source fingerprints must remain fresh for approval. Its
local ledger/journal never mutates configuration, tracker, reports, or other
outcome source files.

```bash
npm run test:outcome-recommendation-state
```

### evidence-backed decision and packet review

Phase 1 trust gates are read-only system-layer APIs. They require explicit
requirement IDs, candidate evidence source references, and verification flags;
they do not infer support from keyword overlap or mutate user-layer data:

```js
import { assessRequirementEvidence, recommendApplication } from './requirement-evidence.mjs';
import { createPacketManifest, reviewApplicationPacket } from './application-packet-review.mjs';
```

`assessRequirementEvidence` returns requirement mappings, weighted evidence
coverage, confidence, unverified requirements, and hard blockers.
`recommendApplication` returns `apply`, `investigate`, or `skip` with reasons
and explicit override requirements. `createPacketManifest` records exact
company/role, report, resume, cover-letter, answers, and provenance references.
`reviewApplicationPacket` blocks unsupported claims, wrong-role, stale, or
malformed metadata and preserves reviewer output.

These APIs stop before browser navigation or submission. The full
URL-to-provider-to-evaluation-to-tailoring-to-tracker pipeline remains outside
this primitive, and no submission automation is provided.

### notification delivery and scheduling

`notification-delivery.mjs` and `notification-scheduler.mjs` are explicit,
dependency-injected local contracts. Scheduling consumes scan-state candidates;
delivery requires a caller-supplied channel adapter. With no configured
channels, notifications remain `pending` and no network or external service is
contacted. `createLocalJsonlAdapter` writes only to an explicit local JSONL
outbox, with delivery state and append-only journals under the caller's root.

These modules do not send real email, desktop, Telegram, or other external
notifications, and do not create a second source of truth for applications.
Use `npm run test:notification-delivery` for the focused contract.

### scheduler runner

`scheduler-runner.mjs` is the executable bridge for one deterministic local
scheduler cycle. It accepts an explicit fixture file or caller-supplied
`roles` plus `scanState` JSON and can write only through the explicit
`local-jsonl` channel. It has no provider, scan, network, email, desktop, or
other OS-notification default. Use `npm run test:scheduler-runner`.


### approval state

`approval-state.mjs` provides an explicit local approval ledger. Requests require
exact company, role, report, packet, artifact, caller, reviewer, approver, and
sensitive-field confirmation data as applicable. It rejects final-submit action
types, does not duplicate tracker sources, and never opens a browser or submits
an application. Use `npm run test:approval-state`.

### browser checkpoints

`browser-checkpoints.mjs` stores durable, serializable operational checkpoints
under an explicit absolute local root. It records safe steps, save/verify-save
state, resumability, failure recovery, and handoff without storing user field
values. It does not open browsers, make network requests, or authorize
submission; finalizing controls and `submissionAllowed` are rejected. Use
`npm run test:browser-checkpoints`.

### one-job coordinator

`one-job-coordinator.mjs` coordinates provider, liveness, evaluation, decision,
review, and track stage results through injected adapters and an append-only
local stage journal. It does not implement provider calls, liveness requests,
evaluation, PDF generation, canonical tracker writes, browser actions,
notifications, or submission. Callers must provide those results/adapters and
retain the manual candidate boundary. Use `npm run test:one-job-coordinator`.

### one-job runner

`one-job-runner.mjs` is the live one-job bridge around the coordinator. Every
provider, liveness, evaluation, decision, tailoring, packet-review, and tracker
stage must be supplied as an explicit result or injected adapter. A successful
run writes a staged nine-column tracker TSV only; it never merges the TSV into
the canonical tracker and does not create PDFs, call providers, or submit an
application. Use `npm run test:one-job-runner`.

### browser-assisted apply bridge

`apply-browser.mjs` requires exact approval identity and artifact identity from
an approval ledger plus an exact resumable browser checkpoint before opening a
draft-save flow. It may fill and save a draft, but it never submits an
application; finalizing controls remain blocked. Use `npm run test:apply-browser`.


All focused roadmap contracts, including the scheduler, one-job, and apply
bridges, are included in `npm run test:roadmap`.

Run all focused primitive contracts with:

```bash
npm run test:roadmap
```

The lifecycle runner also has a direct CLI for explicit, non-submitting
single-job preflight:

```bash
node lifecycle-runner.mjs --root /path/to/career-ops \
  --url https://jobs.example.test/role --company "Example Co" \
  --role "Senior Engineer" --demo
```

Dashboard timeline and scan-state primitives are API-only; their focused
contracts can be run directly with `npm run test:dashboard-data` and
`npm run test:scan-state`.

Phase 6 hosted and ecosystem capabilities remain disabled by default. The
notification, scheduler, browser-checkpoint, approval, one-job, and apply
bridges documented above are local/dependency-injected contracts; they do not
provide full provider/PDF/network/OS-notification automation, and final
submission remains outside them.
