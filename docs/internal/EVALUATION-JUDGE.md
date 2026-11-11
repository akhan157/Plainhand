# Evaluation judge

The evaluation harness (`EVALUATION-HARNESS.md`) scores a prepared packet with
deterministic checks. A required fact counts as covered when 60% of its content
words reappear in the packet, keywords are matched literally, and numbers are
checked against the sources. Those checks are cheap and repeatable. They also
reward copying source sentences and penalise accurate rewording, and they say
nothing about whether the resume and cover letter are well written, relevant to
the job, or free of invented claims that are phrased in new words.

The judge adds a model-graded layer for those questions. It runs after an
evaluation run and reads that run's evidence directory. It is opt-in, it makes
real model calls, and it never changes the harness's pass/fail result.

Files:

- `plainhand/evaluation/claims.mjs`: claim splitting and claim-level fact checking.
- `plainhand/evaluation/judge.mjs`: the rubric, rubric grading, the live judge, and the run summary.
- `benchmarks/benchmark-judge.mjs`: the command-line runner and calibration.
- `tests/test-eval-judge.mjs`: tests that use fake judges only.

## What it measures

### Claims

`extractClaims(packet)` splits the packet into atomic claims without a model. It
takes the headline, each distinct resume heading (title, employer, location,
dates), each sentence of each resume entry, each sentence of each answer, and
each sentence of the cover letter. Salutations, sign-offs and the closing name
line are dropped. Splitting is line by line, then on terminal punctuation
followed by a capital letter or digit, and never after a known abbreviation such
as `B.S.` or `Dr.`.

`checkClaims` sends every claim to the judge in one call, together with the
candidate's sources and the job posting (source id `job-posting`). For each
claim the judge returns one of these verdicts:

- `supported`: a source states the claim at the same strength.
- `partially_supported`: a source backs part of it, but a detail is missing or
  stronger than the source (for example "led" where the source says
  "coordinated").
- `unsupported`: no source backs it, or a source contradicts it.
- `not_a_factual_claim`: motivation, intent, opinion or courtesy.

Statements about the employer or the role count as supported when the posting
says them. The posting never supports a claim about the candidate.

For `supported` and `partially_supported`, the judge must quote the source. The
code checks that quote: it must be at least 8 characters and appear in a source.
Matching is literal after collapsing whitespace and unifying typographic quotes
and dashes. If the quote is found under a different source id, the verdict
stands and the source id is corrected. If the quote is not found anywhere, the
verdict becomes `unsupported` and the claim is marked `downgraded`. Claims the
judge does not return are counted as `unjudged`, not as supported.

The same call checks semantic coverage of the job's required facts
(`job.requiredFactIds` in `corpus.mjs`). The judge says whether the packet
conveys each fact, with paraphrase allowed, and quotes the packet sentence that
does. A fact counts as covered only when the judge says it is conveyed and the
quoted sentence exists in the packet.

Per packet the result reports:

- counts for each verdict.
- `unsupportedRate`: unsupported divided by supported, partial and unsupported claims together.
- the number of downgraded verdicts.
- the unsupported claims with the judge's reason.
- `factCoverageSemantic`.
- `factCoverageOverlap`: the existing word-overlap rule, for comparison.

### Rubric

`gradePacket` asks the judge for a 1 to 5 score on six dimensions. Each dimension
has written anchors for 1, 3 and 5; scores of 2 and 4 fall between them.

| Dimension | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Relevance to this job (`relevance`) | Generic; misses the job's central requirements even where the sources match them. | Relevant experience present but mixed with weak or generic lines, or buried. | Leads with the experience that matches the central requirements; nearly every line serves this job; job vocabulary only where the work involved it. |
| Specificity and evidence (`specificity`) | Mostly vague duties or stock phrases. | Mix of concrete and vague lines; some results or numbers from the sources left out. | Concrete work, tools, scope and results, with the numbers the sources contain. |
| Structure and ordering (`structure`) | Disorganised, misfiled, repeated, or missing core sections. | Readable, with ordering problems, split or duplicated entries, or uneven bullets. | Conventional sections in a sensible order for the level, entries under correct headings, one idea per line; the letter has an opening, evidence and close. |
| Voice match (`voice`) | Another voice: marketing tone, wrong person, or several banned words. | Mostly neutral template tone; occasional stock phrasing or one banned word. | Matches the stated voice in sentence length, formality and person; no banned word. |
| Cover letter effectiveness (`cover`) | Boilerplate, wrong company or role, placeholders, or enthusiasm without evidence. | Correct but generic, restates the resume, weak link to the job, or long. | Names the company and role, ties two or three specific true experiences to the job, short, plain close; nothing reusable unchanged elsewhere. |
| Honesty and calibration (`honesty`) | Invented experience, numbers, titles or skills, or claims the sources contradict. | Mostly supported, with one or two stretched claims or a clear undersell. | Every claim matches its evidence: nothing stretched, nothing invented, gaps not papered over, results not undersold. |

The full anchor text is `RUBRIC` in `judge.mjs`. The voice dimension uses
`persona.profile.voice` and `persona.voice.banned`. The cover dimension is
recorded as not applicable when the packet has no cover letter.

For each dimension the judge returns a score, a quoted packet excerpt that
justifies it, and a one-sentence reason. The excerpt is checked against the
packet text. An excerpt that is not found is flagged (`unverifiedExcerpts`); the
score is kept so the flag can be reviewed. The judge also returns an `overall`
score and up to three concrete improvements.

With `samples` greater than 1, the rubric call is repeated and each dimension
reports its mean, minimum, maximum and population standard deviation. A failed
sample is recorded and the rest still count.

The instructions (`CLAIMS_INSTRUCTION`, `RUBRIC_INSTRUCTION`) tell the judge
that it is grading another system's output, that it must not reward length, and
that it must penalise unsupported claims. The app's standard agent preamble
(`AGENT_PREAMBLE` in `plainhand/agents.mjs`) is prepended by `executeAgent`, as
for every other provider call.

## What it does not measure

- A model's judgement is not a human's. The scores are measurements from one
  model with one prompt. Until they have been compared with human ratings, treat
  them as uncalibrated and use them only to compare runs graded by the same judge
  and prompt.
- Before trusting the numbers, have a person rate 20 to 30 packets with the same
  rubric and run the calibration below. If agreement on a dimension is poor,
  report that dimension as unreliable rather than tuning the prompt until the
  numbers look right.
- Models tend to rate text written by themselves more favourably. Use a judge
  provider that differs from the provider under test where possible. The runner
  warns and records `selfJudged: true` when they are the same.
- The judge sees only the packet, the sources and the job. It does not know
  whether an employer would respond, and it is not an applicant-tracking system.
- Verified quotes prove that the quoted words exist in a source, not that they
  support the claim. A judge can still pair a real quote with a claim it does not
  back, so read the unsupported and partial lists, not only the rates.
- Claim splitting is sentence-level. A sentence holding two facts is one claim,
  and a judge may mark it partial for either of them.
- Judge results do not feed the harness's pass/fail. They are a separate report.

## Running it

The evidence directory must contain each scenario's raw packet and sources.
`scoreScenario` replaces `result.packet` with the score object, so the raw text
is not in the scenario JSON. The judge looks, in order, for:

1. `<dir>/<scenarioId>.packet.json` containing `{ "packet": ..., "sources": [...] }`;
2. a top-level `packetRaw` field, or a `raw` field, of the same shape in `<dir>/<scenarioId>.json`.

`packet` is the app's prepared packet (`headline`, `resume[]`, `coverLetter`,
`answers[]`). `sources` is the `[{ id, text }]` list from
`workspace.context(...)` at packet time. Persona and job come from
`scenario.persona` and `scenario.job` in `corpus.mjs`. Scenarios that have a
packet score but no raw packet are listed as skipped. If no scenario has a raw
packet, the runner refuses, explains which fields are missing, and writes
nothing.

```sh
# Grade every scenario with a raw packet, using codex as the judge.
node benchmarks/benchmark-judge.mjs --evidence output/evaluation-claude-<timestamp> --judge codex

# Three rubric samples per packet, two scenarios, 10-minute call timeout.
node benchmarks/benchmark-judge.mjs --evidence <dir> --judge codex --samples 3 --scenarios mech-resume,swe-resume --timeout 600
```

Without `--judge`, the runner refuses and grades nothing. Each packet costs one
claim call plus one rubric call per sample. Calls run one after another. The run
writes:

- `<dir>/judge.json`: settings, the rubric, a run summary (`summarizeJudgements`)
  and every per-scenario result.
- `<dir>/JUDGE.md`: a per-scenario table (claim verdict counts, unsupported rate,
  semantic and word-overlap fact coverage, each dimension, overall), followed by
  unsupported claims, improvements, unverified quotes, judge failures and skipped
  scenarios.

## Calibration

```sh
# 1. Write empty ratings for every judgeable scenario: six dimensions plus overall.
node benchmarks/benchmark-judge.mjs --evidence <dir> --calibration-template
#    -> <dir>/human-ratings.template.json  [{ scenarioId, dimension, score: null, note }]

# 2. A person fills in each score from 1 to 5 using the anchors above, without
#    looking at judge.json, and saves the file under a new name.

# 3. Compare the ratings with the judge.
node benchmarks/benchmark-judge.mjs --evidence <dir> --calibrate ratings.json
```

For each dimension and for all dimensions together, calibration reports:

- the number of rated pairs.
- the mean absolute difference between the human score and the judge's mean score.
- exact agreement: the judge's mean, rounded to the nearest integer, equals the human score.
- within-one agreement: the rounded mean is at most one point from the human score.

Ratings left `null` are counted as unrated. Ratings for a scenario or dimension
that the judge did not score are listed as unmatched. The result is printed and
written to `<dir>/calibration.json`.

Rate a spread of packets, including weak ones, so that agreement is not measured
only at the top of the scale. Ratings from two people on the same packets also
show how much humans disagree with each other, which bounds how much agreement
to expect from the judge.

## Using the results in the main report

`summarizeJudgements(results)` in `judge.mjs` returns:

- pooled claim counts and `unsupportedRate`.
- downgraded quotes.
- mean semantic and word-overlap fact coverage.
- the mean of each dimension and of overall.
- the number of unverified excerpts.

The harness report can read `<dir>/judge.json`, when present, and show this
summary next to the deterministic resume metrics, labelled with the judge
provider and calibration status. Keep it out of `pass`.
