# Plainhand Operating Guide (fork of career-ops)

This is the canonical operating guide for this Plainhand checkout. Project-local
`AGENTS.md` and `CLAUDE.md` files are adapters only; when instructions
overlap, this file is authoritative. Execute all relative paths and commands from
the applicable project root.

## Origin and purpose

This checkout is a personal fork of **career-ops**, built and used by
[santifer](https://santifer.io) to evaluate 740+ job offers, generate 100+ tailored
CVs, and land a Head of Applied AI role. Its archetypes, scoring logic, negotiation
scripts, and proof-point structure reflect that career search. It is intended to be
customized for the current user.

It is CLI-agnostic and supports open agent skill standard clients (Claude Code,
Codex, Gemini, OpenCode, Qwen, Copilot, and Kimi).

## Data contract (critical)

Read `DATA_CONTRACT.md` for the full contract.

**User layer — never auto-updated; personalization belongs here:**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`

**System layer — auto-updatable; do not put user data here:**
- `modes/_shared.md`, `modes/oferta.md`, and all other modes
- `AGENTS.md`, `CLAUDE.md`, `*.mjs`, `dashboard/*`, `templates/*`, `batch/*`

When asked to customize archetypes, narrative, negotiation scripts, proof points,
location policy, or compensation targets, write to `modes/_profile.md` or
`config/profile.yml`; never put user-specific content in `modes/_shared.md`.

## Session startup and updates

On the first message of each session, run silently:

```bash
node doctor.mjs --json
node update-system.mjs check
```

The doctor output is `{"onboardingNeeded": <bool>, "missing": [...]}` and checks
`cv.md`, `config/profile.yml`, `modes/_profile.md`, and `portals.yml`. If the
profile is missing, silently copy `modes/_profile.template.md` to
`modes/_profile.md`. If CV, profile, or portals remain missing, stop and onboard
before evaluations, scans, or other modes: create the CV from user-provided
information, copy `config/profile.example.yml` and collect name/email,
location/timezone, target roles, and salary range, optionally copy
`templates/portals.example.yml` to `portals.yml`, and create the tracker with the
standard table if `data/applications.md` is absent. Then collect narrative,
deal-breakers, achievements, and proof points into user-layer files. Learn from
post-evaluation feedback in those same files.

Update JSON handling:
- `update-available`: tell the user the local and remote versions and that CV,
  profile, tracker, and reports will not be touched; ask before `node update-system.mjs apply`.
- If declined, run `node update-system.mjs dismiss`.
- `up-to-date`, `dismissed`, `offline`, `no-remote-version`, and `fork`: say nothing.
  `fork` means this checkout is Plainhand, which updates with `git pull` from its own
  repository; never apply upstream career-ops files to it.
- User requests may force a check; rollback is `node update-system.mjs rollback`.

## Language and skill workflow

Default modes are English in `modes/`. Language directories are:
- `modes/de/`: German/DACH (`angebot.md`, `bewerben.md`, `pipeline.md`)
- `modes/fr/`: French/Francophone (`offre.md`, `postuler.md`, `pipeline.md`)
- `modes/ja/`: Japanese/Japan (`kyujin.md`, `oubo.md`, `pipeline.md`)
- `modes/tr/`: Turkish/Turkey (`is-ilani.md`, `basvuru.md`, `pipeline.md`)

Use a language directory when the user requests it, `language.modes_dir` selects
it, or the target JD and market clearly require it; explicit user preference and
configured `language.modes_dir` override detection. Otherwise use English modes,
including for English-language roles at foreign companies. Preserve each market's
native employment vocabulary.

| User request | Mode |
|---|---|
| JD or URL | auto-pipeline (evaluate, report, PDF, tracker) |
| evaluate/compare offer | `oferta` / `ofertas` |
| LinkedIn outreach / company research | `contacto` / `deep` |
| interview preparation | `interview-prep` |
| CV/PDF / course / project | `pdf` / `training` / `project` |
| tracker / apply / scan / pipeline / batch | `tracker` / `apply` / `scan` / `pipeline` / `batch` |
| rejection patterns / follow-ups / system update | `patterns` / `followup` / `update` |

`cv.md` is the canonical CV and `article-digest.md` contains optional proof points.
Never hardcode metrics; read them at evaluation time.

## Ethical use (critical)

This system prioritizes genuine fit over application volume. Never submit an
application. Filling forms, drafting answers, and generating PDFs are allowed, but
stop before any control that could finalize submission. If a control might submit
and there is uncertainty, do not click it. The user performs the final click;
saving drafts is allowed. Strongly discourage scores below 4.0/5 unless the user
gives a specific override reason. Favor fewer, better applications and respect
recruiters' time.

## Offer verification (mandatory)

Never use WebSearch/WebFetch alone to verify an offer. Use Playwright:
`browser_navigate` to the URL, then `browser_snapshot`. Footer/navbar without a JD
means closed; title plus description plus Apply means active. In headless batch
mode, where Playwright is unavailable, use WebFetch and mark the report
`**Verification:** unconfirmed (batch mode)` for manual follow-up.

## Operational commands and quality

- GitHub Actions run `test-all.mjs` (63+ checks) on PRs; branch protection requires
  passing checks; Dependabot monitors npm, Go modules, and Actions.
- Contributing: issue → discussion → linked PR → CI → maintainer review → merge.
- Code of Conduct, governance, security, and support are documented in
  `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SECURITY.md`, and `SUPPORT.md`.
- Stack: Node.js `.mjs`, Playwright, YAML, HTML/CSS, Markdown, optional Canva MCP.
  Outputs go to `output/`; reports to `reports/`; JDs to `jds/`; batch artifacts to
  `batch/`.
- After each evaluation batch run `node merge-tracker.mjs`.
- Never add a duplicate company+role to `data/applications.md`; update existing entries.

### Tracker additions

Write one line with nine tab-separated columns to
`batch/tracker-additions/{num}-{company-slug}.tsv`:

```text
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

Order is num, date, company, role, status, score, PDF, root-relative report link,
notes. `applications.md` displays score before status; the merge script swaps it.
`merge-tracker.mjs` normalizes report links relative to the tracker and
`--migrate` repairs existing links. Reports require `**URL:**` between Score and
PDF and `**Legitimacy:** {tier}`. Statuses come from `templates/states.yml`:
`Apply`, `Evaluated`, `Applied`, `Responded`, `Interview`, `Offer`, `Rejected`,
`Discarded`, `SKIP`. Status fields contain no bold, dates, or extra text.

Required checks/normalizers:
```bash
node verify-pipeline.mjs
node normalize-statuses.mjs
node dedup-tracker.mjs
```

### Headless workers

| CLI | Command |
|---|---|
| Claude Code | `claude -p "prompt"` |
| Gemini CLI | `gemini -p "prompt"` |
| Copilot CLI | `copilot -p "prompt"` |
| Codex | `codex exec "prompt"` |
| OpenCode | `opencode run "prompt"` |
| Qwen | `qwen -p "prompt"` |
