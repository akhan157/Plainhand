# Plainhand browser application

The browser app is a local, single-candidate workspace for graduating engineers.
It adds a candidate interview and application workflow around the reusable
career-ops foundation. It does not require a hosted account or a cloud database.

## Start

Use Node.js 22 or newer. One command checks your computer, installs the
dependencies and the Playwright browser, and tells you what is optional:

```bash
npm run setup
npm start
```

`npm run setup -- --check` only reports, without installing anything. The
manual equivalent is `npm ci` then `npx playwright install chromium`.

Open `http://127.0.0.1:3210`. PDF resume import additionally needs Poppler's
`pdftotext` executable (`sudo apt install poppler-utils` on Debian/Ubuntu or
`brew install poppler` on macOS). Pasting resume text works without it.

On Linux, Playwright may also need its documented browser system dependencies.
Form assistance requires a graphical desktop because the candidate takes over
a visible application browser. Headless environments can still use the web
workspace, evaluation, packet generation, and downloads.

The server deliberately binds to `127.0.0.1`. Use the printed address rather
than `localhost`, which is rejected by the Host check. This is not a multiuser
or remotely hosted deployment. Each classmate runs their own copy.

## Appearance

The workspace has three areas: navigation on the left (a drawer on phones), the
page you are working on in the centre, and a context panel on the right that
shows whatever you opened: a role's fit and evaluation, its packet documents,
form assistance, or its application record. On narrower screens the panel opens
over the page; on phones it opens as a full-screen sheet. **Home** opens on a
briefing computed from your workspace (overdue and upcoming follow-ups, failed
or running tasks, roles awaiting evaluation, packets to review, upcoming
interviews), each with a button that opens the right panel. No model call is
made to build it.

Use the sun/moon control in the top bar to switch between dark and light mode.
Workspace → Appearance also offers **Follow system**. The preference is saved
in this browser, synchronized between tabs, and applied before the page paints.
System mode responds to device theme changes while the app is open. If browser
storage is blocked, switching still works for the current session. Theme changes
preserve unsaved profile, job, and source fields; generated PDFs retain their
standard light paper layout, and the packet preview keeps a light paper look in
dark mode too. Status messages appear in the top bar, so they never cover a
button or form.

The page updates itself from a live event stream (`/api/events`) instead of
polling, and also re-reads the workspace every few seconds while the tab is
visible so edits made outside Plainhand appear. If the local server stops, the
page says so and keeps what you typed. The front end is Preact with htm,
vendored under `plainhand/web/vendor/` (see its README); there is no build step
and nothing loads from a CDN.

Optional arguments:

```bash
npm start -- --port 3211
npm start -- --data-root /absolute/path/to/my-workspace
```

Run one server per workspace. The alternate root separates personal files from
the code checkout; reuse an existing career-ops root to import its profile and
resume. Existing tracker rows remain visible. There is no destructive migration.

## Connect an agent

Plainhand delegates account authentication and execution to installed CLIs:

| Account | CLI | Sign-in | Execution |
| --- | --- | --- | --- |
| ChatGPT | `codex` | `codex login` | `codex exec` with an ephemeral read-only workspace |
| Claude | `claude` | `claude auth login` | `claude -p`, tools disabled and explicit empty MCP configuration |
| Google Antigravity | `agy` | Launch `agy` interactively and sign in | Streaming JSON on stdin/stdout, plan mode, sandbox enabled |

The Connections screen detects installation, checks the available local auth
status, starts Codex/Claude sign-in, and provides Antigravity sign-in instructions.
When a sign-in flow prints a recognized provider authorization link, the screen
offers it to the user. Authentication can always be completed in the terminal.
Antigravity's interactive account/keyring setup is not replicated in Plainhand.

**Check and use** sends a minimal request without candidate context.
**Select existing connection** only selects the CLI; it does not establish that
authentication or model access is working. Antigravity is shown as unverified
until an actual request succeeds. Different CLI versions or account entitlements
can require additional setup, and account quota availability is not inferred
from a successful local status check.

Plainhand never reads provider token stores, copies credentials between harnesses,
or silently chooses another provider. Existing CLI environment configuration can
select API or enterprise billing; check the provider's own account configuration.
The UI does not claim to know remaining subscription quota.

Implementation references:

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [Claude programmatic execution](https://code.claude.com/docs/en/headless)
- [Antigravity authentication](https://www.antigravity.google/docs/install?tab=cli)
- [Antigravity headless execution](https://www.antigravity.google/docs/cli/headless/)
- [OMP provider and credential separation](https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md)
- [Pi agent architecture](https://github.com/earendil-works/pi)

OMP and Pi informed the separation of provider authentication, candidate context,
and execution. This release does not vendor their code or reuse their OAuth client
identities. A CLI subprocess is a trusted local program; its own sandbox and
permission implementation still matters. Plainhand does not claim operating-system
isolation of provider authentication, provider hooks, or all third-party tools.

## Assistant

Once an AI account is connected, **Home** shows the briefing and, below it,
**Ask Plainhand**: a conversation with the selected agent. It is not offered in
the sample workspace or before a provider is connected.

- **What it can do:** read your workspace and answer from it ("What's due this
  week?", "Why that score?"), and propose changes: save a role, record an
  interview round, a contact or a next action, update profile preferences,
  start an evaluation or a packet. Every change arrives as a card listing each
  action. Nothing is written until you choose **Save** (or **Save all** for a
  group, **Start** for a task). **Edit** opens the fields of common changes
  (next action, contact, interview round, profile fields, a new role) so you
  can correct them before saving; Escape cancels the edit. **Decline** changes
  nothing. After saving, **Undo** reverses the whole group for 10 minutes, as
  long as nothing changed it since.
- **What it cannot do:** approve a packet or your understanding, approve
  corrections, run form assistance, or mark an application Applied. When you
  ask for one of these it opens the right panel (for example the packet) so
  you do it yourself.
- **Untrusted text:** when a proposal was built after reading a job posting,
  an evaluation, a packet or record notes, the card says "Includes text from:"
  with the sources. Check those changes with extra care.
- **While it works:** Claude streams its reply as it is written; other
  providers show the reply when it is complete. **Stop** ends the reply; nothing
  is changed. Tasks it starts appear as task cards in the conversation with
  their progress, cancel and retry.
- **Suggestions** under the conversation come from the briefing (for example
  "What's due this week?" or "Help me build my profile"). They only fill the
  message box; nothing is sent until you press Enter or **Send**.
- **History:** the conversation and undecided proposals survive a reload. It is
  stored in `data/plainhand/conversation.jsonl` (last 500 messages). Workspace →
  **Clear conversation** deletes it after you confirm; saved changes stay.


1. **Profile & brain:** import a PDF/text resume or paste it. Supply name, location,
   target roles, and relevant preferences. Add project context and real writing
   samples to the story and voice fields. Review imported text and save.
2. **Conversation:** explain an experience, answer follow-up questions, and build
   an understanding. Review its summary, strengths, voice, and example answer.
   Approve it only if it reflects you. Readiness remains specific to each job.
3. **Jobs:** paste the exact company, role, and URL. Add the description
   when the page is unsupported or cannot be read. Alternatively add company
   Greenhouse, Lever, or Ashby boards and run discovery with optional text filters.
4. **Evaluate fit:** inspect supporting evidence, gaps, questions, and browser
   verification. ATS hosting alone is not independent proof of employer identity.
5. **Choose this role:** select the exact opportunity. Scores below 4/5 require
   a recorded reason to proceed. Discovery never starts applications automatically.
6. **Prepare application:** generate a resume, cover letter, and answer bundle.
   Exact source excerpts are required for resume entries and answers, and a
   separate model pass reviews the complete packet for unsupported claims. One
   bounded correction pass can remove unsupported claims using reviewer feedback;
   unresolved factual issues still block documents and approval.
7. **Review:** read the actual PDFs and wording. Resolve open questions in role
   context, re-evaluate, and regenerate when needed. Approval is tied to the
   current role, context, packet, and resume file identity.
8. **Apply:** in the role's Apply tab, inspect and fill reviewed answers, or choose **Autofill
   to final review** to fill evidence-backed answers and advance through explicit
   next-step buttons (up to six pages per run). Custom ARIA comboboxes use real
   option matching. Ambiguous steps, missing required facts, login walls and
   unresolved challenges pause the run. Uploads use the exact approved resume.
   Final submission controls are never selected by the automation.
9. **Take over:** after filling, explicitly take over the visible browser.
   Plainhand stops controlling the session and removes its write-request block
   so you can complete remaining fields and submit yourself. Then confirm the
   submission in Plainhand to record `Applied`.
10. **Track it:** the role's **Record** tab holds its application record:
   a dated next action, interview rounds (stage, date, interviewer, preparation,
   notes, status) and contacts (recruiter, hiring manager, interviewer, referral).
   **Applications → Follow-ups** lists next actions, overdue first, then active
   applications that still have none; overdue and upcoming items also appear
   in the Home briefing. Interview rounds and contacts are added from the
   **Add interview round** and **Add contact** buttons, and the tab ends with
   the role's timeline. The next action is also written to the
   tracker's Notes column. Recording an interview round never changes the
   application status. Set the status yourself.

## Follow-ups

Once you confirm you submitted an application, the job panel's **Record** tab
has a **Follow-ups** section. Plainhand drafts the message; it never sends it.

- **Draft a follow-up:** choose a **thank-you** (after an interview round), a
  **check-in** (after silence) or a **reply** (paste the recruiter's message),
  who it is to (a contact from the record, or the hiring team) and, optionally,
  what to mention in your own words. The draft runs as a task with progress in
  the panel header; it is never offered for a role you have not submitted.
- **Grounded and checked:** the provider receives only your submitted packet
  (resume entries, answers, cover letter), the application record (role,
  company, submission date, the recipient's name and role, interview stages and
  dates) and your notes. Contact email, phone and notes, and interview notes,
  are not sent. Three passes follow the humanizer process: a draft, an
  independent audit (facts against the packet and record, plus style: AI-sounding
  phrasing, filler, length, wrong names or dates), and a final version that
  applies the audit. Plainhand also checks every pass by rule: each claim needs an
  exact quote from the packet, record or your notes; the greeting must be to the
  recipient you chose; the company must be the record's and no other tracked
  company may appear; dates, weekdays, numbers, links and addresses must come
  from those sources; the length must fit the kind of message. If the audit fails
  twice the draft is **blocked**: no text is kept and the issues are listed.
- **Recruiter text is data:** a pasted message can be answered, but it is never
  evidence for a claim about you, cannot change who the reply goes to and cannot
  send anything. When the assistant reads drafts (`followups.drafts`) the turn is
  marked as including untrusted text.
- **Use it:** each final draft shows **Copy**, the evidence behind each claim,
  the audit summary, **Edit** (your own words, marked "Edited by you"),
  **Discard** (restore from "Discarded drafts") and **I sent this**. Only you can
  say a message was sent (the assistant and MCP are refused and pointed to the
  panel); the confirmation asks how and when, records it in Activity and, if the
  application has no next action, sets one: a check-in 5 business days after a
  thank-you, another check-in 7 business days after a check-in (after two, a
  prompt to decide whether to close it), and 3 business days after a reply.
- **Briefing:** the workspace digest used by the assistant and MCP lists a
  completed interview with no thank-you yet, and an application that has been
  silent past the cadence (7 business days after applying, 3 after a response)
  with no next action and no check-in under way.

## State, evidence, and recovery

Personal data is owned by the user and excluded from Git:

- `config/profile.yml`: identity and preferences, preserving unrecognized fields.
- `cv.md`: resume text; an existing structured resume source is not overwritten.
- `data/plainhand/workspace.json`: voice, interview, reviewed understanding,
  saved sources, job context, task state, browser checkpoints, and each role's
  application record (`job.record`: contacts, interview rounds, next action).
  Contacts and interview notes are about other people and the employer. They
  are not candidate evidence, never enter provider context, and do not
  invalidate an approved packet.
- `data/plainhand/backups/*`: prior config/resume content before explicit saves.
- `data/applications.md`: canonical application status; existing rows/statuses
  are read back and exact company-plus-role duplicates are prevented.
- `reports/*`: role reports with Blocks A–G, URL and legitimacy/verification fields.
- `output/*`: PDFs, HTML, answers, metadata, and packet manifests following the
  existing artifact identity contract.

Existing structured resume, narrative, proof-point, and story-bank files are
included as named context sources when present. The unchanged narrative template
is excluded. Only candidate interview messages become factual conversation
evidence; unreviewed assistant summaries do not. Approved understanding is included
as guidance and changes the context fingerprint.

Tasks are serialized and journaled. Failure, cancellation, and interrupted work
remain visible in Activity. On restart, unfinished tasks become interrupted and
can be retried. Browser processes and provider login sessions are ephemeral; browser pages must
be reopened after a server restart. Employer cookies and local storage are saved
per ATS origin under `data/plainhand/browser/` with owner-only file permissions,
and restored when reopening. These are sensitive local credentials, excluded from
Git, exports, and model context. This does not import your default browser profile
or preserve every kind of authentication state. Active pages are reused when
inspecting again, so in-session edits and the current form step are preserved.

When login or a challenge needs your attention, use **Handle sign-in or
verification** to take control, then **Resume inspection** to reapply the write
guard and inspect the same page. Your local browser must be visible for manual
steps. Never treat this as confirmation that a CAPTCHA has been solved.

Changing candidate evidence invalidates approval through context fingerprints.
Changing the role, description, or packet likewise requires a new review. Resume
bytes are checked again before upload. Candidate confirmation is the only source
of submission status in this release; no submission receipt is inferred.

Exports contain personal information and may include sensitive answers. Store
them accordingly. Workspace → Import a workspace restores an export on a new computer or into a
fresh folder. It shows what the export contains, asks for confirmation, and backs
up the current workspace to `data/plainhand/backups/*-import-*` first. Packet
approvals are reset because PDFs are not part of an export, and browser sessions
do not move between computers.

## Campaigns

A campaign is a named search over the company boards you follow under Jobs
(milestone N1). Open **Campaigns** in the navigation to create, edit, pause,
resume, run or delete one; the assistant can do the same through the
`campaigns.*` actions, with your confirmation for every change and run.

**One place.** All campaigns live in `data/plainhand/campaigns.json` (owner-only):
name, role keywords (matched in the title), locations, exclusions (words that
drop a role when they appear in its title or company), sources (default: every
source, including ones added later), schedule, daily evaluation limit,
liveness check and desktop notification. Pausing or editing is one action that
writes this one file. Run history, health, the seen-role ledger and daily
evaluation counts are runtime data in `data/plainhand/campaign-runs.json`;
deleting that file forgets history, never a campaign. A small derived summary
(`campaignBrief`) is kept in the workspace state for the briefing.

**Schedule.** `manual`, `daily`, or `every N hours` with N at least 6. Scheduled
campaigns are checked every minute while Plainhand runs and run through the task
queue as a `campaign-scan` task. A scheduled campaign that has never run is due
right away; afterwards it is due one interval after its last start. A run missed
while Plainhand was closed runs once at the next start, not once per missed slot.
Paused campaigns are not scheduled; **Run now** still works for them.

**What is surfaced.** Each run scans the chosen sources (a failing source is
recorded and the others still run), keeps roles whose title contains a keyword
and whose location matches, drops exclusions, skips roles already in the
workspace (same link, or same company and title), roles already seen by a
campaign and roles in the command-line scan history
(`data/plainhand/scan-history.json`), then checks each remaining posting is open
(liveness, on by default). Closed postings are not surfaced.

**Saved automatically.** Every surfaced role is saved to the Jobs inbox, tagged
with the campaign and the reason it was surfaced, for example: *Matched
"Mechanical Engineer" in the title; in Boston, MA; source Acme board; first
seen 2026-10-26; posting checked and open*. Saving is automatic because it is
reversible and never starts an application. Surfaced roles are also added to
the shared scan history.

**Re-surfacing rule.** A role is surfaced once. It is surfaced again only after
a meaningful change: it was seen closed (liveness) or gone from its board on an
earlier successful scan and is listed again (reposted), or the same posting
link now carries a different title. A role already in the workspace is never
surfaced again; its saved row is the single record.

**Evaluation.** With a daily evaluation limit above 0 (at most 10), a run queues
`evaluate` tasks for at most that many newly saved roles per campaign per local
day; the count is persisted, so later runs the same day queue no more. With 0
(the default) roles are only saved. Evaluation needs a connected agent and a
ready profile; otherwise the run notes that it was skipped and the count is not
used. Campaigns never prepare, approve or apply.

**Health and notifications.** Each campaign shows its last run (new, already
known and closed counts), next run, evaluations used today, per-source errors
with consecutive failures and notes such as a reached limit. The briefing
(`workspace.digest`) lists new campaign roles since you last opened Campaigns,
sources that could not be checked, and, at low priority, paused campaigns whose
schedule is due. Each run emits a `campaign.update` event on the live stream. A
desktop notification (through the existing notify-send adapter and delivery
journal) is sent only when enabled for the campaign, says where the role was
found and why, and is never sent twice for the same role.

## Current limits

- Discovery uses user-configured company boards, on demand or through scheduled
  campaigns that run while Plainhand is open (see Campaigns). There is no broad
  web-search engine, and nothing scans while Plainhand is closed.
- Browser verification and form assistance support any public HTTPS portal; measured
  end-to-end on Greenhouse, Lever, Ashby, Recruitee and Workable. Workday stops at its
  account sign-in step, SmartRecruiters at a DataDome challenge. See
  [ATS compatibility](ATS-COMPATIBILITY.md)
  URLs. Other HTTPS job URLs can be saved and evaluated from pasted descriptions,
  with verification explicitly unconfirmed and manual application required.
- Verification requires a matching title, substantial page text, and an apply
  control. Login walls, bot checks, and some dynamic pages remain unconfirmed.
- Standard fields, native selects, resume uploads and ARIA comboboxes with
  visible options are supported. Other custom widgets, checkboxes, radio choices,
  legal attestations, demographic questions and additional attachments can need
  candidate handling. Native select choices still require explicit answers.
- During automated inspection/filling, outbound application writes and off-allowlist resources
  are blocked, with a scoped exception for approved-resume Ashby upload handles and their validated S3 transfer. CAPTCHA verification resources have a separate narrow allowance. Some ATS pages therefore need manual completion. The final-submission boundary
  is removed only at explicit candidate handoff.
- Provider requests have a three-minute timeout and run from a temporary working
  directory. No automatic provider fallback or account rotation is implemented.
- Exact evidence quotes establish source linkage, not semantic proof of every
  paraphrase. The model reviewer and final candidate review are still necessary.
- The sample workspace is browser-only, clearly fictional, and cannot perform
  live writes or inference. Automated tests use separate explicit synthetic
  adapters; they do not prove live account entitlement or site compatibility.
- Reusable interview context and evidence-backed text-field suggestions are
  supported. A separate scoped answer-bank editor, richer attachment ingestion,
  and broader custom widget support remain future work. Form edits are not silently
  promoted into permanent profile facts; add reusable corrections in role context.
- Career-ops components remain installed during extraction. Plainhand currently
  reuses ATS discovery adapters and the tracker/artifact contracts. See [the upstream reuse review](CAREER-OPS-REUSE-REVIEW.md) for the pinned
  1.37.0 comparison. The TUI is retained as an optional pipeline/report interface
  (`npm run tui`), with Plainhand branding. Redundant modes remain during extraction.

## Verification

```bash
npm run test:plainhand
npm run test:plainhand-ui
npm run test:full
node test-all.mjs --quick
```

Integration tests use temporary workspaces and synthetic provider results. They
exercise source gates, duplicate prevention, exact approvals, restart/cancellation,
manual submission confirmation, real Chromium PDFs and artifact metadata, and
reviewed form filling without submission. Browser tests exercise the complete UI
and capture desktop/mobile screenshots under `/tmp/plainhand-ui`.

Live account and employer-site validation remains a separate environment check.
No tests submit a real job application.

`npm run test:full` includes the non-quick repository checks, Go build and package
tests, standalone portal-adapter fixtures, browser/theme workflow, and dependency
audit. It writes logs and screenshot evidence under `output/verification-*`.
`npm run test:plainhand-live -- --provider claude` explicitly opts into real model
usage with a fictional candidate and local employer fixture. It retains a
reviewable proof workspace under `/tmp/plainhand-live-proof-*`, never submits,
and fails rather than bypassing unresolved factual or candidate-answer gates.

## Optional managed browser and CAPTCHA handling

Local Chromium remains the default. To opt into Browser Use Cloud infrastructure:

```bash
export PLAINHAND_BROWSER_BACKEND=browser-use
# Set BROWSER_USE_API_KEY securely in your shell/environment.
export PLAINHAND_BROWSER_COUNTRY=us
npm start
```

This uses the V4 standalone-browser API, attaches Playwright through CDP, and
requests `solveCaptchas: true`. The selected Codex/Claude/Antigravity CLI remains
the reasoning provider. A live-view link is shown when the service supplies one.
When a visible challenge is detected, automatic filling can wait up to two minutes
for the managed browser to resolve it, then reinspects the same page. Remaining
challenges pause rather than restarting the application.

This is a paid third-party browser service, separate from your AI subscription.
The application page, supplied answers/files, and any restored portal session
state enter that remote browser. Configure it only if that is your intended
deployment. The service documents reCAPTCHA and hCaptcha support with limitations;
other challenge types are not assumed solved. No cloud account or real challenge
was exercised by the automated tests; the lifecycle integration is contract-tested
with synthetic responses. There is no measured 90% completion rate yet.

Closing a managed session explicitly calls the stop endpoint to end billing,
including after connection failures. Shut down Plainhand cleanly. A process crash
can leave a remote browser running: check/stop it in the service console. Local browsers use no managed-browser service. The optional free local audio
solver is installed with `npm run setup:captcha`; it handles the implemented
English reCAPTCHA audio path, with remaining challenges handed back to the user.
See [free solver research and validation](FREE-CAPTCHA-SOLVERS.md).

References: [browser API](https://browser-use.com/playwright),
[CAPTCHA behavior](https://docs.browser-use.com/cloud/browser/captcha-handling).

The application-write guard blocks ATS writes except an explicitly scoped
Ashby `file.createFileUploadHandle` flow and one validated S3 multipart upload
containing the exact approved PDF. Its grant is limited to the originating frame
and expires after the fill operation or 15 seconds. The submission endpoint stays
blocked. The UI distinguishes local file selection from a server-accepted transfer;
failed, pending or unconfirmed transfers stop autofill. This supported request
shape is fixture-tested, not validated against live Ashby employer pages. Other
upload flows and unreviewed POST-based schema lookups remain blocked. Three
public Ashby query documents are pinned by SHA-256 (posting, organization and
location autocomplete); variables are restricted and the request must originate
from a matching live Ashby posting. Mutations, query changes and extra variables
remain blocked. Observed ATS static frontend/font/image paths are allowed as reads.
Managed browser service workers/extensions may operate outside Playwright routing;
the managed integration requires live compatibility and submission-boundary tests
before it can be considered equivalent to the controlled local fixtures.

Run `npm run test:plainhand-browser` for session, interruption, multistep, dropdown
and managed-browser contract checks. The full suite includes these checks.

## Browser execution and project reuse

Application filling now uses the richer Career Ops 1.37.0 extractor behind a
Plainhand adapter. It resolves labels from ARIA references, field wrappers and
legends, recognizes contenteditable controls, and supports hidden file inputs on
active form steps. Hidden inactive steps and passwords are excluded. Native
select suggestions must be grounded in candidate evidence and name an actual
option value. Filled values and selected combobox displays are checked afterward;
failed readback and visible validation errors pause the automatic run.

When a form is behind supported application controls, **Autofill to final review**
can ask the selected CLI to choose one observed navigation ref at a time. Fresh
refs, same-portal checks and a guarded executor prevent arbitrary selectors or
page-code execution. Navigation stops on unchanged pages, login/challenge gates
or its budget (five actions per drive, ten model calls per run, six form pages).
Navigation traces are retained with the packet-bound browser checkpoint.

A DOM form-submission interlock supplements the outbound write guard and the
submit-control classifier, including next-looking handlers that call
`requestSubmit()`. Explicit human takeover releases those guards. This does not
make a remote or hostile browser environment an OS-level security sandbox.

See [the automation source review](BROWSER-AUTOMATION-OPTIONS.md) for 13 projects,
source pins, what was actually integrated, and the next comparison candidates.
Stagehand and agent-browser are shortlisted for richer browser observation and
transport; their complete runtimes are not claimed as integrated or benchmarked.

## AI usage

Open **AI usage** in the sidebar for recorded calls, reported input/output/cache
counts, duration, provider and application totals, model IDs when reported, failures,
explicit task retries and recent calls. Workspace outcome counts give context but
include earlier work; they do not establish a completion rate or cost per success.

Tracking starts with this feature. Earlier token usage cannot be reconstructed.
Only calls through this Plainhand workspace are recorded, not other apps or other
uses of the same subscription. Remaining account quota and subscription percentages
are unavailable. CLI-reported USD is displayed as a reference figure, not a bill
or a deduction from a subscription balance. There is no API-price calculator.

Claude JSON result metadata provides aggregate usage, model IDs and reported USD
when present. Input totals include uncached input plus cache reads/writes. If cache counters
are omitted, uncached input is retained separately and the combined total stays
unavailable. Codex
requests JSON events and sums completed turns; cached input and reasoning output
are subsets and are not added a second time. Unreported fields remain null, not
zero. Antigravity's metering contract remains unverified, so its call count,
status and duration are recorded while token/model/cost data stay unavailable.

Atomic owner-only receipts under `data/plainhand/usage/` are separate from workspace
transactions, so browser calls can be metered while a longer request is running.
Receipts survive restart; a running receipt becomes interrupted with unknown
completion duration. Failed/canceled calls retain reported usage if available.
No prompts, answers, raw CLI output, provider session IDs or credentials are saved
in receipts or sent back into candidate reasoning context. Explicit workspace
exports include the receipts as `agentUsage`.

Verification: `npm run test:plainhand` includes normalization, privacy, concurrent
persistence, unknown/zero distinctions, interrupted calls, per-job attribution,
export and explicit task retries. The background website suite checks the usage
screen in both themes. Opt-in actual CLI metering:

```bash
node test-plainhand-usage-live.mjs --provider claude
```

One minimal real check recorded 2,955 input tokens (including 649 cache reads and
2,304 cache writes), 9 output tokens and 3,142 ms. This is one instrumentation
check, not an application benchmark. Evidence:
`output/usage-live-2026-10-18T20-41-09-597Z/result.json`.

Primary format references:
[Codex event types](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts),
[Claude programmatic output](https://code.claude.com/docs/en/headless).

## Insights

Open **Insights** in the sidebar to see whether your fit scores go with
interviews, using your own applications. It reads your Plainhand jobs (score,
status history, submission date, interview rounds in the application record) and
the canonical tracker `data/applications.md`, including rows from before
Plainhand. It never writes to the tracker, reports, profile or configuration.

**Score bands.** Each band (0.0–2.9 up to 4.5–5.0) counts scored, applied,
interview, offer, rejected, pending and silent applications. An application that
reached an interview and was later rejected counts as both. A band shows an
interview rate only once it has 5 observed outcomes (interview, offer or
rejection); below that it says **Not enough data**, never 0%. Rates stay
**Provisional** until 20 observed outcomes overall, and only then does the page
say whether higher scores went with more interviews. That statement is a
correlation in your outcomes, not proof.

**Silence.** An application still at Applied with no status change for 21 days
counts as silent. Silent is not rejected: it is an assumption, shown in its own
column and kept out of the observed interview rate. A second figure, "if silence
means no", shows the rate when every silent application is treated as no
interview. For tracker rows without Plainhand history, the row date stands in for
the application date and only the current status is known.

**Observed and assumed.** The page lists which facts are observed (status changes
you recorded, interview rounds, tracker statuses, explicit report outcomes) and
which are assumed (silence, legacy row dates, the "if silence means no" rate).

**Patterns.** Interview rates by role archetype, company, narrative, resume
framing, follow-up channel and application portal, each with its sample size.
Archetype, narrative, framing and channel come from the machine summary of a
linked report. A group needs 8 observed outcomes before it shows a rate; below
that it is insufficient data, which is not evidence either way. With enough
outcomes and no interviews it is marked as negative evidence.

**Suggestions.** Select **Look for suggestions** once there are at least 8
observed outcomes. Plainhand proposes changes to score thresholds, targets,
narratives, channels or portals that your outcomes support, and saves each one
once (a repeat with the same outcomes adds nothing). You **Approve**, **Reject**
or **Defer** each one; rejecting or deferring asks for a short reason. Approving
records your decision only: change your targets, story or sources yourself in
Profile or discovery. A suggestion made from older outcomes can be rejected or
deferred but not approved; the current version appears as a new suggestion.
Deferred suggestions come back when your outcomes change.

The assistant and MCP can read `insights.summary`, `insights.patterns` and
`insights.recommendations` without confirmation. `insights.suggest` is a write
(the assistant proposes it for you to confirm). `insights.approve`, `.reject` and
`.defer` are yours only: the assistant opens the Insights page instead. The
briefing digest mentions new outcomes only when they make a new suggestion
possible, and stays quiet while there is too little data. Decisions are kept in
`data/plainhand/insights/` (state file and append-only journal).

Verification: `npm run test:plainhand` includes `test-feature-insights.mjs`; the
full suite runs the browser check `test-feature-insights-ui.mjs` (empty and
insufficient states, bands with legacy rows, approve and reject, unchanged source
files, light, dark and mobile).
