# Root review: durable-memory Gate 1

Design: `b9652fc36164901e63cc22fc12b8eefe09b49dbf` (`t3/durable-memory-design`, Pi DeepSeek author).
Reviewer: root, Claude Opus 5.5. Date 2026-11-15.

Verdict: **accepted; decisions below.** Packet order M2 → M1 → M3 → M4 → M5 → M6.
Implementation follows the frozen baseline (UNIFIED-GOAL ordering), except M1 and
M2. Those are correctness/safety defects with direct failing probes
(`output/goal-review/import-key-loss.json`; writing samples able to ground a
claim), not measured quality improvements, so they may land before the freeze.
Each needs its own failing-then-passing test.

## Decisions

1. M1 source files: **include** the four bounded user-layer sources in export and
   import. On import, approvals reset to draft, autonomy arrives disabled, and no
   credential or connector token transfers.
2. M4 reuse scope: **exact normalized label only**. The answer bank stays out of
   `Workspace.context`. The root restart probe (`memory-restart-proof.json`)
   confirmed it is absent today; keep it that way.
3. M5: **deterministic and decision-only**. Semantic contradiction detection is
   deferred to measurement.
4. Per-provider sharing controls stay out of scope.

## Root evidence relevant to this design

`output/goal-review/memory-restart-proof.json`: stored memory, context hash,
answer bank and approved correction are identical across a process restart and a
provider-setting switch. Structural only, no inference.
