# Assignment: unified goal scope documents

**Role:** scope-document author. Not the product implementer, not the acceptance authority.
**Date:** 2026-11-14.

## Pin

| Item | Value |
| --- | --- |
| Branch | `t3/unified-goal-scope-docs` |
| Expected base | `fb396422d49e3f76f4fed5beb710397950ffa973` |
| HEAD at start | `fb396422d49e3f76f4fed5beb710397950ffa973` (confirmed) |
| Goal branch (root's, not touched) | `goal/plainhand-personal-engine` at the same commit |
| Control-plane thread | `f3b1cc2a-de89-4fc8-9a17-5e96a84d34a6` |
| Author route | Go DeepSeek failed with insufficient balance and returned no verdict; escalated to `claude-pool` / `claude-sonnet-5-5`, effort high |
| Independent reviewer | Root Codex `gpt-6.1-sol` |

## In scope

Create or edit exactly these files and nothing else:

- `docs/internal/UNIFIED-GOAL.md`
- `docs/internal/BRANCH-RECONCILIATION.md`
- `docs/internal/GOAL-COVERAGE-REVIEW.md`
- `ASSIGNMENT.md` (this file)
- `RESULT.md`

## Out of scope

- App source, tests, scripts, configuration.
- Existing historical documents, including the verification matrix.
- Registers, manifest, board, handoff files (root writes those if appropriate).
- User data and `main`.
- Running tests, builds, browsers or live providers.
- Subagents, pushes, main merges, deploys, new paid services, real-account writes.
- Settling, archiving or deleting any older thread.

## Non-negotiables

1. Scope documents supersede conflicting older product assumptions **prospectively**; old evidence and history stay.
2. Acceptance rows U01–U13 start `in_progress` / `not_run`. No PASS anywhere.
3. No invented numerical targets. Thresholds are pre-registered and approved later.
4. Branch test claims are inherited claims, not fresh results.
5. Never submit or send to an employer. Candidate-only decisions stay candidate-only.
6. Preserve thread IDs and SHAs. No host-specific absolute paths. No user data.
7. A stop was required if a material scope choice appeared. None appeared: the outline fixed every choice. Facts that changed how work is described (the two competitor branches are siblings with a five-file overlap; the eval lanes are already in main) are recorded as findings, not decided.

## Evidence the author may rely on

- Documents named in the task (PRODUCT-BUILDOUT-GOAL, AGENT-BUILD-PLAN, NEXT-BUILD-PLAN, V1-GOAL, VISION-GAP, EVALUATION-HARNESS, EVALUATION-JUDGE, VERIFICATION-MATRIX, OPERATING_GUIDE, AGENTS).
- `PRODUCT-DEFINITION.md` read with `git show` from the continuation branch, not checked out.
- Git ancestry, ahead/behind counts, diff stats and worktree status.

## No self-acceptance

The author does not accept, approve or mark any acceptance row, and does not review its own output. Root Codex reads the diff independently. The owner settles older threads after the coverage review.
