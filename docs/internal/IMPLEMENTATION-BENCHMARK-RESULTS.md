# Plainhand implementation comparison — 18 October 2026

> **Decision update, 19 October:** Retain current production architecture. These
> tuned prototype results do not justify wholesale migration. Fresh production-path
> diagnostics and adoption gates are in the [incremental validation plan](INCREMENTAL-VALIDATION-PLAN.md).
> [Subsequent isolated comparisons](INCREMENTAL-VALIDATION-RESULTS.md) support narrow
> improvements but expose additional readiness/recovery gaps; no replacement was promoted.
> The original experiment and recommendation below remain historical evidence.

## Recommendation

Build toward a **form-first, per-application actor** with explicit states for missing required input, factual review, browser execution, recovery and final human review. Give it source-backed, versioned answer memory and semantic control adapters; verify actual browser values before advancing. Keep candidate sources available by default. This is the best architecture supported by this comparison, rather than a proven universal auto-applier.

The prototypes are isolated under `plainhand/benchmarks/`. They have **not replaced the production workflow**. The actor scheduling prototype demonstrates short claims/commits outside the global workspace lock; mounting a durable production worker, cancellation and full process recovery remain implementation work.

## Candidates and controlled results

Eight candidates were investigated. Four were specified before testing; four additions followed concrete failures: a readiness-gated form-first baseline, native-choice semantic hybrid, stronger contract hybrid, and typed-state actor. Added candidates are tuning work, not a preregistered independent contest.

The consistent six-candidate base matrix used 14 scenarios across engineering, operations and returning-to-work profiles. Candidate correctness is independent of graduation status.

| Candidate | Correct outcomes / 42 | Correct ready / 27 eligible | False ready |
| --- | --- | --- | --- |
| Packet first | 30 | 15 | 3 |
| Form first | 30 | 15 | 3 |
| Readiness-gated form first | 30 | 15 | 0 |
| Durable hybrid | 39 | 24 | 0 |
| Focused context hybrid | 39 | 24 | 0 |
| Semantic controls hybrid | 42 | 27 | 0 |

`Base matrix`.

The final typed actor passed **48/48 controlled outcomes**, including all 42 base scenarios plus optional unknowns and eight-page forms. It correctly completed all 33 eligible cases, with zero false-ready outcomes or submissions. `Final matrix`.

These are deterministic-agent browser tests, not 48 successful real applications. Scenarios cover repeated records, native radio/select choices, conditional fields, discarded writes, unknown facts, legal choices, login/challenge stops, a mock recoverable challenge, browser restart, optional questions and long forms. Login/challenge/missing-required states can be correct outcomes without being completed applications.

## Real CLI reasoning

The primary paired comparison used the same four fictional tasks per provider, with rotated candidate ordering:

| Provider | Packet first | Form first | Model calls | Reported input tokens | Aggregate wall time |
| --- | --- | --- | --- | --- | --- |
| Codex | 4/4 correct | 4/4 correct | 12 → 8 | 203,816 → 132,688 | 102s → 78s |
| Claude | 3/4 correct | 3/4 correct | 18 → 12 | 96,610 → incomplete | 191s → 149s |

Form first used one-third fewer calls in both samples. Claude's form-first failure had four calls whose usage was not retained by the initial error path: its 44,077 reported input tokens cover only eight of twelve calls. Do not present that as a complete token reduction. Claude failures included unnecessary clarification and review blockage. A later original-prompt retry succeeded, demonstrating variability; it does not erase the original failure.

`Claude paired evidence`, `Codex paired evidence`.

The typed actor's first validation passed four outcomes per provider: two grounded achievement tasks and two appropriately stopped missing-date tasks. Each missing-date task needed **one model call**, versus three or four in earlier approaches. Claude needed a correction on one achievement, so normal preparation is not guaranteed to take only two calls. Additional final native-choice, repeated-record and optional-question validation passed all three tasks per provider. Together, final typed-actor real-model validation passed **14/14 outcomes**: ten ready for review and four correct missing-fact stops, with zero submissions. These are small validation samples after tuning, not unseen population estimates.

## Architectural findings

- **State design matters more than another prompt.** Codex's contract-only variant repeatedly treated a genuinely unavailable required date as a factual drafting failure. A typed `needs-input` result identifies the required field before spending calls reviewing an impossible draft.
- **Observe before drafting.** Drafting against actual labels/options lets reviewed answers be reused rather than regenerated after preparing generic documents.
- **Use narrow semantic execution and readback.** Native radio fields were omitted by the existing text-field path. A readiness gate prevented false completion but did not fill them; the native-choice adapter did. Mechanical recovery handles a dropped first write without asking the person again.
- **Do not deploy naive keyword context pruning.** In source-rich tests, both providers lost an existing SQLite fact when lexical retrieval omitted a paragraph. Claude looped through review; Codex asked an unnecessary question. Full-context variants answered it. This is a counterexample, not evidence that all retrieval methods fail.
- **Release the workspace lock during long work.** An actual production HTTP browser route blocked an unrelated edit for 285ms during an injected 250ms gate. The detached actor prototype allowed the edit in 11ms and rejected duplicate claims/stale commits. This is a controlled scheduling experiment, not a load test. `Invariants`.
- **Review needs semantic evaluation.** Both providers correctly handled four seeded review probes: accepted supported paraphrase; rejected wrong numbers, invented leadership and cover-letter-only inventions despite otherwise valid source quotes. Eight probes do not establish general hallucination prevention.

## Methodology corrections and limits

All runs use fictional profiles and local employer forms, actual headless Chromium readback, and no employer submissions. Live means real CLI inference, not live employer completion. Common PDF rendering is stubbed to isolate orchestration; PDF/UI/API behavior is covered separately by the normal app suite. Voice scoring is only a first-person/project/length proxy, not a blind human assessment of personal voice.

Initial diagnostics exposed missing fixture timestamps, a PDF digest mismatch and an oracle identity-label mismatch. Those were harness defects, retained as diagnostics and excluded from headline results. Early legal-choice grading also incorrectly penalized an intentional human attestation stop; the consistent base/final matrices use the corrected rule. One Codex free-text answer was incorrectly rejected for not equaling the single word `SQLite`; its complete supported sentence is correct. Original files remain untouched; `independent correction` records the old/new judgment.

The restart scenario closes/reopens the browser and reloads versioned memory; it does **not** kill/restart the entire Node process. Some bindings remain in memory. Answer memory is conservative and job-scoped, not yet a complete cross-job candidate brain. Native-choice support is not universal custom-control or shadow-DOM support. The challenge fixture proves resolver placement only: real CAPTCHA acceptance, broad ATS coverage and 90% autonomous completion remain unmeasured. Antigravity was not live-benchmarked here. Models, CLI defaults and cache state affect results; Codex did not report a model ID, so none is inferred.

## Evidence and reproduction

- Final typed actor: `output/architecture-live-2026-10-18T21-19-00-488Z` (Claude), `output/architecture-live-2026-10-18T21-19-03-866Z` (Codex).
- Final control validation: `output/architecture-live-2026-10-18T21-24-07-843Z` (Claude), `output/architecture-live-2026-10-18T21-23-14-331Z` (Codex).
- Retrieval: `output/architecture-live-2026-10-18T21-11-17-741Z` (Claude), `output/architecture-live-2026-10-18T21-11-21-413Z` (Codex).
- Semantic review: `output/architecture-review-claude-2026-10-18T21-23-11-562Z`, `output/architecture-review-codex-2026-10-18T21-13-39-899Z`.
- `Full app regression suite` passed, including browser workflows, UI themes, repository/Go checks and dependency audit.
- `Real CLI consumption ledger` includes pilot, tuning, failures and review probes, with reporting coverage. CLI USD is a provider reference estimate, not a subscription charge; token counts cannot establish subscription quota remaining. Cached tokens are subsets of inclusive input, not additional input.

Run controlled comparisons with `npm run benchmark:architecture -- --profiles engineering,operations,returning`. Real CLI usage is opt-in: add `--live --provider codex` or `claude`; restrict cases/strategies to control consumption. Run `npm run benchmark:invariants`, `npm run benchmark:review -- --provider claude`, and `node run-test-suite.mjs` separately. Benchmark process exit zero means results were recorded, not that every candidate passed.

Total real benchmark consumption, including pilots, tuning and eight review probes: claude: 81 calls, 464,982 reported input tokens (77/81 calls covered), 72,555 reported output tokens; codex: 61 calls, 1,049,747 reported input tokens (61/61 calls covered), 18,923 reported output tokens. Claude reference USD is $4.78 for covered calls; Codex did not report USD. These are experiment totals, not per-application expectations.
