# Lane result: durable-memory M5 and M6

Status: **implemented on the lane, awaiting root review.** This is an author report,
not an acceptance record. The author does not edit `GOAL-HANDOFF.md`, `EVIDENCE.json`,
`docs/internal/GOAL-ACCEPTANCE.json`, any `REVIEW.md`, the registers or the baseline,
and has not merged, pushed, tagged or deployed.

Spec: [ASSIGNMENT.md](ASSIGNMENT.md) §4 finding 9, §5 invariants (I8) and §8 M5/M6;
[REVIEW.md](REVIEW.md) decision 3 (M5 deterministic and decision-only) and 5
(structural probe now, real-model tier in the measurement lane).

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Worktree | `~/.t3/worktrees/Plainhand/t3-e5bfbea1-d2317e6599b93837` (cwd confirmed before edits) |
| Branch | `t3/memory-m5-m6` |
| Base / dispatch HEAD | `91ded5e8bb61880c3f5ac9fa014909767f2ba76d` (M4 merge; tree clean at start) |
| Implementation commit | `833ecacbfe5f0e872d303367c1725eb8306a3cae` |
| Author | Pi `deepseek/deepseek-flash`; bounded implementation sub-agent, no delegation |
| Reviewer | root, different model family; root reads the diff |
| Host | 7.4 GiB available before the benchmark, 7.7 GiB before the final suite; suite capped at `--test-concurrency=2` |
| Dependencies | `node_modules` symlinked to `~/Plainhand/node_modules` (same `package.json`; ignored, not an install) |
| TMPDIR | `~/.cache/plainhand-eval-tmp` (outside the repo) |
| Provider calls | none live or paid; every model response in tests and the probe is a scripted fixture |

## 2. Files changed

| File | Change |
|---|---|
| `plainhand/memory-checks.mjs` | New pure module: sentence slicing, five deterministic detectors, conflict ids, decision suppression, conflict question, settled-question lookup, prepare pre-check, question ledger and counts, state-only memory report. |
| `plainhand/actions.mjs` | `conflicts.list` (read), `conflicts.record` (candidate); digest `memory` counts. The read action redacts excluded-source quotes before returning. |
| `plainhand/workflow.mjs` | Small prepare pre-check after reusable-answer injection: settled questions are dropped and recorded, cited conflicts add a blocking question. One call at commit records the question checks. |
| `plainhand/workspace-import.mjs` | `conflictReview` in `STATE_KEYS`; `cleanConflictReview` rebuilds decisions and question checks from a known shape; import summary counts them. Export already spreads the state, so no export edit was needed. |
| `plainhand/profile-strength.mjs` | `conflicts` and `questions` counts on the result; one `next` item when a conflict is open. |
| `plainhand-server.mjs` | `/api/state` carries `memory` and `memoryConflicts` from the full local source set; `/api/conflicts/record` route. |
| `plainhand/web/ui/profile.mjs` | “Facts that disagree” card: both exact quotes, source labels, “This is right” per quote, “Edit a source”, and the repeated-settled-question line in Profile strength. |
| `plainhand/web/css/app.css` | Card quote styling only. |
| `scripts/memory-probe.mjs` | M6 probe; writes `output/memory-probe-<ts>.json` by default, `--out` for the test. |
| `tests/test-memory-checks.mjs` | New M5 unit and end-to-end tests. |
| `tests/test-memory-probe.mjs` | Runs the probe as a separate process inside the suite. |
| `tests/test-actions.mjs`, `tests/test-agent-injection.mjs` | Action-contract lists updated for the two new actions (no assertion weakened). |
| `tests/test-plainhand-ui.mjs` | Real Chromium check of the conflict card: both quotes, Edit a source, resolve, card disappears. |
| `package.json` | The two new test files added to `test:plainhand`. |

## 3. M5 design

### 3.1 Detection (`plainhand/memory-checks.mjs`)

The module has no I/O and no model. It reads the current factual sources plus the
structured profile, slices exact sentences, and compares only across different
sources; internal variation in one source is not a contradiction. It implements
exactly the five material cases:

- **Employer/title.** `Title at Employer` and `Worked at Employer as Title` claims
  grouped by normalized employer. Different titles conflict unless both claims have
  date ranges that do not overlap: a promotion (`2020–2022` then `2022–2024`) is a
  handover, not a conflict.
- **Dates.** The same employer and title with ranges that overlap but are not equal.
- **Degree/graduation year.** One highest degree per source (the profile's single
  graduation year is settled when *any* listed degree has that year). A second degree
  at a different school and year is a history; same school, same year, or same level
  with a different year is a conflict.
- **People counts.** A team/count phrase (`led a team of 5`, `coordinated 3
  contractors`) per source with different counts.
- **Location and eligibility.** Explicit current-location statements vs the profile
  location, and work authorization vs a sponsorship requirement in the same country.

Every finding carries `{id, kind, topic, sourceIds, quotes: [{sourceId, quote}]}`.
The id is a digest of kind, topic and the two quote digests, so it is stable across
restart and import while an edited source creates a new id.

### 3.2 The only new state key

`state.conflictReview` holds decisions and question checks, never copied facts:

```json
{
  "decisions": [{ "id": "...", "kind": "number", "sourceIds": ["cv", "interview"],
                  "quoteDigests": ["...", "..."], "disposition": { "sourceId": "cv" },
                  "at": "..." }],
  "questionChecks": [{ "digest": "...", "by": "profile", "at": "...", "jobId": "..." }]
}
```

`conflicts.record` recomputes the open findings, validates that the chosen source is
one of the two, and appends the decision. A decision suppresses the same finding on
the next load, without storing either quote. The ledger transfers in
`workspace-import.mjs` (`STATE_KEYS`, `cleanConflictReview`, summary counts) and a
decision therefore survives restart and import.

### 3.3 The prepare pre-check

After reusable-answer injection and before humanize/review, `prepareMemoryCheck`:

1. runs the settled-question lookup in order: profile field, exact approved bank
   answer, this packet's own answer; a question one of those settles is removed and
   its digest/by recorded (a question about the employer's own salary, location,
   degree or sponsorship is not treated as the candidate's answer);
2. detects open conflicts over the full local source set (`contextPrefs: {}`), then
   adds a blocking question only when a resume or answer claim cites one of the
   conflict's source ids. `packet.approve` already refuses while `questions` is
   non-empty, so the packet cannot use either value as settled.

The question names the topic. It quotes only shared sources, so an excluded source
can cause the block while its text never enters the question. The recorded question
check is only `{digest, by, at, jobId}`; `questionStats` exposes `asked`, `distinct`
and `repeated`. The server and profile strength expose those counts; the profile
strength card shows the repeat line when it is non-zero. `conflicts.list` returns
the open findings with excluded quotes filtered out, because the agent can call it
and its result would otherwise reach a provider; the local card uses the server's
own `memoryConflicts`, which includes both quotes.

### 3.4 UI

The profile page renders “Facts that disagree” under “Keep improving”. Each item
shows the kind and topic, both quotes with their source labels (and “not shared with
your agent” on an excluded one), one “This is right” button per quote, and one
“Edit a source” button that navigates to the foundation form, the interview/story
card, or the Workspace files card depending on the first source.

## 4. Falsifiers and mutation checks

| Falsifier | Test | Result |
|---|---|---|
| CV “led a team of 5” vs story “coordinated 3 contractors”: both quotes, packet blocked, no settled use, decision clears it, restart/import keep it clear | `tests/test-memory-checks.mjs` end-to-end | pass |
| A settled employer, date or degree is never listed; a promotion and a second degree are not conflicts | unit cases in the same file | pass |
| An excluded source’s text never appears in a packet question or provider input; the read action redacts it | unit + end-to-end + probe | pass |
| The card lists both quotes and resolves to empty | `tests/test-plainhand-ui.mjs` real Chromium | pass |

Mutation checks (temporary source edits, reverted; tree verified identical after each):

| Mutation | Test that caught it |
|---|---|
| `numberFact()` returns `null` (detector off) | `node --test --test-name-pattern="different numbers" tests/test-memory-checks.mjs` → fails at “different numbers … conflict” |
| `prepareMemoryCheck` sets `blocking = []` (pre-check off) | `node --test --test-name-pattern="prepare answers settled questions" tests/test-memory-checks.mjs` → fails at “a cited source in an open conflict adds a blocking question” |

The first benchmark run after the initial implementation exposed a real false
positive: the ops persona lists an MBA (2020) and an older BA (2018), and the
profile's single graduation year 2020 was compared against every listed degree.
`ops-resume`, `ops-sensitive`, `ops-records` and `holdout2-newer-unrelated-stem`
failed approval with “Resolve open questions”. Fixed by comparing one highest degree
per source and treating a profile year that matches *any* listed degree as settled;
`tests/test-memory-checks.mjs` now pins the multi-degree case. No threshold,
scenario, assertion or baseline was changed.

## 5. M6 probe

`scripts/memory-probe.mjs` runs on `mkdtemp(tmpdir())` with a scripted provider, no
browser and no network. It:

1. fills profile, stories, voice sample, line statement, resume format, autonomy,
   understanding (approved), master resume draft, answer bank correction and a
   packet approval;
2. restarts in a **separate Node process** and diffs state, bank, corrections and
   context hash;
3. switches `provider` from `codex` to `claude` and diffs identity, understanding,
   samples, line, format, standard draft and approvals;
4. prepares one job with every provider input captured, then checks the excluded
   sample, the excluded phone field, credential-shaped keys in provider input and in
   the export, and absent `connectionChecks`/`browserCheckpoint`;
5. deletes the story a packet used, shows the old packet is stale, re-evaluates,
   and shows the retry fails evidence and does not replace the saved packet;
6. approves a correction and prepares a second job: the approved text and bank quote
   are reused, review re-ran, and the settled question was asked in three
   applications with two repeats counted;
7. plants the 5-vs-3 contradiction, blocks a packet citing CV, records a
   disposition, shows the conflict gone, restarts, exports/imports, and re-prepares
   without the question.

Evidence from the final run:

- `output/memory-probe-2026-11-16T02-59-14-274Z.json`
- `ok: true`, 47 checks, 0 failures, 4 captured provider inputs, 4.6 s.
- The run is also in the suite as `tests/test-memory-probe.mjs` (an independent
  process; a failing falsifier fails the suite).

## 6. Gates actually run

| Command | Result |
|---|---|
| `free -h` before work and before the benchmark | 6.6–7.7 GiB available |
| `npm run test:plainhand -- --test-concurrency=2` | **586/586 pass, 0 fail** (44.5 s) |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | **64/67**, 3 expected failures (`profile-effect-{fin,analyst,sci}-minimal`), **0 unexpected**; evidence `output/evaluation-controlled-2026-11-16T02-56-44-267Z` |
| `npm run test:plainhand-ui` | pass; browser evidence `~/.cache/plainhand-eval-tmp/plainhand-ui-evidence-1OXxIe` |
| `node --check` on every changed module/test/script | pass |
| `git diff --check` | clean |

The final suite and UI runs were made after the degree fix and the final UI edit.

## 7. Deliberate limits and not done

- **Deterministic only.** No semantic or model-based contradiction detection; that
  is measurement-lane work per REVIEW.md decision 3.
- **Digest counts are the state-backed subset.** `buildDigest` is synchronous and
  sees profile, resume and interview; a conflict that exists only in a file source
  (narrative, proof points, story bank) appears on the card and blocks prepare,
  because both use the full context, but the agent digest count does not include
  it. The profile-strength counts have the same boundary.
- **Question channels.** The settled lookup runs on the prepare pre-check, which is
  the application question channel and the U06 repeat counter. Evaluation gaps and
  understanding questions keep their existing channels and are not filtered or
  counted here.
- **Hosted surface.** The card is the local profile page. The hosted cloud page keeps
  its existing layout and state response; no hosted route or UI was added.
- **No live model or browser benchmark tier.** The real-model repeat-question and
  memory-contribution measurement stays with the measurement lane; this probe is
  structural and asserts on product state, not on its own fixture constants.
- **No register/manifest/board/handoff edit.** No merge, push, tag, release, deploy,
  install of a new dependency, external contact or submission.

## 8. Review focus

1. `conflicts.list` redaction: the agent/MCP result must never carry excluded quote
   text; the local card deliberately still shows both quotes to the candidate.
2. The prepare pre-check runs only on prepare/revise, is idempotent per packet, and
   cannot suppress a conflict by decision id unless the quote digests are unchanged.
3. The degree rule: one highest degree per source, and a profile year matching any
   listed degree is settled. This is what removed the ops-* and holdout false
   positives without weakening the planted-degree test.
4. `workflow.mjs` stays a small, self-contained pre-check; the only other edit is the
   one-line call that records the settled-question checks at commit.
