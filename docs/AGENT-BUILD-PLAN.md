# Plainhand agent build plan

**Status:** M0–M6 delivered 2026-10-25; M7 live validation needs the candidate's machine
**Decisions taken:** D1 Preact + htm vendored; D2 last 500 messages, clearable; D3 MCP reads and writes, no tasks; D4 live validation after M4
**Created:** 2026-10-25
**Implements:** [Conversational agent layer](AGENT-LAYER-DIRECTION.md)
**Within:** [Product buildout goal](PRODUCT-BUILDOUT-GOAL.md)

## Execution goal

Reach a **working state we can test and iterate on**: Plainhand with a
conversation-first interface, an agent that drives the existing workflow
through a single action registry, and the same actions reachable from the
candidate's own agent over MCP, without weakening any guardrail.

### Definition of the working state

All of the following, demonstrated by automated tests and screenshots:

1. A fresh workspace opens on a briefing and a conversation, not a form.
2. By conversation alone (fixture agent in tests, a real CLI on the
   candidate's machine), a candidate can paste a job link, have it
   evaluated, discuss the score, select the role, prepare a packet, open it
   in the document panel and approve it there, autofill the fixture form to
   final review, take over, and confirm submission.
3. "Had the screen with Dana, she wants references Friday" produces one
   grouped proposal (interview round, contact, next action) that saves on
   accept and can be undone.
4. "What's due this week?" is answered from the digest with no extra model
   lookups.
5. Claude Code or Codex, configured with `plainhand-mcp.mjs`, can list jobs,
   read the follow-up queue and set a next action; a candidate-only action
   returns a Plainhand link instead of running.
6. Injection tests: a job description containing instructions produces no
   unconfirmed write, no tier escalation and no candidate-only result.
7. The new front end matches or beats the current one on every screen in
   light, dark and mobile, and passes the existing workflow guarantees
   (approval binding, no submission, confirmed `Applied`).
8. `npm run test:full` passes; docs describe current behaviour and limits.

Live validation with a signed-in provider CLI happens on the candidate's own
machine; the cloud build environment has no provider login.

## Front-end review (2026-10-25)

Reviewed from the UI test's desktop, mobile, light and dark screenshots and
the source in `plainhand/web/`.

### What is good

- Coherent, calm visual identity (forest/lime palette, serif display type),
  consistent in light, dark and system modes.
- Honest copy about data location and boundaries ("Confirmed by you",
  "Only mark Applied after you have submitted").
- Solid basics: labelled controls, roles, dialog focus trap, reduced-motion
  support, visually hidden labels, a working mobile layout, a sample workspace.
- Evidence disclosure in the packet view ("Trace resume entries to your
  evidence") is exactly the product's differentiator, made visible.

### What is not good enough

1. **Form-first information architecture.** Eight screens mirror pipeline
   stages. The only conversation is on My profile. There is no persistent
   assistant, which is the core of the adopted direction. This is structural.
2. **The overview spends its best space on marketing.** The hero ("Your story
   deserves the right opportunity") and stat tiles sit above the fold; what
   needs attention now (follow-ups, blocked tasks, new roles) is elsewhere.
3. **Type is too small.** 67 font-size declarations are 8–11px and most body
   text is 11–12px, with low-contrast muted greys. That is a readability and
   accessibility problem.
4. **The job drawer is overloaded.** Four tabs and long scrolls; the Timeline
   tab now holds three forms plus history.
5. **Toasts cover primary actions** (Save my profile; mobile headings).
6. **The code cannot carry the new interface.** `app.js` (391 lines of
   single-line templates) re-renders the whole app through `innerHTML` with
   focus and scroll restoration workarounds, tracks every form draft by hand
   and polls every 2.2 s. The stylesheet is one 21 KB line with 209 hard-coded
   colours and a separate 165-line dark-mode override layer instead of tokens.
   Streaming chat, partial updates and reusable panels do not fit this model.

### Verdict

Keep the brand; **rebuild the front end.** The visual identity is good. The
structure and the code are not right for a conversation-first product.

### Rebuild specification

- **Stack (decision gate D1):** Preact + htm as vendored local ES modules in
  `plainhand/web/vendor/`. No build step, compatible with the current
  `script-src 'self'` CSP, about 5 KB, keyed diffing that preserves focus and
  input state. Server-sent events replace polling for state and streamed
  replies. Alternative considered: Vite + React (adds a build toolchain; not
  needed yet).
- **Layout:** slim navigation · **conversation** (primary, centre) ·
  **context panel** (right) showing what is being discussed: job, evaluation,
  packet document, application record, form assistance. Mobile: conversation
  full screen; the panel opens as a sheet.
- **Home:** briefing card + conversation. Existing screens become panels or
  secondary pages: Jobs, Applications (tracker + follow-ups), Profile & brain,
  Activity & usage, Connections, Workspace.
- **Design system:** CSS custom-property tokens for colour, type, spacing and
  radius; light and dark defined as token sets; 14px body, 12px minimum,
  WCAG AA contrast.
- **Components:** Message, StreamingMessage, BriefingCard, ProposalCard
  (grouped writes: Save all · Edit · Undo), TaskCard (progress, cancel,
  retry), JobPanel, EvaluationPanel, DocumentPanel, RecordPanel,
  FormAssistPanel, a toast region that never overlaps actions.
- **Parity:** every current capability remains reachable without the agent.
  The sample workspace remains. UI test selectors are migrated, not dropped.

## Milestones

Delivered on 2026-10-25: M0, M1, M2, M2b (streaming; session reuse deferred), M3, M4, M5, M6. M7: hardening, data contract, exports and the opt-in live check are done; the live run itself is pending (see the [verification matrix](VERIFICATION-MATRIX.md)).

Each milestone ends with: full suite green, screenshots where UI changed, docs
updated, commit and push, and a short report.

| # | Milestone | Depends on | Delivers | Done when |
| --- | --- | --- | --- | --- |
| M0 | Direction and plan | none | Revised direction, landscape, goal, this plan | Docs merged (this commit) |
| M1 | Action registry | M0 | `plainhand/actions.mjs`; routes for record, jobs/update, sources, tasks, corrections-propose and state reads call it | Route behaviour unchanged (existing tests pass); registry tests cover schema validation and tier enforcement |
| M2 | Agent engine | M1 | `plainhand/agent.mjs`: digest builder, catalogue prompt, `{ say, actions }` validation, batched reads, grouped writes, budgets, taint, audit, `data/plainhand/conversation.jsonl`; API `agent/message`, `agent/confirm`, `agent/undo`, SSE `agent/stream` | Scripted-conversation and injection suites pass with the fixture agent; budgets and taint tested |
| M2b | Streaming providers | M2 | Streaming in `executeAgent` for Claude (`stream-json` + partial messages); Codex `exec --json` emits whole messages, so it does not stream. Session reuse is deferred to M7 because it can only be proven against a signed-in CLI | Fixture streaming test; usage metering still correct (done) |
| M3 | Front-end foundation | M0 (parallel with M1–M2) | Vendored Preact/htm, tokens, shell (nav · conversation · panel), SSE state, all current screens ported as panels/pages | UI workflow test passes on the new shell at feature parity; light/dark/mobile screenshots reviewed |
| M4 | Conversation UI | M2, M3 | Messages, streaming, briefing, proposal and task cards, agent-opened panels | Working-state items 1–4 pass in the browser test |
| M5 | MCP server | M1 (parallel with M2–M4) | `plainhand-mcp.mjs` (stdio) over the registry; setup docs for Claude Code and Codex | In-process MCP client test: reads, a reversible write, candidate-only returns a link |
| M6 | Conversational onboarding | M2, M4 | Profile interview inside the conversation; correction proposals approved in the panel | New-candidate scripted test builds a reviewed profile by conversation |
| M7 | Hardening and live validation | M4–M6 | Latency metrics, verification matrix update, opt-in live smoke on a real CLI | Working-state checklist complete; live smoke run on the candidate's machine |

Critical path: **M1 → M2 → M4**. M3 runs alongside M1–M2; M5 alongside M2–M4.

## Execution model

### Roles

- **Main session (orchestrator):** owns architecture, the registry and agent
  contracts, decision gates, code review, integration, full-suite runs, docs
  and pushes. Writes the interfaces before parallel work starts.
- **Subagents (workers):** each takes one workstream with a written brief,
  works in its own git worktree, and returns a branch plus a report. They do
  not push.
- **Explore agents:** read-only codebase questions when a sweep is needed.

### Planned delegation

| Workstream | Who | When | Isolation |
| --- | --- | --- | --- |
| M1 registry | Main session | First | Main branch |
| M2 agent engine | Main session | After M1 | Main branch |
| M3 front-end foundation | Worker A | Starts with M1 | Worktree; owns `plainhand/web/**` and `test-plainhand-ui.mjs` |
| Scripted-conversation + injection suites | Worker B | Once the M2 contract is written | Worktree; owns new test files and fixture extensions |
| M5 MCP server | Worker C | After M1 merges | Worktree; owns `plainhand-mcp.mjs` and its test |
| M4 conversation UI | Worker A, then main review | After M2 and M3 | Worktree |
| M6 onboarding | Main session | After M4 | Main branch |

### Parallel worktrees

Parallel work runs in separate git worktrees so each stream edits its own
files on its own branch and runs the full test suite at the same time as the
others. The layout (set up 2026-10-25; verified by running the core suite in
all three worktrees concurrently plus the browser workflow test):

| Folder | Branch | Owner | Workstream | May change | Must not change |
| --- | --- | --- | --- | --- | --- |
| `plainhand/` (main checkout) | `claude/sharp-turing-i3j2qi` | Orchestrator | M1, M2, M6, integration | Everything, via reviewed merges | — |
| `.worktrees/frontend` | `wt/frontend` | Worker A | M3, then M4 | `plainhand/web/**`, `test-plainhand-ui.mjs`, UI sections of `docs/PLAINHAND-BROWSER-APP.md` | Server, `plainhand/*.mjs` logic, other tests |
| `.worktrees/agent-tests` | `wt/agent-tests` | Worker B | Scripted-conversation and injection suites | New `test-agent-*.mjs` files; `plainhand/test-fixtures.mjs` (additive only) | Production code |
| `.worktrees/mcp` | `wt/mcp` | Worker C | M5 | `plainhand-mcp.mjs`, `test-plainhand-mcp.mjs`, `docs/MCP.md`, `package.json` (dependency and script only) | Registry, server routes |

Rules:

- `.worktrees/` is excluded locally (`.git/info/exclude`), never committed.
  Worker branches stay local; only the designated branch is pushed.
- Worktrees sit inside the checkout, so Node resolves the shared
  `node_modules`; a worker that adds a dependency installs it in its own
  worktree and lists it in its report.
- `. .worktrees/env.sh` sets the shared browser path; headed tests run under
  `xvfb-run -a`. Tests use temporary workspaces and port 0, so concurrent runs
  do not collide.
- After each merge the orchestrator brings the designated branch into every
  active worktree (`git -C .worktrees/<name> merge claude/sharp-turing-i3j2qi`)
  so workers build on current contracts.
- Ownership changes only through the orchestrator. A worker that needs a
  change outside its files asks in its report instead of making it.
- The cloud container is ephemeral: worktrees exist only for the session.
  To recreate them, run
  `git worktree add -b wt/<name> .worktrees/<name> claude/sharp-turing-i3j2qi`
  for each row, then recreate `env.sh` from this section.

### Every worker brief contains

1. The milestone section of this plan and the relevant direction section.
2. File ownership: what it may change, and what it must not.
3. The contracts it builds against (registry action shape, agent API, SSE
   events), written by the orchestrator first.
4. Test commands, including this environment's browser setup
   (`PLAYWRIGHT_BROWSERS_PATH` alias and `xvfb-run` for headed tests).
5. Its done criteria, and the instruction to report failures, not hide them.

### Integration gates

Before a worker branch is merged: diff review (the `code-review` skill at high
effort for registry, agent and MCP code), the full suite, screenshot review for
UI work, and a check that no guardrail test was weakened. Merges land on the
designated development branch, which is the only branch pushed.

### Decision gates for the candidate

| Gate | Question | Recommendation |
| --- | --- | --- |
| D1 | Front-end stack | Preact + htm, vendored, no build step |
| D2 | Conversation retention | Last 500 messages, clearable |
| D3 | MCP write access | Reads and reversible writes on; tasks off by default |
| D4 | When to run live validation | After M4, on the candidate's machine with Claude |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Providers return malformed or off-catalogue JSON | Strict validation; one repair retry; otherwise the turn reports failure |
| Conversation feels slow | Digest first, batched reads, streaming, session reuse, budgets |
| Front-end rewrite regresses guarantees | Port behind the existing API; migrate the full browser workflow test before deleting old code |
| Prompt injection via job content | Taint rule, tier enforcement in code, adversarial suite |
| Scope creep | Milestone done criteria; Phase 6 and auto-submission stay out |
| Parallel workers conflict | Strict file ownership; contracts first; orchestrator merges |
| Recruiter-facing drafts read as AI-written | Agent drafts follow the drafter → reviewer path the packet uses, and the repository's humanizer process for any text sent to employers |
