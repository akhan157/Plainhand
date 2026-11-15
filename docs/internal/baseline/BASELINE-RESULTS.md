# Baseline results: live Codex, frozen tree `00ce1bf`

Date: 2026-11-15. Tree: `00ce1bfbffa4ec0edec6045f0caf3b0b5333384f`, `dirty: false`, and
`scripts/baseline-manifest.mjs --check` passed before the run. Provider under test:
Codex (`codex-cli 0.167.1`, the owner's ChatGPT subscription). Judge: Claude
(`claude 2.1.325`), a different family, and **uncalibrated** because no human ratings
exist. Tiers are `live-model` and `pdf`, on fictional people and an owned loopback
portal. No employer was contacted and nothing was submitted.

Raw evidence (git-ignored): `output/baseline-00ce1bf/` (paired and smoke directories,
logs, `judge.json` and `JUDGE.md` in each).

## Budget used

| Part | Runs or packets | Model calls |
|---|---|---|
| Paired (3 jobs × 3 modes × 3 repeats) | 27 | 189 |
| Smoke and held-out | 11 | 75 |
| Judge (1 claim + 3 rubric calls per packet) | 20 packets | 80 |
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

Values are means per run. Each call sends about 25k input tokens, and input is roughly
20 to 90 times the output, so the size of the context sent with every call drives the
cost. Codex cached-input and reasoning tokens arrive `null`, so the true share of
subscription quota is not measured yet.

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

Judge, 20 packets: **0 unsupported factual claims** (409 supported, 8 partial). Mean
scores out of 5: honesty 5.0 and 4.9, specificity 4.8 and 4.5, relevance 4.4 and 3.9,
voice 4.2 and 4.3, **cover letter 3.6 and 3.7**, **structure 3.5 and 3.4**, overall
4.0 and 4.0 (paired, then smoke). Samples agree closely (SD 0 to 0.47).

## Failure classification

Each failure was read from its scored record before it was classified.

### Product findings (real)

1. **The profile conversation stops after two stories.** In the live holdout journey,
   the assistant saved two stories, offered to rebuild the summary, and the
   conversation ended after 4 turns with 2 of 6 facts captured. The same pattern
   shows in every conversation-built run: capture 1.0 of what was said, but coverage
   of all facts 0.33 to 0.6. Consequences:
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
5. **journey-sci: the cover PDF lacked a sentence of the reviewed letter.** This is
   the only non-ordering PDF failure. It needs a reproduction to confirm whether it is
   a product rendering defect or a probe false positive.

### Measurement defects (scorer), found by the live run

6. **The PDF line-order probe gives false positives on repeated wording.** Several
   runs failed on PDFs whose page layout is in order: fin-systems, tech-ml,
   journey-sci and the sci-built runs. The probe anchors a short Skills line ("Balance
   sheet reconciliation; ...") to the first place its words occur, which is an earlier
   Experience bullet with the same words, so it reports the line out of order. The
   item coordinates show correct top-to-bottom order.
7. **holdout-mismatch: an honest Skip with no matches fails.** Codex scored 0, said
   Skip, gave no matches, and named both missing requirements. The scorer requires at
   least one match with evidence, so a correct refusal fails `evidenceValid`.
8. **fin-built-r2 failed only on the profile gate** (coverage of all facts 0.6 < 0.66).
   Its packet, evaluation and application all passed. This is finding 1, not a
   separate defect.

Findings 6 and 7 mean the deterministic pass counts above understate the product. A
corrected scorer is a new scorer version (a re-freeze). The saved packets and PDF
items can be re-scored offline with no model calls, and both versions must be
reported, never mixed.

## What this baseline does not show

- It does not show real user voice, real candidate data, a real ATS or employer
  acceptance.
- Judge scores are uncalibrated.
- Three repeats show variance, not significance.
- Controlled passes on held-out rows were wiring only. These live numbers are the
  first measurement of them.
- Residual scorer limits are recorded in `EVIDENCE.json` under
  `prefreeze_fixtures.re_review`.
