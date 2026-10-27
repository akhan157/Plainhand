# Plainhand incremental validation — 19 October 2026

> **Follow-up:** [Round-two verification](VERIFICATION-ROUND2-RESULTS.md) closes the
> known readiness failures and verifies scoped page recovery in separate isolated
> candidates. Production remains unchanged. Results below preserve round-one evidence.

## Decision

**Keep production unchanged. Prefer incremental improvements over an actor rewrite,
but do not call any complete implementation a verified winner.**

- Optional-question handling has direct browser/API evidence **and one successful
  paired real-Codex case** where baseline unnecessarily stopped.
- Bounded mechanical repair has controlled evidence for dropped writes, retained
  human edits, no repeated local file selection and safe stops on persistent/stale failures.
  It was not directly tested with real-model reasoning in this pilot.
- Form-first is promising: **4 → 3 calls in each of two real-model pairs**, including
  evaluation. That is two cases, not a general efficiency guarantee.
- Readiness detection improved, but **two additional counterexamples still fail**.
  A 17/17 reserve score did not establish a complete readiness solution.
- Whole-process tests exposed replay after restart. The actor prototype was not
  promoted, and neither current nor combined workflow proves exact-page recovery.

No app source, user profile, tracker or running server changed. Experimental copies,
patches, frozen inputs, raw outcomes and reproduction scripts are in
`output/incremental-validation-2026-10-19/`.

## What was compared

Current production snapshot versus individual readiness, optional-question,
ordinary-field repair and opt-in form-first changes. A fifth candidate combines
**only readiness + optional handling + repair**, not form-first or the actor.

All comparisons exercised production HTTP tasks, exact packet approval, real
Chromium document rendering and browser readback on fictional local forms.
Sources were copied into isolated directories; no source changes were made to
active app. The form-first seam is explicitly injected by the experimental runner;
no new production UI/setting enables it.

Before implementation, froze three fictional backgrounds (support, finance,
research), nine development cases, 17 reserve scenarios, three real-model pairs
and independent expected values. Candidate code and runner were frozen before
reserve outcomes were inspected. Same assistant authored cases and code: this is
prespecified, unused-for-tuning evaluation, **not blinded external validation**.

## Controlled reserve results

Deterministic source-based agents isolate orchestration, not AI intelligence.
Correct stops and completed forms are deliberately separate.

| Candidate | Correct expected outcomes / 17 | Factual-ready / 6 eligible | False-ready |
| --- | --- | --- | --- |
| Current baseline | 10 | 2 | 3 |
| Readiness only | 13 | 2 | 0 |
| Optional questions only | 11 | 3 | 3 |
| Bounded repair only | 13 | 5 | 3 |
| Three-change combination | 17 | 6 | 0 |

Readiness's gain was **honest blocking**, not newly filling unsupported radio or
checkbox controls. Optional/repair alone retain baseline readiness defects; their
rows do not establish a safe complete replacement.

The form-first diagnostic row recorded 9/17 expected outcomes, retaining baseline
mechanical defects. One apparent failure was a target-hook mismatch: observing a
required missing date stopped preparation before the test's form-stage provider
error could be injected. That is an unexercised error hook, not evidence of unsafe
behavior. Keep its raw outcome, but do not rank architectures from that count.

Reserve cases covered different control wording, factual checkbox/radio,
optional/required dates, iframe, conditional insertion, two pages, repeated labels,
local file-selection reuse, human edits, changed evidence during repair, persistent failure,
provider warning, login and challenge stops. None is a real employer application.

`Raw reserve results`.

## Counterexamples after the reserve run

Code review identified two paths not covered by reserve. Added these as a
**separate post-freeze challenge set**, not retroactively as prespecified holdouts.
Did not change candidate code or retune against their results.

| New challenge | Baseline | Readiness candidate | Combination |
| --- | --- | --- | --- |
| Required radio is the only application field | Incorrect `review` | Incorrect `review` | Incorrect `review` |
| Required "Legal surname" field | Incorrect `review` | Incorrect `review` | Incorrect `review` |

Root causes:

1. Radio-only extraction yields no ordinary fields. Initial navigation/observation
   returns review before the narrow `advance` readiness check runs.
2. Broad sensitive-keyword matching treats ordinary "Legal surname" as a human
   legal choice and skips its factual completeness check.

These are required-factual readiness failures under the rubric, **not automated
submissions**. All fixture submission counters stayed zero. They block claiming
that this readiness patch solves the whole problem. They also demonstrate why
reserve pass counts alone should not drive architecture adoption.

`Challenge evidence`.

## Real Codex pilot — 22 of 24 approved calls

Six fictional applications in three prespecified pairs, one attempt per application.
No auth/quota failure, provider fallback or retry. All 22 invocations succeeded and
reported input/output/cache tokens. Remaining two allowed calls were not spent.

| Pair | Baseline | Experimental change | Calls |
| --- | --- | --- | --- |
| Optional start date, support profile | Asked optional question and stopped before filling | Kept question visible, filled contact fields, reached review | 4 → 4 |
| Work-improvement answer, finance profile | Correct answer at review after form-specific call | Correct grounded answer generated with packet, reached review | 4 → 3 |
| Required unknown date, research profile | Asked after packet preparation/browser inspection | Asked during preparation; packet approval stayed blocked | 4 → 3 |

Actual form answer in the achievement pair preserved the checklist, employer,
6-hour/3-hour values and Excel fact. Inspection of six generated packets found no
obvious added credential or numerical claim; automated factual reviewer passed each.
This was assistant inspection, **not blinded factual/voice evaluation or candidate
acceptance**. Real-model repair/readiness and the full combination were not exercised.

Reported totals: **368,026 inclusive input tokens**, **4,387 output tokens**,
**224,000 cache-read tokens** (subset of input, not additional input), coverage 22/22.
Codex CLI `0.163.0`; model ID and USD were not reported, so remain unknown. Do not
infer subscription quota remaining or dollar charges from these counts. CLI defaults
were unchanged across candidates. Single-run times/cache state are not a reliable
performance estimate; no percent-latency claim is made.

`Raw model runs`,
`call reservations and outcomes`,
`review extract`.

## Regression and failure recovery

- **Each of six snapshots:** 67 app/browser/security/usage tests passed, zero failed,
  one CPU real-audio test skipped; existing browser UI workflow passed. Those UI tests
  use normal constructors; active form-first inspection is exercised in comparison
  cases, not a newly implemented preparation-time UI flow.
- Baseline and combined candidate both rejected duplicate queued preparation and
  a stale in-flight packet after profile changes. No stale packet was approved.
- Four explicit **whole Node-process SIGKILL** probes: baseline and combined, after
  fill and after navigation. Checkpoint survived; manual resume could reach review.
- After navigation, both restarted from the original application URL, **not the
  saved page**, and replayed first-page filling. This remains a recovery gap.

Crash probes used a parent-owned local browser server and fresh contexts after
worker disconnect, actual PDFs and local checkpoints. They do not simulate a full
machine failure, persisted employer-side state or duplicate attachment side effects.
Contact-field replay is not proof of duplicate submission, but checkpoint existence
alone cannot be called exact resumability.

`Regression logs`,
`duplicate/stale invariants`,
`process-recovery evidence`.

## What is and is not supported now

**Supported, narrowly:** Optional-question handling is worth retaining as a proposed
isolated improvement; ordinary-field bounded repair deserves staged validation;
form-first deserves further paired trials without changing architecture. Existing
readback and approval machinery should be reused, not rewritten.

**Not supported:** A universal winner, production-ready combined replacement,
complete required-field readiness, exact-process/browser recovery, real ATS fill/
upload reliability, broad CAPTCHA acceptance, measured candidate voice or 90%
autonomy. The old eight prototypes were not all rebenchmarked; this round tested
individual production-path improvements, as agreed.

Next experimental round should close **all review-return paths** and distinguish
factual identity fields from actual sensitive/legal choices, retaining the two new
counterexamples as development regressions and creating a new reserve before
validation. Do not patch frozen candidates and reuse 17/17 as unseen proof.
Any eventual promotion should be separate, inspectable and component-by-component;
this report does not ship or authorize a wholesale migration.
