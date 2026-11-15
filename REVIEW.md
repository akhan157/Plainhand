# Independent scope review — 2026-11-15

Reviewer: root Codex `gpt-6.1-sol`, medium effort. Author: `claude-pool` / `claude-sonnet-5-5`, high effort. Reviewed author tip `93965287794589c9f05137ff34728e0b202dee97` against base `fb396422d49e3f76f4fed5beb710397950ffa973`. This is cross-family scope review, not product validation.

Disposition: **accepted scope with the corrections below applied by the reviewer**. No product acceptance row passes. The author did not self-accept.

Retained findings:

1. The author did not report Gate 1 before editing. This procedural miss is retained in RESULT.md; the scope was tightly bounded and no product source changed. No retroactive claim that the gate ran.
2. Combined `in_progress / not_run` values are invalid register states. Replaced by exact `not_run` rows and a machine-readable register.
3. Two different jobs may legitimately use the same experience. The falsifier now requires a pre-specified relevance contrast, not arbitrary difference.
4. Surface parity must honor intended consumers and action tiers; candidate-only actions must not become agent-callable. Added actual light/dark/mobile, keyboard and focus evidence to UI acceptance.
5. A single stochastic queue-quality difference is not proof of regression. Repeated paired evidence and a frozen bound are required.
6. Baseline must precede gap edits. Gap work now depends on immutable baseline evidence; final packet order is P5 baseline then P6 improvements, with baseline and candidate SHAs separately pinned.
7. Do not prescribe a deterministic elicitation checklist without design evidence. Mechanism selection returns to a design gate.
8. Integration order, already-authorized tracking work and technical threshold design are routine control-plane choices, not new owner blockers. Latest manual-kit/user-invoked extension scope governs review; no unattended-board automation is added.
9. Master record means organized source-backed evidence, not a new schema or allowing generated text to bootstrap truth.
10. The failed Go attempt was read-only review, not authorship, and returned no verdict. Corrected route description. No metered fallback was used.

Verified: full author diff read; thread recovery and git ancestry independently checked; whitespace and documentation/register consistency checks recorded in EVIDENCE.json. Existing historical files were not rewritten. Product tests, browsers, live models and branch integration of app changes were deliberately not run for this docs-only checkpoint.

## P2 inventory and diagnostic checkpoint — 2026-11-15

Independently reviewed author commit `b756eec9c564add3471bee8db574c916ef98769b` (Claude draft, Pi DeepSeek completion), merged by root as `de26e0a808056f074ec2f2c80cc5e2cd4b6011b1`. Accepted as a source map with reviewer corrections, never as product acceptance. The author did not self-accept. Root read both complete documents, checked the two-file diff, and examined import/context/answer-bank source.

Corrections retained: fictional probes do not close every U requirement; employer submission is prohibited, not an external completion gate; commercial/CAPTCHA access limits only that access tier; existing authorized provider calls are operationally quota-dependent; root cannot waive U09 queue persistence. Author-proposed row dispositions were not adopted wholesale.

Root direct synthetic `scorePacket` probes on source `e4da45f` found (1) unsupported candidate 28 accepted when posting mentions 28, rejected when that posting number is removed; (2) unsupported numeric heading omitted from checks; (3) 101 arbitrary bytes plus caller-supplied PDF header accepted by the scorer. These are injected scorer counterexamples, not model or real-PDF results. A direct `importWorkspace` probe in a fresh fictional temporary directory confirmed writingSamples, claimLine, standard, resumeFormat and settings all disappear. Temporary directory removed in finally. Raw outputs are ignored artifacts listed with hashes in EVIDENCE.json.

U02/U07/U12/U13 now in_progress on these diagnostics, remaining nine not_run; PASS 0. Tracking implementation `e538b6aafbd8a260958086b160de7129983a241d` has arrived but is not reviewed or integrated. No production source changed on goal branch in this checkpoint.
