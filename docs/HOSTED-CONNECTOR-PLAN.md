# Hosted Plainhand: use your ChatGPT or Claude plan, no setup

**Branch:** `hosted-connector` · **Status:** in progress (see Steps)

## Goal

Someone who is not comfortable with AI tools, terminals or settings screens
can use Plainhand with the ChatGPT or Claude subscription they already pay
for. Success means they never install anything except, optionally, a browser
extension from an app store, never see a command, an API key or a JSON file,
and never have to understand what an "MCP connector" is.

## What the candidate experiences

1. **Go to the Plainhand website → Continue with Google (or email link).**
2. **Get started** walks them through three things, one screen each: upload
   a resume (PDF or paste), say what roles they want, connect their AI.
3. **Connect your AI** asks which AI and plan they have, then takes them down
   the route that gives full Plainhand for that plan, with the fewest steps:
   - **Inside Claude or ChatGPT** (Claude, any plan; ChatGPT work and school
     plans): they add Plainhand to the chat app they already use, guided one
     screen at a time, then just talk: "Here's a job link, is it a fit?",
     "Write my application for it."
   - **The Plainhand desktop app** (ChatGPT Plus and Pro; Free and Go if confirmed): one Download
     button, open it, **Sign in with ChatGPT**. Everything happens in the app.
   - **Use my ChatGPT plan on the website** (one button): offered as soon as
     OpenAI approves it, for every ChatGPT plan it covers.
4. **Review and approve** on the website: read the resume, cover letter and
   answers, fix anything, press **Approve**. Only the candidate can approve.
5. **Apply**: open the employer's page, click the Plainhand extension,
   **Fill this page**. They check it, upload anything left, and press Submit
   themselves. Then **I submitted this** records it.
6. **Follow up**: the website shows what's due; drafts are ready to send.

Desktop app users do steps 4 to 6 in the app, which also fills forms itself.

## Every subscriber gets full Plainhand today

The rule: **every ChatGPT and Claude subscriber gets the full Plainhand
(evaluate, write, fact-check, fill forms, track) through at least one route
today, with the fewest setup steps their plan allows.** A missing one-click
option changes how many steps someone takes, never whether they can use
Plainhand. The setup wizard (§5a) picks the route for them.

Providers decide where a subscription may be used: on the web, through
approved integrations; on the user's own computer, through the provider's own
apps (Codex, Claude Code) or OpenAI's open-source Sign in with ChatGPT. So the
website and the desktop app together cover everyone:

| Subscription | Full Plainhand today | Setup |
| --- | --- | --- |
| Claude Free | Website, inside Claude (custom connector; Free allows one) | Sign up → wizard → add connector in Claude (about 6 steps) |
| Claude Pro, Max, Team, Enterprise | Website, inside Claude; or the desktop app | Website: same as above. Desktop: install → **Connect Claude** → Claude sign-in |
| ChatGPT Business, Enterprise, Edu | Website, inside ChatGPT (custom MCP server); or the desktop app | Website: wizard → add server in ChatGPT (about 8 steps; admin may need to allow it) |
| ChatGPT Plus, Pro | **The desktop app**, with **Sign in with ChatGPT** (OpenAI's open-source path, no approval needed) or the Codex sign-in | Install (double-click) → **Sign in with ChatGPT**. The website wizard sends these users here with one Download button. |
| ChatGPT Free, Go | **Unconfirmed.** Desktop app through the Codex sign-in, if OpenAI allows `codex exec` on these plans (coverage check below). Otherwise Claude Free on the website is the free way to try Plainhand. | Same install as Plus; the wizard states the result of the coverage check. |

When OpenAI approves the hosted Sign in with ChatGPT or lists Plainhand in its
app directory, ChatGPT personal plans also get the website route, and the
wizard simply offers it. Nothing else changes.

The desktop app is therefore **required, not optional**: it is the full route
for ChatGPT personal plans today. To keep it console-free it ships as a normal
installer (§10): Windows signed for free through SignPath Foundation, Linux
through Flathub/AppImage, macOS once the Apple Developer Program ($99/year) is
paid. Until then Mac users with a ChatGPT personal plan get the current
one-command installer with a step-by-step guide, or the website once OpenAI
approves.

Plan details the wizard checks and states plainly (they change, so they are
kept in one data file with the date checked): Claude Free allows one custom
connector; Claude Code (desktop route) needs a paid Claude plan; Codex and
Sign in with ChatGPT plan usage depend on the ChatGPT plan's current
entitlements.

### Plan coverage check (must pass before launch)

Each row is tested with a real account of that tier, end to end (connect,
evaluate a role, prepare and fact-check a packet, fill a test form), and the
result is recorded with the date in the wizard's data file. Rows that fail
are shown honestly in the wizard with the best working alternative.

| Tier | Route to test | What OpenAI and Anthropic document (checked 2026-11-05) |
| --- | --- | --- |
| ChatGPT Free | Desktop: Codex sign-in | OpenAI's Sign in with ChatGPT page (learn.chatgpt.com) limits plan usage in other apps to **Plus and Pro**. Codex is included in Free, but OpenAI's pricing page documents it only "in the desktop app", lists no CLI access and publishes no limits. **Test whether `codex exec` works on a Free account**; if not, Free has no ChatGPT route, and the wizard's free option is Claude Free on the website. |
| ChatGPT Go | Desktop: Codex sign-in | Same as Free: plan usage in other apps is Plus and Pro only (an older help article also listed Go); Codex documented only in the desktop app. Test `codex exec`. |
| ChatGPT Plus, Pro | Desktop: Sign in with ChatGPT; Codex CLI | Expected to work. Pro: also test the website connector (read-only reported). |
| ChatGPT Business, Enterprise, Edu | Website connector; desktop | Workspace admin may need to allow custom servers. |
| Claude Free | Website connector | One custom connector allowed; Claude Code (desktop route) needs a paid plan. |
| Claude Pro, Max, Team, Enterprise | Website connector; desktop (Claude Code) | Team/Enterprise: an owner adds the connector. |

Owner action: provide or create one test account per ChatGPT tier
(Free, Go, Plus) and Claude (Free, Pro) for the check; paid tiers can be
tested for one month each.

**Trying Plainhand without a paid plan.** Two free ways, both full Plainhand:
Claude's free plan on the website (one custom connector), and the sample
workspace (no AI account; shows every screen with example data). ChatGPT Free
joins them if the coverage check passes.

## Two AI routes, one foundation

| | Use my ChatGPT plan | Inside ChatGPT / Claude (connector) |
| --- | --- | --- |
| Where the candidate works | Plainhand website | Their chat app, plus the website to review and approve |
| Who calls the model | Our server, with the candidate's ChatGPT plan token | The candidate's chat model, through Plainhand tools |
| Workflow agent | `chatgptAgent` (direct Responses API call) | Deferred agent (step protocol, §4) |
| Factual review | Separate model call, as in the local app | A separate step in the same chat (§4) |
| Website assistant, task buttons | Yes | Buttons show "Ask your chat: …" with the exact words to copy |
| Daily automatic checks for new jobs | Yes, including fit evaluation | New jobs are found; evaluation waits for the chat |

Everything else (account, storage, website, extension, factual checks,
approvals, PDFs) is shared, and a candidate can use both routes.

**Sign in with ChatGPT specifics** (OpenAI preview rules): Responses API with
`store: false` and `stream: true`; the full context goes in `input` on every
call; no temperature or max-output-token fields; no hosted tools. Access tokens
last one hour; refresh tokens use a 30-day sliding window and are stored
encrypted (AES-256-GCM, key in a server secret), never logged, and deleted on
disconnect or account deletion. The candidate can cap or switch off plan usage
for Plainhand on OpenAI's side; when a cap is hit, Plainhand pauses the task and
says "Your ChatGPT plan limit for Plainhand is reached" instead of failing
silently or billing anyone. When OpenAI's identity sign-in is available to us,
**Continue with ChatGPT** also becomes an account sign-in option, so a ChatGPT
user signs in and connects in a single step.

## Architecture

```
ChatGPT / Claude chat ──MCP over HTTPS (OAuth)──┐
Plainhand website ──────session cookie──────────┤
Browser extension ──────OAuth (PKCE)────────────┼──▶ Plainhand cloud (Vercel functions, stateless)
                                                │      ├─ action registry (plainhand/actions.mjs, shared with local)
                                                │      ├─ workflow (plainhand/workflow.mjs) + chatgptAgent | deferred agent
                                                │      ├─ OAuth 2.1 server (connector + extension clients)
                                                │      └─ PDF rendering (serverless Chromium)
OpenAI Responses API ◀── candidate's plan token ┘
Supabase: Postgres (accounts, per-user workspace files, OAuth, sessions) + Auth (Google, email)
```

### 1. Per-user storage ✅ done

`Workspace` reads and writes through a pluggable store: `FileStorage` (local
app, unchanged), `MemoryStorage` (tests), `PostgresStorage`
(`plainhand.workspace_files`, one row per file per candidate, 25 MB quota).
Each mutation runs in one transaction holding a per-candidate advisory lock,
so concurrent serverless instances never lose an update, and a failed
mutation leaves nothing behind. The schema is in a private Postgres schema
with row level security on and no API access.

### 2. Accounts and sign-in

- **Continue with Google** and **email sign-in link** through Supabase Auth.
  No passwords.
- Sign-in emails go through Resend (free: 3,000/month) because Supabase's
  built-in sender allows only a few emails an hour.
- The website session is an httpOnly, Secure, SameSite=Lax cookie; only its
  hash is stored. 30-day sessions, ended on sign-out or account deletion.
- **Connected apps** page lists every connected chat app, the extension and
  Sign in with ChatGPT, each with **Disconnect**.
- **Delete my account** removes the account, every workspace row, every
  token and the Supabase Auth user, after one confirmation.
- Sign-up and sign-in are rate limited per IP and per email.

### 3. The connector (MCP over Streamable HTTP)

- `/mcp`, stateless (no in-memory MCP sessions), OAuth 2.1 with PKCE (S256);
  access tokens one hour, rotating refresh tokens.
- What ChatGPT and Claude require of the OAuth server, built in from the start:
  protected resource metadata at `/.well-known/oauth-protected-resource` and a
  `WWW-Authenticate` challenge on 401; authorization server metadata with
  `code_challenge_methods_supported: ["S256"]`; **Client ID Metadata
  Documents** (ChatGPT's preferred registration,
  `client_id_metadata_document_supported: true`) plus dynamic client
  registration (Claude); the `iss` parameter on every authorization response
  (RFC 9207, which lets ChatGPT use its stable redirect URI
  `https://chatgpt.com/connector_platform_oauth_redirect`); the `resource`
  parameter copied into the token audience; per-tool `securitySchemes` and the
  `mcp/www_authenticate` error metadata that makes ChatGPT show its sign-in
  button; `readOnlyHint` on every read tool.
- The approval screen is plain language: "Let Claude use your Plainhand
  workspace? It can read your roles and profile and save changes you ask for.
  It can never approve applications or mark them submitted." **Allow / Cancel**.
- Tools are generated from the same registry as the local MCP bridge, with
  the same tier rules: read and write tools (audited, undoable for 10
  minutes); candidate-only actions (approve, I submitted, widen what the AI
  sees) are refused with a link to the right page; task tools run through the
  step protocol.
- Tool descriptions are written for the chat model so the candidate never has
  to know tool names: they say "write my application" and the model finds it.
- Posting text and anything derived from it is marked untrusted in tool
  results, as today.

### 4. Model steps for the connector (deferred agent)

`Workflow` already takes an injectable `agent(provider, instruction, data)`.
For the connector it is a deferred agent:

1. The chat calls e.g. `evaluate_role { jobId }`.
2. The workflow runs until its first model call. That call becomes a **step**
   `{ stepId, purpose, instruction, data, resultSchema }` returned to the chat.
3. The chat does the work and calls `submit_step { stepId, result }`.
4. The server validates the result exactly as today (schema, exact source
   quotes of 8+ characters, evidence checks). If it fails, the chat gets the
   specific error and resubmits, within the workflow's normal attempt limits.
5. The task continues to the next step, or finishes and returns a short
   outcome plus a website link ("Your application is ready to review: …").

**Stateless replay.** Every accepted step result is stored with the task. On
each `submit_step` the task re-runs from the start: recorded steps are answered
from storage (only when their instruction and input digest match), and the
first new model call becomes the next step. Network results that do not depend
on the model (posting verification, job board fetches) are cached with the task
so a replay never refetches them. An unanswered step expires after 2 hours; the
task is then marked interrupted and can be retried from saved work.

**Time limits.** Each `submit_step` must answer well inside the chat app's tool
timeout and Vercel's limit, so a single request never does more than one
validation plus, at the end, PDF rendering (measured in the test deploy).

**Factual review.** It is a separate step whose instruction gives the packet
and the sources only and asks for an independent check. The deterministic
quote checks still run on the server and cannot be argued past. The website
labels these packets "fact-checked in your chat".

### 5. Website

The existing Preact UI, served behind the session cookie, with:

- **Get started** guide (resume → target roles → connect AI) and a progress
  checklist on Home until each step is done.
- **Connect your AI** page with the two buttons, and for the connector route a
  per-app walkthrough with screenshots plus a "Test connection" status that
  turns green when the chat first calls Plainhand.
- Resume PDF import with `pdfjs-dist` (no Poppler on serverless).
- Task buttons run directly with Sign in with ChatGPT; with only a connector
  they show the exact sentence to say in the chat, with a Copy button.
- Assistant panel: available with Sign in with ChatGPT; otherwise replaced by
  the connector instructions.
- Live updates: the page re-reads the workspace every few seconds while
  visible (serverless functions cannot hold the event stream open).
- Hidden in the cloud: Insights, Campaigns, remote view, local CAPTCHA solver,
  workspace import from a folder. Export stays.

### 5a. Guided AI setup

The **Connect your AI** page is a wizard, not a help article. Every screen has
one instruction, one screenshot of exactly what they will see, and one button.

**Screen 1: Which AI do you use?** ChatGPT · Claude · Both · I'm not sure
(the last explains how to tell, with a picture of each app's logo).

**ChatGPT: which plan?** Free · Go · Plus · Pro · Work or school (Business,
Enterprise, Edu) · I don't know (shows where to look: profile picture → plan
name, with a screenshot).

- **Work or school plan:** the custom MCP server walkthrough, one step per
  screen: open chatgpt.com/plugins on a computer → **+** → **Add custom MCP
  server** → name *Plainhand* → paste the Plainhand link (one **Copy** button; it is the
  same link for everyone) → Authentication **OAuth** →
  tick "I understand and want to continue" → **Create as a plugin** → **Install**
  → sign in to Plainhand on the screen that opens → **Allow**. If the **+**
  button or the option is missing, the screen explains that their workspace
  admin controls it and gives a ready-to-send message asking the admin to allow
  Plainhand.
- **Pro:** the same walkthrough, followed by the live check below. If the
  account turns out read-only, the wizard says so plainly and moves them to
  the desktop app route below.
- **Plus (and Pro, if the live check finds it read-only), and Free and Go if the coverage check passes:** "For
  your plan, Plainhand runs as a small app on your computer and uses your
  ChatGPT plan from there." One **Download for Windows / Linux / Mac** button
  (detected automatically), then: open the download → **Sign in with
  ChatGPT** → done. Their account and anything already saved on the website
  can be brought into the app with **Import from Plainhand online**. When
  OpenAI enables the website route for their plan, the wizard offers it and
  they can switch back.

**Claude (any plan):** claude.ai → **Customize** → **Connectors** → **Add
custom connector** → name *Plainhand*, paste the link → **Add** → **Connect** →
sign in to Plainhand → **Allow**. On Team and Enterprise, an owner adds it once;
the wizard detects "Add custom connector" is missing and gives the message for
the owner. Free accounts that already use their one custom connector are told
so before they start.

**Live check (every route).** The last screen says "Now type this in your
chat:" with a Copy button for a fixed sentence ("@Plainhand check my
connection"). The page watches for that call and turns green within seconds:
"Connected. Plainhand can read and save." If the chat can read but its save
test is refused, it explains that and offers the desktop app route. If
nothing arrives in two minutes, it shows the three most likely causes with a
picture for each (plugin not installed, Plainhand not picked with @, signed in
to a different Plainhand account).

**How they use it afterwards.** A short card on Home: "In ChatGPT, start your
message with @Plainhand" or "In Claude, Plainhand is available in every chat",
plus five example sentences with Copy buttons ("Is this job a good fit for me?
<link>", "Write my application for …", "What's due this week?").

**Tool approvals.** ChatGPT asks to approve each saving action. The wizard
shows that prompt in a screenshot and says what it means: "Plainhand is asking
to save something. You can approve it for the rest of this chat." Reading
tools are marked read-only so ChatGPT does not ask for them.

**Keeping it right.** The walkthrough screenshots and menu names live in one
data file with the date each was checked; a monthly check against both apps
and OpenAI's and Anthropic's help pages keeps them current, because these menus
change.

### 6. Browser extension: save jobs and fill forms

Chrome and Edge (Manifest V3); Firefox from the same code.

- **Sign-in:** a public OAuth client of the same server (PKCE via the
  browser's identity API). It never sees a password or an AI credential.
- **Save this job:** on any posting, one click saves company, title, link and
  description to Plainhand (no copy-paste).
- **Fill this page:** requires an approved, current packet for the matched
  role (same gate as the local app). The content script reads the form with
  the existing in-page extractor (`plainhand/adapters/upstream/extract.mjs`),
  the server returns evidence-backed answers (`suggestFormAnswers`, answer
  bank, approved packet) and the presubmit check, and the content script fills
  text, selects, radios, checkboxes and comboboxes (`option-match`) and
  attaches the exact approved resume and cover letter PDFs (`resume-label`).
  Sensitive fields (`field-policy`) are always left for the candidate.
- **Missing answers:** listed in the popup to type, or drafted by the AI
  (directly with Sign in with ChatGPT; "Ask your chat to finish my form"
  with the connector, using `FORM_INSTRUCTION` through the step protocol).
- **Never submits:** it clicks only combobox openers and options; every click
  target passes the existing `submit-guard` classifier and is refused if it is
  a submit control. Multi-page forms: the candidate clicks Next, then Fill
  again.
- **I submitted this** in the popup records Applied (a candidate action from
  their own signed-in extension, never from the chat).
- **Permissions:** `activeTab`, `scripting`, `storage`, `identity`, plus
  *optional* host permissions for known application hosts (Greenhouse, Lever,
  Ashby, Workday, SmartRecruiters, Workable, Recruitee), requested the first
  time they are needed, because many employer sites embed the form in a
  cross-origin frame that `activeTab` alone cannot reach. Nothing runs until
  the candidate clicks. Only field labels, options and the page URL are sent.
- **Distribution:** Chrome Web Store (one-time $5 registration), Edge and
  Firefox add-on stores (free). Reviews take days, so submission starts as soon
  as the extension works.

### 7. Hosting (free tier)

- **Vercel Hobby**: website, `/mcp`, OAuth, extension API, as stateless
  functions. Hobby is for non-commercial use: if Plainhand ever charges, move
  to Vercel Pro or run the same code on Google Cloud Run.
- **PDFs**: serverless Chromium in a Vercel function (proven first, in the
  test deploy); fallback is Cloudflare Browser Rendering's free 10 minutes a
  day. Only the latest PDFs per role are kept, to stay inside storage limits.
- **Posting checks**: public job-board APIs (Greenhouse, Lever, Ashby, …, the
  existing `providers/`) and plain HTTPS fetches, not a browser. Pages that
  block servers or need a login ask the candidate to paste the description
  (or use **Save this job** in the extension, which reads the page they see).
- **Supabase free** (project `plainhand-cloud`): Postgres (500 MB) and Auth
  (50,000 monthly users). A daily Vercel cron keeps the project from pausing
  after a week idle and runs daily job-board checks.
- **Backups**: Supabase's free tier has none, so a free GitHub Actions job
  takes a nightly encrypted dump to a private location, kept 14 days.
- **Abuse limits**: per-account and per-IP rate limits on sign-in, tool calls
  and PDF rendering, so one account cannot exhaust the free allowances.

### 8. Privacy and safety

- Candidate data is stored in Supabase (encrypted at rest) instead of on the
  candidate's computer; the website and privacy page say so plainly.
- Tokens, codes and session ids are stored only as hashes; ChatGPT refresh
  tokens are encrypted.
- No credentials are ever stored for job sites; the extension fills forms in
  the candidate's own logged-in browser.
- Approvals, "I submitted" and widening what the AI sees stay candidate-only
  on every route.
- Privacy page, terms, and a contact for data requests before launch.

### 9. Not in the cloud version (v1)

- Automatic clicking through multi-page forms (the candidate clicks Next).
- Insights, Campaigns, remote view, local CAPTCHA solver.
- The local app keeps all of these; nothing is removed from it.

## Coverage gaps: now vs later

Rule: easy and core → now. Hard, or not core → later.

**Now (in this plan):**

- **Get help.** A **Get help** button on every page and in the extension and
  desktop app: a short form (what were you trying to do?) that attaches the
  current screen name and recent error ids, never workspace content without
  the candidate ticking a box. Plus free error tracking (Sentry free tier) on
  the website, server, extension and desktop app, with personal data
  scrubbed, so we see where people get stuck. Easy; essential for
  non-technical users who will not send logs.
- **Phone users.** The website already has phone layouts. The wizard detects a
  phone and says plainly which parts need a computer once (adding the ChatGPT
  server; the extension) and which work on the phone afterwards (Claude's and
  ChatGPT's mobile apps use a connector once it is added; review, approve and
  track on the website). Easy.
- **Accessibility baseline.** Keyboard use, labels for screen readers, focus
  order, contrast and text resizing checked on the wizard, packet review,
  approve and extension popup, with an automated check (axe) in the browser
  tests. Moderate, but core: the audience includes people who rely on these.
- **Moving between website and desktop.** **Import from Plainhand online**
  in the desktop app and **Upload to Plainhand online** from it, using the
  existing workspace export format. Easy, because export and import already
  exist.

**Later:**

- **Live sync between website and desktop** (one account, both always up to
  date): the desktop app would store its workspace in the online account,
  which needs offline handling and conflict resolution. Hard; most people use
  one route, and the import/upload above covers switching.
- **Other languages** (interface, wizard screenshots, and drafting in the
  candidate's language): moderate effort and ongoing upkeep; not core for the
  first audience. Spanish first when it comes.
- **Form filling on phones**: browsers on phones do not support extensions
  like this; not possible with the current approach.

## Module contracts (for parallel build)

All cloud code lives in `plainhand/cloud/`. Modules take their dependencies as
arguments (no module reads `process.env` except `app.mjs`), so each is tested
alone with `MemoryStorage` or the local Postgres from `tests/test-cloud-storage.mjs`.
Every module ships with `tests/test-cloud-<name>.mjs` added to `test:cloud`.

| Module | Exports | Owns |
| --- | --- | --- |
| `accounts.mjs` | `createAccounts({ sql, quotaBytes })` → `{ upsert({ userId, email }), get(userId), remove(userId), workspaceFor(userId) → Workspace }`; `createSessions({ sql })` → `{ create(userId) → cookieValue, resolve(cookieValue) → { userId } \| null, destroy(cookieValue), destroyAll(userId) }` | `plainhand.accounts`, `plainhand.sessions` |
| `supabase-auth.mjs` | `createSupabaseAuth({ url, publishableKey, secretKey, fetchImpl })` → `{ googleUrl(redirectTo, codeVerifier), sendEmailLink(email, redirectTo), exchangeCode(code, codeVerifier) → { userId, email }, deleteUser(userId) }` | Supabase Auth REST only |
| `oauth.mjs` | `createOAuthServer({ sql, issuer, resource, sessionUser(req) → userId \| null, now })` → `{ handle(req, res) → boolean (true if it served the request), verifyAccessToken(token) → { userId, grantId, clientId, scope, audience: 'mcp' \| 'extension' } \| null, listGrants(userId), revokeGrant(userId, grantId) }`. Serves `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, and accepts CIMD client ids | `plainhand.oauth_*` |
| `steps.mjs` | `createStepRunner({ workspace, makeWorkflow(agent) → Workflow })` → `{ start(kind, input) → Outcome, submit(taskId, stepId, result) → Outcome, current(taskId) → Outcome }`; `Outcome = { status: 'step', taskId, step: { stepId, purpose, instruction, data, resultSchema } } \| { status: 'done', taskId, summary, link } \| { status: 'failed', taskId, error }`. Step records live in workspace files `data/plainhand/steps/<taskId>.json` | deferred agent, replay, step expiry |
| `chatgpt-agent.mjs` | `createChatgptAgent({ tokens, fetchImpl, model })` → an `agent(provider, instruction, data, opts)` with the same contract as `executeAgent`; `createTokenStore({ workspace, key })` → `{ save({ accessToken, refreshToken, expiresAt }), get() → fresh access token (refreshing), clear() }` (AES-256-GCM) | Responses API calls, token refresh |
| `mcp.mjs` | `handleMcp(req, res, { userId, workspace, registry, stepRunner, siteUrl })` stateless Streamable HTTP; tools = registry read/write tools (with `readOnlyHint` on reads, `securitySchemes`), candidate tools return a website link, plus `check_connection`, `start_task`, `submit_step`, `task_status` backed by `stepRunner` | MCP tool surface |
| `extension-api.mjs` | `handleExtensionApi(req, res, { userId, workspace, registry, stepRunner })` for `POST /api/extension/match {url}`, `POST /api/extension/plan {jobId, fields}`, `GET /api/extension/file?jobId=&kind=resume\|cover`, `POST /api/extension/save-job {company,title,url,description}`, `POST /api/extension/submitted {jobId}` | extension server side |
| `app.mjs` | `createCloudApp(deps)` → `(req, res)` handler wiring the above, the website behind the session cookie, rate limits, `/api/help`, `/api/cron/daily`; `api/index.mjs` exports it for Vercel | wiring, env, security headers |

Token audiences: chat connectors (ChatGPT, Claude) only ever get tokens for
`/mcp`; the browser extension only for `/api/extension` (which can record "I
submitted"). A client counts as the extension only when every redirect is a
browser-identity address (`<id>.chromiumapp.org`, `<id>.extensions.allizom.org`)
and, in production, its id is in `PLAINHAND_EXTENSION_IDS`. The extension
registers itself on first sign-in.

Shared rules for every module: no secrets in logs; every request scoped to
one `userId`; candidate-tier actions never reachable from chat or tokens; all
user-visible text plain and short.

## Owner actions (only you can do these)

| When | Action |
| --- | --- |
| Now | Submit OpenAI's Sign in with ChatGPT interest form (hosted app). |
| Before launch | Create the Google sign-in client in Google Cloud (free; I provide exact steps) and paste it into Supabase. |
| Before launch | Create a Resend account (free) and a sending domain or address. |
| Before launch | Chrome Web Store developer registration ($5 once); Edge and Firefox (free). |
| Before desktop release | Apply to SignPath Foundation for free Windows signing; turn on two-factor sign-in for everyone with access to the GitHub repo. |
| Now | Complete OpenAI developer identity verification (individual or business) so Plainhand can be published under your name. |
| After the test deploy | Submit to the Claude connector directory and the ChatGPT app directory. ChatGPT needs: website, support, privacy and terms URLs; a reviewer test account that signs in without email codes or links (a reviewer-only password login on sample data); a video walkthrough; 5 positive and 3 negative test cases; a square icon. I prepare all of these. |

## Risks

- **OpenAI approval** for Sign in with ChatGPT and/or the ChatGPT directory is
  not guaranteed or timed. Until one arrives, ChatGPT personal plans use the
  desktop app, which has full capability. ChatGPT's per-plan rules change with
  rollouts, which is why the wizard relies on the live check, not on a fixed
  table.
- **Mac users on ChatGPT personal plans** get a console-free installer only
  once the Apple Developer Program is paid; until then a guided one-command
  install.
- **Directory reviews** (Claude, ChatGPT, extension stores) may ask for
  changes. Tool descriptions and permissions are written to their published
  guidelines from the start.
- **Free-tier limits** (Supabase 500 MB, Vercel invocations) bound the number
  of active users; storage quotas and PDF retention keep this in the hundreds
  of users. Growth beyond that needs paid tiers.
- **Serverless Chromium** may not fit Vercel's limits; the Cloudflare fallback
  is planned.
- **Chat model quality** varies by the model the candidate picks; the server
  side checks keep facts honest regardless.

## Steps

| # | Step | Status |
| --- | --- | --- |
| 1 | Pluggable workspace storage; Postgres store with locking; schema in Supabase | ✅ done |
| 2 | Cloud server: Supabase sign-in, sessions, per-user workspace, website behind the session | ✅ done |
| 3 | OAuth 2.1 server + stateless `/mcp` with read/write tools | ✅ endpoint, OAuth, tools and production wiring done; SDK and Postgres integration tests pass; live provider validation remains |
| 4 | Deferred agent, step replay, task tools from chat | ✅ done, including MCP task tools and tested interview/evaluate/prepare/review loops |
| 5 | `chatgptAgent` + token storage + Connect button (off until approval) | ✅ agent + encrypted token store done (`plainhand/cloud/chatgpt-agent.mjs`); local Sign in with ChatGPT provider shipped (`plainhand/chatgpt-local.mjs`); hosted Connect button waits for approval |
| 6 | Website: Get started, guided Connect your AI wizard with live check, cloud labels, PDF import, account deletion | ✅ guided setup, PDF/text preview import, fresh connection check, cloud labels, help and account deletion done; authentic provider screenshots and account coverage remain |
| 7 | Browser extension: sign-in, Save this job, Fill this page, submit guard, I submitted | ✅ done (MV3 extension in `extension/`, server routes in `plainhand/cloud/extension-api.mjs`, tests incl. real-Chromium fill suite) |
| 8 | Vercel deploy (prove PDFs), cron, backups, rate limits, privacy and terms pages, CI job running `test:cloud` against a Postgres service | CI job + rate limits + cron done (`test:cloud` job in `.github/workflows/test.yml`, `createRateLimiter` in `app.mjs`); the deploy, backups and pages remain |
| 9 | End-to-end tests: Claude connector, ChatGPT (Developer Mode for testing only), extension on Greenhouse, Lever and Ashby test forms | |
| 10 | Directory and store submissions (ChatGPT, Claude, Chrome, Edge, Firefox) with reviewer account, video and test cases | |
| 11 | Desktop app: Electron installer (Windows via SignPath, Linux AppImage), auto-update from GitHub Releases, Sign in with ChatGPT (open-source path), import from / upload to Plainhand online | Linux shell/AppImage built and smoke-tested; update/signing CI prepared. Windows signing, two-release update validation and online transfer remain (see `docs/DESKTOP.md`) |
| 12 | Plan coverage check with real accounts for every tier; wizard data file updated with results | |
| 13 | Get help + error tracking, phone guidance, accessibility baseline, desktop import/upload | |

## Desktop app (required: the full route for ChatGPT personal plans)

OpenAI's self-serve path for open-source apps that run on the user's computer
is available today, with no approval. Packaging the local app as a normal
installer (double-click, no terminal) with a **Sign in with ChatGPT** button
gives ChatGPT personal-plan users the full experience now, including form
filling in its own browser.

Signing, so the installer opens without scary warnings:

| Platform | Free route | Notes |
| --- | --- | --- |
| Windows | **SignPath Foundation** (free for open-source projects) | Plainhand qualifies on paper: MIT license, public GitHub repo. Builds must run in GitHub Actions, every maintainer uses two-factor sign-in, and the installer's publisher shows as "SignPath Foundation". Approval takes about 1–2 weeks. |
| Linux | Flathub / AppImage | No signing needed. |
| macOS | None | Apple requires the $99/year Developer Program for signing and notarization. Unsigned, a Mac user must go to System Settings → Privacy & Security → **Open Anyway**, which is not acceptable for this audience. |

Order: Windows and Linux first (free); macOS when the $99/year is paid. The
app is the existing local Plainhand with a desktop shell, first-run setup done
for the user (browser download, workspace folder), and **Sign in with ChatGPT**
added beside the existing Codex and Claude connections.
