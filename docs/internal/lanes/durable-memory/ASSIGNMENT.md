# Lane assignment: durable candidate memory (U02/U06/U12) — Gate 1 design

Status: **design only, awaiting root Gate 1 approval.** No implementation, no source or test edit, no probe run by this lane. This is a proposal by the design sub-agent, not an acceptance record; nothing here is self-accepted.

## 1. Pin, route, environment

| Item | Value |
|---|---|
| Worktree | T3 isolated checkout, cwd confirmed before edits |
| Branch | Started `t3/7799620d`; renamed externally to `t3/durable-memory-design` at 00:32 (git reflog), same HEAD, no content change by this lane |
| Expected and actual HEAD | `8012a8315145f4162b843ae9dbb65096ef8eb85c` (matched; tree clean at start) |
| Author route | Pi `deepseek/deepseek-flash`, catalog DeepSeek V4.1 Flash, thinking max, existing metered account; chosen after Go insufficient balance and Claude author 429, both disclosed by root |
| Reviewer | root Codex, different model family; root reads the diff |
| Host | `free -h` before work: 4.4 GiB available, swap heavily used. Design-only, so no build, suite, browser or provider call |
| Lanes kept clear | continuation lane owns `plainhand/standard.mjs`, `plainhand/workflow.mjs`, `plainhand/cloud/extension-api.mjs` and UI integration; measurement lane owns evaluator validity and the frozen baseline |

## 2. Scope

In scope: this one file, `docs/internal/lanes/durable-memory/ASSIGNMENT.md`. It must state the minimal coherent repair packets for U02, U06 and the import part of U12, with dependency order, producer/storage/consumers, migration, approvals, atomicity, falsifiers and required evidence.

Out of scope: app source, tests, scripts, config, registers, manifest, board, handoff, `GOAL-*`, `REVIEW.md`, `EVIDENCE.json`, user data, `main`. No subagents, suites, browsers, servers, providers, installs, cloud writes, merges, pushes, deploys, contact or submission. Source inspection was read-only; no new archaeology beyond the named files.

## 3. Source read (pin `8012a83`)

`AGENTS.md`, `OPERATING_GUIDE.md`, `WORKFLOW.md`, `docs/internal/UNIFIED-GOAL.md`, `GOAL-ACCEPTANCE.json`, `P2-INVENTORY-RESULT.md`, `CURRENT-CAPABILITY-INVENTORY.md`, `REVIEW.md`, `GOAL-HANDOFF.md`, `DATA_CONTRACT.md`. Source: `plainhand/store.mjs`, `workspace-import.mjs`, `cloud/workspace-transfer.mjs`, `cloud/postgres-storage.mjs`, `answer-bank.mjs`, `corrections.mjs`, `claim-line.mjs`, `standard.mjs`, `resume-format.mjs`, `workflow.mjs`, `actions.mjs`, `jobs.mjs`, `field-policy.mjs`, `remote.mjs`, `agent.mjs`, `usage.mjs`, `plainhand-server.mjs`, `cloud/app.mjs`, `web/ui/{profile,settings}.mjs`, `adapters/native-choices.mjs`, `adapters/upstream/README.md`, `adapters/{greenhouse,lever}.mjs`, `lib/apply-browser.mjs`, and tests named below. The continuation tip was read only with `git show a46056f:plainhand/standard.mjs` to avoid designing against superseded semantics.

## 4. Findings (source-verified)

1. **Export writes more than import restores.** `/api/export` spreads the whole state (`plainhand-server.mjs:192-195`; hosted `cloud/app.mjs:300-302`). `importWorkspace` deletes every state key except `version`/`revision` (`workspace-import.mjs:44`) and restores only `STATE_KEYS` (`:8,:45`). `writingSamples` (`actions.mjs:306-307`), `claimLine` (`claim-line.mjs:22`), `standard` (`workflow.mjs:253`), `resumeFormat` (`actions.mjs:186`) and `settings` (`actions.mjs:198`) are not listed. Hosted keeps a shorter allow-list (`cloud/workspace-transfer.mjs:40`). Matches the root import probe.
2. **The reusable stores are outside the transfer format.** `data/answer-bank.yml` (`answer-bank.mjs:4`) and `data/plainhand/corrections.json` (`corrections.mjs:5`) are neither exported nor imported. An import therefore leaves the target's old bank in place, whose quotes may not exist in the imported sources; `AnswerBank.match` checks only label, expiry, scope and quote *shape* (`answer-bank.mjs:63-82`).
3. **Import carries state it then discards.** `understanding` is listed in `STATE_KEYS` (`workspace-import.mjs:8`) but the profile save at `:60` runs `saveProfile`, which sets `state.understanding = null` (`store.mjs:150`). `connectionChecks` **is** imported locally (`:8`) and drives the "last verified" badge (`plainhand-server.mjs:189`); hosted strips it (`workspace-transfer.mjs:37,39`). Inconsistent, and a stale verified badge is a small false-authority signal.
4. **A carried `standard` would arrive approved.** At this pin `standardStatus` returns `approved` when `approvedHash` equals the draft identity and `contextHash` matches (`standard.mjs:12-17`). Nothing in import would clear it. The continuation tip adds `kind:'master'` and marks legacy standards `stale` (`a46056f:plainhand/standard.mjs:15-21`), but approval is still content-bound, not transfer-bound.
5. **Autonomy currently fails safe by accident.** `settings` is dropped, so `autonomyOf` returns `DEFAULT_AUTONOMY.enabled === false` (`standard.mjs:7,53-55`). This must become an explicit, tested rule, not a side effect of a missing key.
6. **Voice samples can ground claims today.** `hasEvidence` accepts any source id except `reviewed-understanding` (`store.mjs:157-158`). `writing-samples` is a source (`store.mjs:120-121`), so a packet claim may cite a writing sample as factual proof, contradicting its stated purpose ("guide voice, not facts", `actions.mjs:301`).
7. **A reusable answer can self-certify.** `validEvidence` checks shape and 8 characters (`answer-bank.mjs:8-11`). `answers.update` replaces the answer text, keeps the old quote, and re-dates `reviewedAt` (`actions.mjs:278-283`, `answer-bank.mjs:31-50`): an edited factual answer is silently re-blessed against a quote that may no longer support it. Form-fill offers typed answers as **global** corrections with the typed text as its own quote (`plainhand-server.mjs:479-496`, `sourceId: 'candidate-answer'`).
8. **Stories have no durable edit or delete.** `profile.addStory` appends a user message and offers a process-memory undo only (`actions.mjs:290-300`, TTL `:26`). No route or control removes a conversation message; `Interview` renders the last 12 messages (`web/ui/profile.mjs:84-101`). The agent transcript is a different file (`data/plainhand/conversation.jsonl`, `agent.mjs:24`), so deleting a story does not need to rewrite agent history.
9. **No contradiction or unknown mechanism.** Provenance exists only as claim evidence; profile fields are candidate-entered with event-level history. "Contradict" occurs only in grader and inbox prompts. Unknowns exist only as `packet.questions`, `evaluation.gaps` and `understanding.result.questions`; `packet.approve` refuses while `packet.questions` is non-empty (`actions.mjs:476`).
10. **Approvals and the two adapter stacks.** `packetIdentity` binds context hash, packet, PDF hash and job text (`workflow.mjs:43`); `assertPacketFresh` rechecks context and job (`:40-41`); `context.exclude` clears approvals (`actions.mjs:263-269`); `understanding.approve` binds to `baseHash` (`:460-468`, `store.mjs:124`). The app stack is `plainhand/jobs.mjs` (`ATS_HOSTS`, `:30`), `adapters/native-choices.mjs`, `adapters/upstream/*`, consumed by `suggestFormAnswers` (`workflow.mjs:346-358`) at `plainhand-server.mjs:95` and `cloud/extension-api.mjs:161`. The CLI stack is `adapters/{greenhouse,lever}.mjs`, `portal-adapters/*`, `lib/apply-browser.mjs` (answer file `data/application-answers.md`, `:34`), a separate legacy store not in the workspace transfer.
11. **Provider exclusions do not govern form fill at this pin.** `contextPrefs.excludedFields` removes fields from provider context (`store.mjs:107-123`) but `defaultFieldAnswers` still fills name/email/phone/location into local forms (`jobs.mjs:726-753`). That is current intended behavior ("what your agent sees", `actions.mjs:234`), not a leak to a provider. The design tests that excluded sources and fields never reach a provider payload; it does not change local form fill. If root wants exclusions to govern form fill too, that is a separate, explicit behavior change with its own falsifier, not assumed here.

## 5. Invariants for the repair set

I1 The candidate is the only source of identity. Model output never enters profile fields or identity answers without the candidate's explicit action.
I2 Claim evidence is an exact quote from a current, shared, *factual* source. `writing-samples` and `reviewed-understanding` cannot ground a claim.
I3 A candidate assertion is provenance, not proof. Reuse of a reusable answer in a factual output requires a live quote; otherwise it is offered for form fields only, or becomes a question.
I4 Every approval is bound to exactly the content and context the candidate saw. Transfer resets approvals and never creates one.
I5 Transfer preserves memory (including the reusable stores) and carries no credential, connection check, browser checkpoint or executable autonomy.
I6 Deletion and exclusion are durable and downstream-visible: no deleted or excluded material in a later packet or provider payload.
I7 Reuse existing state keys and files. A new ledger, if any, stores decisions, never duplicate facts.
I8 No packet silently chooses between conflicting sources; no fact the sources settle is asked again.

## 6. Memory map at this pin

| Memory | Storage | Provenance today | Consumers | Gap |
|---|---|---|---|---|
| Facts | `profile`, `cv.md`, `data/resume-source.yml`, `modes/_profile.md`, `article-digest.md`, `interview-prep/story-bank.md`, `state.conversation` | claim `{sourceId, quote}` via `hasEvidence`; profile fields are candidate-entered | `Workspace.context`, drafter, reviewer, assessors | voice samples admissible as evidence; source files not transferred |
| Stories | `state.conversation` user messages | message `at`/`via`; no id | context `interview`, `profileStrength`, digest counts | no durable edit/delete |
| Voice/taste | `writingSamples`, `profile.voice`, `claimLine`, approved `understanding.voice` | exact candidate text; decisions counted | context, `lineInput`, packet view | samples not transferred; delete = remove only |
| Preferences | `profile`, `contextPrefs`, `resumeFormat`, `settings` | candidate actions/events | context, renderer, autonomy | `resumeFormat`/`settings` not transferred; autonomy rule implicit |
| Reusable answers | `data/answer-bank.yml`, `data/plainhand/corrections.json` | quote + `reviewedAt`/`reviewBy` + scope | `suggestFormAnswers` (both stacks), settings UI | not transferred; quote not rechecked; typed-answer self-quote; global default |
| Strengths/constraints | `profile.constraints`, approved `understanding.result` | candidate words; reviewed summary | digest, profile strength | summary is model text; already barred from evidence |
| Contradictions/unknowns | none / `packet.questions`, `evaluation.gaps` | none | review, approval block | no durable surface, no detection |

## 7. Coverage map (what is already there, what a packet must add)

| Requirement | State at this pin | Packet |
|---|---|---|
| Facts with provenance | claim `{sourceId, quote}` checked; profile fields candidate-entered | M2, M6 |
| Editable and deletable | samples and line statements yes; stories no durable edit/delete | M3 |
| Survives restart | state keys in `workspace.json`; no process-restart test | M6 |
| Survives provider switch | memory/approval/hash test (`tests/test-brain-controls.mjs:104-122`), not the full set | M1, M6 |
| Sharing controls | per source and field; exclusions clear approvals and change the hash | kept as is; M1 preserves on transfer |
| Approved corrections reused | reusable answers fill exact-label form fields only, not drafting | M4 |
| Contradictions and unknowns | none located; only packet questions and gaps | M5 |
| No invented identity | evidence gate on claims; identity fields candidate-entered | M2 |
| No repeated question when sources settle it | no counter, no settled-fact lookup | M5, M6 (measurement lane) |

Restart durability and provider switching of the existing keys are already implemented; they lack evidence, not a mechanism. Per-provider sharing controls are not required by U02 and are not proposed.

## 8. Packets

Each packet lands on its own immutable candidate SHA, with a falsifier and evidence. No fixture special-casing, no relaxed assertion or threshold. Packets are implementation proposals only; none is authorized now.

### M1 — Transfer and lifecycle correctness (U02 durability, U12 import)

**Goal.** A workspace export/import (local, and hosted when the format is accepted) preserves candidate memory, resets authority, carries no credentials, and either transfers the source files that evidence depends on or explicitly holds what it cannot verify.

**Producer / storage / consumers.**
- Export: `plainhand-server.mjs:192-195` and `cloud/app.mjs:300-302` produce `version:1` plus optional `answerBank`, `corrections`, and a bounded `files` map (see below). Storage: unchanged workspace state and files.
- Import: `workspace-import.mjs` (local), `cloud/workspace-transfer.mjs` + `importWorkspace` (hosted). Storage: `workspace.json`, `data/answer-bank.yml`, `data/plainhand/corrections.json`, optional `modes/_profile.md`, `article-digest.md`, `interview-prep/story-bank.md`, `data/resume-source.yml`.
- Consumers: `store.context` (writing samples, narrative, proof points, stories, structured resume), `standardStatus`/`standardInput` (post-continuation), `lineInput`/`calibrationFor`, renderer (`resumeFormat`), `autonomyOf`, `AnswerBank.match`, `Corrections.list`, `suggestFormAnswers` in both adapter stacks, profile/settings/import UI.

**Behaviour.**
- `STATE_KEYS` adds `writingSamples`, `claimLine`, `standard`, `resumeFormat`, `settings` (and M5's `conflictReview` once that packet exists). Each imported value is sanitized, not blind-copied: sample text/id/title bounds, `cleanFormat`, `standard` draft shape, `settings` restricted to `{autonomy:{perDay,minScore}}` with `enabled:false`, unknown keys dropped.
- Never import `approvedHash`, `approvedAt`, `connectionChecks`, `browserCheckpoint`, job approvals or an autonomy `enabled`. A provider id may travel as a preference; its verification does not. Preserve `standard.draft` and the `understanding` text as unapproved; if the imported context differs (likely when source files travel), the understanding must be rebuilt before it can be approved. Record both in the import summary. For the standard, rely on the continuation lane's `kind` semantics rather than redefining them.
- `answerBank`: entries are retained, never silently deleted, but *held* (`status: needs-review`) when any evidence quote is not found in the imported sources or its source id is not factual (I2/I3). Held entries are not matched by `AnswerBank.match`. Entries whose question is sensitive are dropped and counted. `corrections`: retained with status and timestamps; approval of a correction still requires its bank entry to pass the same check.
- Source files: include the four bounded user-layer sources in the export and write them on import, or (fallback if root prefers a smaller change) do not include them and mark every imported claim whose quote references one of them as unresolved and the packet/standard as needing review. Recommendation: include them; it preserves provenance without a new fact store. Hosted `structured_resume_conflict` (`workspace-transfer.mjs:76`) becomes "refuse only if the structured source travels without its mirror".
- Atomicity: local import backs up before writing, stages writes, commits `workspace.json` last, and writes a `prepared`/`state-committed`/`done` marker in `data/plainhand/backups/`; on the next load a `prepared`-only marker restores the backups, and a `state-committed`-only marker finishes derived writes (tracker sync) idempotently. Hosted already runs inside `storage.exclusive` (`postgres-storage.mjs:52-58`); keep every write in that transaction. A failure leaves the previous workspace byte-identical or fully imported, never mixed.
- Revision monotonic; one import event records `exportedAt`, counts (jobs, approvals reset, held answers, dropped sensitive, unresolved claims), never secrets.

**Falsifier.** Export a rich fictional workspace (one writing sample, one line statement, an approved standard, a saved format, autonomy on, a job approval, one bank answer, one correction, one story-backed claim); import into a fresh workspace. Any key missing or changed, the standard arriving `approved`, autonomy arriving `enabled:true`, a held answer matching a field, a sensitive entry stored, a credential or `connectionChecks` present, or a mixed state after an injected write failure fails the packet.

**Evidence.** New `tests/test-memory-transfer.mjs` plus extensions in `tests/test-workspace-import.mjs`; a failure-injection test on a temp root; a hosted transfer test when the root-owned Postgres container is available (otherwise "not run", never pass). Structural only; no model call.

**Coordination.** Land after the continuation merge on a fresh goal base; tracking is already in this pin, but a later tracking fix can touch `cloud/app.mjs`. `plainhand-server.mjs` is shared with continuation. `workspace-import.mjs`, `answer-bank.mjs`, `corrections.mjs`, `cloud/workspace-transfer.mjs` are currently unowned. If the continuation changes the `standard` shape again, M1 follows it; it does not define standard semantics. Decision for root: include source files (recommended) or hold-and-report.

### M2 — Voice samples are not evidence; identity negative controls (U02, U07)

**Goal.** Enforce I2/I3 at the single evidence gate, so a writing sample or a model summary can never ground a factual claim, and generated identity text fails instead of reaching a form.

**Producer / storage / consumers.** `hasEvidence` (`store.mjs:157-158`), `validEvidence` (`answer-bank.mjs:8-11`) and correction validation are the gates; context sources are the input. Consumers: prepare/revise (`workflow.mjs:270-290`), standard task, `suggestFormAnswers`, `presubmitCheck`. No new storage.

**Behaviour.** A claim-evidence source must be in a factual allow-list (`profile`, `cv`, `structured-resume`, `narrative`, `proof-points`, `stories`, `interview`); `writing-samples` and `reviewed-understanding` are rejected with a specific error. The same source-kind check is applied by `validEvidence` so a reusable answer cannot cite a voice sample; assertion provenance and re-verification are M4. The drafter instruction (continuation-owned `agents.mjs`) states samples are voice only; the gate enforces it. Identity negative control: a packet answer or form value introducing a name variant, employer, title or date absent from the sources fails review/evidence rather than being accepted as prose.

**Falsifier.** A packet item with `{sourceId:'writing-samples', quote:<real sample text>}` is rejected; a planted "Director at Northwind, 2019–2021" answer with no source fails; a legitimate claim quoting `cv` still passes; existing voice behavior (samples in context, approval reset on edit) unchanged.

**Evidence.** `tests/test-writing-samples.mjs` negative case, a new case in `tests/test-plainhand.mjs` or a new `tests/test-evidence-sources.mjs`, scripted provider only. This packet can change packet acceptance; measure it as a candidate against the frozen baseline.

**Coordination.** `store.mjs`, `answer-bank.mjs`, `corrections.mjs` free; `agents.mjs` is continuation-owned, so the instruction text lands after that merge or is coordinated.

### M3 — Story edit and delete with downstream invalidation (U02)

**Goal.** The candidate can edit or delete a story in the product, and the change reaches context, approvals, packets, strength and restart.

**Producer / storage / consumers.** New candidate-tier `profile.editStory` and `profile.removeStory` in `actions.mjs`; stable message key (new `id` on new messages, derived key for old). Storage stays `state.conversation` — no second story store. Consumers: `Workspace.context` (`interview`, `store.mjs:112-113`), `profileStrength` (`:19-33`), digest statement counts, agent interview task (`workflow.mjs:163`), profile UI `Interview` list (new controls). Audit records the action and time, not the deleted text.

**Behaviour.** Edit/delete clear `understanding` and every `job.approvedHash`, exactly as `addStory` does (`actions.mjs:292-297`); context hash changes, so stale packets cannot be approved. The agent may ask but cannot edit/delete (candidate tier, `registry.run` refusal `actions.mjs:519`). Deletion does not rewrite `data/plainhand/conversation.jsonl`. Backups retain earlier snapshots by design; the UI says so.

**Falsifier.** Delete the story that supplied a claim quote; the quote is no longer in context, `hasEvidence` fails, the existing packet is stale/unapprovable, the next packet cannot use it, and after restart the story is still gone. Editing a story changes the source text and invalidates exactly as add does; an agent call is refused.

**Evidence.** `tests/test-brain-controls.mjs` or new `tests/test-story-lifecycle.mjs`; restart probe; UI render test for the controls (real Chromium later per U12).

**Coordination.** `actions.mjs` and `web/ui/profile.mjs` are continuation-owned; land after that merge.

### M4 — Reusable answers: provenance, re-verification, scope, later reuse (U06, U02)

**Goal.** An approved correction keeps its provenance, is eligible only under current scope/expiry/sharing controls, can change a later packet, and cannot smuggle an old quote under new factual text.

**Producer / storage / consumers.** `answer-bank.mjs` and `corrections.mjs` (free); `answers.update` extended with scope (candidate tier) and `corrections.*` in `actions.mjs` (continuation-owned); prepare/revise injection in `workflow.mjs` (continuation-owned); settings UI (continuation-owned). Storage: existing bank file and corrections file, with added fields `sourceKind: factual|assertion`, `verifiedAt`, `needsReview`, `importedAt`; no new file.

**Behaviour.**
- `validEvidence` uses the M2 source-kind check and adds `sourceKind` (factual or assertion). `candidate-answer` is an *assertion* provenance, never usable as factual grounding for a packet.
- `answers.update` clears `verifiedAt` and sets `needsReview` when the answer text changes; the old quote stays for display, the entry is not matched until the candidate re-approves or attaches a current quote. Editing only the expiry does not re-verify content.
- Form-fill offers typed answers with `sourceKind:'assertion'` and the job/company scope by default (never `global` without the candidate choosing it), keeping the existing sensitive-label refusal. An approved assertion may fill later form fields; it cannot ground a packet claim.
- Reuse in a later packet: before humanize/review, for each packet answer whose question exactly normalizes to an eligible bank entry, replace the drafted answer with the approved text and attach the bank quote as evidence, recording `{kind:'reusable-answer', id, reviewedAt}` on the answer. Eligible = approved, not expired, scope matches, not sensitive, quote present in current `context.sources`, sourceKind factual. If the quote is gone or the source is excluded, do not inject; record `notReused` with the reason. Review then runs on the injected packet, so a verified claim cannot be skipped. Assertion-only answers fill form fields; they are never injected into a packet.
- The bank is **not** added to `Workspace.context`: editing an answer must not invalidate every approved packet. Reuse is per prepare, and the packet carries its own provenance.
- Imported entries follow M1's hold rule; a held entry can be restored by the candidate's review, not by transfer.

**Falsifier.** Approve a correction for "Describe a hands-on project"; prepare a second job with that exact label: the answer is the approved text, its evidence is the bank quote, review re-ran, and the candidate still approves. Edit that entry to a new factual claim while keeping the old quote: it stops matching and is not reused until re-approved. Exclude its source or pass `reviewBy`: it is not reused and no quote reaches the provider. A typed sensitive answer is never offered or stored.

**Evidence.** `tests/test-answer-bank.mjs`, `tests/test-corrections.mjs`, `tests/test-claim-line.mjs` extensions; new packet-level test with a scripted provider (two jobs); later a real-model run in the measurement lane (memory contribution, provider B).

**Coordination.** M4 needs M1 (bank transfer) and M2 (source kinds). The injection point in `workflow.mjs` and the instruction text in `agents.mjs` are continuation-owned; the packet must land after that merge and be reviewed against the frozen baseline. Root decision: exact-label reuse only (recommended, testable) versus adding alias matching; aliases are a measured improvement, not a prerequisite.

### M5 — Contradictions and unknowns, bounded (U02, U06)

**Goal.** Material unresolved facts are surfaced with their sources and never silently resolved; settled ordinary facts are not re-asked; the candidate resolves by editing a source or recording a disposition, and that survives restart and transfer.

**Producer / storage / consumers.** New pure module `plainhand/memory-checks.mjs` (deterministic comparisons only) and candidate-tier actions in `actions.mjs`; storage is one state key `conflictReview` holding decisions (conflict id, involved source ids, quote digests, disposition, at) — no copied facts. Consumers: profile/workspace card (continuation-owned UI), prepare pre-check before review/humanize (adds a blocking `question` when a packet claim cites a source involved in an unresolved conflict; `packet.approve` already blocks on `questions`, `actions.mjs:476`), `profileStrength`/digest counts. Detection runs locally over current sources; an excluded source is compared locally, but its text is never added to a provider source, and a question names the topic rather than quoting an excluded source.

**Behaviour.** Deterministic checks only for material fields: same employer with different titles, overlapping/contradictory dates, different degree or graduation year, different numbers attached to the same claim, conflicting location/eligibility. Each finding carries both source ids and exact quotes. An ordinary settled fact (one employer, one date, one degree) yields nothing. Unknowns reuse existing channels: `packet.questions`, `evaluation.gaps`, `understanding.result.questions`, and unanswered non-sensitive form fields; a settled-fact lookup (profile field, exact bank answer, this job's packet answer) runs first, and its result is recorded so a repeated question is visible. No semantic/model contradiction detection in this packet; that stays a measured improvement.

**Falsifier.** CV says "led a team of 5", story says "coordinated 3 contractors": the card lists the conflict with both quotes, no packet uses either as settled until resolution, after the candidate edits one source or records a disposition it stops appearing and does not reappear after restart or import. A settled employer/date/degree is never listed. An excluded source's text never appears in provider input or a packet question.

**Evidence.** New pure-module tests with planted and negative cases, a prepare test with a scripted provider, restart/import checks, UI render test. Later real-model question-quality run in the measurement lane.

**Coordination.** Needs M1 (ledger transfer) and M3 (source editing is the primary resolution). `actions.mjs` and the UI are continuation-owned; land after. This is the packet most likely to creep; it is deliberately deterministic and decision-only.

### M6 — Restart, switch, deletion and correction evidence (no product change)

**Goal.** Produce the U02 evidence that no product packet can self-certify, and keep it reproducible.

**Shape.** A portable probe on a temp root with a scripted provider: fill every memory category; restart the process; diff state, bank, corrections and `context.hash`; switch provider id; diff identity fields, understanding, samples, line, format, standard draft and approvals; capture every provider input in one scripted prepare and grep for an excluded value/field and for credential-shaped keys; delete a story and re-run prepare; approve a correction and prepare a second job. No live model, no browser. The real-model tier (memory contribution under provider B, repeat-question count across two jobs) runs in the measurement lane against the frozen baseline, with the provider quota recorded as an operational state, not a pass or fail.

**Falsifier.** Any memory difference after restart or switch; an excluded value in a captured provider payload; a deleted fact still usable; an approved correction absent from the later packet; a credential in the export; a probe that passes only because it asserts on its own fixture.

**Evidence.** Probe output JSON and a short log under an ignored path (`output/`), hashes in root's evidence record; no candidate data, no private logs committed.

**Coordination.** Run after M1; repeat after M4/M5 for the full claim. Measurement lane owns the scored tier and the baseline.

## 9. Order, gates and measurement separation

1. **Gate 1 (now):** root reads this design, accepts/amends packets and decisions, and confirms the frozen baseline ordering.
2. Continuation merge onto a fresh goal base, then baseline freeze (P5). No gap-improvement edit before the baseline SHA exists.
3. **M2** (grounding gate, small) → **M1** (transfer; correctness, structural evidence, expected zero change in scored output) → **M3** (story lifecycle) → **M4** (reuse; measured against baseline) → **M5** (conflicts; measured) → **M6** (full evidence; repeat M6 at the end).
4. Migration/lifecycle correctness (M1, M6 structural) is reported separately from measurement: M1 runs the frozen scenarios with the new path unused and must show the same packet content and scorer output, or explain a reviewer-visible bug fix. No threshold, rubric, assertion or scenario is weakened to make a packet pass.
5. Each packet ends in a reviewer disposition, never self-acceptance. Register states stay as they are (U02 and U12 `in_progress`, U06 `not_run`) until each row's own evidence exists and an independent reviewer accepts it.

## 10. Boundaries, unknowns and external checks

- **Legacy CLI answer bank** (`data/application-answers.md`, `lib/apply-browser.mjs:34`) is a separate user-layer store outside the workspace and outside this repair set. It is not silently imported. Root should confirm it stays CLI-only; treating it as U02 memory would widen the scope.
- `data/plainhand/remote.json` holds a deployment password/secret and is not exported (`remote.mjs:17`); the design keeps it that way and adds an explicit export assertion. No credential transfer.
- Hosted import has a 3 MiB cap and an existing structured-resume conflict rule; adding source files and bank data must stay under the cap or be reported as too large rather than truncated silently.
- Human voice acceptance and 20–30 human packet ratings remain external. Local substitutes proceed: synthetic multi-role personas and a fictional writing set, labelled synthetic. No synthetic result is reported as user-voice acceptance.
- Unverified until run: exact current test counts, hosted transfer behavior, and whether the continuation lane changes `standard`/`actions` shapes again. The design follows source, not remembered counts.

## 11. Gate 1 asks of root

1. Approve the packet split and order M2 → M1 → M3 → M4 → M5 → M6, with M1/M3/M4/M5 landing only after the continuation merge on a fresh base.
2. Decide M1's source-file transfer: include the four bounded user-layer sources (recommended) or hold-and-report unresolved claims.
3. Confirm M4's reuse scope: exact normalized label only (recommended), and confirm the bank stays out of `Workspace.context`.
4. Confirm M5 stays deterministic and decision-only, with semantic contradiction detection deferred to measurement.
5. Confirm the probe tier split (structural now, real-model in the measurement lane) and that no provider call is authorized by this design.

## 12. Commands planned, not run

- `node --check` on each changed module; `git diff --check`.
- `node --test tests/test-workspace-import.mjs tests/test-answer-bank.mjs tests/test-corrections.mjs tests/test-writing-samples.mjs tests/test-brain-controls.mjs tests/test-standard.mjs` (focused, after implementation).
- New: `node --test tests/test-memory-transfer.mjs tests/test-story-lifecycle.mjs tests/test-memory-checks.mjs` (to be written).
- `node --test tests/test-cloud-workspace-transfer.mjs` and `tests/test-cloud-app.mjs` only with root's Postgres container; otherwise reported not run.
- Real browser and real-model tiers: not run here; measurement lane, gated on quota and baseline.

Deliberately not done: no suite, build, server, browser, provider, container, install, cloud write, merge, push, deploy, contact or submission; no register/manifest/board/handoff edit; no source or test edit. Only this file was written.

Design commit: reported to root in the lane response; this file is the content of that single commit (a commit cannot contain its own SHA). No self-acceptance.
