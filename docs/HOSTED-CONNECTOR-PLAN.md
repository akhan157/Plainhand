# Hosted Plainhand: Sign in with ChatGPT and the ChatGPT / Claude connector

**Branch:** `hosted-connector` · **Status:** in progress

## Goal

A candidate who has never opened a terminal can use Plainhand with the ChatGPT
or Claude subscription they already pay for. They:

1. Open the Plainhand website and sign in.
2. Connect their AI, either way:
   - **Sign in with ChatGPT** on the website (one button; Plainhand then works
     on the website itself, billed to their ChatGPT Go/Plus/Pro plan), or
   - **Add Plainhand to ChatGPT or Claude** as a connector and talk to it there
     (the only route for a Claude subscription).
3. Optional: add the Plainhand browser extension to fill application forms.

No terminal, no API key, no CLI. Both routes run the same workspace, checks and
approvals; a candidate can use both.

## Two AI routes, one foundation

| | Sign in with ChatGPT | Connector (ChatGPT or Claude) |
| --- | --- | --- |
| Where the candidate works | The Plainhand website | Their ChatGPT / Claude chat, plus the website for approvals |
| Who calls the model | Our server, with the candidate's ChatGPT plan token (Responses API) | The candidate's chat model, through tool calls |
| Workflow agent | `chatgptAgent` (direct call) | Deferred agent (step protocol, §4) |
| Independent review | Separate model call, as locally | Same conversation (§4) |
| Built-in assistant, Save cards, autonomy | Yes | No (the chat app asks to allow each tool call) |
| Availability | OpenAI approval required for hosted apps (interest form); limited trial | Now. One-click needs ChatGPT / Claude directory listing |
| Subscriptions | ChatGPT Go, Plus, Pro | ChatGPT (Developer Mode or directory), Claude (any plan, Free = 1 custom connector) |

Anthropic does not permit third-party apps to use a Claude subscription
directly, so Claude users always use the connector.

**Sign in with ChatGPT specifics** (preview limits): Responses API with
`store: false`, `stream: true`, full context in `input` each call, no
temperature or max-output-token fields, no hosted tools. Access tokens last
one hour, refresh tokens a 30-day sliding window; refresh tokens are stored
encrypted per candidate and revoked on disconnect or account deletion. The
candidate can cap or turn off plan usage per app on OpenAI's side; when the
cap is hit, Plainhand pauses tasks and says so rather than switching billing.

Everything else (storage, sign-in, website, extension, factual checks,
approvals) is shared.

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

Concurrency: `Workspace.mutate` serializes in-process only. On serverless,
concurrent requests run in separate instances, so each mutation runs in one
Postgres transaction holding a per-user advisory lock
(`pg_advisory_xact_lock`).

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
2. The workflow runs until its first model call. The deferred agent records
   that call as a **step** `{ stepId, purpose, instruction, data }` and the
   tool returns it to the chat model (see Hosting for how the task is
   replayed across stateless requests).
3. The chat model does the work and calls `plainhand_submit_step { stepId, result }`.
4. The workflow resumes with that result, running the same validation as
   today (exact source quotes, schema, evidence checks), until the next model
   call (returned as the next step) or completion (returned as the outcome).

Invalid results are rejected with the specific error so the model can fix and
resubmit, within the workflow's normal attempt limits. An unanswered step
expires after 2 hours; the task is then marked interrupted and can be retried.

**Independent review.** Locally the factual review is a separate model call
with no memory of drafting. In a chat it runs in the same conversation. To
reduce bias, the review step's instruction says to judge only the packet
against the quoted sources. The deterministic checks (every claim has an exact
quote from the sources) still run on the server and cannot be talked past. The
website labels cloud packets "reviewed in your chat".

### 5. Website

The existing Preact UI, served with a session cookie instead of the local
token: profile and resume upload, jobs, packet review and **Approve**, PDF
download, application record, **I submitted this**. The Connections screen
becomes **Connect your AI** with two choices: **Sign in with ChatGPT** (one
button) and **Add to ChatGPT / Claude** (connector URL with step-by-step
instructions per app). With Sign in with ChatGPT connected, the Assistant
panel and task buttons work on the website as they do locally; with only a
connector, task buttons say "Ask your chat to …" and the Assistant panel is
replaced by those instructions.

### 6. Browser extension: form filling

Form filling moves into a browser extension (Chrome/Edge, Manifest V3; Firefox
from the same code). The candidate is already on the employer's page in their
own browser, so there is no takeover step: they watch it fill and submit
themselves.

**Sign-in.** The extension is a public OAuth client of the same authorization
server as the connector (PKCE through `chrome.identity.launchWebAuthFlow`). It
never sees a password or a provider credential, and the website lists it under
connected apps with **Disconnect**.

**Flow.**

1. The candidate opens the employer's application page (Plainhand and the chat
   link to it).
2. The extension popup matches the page to the saved role by its application
   URL and shows the packet status. Filling requires an approved, current
   packet, the same gate as the local app.
3. **Fill this page.** The content script reads the form with the existing
   in-page extractor (`plainhand/adapters/upstream/extract.mjs`) and sends the
   field list to `/api/extension/plan`. The server answers with the same
   evidence-backed answers the local app uses (`suggestFormAnswers`, the
   answer bank, the approved packet) plus the presubmit check.
4. Fields with no supported answer are listed in the popup. The candidate
   types them, or asks the chat ("finish the form I have open"), which picks up
   a form step through the same step protocol (`FORM_INSTRUCTION`).
5. The content script fills text, selects, radios, checkboxes and comboboxes
   (existing `option-match`), and attaches the exact approved resume and
   cover letter PDFs to upload fields (`resume-label`). Sensitive fields
   (`field-policy`) are always left for the candidate.
6. **It never submits.** It clicks nothing except combobox openers and options.
   Every click target goes through the existing `submit-guard` classifier and
   is refused if it is a submit control. Multi-page forms: the candidate clicks
   **Next**, then **Fill this page** again.
7. After submitting, the candidate clicks **I submitted this application** in
   the popup, which records Applied. This is a candidate action from the
   candidate's own signed-in extension, never from the chat.

**Permissions.** `activeTab` + `scripting` (injected only when the candidate
clicks), `storage`, `identity`. No `<all_urls>` host permission and no
background page reading. Page text sent to the server is limited to field
labels, options and the page URL.

**Distribution.** Chrome Web Store (one-time $5 developer registration),
Edge Add-ons and Firefox Add-ons (free).

### 7. What the cloud version does not do (v1)

- Automatic navigation through multi-page forms (the candidate clicks Next).
- Insights, Campaigns, remote view, local CAPTCHA solver.
- Posting liveness is checked server-side in headless Chromium. Login-walled
  postings ask the candidate to paste the description.

### 8. Hosting (free tier)

- **Vercel Hobby**: website, `/mcp`, OAuth endpoints, extension API as
  serverless functions. PDFs through serverless Chromium (to be proven in a
  test deploy; fallback is Cloudflare Browser Rendering's free allowance).
  Hobby is non-commercial; charging for Plainhand means Vercel Pro or the
  same code on Google Cloud Run.
- **Supabase free** (project `plainhand-cloud`, us-east-1): Postgres + Auth.
  A daily Vercel cron keeps it from pausing after a week idle.

Serverless means no memory between requests, so steps are **replayed**, not
parked: every model step and its accepted result is stored. When a result
arrives, the task re-runs from the start; the deferred agent answers
already-recorded steps from storage and parks the first new one. Steps are
keyed by task id and call order, and a recorded step is reused only when its
instruction and input digest match.

## Steps

1. **Pluggable workspace storage** + tests (local behaviour unchanged).
2. Cloud server skeleton: Supabase session sign-in, per-user `Workspace`,
   web UI behind a cookie session.
3. OAuth authorization server + `/mcp` (read/write tools) scoped per user.
4. Deferred agent + `submit_step`; task tools runnable from chat.
4b. Sign in with ChatGPT route (`chatgptAgent`, token storage, Connect button),
   built against the documented API and switched on when OpenAI approves the
   hosted app. Owner action: submit the interest form.
5. Website changes: Connect page, cloud labels, hide local-only features.
6. Browser extension: OAuth sign-in, page match, fill, upload, submit guard,
   "I submitted".
7. Vercel deployment, privacy and data-deletion page, account deletion that
   removes every row.
8. End-to-end test with claude.ai and ChatGPT custom connectors and the
   extension on Greenhouse, Lever and Ashby test forms.
9. Directory submissions: ChatGPT app directory and Claude connector directory,
   so adding Plainhand is one click.

Separate, optional: the local app can offer Sign in with ChatGPT today through
OpenAI's open-source self-serve path (loopback redirect), replacing the Codex
connector download.
