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
| Profile building | Facts captured in the candidate's words, unsupported profile updates, invented or absent claims, one-question turns, calls, time |
| Resume building | Required facts covered, unsupported numbers, claims the candidate said they lack, banned voice phrases, ATS term coverage, factual review, real PDF |
| Application filling | Expected values in the actual DOM, completion rate, required fields, sensitive fields never auto-filled, unknown facts blocking correctly, resume upload, false-ready |
| Submission | A candidate-confirmed payload accepted by the owned sandbox, server-side validation, exact approved PDF hash, receipt |

Everything is scored against `plainhand/evaluation/corpus.mjs`; a model is never
asked whether it did well.

## How to run

```bash
npm run benchmark:eval                                   # deterministic, ~30 s
npm run benchmark:eval -- --scenarios mech-lever         # one scenario
npm run benchmark:eval -- --concurrency 2                # parallel scenarios
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

`plainhand/evaluation/portals.mjs` renders seven portal shapes: one-page Lever,
two-step Greenhouse, Ashby with a cover-letter upload, a conditional question, a
sensitive-heavy form, an unknown required fact, a CAPTCHA wall and a Workday-style
sign-in wall.

`ApplicationBrowser` opens them through a Playwright route for
`https://jobs.lever.co/synthetic/<scenario>`. The production inspection, fill,
readback and submit guard all run unchanged. Non-GET requests are aborted; the app
never presses a submit control.

After the app has filled and stopped at review, the harness acts as the candidate:
it supplies only the fields reserved for the person (work authorization, legal
attestation, salary) and POSTs the extracted values and the approved PDF hash to
`plainhand/evaluation/sandbox.mjs` on loopback. The sandbox validates required
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
| Application | 8 | single-step, two-step, conditional, sensitive-heavy, unknown fact, CAPTCHA, sign-in wall |
| Submission | 2 | candidate-confirmed submission through one-step and two-step portals |

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

`npm run benchmark:eval -- --concurrency 2`: **19/19 scenarios passed**, 0
false-ready, 0 sensitive fields auto-filled, 2/2 candidate-confirmed submissions
accepted, all six resume packets covered their required facts with no unsupported
numbers and no absent claims, and real Chromium PDFs were generated. Runtime
about 32 seconds on this laptop.

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
