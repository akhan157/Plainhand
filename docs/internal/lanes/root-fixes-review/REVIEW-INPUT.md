# Root fixes — independent review input

- Reviewer: independent review sub-agent; did not author these commits.
- Branch: `t3/review-root-fixes-commits`
- Reviewed base: `789dcd523baef5951ce0626b41410f3c519b50e3` (HEAD at review start)
- Date: 2026-11-16
- Environment: `TMPDIR=~/.cache/plainhand-eval-tmp`, Node v26.12.1, x64 Linux. The
  worktree had no `node_modules`; `npm ci --ignore-scripts` added 162 packages. No live or
  paid model calls. No push, no merge, no product changes kept: every temporary revert was
  restored and `git status --short` was clean before this file was written.

## Verdict table

| # | Commit | Subject | Verdict |
| --- | --- | --- | --- |
| 1 | `23645f7` | Count an interview area once asked and answered | **accept-with-fixes** |
| 2 | `829e19c` | Drop empty resume rows; ask for one line on gap roles | **accept** (workflow half superseded by `a7c69b7`) |
| 3 | `3958509` | U11 scanner skips its own planted fixtures | **accept-with-fixes** |
| 4 | `2390743` | Manual kit requires an approved, fresh packet | **accept-with-fixes** |
| 5 | `cc705fb` | Legacy fixture oracle excludes contact fields from the profile quote | **accept** |
| 6 | `789dcd5` | Merge U14 into the packet-quality branch (`plainhand/workflow.mjs`) | **accept-with-fixes** |
| 7 | — | Package.json merge resolutions / test-script coverage | **accept** |
| 8 | — | `scripts/u12-reachability.mjs`: `conflicts.list` in `UI_AGGREGATE` | **accept** |

**Overall: accept-with-fixes.** No commit is a reject and no reproduction shows a broken
guarantee at the reviewed HEAD. Two user-visible correctness gaps remain (fixes 1 and 4),
one quality blind spot (fix 3), and one untested opt-in contract (fix 6). The full plainhand
suite and both required benchmarks pass at HEAD.

## Commands actually run (all at the reviewed HEAD unless noted)

| Command | Result |
| --- | --- |
| `npm run test:plainhand` | **633/633 pass**, 0 fail, 52.05 s |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | **64/67**, 3 expected failures only: `profile-effect-fin-minimal`, `profile-effect-analyst-minimal`, `profile-effect-sci-minimal`; 0 unexpected; 136.21 s |
| `node benchmarks/benchmark-simulation.mjs` | **49/49 pass**, 0 false-ready, 0 submissions, p95 2.8 s; 39.53 s |
| `npm run test:u08-sites` | **10/10 pass**, 60.56 s |
| `node --test --test-concurrency=1 tests/test-profile-coverage.mjs tests/test-role-order.mjs tests/test-packet-quality.mjs tests/test-u14-cost.mjs` | **27/27 pass**, 5.85 s |

Falsification runs (temporary local reverts, each restored immediately):

| Commit | Revert made | Result |
| --- | --- | --- |
| `23645f7` | `const asked = askedAndAnswered(history)` → `const asked = new Set()` | `test-profile-coverage`: **7 pass / 2 fail**; new test fails on `after.uncovered.includes('certifications and licences')`, and the existing "asked and answered covers it" (roles) fails too |
| `829e19c` | packet path `dedupeResume(packet.resume.filter(keepResumeRow))` → `dedupeResume(packet.resume)` | `test-role-order`: **5 pass / 1 fail**; prepare fails with `The packet contains a claim without an exact source reference` |
| `3958509` | removed the self-skip from `trackedText` | `test-u11-safety`: **5 pass / 1 fail**; 11 violations inside `tests/test-u11-safety.mjs` (5 documented public addresses, 2× `<address>`, 2× `<address>`, 2× `<phone>`) |
| `2390743` | removed the `approvedHash !== packetIdentity(job)` guard | `test-u08-sites`: **7 pass / 3 fail**, each `Missing expected rejection: an unapproved packet never goes into a kit` |
| `cc705fb` | restored the pre-fix filter in `plainhand/benchmarks/cases.mjs` | `node benchmarks/benchmark-simulation.mjs --case contact`: **0/3, stop=error**; after restoring the fix: **3/3 pass, stop=review** |

## 1. `23645f7` — interview area counts once asked and answered

**Verdict: accept-with-fixes.**

What it does: adds `askedAndAnswered(history)` to `plainhand/profile-coverage.mjs`, threads
`history` through `profileCoverage`/`canOfferSummary`, and overrides the agent digest's
interview block in `plainhand/agent.mjs` (`withInterview`, line 26; data build line 160;
`tasks.interview` gate lines 193–194).

Correct at the pure-function level. The new test is load-bearing: with
`askedAndAnswered` disabled the new test fails, and the roles-area "asked and answered
covers it" assertion fails as well, so another commit's test now depends on this feature.
The question extraction (last sentence before the last `?`, earlier sentences do not count)
is covered by the negative case. The `asked` patterns are broad but the last-sentence slice
keeps them tied to the actual question.

**Correctness gap — the current answer is never counted in the same turn.** In
`AgentEngine.message` (`plainhand/agent.mjs` lines ~135–139) `history` is read from
`data/plainhand/conversation.jsonl` *before* the current user message is appended. The
current message is passed separately as `message`, but `withInterview`, the
`tasks.interview` gate and `profileCoverage` all receive only `history`. `/api/agent/message`
does not mirror the message into `state.conversation` either. Consequence: after the
assistant asks about certifications and the candidate answers "No", the next call's digest
still lists certifications as uncovered, and the onboarding instruction tells the model to
ask the first uncovered area again. The area clears on the following turn, so the
"every turn" loop is broken, but each "no" still costs one repeated question.

Reproduction (probe outside the repo, `~/.cache/plainhand-eval-tmp/probe-interview.mjs`):
scripted three-turn conversation `hi` → "Do you hold any certifications or licences?" →
`No.` → `Excel.`; the digest passed to the agent was:

```
{"message":"hi","open":["the tools, software and systems they use","certifications and licences"]}
{"message":"No.","open":["the tools, software and systems they use","certifications and licences"]}
{"message":"Excel.","open":["the tools, software and systems they use"]}
```

The middle line is the bug: the answer "No." is in `INPUT.message`, not in the coverage
history.

**Exact fix.**
- In `plainhand/agent.mjs`, build `const coverageHistory = [...history, { role: 'user', text: message }];`
  once in `run` (do not mutate `history`), and pass it to `withInterview`, `canOfferSummary`
  and `profileCoverage` in the `tasks.interview` gate.
- In `askedAndAnswered`, require the *immediately following* message to be the user answer
  (`history[index + 1]?.role === 'user'`) instead of `history.slice(index + 1).some(...)`.
  Today any later user message counts, including one that changes topic; with the current
  message appended, `index + 1` is exactly the answer.
- Add an engine-level regression test in `tests/test-profile-coverage.mjs`: after the
  assistant asks the certifications question and the candidate replies "No.", assert
  `agent.calls.at(-1).digest.profile.interview.uncovered` does not include
  `certifications and licences`. The existing test only exercises the pure function.

## 2. `829e19c` — drop empty resume rows; one line on gap roles

**Verdict: accept.**

What it does: adds `packet.resume`/`draft.resume` filters for empty text in
`plainhand/workflow.mjs`, changes the gap-role sentence in `PACKET_INSTRUCTION`
(`plainhand/agents.mjs`), records the quota-blocked comparison run in `GOAL-HANDOFF.md`, and
extends `tests/test-role-order.mjs` with a wrapping harness.

The workflow half was **superseded** by `a7c69b7` ("heading-only education rows, dedupe
resume lines"), which is an ancestor of the reviewed HEAD: both filters are now
`dedupeResume(...filter(keepResumeRow))`. The surviving rule is stricter than this commit's
blanket "drop empty rows": a blank row is kept only when it is in an education,
certification or licence section and the heading carries org, title and dates; every other
blank row is dropped. The test added here still fails when the surviving filter is removed
(see the falsification table), so the behavior is protected by a test.

The instruction change is present and asserted: `test-role-order` checks
`keep that role with its heading (org, title and dates) and exactly one short line`, and
`test-packet-quality` checks the paired `Experience never has a heading-only entry` rule.
No safety weakening: a dropped row has no text to cite; the kept credential row still goes
through `hasEvidence` and `verifyHeadings`, and the renderer emits no empty bullet
(covered in `tests/test-packet-quality.mjs`).

One record-keeping note, not a defect: the commit message and `GOAL-HANDOFF.md` describe the
blanket drop as the fix, while HEAD actually enforces the narrower credential exception.
The lane record should not be retro-edited, but a reader of this commit alone will expect
the older behavior.

## 3. `3958509` — U11 scanner skips its own test file

**Verdict: accept-with-fixes.**

The skip is necessary for the suite as written: without it, the self-scan flags the five
documented public addresses declared in `ADDRESS_ALLOWLIST` (their file regexes do not
include this file) and the planted strings used by the planting test. The failure lists 11
violations, all inside `tests/test-u11-safety.mjs`; no other tracked file is flagged.

It is still a real weakening of the repo's "no personal data in tracked files" check: the
one file most likely to contain realistic-looking addresses is now never scanned, and a
future real address added there would pass silently. Nothing asserts that the skip is the
only exemption, and the test's global claim "the current tree has no personal data in
tracked files" no longer includes this file.

**Exact fix (restore full coverage without self-flagging):**
- Construct the planted fixtures at runtime instead of as literals, e.g.
  `const plantedEmail = ['jane.doe.real', 'gmail.com'].join('@')` and the phone from its
  digits, so the source text does not itself match `EMAIL`/`PHONE`.
- Add `tests\/test-u11-safety\.mjs` to the `file` regex of the five `ADDRESS_ALLOWLIST`
  entries (`<address>`, `<address>`, `<address>`,
  `<address>`, `<address>`). Those addresses are already allowlisted by exact value and
  documented as public or fictional; allowing the declaration file does not widen the
  address policy.
- Remove `if (file === 'tests/test-u11-safety.mjs') continue;`.
- Keep an assertion that the scan reads the file (e.g. `entries.some(e => e.file === ...)`).

If the owner consciously accepts a one-file blind spot instead, it should be recorded in
`docs/internal/lanes/u11-safety/RESULT.md`; the current inline comment is not a record.

## 4. `2390743` — manual kit requires an approved, fresh packet

**Verdict: accept-with-fixes.**

The guard (`plainhand/manual-kit.mjs` line 14) is correct: `approvedHash === packetIdentity(job)`
binds the kit to the approved context hash, packet, job text and resume hash. It is
load-bearing: removing it makes three U08 tests fail with "Missing expected rejection". The
UI is gated on `job.approvedHash` before `ApplyTab` renders, so the new error is not normally
reachable from the screen; the test's `stage` change (`packet-ready` → `approved`) is just the
new approval step. No safety weakening.

**Correctness gap — the kit copies file bytes without checking the approved hash.** The
guard proves the *metadata* is the approved version, then the kit writes
`await workspace.readBinary(resume)` and `readBinary(cover)` without hashing the bytes. The
browser path checks exactly this for the resume (`plainhand-server.mjs`:
`if (digest(await workspace.readBinary(job.pdf)) !== job.pdfHash) throw ...`). A resume PDF
replaced or regenerated on disk after approval is copied into the kit under the approved
label. `packetIdentity` includes `pdfHash`, so the check is cheap.

**Exact fix.**
- Import `digest` from `./store.mjs` in `plainhand/manual-kit.mjs`.
- For the resume: `const bytes = await workspace.readBinary(resume); if (job.pdfHash && digest(bytes) !== job.pdfHash) throw new Error('The resume file changed after approval. Regenerate and review the packet before making a kit.'); await write('resume.pdf', bytes);`
- The cover-letter PDF has no hash in `packetIdentity` at all. Either add the cover-letter
  artifact hash to the packet identity at render time, or stop claiming the kit carries
  "exactly the version you approved" for unhashed documents. A regression test: prepare,
  approve, overwrite `job.pdf` with other bytes, assert `jobs/manual-kit` rejects.

## 5. `cc705fb` — legacy fixture oracle excludes contact fields from the profile quote

**Verdict: accept.**

The production profile source is built in `plainhand/store.mjs` line 114:
`JSON.stringify(Object.fromEntries(Object.entries(state.profile).filter(([key]) => key !== 'resume' && !PRIVATE_FIELDS.has(key) && !excludedFields.has(key))), null, 2)`.
The oracle now filters `resume` and `PRIVATE_PROFILE_FIELDS` (`['email', 'phone']`). For the
benchmark profiles (no excluded sources) the fixed quote is **byte-identical** to the
production source; the pre-fix quote is not a substring of it. Verified with the same
`suppliedProfile` construction the runner uses (`{ ...emptyProfile(), ...profileData }`):

```
fixed === source: true
old is a source substring: false
old len 426  source len 361
fixed quote is source substring: true (sourceId profile)
```

Without the fix, `benchmark-simulation.mjs --case contact` fails 0/3 with `stop=error` (the
oracle's invalid profile quote fails the packet evidence gate); restored, it passes 3/3. The
full simulation is 49/49 and eval 64/67 at HEAD. This is a benchmark-oracle correction, not a
production behavior change.

Minor, out of scope: the oracle still ignores `contextPrefs.excludedSources`, so it would
diverge if a benchmark profile ever declared exclusions. No current profile does.

## 6. Merge `789dcd5` — U14 fold + blank-row protection + evidence retry

**Verdict: accept-with-fixes.**

Found with `git log --merges --oneline | grep U14`: `789dcd5 Merge U14: trim CLI overhead per
call, evaluate cache, opt-in humanizer fold`, parents `765933f` (packet-quality lane) and
`a18bb98` (U14). The merge resolution is correct on every requested check; no side was
dropped from `plainhand/workflow.mjs`.

| Check | Evidence | Result |
| --- | --- | --- |
| Blank heading-only rows stay blank after humanize, **master** path | Probe: master draft returns a heading-only Education row (empty text, complete heading, heading quote) and a humanizer that replaces every blank item with `Graduated.`. Task completes; `standard.draft.resume` Education row is `text: ""` with `org/title/dates` intact; the humanizer ran once (`humanizerRan: 1`). Code: `blankRows` captured at line 341, restored after the pass at line 347. | **holds** |
| Blank heading-only rows stay blank after humanize, **packet** path | `tests/test-packet-quality.mjs` "a heading-only education row survives, renders without a bullet and passes evidence; Experience still drops": humanizer tries to fill, row stays `''`, Experience blank row dropped, no `<li></li>` rendered. | **holds** |
| `foldInput` reaches the draft call, both paths | `plainhand/workflow.mjs` line 323 (master) and line 391 (packet) spread `...foldInput(folded)`; `tests/test-u14-cost.mjs` asserts `draft.data.humanizeRules === HUMANIZE_INSTRUCTION` for `STANDARD_INSTRUCTION` and `PACKET_INSTRUCTION`. | **holds** |
| Evidence-retry feedback still reaches attempt 2 | Packet: `tests/test-packet-quality.mjs` asserts exactly 2 `PACKET_INSTRUCTION` calls and names the uncited entry plus the repeated letter sentence in `reviewFeedback`; master: `tests/test-standard.mjs` "an uncited master entry is retried once with feedback naming it" asserts 2 drafts and the feedback. Both pass in the 633-test suite. | **holds** |
| Folded mode skips only the HUMANIZE call | `tests/test-u14-cost.mjs` folded master and folded packet: zero `HUMANIZE_INSTRUCTION` calls, `REVIEW_INSTRUCTION` still present and after the draft; the non-folded path still runs the separate pass; `humanizer.folded === true`. | **holds** |

**Fix — the folded rules are passed as data but no instruction references them.** `rg
humanizeRules` finds the key only in `plainhand/workflow.mjs`, the U14 lane record and the
test; `PACKET_INSTRUCTION` and `STANDARD_INSTRUCTION` (`plainhand/agents.mjs` lines 290–291)
never mention it. In folded mode the model receives a 32,663-character instruction string
inside `INPUT` JSON and no sentence telling it to apply that string. The test proves the data
is wired, not that the reply is humanized. The humanizer report's `tellsAfter` exposes the
result but nothing blocks a draft that ignored the rules; `safeRewrite` is already knowingly
lost in this mode (documented in `foldedHumanize` and the lane RESULT).

**Exact fix.**
- Append one sentence to both `PACKET_INSTRUCTION` and `STANDARD_INSTRUCTION`: `When INPUT.humanizeRules is present, apply those rules to every line you write before returning; the reply itself must already read as humanized.` The controlled fixtures dispatch on `instruction.includes('Prepare a')` / `Write the candidate's master resume`, so the constant text contract is unchanged.
- Extend `tests/test-u14-cost.mjs` to assert each drafting instruction names `INPUT.humanizeRules` (not only that the data key is present), and keep the default off until then.
- Coverage gap: nothing tests a heading-only master row; the probe above is the evidence. A permanent test should live beside the packet-path test in `tests/test-packet-quality.mjs` or `tests/test-standard.mjs`.

## 7. Package.json merge resolutions and test-script coverage

**Verdict: accept.**

33 `tests/test-*.mjs` files were added in the last 30 commits. All are run by a script:

- 28 are in `test:plainhand` (ats-check, bench-eval, eval-judge, eval-numeric-grounding,
  evidence-sources, exports, feature-inbox, feature-interview-prep, feature-skill-plan,
  field-policy, frontmatter, memory-checks, memory-probe, memory-transfer, packet-quality,
  pdf-evidence, posting-integrity, profile-coverage, reusable-answers, role-order,
  story-lifecycle, u05-revision, u09-queues, u10-tracking, u11-safety, u12-reachability,
  u14-cost, web-modules).
- 4 are in named scripts: `test-cloud-workspace-transfer.mjs` (`test:cloud`),
  `test-extension-load.mjs` (`test:extension`), `test-u08-sites.mjs` (`test:u08-sites`),
  `test-u12-browser-review.mjs` (`test:u12-browser`).
- 1 is a Playwright spec, not listed literally: `tests/test-cloud-workspace-transfer.spec.mjs`
  is selected by `tests/playwright-workspace-transfer.config.mjs` (`testMatch`) and run by
  `test:workspace-transfer-ui`. This is coverage, not a miss, but it is invisible to a
  filename grep.

Nothing was dropped in the merge: comparing `test:plainhand` between each parent and HEAD,
`in base not head: []`, `in lane not head: []`, `in head not in either parent: []`; counts
66 (base) / 65 (lane) / 67 (HEAD); no duplicates. The merge added the base's `test:u12-browser`
script and kept the lane's `tests/test-u14-cost.mjs`.

Observation outside the 30-commit window (not counted as missing): 10 older test files are
not in any `package.json` script but are run by `test:full` through
`tests/run-test-suite.mjs` (`test-greenhouse-lever-adapters`, `test-workday-ashby-adapters`,
`test-plainhand-brain-ui`, the three `test-feature-*-ui` files, `test-chatgpt-agent.mjs`,
the two `*-live` files, and `test-cloud-onboarding.spec.mjs` through its config). No added
test is orphaned.

## 8. `scripts/u12-reachability.mjs`: `conflicts.list`

**Verdict: accept.**

`conflicts.list` is rendered from `/api/state` memory:
- `plainhand-server.mjs` line 164: `return json(res, 200, { ...state, memory: { conflicts: memory.conflicts, questions: memory.questions }, memoryConflicts: memory.open, ... })`.
- `plainhand/web/ui/profile.mjs` lines 152–175: `const conflicts = store.state.memoryConflicts || [];`, renders the "Facts that disagree" card with both quotes, an excluded-source note, and the `conflicts/record` action (`await api('conflicts/record', ...)`).
- `plainhand/actions.mjs` line 186: the read action returns the same open contradictions for
  the agent/MCP path; the UI deliberately uses the server's local state view so excluded
  source text is not returned to the model.

The `UI_AGGREGATE` annotation says "from /api/state memory"; the card actually reads the
sibling `memoryConflicts` field, which the same payload returns. The surface exists and the
data is the intended one. `tests/test-u12-reachability.mjs` passes.

## Residual observations (not verdict-changing)

- `23645f7`'s `asked` regexes are broad (`manag\w*`, `quality`, `roles? (?:you|do you)`). A
  non-onboarding assistant question that happens to match can mark an area covered. The
  last-sentence slice limits this; the `index + 1` change above limits it further.
- The merge resolution keeps the base's `reviewFeedback: [...evidencePrompt, ...(review?.issues || [])]`
  on both paths; the lane's `review.issues` form would have thrown when `review` was
  undefined on attempt 2. The resolution is the safer side.
- `2390743`-style approval gates elsewhere use `assertPacketFresh` plus `packetIdentity`;
  the kit uses only `packetIdentity`, which already includes `contextHash`, so freshness is
  covered.

## Overall verdict

**Accept-with-fixes.** The five root commits and the U14 merge resolve correctly and every
targeted test fails without its fix; the full suite (633/633), eval benchmark (64/67, only
the three expected minimal rows) and simulation (49/49) pass at HEAD. Before this is called
done:
1. `23645f7`: count the current user answer (and require the immediately following user
   message) in the agent coverage, with an engine-level test.
2. `2390743`: verify the resume bytes against `job.pdfHash` before the kit copies them, and
   resolve the unhashed cover-letter document.
3. `3958509`: remove the one-file scan blind spot by runtime-building the planted fixtures and
   allowlisting the documented addresses for the declaration file.
4. `789dcd5`/U14: make the folded mode's rules a stated instruction contract and test it; keep
   the default off until then.
