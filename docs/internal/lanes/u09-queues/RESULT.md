# U09 — quality-preserving queues and autonomy

**Lane:** `t3/u09-queue-autonomy`
**Base:** `e772525e3dde84772544e7a481f93e6358b938a0` (M3 handoff)
**Author:** U09 implementation sub-agent. Not self-accepted; root reviews the diff.

## What was required

> Batches and queues, resume, retry and cancel, plus opt-in autonomy within limits.

Evidence required by the register: interrupt-and-resume tests; per-item retry and
cancel tests; the daily limit honored; packet quality in a queued run compared
with a single run on the same inputs.

## Evidence map

| Register evidence | Where it is proved |
| --- | --- |
| Batch of evaluate and prepare jobs completes in order | `tests/test-u09-queues.mjs` — “a batch of evaluate and prepare jobs completes in queue order with each task recorded” |
| Interrupt and resume; queued items clearly marked; nothing duplicated; no half-written packet | same file — “a process stop mid-queue marks running and queued work interrupted; retry runs only the interrupted item” |
| Per-item retry re-runs only the failed item | same file — “retry of one failed item re-runs that item only” |
| Cancel a queued item without touching the running one | same file — “canceling a queued item removes it without touching the running one” |
| Cancel a running item; no packet that can be approved; other queued work still runs | same file — “canceling a running prepare during its final check leaves no packet that can be approved” |
| Autonomy off by default; approved current master; `minScore` | same file — “autonomy is off by default and prepares only a strong match from an approved current master” |
| `perDay` honored; the next same-day auto-prepare refused with a recorded reason; resets next day on an injected clock; never submits; turning it off stops new auto-prepares | same file — “the daily limit refuses the next auto-prepare with a recorded reason and resets on the injected clock” |
| Queued packet identical to a single-run packet on the same inputs | same file — “the packet from a queued batch is byte-identical to the packet from a single run on the same state” |
| Live-provider version of the same comparison | `scripts/queue-vs-single.mjs --provider <id>` (exercised here with `--self-test` only; root runs it live) |

The suite is in `npm run test:plainhand`.

### What the queue tests do

- **Batch:** three actions (evaluate A, evaluate B, prepare C) are added before
  any is awaited. A recording agent proves the calls happen A, B, then C, one at
  a time; every task ends `complete` with `finishedAt`, the right kind/job, and
  the prepared role is `packet-ready`, not approved.
- **Interrupt:** a never-resolving agent holds a running evaluate; a second
  evaluate is queued; the app is closed. Closing now stops the queue (see fix
  below), so the queued item stays queued on disk. A new `createPlainhand` on the
  same root marks both `interrupted`; the running one says “Retry this task to
  continue from saved work”, the never-started one says “Plainhand restarted
  before this task started.” Neither has an evaluation or packet. Retrying the
  interrupted item produces exactly one new task and one evaluation; the other
  item keeps its interrupted state, and there is no duplicate.
- **Cancel while running:** the packet draft is held before its commit and the
  ATS check is held inside the commit. The cancel lands during that check. The
  task ends `canceled`, the job has no `packet`, no `output/packet-<id>.json`,
  and `packet.approve` refuses with “regenerated”; a second queued role still
  completes afterwards.
- **Autonomy:** a fake clock is injected through `createPlainhand({
  workflowOptions: { clock } })`. With `perDay: 1`, the first same-day automatic
  pick is dated the fake day and prepares; the second is refused and the event
  feed records “the daily limit is used up (1 of 1 today)”. Advancing the clock
  one day lets the next role prepare. No job is submitted, and every automatic
  packet keeps `approvedHash: null`. Turning autonomy off then evaluating another
  role leaves it untouched.
- **Queued vs single:** one seeded workspace (approved master, three evaluated
  and selected roles) is copied twice. One copy prepares the compared role alone;
  the other prepares two other roles first, then the compared role, in one queued
  batch. The packet JSON is canonicalized (generated ids and timestamps removed)
  and byte-compared; `resume`, `answers`, `coverLetter` and `fromStandard` are
  also compared directly. They are equal.

## Product fixes

All are in the queue/autonomy path; the packet answer path was not edited.

1. **Canceling during the final check could commit a confirmable packet**
   (`plainhand/workflow.mjs`). The prepare commit ran the ATS check after its last
   cancellation check, so canceling in that window still saved `job.packet` with
   stage `packet-ready`; `packet.approve` accepted it. Added one `check()` after
   the ATS check, before the state commit. The new cancel test proves the packet
   and its file are absent and approval is refused.
2. **Closing the app did not stop the queue** (`plainhand/workflow.mjs`,
   `plainhand-server.mjs`). `close()` aborted the current controller only; queued
   runs stayed chained and could start after shutdown. A race made this visible:
   if the running task was between its `running` marker and its agent call, it
   failed on abort and the next queued task started in the closed app. Added
   `Workflow.stop()` (sets `stopped`, aborts every controller); `run()` returns
   without starting when stopped; `createPlainhand.close()` calls it. Queued work
   is left in place for the next start's `recover()` to mark interrupted.
3. **Restart marked queued and running work with the same message**
   (`plainhand/workflow.mjs`). A never-started item was told to “retry … to
   continue from saved work” although it had none. Each now gets an accurate
   message; both remain `interrupted`, never silently complete.
4. **Autonomy had no injectable clock and recorded no daily-limit refusal**
   (`plainhand/workflow.mjs`, `plainhand/standard.mjs`). `Workflow` takes an
   optional `clock` (defaults to the existing `now`); `autoPrepare` uses it for
   the day key, `autoSelectedAt` and event time. `autoPrepareDecision` returns
   `done`/`perDay` when the limit is reached, and `autoPrepare` records an event
   naming the role and the count. This makes “resets the next day” testable and
   gives the candidate a visible reason a strong match was left alone.

## Gates run

| Gate | Result |
| --- | --- |
| `npm run test:plainhand -- --test-concurrency=2` | 576 tests, 576 pass, 0 fail (33.3 s on the final commit) |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | 64/67 passed (3 expected failures, 0 unexpected): `profile-effect-fin-minimal`, `profile-effect-analyst-minimal`, `profile-effect-sci-minimal`; evidence `output/evaluation-controlled-2026-11-16T02-33-59-366Z` |
| `node scripts/queue-vs-single.mjs --self-test --jobs 2` | byte-identical packets, no regression |

The concurrency flag caps the test run at two jobs on the shared host; it does
not change the test set.

## Residuals

- **No automatic resume.** Queued-but-unstarted work is marked interrupted and
  needs an explicit retry. That is deliberate: a restart should not silently
  spend provider calls the candidate did not see.
- **Turning autonomy off does not cancel a prepare already queued or running.**
  It stops new automatic decisions only. The candidate can cancel the existing
  task; making the setting action also cancel active auto-prepares would need a
  task marker and a race guard, and was kept out of this lane.
- **`autoSelectedAt` counts attempts, not successes.** A failed automatic prepare
  still uses that day's slot. This matches the existing limit’s conservative
  direction and was not changed.
- **The live script measures packet quality, not the rendered PDF.** It seeds a
  synthetic corpus persona/job with an approved master built from that persona's
  facts, stubs document rendering, and compares facts covered/missing, absent
  claims, unsupported numbers, banned words, ATS coverage, review pass, open
  questions and calibration counts. One pair is stochastic; use `--repeat`.
  Per the lane instruction it was not run against a live provider here.
- **A running call whose agent ignores the abort stays `running` on disk until
  the next start.** That is the process-stop case this lane is testing; the next
  `createPlainhand` marks it interrupted, and nothing is committed after close.
- **Cancel has a very small window after the last check** before the synchronous
  state write begins. Closing that window would need a storage-level
  cancellation lease; the observable falsifier (a confirmable packet) is covered
  by the ATS-check test.
