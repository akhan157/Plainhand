# Root review: measurement-design Gate 1

Design: `b6c0b562732b45455e4709e5e390fe00d2a4874d` (`t3/evaluation-baseline-design`, Pi DeepSeek author).
Reviewer: root, Claude Opus 5.5 (different family). Date 2026-11-15. Read in full:
§0–§8.8 (decision summary, attribution, case table, headings, PDF design, controls,
artifact map, baseline manifest, judge identity, repeats, budgets, thresholds).

Verdict: **accepted with amendments**. Implementation is authorized only on the
goal-branch SHA named in the dispatch, which contains this review, the design, and
the continuation integration. The author confirms that SHA before editing.

## Amendments

1. **One-directional binding to production.** The goal tree's production
   calibration (`plainhand/claim-calibration.mjs`, `employerAttributed`) is a
   separate, deliberately stricter rule. The scorer stays its own implementation
   (§4.3). Binding: **any number the scorer exempts as an employer fact must also be
   exempt in production, except for the named exceptions below.** Production may
   flag more than the scorer. Add a cross-check test that runs every §4.4 row plus
   the cases below through both and asserts this. List any further disagreement in
   RESULT; do not loosen either side to resolve it.
   - Known exception, accepted: `I built reports for your 28-country team.` The
     design's attachment rule exempts it. Production flags it, because the clause
     starts with a candidate subject and an accomplishment verb. The scorer may
     exempt it. Record the divergence.
2. **Add these rows to §4.4.** Posting contains every number; candidate sources contain none:

   | Text | Production today | Scorer expected |
   |---|---|---|
   | `Your company operates in 28 countries.` | exempt | employer, supported |
   | `I led teams in 28 countries at your company.` | flagged | candidate, unsupported |
   | `At your company, I led 28 teams.` | flagged | candidate, unsupported |
   | `Your 25 engineers would gain from my reporting.` | exempt | employer, supported |
   | `I am excited to join your 25 engineers.` | exempt | employer, supported |
   | `Excited to have led your 25 engineers before.` | flagged | candidate, unsupported |
   | `Led your 25 engineers.` | flagged | implicit, unsupported |
   | `Your company operates in 28 countries and I managed 28 of its offices.` | flagged (second 28) | second mention candidate |
   | `The team of 12 reports to me today.` | flagged | ambiguous, unsupported, uncertain |
   | `I would love to support your 12-person team.` | exempt | employer, supported |
   | `Your 25 engineers, whom I managed, shipped weekly.` | **exempt (known production residual)** | candidate (`I`), unsupported; consistent with the binding, since only the scorer flags it |
   | `The team of 12 is my current team.` | **exempt (known production residual)** | ambiguous (bare `the team`), unsupported, uncertain |

   The last two rows are production leaks the root found and did not close. The
   scorer must catch them so a benchmark run cannot pass through them.
3. **PDF tier**: accepted as written. `pdftotext` is present on this host, so the
   Poppler cross-check is expected to run here, not be recorded as unavailable.
4. **Baseline §8**: accepted as the specification to freeze later, including the
   held-out fixtures, which root or a separate author writes after the scorer
   freezes. Borderline-decision fixtures (§8.2 D) are in scope for the baseline but
   not for the scorer lane. The live paired budget (≤ 900 calls) is **not
   approved**: which provider pays is the owner's decision. The scorer lane runs zero
   live calls.
5. Scope: `plainhand/evaluation/**`, `benchmarks/**` scorer wiring, their tests, and
   lane docs. No production calibration edits; those belong to the goal-branch root.

## Non-negotiables carried from the design

No threshold weakened, no assertion removed, no magic-byte pass, mutation check
recorded, controls observed failing before the fix, no self-acceptance, no edits to
the register, manifest, board or handoff.

## Update after independent review of the root correction

Production now flags `Your 25 engineers, whom I managed, shipped weekly.` and
`The team of 12 is my current team.` (no longer residuals), and exempts the
interest/intent sentences (`... appeals to me.`, `... the team I want to lead.`,
`(i.e. three squads)`). Remaining production leak: appositive
`Your 25 engineers, a team I built from scratch, ship weekly.`. The scorer should
flag it. The one-directional binding is unchanged.
