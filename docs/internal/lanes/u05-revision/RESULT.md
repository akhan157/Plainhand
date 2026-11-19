# Lane result: U05 — voice and conversational revision

Status: **implemented on this lane; awaiting root review.** This author does not
accept its own work. It did not edit `GOAL-HANDOFF.md`, `EVIDENCE.json`,
`docs/internal/GOAL-ACCEPTANCE.json`, any `REVIEW.md`, or
`docs/internal/baseline/*`; it did not edit scoring or measurement files, push,
merge or deploy. The root reviewer reads the diff and runs the synthetic voice
contrast under budget.

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Branch | `t3/voice-revision-pipeline` |
| Dispatch HEAD | `e772525e3dde84772544e7a481f93e6358b938a0` (clean at start) |
| Author | implementation sub-agent, DeepSeek Flash |
| Reviewer | root, different model family |
| TMPDIR | `~/.cache/plainhand-eval-tmp` (outside the repository; no tracked file depends on it) |
| Dependencies | `npm ci --no-audit --no-fund` in this lane; `node_modules` is ignored and untracked |
| Resources | `free -h` checked before every gate: 6.7 GiB available at dispatch, 4.8 GiB before the full gate, never below 2 GiB. All test suites ran with `--test-concurrency=2` |
| Live calls | none by the author. No live or paid model call was made; the contrast script ran only its `--help`, missing-provider and unknown-provider paths |

## 2. Files changed

| File | Change |
|---|---|
| `tests/test-u05-revision.mjs` | new suite: conversational revision, lead-with-X, unsupported-request negative control, master revision, several writing samples, voice metric and CLI contract |
| `plainhand/voice-metrics.mjs` | new deterministic surface measures: sentence length, contraction rate, formal markers, distance and attribution |
| `scripts/voice-contrast.mjs` | new synthetic contrast harness; two identical personas differ only in their writing samples, each prepares the same job with `--provider` |
| `package.json` | adds `tests/test-u05-revision.mjs` to `test:plainhand` |
| `docs/internal/lanes/u05-revision/RESULT.md` | this result |

No file under `plainhand/evaluation/*`, `plainhand/benchmarks/*`, `benchmarks/*`,
`scripts/baseline-manifest.mjs` or `scripts/rescore.mjs` was edited. No product
source changed (see §4).

## 3. Evidence by item

### 3.0 The product paths the tests exercise

- `AGENT_INSTRUCTION` already tells the conversational agent to propose
  `tasks.revise` with the candidate's request in their own words and the
  `jobId` when one application is meant (`plainhand/agent.mjs:22`).
- `tasks.revise` validates that `request` is the candidate's words
  (`candidateWords: 'request'`) and maps a missing `jobId` to the master-resume
  `standard` path (`plainhand/actions.mjs:491-499`).
- The packet path clones the job, drafts with
  `INPUT.revisionRequest + INPUT.previousPacket`, humanizes, runs
  `REVIEW_INSTRUCTION`, grades calibration, renders, and then commits with
  `approvedHash: null` (`plainhand/workflow.mjs:275-340`). The master path is
  the same shape with `INPUT.previous` and `revisionRequest`
  (`plainhand/workflow.mjs:225-274`).
- Writing samples become the `writing-samples` context source
  (`plainhand/store.mjs:120-121`), which every workflow call receives as
  `INPUT.context`; `PACKET_INSTRUCTION` and `HUMANIZE_INSTRUCTION` tell the
  provider to match that source's voice (`plainhand/agents.mjs:252`,
  `plainhand/humanize.mjs:11`). The same source is excluded from
  `FACTUAL_SOURCE_IDS`, so it can never ground a claim
  (`plainhand/store.mjs:157-165`).
- `PACKET_INSTRUCTION` already requires a revision request the sources do not
  support to be left out and named in `suggestions`
  (`plainhand/agents.mjs:252`, final revision paragraph).

### 3.1 Revision through conversation

Test: `conversation: "shorter" becomes a confirmed tasks.revise and the packet
is reviewed and rendered again`.

- The candidate says `make my application to Acme Robotics shorter`. A scripted
  conversational reply proposes `tasks.revise`; the test asserts the action is
  tier `task`, its input is exactly
  `{ jobId, request: 'make my application to Acme Robotics shorter' }`, and the
  proposal's `request` is the candidate's own message. Nothing is queued before
  confirmation.
- After `agent.confirm`, the queued task is kind `revise` with that job and
  request. The provider call order after confirmation is asserted exactly:
  `packet`, `humanize`, `review`, `render`.
- The drafter receives `INPUT.revisionRequest` and the pre-revision
  `INPUT.previousPacket` (and no `master`). The humanizer receives the revised
  cover letter. The reviewer receives the humanized revision.
- The stored packet is the revised one; `job.review.passed`; `reviewAttempts`
  is a fresh one; calibration contains the review marker for the revised cover
  letter; `approvedHash` is cleared; the stage is `packet-ready`; the renderer
  ran again and `pdfHash` changed and equals the hash of the rendered packet.
- The candidate can approve the revised packet again, and the new
  `approvedHash` differs from the old one. The revision is recorded in
  `state.revisions` with `{ jobId, request }`.

### 3.2 “Lead with X”

Test: `"lead with my LIMS project" reorders the resume and changes nothing else`.

- The same conversational proposal/confirm path runs against a packet with a
  chassis line, a LIMS line and an education line. The scripted provider honors
  the request by moving the LIMS line to the front.
- The revised packet's resume order is `[LIMS, chassis, education]`; headline,
  cover letter, answers, suggestions and the evidence attached to each line are
  unchanged. Every revised line still passes `hasEvidence`.
- The reviewer saw the new order, approval was cleared, and `pdfHash` changed.

### 3.3 An unsupported request

Test: `an unsupported request is left out and named in suggestions; a provider
that inserts it anyway is blocked by review`.

- `PACKET_INSTRUCTION` is asserted to carry the rule that an unsupported
  request is left out and named in `suggestions`.
- Honest scripted provider: “say I led the team” produces no “led the team” text
  in headline, cover letter, resume or answers; the omission is reported in
  `packet.suggestions`; the clean packet still passes review and clears
  approval.
- Negative control: a scripted provider that inserts
  `Led the team of five engineers.` with an exact but unrelated CV quote passes
  the quote gate, then the independent review blocks it. The task fails with
  “The factual review found issues”; `job.stage` is `review-blocked`;
  `approvedHash` is `null`; `reviewAttempts` has two entries (both attempts were
  reviewed); no PDF was rendered and the previous reviewed packet and
  `pdfHash` are unchanged.

### 3.4 Revising the master resume

Test: `revising without a job id rewrites the master resume and resets its
approval`.

- The master is written and approved, then the candidate says
  `make my master resume shorter`; the scripted agent proposes `tasks.revise`
  with `{ request }` and no `jobId`.
- The task is kind `standard`; the provider receives that
  `INPUT.revisionRequest` and the approved master as `INPUT.previous`; the
  revision is humanized again, reviewed again, and the draft changes.
- `approvedHash` and `approvedAt` are cleared; `standardStatus` is `draft`; the
  candidate can approve the revised master again; `state.revisions` records
  `{ jobId: null, request }`.

### 3.5 Several writing samples

Test: `several writing samples reach the drafter and humanizer, cannot ground a
claim, and removal leaves the next input`.

- Three samples are saved. All appear in the `writing-samples` context source.
- A prepared packet's provider input and humanizer input both carry that source
  with all three samples.
- Each sample is rejected by `hasEvidence` as evidence. A scripted packet that
  cites a writing sample fails the task with “The packet contains a claim
  without an exact source reference” and saves no packet.
- Removing one sample removes it from the next provider's
  `writing-samples` source while the other two remain, and clears the existing
  packet approval.

### 3.6 Synthetic contrastive voice substitute

Module: `plainhand/voice-metrics.mjs`.

- Deterministic features per text: sentence count, words, mean sentence length,
  contraction rate, formal markers per 100 words. The distance is the mean
  absolute difference divided by fixed per-feature scales (20 words, 0.05
  contraction rate, 2 formal markers per 100 words). Attribution is strict: a
  tie is not “closer to own samples”.
- Unit test: `voice metrics rank terse and formal samples deterministically; the
  contrast script makes no call without a provider`. It fixes a terse and a
  formal text, checks the ordering of all three features, determinism, distance
  zero for identical text, empty text, symmetric attribution and the strict
  tie rule.

Script: `scripts/voice-contrast.mjs`.

- Two personas share every profile field and the same job; only the writing
  samples differ (terse/plain vs formal/long-sentenced). Sample titles are
  neutral and identical (`Sample 1`, `Sample 2`) so the only difference the
  provider sees is the writing.
- It validates `--provider` against the provider catalogue before loading the
  app, then prepares the same seeded job in two temporary workspaces. It
  reports each cover letter's distance to its own and the other persona's
  samples, `closerToOwn`, the margin, review pass/attempt counts, and labels the
  whole result `synthetic voice contrast, not user voice`. Exit 0 means both
  letters were closer to their own samples; 1 means the contrast failed; 2 is a
  setup failure.
- The suite exercises only the offline paths: no arguments (exit 2), `--help`
  (exit 0) and an unknown provider (exit 2). **The live run was not performed by
  the author; root runs it under the current budget.**

## 4. Product fixes

None. The falsifiers in §3 pass on the current code, so no product source was
changed. The existing mechanisms were verified, not rewritten:

- conversational proposal wording and candidate-words enforcement;
- `revisionRequest`/`previousPacket` propagation and revision of the master;
- the humanize → review → calibration → render loop and approval reset;
- the `writing-samples` context source and factual-source exclusion;
- the instruction that an unsupported request is left out and reported.

One test-harness bug was fixed during authoring: the first scripted conversational
step was missing, so the agent turn failed with “No scripted reply” before a
proposal existed. That was a test defect, not a product defect.

## 5. Falsifier map

| U05 falsifier | Evidence |
|---|---|
| A revision breaks a verified claim | Resume evidence travels with its line; every revised line still passes `hasEvidence`; the reviewed packet is the stored packet. |
| Revision skips review | The exact call order after confirmation is `packet, humanize, review, render`; review input equals the humanized revision; the negative control never renders. |
| Output ignores the sample | Samples reach both the drafter and the humanizer; the contrast script reports per-persona `closerToOwn` with the live `--provider` root runs. |
| A synthetic result is reported as user-voice acceptance | The script's JSON says `synthetic voice contrast, not user voice`; this result repeats it; real user voice remains external. |

## 6. Gates actually run

All from the lane worktree, with `TMPDIR=~/.cache/plainhand-eval-tmp`.

| Gate | Command | Result |
|---|---|---|
| Focused suite | `node --test --test-concurrency=2 tests/test-u05-revision.mjs` | 6/6 pass |
| Full gate | `npm run test:plainhand -- --test-concurrency=2` | 574/574 pass, 0 fail |
| Controlled benchmark | `node benchmarks/benchmark-eval.mjs --concurrency 2` | 64/67 pass; the three failures are exactly `profile-effect-fin-minimal`, `profile-effect-analyst-minimal` and `profile-effect-sci-minimal`; 0 unexpected. Evidence: `output/evaluation-controlled-2026-11-16T02-27-53-569Z` (ignored, not committed) |

`--test-concurrency=2` is appended to the full gate so the machine stays inside
the two-job cap; the test list is the unchanged `test:plainhand` list plus the
new suite. No browser UI run, no live provider call, no benchmark or scoring
file edit.

## 7. Residuals and deliberately not done

- **Real user voice is external.** Synthetic contrast can show that two sample
  sets produce measurably different drafts; it cannot show that a real
  candidate's voice was matched. The root/live result must not be reported as
  user-voice acceptance.
- **The live contrast run is root's.** The author did not run
  `node scripts/voice-contrast.mjs --provider <id>`; it makes real drafting,
  humanize and review calls for two personas. Root runs it under budget and
  labels the result synthetic.
- **Rendering in the suite is a fixture renderer.** The revision tests prove the
  renderer is invoked again and that `pdfHash` changes and binds the revised
  packet; real PDF text/layout fidelity is U07's evidence, not this row's.
- **No UI surface was exercised.** The suite drives the registry, the
  conversational agent engine and the workflow; it does not open the packet tab
  or click a confirmation in a browser.
- **Master revision coverage uses the fixture master.** The fixture provider
  changes one project line; it proves propagation, humanize and review, not
  live-model shortening quality.
- The three expected `profile-effect-*-minimal` benchmark rows are not repaired
  here; they are the pre-existing controlled failures the gate expects.

## 8. Commits

| Step | Commit |
|---|---|
| Lane base | `e772525e3dde84772544e7a481f93e6358b938a0` |
| Implementation and this result | the single commit on this branch above the base (its SHA is reported to root with the lane head); it adds `plainhand/voice-metrics.mjs`, `scripts/voice-contrast.mjs`, `tests/test-u05-revision.mjs`, the `package.json` wiring and this file |

The branch has one commit above the base; the tree hash was compared before and
after collapsing the author's own unpushed attempt commits, and it is unchanged.
No other lane's lines are included.

The author has not pushed, merged, tagged, deployed or opened an external
contact, and has not edited the acceptance register, manifest, board or handoff.
