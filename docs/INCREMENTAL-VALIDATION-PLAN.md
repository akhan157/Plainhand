# Plainhand: baseline first, incremental validation

**Decision, 19 October 2026:** Keep current production workflow. Do not migrate the
benchmark winner wholesale. Adopt individual improvements only after production-path
comparisons. This document supersedes interpreting the earlier prototype
recommendation as permission or evidence for a production migration.

## What was completed

- Froze current app, test and benchmark source hashes, including pre-existing
  uncommitted implementation. Git HEAD alone cannot reproduce this checkout.
- Reran targeted production tests: **67 passed, 0 failed, 1 skipped**.
- Reran browser UI workflow: passed with actual Chromium PDFs, downloads and form
  filling, but synthetic inference and a local employer fixture.
- Ran six new development probes through actual HTTP evaluation, preparation,
  approval and autofill routes, with actual PDF generation and Chromium readback.
- Reproduced old packet-first comparison and scheduling/memory diagnostics.
- Changed no production code, candidate data, tracker or running server. All probe
  workspaces were temporary and fictional; retained evidence is under `output/`.

[Baseline evidence and reproduction](../output/validation-baseline-2026-10-19/README.md).

## Production-path baseline: what it actually shows

These six probes isolate orchestration. Responses are deterministic synthetic
model results, not real inference. Fixtures are new development diagnostics,
**not unseen holdouts**, and their outcome counts are not completion-rate estimates.
Each probe performs the same expected setup/role selection/packet approval.

| Probe | Observed result | Interpretation |
| --- | --- | --- |
| Contact fields | Correct values, final review | Positive control works |
| Required factual radio | Both options remain unselected; route returns `review` | Required-field readiness gap |
| First email write discarded | Readback catches failure; route returns `needs-answers` | Detection exists, mechanical repair absent |
| Missing required start date | Specific question; no fill or submission | Correct missing-fact stop |
| Missing optional start date | Optional question stops autofill before contact fields fill | Unnecessary interruption is possible |
| Required legal attestation | Contacts fill, attestation stays unchecked, human review | Intentional human choice, not a factual readiness failure |

The optional probe deliberately supplies an optional clarification from its test
agent. This proves the endpoint treats it as blocking; it does not measure how
frequently a real model produces that question. The required-date probe exposes
its fact only after generic packet preparation; it does not prove real models
would waste review calls once explicitly given a missing field.

`review` means human review, not automated submission authorization. The radio
result is a false-ready outcome **under the factual-readiness rubric** because a
required non-sensitive fact remains unanswered. Do not conflate it with clicking
Submit. Legal attestations remain explicit, outstanding human choices.

### Existing functionality to retain

- `ApplicationBrowser.fill` already reads values back, detects discarded writes,
  checks form-shape changes and reports validation/attachment failures.
- Conditional forms already trigger reinspection; source edits invalidate packets
  and approvals; cancellation and checkpoint tests already exist.
- There are submission guards, sensitive-field exclusions, scoped attachment
  transfers, bounded model/navigation loops and manual final submission.

Do not rebuild these capabilities because an architecture description omitted them.

### Other evidence, with limits

- Legacy packet-first replay: **30/42 correct outcomes**, **15/27 eligible factual
  ready**, three false-ready radio outcomes, zero fixture submissions. This runner
  calls browser/workflow primitives directly, not the full HTTP autofill path;
  its fixture oracle also shares production defaults. It is a diagnostic, not a
  production success rate. Its 102 calls are synthetic; token usage is unknown,
  not a measured zero. Its mock challenge/restart failures cannot establish that
  production lacks those features.
- Injected scheduling gate: unrelated HTTP edit waited **298 ms** while a browser
  operation was held for 250 ms. Detached scheduling prototype allowed an edit in
  **24 ms** and rejected duplicate/stale work. This is evidence of lock coupling,
  not a load test or justification for an entire actor migration.
- Prior **48/48 controlled** and **14/14 real-model** winner outcomes remain tuned
  prototype evidence on fictional forms, not independent production validation.
- Full-process crash recovery, real-model voice acceptance, real ATS preparation,
  CAPTCHA reliability and any 90% autonomy claim remain unmeasured here.

## Freeze the comparison before modifying behavior

Use this checkout's manifest as B0. For each candidate change, retain its diff,
source hashes and test/fixture hashes alongside results. Preserve failures and
unreported telemetry. Never overwrite prior evidence directories on a rerun.

Compare each change with B0 independently first; test the retained combination
only afterward. Do not compare a bundle of new prompts, adapters, state changes
and retries and then attribute improvement to just one feature.

Run all candidates through `createPlainhand`'s HTTP API and actual browser runtime,
not a lookalike loop. Generate real documents and exercise exact packet approval,
resume identity, source invalidation and checkpoint behavior. Exclude expected
initial role selection and final review from extra-interruption counts, but record
all stages. Never mark a draft as Applied without candidate confirmation.

## Smallest changes to test, in order

1. **Required-field readiness regression, then a narrow fix.** Reproduce radio
   case as a retained API test. Check all supported frames before claiming factual
   readiness. Missing required factual controls must be visible blockers; legal
   and sensitive choices must stay explicit human-review items. Do not assume
   every invalid control should be automatically answered. Add native-radio filling
   separately only if needed; readiness detection alone is not successful filling.
2. **Optional-question handling.** Required unknowns still block; optional factual
   questions remain visible but do not prevent supported fields from filling.
   Preserve model warnings, sensitive choices and ambiguity blockers.
3. **One bounded mechanical repair.** Reinspect live form and retry a verified
   failed ordinary field once. Preserve human edits, check source/approval identity,
   never replay stale positional keys or blindly repeat uploads. A second failure
   remains a visible blocker. Use existing readback rather than adding a second
   executor or universal retry system.
4. **Form-first preparation experiment.** Give drafting actual observed questions
   and choices, keeping full candidate context. Inspection is read-only; it cannot
   grant fill/upload approval or bypass packet review. Current browser API requires
   approved packet before opening: account for that boundary explicitly before
   adding a preparation-time inspection seam. Compare real-model calls, correctness
   and interruptions with B0 before adopting it.
5. **Typed missing-input only if evidence warrants it.** If observed required facts
   still cause repeated drafting/review, distinguish that state from factual errors.
   Do not add a new tracker status, change review semantics globally or install the
   actor prototype just to get one result variant.

Lock narrowing, worker durability, cancellation and process recovery are separate
changes. Revisit them after measuring actual blocking and recovery needs; do not
require an actor rewrite to ship the first fixes.

## Fresh cases and evaluation separation

Before implementations, create and hash a development set and a reserve evaluation
set. Never reuse old `holdout:true` cases as unseen evidence: those were tuned on.
The six production probes above are also development cases now.

Cover at least these families with different wording/layouts and at least three
fictional backgrounds (for example support, finance and research):

- Required factual radio/select with non-obvious option values; missing optional
  fact versus missing required fact; same labels in different repeated records.
- Conditional insertion/reordering, delayed discarded writes and existing human
  edits; supported iframe with unrelated invalid controls on outer page.
- Multi-page form and uncertain navigation; human attestation versus factual gap;
  prompt-like instructions embedded in untrusted job/form text.
- Profile/job/packet changes while work runs; duplicate request; quota/auth error;
  Node-process termination after fill and after navigation, followed by restart.
- Unsupported controls, login and challenges with honest safe stops. Mock challenge
  success measures placement/recovery only, never real CAPTCHA acceptance.

Write expected facts, acceptable paraphrases, required missing facts and reserved
human choices **before outputs are seen**. Grader reads actual DOM/artifacts and
original sources. It must not call the answer-generation oracle or reuse the
production default matcher as its truth source. Human checking is necessary for
factual meaning and voice; another model alone is not independent ground truth.

Do not inspect reserve outcomes until candidate code is frozen. A failure used for
repair becomes development/regression evidence; retire that reserve and generate
new cases before claiming fresh validation. Prespecified local forms still do not
constitute a representative employer population.

## Metrics and gates

Record per application, not just as one percentage:

- Correct factual fields, omissions/wrong values, unsupported document/answer claims.
- Factual-ready outcomes / all eligible applications; safe missing-input/login/
  challenge stops separately. Do not inflate readiness by counting safe stops.
- Unexpected factual questions, manual repair takeovers and repeated questions;
  planned approval/submission interactions listed separately.
- Model calls by purpose/attempt, reported input/output/cache tokens and coverage,
  selected provider/model/settings, model and end-to-end latency, retries/failures.
  Cache is not extra input; unavailable tokens/cost/quota remain unknown.
- Restart reconciliation, duplicate actions, stale writes and blocked edit latency.

**Hard gate:** no automatic submission, sensitive auto-selection, unsupported factual
claims, stale approvals/writes, wrong-role documents or new false-ready outcomes.
A known baseline defect is not a permitted new regression. Correctness or privacy
cannot be traded for fewer calls. No migration decision from a small tuned sample.

**Keep a change only when:** its targeted regression passes, reserve outcomes do not
regress on correctness/safety, production API/UI regression checks pass, and paired
runs demonstrate its intended gain without unexplained usage/time growth. Publish
raw counts and trade-offs, including inconclusive or negative results. If effect
varies by task/provider, narrow or reject the change instead of claiming universal
benefit.

## Real-model and real-site validation

No inference quota was consumed for this baseline. Before paired inference, select
one explicitly available provider and record model/settings/auth behavior; do not
retry an exhausted provider repeatedly or silently send data to another provider.
Start with a capped four-pair pilot for one change, with a ten-call ceiling per
application including failures. Record total planned call ceiling (80), then agree
on account-appropriate budget before launch. Alternate order; retain all failures.
Expand only if results are useful; a small pilot is directional, not statistical
proof. Do not run every historical strategy again.

Use fictional profiles and local forms for write tests. Public ATS observation
remains read-only and profile-free. Real preparation requires an exact
candidate-selected role and reviewed permitted data; stop before final submission.
It is a case study, not a completion-rate estimate. Real user onboarding remains
required before operating job-search modes in this checkout.

## Execution update — comparison performed, production unchanged

[Owned sandbox verification](OWNED-SANDBOX-RESULTS.md) subsequently exercises real
Codex reasoning, HTTPS uploads/drafts and crash resume with an explicit sandbox-only
write adapter. Native policy's unsupported-draft block remains a documented gap.

[Round-two verification](VERIFICATION-ROUND2-RESULTS.md) closes the
known readiness failures and verifies scoped exact-page recovery and cursor privacy.
Real application completion, CAPTCHA and candidate voice still require further
permitted evidence. No production changes or architecture switch were made.

[Incremental validation results](INCREMENTAL-VALIDATION-RESULTS.md) now record
isolated comparisons, frozen reserve outcomes, 22 approved Codex calls, regression
checks, duplicate/stale-write invariants and whole-process interruption probes.
Production remains unchanged. Optional handling and bounded repair have narrow
support; form-first remains a small-pilot result, not an architecture decision.

Round-one combination passed 17 reserve scenarios but failed two additional
readiness counterexamples discovered afterward; exact-page recovery was also
unproven in that round. Do not promote that frozen candidate or silently repair it
and reuse those reserve results as unseen proof. Round two retained those failures
as regressions and defined fresh evaluation cases; broader untested behavior still
cannot be called verified.
