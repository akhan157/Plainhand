# Adjacent-work inventory (U12)

What already exists for the four adjacent capabilities the register names, with the
files, registry actions, screens and tests that carry them. "Declared" means a
`test(...)` exists; this lane's suite result for those files is in
[RESULT.md](RESULT.md) under the `test:plainhand` gate. Read-only review: no source
change was made for this document.

Registry rows come from the generated [reachability matrix](REACHABILITY.md); tier
rules are the ones enforced in `registry.run` (candidate actions only from the
screen, agent writes and tasks need confirmation, MCP cannot run tasks).

## 1. Fit (evaluation)

| What | Where |
| --- | --- |
| Producer | `plainhand/workflow.mjs` (evaluate task), `plainhand/evaluation/{agent,claims,score,judge}.mjs` (harness prompts and scoring), `plainhand/posting-integrity.mjs` (posting check), `plainhand/jobs.mjs` |
| Actions | `tasks.evaluate` (task, agent needs confirmation, MCP refused), `jobs.get` (read, includes the evaluation), `jobs.list`, `workspace.digest` |
| Screen | `plainhand/web/ui/jobs.mjs` (list with score and stage), `plainhand/web/ui/jobpanel.mjs` `FitTab` (score, matches with evidence, gaps, questions, posting check, context form, override reason below 4/5) |
| Stored | `job.evaluation`, `job.contextHash`, `job.verification`, `job.calibration`, `job.atsCheck` |
| Tests (declared) | `tests/test-bench-eval.mjs` (evaluation scoring, borderline job guard, sandbox ground truth), `tests/test-eval-numeric-grounding.mjs`, `tests/test-eval-judge.mjs`, `tests/test-feature-insights.mjs` (outcomes built on scores), core `tests/test-plainhand.mjs` |
| Gaps | Model quality is measured only by the controlled harness and a partial live subset (`docs/VERIFICATION-MATRIX.md`); no live model run in this lane |

## 2. Discovery (sources, scans, campaigns)

| What | Where |
| --- | --- |
| Producer | `plainhand/workflow.mjs` (discover task), `plainhand/jobs.mjs` + `providers/*.mjs` (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, local parser), `plainhand/features/campaigns.mjs` (scheduled scans), legacy CLI `lib/scan.mjs` |
| Actions | `tasks.discover` (task), `campaigns.run` (task), `campaigns.*` (read/write), `sources.add` / `sources.remove` (write) |
| Screen | `plainhand/web/ui/jobs.mjs` ("Check sources", add-source dialog), `plainhand/web/ui/campaigns.mjs` (criteria, schedule, pause, run now, health, surfaced roles with reason), briefing items on Home |
| CLI | `npm run scan` (`lib/scan.mjs`), `npm run scan:campaign` (`lib/scan-campaign.mjs`), `npm run liveness` — the career-ops path, separate from the app's discovery |
| Tests (declared) | `tests/test-feature-campaigns.mjs` (12 checks: schedule, catch-up once, liveness, dedup and repost, reasons, source failure isolation, daily limit, confirmation, briefing, notifications), `tests/test-scan-runner.mjs`, `tests/test-scan-state.mjs`, `tests/test-actions.mjs` (sources) |
| Gaps | Discovery against real boards needs the candidate's sources and network; the controlled harness uses synthetic boards |

## 3. Interview prep

| What | Where |
| --- | --- |
| Producer | `plainhand/features/interview-prep.mjs` (task handlers and prompts), `plainhand/workflow.mjs` queue, interview rounds from `record.addInterview` |
| Actions | `interviewPrep.packs` (read), `interviewPrep.start` (task), `interviewPrep.practice` (task) |
| Screen | `plainhand/web/ui/interview-prep.mjs` inside the application Record tab (`jobpanel.mjs` renders `InterviewPrep`); rounds are added and edited in the same tab |
| Stored | `job.interviewPrep[roundId]` with a stale flag against the packet and posting |
| Legacy | `modes/interview-prep.md` (career-ops CLI mode), not the app path |
| Tests (declared) | `tests/test-feature-interview-prep.mjs` (11 checks: cleaned provider input, exact quotes and recap, rejected unsupported evidence/links, humanizer pass, grounded practice feedback, stored history, refusals without a packet or for a canceled round, agent proposal and stale flag, attention routing, packet-change races) |
| Gaps | Live model quality of packs and practice feedback is not measured; no live run here |

## 4. Email status suggestions

| What | Where |
| --- | --- |
| Producer | `plainhand/features/inbox.mjs` (deterministic rules, application matching, proposals; optional provider pass bounded by exact quotes) |
| Actions | `inbox.list` (read), `inbox.add` / `inbox.assign` / `inbox.dismiss` (write), `inbox.apply` (candidate only) |
| Screen | `plainhand/web/ui/inbox.mjs` under Applications ("Emails about your applications"): paste an email, match or dismiss, per-proposal quote, Approve/Dismiss; the same proposals appear as attention items |
| Stored | `state.inbox` with the quote for every proposal; applied changes go through the usual status, record and tracker actions |
| Tests (declared) | `tests/test-feature-inbox.mjs` (12 checks: rules and guards, deterministic match without a provider call, unmatched and ambiguous emails never guessed, rejection/interview/assessment/offer proposals, offer never proposes accept/decline, conflicting signals flagged, injected instructions never reach the provider, exact-quote requirement and bounds, candidate-only apply) |
| Gaps | Only pasted or externally supplied emails; no mailbox connection (by design) |

## 5. Learning plan (skill gaps)

| What | Where |
| --- | --- |
| Producer | `plainhand/features/skill-plan.mjs` (grouping and ranking gaps from evaluations, plan task) |
| Actions | `skillPlan.get` (read), `skillPlan.build` (task) |
| Screen | `plainhand/web/ui/skill-plan.mjs`, rendered as `SkillGaps` on Insights |
| Stored | `state.skillPlan` with a stale flag when evaluations change; never writes the profile |
| Tests (declared) | `tests/test-feature-skill-plan.mjs` (6 checks: grouping and ranking towards chosen/applied roles, cleaned provider input, top-five default and picked gaps, rejected links and invented ids, adjacent quotes exact, plan never changes the profile, stale after an evaluation, briefing once) |
| Gaps | Plan quality (project suggestions, estimates) is not measured against a human; no live run here |

## Cross-cutting notes

- **One surface per file, one owner per surface.** None of these features edits the
  registry core: each plugs in through `plainhand/features/index.mjs` (`register`,
  `tasks`, `attention`, `start`), so `plainhand/actions.mjs` stays the single action
  registry.
- **Unsupported interfaces are explicit.** All five are absent from the hosted
  connector's task execution and from MCP tools when the action is a task; the
  reachability matrix names each.
- **The legacy CLI is separate.** `npm run scan`, `lib/scan.mjs`, `modes/interview-prep.md`
  and the batch runner are career-ops scripts; they do not share the app's registry,
  tiers or approvals. Treating a green legacy script as evidence for the app feature
  would be wrong.
- **Tests are the only in-repo evidence.** The docstrings above are declarations; the
  current pass counts come from the suite gates in RESULT.md.
