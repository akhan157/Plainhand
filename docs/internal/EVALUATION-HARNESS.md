# End-to-end evaluation harness

**Status:** controlled harness, 9 November 2026
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
npm run benchmark:eval -- --concurrency 2                # parallel scenarios
npm run benchmark:eval -- --repeat 3                     # variance across repeats
npm run benchmark:eval -- --baseline output/evaluation-controlled-...  # delta
npm run benchmark:eval:live                              # real Claude CLI, opt-in
node benchmarks/benchmark-eval.mjs --provider codex      # another provider
```

Evidence is written to `output/evaluation-<tier>-<timestamp>/`:
`results.json`, `SUMMARY.md`, and one JSON file per scenario. `npm run
benchmark:status` now lists the latest run.

Use `--retain` to keep each scenario's temporary workspace; otherwise it is
deleted after the result is recorded.

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
| Journey | 1 | profile conversation → understanding → standard → evaluation → packet → portal → candidate confirmation |
| **Total** | **24** | |

Add a scenario by adding a persona, job or portal to `corpus.mjs` and one entry
to `scenarios`. A scorer must be able to name the expected value for every field;
`expect` records that decision.

## Evidence tiers

| Run | What it establishes | What it does not |
| --- | --- | --- |
| Controlled (`benchmark:eval`) | The harness, workflow, production browser path, submit guard and sandbox validation work together and the scoring detects planted failures | Model quality, real voice, employer acceptance |
| Live (`--provider`) | How one real provider performs on fictional material end to end | Real employer acceptance, human voice judgment, a guarantee for other providers |

A controlled run is not a product-quality score. It is the regression gate that
must stay green before a live run means anything.

## Current controlled result (9 November 2026)

`node benchmarks/benchmark-eval.mjs --concurrency 2`: **24/24 scenarios passed**
in about 84 seconds on this laptop. All families passed: 3/3 profile, 6/6 resume,
11/11 application, 2/2 submission, 1/1 evaluation and 1/1 journey.

- Profile capture was **1.00** across 4 runs (3 profile scenarios plus the journey
  conversation): 0 unsupported updates, 0 absent claims saved, 0 failed turns and
  every turn asked one question; `onTopicQuestions` is now recorded from the
  candidate's answer instead of always reading 0.
- All **20** resume/packet runs covered their required facts (**fact coverage
  1.00**), passed the factual review and calibration, used first person, and had
  0 unsupported numbers, 0 absent claims and 0 banned words. ATS coverage
  averaged 0.74.
- All **11** candidate-confirmed submissions were accepted by the loopback
  sandbox with matching approved resume hashes (and the cover-letter hash where a
  cover letter was attached); tracker status became `Applied` with `submittedAt`.
  Application completion was **1.00** across **11** fill runs, with 0 false-ready,
  0 sensitive auto-fills and 0 invented unknown answers.
- All **21** evaluations passed the new scorer: valid score, expected
  recommendation, correct band, evidence for every match, and a below-4/5 role
  refused `prepare` without an override.
- The three stop scenarios stopped correctly (`needs-answers`, `challenge`,
  `login`). The discard-once portal detected the first-pass loss and recovered on
  retry. The records portal filled both employment fieldsets and the native radio
  portal filled the degree group.
- `journey-mech` passed the connected path: profile pass, understanding approved,
  standard approved, evaluation pass, packet pass and application pass in one
  workspace.

This proves the harness, not model quality. The first live run is the next step.

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
