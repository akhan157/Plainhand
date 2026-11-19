# Plainhand E2E findings — branch t3/competitor-workflow-improvements-1

Tested commit: 874eb73 (branch head when the testers started), with the fixture launcher
a local fixture launcher (not in the repo): the real server and UI with the test-fixture AI agent,
job verifier, scanner and local fixture application form. No real AI or job site was used.
Testers: three OMP DeepSeek V4.1 Flash agents (A: onboarding/profile/master resume/settings;
B: jobs/packet/apply/tracking; C: assistant/navigation/layout/a11y). Raw reports (local, not in the repo):
`findings-A.md`, `findings-B.md`, `findings-C.md` and screenshots in (screenshot), (screenshot), (screenshot).
cua-driver could not launch a browser on this machine (no root-owned system Chromium; existing-profile grant
not given), so the testers drove Playwright Chromium / Chrome for Testing in headed windows instead.

## Fixed on this branch

| Finding | Found by | Commit |
| --- | --- | --- |
| Profile interview always shows a "Plainhand is replying" typing bubble (found by A, B and C) (also announced in the aria-live log) with nothing running. `plainhand/web/ui/profile.mjs:94` passed `''` as streaming text; `MessageList` treats any non-null value as streaming. UI test now asserts no bubble when idle. | A, C (B saw it as "lingering") | 1c5188c |
| Workspace autonomy setting said "from your approved standard" (`plainhand/web/ui/settings.mjs:321`); same phrase in `docs/USER-GUIDE.md`. Guard test added for UI modules and the user guide. | C | b104492 |
| (Code review, not E2E) Master coverage treated year ranges like `2019-2023` as phone numbers and dropped dated resume lines; exit classifier read "accredited" / "401(k)" in agent output as billing or sign-in failures. | review | 874eb73 |

## Confirmed, not fixed

### 0. Importing a workspace drops the master resume, resume format, writing samples and understanding — high
- **Status on goal/plainhand-personal-engine: does not apply.** The goal branch's `plainhand/workspace-import.mjs` restores writing samples, the resume format, the master resume (as a draft to re-approve) and the understanding (marked for review), and tells the candidate so. The finding was against the side branch's older import.
- Area: Workspace → Import a workspace. Cause verified in source: `plainhand/workspace-import.mjs:8` `STATE_KEYS`
  omits `standard`, `resumeFormat`, `writingSamples` (also `settings`, `agentUsage`), and the import then calls
  `workspace.saveProfile(...)` (`workspace-import.mjs:60`), which sets `state.understanding = null` (`store.mjs:150`).
  Pre-existing (the file predates this branch: last changed in 7132d62 on main).
- Steps: 1) fully set up a workspace (format saved, writing sample, understanding approved, master resume approved).
  2) Export workspace. 3) Start a second instance on an empty data root → Import a workspace → that file →
  Replace and import. 4) Open Profile & brain.
- Expected: a backup "you can import elsewhere" (USER-GUIDE, Settings) restores all of it, or the dialog says what won't move.
- Actual: profile and the 8 interview messages arrive; `standard` missing, `standardStatus:"none"`, no
  `resumeFormat`, `writingSamples: []`, `understanding: null`; setup drops to 2 of 5. Toast:
  "Workspace imported: 0 roles. A backup of the previous workspace is in data/plainhand/backups." The dialog only
  warns that browser sign-ins don't move.
- Evidence: (screenshot), (screenshot), (screenshot),
  (screenshot); export used: `export-A.json`.

### 0b. Adding a writing sample silently clears the understanding and makes the master resume stale — medium
- **Status: fixed in 96c8f1f.** The reset is kept; the message now names what needs approving again.
- Area: Profile & brain → step 3 → "How you write". `actions.mjs:308` deliberately sets `state.understanding = null`
  (and clears packet approvals) when a sample is added; the context hash change also marks the master resume stale.
  Clearing may be intended (the understanding describes voice), but nothing tells the user.
- Steps: steps 4 and 5 Done → add a writing sample → Add writing sample.
- Expected: no reset for voice-only material, or a warning that the summary and master resume need re-approval.
- Actual: step 4 flips Done → Next, `standardStatus` approved → stale, setup 5 of 5 → 3 of 5; the only feedback is
  "Writing sample saved. Your next drafts will sound more like you."
- Evidence: (screenshot).

### 1. Master resume failures are silent on Profile & brain — medium (found by A and B)
- **Status: fixed in 6650e7b.** The card shows the failure; the browser test covers it.
- Area: Profile & brain → step 5 "Approve your master resume" (`Standard` in `plainhand/web/ui/profile.mjs`, ~line 150).
- Steps: 1) Profile & brain → step 5. 2) Press "Write my master resume" in a workspace where the task fails
  (e.g. the drafter returns a claim with no exact source quote). 3) Watch the card.
- Expected: the failure and a Retry on the card, as Follow-ups (`followups.mjs:40`), Interview prep
  (`interview-prep.mjs:42`) and Skill plan (`skill-plan.mjs:58`) do.
- Actual: toast "Queued. Your agent's progress appears here and in Activity." (`core.mjs:216`), then the card
  returns to the idle "Write my master resume" button. The task is recorded failed with "The master resume contains a
  claim without an exact source reference. Check your evidence and retry." — visible only on Activity (and as a
  "did not finish" item on Home, `home.mjs:49`). Reproduced 3×.
- Evidence: (screenshot), (screenshot), (screenshot).

### 2. "Check sources" shows nothing on Jobs, despite the toast saying progress appears "here" — low
- Area: Jobs → Job sources → Check sources; toast text from `plainhand/web/ui/core.mjs:216`.
- Steps: add a company board; press Check sources; wait.
- Expected: running state and a result line on Jobs ("1 new role added" / "No new roles"), as Campaigns shows
  ("0 new roles · 1 already known").
- Actual: no task card or button state on Jobs; the page is unchanged; the result is only in Activity
  ("Discovery added 0 new roles. No applications were started.").
- Evidence: (screenshot), (screenshot), (screenshot). Found by B and C.

### 3. "Add a company board" accepts any URL — low
- Area: Jobs → Job sources → Add a company board; `sources.add` in `plainhand/actions.mjs` checks URL shape only.
- Steps: company "Test Co", URL `https://example.com/not-a-board`, Add source.
- Expected: rejection naming the supported boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee), as the dialog text promises.
- Actual: toast "Company board added. Check sources to discover roles."; listed as `example.com`; Check sources later
  finds nothing with no per-source error. (Unconfirmed whether the real scanner reports a per-source error; the
  fixture scanner masks it.)
- Evidence: (screenshot).

### 4. Apply tab keeps browser-assistance buttons enabled after submission — low
- Area: Jobs → role → Apply tab (`ApplyTab` in `plainhand/web/ui/jobpanel.mjs`); server guard `plainhand-server.mjs:408`.
- Steps: confirm "I submitted this application" → status Applied; press "Open & inspect application".
- Expected: Open/Autofill/Resume disabled or replaced once submitted.
- Actual: all three stay enabled; clicking toasts "This application was already submitted. Browser assistance cannot start a duplicate."
- Evidence: (screenshot), (screenshot).

### 5. Reload loses the open role, tab and typed drafts — low
- Area: whole app; route hash never includes the role id (e.g. `#jobs`).
- Steps: open a role → Apply or Record tab → type in "next action" → reload.
- Expected: same role and tab return (and, ideally, the draft).
- Actual: back to the plain Jobs list; panel closed; the half-typed text can't be reached. A reload during autofill
  drops the progress display while the server run continues.
- Evidence: (screenshot), (screenshot).

### 6. Scheme-less job URL rejected only by the browser's native bubble, which covers Location — low
- Area: Jobs → Add a job dialog (URL input `type=url`).
- Steps: paste `jobs.lever.co/test/999` → Save role.
- Expected: accept with `https://` prepended, or the app's own inline field error.
- Actual: native "Please enter a URL." bubble overlapping the Location field; nothing saved.
- Evidence: (screenshot), (screenshot).

### 7. "Your review: 1 of N summaries approved" while no summary is currently approved — low
- Area: Profile & brain → Keep improving → Profile strength ("Your review").
- Steps: approve the understanding; save a profile edit (approval clears; step 4 offers only "Build understanding").
- Expected: the count agrees with step 4 (0 currently approved, or wording like "approved before").
- Actual: "1 of 3 summaries approved" (later "1 of 4") with nothing approved now.
- Evidence: (screenshot), (screenshot).

### 8. 768 px icon rail: Applications count badge overlaps its icon — low
- Area: side navigation at 768–900 px (72 px icon rail).
- Steps: window 768 px wide with one selected application.
- Actual: the "1" badge sits on the briefcase icon's top-right corner and the active background.
- Evidence: (screenshot).

### 9. Import preview shows the wrong conversation count — low
- Area: Workspace → Import a workspace → preview. `plainhand/workspace-import.mjs:28` counts `data.agentConversation`
  (the Home assistant thread) and labels it "conversation messages", while the profile interview (`conversation`) is what moves.
- Steps: export a workspace with 8 interview messages → import it elsewhere → read the preview.
- Actual: "0 conversation messages". Evidence: (screenshot).

### 10. Connections card header is cramped by the "In use" pill — low
- Area: Connections → provider card header.
- Actual: the pill shares the subtitle row, shrinking it to ~107 px, so "Uses your ChatGPT account through the Codex app"
  wraps to three lines at 1280 px and 390 px.
- Evidence: (screenshot), (screenshot).

### 11. Reading the format from a groff/PostScript PDF gives incoherent values — low
- Area: Profile & brain → step 2 → Read format from my resume PDF.
- Steps: upload a fictional finance resume PDF (headings 11 pt bold, body 10 pt, name and contact on one line).
- Actual: text 9, heading 7 (smaller than body), name 9, line spacing 1.75, sections "EXPERIENCE, PROJECTS, SKILLS"
  (EDUCATION, the first heading, missing, so it renders last). A Chromium-printed PDF (`finance-resume-print.pdf`)
  derives correctly. The guide only promises Word/Google Docs exports, so this is robustness.
- Evidence: (screenshot), (screenshot).

## Unconfirmed

- **"Plainhand is replying" lingering after a complete reply** in Profile step 3 (B, seen twice, not reproduced).
  Most likely the always-on bubble fixed in 1c5188c; re-check on the goal branch.
- **Legacy wording "replace your old standard resume"** (`plainhand/web/ui/profile.mjs:165`, `actions.mjs:174`): intentional;
  only shown to a workspace whose saved record predates the master resume. Not a bug.

## Test-setup gaps (not product bugs)

- The fixture agent (`plainhand/test-fixtures.mjs:14`) throws `Unknown fixture instruction.` for the conversational
  assistant, follow-up drafts and interview prep, so Home chat could not be tested with the launcher (C verified chat
  proposal flows with a separate canned-reply launcher, `launch-chat.mjs`). Side note: the chat shows the raw
  exception text ("I could not finish that: Unknown fixture instruction."); a real provider error would surface the
  same way.
- The fixture's master-resume/packet output hard-codes Formula SAE evidence quotes, so onboarding only passes when
  those sentences are in the sources; testers appended them.
- The fixture apply browser is headless, so "Take over the browser" hands off a window that isn't on screen.
- No live AI runs: nothing here shows how the master resume or tailoring behave with real model output.

## Notes

- Tester A re-checked both fixes (1c5188c, b104492) on the running build after a reload: fixed.
- Severity totals for open findings: 1 high (0), 2 medium (0b, 1), 9 low (2–11).
