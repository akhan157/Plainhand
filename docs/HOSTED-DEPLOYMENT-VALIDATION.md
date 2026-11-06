# Hosted preparation validation — 2026-11-06

Baseline: main b4edbfe. Branch: `t3/hosted-review-deployment`.
No deployment, production migration/dump, tag/release, push or PR was performed.
No desktop, shared web UI or local provider file was edited. No subagents used.
Only connected-account project metadata and environment-variable presence were
inspected; no credential values or production workspace rows were read.

## Final accepted checks

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Combined cloud suite, disposable Postgres 17, host Node 26.11.1 | 102 | 0 | 0 |
| Same combined suite, clean Linux Node 22 container, disposable Postgres 17 | 102 | 0 | 0 |
| Local `test:plainhand` | 314 | 0 | 0 |
| Hosted browser/onboarding/public pages and axe | 6 | 0 | 0 |
| Extension tests | 4 | 0 | 0 |
| Focused final public-page/axe recheck (overlaps above) | 1 | 0 | 0 |
| Encrypted synthetic pg_dump → age → decrypt → disposable restore | 1 smoke | 0 | 0 |
| Isolated dependency-traced Linux PDF runtime | 1 smoke, 2 renders | 0 | 0 |

`npm ci --ignore-scripts` successfully validated the committed lockfile. Bash
syntax, new module syntax, workflow YAML parsing and `git diff --check` passed.
`@sparticuz/chromium` is exactly 153.0.0; new dev tracing dependency
`@vercel/nft` is exactly 1.11.1. Node minimum is 22.17.0, stricter than PDF.js's
22.13 minimum because Chromium requires it.

## Actual PDF measurements

All runs use `@sparticuz/chromium`'s bundled executable and fonts, never the
machine's Playwright browser. Each render makes both resume and cover PDF.
Timings include rendering/writes; cloud unit measurements also include a genuine
PDF.js extraction assertion. Times vary with CPU contention and are not latency
promises.

- Final clean Node 22 container combined suite: first/cold MemoryStorage packet
  **12,715 ms**, warm **2,518 ms**, Postgres packet **1,048 ms**.
  Resume **15,705 bytes**, cover **15,010 bytes**. PDF headers, extracted text,
  fingerprint, metadata/page count, artifact contract and cross-account isolation
  all checked. The full suite was run with zero DB skips.
- Final isolated traced-bundle smoke in a fresh Node 22 Linux container:
  cold **5,128 ms**, warm **2,215 ms**. Smaller smoke fixture: resume
  **13,373 bytes**, cover **12,958 bytes**.
- Trace output: **91,063,899 bytes**, **859 files**, **19 warnings**, below the
  ordinary Vercel 250 MB uncompressed function cap. Chromium executable, AL2023
  libraries, fonts, SwiftShader, PDF.js worker and public UI are explicitly
  included. Warnings and what the isolated smoke proves are explained in the
  deployment runbook. This is not an actual Vercel build/deployment.

The untrusted-HTML test uses a request-counting local HTTP server with external
CSS, image, frame and script URLs: zero requests observed. Deadline tests cover
both a late-launch browser and an already-launched browser with stalled context
creation; cleanup is asserted. Runtime extraction is single-flight per instance.
Cloud verifier always says unconfirmed and does not fetch. A cloud context test
asserts the connector replay uses the same cloud renderer/verifier.

## Failures found and resolved during preparation

- Host `/tmp` was completely full and its pre-existing cached `/tmp/chromium`
  segfaulted even for `--version`. No other task's cache was deleted. Re-ran with
  a task-private TMPDIR and tested fresh-container extraction independently.
- A bare Debian slim container lacks NSS libraries. Exercising `VERCEL=1`
  correctly loads the distribution's bundled AL2023 libraries, as Vercel does.
- Required production env validation exposed incomplete synthetic MCP fixtures;
  fixtures now declare fake secret/cron settings, without weakening validation.
- Help-ID filtering and honest cron response required updating their assertions.
- One initial browser phone test timed out while still showing “Opening your
  workspace” under concurrent test load. A complete six-test rerun passed; no
  shared UI code or timeout was changed to hide it.
- A pre-existing rate-limit test crossed a wall-clock minute and was flaky.
  That test now injects a fixed clock so it exercises the intended same-window
  limit deterministically. Production rate-limit behavior is unchanged.
- One run overlapped dependency reinstallation and reported missing modules;
  discarded that interrupted run and reran both complete suites after npm ci.

## Changed files and responsibilities

- Runtime: `plainhand/cloud/runtime.mjs`, `plainhand/workflow.mjs` (optional
  render injection only), `plainhand/cloud/app.mjs`, `api/index.mjs`.
- Server configuration/security: `plainhand/cloud/config.mjs`,
  `plainhand/cloud/oauth.mjs`, `plainhand/cloud/diagnostics.mjs`, `vercel.json`,
  `.env.hosted.example`, `.gitignore` (ignore local Vercel secret files).
- Public information: `plainhand/cloud/public-pages.mjs`; sign-in links in the
  server app. No shared UI modules were changed.
- Operations: `.github/workflows/hosted-backup.yml`, updates to
  `.github/workflows/test.yml`, all scripts in `scripts/cloud/` (backup,
  restore, lifecycle, synthetic restore smoke, runtime smoke, tracing and HTTP
  smoke), `package.json`, `package-lock.json`.
- Tests: `tests/test-cloud-runtime.mjs`, `tests/test-cloud-app.mjs`,
  `tests/test-cloud-oauth.mjs`, `tests/test-cloud-mcp-endpoint.mjs`,
  `tests/test-cloud-onboarding.spec.mjs` (public-page axe test only).
- Documentation: this report and `docs/HOSTED-DEPLOYMENT.md`. The global hosted
  connector plan and onboarding implementation document were not edited.

## Remaining owner blockers and next commands

Connected Supabase metadata confirms `plainhand-cloud` is ACTIVE_HEALTHY in
us-east-1 on Postgres 17.11. Vercel connection/project/identity is unavailable in
this session. Server env values, stable HTTPS test origin, Supabase Google/email
redirects and Resend delivery must be configured/confirmed by the owner. The
backup target, offline age identity/public recipient, least-privilege read role,
AWS role and private unversioned bucket lifecycle are missing; nightly backup
workflow remains gated off. Published extension IDs are missing; extension
support remains fail-closed. Provider account coverage, store/directory approval
and desktop signing remain separate parent/owner work. Managed Supabase Auth
recovery is not proven by the application-schema backup drill.

Exact reproducible test, tracing, restore, owner Vercel build/deploy and live
smoke commands, all environment names and official references consulted are in
[HOSTED-DEPLOYMENT.md](HOSTED-DEPLOYMENT.md). Parent should review the commit,
repeat `npm ci`, `npm run test:cloud` with a disposable DB and
`npm run build:cloud:trace`, then follow that owner-only runbook. No real provider
connection, hosted cold-start performance, actual Vercel trace or deployment is
claimed by this report.
