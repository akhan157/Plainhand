# Plainhand Claude Code Adapter (fork of career-ops)

Read [`OPERATING_GUIDE.md`](OPERATING_GUIDE.md) and
[`AGENTS.md`](AGENTS.md). The operating guide is canonical for all overlapping rules.

## Claude Code session protocol

Before auditing, improving, integrating with, or building on the system, read
`WORKFLOW.md`, list every artifact touched, and identify each artifact's producer
and consumer modes. Read unknown producer/consumer mode files before designing.
`WORKFLOW.md` is the lifecycle; this adapter is only the platform catalog.

Every human-facing prose item must go through `/humanizer` using the full
draft→audit→final process. This includes CV summaries, cover letters, portal
answers, and recruiter-facing free text. The user receives only the final version.

When switching between Antigravity and Claude Code, first read
`SESSION_NOTES.md` (the shared chronological memory bank).

## Platform integrations

OpenCode commands, Gemini commands, and the shared skill are platform integrations
when present in the checkout; verify their paths before invoking them. This
checkout also has `modes/indeed.md`, `modes/linkedin.md`, and
`data/linkedin-saved.md`; use `indeed-scan`, `indeed-apply`, `indeed-resume`,
`linkedin-scan`, and `linkedin-update` when requested.

The `gemini-cli` MCP may handle text-heavy research/evaluation; Claude retains
Playwright liveness checks, PDF generation, form filling, file I/O, orchestration,
and all decision gates. Never delegate liveness, PDF generation, or submission.
For Gemini evaluation, read `modes/_shared.md`, `modes/oferta.md`, `cv.md`, and
`modes/_profile.md`; Claude parses results and writes reports/TSVs. The Gemini
MCP is optional: do not assume it is installed or active.
