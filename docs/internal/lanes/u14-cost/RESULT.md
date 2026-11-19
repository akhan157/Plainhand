# U14 — quota efficiency (calls and per-call overhead)

Branch: `t3/u14-quota-efficiency-cost`
Base: `4c2ecb7b3e86d8661dfbbe96d64ccd46e6bb3dbb`
Head at report time: see the commit that adds this file (the lane branch's tip).

Status: implementation complete for the three levers below; the fold is an
**option, default off**, and needs root's design decision before it becomes the
default. No live provider call was made by this lane.

## 1. What `codex exec` actually sends

Method: a loopback Responses-API mock (`127.0.0.1`, no credentials) received the
exact argv `plainhand/agents.mjs` builds, with a model provider override pointing
at the mock and a dummy env key. The prompt was a fixed, synthetic 16,022-character
`TASK/INPUT DATA` body (the live median Plainhand prompt is about 16k characters),
so the difference between runs is entirely CLI scaffolding. Sizes only; no
candidate data and no real token was used.

| Request component (16,022-char prompt) | Before | After | Change |
| --- | ---: | ---: | ---: |
| Total request body | 61,035 B | 18,190 B | −42,845 B (−70.2%) |
| Codex base instructions | 16,979 chars | 419 chars | replaced |
| Skills / plugin / permission block | 10,162 chars | 0 | removed |
| Environment context | 468 chars | 0 | removed |
| Tool definitions | 14,921 chars, 7 tools | 51 chars, 1 tool | −99.7% |
| Prompt Plainhand sent | 16,022 chars | 16,022 chars | unchanged |
| Overhead excluding the prompt | 45,013 B | 2,168 B | −95.2% |

Per-teil attribution (same prompt, same mock):

| Flag set | Body | Tools |
| --- | ---: | ---: |
| Current invocation before this change | 61,035 B | 14,921 chars |
| + `model_instructions_file` | 43,746 B | 14,921 chars |
| + tool/skill/environment switches | 17,823 B | 51 chars |
| Final (same switches; Plainhand preamble as system text) | 18,190 B | 51 chars |

The 7 tools before: `request_user_input` (1,355), `view_image` (371),
`multi_agent_v1` (9,925), `get_goal` (281), `create_goal` (760),
`update_goal` (2,172), `web_search` (49). After the switches only the 49-char
`web_search` descriptor remains.

Switches used (all per-call `-c`, none written to the user's config; accepted by
Codex CLI 0.167.1 under `--strict-config`):

- `model_instructions_file=<temp file>` — replaces the 16,979-char coding-agent
  prompt with `CLI_INSTRUCTIONS` (Plainhand's own `AGENT_PREAMBLE`, written to the
  per-call temp cwd).
- `skills.include_instructions=false` — removes the 10,162-char skill catalog.
- `include_environment_context=false`, `include_permissions_instructions=false`,
  `include_collaboration_mode_instructions=false` — removes the remaining
  developer/user context.
- `features.multi_agent=false`, `features.goals=false`,
  `features.view_image=false`, `tools.experimental_request_user_input.enabled=false`
  — removes the tool definitions.
- `project_doc_max_bytes=0` — keeps project documents out if the temp cwd ever
  contains one.
- `features.shell_tool=false`, `--sandbox read-only`, `--skip-git-repo-check`,
  `--ephemeral`, `--ignore-user-config` unchanged.

`-c features.exec_tool=false` was **removed**: Codex 0.167.1 reports it as an
unrecognized setting on every call (a no-op error item), so it was dead weight.

Token estimate. The owner's live measurement is 24.7k input tokens for a request
of roughly this size (2.47 bytes/token). At that ratio the request falls from
about 24.7k to about 7.4k tokens; at a conservative 4 bytes/token it falls from
15.3k to 4.5k. **Projected saving: 10.7k–17.3k input tokens per call.** The mock
measures bytes, not billed tokens; root's live run is the authority (below). Of
the post-change ~7.4k tokens, about 0.9k is the remaining fixed CLI scaffolding
and the rest is Plainhand's own prompt, so the call is now dominated by useful
context rather than by the CLI.

Known limit: a global `$CODEX_HOME/AGENTS.md` is still injected. With the owner's
12,919-byte file copied into an otherwise empty `CODEX_HOME`, the same request
was 58,332 B instead of 45k; `project_doc_max_bytes=0` did **not** remove it.
No supported switch was found that drops it without also moving the credentials
out of `CODEX_HOME` (not acceptable). The reduction above is on top of the
remaining user file; it is unrelated to Plainhand's prompt.

### Claude

Same method against the Anthropic Messages endpoint (loopback mock, dummy key),
with the current `claude -p` argv and a 16k-character prompt:

| | Before | After | Change |
| --- | ---: | ---: | ---: |
| Request body | 23,543 B | 18,231 B | −5,312 B (−22.6%) |
| System prompt | 5,800 chars | 557 chars | `--system-prompt` replaces Claude Code's |
| Tools | 0 | 0 | unchanged |
| Environment system message | 1,016 chars | 1,016 chars | unavoidable with `--system-prompt` |

`--system-prompt <CLI_INSTRUCTIONS>` is the Claude equivalent of
`model_instructions_file`. `--exclude-dynamic-system-prompt-sections` is documented
as ignored when a custom system prompt is used, confirmed in the capture; the
1,016-char environment system message remains.

Antigravity's argv is unchanged: no supported switch was found to replace its
system prompt or drop its plan-mode context, and no mock capture was made for it
(it is not the provider in the live quota figures). This is an open item, not a
claim that it is already small.

Raw captures (sizes and message bodies, no credentials) are outside the repo at
`~/.cache/plainhand-eval-tmp/u14/captures/`; the mock and driver live in
the same scratch directory. The prompts in them are synthetic.

## 2. Per-purpose call breakdown

`scripts/cost-breakdown.mjs` has three modes: `--results` (calls and prompt chars
per path from an evidence `results.json`), `--ledger <workspace>` (purposes from
saved usage records) and `--reproduce` (runs the controlled fixture harness with
`--retain`, reads each workspace's usage ledger, and cleans up). No provider is
called.

Reproduced controlled run (fixture agent, no network):

| Path | Calls | Call purposes |
| --- | ---: | --- |
| Seeded profile | 5 | evaluate, prepare, humanize, form-answers, review |
| Conversation-built | 11 | 6 × agent, evaluate, prepare, humanize, form-answers, review |
| Journey (master + application) | 15 | 6 × agent, interview, standard, evaluate, prepare, humanize ×2, review ×2, form-answers |

Prompt characters per call in the same run:

| Purpose | Seeded | Conversation-built | Journey |
| --- | ---: | ---: | ---: |
| agent | — | 33,245 | 33,258 |
| evaluate | 4,081 | 3,608 | 4,545 |
| prepare | 10,528 | 10,062 | 11,987 |
| standard | — | — | 5,628 |
| humanize | 35,680 | 35,208 | 36,069 |
| review | 8,822 | 8,398 | 8,336 |
| form-answers | 7,528 | 7,098 | 8,185 |
| interview | — | — | 3,707 |

These match the owner's live counts (seeded 6, conversation-built 11.9); the
humanize call alone is the largest prompt of the application path.

Agent loop: in both controlled and live evidence, profile conversations used
**1.0 call per turn** (`calls == turns` in every run; e.g. live `journey-sci`
6 calls / 6 turns). The 4-call budget in `plainhand/agent.mjs` was never used for
repair in these runs, so there is no wasted repair call to remove; the loop is
left unchanged.

## 3. Changes

### a. CLI overhead (always on)

`plainhand/agents.mjs`: `codexExecArgs()` builds the reduced argv and the temp
instruction file; `executeAgent` uses it. Claude gains `--system-prompt`. The
Plainhand prompt (instruction + data) is unchanged. Exported so a test and a cost
harness can measure the exact request.

### b. Folded humanizer (option, default off)

`plainhand/workflow.mjs`: when `state.settings.foldHumanize === true` (or
`PLAINHAND_FOLD_HUMANIZE=1` for one harness run), the master and packet drafting
calls receive `humanizeRules: HUMANIZE_INSTRUCTION` in their INPUT and the separate
`HUMANIZE` call is skipped. The rules travel in the input rather than the
instruction text so the controlled fixture's instruction dispatch stays valid and
the gate can run both ways without editing `plainhand/evaluation/*`. Review stays
a separate, independent call. The old two-call path is the default and remains
tested. `humanizer` is reported as `{folded: true, changed: 0, tellsAfter, …}` and
the job panel says "Humanizer rules applied while drafting" instead of claiming a
rewrite.

Why default off: a folded draft has no pre-rewrite, so `safeRewrite` (numbers and
`{company}`/`{role}` slots unchanged) cannot run, and CLAUDE.md describes the full
draft→audit→final process. With the full `HUMANIZE_INSTRUCTION` (32,663 chars) the
token saving is small after the CLI reduction:

Exact controlled-gate evidence (same 67 scenarios, identity unchanged, only the
env switch differs):

| Scenario | Calls before | Calls after fold | Prompt chars before | Prompt chars after fold |
| --- | ---: | ---: | ---: | ---: |
| `profile-effect-fin-seeded` | 5 | 4 | 66,639 | 64,099 |
| `profile-effect-fin-built` | 11 | 10 | 263,842 | 261,774 |
| `journey-sci` | 15 | 13 | 322,407 | 316,550 |
| `holdout-journey-stem` | 19 | 16 | 409,237 | 400,083 |

Most of the win is one fewer call (and its fixed overhead) per master/application
attempt, not fewer characters: the humanizer instruction is about 35k characters
and the rules added to the draft are about 33k. At the post-change fixed overhead
(~2,168 B/call) and the owner's token ratio, the fold is worth roughly another
1.7k–4.2k input tokens per application, on top of the per-call reduction.
`PLAINHAND_FOLD_HUMANIZE=0/1` overrides the setting for a gate run.

**This is a design decision for root to accept or reject.** If rejected, delete
`foldedHumanize`/`foldInput`/`foldedHumanizer`, the two call-site conditionals, the
setting field in `workspace-import.mjs`, the job-panel wording and
`tests/test-u14-cost.mjs`'s two fold tests. If accepted as the default, the
CLAUDE.md/WORKFLOW.md humanizer wording must be amended and the old-path tests
kept as the fallback.

### c. Content-hash cache for unchanged evaluations (always on)

`plainhand/agent-cache.mjs` + the evaluate branch in `plainhand/workflow.mjs`.
The key is `digest({version, provider, instruction, contextHash, url, company,
title, description})` — the profile context and the sanitized posting the
judgment depends on. Job bookkeeping that the task itself changes (`stage`,
`status`, `verification.checkedAt`, the previous evaluation) is deliberately not
in the key; including it would make an identical re-evaluation miss its own
entry. Only a result that passed validation and policy adjustment is stored;
failed or malformed replies are never cached. Any profile, source, job text,
instruction, provider or cache-version change misses.

Effect: re-evaluating an unchanged job makes 0 provider calls. A clean first
application path contains no repeated identical call, so the saving is 1 call per
unchanged re-evaluation, not per new application.

Contract update: `tests/test-application-record.mjs` used a second evaluate on the
same job to hold a provider call in flight while the candidate edited the record.
That identical re-evaluation is now a cache hit, so the test changes the profile
first (a genuinely different question) and keeps the same assertions. No other
test needed a change; no provider call is skipped where the input differs.

## 4. Counts and projections

Calls per application (controlled fixture; the owner's live figures in brackets):

| Path | Before | After CLI reduction | After CLI + fold |
| --- | ---: | ---: | ---: |
| Seeded | 5 (6.0) | 5 (6.0) | 4 (5.0) |
| Conversation-built | 11 (11.9) | 11 (11.9) | 10 (10.9) |
| Journey (master + app) | 15 | 15 | 13 |

Applications per 225-call window:

| Path | Before | After fold | Change |
| --- | ---: | ---: | ---: |
| Seeded (controlled 5 → 4) | 45.0 | 56.3 | +25% |
| Seeded (live 6 → 5) | 37.5 | 45.0 | +20% |
| Conversation-built (11 → 10) | 20.5 | 22.5 | +10% |
| Conversation-built (live 11.9 → 10.9) | 18.9 | 20.6 | +9% |

Token projection per application is in §1: the CLI change removes 10.7k–17.3k
input tokens from every call (5 calls seeded, 11–15 conversation/journey). At the
owner's ratio, a seeded application falls from ~123k to ~27k input tokens before
folding; the fold removes roughly another 2k. These are projections from request
sizes, not billed tokens.

## 5. Gates

- `npm run test:plainhand` — **PASS, 619/619 tests, 0 failures**, 39.9 s
  (Node v26.12.1, `TMPDIR=~/.cache/plainhand-eval-tmp`). The first run hung
  in `tests/test-application-record.mjs` because the now-cached second evaluation
  never called the blocking fixture; the test was corrected as described in §3c
  and the full suite then passed.
- `npm run test:plainhand-ui` — **PASS**, "Plainhand full browser workflow passed"
  (headless Chromium; screenshots under
  `~/.cache/plainhand-eval-tmp/plainhand-ui-evidence-*`, outside the repo).
- `node benchmarks/benchmark-eval.mjs --concurrency 2` — **PASS: 64/67, 3
  expected failures, 0 unexpected** (the three `*-minimal` rows; 162.2 s).
  Evidence: `output/evaluation-controlled-2026-11-16T03-54-36-538Z`.
- Same gate with `PLAINHAND_FOLD_HUMANIZE=1` — **PASS: 64/67, 3 expected
  failures, 0 unexpected** (197.5 s). This proves the fold option runs the gate
  both ways without editing `plainhand/evaluation/*`; the fixture dispatches on
  the unchanged instruction constant and ignores the extra input field.
  Evidence: `output/evaluation-controlled-2026-11-16T03-57-23-625Z`.

## 6. What root must measure live

1. One seeded and one conversation-built run against the real provider, recording
   `input_tokens` and `cached_input_tokens` from the usage ledger: confirm the
   projected per-call drop and that the now-tiny, stable CLI prefix does not lower
   the cached share.
2. Codex CLI version drift: the switches are recognized by 0.167.1 under
   `--strict-config`; a future CLI that renames or removes one may print an
   ignored-setting notice. Confirm on the installed version before release, and
   re-check `features.exec_tool` is still absent from the argv.
3. A live fold run (one packet and one master) with the setting on: compare prose
   quality and reviewer findings against the default. The repository's humanizer
   contract (CLAUDE.md) currently assumes the separate pass.
4. The global `$CODEX_HOME/AGENTS.md` remains in real requests (12,919 B for the
   owner's file in our mock). Confirm it is acceptable and that no other
   user-level file is injected.
5. Confirm the evaluation cache does not hide an intentional re-evaluation the UI
   offers. The cache only reuses a validated result for byte-identical
   profile+posting input.

## 7. Files changed

- `plainhand/agents.mjs` — reduced Codex argv, temp instruction file, Claude
  system prompt, `codexExecArgs`/`CLI_INSTRUCTIONS` exports.
- `plainhand/agent-cache.mjs` — new content-hash cache.
- `plainhand/workflow.mjs` — fold option, folded report, evaluation cache.
- `plainhand/workspace-import.mjs` — preserve `settings.foldHumanize`.
- `plainhand/web/ui/jobpanel.mjs` — folded-vs-rewrite wording.
- `scripts/cost-breakdown.mjs` — new breakdown tool.
- `tests/test-u14-cost.mjs` — new tests (argv, cache, fold, switch).
- `tests/test-application-record.mjs` — one intent-preserving change: the second
  evaluation now runs after a profile change, because an identical one is cached.
- `package.json` — the new test file in `test:plainhand`.
- `CHANGELOG.md` — user-facing note.
- `docs/internal/lanes/u14-cost/RESULT.md` — this report.

Not touched: `plainhand/evaluation/*`, `benchmarks/*`, `scripts/baseline-manifest.mjs`,
`scripts/rescore.mjs`, any register, handoff, manifest or `REVIEW.md`; no scoring,
tolerance or fixture change.

Deliberately not done:

- No live provider call of any kind; root owns the live measurement.
- No default flip for the folded humanizer; that is root's design decision.
- No Antigravity measurement or argv change (no supported equivalent found).
- No agent-loop change: the evidence shows exactly one call per profile turn and
  no repair calls, so there was nothing wasted to remove.
- No edits to the prepare loop's retry/contact-fields surface (another lane owns
  it); the fold and cache edits are confined to the humanize block, the draft
  input object and the evaluate branch.
