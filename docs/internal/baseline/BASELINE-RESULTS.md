# Baseline results: live Codex, frozen tree `00ce1bf`

Date: 2026-11-15. Tree: `00ce1bfbffa4ec0edec6045f0caf3b0b5333384f`, `dirty: false`, and
`scripts/baseline-manifest.mjs --check` passed before the run. Provider under test:
Codex (`codex-cli 0.167.1`, the owner's ChatGPT subscription). Judge: Claude
(`claude 2.1.325`), **uncalibrated** because no human ratings exist. Model identity
is not recorded for either side. Plainhand runs Codex with `--ignore-user-config`, so
it used the CLI's default model and effort, and neither results.json nor judge.json
names a model. Family independence is therefore `familyProof: catalog-only`: the
providers differ, but the models are not proven. The cost figures below are for that
unrecorded Codex model. Tiers are `live-model` and `pdf`, on fictional people and an owned loopback
portal. No employer was contacted and nothing was submitted.

Raw evidence (git-ignored): `output/baseline-00ce1bf/` (paired and smoke directories,
logs, `judge.json` and `JUDGE.md` in each).

## Budget used

| Part | Runs or packets | Model calls |
|---|---|---|
| Paired (3 jobs × 3 modes × 3 repeats) | 27 | 189 |
| Smoke and held-out | 11 | 75 |
| Judge (1 claim + 3 rubric calls per packet) | 20 packets | 80 (computed, not counted) |
| **Total** | | **344 of the 900 cap** |

Wall time: paired 48 min, smoke 27 min, judge about 35 min. There were no quota stops.

## Cost per application (U14 starting figure)

| Kind of run | Runs | Calls | Input tokens | Output tokens | Seconds |
|---|---|---|---|---|---|
| Seeded profile, then evaluate, packet, form | 9 | 5 | 121k | 2.9k | 111 |
| Profile conversation, then the same | 9 | 11 | 280k | 3.1k | 137 |
| Minimal profile (control) | 9 | 5 | 116k | 1.5k | 71 |
| Tailored resume from approved master | 6 | 7 | 172k | 7.8k | 192 |
| Full journey (conversation to submit) | 2 | 15 | 374k | 5.9k | 211 |
| Evaluation only | 3 | 1 | 21k | 0.3k | 14 |

Values are means per run. Each call reports about 25k input tokens, roughly 20 to 90
times the output. That figure comes from Codex's own count. One Plainhand call is one
`codex exec`, which may add the CLI's own system prompt and internal turns, so this
baseline does not show how much of it is Plainhand's context. Measure the prompt
Plainhand sends before choosing a cost lever. The usage ledger parses Codex cached and
reasoning tokens, but the runner saves only calls, input and output, and the temporary
workspaces were deleted. Those fields were dropped by the harness, not missing from
Codex. Quota share is not measured.

## Results

Deterministic pass: paired 11/27 (9 expected minimal-control failures, 7
unexpected); smoke 5/11.

| Mode | fin | analyst | sci |
|---|---|---|---|
| seeded | 3/3 | 3/3 | 3/3 |
| conversation-built | 2/3 | 0/3 | 0/3 |
| minimal (control, expected fail) | 0/3 | 0/3 | 0/3 |

Held-out and borderline (single runs): old-role tailoring 3/6 deterministic pass
(fin-forecast, stem-ops, tech-reliability); borderline-swe and borderline-fin both
returned Investigate in band; holdout-mismatch, holdout-journey-stem and journey-sci
failed.

Judge, 20 packets. The subset was chosen after the deterministic results were known:
paired r1 and r2 of the built and seeded modes, and every smoke run except the
evaluation-only rows. **0 unsupported factual claims** (409 supported, 8 partial). Mean
scores out of 5: honesty 5.0 and 4.9, specificity 4.8 and 4.5, relevance 4.4 and 3.9,
voice 4.2 and 4.3, **cover letter 3.6 and 3.7**, **structure 3.5 and 3.4**, overall
4.0 and 4.0 (paired, then smoke). Samples agree closely (SD 0 to 0.47).

## Failure classification

Classification comes from the scored records. Where a check was confirmed further (layout coordinates, transcripts), that is said.

### Product findings (real)

1. **The profile conversation ends early.** All 11 live conversation transcripts
   follow the same pattern:
   - The conversation runs 4 to 6 turns, and the assistant asks a question in only
     2 to 4 of them.
   - The other turns say "I propose ..." without asking anything.
   - The scripted candidate replies "Yes, go ahead". The assistant then offers to
     rebuild the summary, and the conversation ends with 2 to 4 stories saved.

   The ending is joint. The fixture candidate (`profile-bench.mjs`) agrees once and
   then stops when it is not asked anything. A real user might go on talking. Still,
   Codex moves to summarizing after two to four stories instead of asking about the
   rest, and that is the product behaviour to fix. Capture is 1.0 of what was said,
   but coverage of all facts is 0.33 to 0.6. The pre-freeze pilot used 8 profile
   calls, so this varies between runs. Consequences:
   - analyst-built evaluated 3.7 Investigate (3/3), against 4.5 Apply when seeded;
   - sci-built missed the SOP fact (3/3);
   - holdout-journey-stem had 0 of 3 required facts.

   This is the largest gap between conversation and seeded results (U01, U02).
2. **Tailoring does not move the old relevant role up.** holdout-oldrole-fin-systems
   and stem-automation keep reverse-chronological order, so the facts the job needs
   come after recent ones (lead share 0.33). Coverage was 1.0 in both. A product
   decision is needed on whether "leads" means first in the resume or emphasis in the
   summary and cover letter (U04).
3. **Resume structure is the weakest judged dimension (about 3.4).** The judge
   repeatedly flagged:
   - one role split into several entries with the same heading;
   - education body text that repeats its heading;
   - weak summary lines.
4. **Cover letters are the second weakest (about 3.6).** They restate the resume, and
   some closing sentences are generic.
5. **journey-sci** also scored 4.2 and said Investigate on a job its seeded runs
   score Apply. It failed the Apply expectation for the same reason as finding 1
   (the SOP fact was never captured). **Its cover PDF lacked a sentence of the
   reviewed letter.** This is
   the only non-ordering PDF failure. It needs a reproduction to confirm whether it is
   a product rendering defect or a probe false positive.

### Measurement defects (scorer), found by the live run

6. **The PDF line-order probe probably gives false positives on repeated wording.**
   This is confirmed for fin-systems only. Its item coordinates show the flagged
   Skills line ("Balance sheet reconciliation; ...") last on the page and in order.
   The probe matches it to an earlier Experience bullet with the same words, so it
   reports the line out of order.
   - tech-ml and journey-sci fail the same named-line check on a Skills line that
     repeats an Experience bullet. That points to the same cause, but their
     coordinates were not checked.
   - sci-built-r1 and r2 fail a different check: the ATS reading-order ratio, with no
     named line. That is not classified yet.
7. **holdout-mismatch: an honest Skip with no matches fails.** Codex scored 0, said
   Skip, gave no matches, and named both missing requirements. The scorer requires at
   least one match with evidence, so a correct refusal fails `evidenceValid`.
8. **fin-built-r2 failed only on the profile gate** (coverage of all facts 0.6 < 0.66).
   Its packet, evaluation and application all passed. This is finding 1, not a
   separate defect.

If findings 6 and 7 are confirmed, the deterministic pass counts above understate the
product. Fixing them loosens existing gates after the results were seen, which the
design's non-negotiables forbid without an explicit decision. Requirements for a fix:
- A different-family author writes it, and an independent reviewer accepts it.
- The reordered-line PDF control and an Apply with no evidence must still fail.
- It is a new scorer version (a re-freeze).
- The held-out rows are now seen, so a later baseline needs fresh held-out fixtures. The saved packets and PDF
items can be re-scored offline with no model calls, and both versions must be
reported, never mixed.

## Review coverage of the frozen scorer

Two independent DeepSeek reviews checked `e016533` and `03db26c`. The frozen tree
also contains root's third round of edits, which no one reviewed. Those edits are the
reviewer's F1 and F3 patches as modified by root, plus root's own F2 and F4 to F6
fixes. They passed tests and the controlled gate only.

## What this baseline does not show

- It does not show real user voice, real candidate data, a real ATS or employer
  acceptance.
- Judge scores are uncalibrated.
- Three repeats show variance, not significance.
- Controlled passes on held-out rows were wiring only. These live numbers are the
  first measurement of them.
- Residual scorer limits are recorded in `EVIDENCE.json` under
  `prefreeze_fixtures.re_review`.
