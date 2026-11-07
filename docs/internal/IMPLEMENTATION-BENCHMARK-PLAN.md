# Implementation comparison — preregistered scope

Goal: select a better architecture for personalized job-application delegation,
using a connected CLI and stopping before employer submission. This comparison
is about the workflow, not a graduation-status demographic.

## Candidates

1. Current packet-first workflow: prepare/review documents, then inspect and answer
   portal-specific questions using the current source-backed form prompt.
2. Form-first: inspect the available form before drafting/reviewing the same packet.
3. Durable hybrid: form-first plus versioned candidate answer memory and a resumable
   per-application actor. Reconcile browser state rather than blindly replaying.
4. Focused-context hybrid: same actor, with selectively retrieved source material for
   drafting; factual review still sees full original sources. This tests whether
   context reduction is worthwhile rather than assuming it improves results.

All candidates must meet the same output contract: grounded resume, cover letter
and form answers, correct stopping on unknown facts and no automated submission.
PDF layout is already covered by the regular suite; comparisons use the same
renderer fixture to isolate planning/browser work. Prototype improvements are
not silently promoted into the shipping workflow.

## Measures and hard gates

- Actual Chromium field readback and source/evidence validation.
- Correct final-review completion; required missing/incorrect fields never pass.
- Appropriate clarification versus unnecessary interruption, scored separately.
- Real model calls and provider-reported usage, cache counts, model IDs and latency.
  Unknown metrics remain unknown; subscription quota cannot be derived from tokens.
- Browser/document recovery after restart, duplicate actions, and source-change
  invalidation. Checkpoints alone are not proof of recovery.
- Failure classification and behavior for CAPTCHA, login, rejection and stale pages.
- Cross-job scheduling/locking assessed separately from answer quality.

Safety/correctness failures cannot be traded for a higher completion score.
Initial selection and final human approval/submission are planned interactions;
extra factual questions or recovery takeovers are counted explicitly.

## Evidence tiers

Controlled policy/browser cases test orchestration with deterministic test agents.
They do not measure LLM intelligence. Paired live CLI runs on fictional candidates
and employer forms test reasoning and consumption. Existing public read-only ATS
observations test rendering only. No benchmark sends fictional applications or
candidate data to real employers. No claim of 90% field/application completion
will be made from fixtures or a three-posting observation sample.

Variants may be added after an observed failure, but additional variants and
retests must be named in the final report, with tuning and held-out cases separated.
All outcomes, including failures and unavailable providers, are retained.

## Subsequent variants and validation

Observed failures motivated four named additions: readiness-gated form first,
semantic native-control hybrid, contract hybrid and typed-state actor. Optional
unknowns, eight-page forms and an implicit source-retrieval question were added
as holdouts, then used for tuning; final runs are validation after that tuning,
not independent unseen evaluation. See [results](IMPLEMENTATION-BENCHMARK-RESULTS.md)
for all retained failures, grading corrections, consumption coverage and limits.
