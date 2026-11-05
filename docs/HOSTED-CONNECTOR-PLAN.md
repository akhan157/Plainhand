# Hosted Plainhand as a ChatGPT / Claude connector

**Branch:** `hosted-connector` · **Status:** in progress

## Goal

A candidate who has never opened a terminal can use Plainhand with the ChatGPT
or Claude subscription they already pay for. They:

1. Open the Plainhand website and sign in.
2. In claude.ai or ChatGPT, add Plainhand as a connector (paste one URL, click
   **Allow**).
3. Talk to Plainhand from that chat.

Nothing to install, no API key, no CLI.

## Why a connector, and not a hosted CLI

The local app runs `claude -p` / `codex exec` on the candidate's own computer
under their own sign-in. A hosted server cannot do that on their behalf:
holding someone's consumer-subscription login on our server and running
requests with it is not permitted by the providers, and it would make us a
credential store. A remote MCP connector is the supported way for a third-party
service to work inside a subscription: the model runs in the provider's app,
on the candidate's plan, and calls our tools.

Consequence: **our server never calls a model.** Every model step is done by
the candidate's chat model and handed back to us through a tool call.

## Architecture

```
claude.ai / ChatGPT ──(MCP over HTTPS, OAuth bearer)──▶ plainhand-cloud
   (candidate's model)                                    │
                                                          ├─ OAuth 2.1 authorization server (DCR + PKCE)
browser ──(session cookie)──▶ plainhand-cloud web UI      ├─ action registry (plainhand/actions.mjs, unchanged)
                                                          ├─ workflow (plainhand/workflow.mjs) with a
                                                          │  "deferred agent" (see below)
                                                          ├─ PDF rendering (headless Chromium)
                                                          └─ Postgres: users, oauth, per-user workspace files
```

### 1. Per-user storage (step 1, this branch first)

`Workspace` reads and writes workspace-relative paths (`data/plainhand/workspace.json`,
`cv.md`, `config/profile.yml`, …). We make the byte store pluggable:

- `FileStorage`: today's behaviour, unchanged for the local app.
- `MemoryStorage`: for tests.
- `PostgresStorage`: table `workspace_files(user_id, path, content bytea, updated_at)`.

Every direct `fs` call against workspace paths in the core path (PDF write/read
in `workflow.mjs`, usage receipts in `usage.mjs`, artifact download in the
server) moves onto `workspace.readBinary/writeBinary/list`. Features that hand a
root directory to `lib/` modules (Insights, Campaigns, remote view) stay
local-only in v1.

Concurrency: `Workspace.mutate` serializes in-process. v1 runs one instance;
mutations also take a per-user Postgres advisory lock so a second instance
cannot interleave writes.

### 2. Sign-in

- Candidate identity: **Sign in with Google** plus an email magic link, via
  Supabase Auth. No passwords stored by us.
- Plainhand cloud is its own **OAuth 2.1 authorization server** for MCP
  clients (MCP SDK `mcpAuthRouter`): dynamic client registration, PKCE,
  short-lived access tokens, refresh tokens, revocation. The authorize page
  requires a signed-in Plainhand session and shows an Allow screen.
- Connected apps are listed on the website with a **Disconnect** button.

### 3. The connector (MCP over Streamable HTTP)

`/mcp` exposes the same tools as `plainhand-mcp.mjs` today, generated from the
registry, scoped to the signed-in user, with the same tier rules:

- `read` / `write` tools as today (writes audited, undo tokens).
- `candidate` tier still refused: approvals, "I submitted", widening context.
  The tool returns a link to the right page of the Plainhand website.
- `task` tier becomes **runnable** through the step protocol below.

### 4. Model steps: the deferred agent

`Workflow` takes an injectable `agent(provider, instruction, data, opts)`.
In the cloud it is a deferred agent:

1. The chat model calls e.g. `plainhand_tasks_evaluate { jobId }`.
2. The workflow runs until its first model call. The deferred agent parks that
   call as a **step** `{ stepId, purpose, instruction, data }` and the tool
   returns it to the chat model.
3. The chat model does the work and calls `plainhand_submit_step { stepId, result }`.
4. The workflow resumes with that result, running the same validation as
   today (exact source quotes, schema, evidence checks), until the next model
   call (returned as the next step) or completion (returned as the outcome).

Invalid results are rejected with the specific error so the model can fix and
resubmit, within the workflow's normal attempt limits. Steps expire after 15
minutes. A server restart marks the task interrupted (existing behaviour), and
it can be retried.

**Independent review.** Locally the factual review is a separate model call
with no memory of drafting. In a chat it runs in the same conversation. To
reduce bias, the review step's instruction says to judge only the packet
against the quoted sources. The deterministic checks (every claim has an exact
quote from the sources) still run on the server and cannot be talked past. The
website labels cloud packets "reviewed in your chat".

### 5. Website (no AI on it)

The existing Preact UI, served with a session cookie instead of the local
token: profile and resume upload, jobs, packet review and **Approve**, PDF
download, application record, **I submitted this**. The Assistant panel and
Connections screen are replaced by a **Connect to ChatGPT / Claude** page with
the connector URL and step-by-step instructions for each app.

### 6. What the cloud version does not do (v1)

- **Form filling in a browser.** It needs the candidate's visible browser.
  Cloud gives copy-ready answers and PDF downloads. A browser extension can
  come later.
- Insights, Campaigns, remote view, local CAPTCHA solver.
- Posting liveness is checked server-side in headless Chromium. Login-walled
  postings ask the candidate to paste the description.

### 7. Hosting

One container (Node 22 + Chromium + Poppler) on a host that runs long-lived
processes (Fly.io or Render), with Supabase Postgres + Auth. Vercel is not a
fit for the core server because of Chromium and the in-memory parked steps.

## Steps

1. **Pluggable workspace storage** + tests (local behaviour unchanged).
2. Cloud server skeleton: Supabase session sign-in, per-user `Workspace`,
   web UI behind a cookie session.
3. OAuth authorization server + `/mcp` (read/write tools) scoped per user.
4. Deferred agent + `submit_step`; task tools runnable from chat.
5. Website changes: Connect page, cloud labels, hide local-only features.
6. Container image, deployment, privacy and data-deletion page, account
   deletion that removes every row.
7. End-to-end test with claude.ai and ChatGPT custom connectors.
