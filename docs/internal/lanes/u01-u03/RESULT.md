# Lane result: U03 master completeness and U01 low-friction onboarding

Status: **implemented on this lane; awaiting root review.** This author does not
accept its own work. It did not edit `GOAL-HANDOFF.md`, `EVIDENCE.json`,
`docs/internal/GOAL-ACCEPTANCE.json`, any `REVIEW.md`, or
`docs/internal/baseline/*`; it did not edit `plainhand/evaluation/*`, the frozen
benchmark entry points, push, merge or deploy. Review of the diff is the root's.

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Branch | `t3/master-completeness-onboarding` |
| Dispatch HEAD | `789dcd523baef5951ce0626b41410f3c519b50e3` (clean at start) |
| Author | implementation sub-agent, DeepSeek Flash |
| Reviewer | root, different model family |
| TMPDIR | `/home/ak/.cache/plainhand-eval-tmp` (outside the repository) |
| Dependencies | `npm ci --no-audit --no-fund` in this lane; `node_modules` is ignored |
| Resources | `free -h` checked before work and before the full gates; at least 4.0 GiB available, never below 2 GiB |
| Live calls | none. The U01 proof uses the controlled fixture agent; no provider or paid model call was made |

## 2. Files changed

| File | Change |
|---|---|
| `plainhand/master-completeness.mjs` | new deterministic check: source roles, credentials, degrees and number-bearing results, each present with its master entry index or missing |
| `plainhand/workflow.mjs` | stores `completeness` with the master; removes the 150-entry cap (`Number.POSITIVE_INFINITY`; provider output and the 10,000-character per-entry cap bound memory) |
| `plainhand/web/ui/profile.mjs` | the master card lists what the master missed, grouped by kind, beside the existing lexical coverage notice |
| `tests/test-u03-master.mjs` | new suite over the held-out personas, a scripted dropped role/credential, two tailored packets and a 200-entry master |
| `scripts/onboarding-report.mjs` | new per-run and aggregate (mean, sample SD) onboarding report over evaluation evidence |
| `scripts/onboarding-proof.mjs` | new fresh-clone, fresh-install, API-driven onboarding proof with the controlled fixture agent |
| `package.json` | adds `tests/test-u03-master.mjs` to `test:plainhand` |
| `docs/internal/lanes/u01-u03/RESULT.md` | this result |

No file under `plainhand/evaluation/*`, `plainhand/benchmarks/*`, `benchmarks/*`
or `docs/internal/baseline/*` was edited. `scripts/onboarding-proof.mjs` imports
the frozen evaluation fixture and deliberately does not modify it.

## 3. U03 — master completeness

### 3.1 What is checked

`masterCompleteness(sources, master)` in `plainhand/master-completeness.mjs` reads
only the candidate's own factual sources: the resume (`cv`,
`structured-resume`) and stories/conversation (`interview`, `stories`,
`narrative`, `proof-points`, and the `story` field of `profile`). Contact lines,
headings and questions are never items.

| Item | Extraction | Present when |
|---|---|---|
| Role | an experience line whose last `—`/`–`/`-` field parses as dates; a dated career break is a gap, not a job | a master heading has the same org and title (master may add to either), and the same start/end or ongoing state |
| Credential | a line under Certifications/Licenses/Training, or a certification/licence sentence in a story | the acronym (CPA, CKA, CKS, …) appears, or at least 70% of its identity words do (generic words such as “certified”, “license”, “active” and years are ignored) |
| Degree | a line under Education, or a degree sentence in a story | the institution and at least one field word appear (e.g. Accounting), or most field words when no institution is stated |
| Result | an experience/project body line or story sentence with a number that is not a bare year | all of its non-year numbers and at least 60% of its content words appear in one master entry |

The result carries every item with `present` and the zero-based master entry
`index`, a flat `missing` list with `kind` and `label`, and per-kind counts
(`roles`, `certifications`, `degrees`, `results`; the credential group is named
`certifications` after its source section, because the memory probe treats any
export key named `credentials` as a secret-shaped key). The same sources and
master always produce the same answer; no model decides coverage.

### 3.2 Wiring and the profile view

`plainhand/workflow.mjs:377` stores
`completeness: masterCompleteness(context.sources, clean.resume)` on
`state.standard`. The master card (`plainhand/web/ui/profile.mjs:227-228`) shows
a warning notice when anything is missing: “N items are missing from your
sources”, the present/total count, and up to ten `Role:`/`Certification:`/
`Degree:`/`Result:` labels. The existing lexical line-coverage notice stays;
this adds the structured list it could not name.

### 3.3 The entry cap

`list(draft.resume, 'resume', 150)` became
`list(draft.resume, 'resume', MASTER_RESUME_LIMIT)` with
`MASTER_RESUME_LIMIT = Number.POSITIVE_INFINITY` and an explicit comment. There
is no entry-count limit. What bounds memory is the provider's own response, the
10,000-character `requireText` cap on each entry, and the workspace file. The
test accepts and stores a 200-entry master; a real resume observed in this repo
(the finance persona) has 8 completeness items and 7 master lines.

### 3.4 Evidence

`node --test tests/test-u03-master.mjs` — 5 tests, 5 pass:

| Test | Result |
|---|---|
| Every held-out persona (set 1 and set 2, six personas) has 3+ roles, a credential, a degree and numbered results; a master built from the persona's own resume has every item present at a real entry index | pass |
| With `holdout-fin-controller`, `holdout-sre-platform`, `holdout2-fin-close` and `holdout2-stem-assay`, dropping the oldest role and the certification leaves exactly two missing names: `role:Example Retail Group — Senior Accountant — 2010 to 2014` and `credential:Certified Public Accountant (CPA), Colorado, active since 2013.` (and the analogous pair on each persona) | pass |
| The app stores the completeness result on the master; the dropped-master run reports `total 8, present 7, missing 1 role + 1 credential` | pass |
| Preparing two tailored packets leaves `JSON.stringify(state.standard)` and `digest(state.standard)` byte-identical before and after both packets | pass |
| A 200-entry master is accepted and stored | pass |

The exact missing labels for the other personas in the scripted test are:

- `holdout-sre-platform`: `Example Hosting — Systems Administrator — 2011 to 2014`, `Certified Kubernetes Administrator (CKA), 2022.`
- `holdout2-fin-close`: `Example Distribution Co — Senior Accountant — 2012 to 2016`, `Certified Public Accountant (CPA), Ohio, active since 2015.`
- `holdout2-stem-assay`: `Example Cell Analysis — Research Technician — 2012 to 2016`, `I earned a Lean Six Sigma Green Belt certification in 2019.`

## 4. U01 — low-friction onboarding

### 4.1 What the report measures

`scripts/onboarding-report.mjs <dir> [...] [--json]` reads `results.json` and the
per-scenario JSON in each evidence directory (the runner's own format). Per run
it reports:

- user turns in the profile conversation: `profile.turns`;
- assistant questions: question marks in the recorded assistant messages;
- repeated known-fact questions: M5's
  `state.conflictReview.questionChecks` ledger when the evidence carries it,
  otherwise a normalized question asked twice in the transcript;
- manual edits and rescues: the benchmark's `application.candidateAnswered`
  minus `appOwedRescued` (a field the app owed and the candidate filled);
  `rescues` is `appOwedRescued`, and app-filled fields are
  `appOwedFields - rescues`;
- calls, tokens and wall time: the scenario's whole-run usage and duration, with
  exact master/packet reach markers.

**Stage-timing limit.** The runner records one `durationMs` and one usage total
per scenario, not per-stage timestamps. The report therefore prints whole-run
wall/calls/tokens and exact `master`/`packet` markers; `--json` carries
`masterStage` (conversation seconds/calls as a lower bound) and `packetStage`
(whole run as the upper bound). Exact stage times are measured by the
fresh-install proof below. This limit is in the evidence, not in the app.

### 4.2 Live evidence used

| Directory | Runs | Provider |
|---|---|---|
| `output/baseline-00ce1bf/baseline-00ce1bf-20261115T152740Z-paired` | 27 | codex, live |
| `output/baseline-00ce1bf/baseline-00ce1bf-20261115T152740Z-smoke` | 11 | codex, live |
| `output/live-0f5cfe8/evaluation-codex-2026-11-16T01-46-33-320Z` | 27 | codex, live |
| `output/live-0f5cfe8/evaluation-codex-2026-11-16T02-54-40-594Z` | 9 | codex, live |

74 runs, 33 passed (the profile-effect `minimal` control is an expected failure;
the second live directory also hit the provider's usage/billing limit on several
rows — see §4.5).

Conversation-built runs (mode = `conversation`; 18 runs across both live sets):

| run | turns | questions | repeat Q | manual | rescues | app-filled | calls | tokens | wall s | packet | pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| profile-effect-fin-built-r1 (baseline) | 6 | 3 | 0 | 0 | 0 | 7 | 13 | 331,643 | 135.9 | yes | PASS |
| profile-effect-fin-built-r2 (baseline) | 5 | 3 | 0 | 0 | 0 | 7 | 11 | 279,694 | 123.0 | yes | fail |
| profile-effect-fin-built-r3 (baseline) | 6 | 4 | 0 | 0 | 0 | 7 | 12 | 309,084 | 139.6 | yes | PASS |
| profile-effect-analyst-built-r1 (baseline) | 5 | 2 | 0 | 0 | 0 | 7 | 11 | 282,260 | 169.5 | yes | fail |
| profile-effect-analyst-built-r2 (baseline) | 5 | 2 | 0 | 0 | 0 | 7 | 11 | 280,098 | 155.4 | yes | fail |
| profile-effect-analyst-built-r3 (baseline) | 5 | 2 | 0 | 0 | 0 | 7 | 11 | 288,046 | 150.0 | yes | fail |
| profile-effect-sci-built-r1 (baseline) | 4 | 2 | 0 | 0 | 0 | 7 | 10 | 245,416 | 126.3 | yes | fail |
| profile-effect-sci-built-r2 (baseline) | 4 | 2 | 0 | 0 | 0 | 7 | 10 | 248,314 | 115.8 | yes | fail |
| profile-effect-sci-built-r3 (baseline) | 4 | 2 | 0 | 0 | 0 | 7 | 11 | 282,397 | 118.2 | yes | fail |
| profile-effect-fin-built-r1 (live) | 6 | 6 | 0 | 0 | 0 | 7 | 14 | 360,572 | 253.4 | yes | PASS |
| profile-effect-fin-built-r2 (live) | 6 | 6 | 0 | 0 | 0 | 7 | 11 | 295,163 | 173.2 | yes | PASS |
| profile-effect-fin-built-r3 (live) | 6 | 6 | 0 | 0 | 0 | 7 | 11 | 286,576 | 168.8 | yes | PASS |
| profile-effect-analyst-built-r1 (live) | 7 | 7 | 1 | — | — | — | 9 | 241,063 | 111.0 | no | fail |
| profile-effect-analyst-built-r2 (live) | 7 | 7 | 1 | 0 | 0 | 7 | 15 | 390,455 | 285.5 | yes | PASS |
| profile-effect-analyst-built-r3 (live) | 7 | 7 | 2 | 0 | 0 | 7 | 12 | 307,502 | 202.0 | yes | PASS |
| profile-effect-sci-built-r1 (live) | 6 | 6 | 1 | — | — | — | 10 | 268,802 | 153.2 | no | fail |
| profile-effect-sci-built-r2 (live) | 6 | 6 | 1 | 0 | 0 | 7 | 11 | 290,337 | 173.0 | yes | PASS |
| profile-effect-sci-built-r3 (live) | 6 | 6 | 1 | 0 | 0 | 7 | 14 | 372,667 | 233.8 | yes | PASS |

**Aggregate (mean ± sample SD):**

| group | runs | turns | questions | repeat Q | manual | rescues | app-filled | calls | tokens | wall s | packet | pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| conversation | 18 | 5.6 ± 1.0 | 4.4 ± 2.1 | 0.4 ± 0.6 | 0 ± 0 | 0 ± 0 | 7 ± 0 | 11.5 ± 1.6 | 297,783 ± 42,116 | 166.0 ± 49.3 | 16/18 | 9/18 |
| seeded control | 18 | — | — | — | 0 ± 0 | 0 ± 0 | 7 ± 0 | 5.5 ± 1.2 | 138,129 ± 31,520 | 130.6 ± 37.2 | 18/18 | 18/18 |
| minimal control | 18 | — | — | — | 0 ± 0 | 0.5 ± 0.5 | 6.0 ± 0 | 4.8 ± 0.9 | 116,533 ± 24,315 | 89.3 ± 33.6 | 11/18 | 0/18 |
| journey | 4 | 4.0 ± 1.6 | 2.5 ± 2.5 | 0.3 ± 0.5 | 0 ± 0 | 0 ± 0 | 7 ± 0 | 12.8 ± 6.7 | 410,905 ± 54,360 (n=3) | 215.8 ± 174.4 | 3/4 | 1/4 |

Journey rows (first conversation to prepared packet or submission):

| run | source | turns | questions | repeat Q | manual | rescues | app-filled | calls | tokens | wall s | master | packet | pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| journey-sci | baseline smoke | 4 | 2 | 0 | 0 | 0 | 7 | 15 | 380,448 | 195.0 | yes | yes | fail |
| holdout-journey-stem | baseline smoke | 4 | 2 | 0 | 0 | 0 | 7 | 15 | 378,601 | 226.3 | yes | yes | fail |
| journey-sci | live 01-46 | 6 | 6 | 1 | 0 | 0 | 7 | 18 | 473,666 | 433.7 | yes | yes | PASS |
| holdout2-journey-stem | live 02-54 | 2 | 0 | 0 | — | — | — | 3 | — | 8.0 | no | no | fail |

The last row is the run that hit the provider's usage/billing limit after two
turns; it is recorded as a failed run, not a product verdict.

Live variance is from the paired repeats already run: the baseline paired
directory contains three repetitions of `built`, `seeded` and `minimal` for each
of the finance, analyst and scientist personas (27 runs). The conversation and
control rows above are that variance. The fresh-install proof was run three times
on the controlled fixture (§4.3); its counts were identical and only its wall
time varied.

### 4.3 Fresh-install onboarding proof

`scripts/onboarding-proof.mjs` clones this repository into a temporary
directory, runs `npm ci` and `npm run setup` there, starts the cloned app on a
loopback port, and drives the public HTTP API with the controlled fixture agent:

1. profile conversation (simulated candidate answers);
2. resume import (`/api/resume/import`) then profile save;
3. understanding task and `/api/understanding/approve`;
4. master task and `/api/standard/approve`;
5. fictional job add, evaluate, select;
6. prepare and `/api/packet/approve`.

Evidence: three controlled repeats under
`output/onboarding-proof-2026-11-16T04-26-{19-622,33-612,52-367}Z/`
(each has `report.json`, `REPORT.md`, `transcript.json`, `install.log`,
`setup.log`).

| Measurement | Value (mean ± sample SD over 3 repeats) |
|---|---|
| Clone commit | `781fc4c09b24a28081830928b92e8c2f2d934c93` |
| `npm ci` | exit 0 in all; 8.4 ± 3.4 s |
| `npm run setup` | exit 0 in all; 1.2 ± 0.7 s |
| Total install | 9.6 ± 3.8 s |
| First reviewed master | 0.65 ± 0.43 s from app start, 10 calls, 259,955 prompt characters |
| First prepared packet | 1.36 ± 0.89 s from app start, 14 calls, 329,385 prompt characters |
| Tokens | not reported by the controlled fixture (no provider call); prompt characters reported instead |
| Master completeness | roles 3/3, certifications 1/1, degrees 1/1, results 3/3 (8/8) in every repeat |
| Checks | conversation, resume import, understanding, master, evaluation, packet, packet approval all pass in every repeat |

Calls, prompt characters and intervention counts were identical across the three
repeats; only wall time varied (0.16–0.93 s to the master, 0.36–2.09 s to the
packet), which is local machine scheduling, not a model effect.

Interventions:

| Kind | Count |
| --- | --- |
| User turns in the profile conversation | 6 |
| Assistant questions | 6 |
| Repeated known-fact questions | 0 |
| Proposal confirmations | 5 |
| Manual edits | 1 (the profile save after the resume import) |
| Rescues (app-owed fields the candidate filled) | 0 |
| Approvals | 3 (understanding, master resume, packet) |
| Job added / selected | 1 / 1 |
| Task triggers | 4 |
| **Total** | **21** |

The proof is deterministic and makes no provider contact. It is not evidence of
live model quality and it does not exercise the browser application form.

### 4.4 What could not be done

**Fresh live onboarding on a clean machine is blocked by provider quota.** A
live run needs a real installed provider account; the available evidence already
shows the failure mode: `live-0f5cfe8/evaluation-codex-2026-11-16T02-54-40-594Z`
records `Your provider reported a usage or billing limit` on several rows
(including `holdout2-journey-stem` after two turns). No live or paid model call
was made by this lane. The controlled proof is the substitute; a live repeat
requires a funded provider account and root authorization.

**Stage timestamps are not in the live evidence.** The runner stores one
duration and usage total per scenario; the report prints whole-run figures and
exact reach markers, and the proof supplies exact stage times. Adding per-stage
timestamps would require editing the frozen runner and was deliberately not
done.

## 5. Gates

Commands actually run on this lane, in this order:

| Gate | Result |
|---|---|
| `node --test tests/test-standard.mjs tests/test-u03-master.mjs` | 19/19 pass |
| `npm run test:plainhand -- --test-concurrency=2` | 638/638 pass (51.6 s) |
| `npm run test:plainhand-ui` | pass |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | 64/67 pass, 3 expected failures |
| `node scripts/onboarding-report.mjs <four directories>` | exit 0; tables above |
| `node scripts/onboarding-proof.mjs` | exit 0; evidence above |

### 5.1 Gate results

- `npm run test:plainhand -- --test-concurrency=2`: **638 tests, 638 pass, 0
  fail** (50.8 s of test time). This includes the new
  `tests/test-u03-master.mjs` (5 tests) and the existing durable-memory probe.
- `npm run test:plainhand-ui`: **passed** — “Plainhand full browser workflow
  passed: themes, persistence, interview, discovery, evaluation, real PDFs/
  downloads, approval, real browser form filling/upload, handoff, confirmed
  tracking, and mobile layouts.” The run included the master card on desktop and
  mobile. (The fixture's short resume yields no completeness items, so the
  missing-list branch itself is exercised by the state-level test, not by this
  fixture.)
- `node benchmarks/benchmark-eval.mjs --concurrency 2`: **64/67 passed, 3
  expected failures, 0 unexpected** (scorer v3, controlled, 131 s wall). The only
  failures are the three `*-minimal` control rows:
  `profile-effect-fin-minimal`, `profile-effect-analyst-minimal`,
  `profile-effect-sci-minimal`. All holdout and journey rows pass.

## 6. Deliberately not done

- No edit to frozen measurement code, acceptance registers, handoffs or baseline
  evidence.
- No live provider call, push, merge, deploy or employer contact.
- No change to the master drafting prompt: the new check reports what is
  missing; it does not silently add facts.
- No per-stage timing change in the frozen runner (see §4.4).
