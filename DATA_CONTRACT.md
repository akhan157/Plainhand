# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `data/resume-source.yml` | Canonical structured resume source |
| `data/plainhand/browser/*` | Sensitive portal cookies/local storage; owner-only local files, never committed, exported, sent to the reasoning model, or auto-updated |
| `data/plainhand/usage/*` | Owner-only AI call receipts: reported token/cache counts, model IDs, duration, status and task/job attribution; no prompts, responses or provider credentials; included in explicit workspace exports |
| `data/plainhand/*` | Plainhand browser workspace: conversation, voice, reviewed understanding, job/task state, checkpoints, and pre-edit backups; never committed or auto-updated |
| `data/plainhand/conversation.jsonl` | Your assistant conversation (last 500 messages); clearable from Workspace settings. Your statements become profile evidence only through an approved proposal, never by being said in chat |
| `data/plainhand/agent-proposals.json` | Changes the assistant proposed and what you decided (pending, accepted, declined, canceled), with the untrusted sources it had read; never rewritten if unreadable |
| `data/plainhand/audit.jsonl` | Append-only record of external and agent actions (`agent-write`, `mcp-write`, undos, fills, handoffs) with reasons; no answers, cookies or model output |
| `data/plainhand/local-api.json` | Owner-only handoff (port and a per-run secret) that lets the local MCP server reach the running Plainhand; written on start, removed on shutdown; never committed, exported or shared |
| `cv.md` | Generated markdown mirror of the canonical resume source |
| `config/profile.yml` | Your identity, targets, comp range |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/applications.md` | Your application tracker |
| `data/application-drafts.md` | Your in-progress draft-save ledger for ATS sessions |
| `data/answer-bank.yml` | Your approved reusable answers: question, answer, exact source quote, scope, review date and optional expiry. Never auto-updated; sensitive and legally meaningful questions are rejected |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/follow-ups.md` | Your follow-up history |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated per-job artifacts and PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `CLAUDE.md` | Agent instructions |
| `AGENTS.md` | Codex instructions |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `plainhand/*` | Plainhand browser UI, provider adapters, persistence, and workflow code; contains no personal data |
| `plainhand-server.mjs`, `plainhand-mcp.mjs` | Plainhand local server and its MCP bridge for the candidate's own agent; contain no personal data |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |

## Artifact Contract Boundary

- `docs/artifact-contract.md` is system-layer documentation that defines the
  naming, metadata, freshness, and resolution rules for per-job artifacts.
- The verifier and apply-mode resolver enforce both metadata presence and
  metadata value validity for contract-managed artifacts.
- The actual generated artifacts under `output/*` and role reports under
  `reports/*` remain user-layer files even when they follow a system-defined
  schema.
- System updates may change the contract document and the generator/verifier
  logic that implements it, but must not rewrite existing user artifacts unless
  the user explicitly runs generation.

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
