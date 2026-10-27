# Plainhand Agent Adapter (fork of career-ops)

Read the canonical guide at [`OPERATING_GUIDE.md`](OPERATING_GUIDE.md)
before operating in this project. It preserves the data contract, ethical-use
rules, language workflow, operational commands, tracker contract, and verification
requirements for this project.

## Contract Index

The shared guide is authoritative for these required operating areas:

- **Data Contract** — user-layer versus system-layer files and update boundaries.
- **Update Check** — startup update status and safe update/rollback handling.
- **Ethical Use** — review-first behavior; never submit an application.
- **Offer Verification** — Playwright-based legitimacy checks for job postings.
- **Canonical States** — tracker statuses from `templates/states.yml`.
- **TSV Format** — tracker additions format and merge normalization.
- **First Run** — doctor and update checks at session startup.
- **Onboarding** — required CV, profile, portals, and narrative setup.

## Project-specific facts

- This project is CLI-agnostic and supports Claude Code, Codex, Gemini, OpenCode,
  Qwen, Copilot, and Kimi.
- Its default report format is Blocks A–F plus G (Posting Legitimacy), with
  `**Legitimacy:** {tier}` in the header.
- OpenCode uses `/career-ops-scan` as the scan command alias where applicable.

Relative paths and commands in the shared guide are resolved from this project root.
