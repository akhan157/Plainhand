# Root Gate 1 disposition — 2026-11-15

Design author: Claude Sonnet 5.5 high; reviewer: root Codex gpt-6.1-sol medium. Reviewed design `2618065711b61d0dfcb518204bae81dc3ea594be`, source tracking tip `867c32956a38788a3099b045b19be450fcd16a86`, base `e4da45fa2d21ce1f5945ce11662a73afda03b53f`.

**Approved with amendments for implementation only. No product acceptance.**

- Integrate tracking only, never continuation. Local and hosted authenticated downloads, CR normalization in CSV and ICS, read-only legacy section and coherent search, Applied confirmation checks, real Chromium light/dark/mobile are in scope.
- Skip the optional DOWNLOADS dispatcher and its metadata tests. Two explicit routes using existing helpers are enough; no unrelated server refactor.
- Preserve the original formula guard for tab-prefixed nonformula cells as well as stricter whitespace-prefixed formulas. The proposed whitespace+formula regex alone is not a strict superset of the original guard. Test both properties.
- Do not add source-text import-allowlist tests: they mirror implementation and miss runtime effects. Verify read-only exports with state/revision/usage/audit comparisons and code review.
- Local and hosted downloads use shared pure generators. Authenticated HTTP tests plus real Chromium on shared UI are the focused evidence; label the browser scope local. A separate hosted-browser claim stays open.
- Root has already started an isolated loopback Postgres test container from a cached image. Reuse the explicit test-only URL passed in the implementation message; do not inspect, restart or stop other containers or services. Root owns cleanup. Creating a gitignored dependency symlink is approved. No downloads or package installs.
- Fixed host-specific paths in the assignment; records use repo-relative references and SHAs.

Independent root probes: original export unit tests 8/8 pass, but a bare-CR cell emits a raw record boundary. Shared UI exposes cloud buttons while hosted GET handler has no routes. Legacy Board omits rows it counts in its subtitle. No fresh product pass is inferred from the 8 tests.

## Author route recovery

Claude Sonnet implementation run failed on its provider rate limit after merging tracking at `99ebf25` and leaving partial `exports.mjs` and new `web/ui/tracker-rows.mjs` edits. Root inspected HEAD/status/diff; do not re-merge or discard them. Go DeepSeek was already unavailable (insufficient balance). Per configured routing, implementation resumes on the same lane with Pi `deepseek/deepseek-flash`, catalog label DeepSeek V4.1 Flash, thinking max, using the existing metered fallback. New-provider author must read this assignment and partial state before continuing. Root Codex remains the independent cross-family reviewer. Failed Claude run produced no acceptance verdict.

## Root independent implementation review — 2026-11-15

Author implementation `e538b6aafbd8a260958086b160de7129983a241d` reviewed by root Codex (different family from DeepSeek author). Production routes/shared row rules/CSV escaping/board behavior and regression assertions inspected separately. One additional finding: calendar UID interpolated imported job/interview IDs without escaping, allowing CR/LF property injection even after the text-field fix. Root amended UID to use the same text escaping and added an imported-ID regression. Focused exports run: `node --test --test-concurrency=2 tests/test-exports.mjs`, 13 pass, 0 fail. Memory 4.9Gi available. This is a reviewer correction, not author self-acceptance; merged-tree cloud/browser verification remains required before acceptance. Calendar invalid dates and Unicode formula lookalikes remain out of scope as stated at Gate 1. Author RESULT.md is retained as reported evidence, including its machine-specific artifact locations; future records use portable paths.
