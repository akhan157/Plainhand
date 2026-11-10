# End-to-end evaluation harness

**Status:** controlled harness, 10 November 2026
**Entry point:** `npm run benchmark:eval`
**Code:** `plainhand/evaluation/` · **CLI:** `benchmarks/benchmark-eval.mjs`

## What this measures

Plainhand's own checks prove that one output is internally consistent. They do not
say whether the product is getting better. This harness runs the whole product
against fictional candidates, fictional jobs and an owned application portal, then
scores the result from recorded evidence:

| Dimension | What is scored |
| --- | --- |
| Profile building | Facts captured in the candidate's words, unsupported profile updates, invented or absent claims, one-question and on-topic turns, calls, time |
| Evaluation | Score band, recommendation, evidence for every match, and a below-4/5 role refusing `prepare` without the candidate's override |
| Resume building | Required facts covered, unsupported numbers (number words and phone digits handled), claims the candidate said they lack, banned voice phrases, ATS term coverage, factual review, calibration, real PDF |
| Application filling | Expected values in the actual DOM, completion rate, required fields, sensitive fields never auto-filled, unknown facts blocking correctly, resume upload, false-ready, discard-and-retry recovery |
| Submission | A candidate-confirmed payload accepted by the owned sandbox, server-side validation, exact approved resume and cover-letter hashes, receipt |
| Connected journey | Profile conversation → understanding → approved standard → evaluation → packet → portal fill → candidate confirmation in one workspace |

Everything is scored against `plainhand/evaluation/corpus.mjs`; a model is never
asked whether it did well.

## How to run

```bash
npm run benchmark:eval                                   # deterministic, ~85 s
npm run benchmark:eval -- --scenarios mech-lever         # one scenario
npm run benchmark:eval -- --concurrency 2                # parallel controlled scenarios
npm run benchmark:eval -- --repeat 3                     # variance across repeats
npm run benchmark:eval -- --provider antigravity --concurrency 1 --agent-timeout 900
npm run benchmark:eval -- --baseline output/evaluation-controlled-...  # delta
npm run benchmark:eval:live                              # real Claude CLI, opt-in
node benchmarks/benchmark-eval.mjs --provider codex      # another provider
```

Evidence is written to `output/evaluation-<tier>-<timestamp>/`:
`results.json`, `SUMMARY.md`, and one JSON file per scenario. `npm run
benchmark:status` now lists the latest run.

Use `--retain` to keep each scenario's temporary workspace; otherwise it is
deleted after the result is recorded.

A live run makes one small connection test first (no candidate data). A sign-in
or quota failure stops the run immediately instead of producing one failure per
scenario. That preflight call is not included in the scenario call totals.

Live runs default to one scenario at a time and a 600-second per-call timeout;
controlled runs default to two and 180 seconds. Slow providers exhausted the old
180-second limit on parallel live runs, which produced timeout failures rather
than model results.

## The sandbox

`plainhand/evaluation/portals.mjs` renders eleven portal shapes: one-page Lever,
two-step Greenhouse, Ashby with a cover-letter upload, a conditional question, a
sensitive-heavy form, an unknown required fact, a CAPTCHA wall, a Workday-style
sign-in wall, repeating employment records, a native radio group, and a form that
discards the first input once. The records template renders both `Employment`
fieldsets before the achievement question, so the app must use each fieldset's
own section index instead of one shared label.

`ApplicationBrowser` opens them through a Playwright route for
`https://jobs.lever.co/synthetic/<scenario>`. The production inspection, fill,
readback and submit guard all run unchanged. Non-GET requests are aborted; the app
never presses a submit control. On the discard-once template the harness detects
the empty field on the first pass and runs one explicit retry, recording
`discardDetected`; the scenario fails if that recovery is missing.

After the app has filled and stopped at review, the harness acts as the candidate:
the real Playwright DOM receives only the fields reserved for the person (work
authorization, legal attestation, salary), then the harness POSTs the extracted
values, the approved PDF hashes and the candidate's confirmation over real
loopback HTTP to `plainhand/evaluation/sandbox.mjs`. The sandbox validates required
fields, choices, file magic, file size and hash, and that no sensitive field was
filled by the app. When the sandbox accepts, the harness performs the candidate's
own confirmation (`Applied` plus `submittedAt`), so the tracker lifecycle is
scored too. Nothing is sent to an employer, and the production handoff still
requires the person to submit.

A scenario that should stop (`unknown-required`, `challenge`, `workday-login`)
passes only when it stops correctly and no submission is attempted.

## Scenarios

| Family | Count | Examples |
| --- | --- | --- |
| Profile | 3 | engineering graduate, career changer, junior engineer (fictional; deterministic candidate) |
| Resume | 6 | six candidates against six jobs, no portal |
| Application | 11 | single-step, two-step, conditional, sensitive-heavy, unknown fact, CAPTCHA, sign-in wall, repeating records, native radio, discard-and-retry |
| Submission | 2 | candidate-confirmed submission through one-step and two-step portals |
| Evaluation | 1 | a principal role the mechanical graduate must score `Skip`; `prepare` is refused below 4/5 |
| Profile effect | 6 | two matched triples: minimal seed, conversation-built profile and seeded full profile, then the same evaluation, packet and application |
| Journey | 1 | profile conversation → understanding → standard → evaluation → packet → portal → candidate confirmation |
| **Total** | **30** | |

Add a scenario by adding a persona, job or portal to `corpus.mjs` and one entry
to `scenarios`. A scorer must be able to name the expected value for every field;
`expect` records that decision.

## Profile effectiveness

A profile is only useful if it makes the next stages better. The `profile-effect`
family runs the same job three ways:

1. **Minimal:** the candidate's minimal seed (identity plus a one-line resume),
   with no conversation. This is the lower bound.
2. **Built:** start from the same minimal seed, hold the conversation, then
   evaluate, prepare and apply.
3. **Seeded:** start from the finished persona profile (the upper bound), then run
   the same evaluation, packet and application.

The report shows the built profile's capture rate, coverage, strength summary and
conversation cost, plus downstream deltas on packet fact coverage, application
completion and evaluation pass. Delta vs minimal shows whether the conversation
added usable material; delta vs seeded shows how far the built profile is from
the full profile. A zero delta vs seeded means the conversation-built profile
supported the same downstream result; a negative delta means something the
downstream stage needed was not captured or not used.

“App from profile” counts only form fields the app filled correctly. A field the
simulated candidate had to supply is not credited, even when the final form is
complete, so a minimal profile cannot look as good as a built one merely because
the candidate rescues the missing answers.

Controlled runs use the deterministic agent, so both variants answer from the
same ground truth and the delta is expected to be zero: controlled mode proves the
pairing and scoring, not profile quality. Live runs use the real model on the
conversation and on the downstream stages; that delta is the signal to improve.

## Evidence tiers

| Run | What it establishes | What it does not |
| --- | --- | --- |
| Controlled (`benchmark:eval`) | The harness, workflow, production browser path, submit guard and sandbox validation work together and the scoring detects planted failures | Model quality, real voice, employer acceptance |
| Live (`--provider`) | How one real provider performs on fictional material end to end | Real employer acceptance, human voice judgment, a guarantee for other providers |

A controlled run is not a product-quality score. It is the regression gate that
must stay green before a live run means anything.

## Current controlled result (10 November 2026)

`node benchmarks/benchmark-eval.mjs --concurrency 2`: **30 scenarios, 28 passed,
2 expected lower-bound failures** in about 67 seconds on this laptop. The two
expected failures are the minimal-profile controls: they deliberately have no
conversation, so the job facts are absent. There were **0 unexpected failures**.

- Profile capture was **1.00** across 6 runs (3 profile scenarios, 2 built
  profile-effect conversations and the journey conversation): 0 unsupported
  updates, 0 absent claims saved, 0 failed turns and one question per turn.
- Packet coverage was **1.00** for all built and seeded packets; the aggregate
  **0.923** includes the two minimal controls at 0.00, which is the intended
  lower bound. All packets passed review and calibration, used first person, and
  had 0 unsupported numbers, 0 absent claims and 0 banned words.
- All **17** candidate-confirmed submissions were accepted by the loopback
  sandbox with matching approved resume hashes (and the cover-letter hash where
  attached); tracker status became `Applied` with `submittedAt`. Application
  completion was **1.00** across 17 fill runs, with 0 false-ready, 0 sensitive
  auto-fills and 0 invented unknown answers.
- All **27** evaluations passed: valid score, expected recommendation, correct
  band, evidence for every match, and a below-4/5 role refused `prepare` without
  an override.
- The three stop scenarios stopped correctly (`needs-answers`, `challenge`,
  `login`). The discard-once portal detected the first-pass loss and recovered on
  retry. The records portal filled both employment fieldsets and the native radio
  portal filled the degree group.
- `journey-mech` passed the connected path: profile pass, understanding approved,
  standard approved, evaluation pass, packet pass and application pass in one
  workspace.
- The profile-effect triples passed for mech and analyst: built and seeded
  profiles both covered the required facts and completed the application; the
  minimal controls failed packet coverage. Controlled deltas are zero by design
  because the deterministic agent answers from the same ground truth.

This proves the harness, not model quality. The first live run is the next step.

## First live baseline attempt (Antigravity, 10 November 2026)

`node benchmarks/benchmark-eval.mjs --provider antigravity --concurrency 2`
completed 24 scenarios with **9 passed**. That number is **not a model-quality
score**: 12 failures were `prepare: The agent timed out` because the 180-second
per-call limit was too short for a slow provider under two concurrent scenarios.
The run took about 1 h 42 m. Evidence:
`output/evaluation-antigravity-2026-11-10T14-48-51-175Z`.

The nine completed results are still useful:

- `profile-career-changer`, `profile-quiet-junior`, `mech-resume`,
  `analyst-resume`, `designer-resume`, `mech-challenge`, `mech-mismatch`,
  `designer-submit` and `journey-mech` passed.
- `profile-mech-grad` failed on profile quality, not a crash: the conversation
  revealed only 2 of 6 facts and captured 1, ending after four assistant turns.
  This is the kind of signal the profile-effectiveness pairs are meant to turn
  into a downstream delta.
- `ops-records` reached the form but the form agent returned a warning and filled
  nothing; the new scorer now reports that warning as `agent-warning` instead of
  a misleading `ready`.

Fixes made from this attempt:

- live runs default to one scenario at a time;
- the per-call timeout is configurable, defaulting to 600 seconds live and 180
  controlled (`--agent-timeout`);
- a live preflight stops the run on quota or sign-in failure before any scenario;
- a form-agent warning is a scored stop, not a false-ready.

A fresh live run after these fixes is required before quoting a pass rate.
Claude was at its 5-hour limit and Codex at its usage limit during this attempt.

## Live profile-effect subset (Antigravity, 10 November 2026)

The targeted six-scenario profile-effect run (`--concurrency 1
--agent-timeout 900`) completed **1/6** in about 46 minutes. It is small, but it
answered the profile question more directly than the full baseline:

| Pair | Minimal | Built | Seeded |
| --- | --- | --- | --- |
| Mechanical | evaluation 3.5 `Investigate`; packet blocked on missing project/tool facts | capture **1.00** (5/5), evaluation 4.5 `Apply`; packet blocked on start-date/internship/role questions | evaluation 4.5 `Apply`; packet blocked on a 2027 start-date question |
| Analyst | evaluation 2.0 `Investigate`; packet blocked on project/portfolio questions | capture **1.00** (6/6), evaluation 5.0 `Apply`, packet coverage **1.00**; the form answer was a true grade-tracking project, but the old narrow field expectation rejected it | passed end to end |

What this says:

- The conversation **did capture the facts** in both built profiles: capture
  1.00, coverage 1.00, 5–6 facts, 6–7 turns, no unsupported updates.
- The bottleneck moved **downstream**: the model's packet questions blocked
  approval on role/employer questions. The seeded mechanical profile was blocked
  too, so this is not a profile-capture failure.
- The analyst built-form “failure” was a **benchmark false negative**: the answer
  described the grade-tracking dashboard, which is true and grounded, but the
  field expectation only accepted the three job-required facts. The field now
  accepts any persona fact; that live result should be rerun, not counted against
  the app.
- The minimal controls failed as intended, with lower evaluation scores and
  questions about missing facts.
- The profile-effect benchmark is therefore doing its job: it separates “the
  profile captured the material” from “the next stages used it,” and it shows
  where the next product fix belongs.

Evidence: `output/evaluation-antigravity-2026-11-10T16-40-32-844Z`.

## Extending it

1. Add the fictional persona/job/portal to `corpus.mjs` with explicit expected
   values and absent claims.
2. Add a scenario id and run it in controlled mode. It must pass before a live run
   can be interpreted.
3. Add a scoring assertion to `tests/test-bench-eval.mjs` only when it catches a
   plausible product failure (a leak, a false-ready, a fabricated claim, a wrong
   stop), not to pin incidental wording.
4. For a real provider, run `--provider` and compare against the controlled
   baseline. Do not edit the corpus to make a live run pass; record the failure.
