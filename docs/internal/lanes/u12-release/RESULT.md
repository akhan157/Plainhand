# U12 — release-quality product: result

Implementation author record. Root reviews and accepts; nothing here is
self-accepted, and no acceptance row was marked PASS.

- **Branch:** `t3/u12-release-readiness`
- **Product tip at the checks below:** `60211d758f21a00a81cdf3fca677156b1447ae8c`
  (the only later commits are this lane's documents and a test-selector fix)
- **Base:** `3b917285bd8ca92f72080b975cfa1baee157b542`

## 1. Reachability matrix — done

- Generator: `scripts/u12-reachability.mjs` reads the live registry (core plus the
  six feature modules), the client calls, the server route blocks, the MCP filter
  and the CLI scripts, and writes
  [`REACHABILITY.md`](REACHABILITY.md).
- Test: `tests/test-u12-reachability.mjs`, added to `npm run test:plainhand`.
  It fails when an action has no screen and no documented reason, when a candidate
  panel does not land on a real screen or alias, when `/api/mcp/actions` is not
  exactly the non-task set, when tool names collide, or when the matrix names a CLI
  script or action that no longer exists.
- **88 registry actions**: 21 read, 31 write, 12 task, 24 candidate.
  Screen reach: 39 direct, 32 via a server route, 12 rendered from `/api/state`,
  5 reached through another documented door, **0 unreachable**.
- Surfaces: screens (`plainhand/web/**`), conversation (`plainhand/agent.mjs`
  catalogue, all tiers with the `registry.run` rules), MCP local
  (`plainhand-mcp.mjs` → `/api/mcp/actions`, 76 tools plus undo, tasks excluded),
  MCP hosted (`plainhand/cloud/mcp.mjs`, same set), CLI (`bin/plainhand.mjs` and
  `plainhand-mcp.mjs`, plus the legacy career-ops scripts named per capability).
- Documented unsupported interfaces: hosted has no browser, files or CLI; MCP
  cannot run tasks, approve a packet, understanding or submission, or widen shared
  context; the CLI has no per-action command.

## 2. Browser review — done, no defects

`tests/test-u12-browser-review.mjs` (`npm run test:u12-browser`):

- States: ten navigation screens, the application panel's Apply tab after a real
  synthetic form fill, the Record tab, and the mobile navigation drawer.
- Viewports: 1440 light, 1440 dark, 390×844 light. **37 screenshots**, in the
  gitignored `output/u12-browser/`, with `defects.json`.
- Checks: no document or element horizontal overflow; every tabbable control
  reached by Tab with an outline or box-shadow on the control or its focus-ring
  wrapper; no console errors or page errors; the form-review page shows
  “N filled by Plainhand” and “from <source>” for every filled field.
- Result: **0 defects** in all three viewports. The audit itself needed five
  fixes before it measured the right thing (inactive ARIA tabs are correctly
  `tabindex="-1"`; closed `<details>` children are not tabbable; a date input keeps
  focus across its segments; the role panel moves focus to its heading when it
  opens; a trapped sheet scopes the walk). Those were audit bugs, not product
  findings.

## 3. CLI workflows — smoke-run

No network and no model call. Run from the checkout, which has no candidate files
(`doctor` reports the four expected missing onboarding files).

| Command | Exit | Time | Result |
| --- | --- | --- | --- |
| `node bin/plainhand.mjs --help` | 0 | 233 ms | Usage, ports, data root, `--check` |
| `node bin/plainhand.mjs --check` | 0 | 1725 ms | Node 26.12.1, checkout workspace, Chromium path, server path |
| `npm run setup -- --check` | 0 | 1401 ms | All required items present; ready |
| `node lib/doctor.mjs --json` | 0 | 58 ms | `onboardingNeeded: true`, the four expected files missing |
| `timeout 5 node plainhand-mcp.mjs` (EOF on stdin) | 0 | 587 ms | MCP stdio server starts and exits cleanly |
| `npm run verify:artifacts` | 1 | 603 ms | All 14 artifact-schema checks pass; exits 1 only because `config/profile.yml` is absent on a fresh workspace (the tool prints the copy command) |

The last row is a fresh-workspace precondition, not a regression; the documented
onboarding order creates that file first.

## 4. Fresh clone, setup, start — done

`git clone` of this worktree at `60211d75`, then the documented path
(`docs/INSTALL.md` §2–4), in a temp dir under
`~/.cache/plainhand-eval-tmp`:

| Step | Time | Result |
| --- | --- | --- |
| `git clone` | 624 ms | HEAD `60211d75`, branch `t3/u12-release-readiness` |
| `npm ci --no-audit --no-fund` | 7.9 s | 162 packages, no offline fallback needed |
| `npm run setup` | 1.2 s | Node, deps, Chromium, `pdftotext` all present; “Ready” |
| `npm start -- --port 3311` | 1.24 s to ready | `GET /` 200 (session meta token present) |
| `GET /api/state` with the token | — | 200; 30 keys, 0 jobs, `provider: null`, revision 1 |
| stop (SIGTERM) | — | Exit 0; log ends with the ready banner |
| `git status --short` after | — | Empty |

No documentation error. The only deviation was the documented `--port` option to
avoid a port held by another lane.

## 5. Export and import — done, reused test plus key diff

- Reused `tests/test-workspace-import.mjs` (the M1 transfer test):
  `node --test tests/test-workspace-import.mjs` → **3/3 pass**. It covers the API
  round trip on two temp roots, approval reset, machine-state stripping, source
  files, reusable answers and corrections.
- Key diff probe (throwaway script, same API): 20 export keys. Five state keys are
  created on import (`claimLine`, `resumeFormat`, `settings`, `standard`,
  `writingSamples`); seven export keys live outside workspace state by design
  (`answerBank`, `corrections`, `files`, `agentConversation`, `agentProposals`,
  `agentUsage`, `exportedAt`). Approvals reset: `approvedHash` null,
  `browserCheckpoint` absent, standard approval null, understanding unapproved,
  autonomy disabled (the per-day and minimum-score values travel, the authority
  does not). Neither `sk-live-connection` nor `sk-live-checkpoint` appears in the
  export.

## 6. VERIFICATION-MATRIX reconciliation — done

[`VERIFICATION-RECONCILE.md`](VERIFICATION-RECONCILE.md): 89 rows — 38 re-run,
1 partially re-run, 47 carried with a reason, 2 retired (the system-only mirror and
overlay rows, which do not exist in this tree), 1 re-checked in source (session
reuse). Every re-run names its command and result.

## 7. Adjacent-work inventory — done

[`ADJACENT.md`](ADJACENT.md): fit, discovery, interview prep, email status
suggestions and the learning plan, each with producer files, registry actions and
tiers, screen, CLI where one exists, declared tests, and gaps.

## Defects found and fixed

Two real reachability defects, each in its own commit:

1. **MCP candidate link for a form panel** (`3e1467b`). `jobs.setApplyLink` uses a
   `form` panel, which `PANEL_VIEWS` does not map, so the local MCP bridge sent the
   candidate to Home. It now uses the shared `panelPath`, which opens
   `/?job=<id>&tab=apply#applications`, and the missing `form` step text was added.
   The bridge test asserts the role- and tab-scoped link.
2. **Agent/MCP role links did not open the role** (`948a3da`). `panelPath` has
   always produced `/?job=<id>&tab=<tab>#applications`, but the client ignored the
   query. The app now opens the role and tab once the workspace loads, after the
   panel's first effects. The browser review asserts the Apply tab is selected from
   that link.

No CSS or ARIA defect was found. The only other changes were audit corrections in
the browser review.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Core | `npm run test:plainhand` | **581/581 pass**, 49.0 s, includes the new reachability test |
| UI workflow | `npm run test:plainhand-ui` | **pass**, 61.8 s (themes, persistence, interview, discovery, evaluation, real PDFs, approval, form fill/upload, handoff, mobile) |
| Controlled evaluation | `node benchmarks/benchmark-eval.mjs --concurrency 2` | **64/67**, 3 expected failures (only `profile-effect-{fin,analyst,sci}-minimal`), 0 unexpected, 153 s; evidence `output/evaluation-controlled-2026-11-16T03-10-11-286Z` |
| Browser review | `npm run test:u12-browser` | **0 defects**, 37 captures, 140 s |

Additional re-runs used by the reconciliation: `tests/test-workspace-import.mjs`
3/3, `npm run test:remote` 6/6, `tests/test-feature-insights-ui.mjs` pass,
`tests/test-plainhand-agent-ui.mjs` pass, `test-application-timeline` +
`test-dashboard-data` 2/2.

## Counts

- Registry actions: 88 (read 21, write 31, task 12, candidate 24).
- Action surfaces: 39 direct screens, 32 server-route screens, 12 aggregate reads,
  5 reached through another documented door, 0 without a surface.
- MCP tools: 76 (all non-task actions) plus `plainhand_undo`; 12 tasks excluded by
  design.
- Browser captures: 37 across 3 viewports, 0 defects.
- Reconciliation rows: 89 (38 re-run, 1 partial, 47 carried, 2 retired,
  1 source re-check).

## Not done

- **Live model rows** (live profile-effect subset, live agent and 1.0 flows, live
  workflow Claude/ChatGPT, profile building and calibration benchmarks): no live or
  paid provider call was authorized in this lane.
- **`npm run test:full`** and the hosted Postgres suite: Go is not installed
  (`go: command not found`) and no Postgres instance was started; those are broader
  than U12 and remain with the root lane.
- **Real employer sites, Workday sign-in, a real user submission, commercial ATS
  access, CAPTCHA acceptance**: external access and candidate action; unchanged and
  carried.
- **Windows and macOS installers, a real Vercel deploy, dependency audit**: CI,
  credentials and network only.
- **The three `*-minimal` benchmark failures** are the expected lower-bound controls,
  not defects.

## Files changed

Product (two commits): `plainhand-mcp.mjs`, `plainhand/mcp-tools.mjs`,
`plainhand/web/app.mjs`. Tests: `tests/test-u12-reachability.mjs` (new),
`tests/test-u12-browser-review.mjs` (new), `tests/test-plainhand-mcp.mjs`
(stronger link assertions), `package.json` (reachability test in the core suite,
`test:u12-browser`). Tooling and records: `scripts/u12-reachability.mjs` (new),
`docs/internal/lanes/u12-release/{REACHABILITY,VERIFICATION-RECONCILE,ADJACENT,RESULT}.md`.
No scoring, benchmark, baseline or register file was touched. Screenshots stay in
the ignored `output/u12-browser/`.
