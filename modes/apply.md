# Mode: apply — Pre-Submit Application Automation

Operational spec for filling job applications end to end while keeping the
candidate in final control. The agent resolves the exact role, prepares the
right tailored materials, fills the form(s), stops at review, and records
durable state only after the candidate confirms submission.

Artifact identity, naming, freshness, and ambiguity handling are governed by
`docs/artifact-contract.md`.

## Requirements

- **Preferred path**: Playwright in visible mode so the candidate can watch the
  browser and intervene if needed.
- **Fallback path**: browser harness (`/browse`) for JS-heavy portals or when
  Playwright snapshots are unreliable.
- **Manual fallback**: if browser tooling is unavailable, the candidate can
  share screenshots or paste the visible questions for response generation only.

Tool-switch rule:
- The agent may switch autonomously between Playwright and browser harness in
  the same application run when one tool is materially better for the current
  page state.
- Use Playwright by default for stable form filling, nested editors, and
  structured DOM interactions.
- Switch to browser harness when compositor-level clicks, direct CDP control,
  or OTP-gated / JS-heavy portal states defeat Playwright.
- Switch back to Playwright when browser harness can open the page but cannot
  reliably commit framework-controlled inputs.
- Before switching tools, capture the current state and continue from the safest known checkpoint rather than restarting blindly.

## Executable browser engine

The repository includes a Playwright implementation for the deterministic portion
of this mode:

```bash
npm run apply:browser -- \
  --url "https://example.com/application" \
  --company "Example Co" \
  --role "Senior Engineer" \
  --report reports/001-example.md \
  --pause
```

It requires `config/profile.yml`, the answer bank, and an exact tailored resume
artifact. It fills approved profile and answer-bank values, uploads that exact
artifact, clicks an explicit draft-save control when one is available, and
records `data/application-drafts.md`. It never clicks a finalizing control.

This engine is intentionally conservative: CAPTCHA, OTP, authentication,
ambiguous custom questions, unsupported widgets, and portals without a safe
draft-save control become blockers for candidate review. The browser runner
selects a dedicated portal adapter for supported ATS families (Workday, Ashby,
Greenhouse, and Lever). Unknown and known-but-unsupported ATS families are
blocked; the generic safety-first adapter runs only when `--portal custom` is
explicitly configured. Unknown controls remain blockers rather than guessed
fallbacks.

## Non-Negotiables

- NEVER submit an application.
- NEVER click a control labeled `Submit`, `Apply`, `Send`, `Finish`, `Complete`,
  `Review and Submit`, or any equivalent finalizing action.
- If a control might submit the application and there is any uncertainty,
  STOP. Treat ambiguity as a hard blocker, not a judgment call.
- Final submission is candidate-only, even if the user says `apply`, `go
  ahead`, `finish it`, or similar broad phrasing. Only fill, save, and pause.
- NEVER silently upload `output/Resume-latest.pdf` when a tailored CV is
  expected.
- NEVER treat malformed artifact metadata as "close enough"; invalid dates,
  invalid timestamps, enum drift, or ambiguous same-company multi-role matches
  are hard blockers.
- NEVER create new statuses outside `templates/states.yml`.
- Keep PII and reusable answers in gitignored user-layer files only.
- NEVER leave a timeout-prone portal without saving the draft first when a
  save/draft action exists.

## When This Mode May Run

The apply engine runs only after these preconditions are checked:

1. The job URL is live.
2. The company + role identity is unambiguous.
3. The role is approved for application (`Apply` or explicit user override).
4. A tracker row exists or is created for this exact company+role (new rows
   ONLY via TSV in `batch/tracker-additions/` + `merge-tracker.mjs` — never by
   editing `data/applications.md` directly).
5. Referral state is known, even if the answer is "no referral".
6. The required per-job artifacts can be resolved under
   `docs/artifact-contract.md` rules or generated without ambiguity.
7. The candidate artifact metadata is structurally valid, not just present.

If any precondition fails, stop and report the blocker before opening tabs.

## Primary Data Sources

| Source | What it covers |
|--------|----------------|
| `config/profile.yml` | Name, email, phone, address, EEO, languages, references, compensation, relocation |
| `data/application-answers.md` | Pre-drafted long-form Q&A templates (Q1-Q15) |
| `cv.md` | Full work history, skills, education detail |
| `data/applications.md` | Canonical tracker row for company+role |
| `data/application-drafts.md` | Pre-submit draft-save state per role/session |
| `data/portal-notes/*.md` | Portal-family learnings, pitfalls, and proven interaction patterns |
| `reports/{###}-*.md` | Evaluation context + Section G draft answers |
| `data/contacts.md` | Referral and contact state |

## The 14-Step Apply Engine

This sequence runs automatically on every application-filling request. Browser
tooling: Playwright first; browser harness (`/browse`) as fallback when the
portal defeats Playwright.

```text
1. VALIDATE     → Confirm liveness, role approval, tracker row, and referral state
2. LOAD         → Read profile.yml + application-answers.md + cv.md + report
3. RESOLVE      → Resolve the exact per-job artifact set for THIS exact role;
                  generate missing exact artifacts if allowed. Never default to
                  the general resume silently
4. OPEN         → Open application URL in browser tooling
5. INSPECT      → Snapshot the live page and identify actual visible fields
6. INJECT       → Customize long-form answers for company, role, location, referral
7. HUMANIZE     → Re-run /humanizer on any prose edited for this specific role
8. FILL         → Structured fields from profile.yml; prose from answer bank/report;
                  upload the resolved tailored resume
9. SAVE         → Trigger the portal's save/draft action before any role switch,
                  pause, timeout risk, or long detour
10. VERIFY_SAVE → Confirm whether the draft persisted and record the exact state
                  in data/application-drafts.md
11. PAUSE       → Stop at the final review screen or safest resumable checkpoint;
                  NEVER click any control that could finalize the application
12. REPORT      → Produce a gap report with missing fields, blocked fields, exact
                  resume-to-role pairing, and saved-vs-unsaved state
13. HANDOFF     → Candidate reviews, edits if needed, and submits manually
14. FINALIZE    → Only after candidate confirms submit: mark Applied, update
                  follow-ups, and persist reusable final answers
```

## Role Detection and Context Loading

### With browser tooling

- Read the page title, URL, and visible content.
- Extract company + role directly from the page.
- Search `reports/` for the matching evaluation report.
- If Section G exists, use it as a starting point for company-specific answers.

### Without browser tooling

Ask the candidate to provide one of:
- a screenshot of the form
- the visible form questions as text
- the company + role + URL

If there is no matching report, stop and offer to run auto-pipeline first.

## Tracker and Approval Contract

- `data/applications.md` remains the canonical one-row-per-company+role spine.
- Apply mode must not invent a new canonical status.
- Pre-submit prepared state lives in:
  - Section G of the report for role-specific draft answers
  - `data/application-drafts.md` for operational draft-save state
  - the final gap report for "ready / blocked / skipped" and
    "saved / unsaved / blocked-before-save" tab state
  - tracker notes only if a durable note is necessary

Until the candidate confirms submission, the row does NOT move to `Applied`.
If the browser session reaches a final review page or any ambiguous final step,
the apply run is complete and must hand off immediately.

## Draft-Save Contract

Treat draft persistence as part of application safety, not as portal trivia.

For each role capture in `data/application-drafts.md`:
- company
- role
- role URL
- portal family
- draft status
- saved_at timestamp
- resumable URL if available
- resume artifact resolved for the role
- referral used
- blockers / missing manual fields

Allowed draft statuses:
- `saved_draft`
- `review_ready`
- `filled_not_saved`
- `blocked_before_save`
- `not_started`

Rules:
- Assume no autosave unless the live page proves it.
- Before switching roles, opening a second timeout-prone flow, waiting on the
  candidate, or doing analysis that could burn session time, run SAVE first.
- If the portal has no save action, record `filled_not_saved` explicitly and
  report the risk.
- If save succeeds and the page is still one step short of submit, prefer
  `saved_draft`.
- If save succeeds and the role is already at final review, prefer
  `review_ready`.
- `review_ready` means the browser is intentionally parked before final
  submission. It never authorizes the agent to continue past that point.

## Portal Learning Contract

Treat portal behavior as reusable system knowledge, not one-off troubleshooting.

Before opening or filling a portal family:
- Read `data/portal-notes/<portal-family>.md` if it exists.
- Apply any confirmed field-handling rules, save behavior, and submit-boundary
  warnings from that file before inventing a new approach.

After any apply run that reveals something durable:
- Add or update the matching file in `data/portal-notes/`.
- Record only high-signal facts that change future execution:
  - exact meaning of ambiguous buttons
  - whether autosave exists
  - which fields are dependent/autocomplete widgets
  - whether yes/no pills can be trusted by index
  - which browser tool worked better for which page state
  - proven upload or save patterns
  - exact hard-stop rules near final submission
- Prefer portal-family notes over ad hoc session memory. The next apply run
  should get better because the note exists, not because the agent remembers.

Minimum note structure:
- portal family
- last verified date
- preferred tool / switch triggers
- stable behaviors
- known failure modes
- proven interaction tactics
- no-submit boundary

## Resume Resolution

The general resume (`output/Resume-latest.pdf`) is the tailoring SOURCE, not
the default upload.

Resolution order for each position is defined by
`docs/artifact-contract.md`. Resume-specific summary:

```text
a. TRACKER    → Find the exact company+role row in data/applications.md.
                If the PDF signal exists, trace it back to the matching
                report/output artifact
b. OUTPUT     → Find exact output/cv-*-{company-slug}-{role-slug}-*.pdf match
                plus metadata. Same-company, wrong-role files do NOT count
c. VALIDATE   → Reject candidates whose metadata values are malformed even if
                the filename looks correct
d. GENERATE   → No exact match → run pdf mode first and create
                output/cv-{candidate}-{company-slug}-{role-slug}-{date}.pdf
e. AMBIGUITY  → Multiple plausible matches, same-company multi-role collisions,
                or unclear company/role identity →
                stop and resolve before any upload occurs
f. OVERRIDE   → General resume is not an automatic fallback; candidate override
                may permit it only outside the exact-match default path
```

For batches: resolve ALL resumes before tab one opens. The final report must
show which resume was paired to which role.

The same exact-match standard applies to cover letters when required. For
answers, exact per-job artifact reuse is preferred, but in-session synthesis
from the matching report plus answer bank plus CV is allowed when no exact
answers artifact exists yet.

## Referral Contract

Treat referral as workflow data, not just a form field.

For each role capture:
- referrer name
- source/channel
- whether the portal exposes a referral field
- whether the name must be embedded in prose instead
- whether a post-submit confirmation message is required

If a form asks "Were you referred by an employee?" or similar:
- Select "Yes" only if referral state is confirmed in session context or
  `data/contacts.md`
- If a text field appears: enter the referrer's name
- If no text field appears: work the referrer's name into Q14/Q15-style prose

## Long-Form Answer Generation

Use these inputs in order:

1. Matching report context:
   - proof points from Block B
   - STAR stories from Block F
   - prior Section G drafts
2. `data/application-answers.md`
3. `cv.md`

Generation rules:
- Reference visible JD specifics when possible.
- Preserve the "I'm choosing you" tone from auto-pipeline.
- Keep answers specific, not generic filler.
- If the role title drifted from the evaluated report, stop and either adapt
  consciously or re-evaluate first.

### Answer sourcing table

| Question type | Source |
|--------------|--------|
| Tell me about yourself | Q1 in `data/application-answers.md` |
| Why this role | Q2 in `data/application-answers.md` |
| Why [Company] | Q3 in `data/application-answers.md` (customize) |
| Challenging project | Q4 in `data/application-answers.md` |
| Team leadership | Q5 in `data/application-answers.md` |
| Weakness | Q6 in `data/application-answers.md` |
| 5-year goals | Q7 in `data/application-answers.md` |
| Why engineering | Q8 in `data/application-answers.md` |
| CAD/software experience | Q9 in `data/application-answers.md` |
| Multiple deadlines | Q10 in `data/application-answers.md` |
| Relocation | Q11 in `data/application-answers.md` |
| Salary | Q12 in `data/application-answers.md` |
| Work authorization | Q13 in `data/application-answers.md` |
| How did you hear / referral | Q14 in `data/application-answers.md` (customize) |
| Cover letter | Q15 in `data/application-answers.md` (customize) |

## Humanizer Contract

Every recruiter-facing prose field must pass `/humanizer`.

Rules:
- Stored answer-bank drafts may already be humanized at rest.
- Any company-specific or role-specific edit must be humanized again before fill.
- Do not re-humanize unchanged factual fields or untouched boilerplate just for
  ceremony.

## Field-Filling Reference (read values from config/profile.yml at runtime)

**NEVER hardcode candidate PII in this file** — `modes/` is system layer and committed to git. All values below are profile.yml key paths; read them fresh each session.

| Form field | profile.yml key |
|------------|-----------------|
| Full name | `candidate.full_name` |
| Email | `candidate.email` |
| Phone | `candidate.phone` |
| Address | `address.*` (line1, city, state, zip) |
| LinkedIn | `candidate.linkedin` |
| US citizen / work auth | `eeo.us_citizen`, `location.visa_status` |
| Sponsorship required | `eeo.sponsorship_required` |
| Willing to relocate | `location.willing_to_relocate` |
| Salary expectation | `compensation.target_range` |
| EEO — race / gender / veteran / disability | `eeo.*` |
| GPA | `routine.constraint_value` |
| Languages | `languages.*` |
| References | `references.*` (skip fields still blank) |
| Degree / school / graduation | read from `cv.md` Education section |

## Batch Semantics

When applying to multiple positions at once:

- Validate and resolve resumes for all roles first.
- Then open/fill tabs.
- One failed tab must not invalidate the others.
- Timeout-prone portals default to one-role-at-a-time progression unless draft
  persistence has already been verified on that portal family.
- Before moving from role A to role B, role A must be in `saved_draft`,
  `review_ready`, or an explicitly reported unsaved-risk state.
- Final report must split roles into:
  - ready to submit
  - blocked
  - skipped
- Final report must also split roles into:
  - saved draft
  - review ready
  - filled but not saved
  - blocked before save
- The number of applications is determined by liveness, not by the count of
  links in an email thread.
- `ready to submit` means ready for the candidate to submit manually, never for
  the agent to submit.

If a role blocks mid-run, keep going on the remaining roles when safe to do so,
then surface the blocker in the consolidated report.

## Output Format (manual fallback or report generation)

```text
## Responses for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type]

---

### 1. [Exact form question]
> [Response ready for copy-paste]

### 2. [Next question]
> [Response]

...

---

Notes:
- [Any observations about the role or portal]
- [Exact resume chosen for this role]
- [Draft status and resumable URL]
- [Anything the candidate must review before submit]
```

## Draft State File Format

`data/application-drafts.md` is the canonical pre-submit operational ledger.
One entry per exact company+role.

Suggested row format:

```text
| Updated | Company | Role | Portal | Draft Status | Resume | Referral | Resume URL | Notes |
```

This file is user-layer, gitignored, and may be updated during apply sessions.

## Post-Submit Finalization

Only if the candidate confirms submission:
1. Update status in `data/applications.md` to `Applied`
2. Add or update the entry in `data/follow-ups.md`
3. Persist the final responses in Section G when useful
4. Suggest `/career-ops contacto` if referral or recruiter follow-up is needed

## Scroll Handling

If the form has more questions than the visible ones:
- scroll and continue in-browser when tooling allows
- otherwise ask the candidate for another screenshot or pasted text
- continue until the full form is covered

---

## Portal Quirks appendix (reactive reference — NOT an upfront step)

Consult this only when a portal misbehaves during filling. Add new entries whenever a portal does something surprising, so the second encounter is faster.

### Oracle HCM (`*.fa.*.oraclecloud.com`) — learned 2026-06 (Stantec)

- **Snapshot refs go stale fast** — the page re-renders dynamically (180+ console errors is normal). Use `browser_evaluate` with JS targeting element IDs/names instead of snapshot refs.
- **Consent checkbox** — label may use curly apostrophe (`'`); match with `includes('consent')`, not exact string.
- **Terms modal** — clicking the consent checkbox opens a dialog; click "Agree" inside the dialog before the Next button activates.
- **City autocomplete multi-match** — typing a city name can return multiple entries. Select the exact full entry matching `address.city` in profile.yml; it auto-populates County and State.
- **Referral question** — "affiliated with an employee" may or may not expose a follow-up name field. If the field appears, enter the referrer's name there. If it does not, work the referrer's name into Q14/Q15-style prose instead.
- **Yes/No pill groups** — never map by button index. Read the visible question text and verify selection via `aria-pressed` or field state before moving on.
- **Sponsorship answer** — `eeo.sponsorship_required=false` means the work-authorization sponsorship question must be `No`. Treat this as a locked fact, not an inferred click target.
- **Bottom `SUBMIT` button ambiguity** — on step pages, `SUBMIT` may still be the final application action. If the page is not explicitly a review/save step, stop and inspect rather than clicking through.
- **Draft safety** — do not trust the page staying alive while another role is being filled. If a save/draft action exists, use it before switching roles or pausing.

### Workday (`*.myworkdayjobs.com`)

- Multi-step wizard; each step must validate before Next.
- Account creation often required before the form is reachable.
- "How did you hear" dropdown is frequently mandatory and nested.

### LinkedIn Easy Apply

- Screening questions gate the form; answer those first.
- See `modes/linkedin.md` for the scan/curation workflow.

### General fallback

- Playwright snapshot empty or page blocks automation → use browser harness via `/browse` (see liveness fallback memory).
- Form requires login wall the candidate hasn't created → STOP, report to candidate; never create accounts without asking.
- Final control is ambiguous or could submit the application → STOP, report the
  exact page state, and hand off. Never click through ambiguity.
