# Result: unified goal scope documents

**Status:** delivered for independent review. Not accepted. The author does not self-approve.
**Branch:** `t3/unified-goal-scope-docs`. **Base:** `fb396422d49e3f76f4fed5beb710397950ffa973` (HEAD confirmed equal at start).

## Files

| File | Contents |
| --- | --- |
| `docs/internal/UNIFIED-GOAL.md` | Outcome, scope and decisions, acceptance table U01–U13 (all `in_progress` / `not_run`, with evidence and falsifier), evaluation acceptance, ordered packets P1–P9 with gates, external checks, safety and authority |
| `docs/internal/BRANCH-RECONCILIATION.md` | Branch table with full SHAs, reachability, worktree state, needed action; the 14 continuation commits; thread resume points; missing evidence |
| `docs/internal/GOAL-COVERAGE-REVIEW.md` | Map from owner needs and recovered decisions to acceptance IDs, missing evidence and proposed disposition; failed Go attempt and author route; list of superseded assumptions |
| `ASSIGNMENT.md` | Pin, in and out of scope, nonnegotiables, evidence, no-self-acceptance |
| `RESULT.md` | This file |

## Checks run (read-only git and file reads)

- `pwd`, branch and HEAD confirmed before any edit.
- `git rev-parse`, `git merge-base --is-ancestor`, `git rev-list --left-right --count` for every branch and SHA named in the task.
- `git diff --shortstat` and file-overlap comparison for the two competitor branches.
- `git status --short` in every worktree: all clean at check time.
- `git show` of `PRODUCT-DEFINITION.md` and the continuation's changelog from the continuation branch, not checked out.
- `git grep` for nurse, hospital and plumber terms in the evaluation corpus, tests and benchmarks on `main` and on the continuation tip: no hits.
- Read: AGENTS.md, OPERATING_GUIDE.md, PRODUCT-BUILDOUT-GOAL, AGENT-BUILD-PLAN, NEXT-BUILD-PLAN, V1-GOAL, VISION-GAP, EVALUATION-HARNESS, EVALUATION-JUDGE, VERIFICATION-MATRIX, and the owner's model-routing note (for the reporting format).

## Findings the reviewer should confirm

1. The eval lanes `c7cd29c` and `2bb6f68` and the testing branch `e351344` are all reachable from `main`. They need no merge.
2. `t3/competitor-workflow-improvements` (1 commit) and `-1` (14 commits) are **siblings** from `fb39642`, not a stack. They overlap in `CHANGELOG.md`, `package.json`, `plainhand-server.mjs`, `plainhand/web/ui/core.mjs` and `tests/test-plainhand-ui.mjs`. The task text called `-1` a continuation; the thread is a continuation, the branches are not stacked.
3. The goal branch `goal/plainhand-personal-engine` equals `main`.
4. The audience decision file exists only on the continuation branch.

## Not done

- No product tests, builds, browsers or live providers.
- No fresh verification of any inherited test claim.
- No merge dry-run for the overlapping files.
- No source review beyond a text search; no review of whether main's corpus is field-neutral beyond that search.
- No change to app source, historical docs, registers, manifest, board, handoff, user data or `main`.
- No push, no merge to main, no deploy, no subagent.
- No thread was settled, archived or deleted.
- No acceptance row was marked PASS, and no threshold was invented.

## Risks

- Acceptance falsifiers and evidence lists are the author's proposal. The reviewer should check that each can fail.
- The U13 row sits after U12 to keep U01–U12 as product rows. Root may renumber.
- Counts of "ahead / main ahead" reflect the state at 2026-11-14 and change if `main` moves.
- Packet order P1–P9 is a proposal; P3's merge decision belongs to root or the owner.
- Date follows the product-definition decision (2026-11-14); the session context also showed 2026-11-13.
