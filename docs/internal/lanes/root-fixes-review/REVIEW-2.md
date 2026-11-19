# Root fixes — second independent review

- Reviewer: independent review sub-agent; did not author these commits.
- Branch: `t3/review-plainhand-fixes`
- HEAD reviewed: `90783f050ffccaf4edcfa45fd4ae86f9f2babc73`
- Date: 2026-11-16
- Environment: Node v26.12.1, npm 12.2.2, x64 Linux. `TMPDIR` was set to the
  instructed cache directory. `npm ci --ignore-scripts` installed 162 packages. No
  live or paid model calls. No push, no merge, no product changes kept: every
  temporary revert was restored and `git status --short` was clean before this file
  was written.

## Verdict table

| # | Commit | Subject | Verdict |
| --- | --- | --- | --- |
| 1 | `ccc4153` | Apply independent review fixes to root-authored changes | **accept-with-fixes** |
| 2 | `97d950f` | Typed benchmark accepts heading-only rows | **accept-with-fixes** (test only) |
| 3 | `452f007` | Suggestion guard checks inclusion claims anywhere | **accept** (superseded, do not restore) |
| 4 | `a06242e` | Export/import version fix; narrow the suggestion guard | **accept-with-fixes** |
| 5 | `90783f0` | Register 12/15; remove host paths from the handoff | **accept-with-fixes** |

**Overall: accept-with-fixes.** No commit is a reject and no reproduction shows a
broken safety guarantee at the reviewed HEAD. The product tests and the required
benchmark pass. Four follow-ups remain: one missing regression assertion (U11
self-scan), one false suggestion rewrite in a mixed sentence, one v1-import state
normalization gap, and one overclaim in the acceptance register.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm run test:plainhand` | **671/671 pass**, 0 fail, 32.09 s |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | **64/67**, 3 expected failures only: `profile-effect-fin-minimal`, `profile-effect-analyst-minimal`, `profile-effect-sci-minimal`; 0 unexpected; 100.63 s |
| `node --test tests/test-profile-coverage.mjs` | 11/11 at HEAD; 10 pass / 1 fail with `agent.mjs` temporarily reverted |
| `node --test --test-concurrency=1 --test-name-pattern='unknown careers host' tests/test-u08-sites.mjs` | 1/1 at HEAD; 0/1 with `manual-kit.mjs` temporarily reverted |
| `node --test tests/test-u14-cost.mjs` | 8/8 at HEAD; 7/8 with `agents.mjs` temporarily reverted |
| `node --test tests/test-u11-safety.mjs` | 6/6 at HEAD; 6/6 with the scanner's self-skip temporarily restored |
| `node --test --test-name-pattern='suggestion guard' tests/test-packet-quality.mjs` | passes at HEAD; the 452f007 test fails at `1691356`; the advice test fails with the 452f007 broad guard restored |
| `node --test --test-name-pattern='migrated to the current state version' tests/test-workspace-import.mjs` | passes at HEAD; fails at `a06242e^` with `This export is from an unknown Plainhand version.` |

Falsification and adversarial probes are described in each section. All temporary
reverts were made with `git checkout <rev> -- <file>` and restored with
`git checkout HEAD -- <file>`; the restored hashes matched HEAD and the tree was
clean. After this file was committed and tracked, `node --test
tests/test-u11-safety.mjs` was run once more (6/6) so the scanner covered this
review file; it found no personal data.

## 1. `ccc4153` — review fixes for the root-authored changes

**Verdict: accept-with-fixes.**

What it does:

- Appends the current user message to the coverage history (`spoken`) in
  `plainhand/agent.mjs`, so the answer in the current turn closes an interview area.
- Checks the resume bytes against `job.pdfHash` before the manual kit copies them.
- Removes the U11 scanner's self-skip, builds the planted fixtures at runtime, and
  allows only the five documented addresses inside the declaration file.
- Adds the folded-humanizer instruction sentence to both drafting instructions.
- Redacts the planted personal data quoted in `REVIEW-INPUT.md` and corrects the
  U08 result note about the cover letter hash.

### Interview coverage

Correct. `history` is read before the current message is appended
(`AgentEngine.message`), and `spoken` is passed to `withInterview`, the
`tasks.interview` gate and `profileCoverage`; it is not passed to `data.history`, so
the model sees the previous history and the current message separately, as before.

Falsification: with `plainhand/agent.mjs` reverted to `ccc4153^`,
`node --test tests/test-profile-coverage.mjs` is **10 pass / 1 fail**:

```
✖ engine: the digest for the turn that answers "No." already shows that area closed
  AssertionError: closed on the answering turn, not one turn later
```

The engine test is the load-bearing one; the pure-function test constructs its own
`spoken` history and passes either way. Restored: 11/11.

Residual, not verdict-changing: `askedAndAnswered` still uses
`history.slice(index + 1).some(next => next.role === 'user')`. Any later user
message marks the area answered, not only the immediately following answer. The
append makes the last answer count; an off-topic later message can still close an
earlier question. The tighter rule is `history[index + 1]?.role === 'user'`, with a
test that an unrelated later message does not count. The current fix is correct for
the reported same-turn bug.

### Manual kit resume hash

Correct. `pdfHash` is computed at render time from the same Buffer the kit later
reads (`plainhand/workflow.mjs` line 187: `digest(await workspace.readBinary(...))`),
so the digest comparison is apples to apples. The approval guard still runs first;
the byte check only adds a second gate.

Falsification: with `plainhand/manual-kit.mjs` reverted to `ccc4153^`, the targeted
U08 test is **0 pass / 1 fail**:

```
✖ an unknown careers host cannot block preparation ...
  AssertionError: Missing expected rejection: a tampered resume is refused
```

Restored: 1/1.

Residual, not verdict-changing: the cover-letter PDF is still copied without a
hash check. The U08 result note now says so, which is honest. But the comment at the
top of `plainhand/manual-kit.mjs` still says the kit carries documents “in exactly
the version they approved.” **Exact fix:** change that comment to say the resume is
hash-verified and the cover letter is copied from the prepared artifacts and is not
hash-bound. This is a comment fix, not a behavior change.

### U11 scanner self-scan

The behavior is correct. The scanner now reads its own file; the planted fixtures
are assembled at runtime so the source text does not match the email or phone
patterns; and the declaration-file exemption checks the exact allowed address first,
so a different address in that file is still caught. The full 671-test suite passes
with the file scanned.

The regression test is the problem: **no test fails if the self-skip is restored.**
I re-added `if (file === 'tests/test-u11-safety.mjs') continue;` to `trackedText`
and `node --test tests/test-u11-safety.mjs` was **6/6 pass**. The test has no
assertion that the scan read its own file. This is exactly the “quality blind spot”
the previous review asked to close, and the code change alone does not protect it.

**Exact fix:** after `const entries = await trackedText(REPO);`, assert
`entries.some(entry => entry.file === 'tests/test-u11-safety.mjs')`. Optionally also
assert that a synthetic entry for that path containing a non-allowlisted planted
address is flagged, which proves the exemption is narrow. Restore the temporary
self-skip and confirm the new assertion fails.

### Folded-humanizer instruction

Correct and load-bearing. The sentence is present in both `PACKET_INSTRUCTION` and
`STANDARD_INSTRUCTION`; the controlled fixtures dispatch on the unchanged instruction
prefixes, and the full suite passes.

Falsification: with `plainhand/agents.mjs` reverted to `ccc4153^`,
`node --test tests/test-u14-cost.mjs` is **7 pass / 1 fail**:

```
✖ both drafting instructions say what to do with INPUT.humanizeRules in folded mode
  The input did not match /When INPUT\.humanizeRules is present, apply those rules/
```

Restored: 8/8.

### Record edit

`ccc4153` edits `docs/internal/lanes/root-fixes-review/REVIEW-INPUT.md`, an
independent review record, to replace the planted addresses with placeholders. The
redaction is required by the tracked-file personal-data scanner and the replacement
does not hide a finding, but an author editing the reviewer's record should be
recorded as a process exception. No product or verdict change.

## 2. `97d950f` — typed benchmark accepts heading-only rows

**Verdict: accept-with-fixes (test only).**

The change imports `headingOnlyRow` from `plainhand/workflow.mjs` and skips
`requireText(entry.text, ...)` only when that predicate is true. The predicate
requires a blank text, an education/certification/licence section, and a heading
with org, title and dates; the evidence gate (`hasEvidence`) still runs on every
resume entry. A blank Experience row still fails because the section does not match.
No safety guarantee is weakened; the benchmark validator now matches the product's
own rule.

Probe outside the repo: a fake workflow returned a packet with a heading-only
Education row and an exact source quote.

- At HEAD: `RESULT reviewed entries 1 text ""`.
- With `plainhand/benchmarks/typed-preparation.mjs` reverted to `97d950f^`:
  `THREW resume text must contain 1–10000 characters.`

There is **no repository test** for this behavior. `benchmark-eval` uses a different
runner; `plainhand/benchmarks/runner.mjs` is the caller and its fixtures do not
contain a heading-only row. A future change can undo the exception silently.

**Exact fix:** add a test (for example beside the packet-quality tests) that calls
`typedPreparation` with a fake workflow returning a heading-only Education row and
asserts `reviewed`; assert a blank Experience row still throws. This is a test-only
fix.

## 3. `452f007` — suggestion guard broadened

**Verdict: accept (superseded; do not restore).**

The broad rule fixed the live failure: suggestions such as “The master includes the
Example Bioinstruments role and the Lean Six Sigma Green Belt certification” are now
checked even when the inclusion verb is not at the start. The test added in this
commit fails at its parent:

```
✖ suggestion guard: an inclusion claimed anywhere in the sentence is checked ...
  Actual: 'The master includes the Example Bioinstruments role and ...'
```

But the broad rule rewrites advice and conditionals. With this commit's
`plainhand/workflow.mjs` restored over the current tree, the later advice test fails:

```
✖ suggestion guard leaves advice, questions and conditionals alone
  Actual: ['Left out: Consider AWS. (A note claimed it was included, but it is not ...)']
```

The narrowing in `a06242e` repairs that. No action on this commit; keep the narrow
rule.

## 4. `a06242e` — import version fix and guard narrowing

**Verdict: accept-with-fixes.**

### Guard narrowing

The intended cases now behave correctly. Adversarial probe against the HEAD
`guardSuggestions`, with a resume containing “Fictional Biologics”, “AWS”,
“Terraform”, “Zürich” and “Müller & Sohn”, and a cover letter containing “Lean Six
Sigma Green Belt”:

| Input | Result | Correct? |
| --- | --- | --- |
| `Consider adding AWS if your resume lists it.` | unchanged | yes |
| `You could mention Kubernetes.` | unchanged | yes |
| `Could you confirm whether SQL is listed elsewhere?` | unchanged | yes |
| `If you have Python experience, it appears relevant.` | unchanged | yes |
| `The posting lists Kubernetes; your sources do not show it.` | unchanged | yes |
| `The resume lists AWS and Terraform.` | unchanged | yes, both present |
| `Every role, including Fictional Biologics, is listed.` | unchanged | yes, present |
| `The master includes ... role and ... certification.` | `Left out: ...` (whole item) | yes, both absent |
| `Every role, including Example Bioinstruments, is listed...` | `Left out: Example Bioinstruments.` | yes, absent |
| `Left out the Example Bioinstruments role because ...` | unchanged | yes, an omission |
| `The resume does not include Kubernetes.` | unchanged | yes |

Two real gaps remain.

**Mixed sentence gives a false omission.** With AWS present and Kubernetes absent:

```
The resume includes AWS and Kubernetes.
  → Left out: AWS and Kubernetes.
```

The rewritten note now falsely says AWS is absent. The same happens for the
enumeration form with a present and an absent name. The previous broad implementation
had a `missing` path that returned only the absent names; the narrowing removed it
and routes document-subject claims through the whole-item path. This is a quality
regression: the guard's purpose is to stop a note misdescribing the packet, and the
replacement now misdescribes it in the other direction.

**Exact fix:** in `guardSuggestions`, compute
`const missing = claim.named.filter(word => !haystack.includes(` ${suggestionText(word)} `));`
If `missing.length` is between 1 and `claim.named.length - 1`, return
`Left out: ${missing.join(', ')}.`; if all names are absent, keep the existing
whole-item wording. Add a test with one present and one absent name.

**Conditional and non-English residuals.** `The resume includes Kubernetes if you
have it.` is rewritten to `Left out: Kubernetes if you have it.`; the comment's
example conditionals never match, but this document-subject conditional does. A conditional guard
(`if|unless|whether`) before the claim would avoid it. Separately, the named-word
test uses `^[A-Z0-9]`, which is ASCII-only: `The resume includes Ångström.` is left
unchanged even though the word is absent, while `Zürich` present and `Müller & Sohn`
present are correctly kept. This limitation predates the narrowing; if it is fixed,
use `\p{Lu}`/`\p{N}` with the `u` flag and keep Unicode letters in `suggestionText`.
Both deserve tests, and neither is a reason to restore the broad rule.

### Import version handling

Correct at the validation boundary:

- `validateExport` accepts integer versions 1 through `STATE_VERSION` and refuses a
  newer integer with the “update Plainhand” message. Non-integers, zero and negative
  versions are refused as unknown.
- The import does not overwrite the target's version. A probe importing a version-1
  export into a workspace that had already migrated to state version 2 left
  `version: 2` after the import.
- The new test is load-bearing: with `plainhand/workspace-import.mjs` reverted to
  `a06242e^`, the migrated-export test fails with
  `This export is from an unknown Plainhand version.` Restored: pass.

**Gap: a v1 export is accepted but not normalized to the v2 shape.** A version-1
export can lack `settings`, `claimLine`, `conflictReview` or `inbox` (the earliest
v1 state did not have them; migration 1→2 adds them). The cleaners return
`null`/`undefined` when the object is absent, not the migration defaults:

- `cleanSettings(undefined)` → `null`
- `cleanClaimLine(undefined)` → `null`
- `cleanConflictReview(undefined)` → `null`
- `prepareImport` leaves `inbox` `undefined`

The probe after importing a hand-built v1 export into a migrated v2 workspace:

```
target version after import: 2 (expected 2)
settings: null
claimLine: null
conflictReview: null
inbox present: false
story id: undefined
candidateLine statements: []
```

No current consumer crashed in the probe (`autonomyOf`, `roleOrderOf`,
`candidateLine`, the inbox feature and the agent's settings actions all tolerate
null/absent), so this is a state-shape correctness gap, not a live failure. It still
contradicts the commit comment “the imported keys are cleaned below” and means an
imported v1 workspace is permanently different from the same workspace after a
normal migration; the nulls also travel into a later v2 export.

**Exact fix:** in `prepareImport`, default the absent keys to the migration 1→2
values: `settings` to
`{ autonomy: { ...DEFAULT_AUTONOMY, enabled: false }, roleOrder: DEFAULT_ROLE_ORDER }`,
`claimLine` to `{ decisions: [], statements: [] }`, `conflictReview` to
`{ decisions: [], questionChecks: [] }`, and `inbox` to `[]` (keep autonomy off on
import). Alternatively apply the `MIGRATIONS` steps from `data.version` to
`STATE_VERSION` to the prepared state. Add a test that imports a version-1 export
with no settings/claimLine/conflictReview/inbox, asserts those defaults, and asserts
`(await target.workspace.load()).version === STATE_VERSION`. The existing test only
covers a current-version export and does not assert the target's version.

## 5. `90783f0` — register and handoff corrections

**Verdict: accept-with-fixes.**

What it does:

- Changes U01, U05 and U14 to `in_progress` and appends the corrections.
- Records the live counterexample for U03 and the “re-run of seen rows” caveat for
  U04.
- Replaces the two host paths in `GOAL-HANDOFF.md` with `<scratch worktree>`.
- Updates the product status to “12 of 15 rows accepted (U02-U04, U06-U13, U15).”

Verified:

- `GOAL-HANDOFF.md` has no absolute home-directory path, cache path, host name or
  worktree path after the change. The two replacements are the only host paths the
  commit needed to remove.
- The 12/15 arithmetic is exact: 15 rows minus U01, U05 and U14 = 12 accepted.
- U01, U05 and U14 are `in_progress` and the product status names them as open.
- The U05 withdrawal is supported: a case-insensitive grep of
  `plainhand/vendor/humanizer/SKILL.md` finds none of the formal markers at issue;
  “shall” occurs only inside “Shallow”. The row's own note says the pre-registered
  contrast fails for the formal persona, so `in_progress` is right.
- The U04 note now says the tech-recent and tech-match passes were re-runs of rows
  already seen, and names fin-recent/fin-match plus newer-unrelated-stem as the
  held-out evidence. That is a transparent caveat, not an overclaim.

### Overclaim: U03 stays accepted with an unresolved live counterexample

The appended U03 note says a conversation-built master omitted a stated
certification, that whether `masterCompleteness` listed it as missing was not saved,
and “Kept accepted on the controlled evidence, with this open live check.” The row's
own falsifier is “A source role, result or credential is silently absent.” If
`masterCompleteness` listed the certification as missing, the word “silently” is not
met; if it did not, the falsifier is met. The register does not have the evidence
either way. Accepting the row while recording that open check is an overclaim, and
it is inconsistent with moving U01, U05 and U14 to `in_progress` for live failures.

**Exact fix:** either (a) set U03 to `in_progress` until the saved transcript or a
replay of that input through `masterCompleteness` shows the certification was listed
as missing, or (b) append that evidence and keep `accepted`. If (a), update the
product status to 11/15 and the handoff count; the current 12/15 would then be
wrong.

### Stale register text

U04 still contains the earlier sentences “no root-run paired or held-out evidence
yet, so the row stays not_run” and “blocked: provider-quota” before the later, dated
live evidence that supports `accepted`. A reader who stops at the first sentence sees
a row that is still `not_run`. U13 similarly contains an “Open: … blocked:
provider-quota” passage followed by the later resolution (“Set 2 ran live and is now
seen”; “External check 1 … does not block this row”). The statuses are defensible
after reading the whole note; the internal contradiction is not.

**Exact fix:** mark the earlier sentences as historical (“at that point, …”) or
remove them; keep the latest dated evidence and the final disposition adjacent.
This is documentation hygiene, not a status change.

### Handoff wording

The handoff says “Import now accepts any version this code can migrate from.” The
validator accepts versions 1 through 2, but the v1 import does not apply the
migration defaults (section 4). After that import fix, the sentence is accurate;
before it, say “accepts versions 1 through 2; v1 state is cleaned but not migrated
to the v2 defaults” or similar. This is part of the same import fix, not a separate
product change.

## Residual observations (not verdict-changing)

- `askedAndAnswered` still accepts any later user message as the answer. The
  immediate-answer rule (`history[index + 1]?.role === 'user'`) and a negative test
  would tighten it.
- The manual kit copies the cover-letter PDF without a content hash. The U08 result
  note now says so; the code comment should match.
- The U11 scanner test proves the current tree has no personal data and that planted
  data is caught, but does not prove the scanner reads the test file itself.
- The typed-preparation relaxation has no test; it is a benchmark-side validator, so
  the risk is limited to benchmark evidence.
- The import test added by `a06242e` covers a current-version export only. It does
  not cover a v1 export and does not assert the target's version. Both are cheap to
  add.
- The suggestion guard still misses some false inclusion forms that are not at the
  start of a sentence (“Also, the master includes …”, “Your resume includes …”,
  “The resume has …”). This is the deliberate trade-off of the narrowing; the
  reported live form is covered. Do not restore the broad rule to catch them.

## Overall verdict

**Accept-with-fixes.** The five reviewed changes are directionally correct and the
required suite and benchmark pass at HEAD (`671/671`; `64/67`, only the three
expected minimal rows, 0 unexpected). Before this is called done:

1. `ccc4153`: assert that the U11 scan reads its own file; correct the manual-kit
   comment about the unhashed cover letter. Optionally tighten `askedAndAnswered` to
   the immediately following user message.
2. `97d950f`: add the heading-only typed-preparation test and the blank-Experience
   negative case.
3. `a06242e`: fix the mixed-sentence guard to name only the absent items; normalize
   a v1 import to the migration defaults and test it, including the target version;
   add the conditional and non-English guard cases (optional but recommended).
4. `90783f0`: resolve U03 before keeping it accepted (or move it to `in_progress`
   and correct the count); mark the stale U04/U13 “not_run/blocked” sentences as
   historical; align the handoff's import wording with the actual v1 behavior.

No push, no merge, no live or paid model calls. This file is the only change in the
commit that follows.
