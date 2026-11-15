# Lane result: measurement scorer (numeric grounding + rendered-PDF evidence)

Status: **implemented, awaiting root review. Not self-accepted.** The author is the
implementation lane, not the reviewer. Nothing here is a product acceptance, a
register disposition or a baseline claim.

| Item | Value |
|---|---|
| Lane branch | `t3/measurement-scorer-pdf-evidence` |
| Confirmed base HEAD at start | `31d7ba1bb80443a177312173db68413326661849` (`goal/plainhand-personal-engine`) |
| Design | `docs/internal/lanes/measurement-design/ASSIGNMENT.md` §4, §5, §6 |
| Review amendments | `docs/internal/lanes/measurement-design/REVIEW.md` (overrides the design where they differ) |
| Implementation commit | `baafaaf490a927e39872338304e6d423239036f5` |
| Lane record commit | the commit that adds this file (see `git log`) |
| Working tree at start | clean (`git status --porcelain=v1` empty) |
| Live model calls | 0 |
| Push / merge / deploy | none |

## 1. What changed

| File | Change |
|---|---|
| `plainhand/evaluation/score.mjs` | `numericGrounding()`: per-mention owner attribution, separate candidate/posting token sets, visible headline/heading units. `scorePacket` reports `numberChecks`, `numericPostingOnly`, `numericUncertainty`, `pdfState`, `pdfPageCount`, `pdfTextSha256`, `pdfAtsParseTier`, `pdfEvidence`; `pdfValid` now uses `pdfEvidencePassed`. `aggregate`/`markdownReport` report the new counts. |
| `plainhand/evaluation/pdf-evidence.mjs` (new) | `pdfEvidence(bytes, { packet, profile, job, sources, coverBytes, extractor })`, `pdfEvidencePassed`, `pdfEvidenceSummary`. pdfjs text-layer + geometry parse, line grouping, coverage/order/layout/garbled/contact/ATS/cover checks, optional Poppler cross-check, `state` of `passed`/`issues`/`unavailable`/`error`. |
| `plainhand/evaluation/claims.mjs` | Exports the existing `headingText` so the scorer and judge read the same heading surface. No judge prompt change. |
| `plainhand/evaluation/runner.mjs` | Extracts PDF evidence from the bytes the run produced (resume + cover), passes it to `scorePacket`, writes `<id>.pdf-evidence.json` into the evidence directory. |
| `tests/test-eval-numeric-grounding.mjs` (new) | 40 tests: every §4.4 row, every REVIEW §2 row, §5 heading/headline cases, reporting shape, existing number-rule regressions, and the one-directional cross-check against production `claim-calibration.mjs`. |
| `tests/test-pdf-evidence.mjs` (new) | 12 tests: injected-extractor controls (missing line, reordered line, interleaved columns, garbled glyphs, missing contact, missing cover sentence, missing cover PDF, extractor throw/unavailable/empty text layer, magic bytes), the packet pass rule, and one real Chromium render with a real pdfjs parse and Poppler cross-check. |
| `tests/test-bench-eval.mjs` | Packet fixtures use structured evidence; new magic-byte/evidence-state negative control. No existing assertion removed or loosened. |
| `package.json` | Adds the two new test files to `test:plainhand`. |

Not touched: `plainhand/claim-calibration.mjs`, `store.mjs`, `answer-bank.mjs`,
`corrections.mjs`, `agents.mjs`, any product UI/server source, register,
manifest, board, `GOAL-HANDOFF.md`, `EVIDENCE.json`, `docs/internal/GOAL-ACCEPTANCE.json`,
any `REVIEW.md`. No baseline §8 fixtures, borderline fixtures or live runs.

## 2. Numeric grounding (§4, §5) — behaviour

- `candidateTokens` come only from the candidate sources (existing phone,
  percent-word and thousands rules kept). `postingTokens` come only from
  `jobSource(job)`. The posting is never concatenated with candidate sources.
- Each visible unit — headline, distinct headings (candidate always), resume
  sentences, answer sentences (question excluded), cover-letter claims — yields
  one check per number mention. Number words are mentions too (`six` → `6`).
- Owner cues: candidate pronouns; `you/your/yours`; `the role/position/posting/job`
  only in answer/cover text and only with a requirement predicate. In a resume the
  role phrase is the candidate's own role. A verb-initial bullet with no cue is
  `implicit`; a bare definite description is `ambiguous` (uncertain when
  posting-only).
- Employer licensing: employer-initial clause, employer predicate before the
  number, application-intent frame, or compound/possessive/`of` scope attached to
  the employer noun — denied when a candidate verb takes that noun as its object
  (`led your 25 engineers`) or a first-person subject follows the number in the
  same clause (`whom I managed`).
- `unsupportedNumbers` stays the unique canonical tokens with at least one
  unsupported mention. The packet passes only when every mention is supported and
  `numericUncertainty` is empty. `coverage >= 0.66` and every other pass term are
  unchanged.
- Headline/heading numbers are checked; a heading repeated across entries is
  checked once (same de-duplication as `extractClaims`).

### Cross-check against production (REVIEW amendment 1)

`tests/test-eval-numeric-grounding.mjs` runs every row through the scorer and
`claimSignals()` from the unmodified production `plainhand/claim-calibration.mjs`.
The direction is one-way: a number the scorer exempts as an employer fact must also
be exempt in production. Result: the only divergence in the row set is the named
exception `I built reports for your 28-country team.` (scorer exempts by compound
attachment; production flags). The test asserts that this is *exactly* the observed
divergence set, so a new divergence fails the test. Production flags more than the
scorer on several candidate-owned rows (`I led teams in 28 countries at your
company.`, `The team of 12 reports to me today.`, ...), which is allowed.

Because production reports one signal per numeric value, the cross-check compares
per (text, canonical value) and only treats a value as "scorer-exempt" when every
scorer mention of it in that unit is employer-supported. Row
`Your company operates in 28 countries and I managed 28 of its offices.` is
therefore compared correctly: the scorer flags the second mention, production flags
the value, no false violation.

## 3. Rendered-PDF evidence (§6) — behaviour

- `pdfValid = pdfEvidencePassed(pdf.evidence)`: `state === 'passed'` and every
  required check (`parse`, `text-layer`, `garbled`, `contact`, `resume-coverage`,
  `reading-order`, `layout`, `ats`) present with status `pass`; a required cover
  PDF must pass. `bytes`, `sha`, `head` remain provenance only; `head` is not
  evidence.
- Parse: pinned `pdfjs-dist` (6.5.438 here) with the same Node fake-worker pattern
  as `plainhand/cloud/resume-import.mjs`; page text items are grouped into lines by
  page/vertical position and sorted page → descending y → x.
- Coverage: every visible resume line except the headline (see §5 deviations) is
  matched as an ordered content-token sequence at ≥ 0.90, allowing wraps; lines
  with fewer than three content tokens must appear as a normalized substring.
  Reordering is gated within a section (the renderer groups sections by format).
  Interleaved columns are detected from the longest contiguous token run per line.
- Reading order: first-six-word probes must be found (≥ 0.70, same probe shape as
  `checkResumeText`). The engine's ascending ratio is recorded as a diagnostic
  because the renderer's section order is not the packet order (§5 deviations).
- Layout: page count, items outside the page box by > 2 pt, overlapping line boxes
  (> 50 % vertical and horizontal on both lines, ≥ 10 chars), empty page in a
  multi-page document.
- ATS: `checkResumeText` on the extracted text with the rendered line order,
  posting and support text; keyword gaps recorded, not failing.
- Cover: required when the packet has a cover letter; same parse, garbled,
  coverage and order checks; contact is not required.
- Poppler: when `pdftotext` is available it re-extracts, re-runs coverage/order/ATS
  and fails the packet on a problem pdfjs missed. When unavailable it is recorded
  as `atsParseTier='pdfjs-only'` (or `injected` for tests) and is never counted as
  a pass. Tier B is a cross-check, not visual fidelity.

## 4. Negative controls: before and after

### Pre-fix (HEAD `31d7ba1`, unmodified scorer)

Probe (`output` of a read-only script against HEAD's `score.mjs`):

```text
posting 28, candidate claim: {"unsupportedNumbers":[],"pass":true}
posting without 28, same claim: {"unsupportedNumbers":["28"],"pass":false}
numeric heading: {"unsupportedNumbers":[],"pass":true}
101 arbitrary bytes + caller head: {"pdfValid":true,"pass":true}
```

New numeric test file against HEAD's `score.mjs`:
`ℹ tests 40 / ℹ pass 2 / ℹ fail 38` — every §4.4/REVIEW row and every §5 case
fails on the pre-fix code (`score.numberChecks` does not exist; the two passing
tests are the unchanged existing number rules).

New PDF gate control against HEAD's `score.mjs`:
`✖ a PDF is evidence only when a rendered parse passed; the header alone never
passes` → `AssertionError: true !== false` at the `magic.pdfValid` assertion
(HEAD accepts 101 arbitrary bytes plus a caller `%PDF-`).

### Post-fix

| Control | Expected | Observed |
|---|---|---|
| Posting `28`, packet `I led teams in 28 countries.` | `unsupportedNumbers: ['28']`, fail | pass |
| Same packet, posting number removed | still `['28']`, fail | pass |
| `I told your team about 28 projects.` | `ambiguous`, `uncertain`, fail | pass |
| `The team of 12 reports to me today.` / `The team of 12 is my current team.` | `ambiguous`, `uncertain`, fail | pass |
| `Led 28 teams.` / `Led your 25 engineers.` | `implicit`, `uncertain`, fail | pass |
| `Your 25 engineers, whom I managed, shipped weekly.` | `candidate`, fail | pass |
| `Excited to have led your 25 engineers before.` | `candidate`, fail | pass |
| `Your company operates in 28 countries.`, `Your team has 28 people.`, `Your team of 28`, `your 28-person team`, `I am excited to join your 25 engineers.`, `I would love to support your 12-person team.` | employer, supported, pass | pass |
| `I built reports for your 28-country team.` | employer, supported (named production divergence) | pass |
| `Your company operates in 28 countries and I managed 28 of its offices.` | first employer/supported, second candidate/fail | pass |
| `At your company, I led 28 teams.`, `I led teams in 28 countries at your company.` | candidate, fail | pass |
| `The role requires 10+ years; I have 12.` | 10 employer allowed, 12 candidate supported | pass |
| Heading `Director of 28 divisions`, headline `Director of 28 divisions` | candidate, fail | pass |
| Heading `Jun 2026 to Aug 2026` in seeded sources | supported | pass |
| Heading `Jan 2031 to Mar 2032` | unsupported | pass |
| 101 arbitrary bytes + `head: '%PDF-'` | `pdfValid: false`, no pass | pass |
| Missing resume line / reordered same-section line | coverage fail, line named | pass |
| Interleaved columns | reading-order or coverage fail | pass |
| Garbled glyphs, missing contact, missing cover sentence | respective check fails | pass |
| Extractor throws / unavailable / empty text layer | `error` / `unavailable`, never pass | pass |
| Real rendered packet, pdfjs + Poppler | `state='passed'`, `atsParseTier='pdfjs+poppler'` | pass (real Chromium) |
| Real rendered packet, Poppler disabled | `pdfjs-only`, cross-check `skipped` | pass (real Chromium) |

## 5. Mutation check (§4.6 item 7)

Temporary (unshipped) mutation: pooled `postingTokens` into the candidate source
set, reproducing the pre-fix behaviour. `tests/test-eval-numeric-grounding.mjs`:

```text
ℹ tests 40
ℹ pass 20
ℹ fail 20
```

Failing classes under the mutation: candidate number only in posting; every
candidate-owned mixed/multi-sentence row; implicit and ambiguous rows; answer and
cover candidate rows; REVIEW candidate rows (`review-candidate-*`,
`review-intent-turned-claim`, `review-implicit-your-team`,
`review-two-mentions-one-sentence`, `review-report-to-me`,
`review-relative-clause-leak`, `review-my-current-team-leak`); numeric reporting;
numeric heading and headline. Two honest exceptions:

- "posting number removed" still fails correctly under the mutation (nothing adds
  support), so that test keeps passing — as expected.
- The legitimate employer rows still pass under the mutation, because pooling is
  more permissive, not less. §4.6 item 7 asks that tests 1–5 fail; items 1, 3 and 5
  do, item 2 remains a correctly-failing control, and item 4 cannot fail in the
  permissive direction. Recorded rather than claimed otherwise.

Mutation reverted (`cp` of the saved file); the same suite then reported
`ℹ tests 40 / ℹ pass 40 / ℹ fail 0`.

## 6. Test runs (post-fix)

All with `TMPDIR=/home/ak/.cache/plainhand-eval-tmp` and `--test-concurrency=2`.

| Command | Result |
|---|---|
| `node --test tests/test-eval-numeric-grounding.mjs` | 40 tests, 40 pass |
| `node --test tests/test-pdf-evidence.mjs` | 12 tests, 12 pass, 0 skipped |
| `node --test tests/test-bench-eval.mjs` | 31 tests, 31 pass |
| `node --test tests/test-ats-check.mjs tests/test-eval-judge.mjs tests/test-claim-calibration.mjs tests/test-resume-format.mjs` | 51 tests, 51 pass |
| The three changed files together | 83 tests, 83 pass |
| All seven related files together | 134 tests, 134 pass (15.8 s) |

Real render inside `tests/test-pdf-evidence.mjs`: Chromium headless via
`playwright`, `plainhand/workflow.mjs renderPacket`, real bytes, pdfjs 6.5.438,
`pdftotext` 26.10.0 → `state='passed'`, `atsParseTier='pdfjs+poppler'`,
cover PDF `pass`. No skip was needed on this host.

### Full controlled benchmark (diagnostic, not the frozen gate)

`node benchmarks/benchmark-eval.mjs --concurrency 2 --out <cache>`:
46 scenarios, 43 pass, 2 expected failures
(`profile-effect-fin-minimal`, `profile-effect-analyst-minimal`), 1 unexpected
failure (`profile-effect-analyst-built`). 38 packets; 418 numeric mentions, 0
uncertain, 0 posting-only; `pdfPassed` 38/38, `pdfBlocked` 0; 263 model calls;
174.8 s. Memory checked before the run (5.6 GiB available); no browser or server
left running afterwards.

## 7. Diagnosed failure — `profile-effect-analyst-built`

Not hidden and not papered over. The packet's cover letter says
`I taught mathematics for six years and am moving into data analysis.` The
conversation-built profile's sources contain `2020 to 2026` and `2019` but not
`six`, so the new number-word mention is unsupported and the packet fails. With
HEAD's `score.mjs` the same scenario passes (`{"pass":true,"unsupported":[],"pdfValid":true}`),
because the pre-fix scanner only extracted digits from packet text; number words
in the packet were never checked at all.

Interpretation: a true positive under the design's literal token rule (§4.1
invariant 3, §4.3 "extract both digits and existing number words"), exposing that
the conversation-built profile did not capture the stated tenure. It is a
gate-level consequence root must disposition, not a threshold change: either the
baseline records this as a genuine finding/expected failure, or the profile
conversation should capture the tenure phrasing. The scorer was **not** relaxed to
make the scenario pass.

## 8. Test-diff review (additions only)

`git diff` of tests shows additions plus these justified rewrites:

1. `tests/test-bench-eval.mjs`: `passingPacket()` now passes structured
   `PASSED_EVIDENCE` instead of `{ bytes, head }`. The fixture previously relied on
   the magic-byte predicate that §6 removes; the pass assertions themselves are
   unchanged. `PASSED_EVIDENCE` lists every required check as `pass`.
2. `tests/test-bench-eval.mjs`: new `test('a PDF is evidence only when a rendered
   parse passed; the header alone never passes')` — an added control, not a
   replacement.

No existing assertion was deleted or loosened; no threshold was changed.

## 9. Deviations and residual limitations

1. **Headline is not a PDF line.** `renderResumeHtml`'s header renders the
   candidate's name and contact details, not `packet.headline`, so requiring the
   headline in the rendered text would fail every real render. The headline is
   still checked numerically (§5) and the design's §6.3 "headline" PDF line is
   otherwise unrepresented. Root may accept this or ask the renderer to render the
   headline (product change, out of scope here).
2. **Reading order is document order, not packet order.** The renderer groups
   sections by format (`resume-format.mjs orderSections`), so packet order is not
   the render order. The gate is: every entry line's first-six-word probe found
   (≥ 0.70), no interleaved line runs, and no reordering within a section. The
   engine's ascending ratio is recorded as a diagnostic. A wholesale two-line swap
   across sections is therefore not gated; interleaving and in-section swaps are.
3. **Heading parts are presence-only.** The renderer can split a heading across two
   rows and Poppler can lay absolutely positioned spans out of flow; heading parts
   are checked for presence/coverage, not order. Entry lines carry the order gate.
4. **Mid-line word swaps.** Coverage allows ≥ 0.90 in-order tokens, so a swap
   deep inside a long line can pass coverage; the first-six-word probe catches
   swaps in a line's opening words. Recorded, not hidden.
5. **Profile preferences as sources.** Design §11 residual unchanged: a profile
   preference number could support a claimed achievement, because sources are not
   role-classified. This packet separates candidate from posting, nothing more.
6. **Identity/judge metadata and the §8.5 intervention counters** (design §9 step
   4) are not part of this lane's scope and were not implemented.
7. **`docs/internal/EVALUATION-HARNESS.md` / `EVALUATION-JUDGE.md`** were not
   updated: the dispatch scoped lane docs to this RESULT only. The new evidence
   fields are documented here and in module comments.
8. **Full `test:plainhand`** (all ~50 files) was not run; the focused set and the
   full controlled benchmark above cover every touched surface. Root's merged-tree
   rerun is the acceptance check.
9. **Environment note.** This worktree had no `node_modules`; no install was run
   (forbidden). The already-pinned dependencies were made resolvable by a local,
   git-ignored symlink `node_modules -> /home/ak/Plainhand/node_modules`
   (same base commit, `pdfjs-dist` 6.5.438 verified). This is environment setup,
   not a dependency change; the symlink is not committed.
10. **Named production divergence** `I built reports for your 28-country team.`
    remains as REVIEW amendment 1 accepted. The scorer's compound/possessive/`of`
    attachment rule is intentionally marginally more permissive than production's
    frame rule in that one shape; the cross-check test asserts the divergence set
    is exactly the named row.

## 10. Commands actually run (abridged)

```text
git rev-parse HEAD                     # 31d7ba1... before edits, clean tree
free -h                                # before every browser run; never below ~3 GiB
node /tmp/probe-prod2.mjs              # production calibration behaviour on every row
node <prefix-probe.mjs>                # HEAD counterexamples (section 4)
node --test tests/test-eval-numeric-grounding.mjs   # 38/40 fail on HEAD score.mjs
node --test --test-name-pattern="a PDF is evidence only" tests/test-bench-eval.mjs   # fails on HEAD
<apply pooled-posting mutation>; node --test tests/test-eval-numeric-grounding.mjs   # 20/40 fail
<revert mutation>; node --test tests/test-eval-numeric-grounding.mjs                 # 40/40 pass
node --test tests/test-eval-numeric-grounding.mjs tests/test-pdf-evidence.mjs tests/test-bench-eval.mjs
node --test tests/test-ats-check.mjs tests/test-eval-judge.mjs tests/test-claim-calibration.mjs tests/test-resume-format.mjs
node benchmarks/benchmark-eval.mjs --concurrency 2 --out /home/ak/.cache/plainhand-eval-tmp/full-controlled
node benchmarks/benchmark-eval.mjs --scenarios mech-resume,swe-submit --concurrency 1 --out ...
git diff --check
```

Evidence files (outside the repository, kept for root):
`/home/ak/.cache/plainhand-eval-tmp/{prefix-probe.log,prefix-numeric.log,
prefix-pdf-gate.log,mutation.log,prefix-analyst-built/,e2e-debug7/,full-controlled/}`.

## 11. What root should do next

1. Read the production diff and the test diff separately; confirm no threshold or
   assertion was weakened (section 8).
2. Rerun the focused checks in the merged tree, including the real-render PDF test.
3. Decide the disposition of `profile-effect-analyst-built` (section 7): keep the
   stricter number-word rule and record the finding, or have the profile capture the
   tenure; do not relax the scan.
4. Accept or amend the two deviations in section 9 (headline in PDF, document-order
   reading gate).
5. Only then proceed to the baseline freeze. This lane makes no baseline, product or
   independence claim.
