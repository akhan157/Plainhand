# Root review: measurement-design Gate 1

Design: `b6c0b562732b45455e4709e5e390fe00d2a4874d` (`t3/evaluation-baseline-design`, Pi DeepSeek author).
Reviewer: root, Claude Opus 5.5 (different family). Date 2026-11-15.

Verdict: **accepted with amendments**. Implementation authorized only on the
goal branch tip that contains the continuation integration commit; the author
re-pins and confirms that SHA before editing.

## Amendments

1. **Scorer must be at least as strict as production.** The goal tree now
   contains the production calibration rule (continuation fix `67a90db` plus root
   correction in the integration commit): a posting number is exempt only when the
   employer starts the clause or an application-intent frame governs it, the
   number sits within three words of the employer reference, and no first-person
   subject or reporting object (`I`, `we`, `to/under/by me|us`) follows it in the
   same clause. The scorer stays an independent implementation (design §4.3), but
   add a cross-check test: for every case in the §4.4 table plus
   `output/goal-review/probe-attribution.mjs` cases, if production exempts a
   number the scorer must not flag it as a *laundering pass*, and if the scorer
   exempts a number production must exempt it too. Any disagreement is listed in
   RESULT, not silently resolved by loosening either side.
2. **Add the root leak case** to §4.4: `The team of 12 reports to me today.`;
   posting has `12`, sources do not → candidate, unsupported.
3. **PDF tier**: accepted as written. `pdftotext` is present on this host
   (`setup-check-02145c8.log`), so the Poppler cross-check is expected to run, not
   be recorded as unavailable, on this machine.
4. **Baseline §8**: accepted as the specification to freeze later. The live paired
   budget (≤ 900 calls) is **not** approved yet. It needs an owner-visible decision
   on which provider pays for it; the scorer implementation lane runs zero live
   calls.
5. Scope stays scorer-only (`plainhand/evaluation/**`, its tests and docs). No
   production calibration edits; those belong to the goal branch root.

## Non-negotiables carried from the design

No threshold weakened, no assertion removed, no magic-byte pass, mutation check
recorded, no self-acceptance, no edits to register/manifest/board/handoff.
