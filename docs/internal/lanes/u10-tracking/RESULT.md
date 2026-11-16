# U10 — tracking and learning

**Lane:** `t3/u10-tracking-acceptance`
**Base:** `81126ab3079e859d68694d0b7ade6e0bbe8b2cda` (Handoff: U09 merged)
**Author:** U10 implementation sub-agent. Root reviews the diff; nothing here is
self-accepted.

## What was required

> Tracker, contacts, calendar, imports and exports, follow-ups, and outcome
> recommendations.

Register evidence: an import/export round trip; the stage board, contact
roll-up and calendar re-tested from the unmerged branches; follow-ups citing the
submitted packet; recommendations remaining candidates until approved, with
insufficient data shown as such.

## Evidence map

| Register evidence | Where it is proved |
| --- | --- |
| Round-trip import and export; stages, dates, contacts and notes identical; correct CSV escaping; valid ICS structure and folding | `tests/test-u10-tracking.mjs` — "export, import and re-export: stages, dates, contacts and notes survive; CSV and ICS stay valid" |
| Stage board records history; an illegal transition is handled as the product intends; Applied needs candidate confirmation and refuses an agent | same file — "status moves are recorded, invalid values are refused, and Applied needs the candidate" |
| Contacts across several roles at one company roll up per company; removal updates the roll-up | same file — "contacts at several roles of one company roll up by company and leave when removed" |
| An interview with a time appears in the ICS at the correct UTC time and in the upcoming-interview digest | same file — "an interview with a time is a UTC event in the calendar and carries its time in the digest" |
| A follow-up cites the packet version actually submitted, not a later revision | same file — "a follow-up cites the packet version submitted, even after a later revision" |
| Recommendations stay candidates; fewer than the minimum shows insufficient data; an agent cannot approve | same file — "outcome recommendations stay candidates, need enough data, and only the candidate can approve" |

The suite is in `npm run test:plainhand`.

## What changed

Product:

- `plainhand/application-record.mjs` — `addInterview` accepts an optional
  `HH:MM` time (validated); `followUpQueue` items carry the submitted packet
  identity when the job has one.
- `plainhand/actions.mjs` — the interview action schema and `jobs.get` expose
  the optional time; the digest includes it when present and the briefing says
  "at HH:MM"; `jobs.confirmSubmitted` freezes
  `{ approvedHash, packetHash, submittedAt }` on the job, and follow-up queue
  entries in the digest cite it. A later packet revision cannot rewrite it.
- `plainhand/exports.mjs` — a scheduled interview with a time becomes a
  one-hour timed VEVENT (`DTSTART`/`DTEND` in UTC from the profile time zone;
  floating local time when no zone is set). Next actions and interviews without
  a time stay all-day. Existing CSV/ICS escaping and folding are unchanged.
- `plainhand/workspace-import.mjs` — the canonical `data/applications.md`
  travels in a workspace export (bounded, allow-listed) and is written before
  `syncTracker` on import, so tracker-only rows survive a move. It is not a
  model context source.
- `plainhand/web/ui/people.mjs` (new, pure) — one per-company contact roll-up
  rule, case-insensitive on the company name.
- `plainhand/web/ui/applications.mjs`, `plainhand/web/css/app.css` — the People
  card groups contacts by company with a count; the data stays owned by each
  application record.
- `plainhand/web/ui/jobpanel.mjs` — optional **Time** field on an interview
  round, shown in the round row and timeline.
- `plainhand/features/followups/checks.mjs` — the interview source line includes
  the time when recorded.
- `CHANGELOG.md`, `docs/PLAINHAND-BROWSER-APP.md` — the changed surfaces
  described in plain language.

Tests:

- `tests/test-u10-tracking.mjs` (new, six tests).
- `tests/test-plainhand-ui.mjs` — the record flow fills and checks the new time
  field; the People card is checked for one company group with its count.
- `package.json` — the new suite is in `test:plainhand`.

No scoring, evaluation, benchmark, register, handoff or review file was edited.

## Checks that actually ran

Environment: 15 GiB host; 5.8–7.4 GiB available before the final runs. Chromium
suites were run one at a time. Workspace and screenshots on disk under the
session temp path; no live or paid model calls were made.

| Command | Result |
| --- | --- |
| `node --test tests/test-u10-tracking.mjs` | 6 tests, 6 pass, 0 fail, 0 skipped |
| `npm run test:plainhand` | 601 tests, 601 pass, 0 fail, 0 skipped (68.0 s) |
| `npm run test:plainhand-ui` | exit 0; "Plainhand full browser workflow passed"; 96.2 s; 42 PNGs plus `workflow-proof.json` under the evidence path |
| `node benchmarks/benchmark-eval.mjs --concurrency 2` | 64/67 passed, 3 expected failures (`profile-effect-{fin,analyst,sci}-minimal`), 0 unexpected; evidence `output/evaluation-controlled-2026-11-16T02-53-36-871Z` |

The browser run is the local server serving the shared UI bundle against a
synthetic fixture agent, not a hosted sign-in.

## Failed attempts kept (no assertion was weakened)

1. The first round-trip test failed on a test-side summary finder: it called
   `startsWith('Send a thank-you')` on the full `SUMMARY:` line. The test was
   corrected to `includes`; the product was right.
2. Adding `time: null` to every digest interview broke an existing contract
   test (`test-actions` expects the old object when no time was recorded). The
   product now omits `time` when absent and includes it only for a timed round;
   the existing assertion is unchanged.
3. A floating (no time zone) `DTEND` initially carried a spurious `Z`. Fixed
   before the final runs; both passes assert the floating start and end shape.

## Deliberately not done / open

- **Hosted browser remains unverified here.** The tracking lane verified the
  hosted CSV/ICS routes at `9ec6237` (root re-ran export/cloud/local checks), but
  this lane did not run the cloud suite: no `PLAINHAND_TEST_DATABASE_URL` was
  used and no database or container was inspected, started or stopped.
- No live provider or paid model call; no network account; no push, merge,
  deploy or tag.
- Register, handoff, acceptance JSON, `EVIDENCE.json`, review files, scoring and
  benchmark sources were not edited.
- The calendar interval is a fixed one hour because the record stores a start
  time, not an end time. Neither the field nor the UI adds an end time.
