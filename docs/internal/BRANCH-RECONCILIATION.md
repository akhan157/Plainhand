# Branch and thread reconciliation

**Status:** recovery record, proposed. Not accepted. Written 2026-11-14.
**Verified at:** `main` = `origin/main` = `fb396422d49e3f76f4fed5beb710397950ffa973`. `origin/main` is the local remote-tracking ref; no `git fetch` was run, so remote state may be newer. Goal branch `goal/plainhand-personal-engine` points at the same commit, so it has no work of its own yet.
**Companions:** [UNIFIED-GOAL.md](UNIFIED-GOAL.md), [GOAL-COVERAGE-REVIEW.md](GOAL-COVERAGE-REVIEW.md).

Method: `git rev-parse`, `git merge-base --is-ancestor`, `git rev-list --left-right --count`, `git diff --shortstat` and `git status`. No source files were read beyond the documents named in the scope, and nothing was built or run. Test claims from other branches are **inherited claims**, not fresh results.

## Branches

"Ahead" counts commits on the branch that are not on `main`. "Main ahead" counts commits on `main` that are not on the branch.

| Branch | Full SHA | Reachable from main | Ahead / main ahead | Worktree state | Local or unmerged | Needed action |
| --- | --- | --- | --- | --- | --- | --- |
| `main`, `origin/main` | `fb396422d49e3f76f4fed5beb710397950ffa973` | n/a | 0 / 0 | clean | Reference | None. Do not merge to it from this work |
| `goal/plainhand-personal-engine` | `fb396422d49e3f76f4fed5beb710397950ffa973` | yes (same commit) | 0 / 0 | clean | New goal branch, no commits | Receives the integrated scope documents (root) |
| `integrate/main-2026-11-11` | `fb396422d49e3f76f4fed5beb710397950ffa973` | yes (same commit) | 0 / 0 | clean | Integration branch already at main | None. Safe to leave as history |
| `t3/app-benchmark-testing-harness` | `e351344fe8ad614ca8291374843db15f937e11d0` | yes | 0 / 16 | clean | Merged. `9a638a4` (`9a638a4e082cb4455b04353527b353d8bc996730`) merged it, and evaluation fixes followed through `fb39642` | None. Do not re-merge |
| `t3/eval-harness-lane1-corpus` | `c7cd29c22231911d983326798fdb311231726051` | yes | 0 / 27 | clean | Reachable from main. Verified by ancestry check, not merged again | None. Stale; do not merge |
| `t3/eval-harness-lane2-upgrade` | `2bb6f689ce256346df2425f26bfd25620db38210` | yes | 0 / 23 | clean | Reachable from main. Verified by ancestry check | None. Stale; do not merge |
| `port/ai-job-search` | `439b1934b251fc47faf035db15a174132a705efa` | yes | 0 / 22 | not checked out in a worktree | Reachable from main; `b449967` is recorded as its PR #6 merge. `origin/port/ai-job-search` is at `7132d625b296fb31218dac0c9e9fca580cc9253d` (also reachable, 23 commits behind main), one commit behind the local branch | None. Source of the adjacent features to inventory (U12) |
| `t3/competitor-workflow-improvements` | `867c32956a38788a3099b045b19be450fcd16a86` | **no** | 1 / 0 | clean | Unmerged. Stage board, people roll-up, ICS calendar, CSV exports. `867c329`: 11 files, +515 / -11 | See "Unmerged competitor work" |
| `t3/competitor-workflow-improvements-1` | `a46056fdc53a4159f5b30eae9b3de578efb3767d` | **no** | 14 / 0 | clean | Unmerged continuation of the redesign. 94 files, +2947 / -1901 against main | See "Unmerged competitor work" |
| `origin/release/1.1` | `7c60871e5dafbcf258194326ff47ca73613434f4` | yes | 0 / 88 | no worktree | Reachable from main | None |
| `origin/security/codeql-fixes` | `22e93d703d9ac26c9d99b5c92d1b1eaa07c49d7b` | yes | 0 / 35 | no worktree | Reachable from main | None. Checked because an unmerged security branch would matter |
| `origin/dependabot/npm_and_yarn/hono-4.13.18` | `d1d3e94c28a7427a2fe5d62660b36f39ffcc3334` | **no** | 1 / 0 | no worktree | Unmerged dependency bump, not examined beyond ancestry | Owner or root decides whether to take it |
| `origin/dependabot/npm_and_yarn/hono/node-server-2.1.8` | `cbf7552f059932018cee410d77d337de31a60481` | **no** | 1 / 0 | no worktree | Unmerged dependency bump, not examined beyond ancestry | Owner or root decides whether to take it |
| `t3/unified-goal-scope-docs` | `fb396422d49e3f76f4fed5beb710397950ffa973` before this commit | yes before the commit | this packet adds one docs commit | the author's worktree | The scope-document branch | Root reads the diff and integrates |

Worktree dirty status was clean for every worktree at check time: the main checkout, `integrate-main`, and one worktree each for the five `t3/*` branches above.

The ancestry check for the lane branches matches the instruction to verify reachability rather than merge: both `c7cd29c` and `2bb6f68` are already contained in `main`.

## Unmerged competitor work

Two findings change how to treat these branches.

1. **They are siblings, not a stack.** Both branch from `main` at `fb39642`. `867c329` is **not** an ancestor of `a46056f`. Neither contains the other.
2. **They overlap in five files:** `CHANGELOG.md`, `package.json`, `plainhand-server.mjs`, `plainhand/web/ui/core.mjs` and `tests/test-plainhand-ui.mjs`. One is not a fast-forward after the other. A read-only `git merge-tree --write-tree` of the two tips auto-merged four of the five files and reported **one content conflict, in `package.json`**. Auto-merged text is not proof the merged code works; tests must be re-run (P3).

`t3/competitor-workflow-improvements` (`867c329`) holds one commit: tracking exports and views. It has a unit test (`tests/test-exports.mjs`) and a UI test change. Its test result is an inherited claim.

`t3/competitor-workflow-improvements-1` (`a46056f`), 14 commits, newest first:

| Commit | Full SHA | Subject |
| --- | --- | --- |
| `a46056f` | `a46056fdc53a4159f5b30eae9b3de578efb3767d` | Show the manual kit when filling fails; match board postings in the extension |
| `942d80c` | `942d80c3079dcb46e87155aa59cd56513b43b004` | Manual apply kit for sites Plainhand cannot fill |
| `aeb962a` | `aeb962a6d1ef3da0985244c63504a26679d6ea45` | Replace the standard resume with a master resume |
| `cc029a6` | `cc029a6b9de7e03ce30a0da259a0ddcaee605e89` | Retarget translated mode examples to finance, tech and STEM |
| `cd3c10d` | `cd3c10dff299854ed282e28cbb7a7e368330caae` | Retarget the app and benchmark to finance, tech and STEM professionals |
| `4bd48e6` | `4bd48e65c1285bcd8794e55a4e018337a7cb9039` | Judge tailoring on the whole resume when a fact spans bullets |
| `9798839` | `979883987eba4b18938a869cf035c7df0645a317` | Choose and order each application's resume for the job |
| `edd1f02` | `edd1f021ba8b5dec62faa3726e47576d84cc276e` | Classify CLI exits by real cause; fill form answers the sources settle |
| `58c81e8` | `58c81e85dbb8520a3ce77ae74d8de5c860c2a5ba` | Let a sentence about the employer repeat the posting's numbers |
| `e4e69cb` | `e4e69cbb0df4aa55f0a1c89e8c24d95e8c8d5136` | Make the translated modes field-neutral |
| `3d1123c` | `3d1123cef668e2db3b8ea420390a7c0682aa25bd` | Remove the engineering and AI lean from command-line tools and templates |
| `0be9512` | `0be9512bfef1404ee651dee16f8c4b471e51f4e5` | Add hospital and trade application forms; widen the never-answer policy |
| `3509300` | `3509300e39df61aacd1ac8af251a37675a66e5e7` | Make the benchmark field-neutral |
| `ad4afc6` | `ad4afc6d37c82eddab263525bab0751613f3b2b1` | Make the app's prompts, demo and modes field-neutral |

Observations from names and a text search only (source was not reviewed):

- The branch carries the decisions that U03, U04 and U08 depend on: master resume, per-job selection and order, manual kit.
- Commit `0be9512` added hospital and trade forms, which the later audience decision (`cd3c10d`) excludes from examples and personas. A search of `plainhand/evaluation`, `tests` and `benchmarks` on the branch tip finds no nurse, hospital or plumber content. The corpus after `cd3c10d` therefore looks clean, but that is a text search, not a review.
- The branch has **no live validation of master resume or tailoring**. Its final reporter test claims are inherited.
- `docs/internal/PRODUCT-DEFINITION.md` exists only on this branch. Until the branch is integrated, the audience decision lives outside main and is carried here by [UNIFIED-GOAL.md](UNIFIED-GOAL.md).

**Needed action (proposed, for root or owner):** do not merge either to `main`. Decide an integration order into the goal branch only, resolve the five-file overlap, then re-run the tests and tailoring evidence fresh on the merged result. The decision is packet P3 in the unified goal.

## Threads

Thread links use `t3-thread://v2/a2d80697-a3a1-473d-905b-2474769cce1b/<thread-id>`.

| Thread | Link | Ended at | Resume point | Disposition |
| --- | --- | --- | --- | --- |
| Redesign `5746e18f-7928-43da-b67e-839f5a87bd3d` | `t3-thread://v2/a2d80697-a3a1-473d-905b-2474769cce1b/5746e18f-7928-43da-b67e-839f5a87bd3d` | Model and quota cooling; stopped before finishing | Inferred, not verified: its product work reached the continuation, which holds the completed commits. Check the thread transcript before relying on this | Owner settles after the coverage review |
| Continuation `e12f1575-914f-49cc-8a81-efa1e561273f` | `t3-thread://v2/a2d80697-a3a1-473d-905b-2474769cce1b/e12f1575-914f-49cc-8a81-efa1e561273f` | Completed locally at `a46056f` | Branch `t3/competitor-workflow-improvements-1`. Not merged to main; no remote-tracking ref for it exists locally, so it appears unpushed (no fetch was run). Resume at P3 integration and fresh validation of master and tailoring | Owner settles after review |
| Benchmark `9104279e-b54d-4841-a9ae-7ebf21cb192a` | `t3-thread://v2/a2d80697-a3a1-473d-905b-2474769cce1b/9104279e-b54d-4841-a9ae-7ebf21cb192a` | `e351344`, since merged to main | A proposed live baseline plus judge was **not executed**. Resume at P4 (frozen design), then P6 | Owner settles after review |
| Control plane `f3b1cc2a-de89-4fc8-9a17-5e96a84d34a6` | `t3-thread://v2/a2d80697-a3a1-473d-905b-2474769cce1b/f3b1cc2a-de89-4fc8-9a17-5e96a84d34a6` | Active | Owns the persistent goal and accepts or rejects this scope | n/a |

Nothing here settles, archives or deletes a thread.

## Missing evidence

1. **No fresh test run** on any branch in this task. All pass counts for the competitor branches are inherited; the main-branch harness figures are from `EVALUATION-HARNESS.md` and the matrix, not re-run.
2. **No live validation of master resume or per-job tailoring** on the continuation branch.
3. **No live baseline or judge run** for the benchmark thread, and no human ratings for calibration.
4. **Only a text-level merge dry-run** of the two competitor branches (one `package.json` conflict). No build or test of a merged result.
5. **No onboarded real-candidate data.** The owner brief says the main working checkout lacks `cv.md`, `config/profile.yml` and `portals.yml`; the author did not run `doctor` to confirm.
6. **No review of `PRODUCT-BUILDOUT-GOAL` and VERIFICATION-MATRIX claims against current code.** They are to be reconciled in P2.
7. `port/ai-job-search` has no worktree; its state was read through refs only.
