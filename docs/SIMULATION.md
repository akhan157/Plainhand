# Simulated application corpus

A repeatable benchmark for the production browser path. Fictional candidates,
fictional portals, deterministic test agent — no employer, no model call, no
network write.

```bash
npm run benchmark:simulation                  # durable-hybrid, all cases
node benchmark-simulation.mjs --strategy contract-hybrid
node benchmark-simulation.mjs --case native-radio
```

Each run writes `output/simulation-<timestamp>/report.json` and `SUMMARY.md`.

## Latest result (21 October 2026)

| Metric | Value |
| :--- | ---: |
| Cases passed | **49/49** |
| False-ready outcomes | **0** |
| Automated submissions | **0** |
| Interruptions exercised | challenge, login, recoverable challenge |
| Duration | p50 0.8 s, p95 3.8 s |

Families covered: ordinary fields, reasoning answers, repeated records, native
radios, conditional fields, unknown required fact, discarded write, legal
attestation, challenge, pre-form challenge, recoverable challenge, login,
process restart, optional unknown question, eight-step long form, and implicit
retrieval from a 40-note source.

## What it proves

- Every case either reaches `review` with correct values or stops with the
  intended blocker (`needs-answers`, `challenge`, `login`).
- No case produces `falseReady`, and no submit control is ever activated.
- Restart recovery re-opens the saved step in a fresh browser.
- Optional questions never block; required unknown facts always do.
- Native radio groups are answered only when a matching option exists, and
  sensitive groups are skipped.

## What it cannot prove

- Employer-side acceptance, draft persistence, or upload completion — those
  need a real portal.
- The candidate's real voice: the test agent is deterministic, not a model.
- A real interruption rate: fixture challenges are synthetic.
- Score-band calibration: outcomes would have to be invented.

For those, the pipeline still needs one real role from a real profile. The
simulation measures the machine, not the job market.
