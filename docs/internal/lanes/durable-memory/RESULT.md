# Lane result: durable-memory M2 — factual evidence gate and identity negative control

Status: **implemented on the lane, awaiting root review.** The design packet and
root decisions are in [ASSIGNMENT.md](ASSIGNMENT.md) §8 M2 and
[REVIEW.md](REVIEW.md). The author does not accept this work, does not edit the
register, manifest, board, handoff, `EVIDENCE.json` or `REVIEW.md`, and has not
merged, pushed or deployed.

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Worktree | `/home/ak/.t3/worktrees/Plainhand/t3-a02877dc-e8d92f1d637a1a02` (cwd confirmed before edits) |
| Branch | `t3/durable-memory-m2-evidence-allowlist` |
| Expected and actual dispatch HEAD | `31d7ba1bb80443a177312173db68413326661849` (tree clean at start) |
| Author | Pi `deepseek/deepseek-flash`, `PI_REASONING_LEVEL=max`, existing metered account; bounded implementation sub-agent, no delegation |
| Reviewer | root, different model family; root reads the diff |
| Host | `free -h` before the full suite: 5.8 GiB available, swap heavily used. Runs capped at `--test-concurrency=2`; no install, browser or provider call left running |
| Test dependencies | `node_modules` symlinked to the main checkout `/home/ak/Plainhand/node_modules` (same `package.json`; not a tracked file, not an install) |
| TMPDIR | `/home/ak/.cache/plainhand-eval-tmp` (outside the repo) |

## 2. Exact commits

| Step | Commit | What it is |
|---|---|---|
| Lane base | `31d7ba1bb80443a177312173db68413326661849` | dispatch pin |
| Implementation | `ffc115f3a788f512df7e474b8fda04ed40079c30` | `plainhand/{store,answer-bank,corrections,agents}.mjs`, the four test files, `package.json` |
| This result | committed after the implementation | `docs/internal/lanes/durable-memory/RESULT.md` only |

No rebase, squash, force push or source-branch edit. No push, main merge, tag,
deploy, external contact or submission.

## 3. Source ids verified in `context()` before fixing the list

`plainhand/store.mjs` `Workspace.context()` publishes exactly these ids:
`profile`, `cv`, `interview` (when the conversation has user messages),
`structured-resume`, `narrative` (unless it is still the template),
`proof-points`, `stories`, `writing-samples` (when samples exist), and
`reviewed-understanding` (only when the understanding is approved and its
context hash still matches).

- **Allow-listed as factual:** `profile`, `cv`, `structured-resume`,
  `narrative`, `proof-points`, `stories`, `interview`.
- **Excluded as non-factual:** `writing-samples` (voice) and
  `reviewed-understanding` (agent summary). No other id was added or excluded.
- `candidate-answer` is a bank-only provenance id, never a `context()` source;
  `hasEvidence` rejects it with the allow-list, while `validEvidence` keeps it
  until M4 introduces assertion provenance (see §8).

## 4. What changed and the falsifier each fix closes

**`plainhand/store.mjs`.** `FACTUAL_SOURCE_IDS` and the specific refusals are
now one gate. `claimEvidenceProblem(item, context)` returns the reason a claim
is unusable (non-factual source kind, unknown source id, short or missing quote,
quote absent from sources, unsourced identity); `hasEvidence` is
`claimEvidenceProblem(...) === null`. The gate:

- rejects `writing-samples` and `reviewed-understanding` with a specific reason,
  even when the quote is an exact substring of that source;
- rejects any source id outside the factual allow-list, so `candidate-answer`
  and invented ids cannot ground a packet claim;
- keeps the existing quote rule (one or more exact quotes of 8+ characters,
  found in the current context);
- adds the identity negative control for `item.answer` (packet answers and form
  values): every four-digit year must be a token in a factual source; a seniority
  title directly before `at <Organisation>` in a year-bearing sentence, or a
  year-bearing `worked|served|employed at <Organisation>` frame, must appear in
  the sources; an explicit name introduction (`my name is`, `I go by`,
  `call me`) must appear in the sources. Source vocabulary is cached per source
  array and only includes factual sources. Resume lines keep their heading check
  (`verifyHeadings`) and the reviewer; evaluation match text is not treated as
  an answer.

**`plainhand/answer-bank.mjs`.** New `evidenceProblem(evidence)` and
`validEvidence` built on it. A reusable answer can no longer cite a writing
sample or the reviewed understanding: `add` throws
`A reusable answer needs a factual source quote, not a writing sample: …` or
`… not the reviewed understanding: …`; `match` skips such entries, so a legacy
entry never fills a field. Shape and 8-character errors keep the old wording
(`/source quote/` assertions still pass).

**`plainhand/corrections.mjs`.** `validateEvidence` uses the same
`evidenceProblem` and throws `A correction needs …` with the specific reason.
`approve` still re-validates through `AnswerBank.add`, so a proposal written
before this gate cannot become reusable evidence (tested with a planted legacy
entry).

**`plainhand/agents.mjs`.** `EVALUATE_INSTRUCTION`, `PACKET_INSTRUCTION`,
`STANDARD_INSTRUCTION`, `REVIEW_INSTRUCTION` and `FORM_INSTRUCTION` now state
that samples are voice only and never evidence, that the reviewed understanding
is never a source, and that an employer, job title, name variant or date absent
from the sources is a failure. The reviewer instruction names the identity rule
explicitly, so the model path fails such claims as well as the deterministic
gate. Instruction prefixes used by the fixtures are unchanged.

**Tests.** New `tests/test-evidence-sources.mjs` (allow-list, identity unit
cases, and a full prepare task with a scripted provider); negative cases added
to `tests/test-writing-samples.mjs`, `tests/test-answer-bank.mjs` and
`tests/test-corrections.mjs`; the new file is in the `test:plainhand` list. No
existing assertion was edited or weakened; the only test-file changes are the
new tests and their imports.

## 5. Before/after evidence

**Before, on dispatch HEAD `31d7ba1`** (the four product files restored to the
pin's blobs for the probe and the saved test run; their blob hashes were
checked against the dispatch diff before running; probe script in
`/home/ak/.cache/plainhand-eval-tmp/m2-before-probe.txt`):

```
HEAD sample grounds claim: true
HEAD planted identity passes: true
HEAD validEvidence(writing-samples): true
HEAD validEvidence(reviewed-understanding): true
HEAD correction with a writing sample accepted: proposed
```

The new tests were then run against HEAD (product files stashed, test files
present):

```
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 \
  tests/test-evidence-sources.mjs tests/test-writing-samples.mjs \
  tests/test-answer-bank.mjs tests/test-corrections.mjs
ℹ tests 14   ℹ pass 10   ℹ fail 4
```

The four failures are the intended ones: the new file cannot import
`FACTUAL_SOURCE_IDS`/`identityProblem` (the gate does not exist yet); the
writing-sample claim is accepted (`true !== false`); the reusable answer and
the correction are accepted (missing expected rejection). Outputs are kept
outside the repo: `/home/ak/.cache/plainhand-eval-tmp/m2-before-tests.txt`
(14/10/4), `m2-after-gate-tests.txt` (16/16 after the fix) and
`m2-focused-after.txt` (the 87-test focused run).

**After the fix, same four files:** `tests 16, pass 16, fail 0`.

The falsifiers are now asserted:

- `{sourceId:'writing-samples', quote:<real sample text>}` is rejected by
  `hasEvidence` and by `claimEvidenceProblem` (specific reason), by
  `AnswerBank.add`/`match`, and by `Corrections.propose`/`approve`.
- `{sourceId:'reviewed-understanding', …}` is rejected the same way.
- A planted `Director at Northwind, 2019–2021` answer over a real `cv` quote
  fails `hasEvidence` and makes the real prepare task fail
  (`The packet contains a claim without an exact source reference…`), saving no
  packet. Variants prove title and employer are checked separately: sources with
  `Engineer at Northwind, 2019–2021` still fail the raised title; sources with
  `Director at Beacon Labs, 2019–2021` still fail the different employer; the
  same identity facts present in the sources pass.
- A legitimate cv-quoted claim still passes, and a date the sources state
  (`2027`) is allowed.
- Writing samples remain in the provider context for voice, and saving one still
  clears approvals; the existing voice test is unchanged and passes.

## 6. Tests that actually ran, with counts

All with `TMPDIR=/home/ak/.cache/plainhand-eval-tmp` and
`--test-concurrency=2`, scripted providers only:

| Command | Result |
|---|---|
| The four gate files (`test-evidence-sources`, `test-writing-samples`, `test-answer-bank`, `test-corrections`) | **16 tests, 16 pass, 0 fail** |
| Required focused set: the four above + `test-plainhand`, `test-brain-controls`, `test-standard`, `test-bench-eval` | **87 tests, 87 pass, 0 fail** (8.8 s) |
| Consumer batch: `test-exports`, `test-feature-interview-prep`, `test-feature-skill-plan`, `test-profile-bench`, `test-actions`, `test-cloud-extension-api` | **69 tests, 69 pass, 0 fail** (1.8 s) |
| Full `test:plainhand` list (51 files, includes the new file) | **461 tests, 461 pass, 0 fail** (62.7 s) |

`git diff --check` exited 0; `node --check` passed on every changed `.mjs`.
No assertion was relaxed to reach green.

## 7. Consumer audit — every `hasEvidence` / `validEvidence` caller

| Caller | Effect of this change |
|---|---|
| `plainhand/workflow.mjs:291` prepare/revise | Allow-list and quote rule on resume entries and answers; identity gate on answers. New pipeline test: planted answer fails the task, no packet saved; the fixture packet still completes. |
| `plainhand/workflow.mjs:241` standard task | Allow-list and quote rule on master resume lines (no answers, so no identity gate). `test-standard` passes. |
| `plainhand/workflow.mjs:207` evaluation matches | Allow-list and quote rule; match `text` is not treated as an answer, so no identity check. `test-bench-eval` and `test-plainhand` pass. |
| `plainhand/evaluation/score.mjs:299` (parallel scorer lane; **not edited**) | `evidenceValid` inherits the allow-list: a match citing `writing-samples` now returns `false` (direct probe: factual match `true`, writing-sample match `false`), while a factual match stays `true`. Match text that looks like an identity claim still passes, because the identity rule is answer/form-value only — evaluation scoring is otherwise unchanged. The evaluation harness context never includes `writing-samples` (grep of `plainhand/evaluation/**`), so its scenarios are unaffected. `test-bench-eval` passes. |
| `plainhand/answer-bank.mjs:36,71` | Specific source-kind refusal on `add`; `match` skips non-factual or legacy-invalid entries. New `test-answer-bank` case. |
| `plainhand/corrections.mjs:42` propose/approve | Specific source-kind refusal; `approve` re-validates. New `test-corrections` case including a planted legacy entry. |
| `plainhand/workflow.mjs` `suggestFormAnswers` | No direct gate; it consumes packet answers that already passed the prepare gate and bank answers that already passed `validEvidence`. Packet and bank values therefore cannot carry voice/summary evidence into a field plan; no source edit was needed. |
| `plainhand/presubmit.mjs` `presubmitCheck` | No evidence call; it reports the plan the gated paths produced. Unchanged, and its tests pass. |
| `plainhand-server.mjs:104` browser form suggestions | Same gate applies to `{key, answer}` suggestions, including the identity rule. `test-plainhand` browser/autofill tests pass. |
| `plainhand/cloud/extension-api.mjs` form plan | Uses `suggestFormAnswers` and `AnswerBank.match`; it consumes the gated packet and the bank gate. `test-cloud-extension-api` passes. |
| `plainhand/benchmarks/runner.mjs:35,50,58,164` | Benchmark harness; oracle evidence ids are `profile`, `cv`, `proof-points`, so the allow-list holds. `test-profile-bench` and the full suite pass. |
| `plainhand/benchmarks/typed-preparation.mjs:7` | Same gate on packet resume and answers. |
| `plainhand/features/interview-prep.mjs:80` | Questions and bridges carry `answer`, so the identity rule applies; no fixture answer contains an unsourced identity. `test-feature-interview-prep` passes. |
| `plainhand/features/skill-plan.mjs:100` | Adjacent items have `claim`, not `answer`, so only the allow-list and quote rule apply. `test-feature-skill-plan` passes. |
| `plainhand/features/followups/checks.mjs:48` | Inline evidence check, not `hasEvidence`; outside M2's named consumers. It is fed from the already-gated packet plus record/notes sources; recorded as a residual rather than edited. |
| `tests/test-plainhand.mjs:301` | Existing assertion unchanged and passing. |
| `tests/test-plainhand-records-live.mjs:39` | Opt-in live test, not run (needs an installed CLI and a real browser). Its suggestions are employer and title names with no `at` frame, year or name introduction, so the identity rule would not fire. |

## 8. Decisions, limits and residuals

- **Assertion provenance stays M4.** `validEvidence` refuses the two named
  non-factual kinds but still accepts `candidate-answer`, because the browser
  fill path offers answers the candidate typed as corrections and M4 owns
  `sourceKind`, re-verification and scope. An arbitrary invented id also passes
  the bank's shape check today, but it can never ground a packet claim
  (`hasEvidence` allow-list). Named as a residual and an M4 input, not a hidden
  pass.
- **Identity gate is deliberately narrow.** It checks answers and form values
  only, not resume lines (headings are checked by `verifyHeadings`) and not
  evaluation matches. It catches the required dated title/employer plant, an
  unsourced year, an explicit name variant, a raised seniority title and a
  changed employer when a year sits in the sentence. It does **not** catch an
  undated title or employer claim, a claim phrased after `at` (`worked at
  Northwind as a Director` with no date), a name variant not introduced with
  `my name is`/`I go by`/`call me`, or a two-digit year range. Those remain the
  reviewer's and calibration's job; the reviewer instruction now names them.
- **Dates in answers must come from the factual sources.** An answer that
  mentions the *employer's* date (for example a posting launch year) fails the
  year rule unless the sources also state it. The drafter is told not to
  introduce such dates; the cover letter is not identity-gated. Reviewers may
  want to widen this if real packets need posting dates in answers.
- **Seniority stems.** The title check compares a five-letter stem, so
  `manager` matches `managed` and `director` matches `directed`: fewer false
  rejections, slightly less precision against level inflation. Employer words
  must match exactly.
- **Legacy reusable answers.** `answers.update` re-saves an existing entry
  through `AnswerBank.add`; a legacy entry whose evidence cites
  `writing-samples`/`reviewed-understanding` now throws the specific error
  instead of being silently re-blessed. No such entry exists in the fixtures;
  the candidate can remove it, and M4 will add re-verification.
- **No quality measurement.** M2 can change packet acceptance; it is a candidate
  change against the frozen baseline and was not measured here. Real-model,
  browser/UI and hosted/cloud runs are not part of the structural tier and were
  not run. The legacy CLI answer bank and follow-up evidence check were not
  touched.
- **Test environment.** The worktree had no dependencies; `node_modules` was
  symlinked to the main checkout (same `package.json`) to run tests. The symlink
  is ignored and untracked. `/home/ak/.cache/plainhand-eval-tmp` holds only
  synthetic probe and test output.

## 9. Commands that actually ran

```bash
# before evidence, product files stashed at the dispatch pin
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --input-type=module -e '<hasEvidence/validEvidence/Corrections probe>'
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-evidence-sources.mjs tests/test-writing-samples.mjs tests/test-answer-bank.mjs tests/test-corrections.mjs

# after
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-evidence-sources.mjs tests/test-writing-samples.mjs tests/test-answer-bank.mjs tests/test-corrections.mjs
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-writing-samples.mjs tests/test-plainhand.mjs tests/test-answer-bank.mjs tests/test-corrections.mjs tests/test-brain-controls.mjs tests/test-standard.mjs tests/test-bench-eval.mjs tests/test-evidence-sources.mjs
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-exports.mjs tests/test-feature-interview-prep.mjs tests/test-feature-skill-plan.mjs tests/test-profile-bench.mjs tests/test-actions.mjs tests/test-cloud-extension-api.mjs
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 $(node -e "console.log(require('./package.json').scripts['test:plainhand'].replace(/^node --test /,''))")
git diff --check
node --check plainhand/store.mjs plainhand/answer-bank.mjs plainhand/corrections.mjs plainhand/agents.mjs
```

## 10. Deliberately not done

No M1, M3, M4, M5 or M6 work; no edit to `plainhand/evaluation/**`,
`plainhand/cloud/**`, `workflow.mjs`, `actions.mjs` or the UI; no live
provider, browser session, install, hosted or cloud write; no register,
manifest, board, handoff, `GOAL-ACCEPTANCE.json`, `EVIDENCE.json` or
`REVIEW.md` edit; no push, main merge, tag, deploy, contact or submission; no
browser or server left running. Only the files listed in §2 changed.

## 11. No self-acceptance

This is an implementation report, not an acceptance record. The author did not
review their own diff as a gate, did not mark any row `PASS`, and did not merge
to the goal branch. Root review of `ffc115f` and of this file is the next gate.

---

# Lane result: durable-memory M1 — transfer preserves memory, never authority

Status: **implemented on the lane, awaiting root review.** This is packet M1 of
[ASSIGNMENT.md](ASSIGNMENT.md) §8 with the root decisions in [REVIEW.md](REVIEW.md)
(source files included, approvals reset, autonomy disabled, no credential, connection
check or remote secret). The author does not accept this work, does not edit the
register, manifest, board, handoff, `EVIDENCE.json` or `REVIEW.md`, and has not
merged, pushed or deployed.

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Worktree | `/home/ak/.t3/worktrees/Plainhand/t3-547ceca5-2ef5e49e29ed75db` (cwd confirmed before edits) |
| Branch | Started `t3/547ceca5`; renamed externally to `t3/durable-memory-m1-transfer` at the same HEAD (reflog `HEAD@{0}: Branch: renamed refs/heads/t3/547ceca5`), no content change by this lane |
| Expected and actual dispatch HEAD | `5712e16b35c2bfa0ebb1a06cfcdc887c10b7ea9a` (matched; tree clean at start) |
| Author | Pi `deepseek/deepseek-flash`, existing metered account; bounded implementation sub-agent, no delegation |
| Reviewer | root, different model family; root reads the diff |
| Host | `free -h` before the final full suite: 5.9 GiB available, swap heavily used. Runs capped at `--test-concurrency=2`; no install, container, browser or provider call |
| Test dependencies | `node_modules` symlinked to `/home/ak/Plainhand/node_modules` (same `package.json`; ignored, untracked, not an install) |
| TMPDIR | `/home/ak/.cache/plainhand-eval-tmp` (outside the repo) |

## 2. Exact commits

| Step | Commit | What it is |
|---|---|---|
| Lane base | `5712e16b35c2bfa0ebb1a06cfcdc887c10b7ea9a` | dispatch pin |
| Implementation | `dea586beb48da2ad135b348df7f0fab7f7a6c7cc` | `plainhand/workspace-import.mjs`, `plainhand-server.mjs`, `plainhand/cloud/{app,workspace-transfer}.mjs`, `plainhand/{answer-bank,corrections}.mjs`, the three test files, `package.json` |
| Follow-up | `fc87c948b4d40f33e0dc66cf48cdc9f4b775ce78` | legacy export with no bank: keep the destination answers, held; matching falsifier |
| This result | committed after the follow-up | `docs/internal/lanes/durable-memory/RESULT.md` only |

No rebase, squash or force push of imported history. No push, main merge, tag,
deploy, external contact or submission.

## 3. Defect verified in source before fixing

- `/api/export` spread whole state locally (`plainhand-server.mjs:195`) and on the
  website (`cloud/app.mjs:302`). `importWorkspace` restored only a 12-key allow-list,
  so `writingSamples`, `claimLine`, `standard`, `resumeFormat` and `settings` were
  dropped, while every other state key was deleted.
- `data/answer-bank.yml` and `data/plainhand/corrections.json` were outside the
  transfer format in both directions, and the four bounded user-layer sources were
  not carried, so a claim's quote and a reusable answer's quote could not be checked
  against the imported workspace.
- Local import put `connectionChecks` in its allow-list (hosted stripped it), and its
  final `saveProfile` call set `state.understanding = null` after the import had
  restored it.
- Nothing reset the imported `standard`, so a carried approval hash could have arrived
  as authority; autonomy only failed safe because `settings` was missing.

## 4. What changed and the falsifier each fix closes

**`plainhand/workspace-import.mjs`.** One shared export/import contract:

- `exportWorkspace(workspace, extra)` is the allow-list both `/api/export` routes now
  use: whole state minus `connectionChecks`, every job's `browserCheckpoint`, plus
  `answerBank`, `corrections`, and a `files` map of the four bounded user-layer
  sources (`modes/_profile.md`, `article-digest.md`, `interview-prep/story-bank.md`,
  `data/resume-source.yml`, each up to 1 MiB). An oversize source is listed in
  `filesOmitted` instead of being truncated.
- `importWorkspace` rebuilds every imported value from a known shape instead of
  copying: writing samples (10 × 8000 characters, id/title/date), claim line
  (300 decisions, 30 statements), master resume draft (headline, 150 lines with
  headings and evidence, cover letter, suggestions), format through `cleanFormat`,
  and settings as exactly `{autonomy:{perDay,minScore}}` with `enabled:false`.
  `approvedHash` and `approvedAt` are written as `null`; the draft is kept.
- The understanding text is preserved with `approved:false`; the import no longer
  calls `saveProfile`, so the old null-out cannot happen. Its `contextHash` is kept,
  so `understanding.approve` still refuses until the summary is rebuilt against the
  imported sources.
- Job approvals reset, `browserCheckpoint` deleted, stages marked `needs-refresh`,
  in-flight tasks interrupted, `connectionChecks` never imported, one import event
  with counts only (`n roles, n packet approvals reset, n reusable answers held,
  n sensitive answers dropped, n corrections held, n claims without their source`),
  no content or secret in it.
- Reusable answers: retained, with `status:'needs-review'` and not matched by
  `AnswerBank.match` when any quote is absent from the imported factual sources or
  the source id is not factual; a sensitive question is dropped and counted; entries
  are deduplicated by normalized question. Corrections keep their status and
  timestamps; an `approved` correction whose linked bank entry is held becomes
  `needs-review` and is counted.
- Older exports (no `files`, no `answerBank`, no `corrections`) leave the four source
  files alone and keep the destination's bank and corrections, held against the
  imported sources. New exports replace all three.
- Atomicity: backups of every replaced file, a `prepared` marker, all file writes
  before `workspace.json` (the state commit is last inside `mutate`), then
  `state-committed`/`done` markers. Any failure restores the backups and removes the
  marker; a crash leaves a marker that `recoverInterruptedImport` uses on the next
  load (`prepared` restores backups, `state-committed` re-syncs the tracker). The
  local server calls recovery at startup and before each import; hosted import stays
  inside its existing `storage.exclusive` transaction.
- A structured resume travels only with its mirror: an export that carries
  `data/resume-source.yml` without resume text is refused, and a destination that
  already has a structured resume refuses an export that does not carry one (local
  `ImportError`, hosted `structured_resume_conflict`).

**`plainhand/answer-bank.mjs`.** `AnswerBank.match` skips `needs-review` entries, so a
held answer never fills a form field. `add` is unchanged, so a candidate re-saving an
answer still re-validates it.

**`plainhand/corrections.mjs`.** Exports `CORRECTIONS_FILE`, used by the transfer.

**`plainhand-server.mjs`.** Export route uses `exportWorkspace`; startup runs
`recoverInterruptedImport` before anything else reads the workspace; import route
unchanged (same `ImportError` mapping to 400).

**`plainhand/cloud/app.mjs`.** Hosted export route uses the same `exportWorkspace`.

**`plainhand/cloud/workspace-transfer.mjs`.** `prepare` passes the same allow-list
through its credential strip (also strips `approvedAt`), validates the new fields and
the files map, no longer manufactures `connectionChecks`, and applies the
structured-resume conflict only when the export does not carry the source. The
preview warning names held reusable answers.

**Tests.** New `tests/test-memory-transfer.mjs` (8 tests) and one new route-level test
in `tests/test-workspace-import.mjs`; the file is in the `test:plainhand` list. The
only change to an existing assertion is the hosted transfer test's
`connectionChecks` check, now `undefined` (no key at all) instead of `{}` — stricter,
because the key is no longer imported.

## 5. Before/after evidence

**Before, on dispatch HEAD `5712e16`** (the six product files and `package.json`
restored from the pin, test files present; the export used in the probe is the
documented version-1 shape, built from the workspace's own state, bank, corrections
and four source files):

```
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 \
  tests/test-memory-transfer.mjs tests/test-workspace-import.mjs
ℹ tests 11   ℹ pass 2   ℹ fail 9
```

Failures are the intended ones, all in the new falsifiers: the rich round trip has no
`answerBank`/`corrections`/`files` counts to restore and drops the five state keys;
the export has no allow-list helper; the legacy-export case is matched by the bank
without a quote check; the injected failure (corrections is never written) and the
marker recovery cannot run; the structured resume does not travel; the route export
has no `files`. The two existing import tests still pass on the pin. Log:
`/home/ak/.cache/plainhand-eval-tmp/m1-before-final.txt`.

**After `fc87c94`, same files:** `tests 11, pass 11, fail 0`.

**Focused set** (13 files: transfer/import, answer bank, corrections, standard,
actions, exports, brain controls, usage, agent engine, evidence sources, writing
samples, claim line): **97 tests, 97 pass, 0 fail** (6.8 s).

**Full `test:plainhand` list** (52 files, includes the new file): **473 tests, 473
pass, 0 fail** (51.1 s). `git diff --check` exited 0; `node --check` passed on every
changed `.mjs`. No assertion was relaxed to reach green.

The falsifiers now asserted:

| Falsifier | Assertion |
|---|---|
| A key missing or changed after export → import | samples, claim line, master draft, format, context prefs, understanding text, narrative/story-bank/proof-point files deep-equal or exact |
| The standard arriving approved | `approvedHash`/`approvedAt` null, `standardStatus !== 'approved'`, `standardInput === null` |
| Autonomy arriving enabled | `settings` exactly `{autonomy:{enabled:false,perDay:4,minScore:4.5}}`, `autonomyOf().enabled === false`, `autoPrepareDecision().prepare === false` |
| A held answer matching | `AnswerBank.match` null for the held label, `suggestFormAnswers` omits it, `status:'needs-review'` stored |
| A sensitive entry stored | not in the bank, counted in `sensitiveAnswersDropped` |
| A credential, connection check or checkpoint present | `state.connectionChecks` undefined, no job `browserCheckpoint`, planted `sk-live-*` values absent from state and export |
| A mixed state after an injected write failure | `workspace.json`, bank, CV, narrative and tracker byte-identical; marker gone; the next import completes |
| A crash mid-import | `prepared` restores the backups and removes the marker; `state-committed` re-syncs the tracker and removes the marker |
| A structured resume split from its mirror | both directions refused before any write |
| A story-backed claim losing its source | the `stories` claim still passes `hasEvidence` after import; a legacy export counts it unresolved |

## 6. Tests that actually ran, with counts

| Command | Result |
|---|---|
| The two falsifier files (before, product at the pin) | **11 tests, 2 pass, 9 fail** |
| The two falsifier files (after) | **11 tests, 11 pass, 0 fail** |
| Focused 13-file set (after) | **97 tests, 97 pass, 0 fail** |
| Full `test:plainhand` list, 52 files (after) | **473 tests, 473 pass, 0 fail** |

All with `TMPDIR=/home/ak/.cache/plainhand-eval-tmp` and `--test-concurrency=2`,
scripted providers only. Hosted `tests/test-cloud-*.mjs` were **not run**: no
Postgres was available (`PLAINHAND_TEST_DATABASE_URL` unset, no listener on 5432)
and no container was started. That tier, including the in-memory `TransferMemory`
tests, remains root's gate.

## 7. Consumer audit

| Consumer | Effect of this change |
|---|---|
| `plainhand-server.mjs` `/api/state` | Reads `state.answerBank`, `standardStatus`, `autonomyOf`, `resumeFormat`, `state.standard`; all new values are well-shaped, and held entries simply appear in the list. `/api/providers` reads `state.connectionChecks?.[id]`, safe when absent. |
| `plainhand-server.mjs` `/api/import`, `/api/import/preview` | Same entry points; `preview` now also reports `answerBank`, `corrections` and `files` counts. Import errors still map to 400. |
| `plainhand-server.mjs` form plan (`suggestFormAnswers`) | Uses `AnswerBank.match`; a held entry cannot fill a field (asserted). |
| `plainhand/cloud/extension-api.mjs` form plan | Same `suggestFormAnswers` + bank; held entries are skipped. |
| `plainhand/cloud/app.mjs` `/api/export` and `stateFor` | Export uses the shared allow-list; `stateFor` already surfaces the imported keys and reads the connection check from its own file. |
| `plainhand/cloud/workspace-transfer.mjs` preview/apply | Same allow-list and sanitizers through `importWorkspace`; the preview count fields are additive. |
| `plainhand/web/ui/settings.mjs` | Reads `preview.approvalsReset/jobs/applied/conversation/sources` (unchanged), downloads the export JSON, shows the toast from `result.jobs`. It lists reusable answers including held ones without a badge (residual). |
| `plainhand/workflow.mjs` rendering, `lineInput`, standard task | `state.resumeFormat`, `state.claimLine` and `state.standard` keep their shapes; the master draft is present but never approved, so `standardInput` is null until the candidate re-approves. |
| `plainhand/standard.mjs` `autonomyOf` / `autoPrepareDecision` | `settings.autonomy.enabled` is always false after import (asserted). |
| `plainhand/profile-strength.mjs`, `actions.mjs` profile card | `understanding` is present but unapproved → "needs-review"; `standardStatus` is `draft`/`stale`, never `approved`. |
| `plainhand/answer-bank.mjs` `add`/`update`/`remove`, settings UI | Unchanged; a candidate re-saving a held answer revalidates and clears the hold through `add`. |
| `plainhand/corrections.mjs` `approve` | Still re-validates through `AnswerBank.add`; a held imported correction can be approved again by the candidate. |
| `plainhand/web/ui/demo.mjs` | Static demo state; unaffected. |
| Export consumers (tests, `docs/internal/DESKTOP.md`) | The documented contract is the same `/api/export` JSON; it now includes `files`, `answerBank` and `corrections` and omits machine state. |

## 8. Decisions, limits and residuals

- **Export now omits `connectionChecks` and `browserCheckpoint`.** The design's I5
  says transfer carries no connection check or checkpoint; import also refuses them
  if an older export contains them. Packet approvals stay in the file but are reset
  on import, because the PDFs are not part of an export and the UI explains that.
- **Provider id.** A local import still carries the provider id as before; hosted
  still resets it (unchanged, out of M1's scope). No credential travels either way.
- **Master resume metadata.** `draft`, `coverage` and (when the view can read it)
  `calibration` travel; `review`, `reviewAttempts`, `humanizer` are producer output
  and are not imported. `contextHash` travels so status reads `stale` rather than
  silently `draft` when the sources moved.
- **Source-file cap.** A source over 1 MiB is omitted from the export and reported in
  `filesOmitted` and the import event; the destination's copy is left in place and
  claims that cite it are counted unresolved. This is the "reported, not truncated"
  rule from the design.
- **Legacy exports** keep the destination's bank/corrections (held against the
  imported sources) and leave the four source files untouched; their claims may be
  counted unresolved. New exports replace all of them.
- **Held answers are visible but inert.** The settings UI has no "needs review" badge
  for a held reusable answer; adding it is a UI change outside M1's file scope. The
  matching gates (bank, form fill) are tested.
- **Sanitizers are bounded, not lossless for hand-edited files.** A bank question over
  500 characters, an answer over 5000, a sample over 8000, more than 150 master lines
  or a malformed draft are dropped or held and counted; a production export never
  exceeds these because the producers enforce them.
- **Local atomicity has no cross-process lock.** Two simultaneous local imports could
  interleave file writes; the UI imports one at a time, and `busy` plus the task check
  cover the normal path. Hosted import keeps its transaction.
- **No measurement.** M1 is a correctness packet; the scored output is expected to be
  unchanged because no prompt, threshold, rubric or scenario was touched, but this was
  not measured here. Real-model, browser UI, desktop and hosted tiers were not run.

## 9. Commands that actually ran

```bash
# before evidence: product files restored from 5712e16, test files present
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-memory-transfer.mjs tests/test-workspace-import.mjs

# after
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-memory-transfer.mjs tests/test-workspace-import.mjs
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 tests/test-memory-transfer.mjs tests/test-workspace-import.mjs tests/test-answer-bank.mjs tests/test-corrections.mjs tests/test-standard.mjs tests/test-actions.mjs tests/test-exports.mjs tests/test-brain-controls.mjs tests/test-plainhand-usage.mjs tests/test-agent-engine.mjs tests/test-evidence-sources.mjs tests/test-writing-samples.mjs tests/test-claim-line.mjs
TMPDIR=/home/ak/.cache/plainhand-eval-tmp node --test --test-concurrency=2 $(node -e "console.log(require('./package.json').scripts['test:plainhand'].replace(/^node --test /,''))")
git diff --check
node --check plainhand/workspace-import.mjs plainhand/answer-bank.mjs plainhand/corrections.mjs plainhand-server.mjs plainhand/cloud/app.mjs plainhand/cloud/workspace-transfer.mjs tests/test-memory-transfer.mjs tests/test-workspace-import.mjs tests/test-cloud-workspace-transfer.mjs
```

## 10. Deliberately not done

No M3, M4, M5 or M6 work; no edit to `plainhand/evaluation/**`,
`plainhand/claim-calibration.mjs`, the master-resume semantics or the UI; no live
provider, browser session, install, container, hosted or cloud write; no register,
manifest, board, handoff, `GOAL-ACCEPTANCE.json`, `EVIDENCE.json`, `REVIEW.md` or
`GOAL-HANDOFF.md` edit; no push, main merge, tag, deploy, contact or submission; no
private data; no server, browser or watcher left running; no process killed that this
lane did not start.

## 11. No self-acceptance

This is an implementation report, not an acceptance record. The author did not review
their own diff as a gate, did not mark any row `PASS`, and did not merge to the goal
branch. Root review of `dea586b`, `fc87c94` and this file is the next gate, followed
by the hosted/Postgres tier the author could not run.
