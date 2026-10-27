# Plainhand: the conversational agent layer

**Status:** Adopted product direction; not an implementation claim
**Updated:** 2026-10-25 (revised after critique and market review)
**Related:** [Agent build plan](AGENT-BUILD-PLAN.md),
[Candidate brain and autonomy](CANDIDATE-BRAIN-AND-AUTONOMY.md),
[buildout goal](PRODUCT-BUILDOUT-GOAL.md),
[competitive landscape](COMPETITIVE-LANDSCAPE.md),
[browser app](PLAINHAND-BROWSER-APP.md), [operating guide](../OPERATING_GUIDE.md)

## One line

**Plainhand is what's true and what's allowed. The agent is how you talk to it.**

Plainhand becomes an assistant you work with, not a set of forms you operate.
You describe what you want in plain language; an agent running on your own AI
subscription works out which Plainhand actions to take, explains itself, asks
when something is unclear, tells you what needs attention before you ask, and
carries the work forward. Every action goes through Plainhand's existing checks,
so the agent can be flexible about what you ask without being able to bend the
rules.

This document does not change the operating guide's manual final-submission
rule or any other boundary. It changes how the candidate reaches the product.

## Why this direction, and why now

Today the only real conversation in Plainhand is the profile interview.
Everything else is fill a form, click, wait. That is rigid (a request nobody
built a screen for cannot be made), effortful (the candidate translates intent
into fields) and opaque (reasoning is shown, not discussed).

The market moved in 2026 (details in the
[competitive landscape](COMPETITIVE-LANDSCAPE.md#october-2026-update-the-agent-shift)):

- General personal agents (OpenAI, Google, Meta, Microsoft, Claude in Chrome)
  now draft, research and fill simple forms. They have no job feed, no saved
  application profile, no history, and stall on logins, CAPTCHAs and long ATS
  forms.
- Job platforms now live inside assistants (the Indeed app in ChatGPT; an
  Indeed connector for Claude). Applying still happens on the platform.
- Conversation-first matching works: Jack & Jill's 20-minute AI interview is
  its whole product.
- Open-source tools (moonlighter, JobForge) expose job-search tools over MCP
  to the user's own agent.

**Conclusion:** a chat about your job search is no longer differentiating.
What nobody else has is Plainhand's foundation: an evidence-backed candidate
brain, fact-checked packets, one canonical record per application, local data
and guardrails enforced in code. Plainhand should be that foundation, reachable
from its own conversation **and** from the agents people already use.

## The two layers

| | Plainhand (foundation) | Agent (layer on top) |
| --- | --- | --- |
| Role | Does the work and enforces the rules | Understands intent and drives the work |
| Owns | Profile, evidence, jobs, packets, tracker, application records, browser sessions, audit log | The conversation, a plan for the current request, explanations |
| Decides | What is valid, what needs approval, what is blocked | Which allowed actions to propose next |
| Can never | Be bypassed | Write files, invent claims, approve for you, submit |
| Without the other | Still fully usable through its screens | Has nothing to act on |

Guardrails are enforced in Plainhand's code, not in the agent's prompt. A
misunderstanding produces a proposal the candidate declines, never a silent
change, an unsupported claim or a submission.

## Three front doors, one action registry

```
            Screens & buttons ─┐
 In-app conversation (your sub) ─┼─► Action registry ─► existing Plainhand logic + guardrails
 Local MCP server (Claude, Codex) ─┘   one definition     tracker, packets, record, audit
                                       per action; tier
                                       enforced here
```

- **Action registry** (`plainhand/actions.mjs`): each capability is defined once
  with a name, description, input schema, confirmation tier, context needs and
  handler. Server routes, the in-app agent and the MCP server all call it.
  Button and agent behaviour cannot drift apart.
- **In-app conversation:** Plainhand runs the agent loop on the selected CLI
  with that CLI's tools still switched off, exactly as today
  (`plainhand/agents.mjs`). The model only chooses actions; Plainhand executes.
- **Local MCP server** (`plainhand-mcp.mjs`, stdio): the same registry for
  Claude Desktop, Claude Code and Codex users who prefer their own agent.
  Candidate-only actions return a link to the right Plainhand screen instead of
  running. Hosted MCP (needed for consumer ChatGPT) conflicts with local-first
  and is out of scope until a privacy design exists.

### Not LangChain or per-token APIs

Frameworks such as LangChain normally call models through developer API keys
billed per token. That conflicts with bring-your-own-subscription and adds a
large dependency for a loop Plainhand can own. An API-key provider may be added
later as a separate, explicitly chosen path.

## What the product feels like

The conversation is the main way in; screens are where you read and sign off.

| Stage | You might say | The agent does | Plainhand enforces / screen still needed |
| --- | --- | --- | --- |
| Open the app | (nothing) | Briefs you: new roles, overdue follow-ups, next interview, blocked tasks | Briefing is computed from your data, no model call |
| Build profile | "Let me tell you about my robotics project." | Interviews you, asks follow-ups, proposes profile edits with sources | Edits are proposals until approved; review the understanding summary |
| Find jobs | "New-grad mechanical roles near Boston, nothing too senior." | Runs discovery, filters, explains what it skipped | Dedupe, liveness, no job is started automatically |
| Evaluate | "Why only 3.8? I did do CAD work." | Explains the score from evidence; turns your answer into role context and re-evaluates | Every match needs an exact source quote; below 4/5 needs your recorded reason |
| Decide | "Skip that one. Prepare the second." | Records the decision and starts preparation | Only exact roles you select can be prepared |
| Tailor | "Lean the cover letter on testing, not design." | Regenerates with that emphasis, shows what changed | Factual reviewer runs; unsupported claims block the packet |
| Review | "Show me the resume." | Opens the document panel and summarises changes | **You read and approve on screen.** Approval binds to the exact packet |
| Apply | "Fill the Acme form." | Opens, inspects and autofills to final review; reports gaps | Sensitive fields need on-screen confirmation; **you submit** |
| Track | "Had the screen with Dana, she wants references Friday." | Proposes an interview round, a contact and a next action due Friday | Recording an interview never changes status by itself |
| Follow up | "Draft a thank-you to Dana." | Drafts from the submitted packet only | Drafts are never marked as sent |
| Learn | "Are my high scores getting interviews?" | Reports calibration with its evidence limits | Insufficient data is stated; suggested changes need approval |

## How a conversational turn works

1. The candidate sends a message (or opens the app, which triggers the briefing).
2. Plainhand sends the provider: recent conversation, a **compact workspace
   digest** (jobs with stage/score/status/next action, follow-up queue, open
   tasks), and the action catalogue with input schemas.
3. The provider returns one JSON reply: `{ say, actions: [] }`. `actions` may
   hold several **read** actions in one reply, plus at most one write group or
   one task.
4. Plainhand validates every action against the registry, runs reads
   immediately and feeds results back, groups writes into one confirmation
   card, and queues tasks through the existing journal.
5. Repeat until the reply has no actions, a confirmation is pending, or a
   budget is reached.

### Making it feel fast

One CLI call per step would be slow (each spawns a process and resends
context) and would spend the candidate's subscription allowance.

- **Digest first:** most questions ("what's due this week?") are answerable
  from the digest with zero lookups.
- **Batched reads:** several reads per model reply.
- **Streaming:** `say` text streams to the UI as it arrives
  (Claude `stream-json`, Codex `--json` events).
- **Session reuse:** keep a CLI session open between steps where the provider
  supports it; fall back to stateless calls elsewhere.
- **Budgets:** per turn, at most 4 model calls and 12 actions; the agent then
  stops and reports what remains.

## Confirmation tiers

The tier is a property of the action, set in code, never chosen by the model.

| Tier | Behaviour | Examples (existing API) |
| --- | --- | --- |
| **Read** | Runs immediately | Workspace digest, a job's evaluation and evidence, follow-up queue, usage, audit (`/api/state`) |
| **Reversible write** | Grouped into one card ("3 changes · Save all · Edit"); saved on accept; undo available afterwards | Next action, contacts, interview rounds (`/api/jobs/record/*`); select/deselect, role context, override reason (`/api/jobs/update`); add/remove a source |
| **Task** | Shown with what it will send to the provider; runs as a journaled, cancellable task | Discover, evaluate, prepare (`/api/tasks`) |
| **Candidate-only** | Agent opens the right panel and explains; the candidate performs it | Approve understanding, approve a packet, approve corrections, sensitive form answers, take over the browser, mark `Applied` |
| **Never** | Not in the registry | Final submission, direct file writes, provider/credential changes, editing `cv.md` or profile without an approved proposal |

Profile edits from conversation go through the existing correction flow
(`/api/corrections/propose`): the agent proposes, the candidate approves.

## Safety

- **Injection taint:** a turn whose context included untrusted text (job
  pages, imported files, pasted emails) is *tainted*. Every write it proposes
  needs explicit confirmation and shows which untrusted source was in context.
  Untrusted text is never instructions.
- **No tier escalation:** chaining actions cannot reach a candidate-only result.
- **Audit:** every agent action is written to the audit log with the
  originating message, the action, its inputs and its result.
- **Resumability:** an interrupted turn leaves a visible state; nothing is
  half-applied silently. Provider failure never routes to another provider.
- **Context scoping:** contacts and interview notes stay out of provider
  context unless the current request needs them (for example, drafting a
  thank-you to a named contact), and that inclusion is shown.

## Memory

- Conversation history is stored per workspace in
  `data/plainhand/conversation.jsonl`, separate from the profile interview.
  Default retention: last 500 messages; clearable from Workspace settings.
- Only the candidate's own statements can become evidence, and only through an
  approved correction or role context, never by being said in chat.

## Testing the agent

- **Scripted conversations:** fixture conversations with the synthetic agent
  and expected proposed actions (extends `plainhand/test-fixtures.mjs`).
- **Adversarial suite:** job descriptions and imports containing injected
  instructions; the suite asserts no unconfirmed write and no tier escalation.
- **Live smoke:** opt-in real-provider run, like `test-plainhand-live.mjs`.

## How to tell it's working

- **Effort:** time and clicks from a pasted link to a reviewed packet.
- **Reach:** share of requests completed without falling back to a form.
- **Latency:** median time to first streamed token and to turn completion.
- **Trust:** proposals accepted vs declined; corrections the candidate made.
- **Safety:** zero actions outside the registry; zero unconfirmed tainted
  writes; zero candidate-only results reached by the agent (tested).
- **Profile building:** facts captured in the candidate's words, nothing
  invented, one question at a time (`benchmark:profile`).

Which of these are measured today, and how, is in the
[metrics inventory](METRICS-INVENTORY.md).

## Voice

Voice is input, not a separate mode. Today it needs no Plainhand code: a local
push-to-talk dictation app such as [Handy](https://handy.computer) transcribes
offline (Whisper or Parakeet models) and types into the chat composer. Typed
and spoken turns go through the same proposal and confirmation rules.

If Plainhand later speaks replies back, that needs a text-to-speech model, not a
transcription model. Bark is text-to-speech and too slow for conversation;
Kokoro (GPU) or Piper (CPU) are the local options to evaluate. Built-in
speech-to-text in the app is a later option, only if dictation apps prove
awkward.

## Open decisions

- Whether Antigravity's plan mode supports the JSON action loop reliably.
- Session-reuse mechanics per CLI, and their effect on usage metering.
- Whether and how to offer a hosted MCP endpoint for ChatGPT without breaking
  local-first.
- Automatic submission remains a separate decision under
  [Candidate brain and autonomy §5](CANDIDATE-BRAIN-AND-AUTONOMY.md); the agent
  layer does not imply it.
