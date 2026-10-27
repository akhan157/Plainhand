# Plainhand agent contracts

**Status:** Contract for parallel work (M1–M5). Changes only through the orchestrator.
**Plan:** [Agent build plan](AGENT-BUILD-PLAN.md) · **Direction:** [Agent layer](AGENT-LAYER-DIRECTION.md)

Workers build against these shapes. Anything marked *(M1)* or *(M2)* is
implemented by the orchestrator in that milestone; until then, front-end work
uses the existing routes and the event stream, which already exist.

## 1. Live event stream (available now)

`GET /api/events?token=<session token>` returns `text/event-stream`.
`EventSource` cannot set headers, so the token goes in the query string.

| Event | Data | When |
| --- | --- | --- |
| `state` | `{ revision }` | On connect, then after every committed workspace change |
| `tick` | `{ at }` | Every 5 s; refetch `/api/state` if the page is visible (catches edits made outside Plainhand) |
| `agent.turn` *(M2)* | `{ turnId, status: 'running' }` | A turn starts |
| `agent.delta` | `{ turnId, call, text }` | Streamed `say` text for model call `call` of the turn, appended in order. Claude only (stream-json with partial messages); other providers send no deltas, only the final `agent.message`. A new `call` number starts a new partial text |
| `agent.message` *(M2)* | `{ turnId, message }` | A complete message record (see §4) |
| `agent.proposal` *(M2)* | `{ turnId, proposal }` | Writes awaiting confirmation (see §4) |
| `agent.task` *(M2)* | `{ turnId, taskId, kind, jobId }` | The agent queued a task |
| `agent.panel` *(M2)* | `{ turnId, panel: { type, id } }` | The agent asks the UI to open a panel |
| `agent.done` *(M2)* | `{ turnId, status: 'complete' \| 'needs-confirmation' \| 'budget' \| 'failed' \| 'canceled' }` | A turn ends |
| `agent.error` *(M2)* | `{ turnId, error }` | A turn fails; the message is shown to the candidate |

Clients must tolerate unknown event names. `GET /api/state` remains the full
state read; events say *when* to read it.

Static files: any file under `plainhand/web/` with extension `.html .js .mjs
.css .svg .json .woff2 .png` is served at its path (`/vendor/preact.mjs`).
Dotfiles and traversal are rejected. `index.html` receives the session token.

## 2. Action definition *(M1)*

`plainhand/actions.mjs` exports `createRegistry(deps)` returning a registry of
action definitions:

```js
{
  name: 'record.setNextAction',          // dotted, stable, used by UI, agent and MCP
  title: 'Set next action',              // short human label for cards
  description: 'Set or clear the dated next step for one application.', // shown to the model
  tier: 'write',                         // 'read' | 'write' | 'task' | 'candidate'
  input: { jobId: 'string', text: 'string?', due: 'date?' }, // lite schema, see below
  summarize: input => 'Next action for Acme: send references, due 2026-10-31', // proposal card line
  panel: input => ({ type: 'job', id: input.jobId }), // candidate tier: where the candidate does it
  run: async (ctx, input) => result | { result, undo?, taintSources? },
  // run may return an undo closure (reversible writes); the registry turns it into an undoToken.
}
```

Lite schema types: `string`, `number`, `boolean`, `date` (YYYY-MM-DD),
`string[]`, `enum:a|b|c`, `object`. A trailing `?` marks optional. Unknown
keys are rejected.

Registry API:

```js
registry.list({ tiers })                 // definitions without run/undo
registry.get(name)
await registry.run(name, input, { actor, confirmed, reason })
// actor: 'ui' | 'agent' | 'mcp'; confirmed: the candidate accepted this action in a proposal
// returns { result, undoToken | null, taintSources: [{ kind, id, label }] }
await registry.undo(undoToken)   // single use, 10 minutes, refused if the data changed since
registry.summarize(name, input)  // one-line proposal text
```

Errors are `ActionError` with `code`:

| Code | Meaning |
| --- | --- |
| `unknown_action` | Not in the registry |
| `invalid_input` | Fails the lite schema |
| `candidate_only` | Tier `candidate` called with actor `agent` or `mcp`; carries `panel` (`{ type, id }`) for the UI to open, which MCP turns into a Plainhand link. Also `jobs.setStatus` to `Applied` |
| `confirmation_required` | Tier `write` or `task` called by `agent` without `confirmed`, or tier `task` called by `mcp` |
| `failed` | The underlying logic threw; `message` is shown as-is |

Tier rules (enforced in `registry.run`, never by the caller):

| Tier | `ui` | `agent` | `mcp` |
| --- | --- | --- | --- |
| `read` | runs | runs | runs |
| `write` | runs | only via a confirmed proposal | runs (decision D3) |
| `task` | runs | only via a confirmed proposal | refused by default (D3) |
| `candidate` | runs | refused with `panel` | refused with `panel` (MCP renders a Plainhand link) |

### Initial action names

| Tier | Actions |
| --- | --- |
| read | `workspace.digest`, `jobs.list`, `jobs.get`, `followups.list`, `audit.list`, `usage.summary`, `profile.get`, `profile.strength` (taints the turn when it returns gaps written from postings), `line.get` (where the candidate draws the line on wording), `context.get` (what the provider receives), `answers.list` |
| write | `context.exclude` (narrowing what is shared; clears approvals through the context fingerprint), `profile.addStory` (text must be the candidate's own words), `line.addStatement` (the candidate's own words about how strongly their experience may be worded), `profile.addWritingSample` (the candidate's own text, for voice), `profile.update` (location, roles, graduation, phone, timezone, links, story, voice, constraints; never work authorization or compensation), `record.addContact`, `record.removeContact`, `record.addInterview`, `record.setInterviewStatus`, `record.removeInterview`, `record.setNextAction`, `jobs.add`, `jobs.select`, `jobs.setContext`, `jobs.setStatus` (never `Applied`), `sources.add`, `sources.remove`, `corrections.propose` |
| task | `tasks.interview`, `tasks.discover`, `tasks.evaluate`, `tasks.prepare`, `tasks.standard` (write the standard application), `tasks.revise` (change a packet or the standard as the candidate asked, in their words), `tasks.cancel` |
| candidate | `context.include` (widening what is shared), `answers.update`, `answers.remove`, `understanding.approve`, `calibration.decide` (use the suggested wording or keep their own for a flagged claim; unsupported claims can't be kept), `line.removeStatement`, `standard.approve`, `settings.autonomy` (preparing strong matches on its own; off by default), `jobs.setApplyLink` (the employer's link for a job-board posting), `profile.removeWritingSample`, `packet.approve`, `corrections.approve`, `corrections.reject`, `jobs.confirmSubmitted` |

Browser form assistance (`/api/browser/*`: open, autofill, fill, attention,
resume, handoff) stays on its existing routes in the form panel. It is
candidate-driven and is not reachable by the agent or MCP; the agent can only
open the form panel (`ui.openPanel`).

`ui.openPanel` is handled by the agent engine, not the registry: a read-tier
agent action with no server effect that emits `agent.panel`
(`type: job | packet | record | form | profile | applications | discover | workspace`, optional `id`).

`jobs.get` returns `taintSources` for every untrusted part it includes:
`job` (posting text), `evaluation` and `packet` (model output derived from the
posting), `record` (contact and interview notes). `include: ['record']` gives a
reduced record (contact names, roles and types; interview stages, dates,
statuses and interviewers; next action). Contact email, phone, links and
notes, and interview notes, need `include: ['recordDetails']`, which marks the
turn so its proposal card shows that they were read.

`jobs.setStatus` with `status: 'Applied'` is treated as candidate-only by the
engine (`registry.candidateOnly(name, input)`): it is never proposed, only a
panel is opened. `confirmed` must be exactly `true`. Undo of an agent or MCP change is audited as `<actor>-undo`.

HTTP for the UI: `POST /api/action { name, input }` →
`200 { ok: true, result, undoToken }` or `400 { error, code }`, actor `ui`.
`POST /api/action/undo { undoToken }` → `200 { ok: true, name }`.
Agent and MCP actions above read tier are written to the audit log as
`agent-write`, `agent-task`, `mcp-write` with the action name and summary.
Existing routes keep working and call the registry internally.

### MCP bridge (available now)

Plainhand stays the only process that writes the workspace. A local MCP server
forwards tool calls to the running Plainhand server:

- On listening, the server writes `data/plainhand/local-api.json` (mode 0600)
  with `{ port, mcpToken, pid, startedAt }`, and removes it on shutdown.
- Requests send `X-Plainhand-MCP-Token: <mcpToken>` to `127.0.0.1:<port>`.
  The UI session token is not accepted here, and vice versa.
- `GET /api/mcp/actions` → `{ actions }` (read, write and candidate tiers;
  tasks are not offered).
- `POST /api/mcp/action { name, input, reason? }` → `{ ok, result,
  undoToken, taintSources }`, actor `mcp`; errors are `400 { error, code,
  panel? }`. `reason` is recorded in the audit entry.
- `POST /api/mcp/undo { undoToken }` → `{ ok, name }`, audited as `mcp-undo`.
- If the file is missing or the server does not answer, Plainhand is not
  running: tell the user to start it (`npm start`).

## 3. Workspace digest *(M1, `workspace.digest`)*

```js
{
  profile: { name, roles, ready: boolean, missing: string[], understanding: 'none' | 'needs-review' | 'approved' },
  provider: 'claude' | 'codex' | 'antigravity' | null,
  counts: { jobs, selected, prepared, applied },
  jobs: [{ id, company, title, location, stage, status, score, recommendation, selected,
           nextAction: { text, due } | null, upcomingInterview: { stage, date } | null }],
  followUps: [{ jobId, action, due, overdue, dueToday }],
  tasks: [{ id, kind, jobId, status, message }],   // queued/running/failed only
  attention: [{ kind, jobId?, text }]               // the briefing, computed, no model call
}
```

The digest never contains contact details, interview notes, job
descriptions or packet text. Those are fetched by `jobs.get` when an action
needs them, and their inclusion marks the turn tainted when they hold
untrusted text.

## 4. Agent turn protocol *(M2)*

HTTP:

| Route | Body | Returns |
| --- | --- | --- |
| `POST /api/agent/message` | `{ text }` | `202 { turnId }` |
| `POST /api/agent/confirm` | `{ turnId, proposalId, accept: boolean, edits?: { [index]: input } }` | `{ ok, results, undoToken? }` |
| `POST /api/agent/undo` | `{ undoToken }` | `{ ok }` |
| `POST /api/agent/cancel` | `{ turnId }` | `{ ok }` |
| `GET /api/agent/history?limit=50` | | `{ messages }` |

Message record (stored in `data/plainhand/conversation.jsonl`):

```js
{ id, turnId, role: 'user' | 'assistant', text, at,
  proposalId?, taskIds?, panel?, status?: 'complete' | 'needs-confirmation' | 'failed' }
```

Proposal:

```js
{ id, turnId, status: 'pending' | 'accepted' | 'declined',
  tainted: boolean, taintSources: [{ kind: 'job' | 'import', id, label }],
  actions: [{ index, name, title, tier, input, summary }] }
```

Turn rules as implemented (`plainhand/agent.mjs`):

- One turn at a time (`busy` otherwise); `POST /api/agent/clear` wipes history.
- Reads run immediately; rejected actions (unknown, invalid input) are fed
  back to the model so it can correct itself or explain.
- Writes become one proposal; a task is proposed alone; writes win over a task
  in the same reply. Candidate-only actions are never run or proposed: the
  engine emits `agent.panel` instead.
- A reply that would pass the 12-action budget is not run at all; after 4
  model calls the turn ends with status `budget`.
- `confirm` is single-flight per proposal. Each proposed action carries a
  `basis` fingerprint of the data it depends on (the record for `record.*`,
  the role's choice and context for `jobs.*`, the proposed fields for
  `profile.update`, sources, sharing choices). If it changed since the
  proposal, nothing is applied and the proposal becomes `stale` (error code
  `stale`). A group stops at its first failure and rolls back what it already
  applied; when the rollback is complete the proposal stays `pending` with
  `lastError` and the response has `retryable: true`. Only a group containing
  an irreversible change can end partly saved, and it says so. Edits are
  audited as edited. Undo tokens live in memory: they expire after 10 minutes
  and do not survive a restart. One composite `undoToken` reverses the group
  (10 minutes, newest first).
- Unreadable conversation or proposal files are reported (`corrupt`), never
  rewritten.

Model reply (validated strictly; one repair retry, then the turn fails):

```js
{ say: 'string', actions: [{ name: 'jobs.get', input: { jobId } }] }
```

A reply may contain any number of read actions, plus at most one group of
write actions or one task. Budgets per turn: 4 model calls, 12 actions.

## 5. Fixture agent *(M2, for Worker B)*

`plainhand/test-fixtures.mjs` gains `scriptedAgent(script)`: given a list of
`{ match: RegExp, reply }` steps, it returns the next matching reply for the
agent instruction, so tests can drive a conversation deterministically.

## 6. Feature modules

New capabilities plug in through `plainhand/features/index.mjs` (`FEATURES`),
so they never edit the server, workflow or registry core. A module may export:

| Export | Purpose |
| --- | --- |
| `name` | Stable id |
| `register({ define, workspace, workflow, usage, helpers })` | Define registry actions (same tiers and rules as core actions). `helpers`: `mutateJob`, `recordWrite`, `findJob`, `label`, `ActionError`, `buildDigest` |
| `tasks: { kind: { handler, needsProfile = true } }` | Task kinds run through the journaled, cancellable queue. `handler({ task, state, job, context, run, check, assertJob, workspace, signal, progress })`; `run(instruction, extra)` calls the provider with candidate context and usage metering |
| `attention(state)` | Extra briefing items `[{ kind, jobId?, text }]`; pure, and a throwing hook is ignored |
| `start({ workspace, workflow, registry, emit })` | Background work while the server runs; return an async `stop()` called on shutdown. Tests can pass `startFeatures: false` to `createPlainhand` |

Integration rules for feature modules:

- `GET /api/state` includes `featureAttention`: the digest's attention items
  whose kind is not a core kind (`CORE_ATTENTION` in `plainhand/actions.mjs`).
  Home shows them and routes by kind prefix: `campaign-*` to Campaigns,
  `insights-*` to Insights, `followup-*` to the role's Record tab.
- Feature tasks start through their own registry actions. `POST /api/tasks`
  accepts a feature task kind only as a retry (`retryOf`) of a failed task of
  that kind, reusing its input.
- Task commits apply only the fields a task changed (`taskChanges` in
  `plainhand/workflow.mjs`), so feature data on a job written while a task runs
  is kept.
- The agent can open `campaigns` and `insights` with `ui.openPanel`; MCP links
  resolve `record`, `insights` and `campaigns` panels.

