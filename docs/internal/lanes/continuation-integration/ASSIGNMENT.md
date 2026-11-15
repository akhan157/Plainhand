# Lane assignment: continuation-integration (Gate 1 design)

Status: **Gate 1 approved with amendments** by root in [REVIEW.md](REVIEW.md),
which overrides conflicting design text below. This file stays the design record;
the implementation is recorded in RESULT.md. Nothing here is product acceptance
and nothing is self-accepted.

## 1. Pin, branch and preconditions

| Item | Value |
|---|---|
| Worktree | T3-managed isolated checkout for this lane (repo-relative paths only in records) |
| Lane branch | `t3/continuation-integration-design` (implementation continues here after approval) |
| Base HEAD (confirmed) | `e4da45fa2d21ce1f5945ce11662a73afda03b53f` on `goal/plainhand-personal-engine`; working tree clean |
| Integration source | `t3/competitor-workflow-improvements-1` = `a46056fdc53a4159f5b30eae9b3de578efb3767d` |
| Sibling (not this lane) | `t3/competitor-workflow-improvements` = `867c32956a38788a3099b045b19be450fcd16a86` |
| Merge base of goal branch and source | `fb396422d49e3f76f4fed5beb710397950ffa973` |
| Ancestry (checked) | neither `a46056f` nor `867c329` is an ancestor of HEAD; `867c329` is **not** an ancestor of `a46056f` (siblings) |
| Environment at design time | `free -h`: 4.6 GiB available at dispatch, 4.5 GiB measured at design start; no tests, builds, servers, containers or providers started |
| Routing | Go primary returned no verdict (insufficient balance); Claude author fallback rate-limited; this design ran on the configured Pi DeepSeek direct fallback, which is **metered** and disclosed here |

Read-only merge dry run, now, before any change:
`git merge-tree --write-tree --name-only HEAD a46056f…` → clean (exit 0, tree
object only; no ref or worktree change). HEAD has added only documentation since
the merge base (9 files; `ASSIGNMENT.md`, `EVIDENCE.json`, `GOAL-HANDOFF.md`,
`RESULT.md`, `REVIEW.md`, four `docs/internal/*`), and `a46056f` touches none of
them. That dry run is **not** a prediction for the real merge: after the tracking
lane lands, `package.json` is expected to conflict (§7).

**Hard preconditions for the continuation merge** (all three):

1. Root Gate 1 approval of this design.
2. Root's tracking integration is already on the goal branch:
   `git merge-base --is-ancestor 867c32956a38788a3099b045b19be450fcd16a86 <goal tip>`
   must succeed. If it does not, stop. This is UNIFIED-GOAL P3's recorded order
   (tracking reviewed and integrated first, continuation second), not acceptance
   of either branch.
3. A **fresh** target base is recorded at implementation dispatch
   (`git rev-parse goal/plainhand-personal-engine`), and the lane is freshened
   onto it by merge, not rebase (§7). Never merge continuation onto the stale
   `e4da45f` tip with an assumed tree.

## 2. Documents and source read

`AGENTS.md`, `OPERATING_GUIDE.md`, `WORKFLOW.md` (all 236 lines, including the
system-change protocol), `docs/internal/UNIFIED-GOAL.md`,
`GOAL-HANDOFF.md`, `docs/internal/BRANCH-RECONCILIATION.md`
(sibling/file-overlap/order facts), `docs/internal/GOAL-ACCEPTANCE.json`
(U03/U07/U08/U11 rows and falsifiers), and the source at `a46056f` read with
`git show` — `plainhand/standard.mjs`, `plainhand/claim-calibration.mjs`,
`plainhand/claim-line.mjs`, `plainhand/cloud/extension-api.mjs`,
`plainhand/workflow.mjs`, `plainhand/actions.mjs`,
`plainhand/evaluation/{score,agent,runner,judge}.mjs`,
`plainhand/web/ui/{profile,jobpanel,home,settings}.mjs`,
`plainhand/workspace-import.mjs`, `plainhand/cloud/workspace-transfer.mjs`,
`tests/{test-standard,test-claim-calibration,test-cloud-extension-api,test-bench-eval}.mjs`,
`tests/extension-fixture.mjs`, and both branches' `package.json` diffs.

## 3. Scope

### In scope (after Gate 1; this commit adds only this file)

Arrives by merge from `a46056f` (content unchanged by the merge): the master-resume
redesign, manual apply kit, extension board matching, finance/STEM benchmark
retarget, and their tests.

Changed by this lane, one concern per commit:

| File | Change |
|---|---|
| `plainhand/cloud/extension-api.mjs` | posting identity: board postings keyed by host-scoped id (§5.1) |
| `plainhand/standard.mjs` | approval identity covers role headings, via one projection (§5.2) |
| `plainhand/claim-calibration.mjs` | number attribution per occurrence and clause (§5.3) |
| `plainhand/workflow.mjs` | pass the sanitized posting to calibration (§5.3), nothing else |
| `tests/test-cloud-extension-api.mjs` | collision, unknown-id, save-job and ATS-alias cases |
| `tests/test-standard.mjs` | approval-identity mutation matrix, migration, autonomy gate |
| `tests/test-claim-calibration.mjs` | attribution matrix, per-occurrence, injection, preservation |
| `CHANGELOG.md`, `WORKFLOW.md` | record the posting-identity and number-attribution contracts and the master re-approval, only after the tests pass |
| `docs/internal/lanes/continuation-integration/{ASSIGNMENT,RESULT,REVIEW}.md` | this design; later result and independent review |

Optional, root's call: render each master entry's heading in the profile card
(`plainhand/web/ui/profile.mjs`; today only `entry.text` is shown, so the
candidate approves headings they cannot see) plus one dark/light/mobile
screenshot and a pill assertion in `tests/test-plainhand-ui.mjs`. Recommended,
because §5.2 makes headings part of the approved content; it can be struck to
keep the lane minimal.

### Out of scope

- Register, manifest, board, handoff, `GOAL-*`, `EVIDENCE.json`, `REVIEW.md`,
  `RESULT.md` — root writes those if it wants them.
- Any edit to the tracking lane's files (`docs/internal/lanes/tracking-integration/`).
- Any change to either source branch; `a46056f` is merged as-is.
- `masterCoverage` scoring and the fixed master entry cap
  (`plainhand/workflow.mjs:239`, `list(draft.resume, 'resume', 150)`) — separate
  measured gaps, explicitly outside this packet.
- The deterministic benchmark reviewer's own number check
  (`plainhand/evaluation/agent.mjs`), claim-id positional stability, `/jobs/<n>`
  gh-id matching across hosts (§11).
- Push, main merge, tags, release, deploy, new paid service, accounts, real-site
  writes, employer contact or application submission; any user or personal data.
- Running suites, builds, browsers, containers or providers in this design task.

## 4. What the source actually does (verified, not assumed)

Three design-time probes were run against `a46056f`. They were **read-only source
and replica diagnostics**: no test suite, build, server or product acceptance, and
no repo writes. Standard and calibration probes imported the real modules extracted
with `git show`; the extension probe used a verbatim copy of `jobs.mjs` `jobUrl`
(lines 62–69) and `extension-api.mjs` `urlKeys`/`matchJob`, because
`extension-api.mjs` pulls the whole workflow graph. The copies are labelled as
such on purpose. The implementation's suites are recorded in RESULT.md, separately.

**Probe A — board URL identity (replica):**

```
Indeed A saved, page A  : job-a
Indeed A saved, page B  : job-a        (expected job-b)
Indeed saved, unknown id: job-a        (expected null)
LinkedIn search 4012345678 saved, page 4099999999: li-saved-from-search  (expected null)
LinkedIn search saved, page with no job id       : li-saved-from-search  (expected null)
LinkedIn view saved, collections page same id    : li-view               (preserved)
```

**Probe B — master approval identity (real `standard.mjs`):**

```
approved -> approved
tailoring heading before: {"org":"Acme Robotics","title":"Mechanical Engineer",…}
after heading edit -> approved (approval survived: true)
tailoring heading after : {"org":"Acme Aerospace","title":"Senior Mechanical Engineer",…}
after text edit -> draft
```

**Probe C — number attribution (real `claim-calibration.mjs`):**

```
cover letter "I led teams in 28 countries at your company."
  with posting "…operates in 28 countries": counts all zero, claims []
cover letter "Your team of 25 is impressive. I have led teams of 25."
  with posting "…team of 25 engineers…":    counts all zero, claims []
```

### 4.1 Defect 1 — a board posting is identified by its list path

| Role | Path at `a46056f` |
|---|---|
| Producer | `urlKeys()` `plainhand/cloud/extension-api.mjs:92`, keys `[href, origin+path, base]` plus `linkedin:`/`indeed:` ids |
| Storage | none new; keys are derived each call from `state.jobs[].url` / `.applyUrl` |
| Consumers | `matchJob()` `:110`; `/api/extension/match` `:267`; `/api/extension/save-job` duplicate check `:221`; `approvedJob()`/`plan()` once a match is chosen |
| Invariant broken | A key must denote one posting. `origin+path` on a board denotes every posting on that route: `/viewjob`, `/jobs`, `/jobs/search`, `/jobs/collections/recommended` |
| Falsifier | Two saved Indeed roles and a page for the second resolve to the first; an unsaved id resolves to a saved role; saving a second role returns “already in Plainhand” |

User impact: the extension offers the wrong role's approved packet and answers on
the page, and a genuinely new board role can never be saved. It never submits
(that boundary is intact), but the candidate is invited to fill the wrong
application.

Exploitability today: direct, from the extension's normal use of a board page.
The branch's own new test (`tests/test-cloud-extension-api.mjs`, “a LinkedIn or
Indeed posting matches…”) does not cover a same-path, different-id pair, which is
why it passes while the collision exists.

### 4.2 Defect 2 — approval does not cover the role headings tailoring receives

| Role | Path at `a46056f` |
|---|---|
| Producer | `identity()` `plainhand/standard.mjs:11` hashes `[headline, resume.map(e => [e.section, e.text]), coverLetter]`; `approveStandard()` `:33` stores it |
| Storage | `state.standard.approvedHash` in the workspace |
| Consumers | `standardStatus()` `:16` → `standardInput()` `:25` → prepare prompt `INPUT.master` (`plainhand/workflow.mjs:280`, `:286`); `autoPrepareDecision()` `:84`; `plainhand/actions.mjs:174` (stale gate on approve); server payloads `plainhand-server.mjs:164`, `plainhand/cloud/app.mjs:275`; profile card pill |
| Invariant broken | Approval must cover exactly what tailoring consumes. `standardInput` at `:29` now sends `heading`, and `identity` omits it |
| Falsifier | Change any heading field of an approved master; status stays `approved` and the new heading reaches `standardInput` while text edits correctly flip to `draft` |

Exploitability today: **latent, stated honestly.** No current UI action edits an
approved master's heading (`tasks.standard` revision clears `approvedHash`;
`workspace-import.mjs` does not carry `standard` at all; cloud transfer strips
`approvedHash` anywhere). The gap is a contract hole: any future editor, migration,
agent action or hand-edit of `workspace.json` silently hands an unapproved
employer or title into every new packet, and autonomy can prepare from it. The
approval also covers a heading the candidate never sees in the card.

### 4.3 Defect 3 — an employer word anywhere in the sentence exempts every number in it

| Role | Path at `a46056f` |
|---|---|
| Producer | `ABOUT_EMPLOYER` + `supportedByPosting` `plainhand/claim-calibration.mjs:57–58` |
| Storage | derived; `job.calibration` stored (`plainhand/workflow.mjs:312`), master `standard.calibration` (`:265`) |
| Consumers | `claimSignals()` `:61`; cover-letter claim collection `:102`; `gradePacket()` `:93`; `currentCalibration()` `:123` → `jobs.get` (`plainhand/actions.mjs:139`), `calibration.decide` (`:208`), hosted re-derivation (`plainhand/cloud/app.mjs:262`), job panel (`plainhand/web/ui/jobpanel.mjs:132`); benchmark pass (`plainhand/evaluation/score.mjs:110`) |
| Invariant broken | A number belongs to the employer only in the clause and position where the employer is its subject. Today the test is whole-sentence and per value, so one `your` anywhere exempts all occurrences of that value |
| Falsifier | “I led teams in 28 countries at your company.” with a posting that says 28 → zero claims, `number-not-in-sources` never fires; same for a second candidate occurrence of a number already used about the employer |

User impact: a fabricated candidate scope or result is silently accepted, dropped
from the claim list and from the UI, and cannot block a packet; it can also make a
benchmark packet “pass” that should fail.

## 5. Proposed fixes

### 5.1 Identify a board posting by a host-scoped id, never by a list path

Replace the key builder; keep `matchJob`'s signature and preference order.

```js
// A key may denote one posting. The path alone is not an id on a job board: the
// posting lives in the query (?jk=, ?vjk=, ?currentJobId=, ?jobListingId=) or in a
// path segment (/jobs/view/<id>, /Job/<slug>-<id>). Path-only keys stay for ATS
// routes, where the path *is* the posting.
const ID_PARAM = /^(?:jk|vjk|currentjobid|joblistingid|jl|jobid|job_id|jid)$/i;
export function postingKeys(value) {
  const href = jobUrl(value), url = new URL(href);
  const path = url.pathname.replace(/\/+$/, '');
  const base = url.origin + path.replace(/\/(apply|application)$/i, '');
  const ghId = url.searchParams.get('gh_jid') || url.pathname.match(/\/jobs\/(\d{4,})(?:\/|$)/)?.[1] || null;
  if (!boardHost(url.hostname)) return { keys: [href, url.origin + path, base], ghId };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const id = pathId(url)                                   // LinkedIn /jobs/view/<id>
    || ['jk', 'vjk'].map(k => url.searchParams.get(k)).find(Boolean)   // Indeed, id first
    || [...url.searchParams].find(([k, v]) => ID_PARAM.test(k) && /^[A-Za-z0-9_-]{4,64}$/.test(v))?.[1];
  return { keys: id ? [href, `${host}:${id.toLowerCase()}`] : [href], ghId: null };
}
```

- `pathId`: LinkedIn `/jobs/view/(?:[^/]*-)?(\d{6,})`; Indeed has none (query only).
- `boardHost` is `isBoardUrl` (already imported) plus regional Indeed/LinkedIn
  hostnames, so `indeed.co.uk` cannot fall back to path keys.
- The id key carries the hostname, so a lookalike domain cannot claim a saved
  role by reusing its id.
- No canonical-URL key is added: the id key already bridges `/viewjob?jk=` ↔
  `/jobs?vjk=` and `/jobs/view/` ↔ `?currentJobId=`, with less machinery.
- `matchJob` collapses hits to distinct jobs and returns `null` when more than one
  distinct role matches (today it returns the first, or an approved one among
  several): ambiguity must fail closed, not pick a packet.

Preserved deliberately: Greenhouse `?gh_jid=`, `/jobs/<id>`, Lever/Ashby `/apply`
and `/application` aliases, `applyUrl` matching for board-saved roles, LinkedIn
view↔search/collections for the same id, Indeed `/jobs?vjk=` ↔ `/viewjob?jk=`, and
re-saving the same posting with tracking parameters.

### 5.2 One projection that is both the approval hash and the tailoring payload

```js
// One projection feeds the hash and the payload. `digest` JSON.stringifies, so the
// heading object is rebuilt in a fixed field order and no other key can travel.
const headingOut = h => {
  const o = { org: '', title: '', location: '', dates: '' };
  for (const key of Object.keys(o)) o[key] = String(h?.[key] || '').trim();
  return Object.values(o).some(Boolean) ? o : null;
};
const identity = draft => digest([
  draft.headline,
  draft.resume.map(e => [e.section, headingOut(e.heading), e.text]),
  draft.coverLetter,
]);
```

`standardInput` sends `headingOut(e.heading)` — the same object, not the stored one —
so a hand-edited heading with an extra key cannot reach the drafter without
also changing the hash. A comment states the rule: any field added to the payload
must be added to `identity` in the same change. Sending `heading` and not hashing
it is the bug; hashing anything the drafter never sees would force pointless
re-approvals.

Amended by root in REVIEW.md §2: the heading slot is omitted when absent, not set
to null, so the old hash survives for masters that have no headings at all.

Migration consequence, stated plainly: an existing approval was computed without
headings, so after this change an approved master that has any heading reads
`draft` and needs one re-approval (the profile card already shows that pill and
button). A master with no headings at all keeps its approval, which is correct
because the consumed payload is unchanged. No data is rewritten, and the old hash
is never accepted as current.

### 5.3 Attribute each number occurrence to the clause that contains it

```js
// A posting number may be restated only where the employer is that number's
// subject: "your 25 engineers", "your company operates in 28 countries", "the
// role's 12-hour shifts". A clause with a candidate subject and a measure
// ("… at your company by 28%") or a past accomplishment ("I led teams in 28
// countries") is the candidate's claim, wherever the sentence wanders.
export function numberClaims(text, jobText = '') { /* one row per occurrence */ }
export function numberOccurrences(text) { /* raw, value, index; numbersIn derives from it */ }
```

Attribution for an occurrence is true only when all hold:

1. the posting contains the normalized value;
2. the **clause** around it (split on `. ! ? ;` and `,`) contains an employer
   reference (`your`, `yours`, `the role|position|posting|job|team|unit|department|store|program|organization|company['s]`);
3. that reference begins within three words before the number, so it governs the
   number rather than merely sharing a sentence;
4. if a candidate subject (`I`, `we`, `my`, `our`, `me`) appears earlier in the
   clause, then no candidate measure (`by`/`from` + number) and no past
   accomplishment verb sits before the number (`VERB_TIERS`' ownership forms
   `led`, `managed`, `built`, `ran`, `owned`, … plus result verbs `increased`,
   `reduced`, `cut`, `grew`, `saved`, `delivered`). Present-tense role verbs
   (`lead`, `support`) are deliberately not in that list: "I am applying to lead
   your 25 engineers" is about the employer's team, not the candidate's history.

`claimSignals` iterates occurrences and skips only exempt ones (deduplicating
signals by code+value so the signal list keeps today's one-entry-per-value shape).
The cover-letter collection in `gradePacket` uses the same attribution per
occurrence instead of `sentenceWith(...)` + value-wide exemption, so a second,
candidate-owned occurrence of an employer-used number still produces the claim.
Claim ids keep the `cover:<n>` shape `calibration.decide` relies on.

Call site: `plainhand/workflow.mjs:312` passes
`providerDescription(job.description || '')`, not the raw description (WORKFLOW §2:
the saved description is never rewritten and may hold sentences addressed to AI
tools). A number that only appears in withheld text therefore cannot whitelist a
claim. The master grading call (`:265`) deliberately receives no `jobText`: a
master line is never about a specific posting. That last rule is review-enforced,
not test-enforced, and is recorded as such.

## 6. Test design and falsifiers

No existing assertion is relaxed, modified or deleted. If implementation needs to
change one, stop and report: the change is the finding, not a test edit. New cases
only.

### 6.1 `tests/test-cloud-extension-api.mjs` (in-memory fixture, no database)

1. Same-path, different-id Indeed pair: page B → `job-b`; unknown id → `null`;
   only A saved and page B → `null`. Falsifier: path-only keys.
2. LinkedIn search/collections page with a different `currentJobId` → `null`; page
   with no id → `null`; same id across view/search/collections/apply → match.
3. `save-job` for a second Indeed role returns `saved: true` and a new job;
   re-saving the first with `from=serp` returns `saved: false`. Falsifier: the
   duplicate check still keying on the path.
4. `postingKeys` invariant, direct: for a table of board URLs (Indeed, LinkedIn
   view/search/collections/apply, Glassdoor `jobListingId`), every key is either
   the exact address (starts with `https://`) or a `host:id` key matching
   `/^[a-z0-9.-]+:[A-Za-z0-9_-]+$/`; no key equals `<origin><path>` with the query
   stripped. Falsifier: re-adding a generic key.
5. Two saved roles that both match one page → `null` (ambiguity fails closed).
6. Preservation, unchanged expectations: Greenhouse posting, `?gh_jid=` employer
   embed, Lever `/apply`, Ashby `/application`, and the “match by applyUrl for a
   role saved from a job board” test.

### 6.2 `tests/test-standard.mjs` (fixture agent, temp workspaces)

1. Heading mutation matrix: approve, then change `org`, `title`, `location`,
   `dates` (one at a time) → `standardStatus` `draft`, `standardInput` `null`.
   Falsifier: current `identity`.
2. Payload-derived coverage: read `standardInput`'s output, mutate each string
   leaf (heading fields included), assert the identity changes. A new payload
   field that is not hashed fails this test without anyone remembering to update
   it.
3. Non-consumed fields stay non-invalidating: `suggestions`, `evidence`,
   `review`, `calibration`, `coverage` and an unknown extra key changes keep
   `approved` (no false stale, no re-approval churn).
4. Migration: a stored approval computed the pre-fix way over a master **with**
   headings reads `draft` and yields no `INPUT.master`; the legacy hash is never
   accepted as current.
5. Autonomy gate: after a heading edit, `autoPrepareDecision` returns
   `prepare:false` and the prepare prompt has no `master`, so no unapproved
   heading is used, prepared or approved.
6. Text, section, headline and cover-letter edits keep flipping to `draft`
   (existing class, guarded so the fix cannot narrow the hash).
7. Existing tests unchanged: write/approve, prepare-from-approved-master,
   revision clears approval, coverage naming, redraft-once, LinkedIn manual path.

### 6.3 `tests/test-claim-calibration.mjs` (pure)

Attribution matrix, both `claimSignals` and `gradePacket(... { jobText })`:

| Text (posting contains the number) | Expectation |
|---|---|
| `I am applying to lead your 25 engineers.` | exempt, 0 unsupported (existing assertion) |
| `Your company operates in 28 countries.` | exempt |
| `The role's 12-hour shifts suit me.` | exempt |
| `Your 28-country footprint matches my experience.` | exempt |
| `I led teams in 28 countries at your company.` | `number-not-in-sources` |
| `I increased revenue at your company by 28%.` | `number-not-in-sources` |
| `I managed 25 engineers at your company.` | `number-not-in-sources` |
| `I led your 25 engineers.` | not exempt (past accomplishment governs) |
| `Your team of 25 is impressive. I have led teams of 25.` | exactly one unsupported claim, for the second sentence |
| number not in the posting, employer word present | unexempt (existing rule) |
| no `jobText` | unexempt (existing assertion) |

Plus: per-occurrence suppression (first employer occurrence suppressed, second
claim kept), clause boundaries (`,`, `;`) not sentence-wide, and the existing
signal set (`number-rounded`, `number-rounded-stated`, ownership/level,
undersold, generics, bands) unchanged in code and rating.

Injection seam (workflow-level test in `tests/test-standard.mjs` or
`tests/test-posting-integrity.mjs`): a job description whose AI-addressed sentence
contains 28, a cover letter claiming 28 → calibration still flags unsupported.
Falsifier: raw `job.description` passed as `jobText`.

Preservation: the branch's own test (“a sentence about the employer may repeat the
posting's numbers; a claim about the candidate may not”) passes unedited, as do
`tests/test-claim-line.mjs` and the benchmark/eval consumer tests
(`tests/test-bench-eval.mjs`, `tests/test-eval-judge.mjs`) without expectation
changes.

### 6.4 Optional UI evidence (only if the heading render is approved)

`tests/test-plainhand-ui.mjs`: profile card shows the master pill `Awaiting your
review` after a heading-only change and `Approved` after re-approval; screenshots
in light, dark and 390×844 with no horizontal overflow, real Chromium against the
built app, no console CSP violation. No placeholder or mock HTML.

## 7. Merge and freshening plan (only after Gate 1 and tracking integration)

1. Record `R = git rev-parse goal/plainhand-personal-engine`; assert `867c329` is
   an ancestor of `R`. If not, stop.
2. `git merge --no-ff R` into this lane (freshen the base; no rebase, no history
   rewrite). If `R` is already an ancestor, no-op and record why.
3. `git merge --no-ff a46056f…` as a **pure merge commit** — no fix folded in.
   Expected: `package.json` conflicts on the single long `"test:plainhand"` line.
   Resolution keeps both additions (`tests/test-field-policy.mjs` from
   continuation, `tests/test-exports.mjs` from tracking) and every other entry;
   verify with `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`
   and by listing the script. Four auto-merged files
   (`CHANGELOG.md`, `plainhand-server.mjs`, `plainhand/web/ui/core.mjs`,
   `tests/test-plainhand-ui.mjs`) are re-read hunk by hunk; BRANCH-RECONCILIATION
   already warns that an auto-merge is not proof.
4. Commit the three fixes in the order 5.1 → 5.2 → 5.3, each with its tests and a
   message naming the defect and the falsifier. Docs last, only for behaviour the
   tests actually show.
5. Stop at Gate 2: root reviews the merge diff and the fix diffs independently
   before anything reaches the goal branch.

The merge commit SHA, target base `R`, per-fix SHAs and the resolved `package.json`
line go into `RESULT.md`. No squash, no interactive rebase, no force push. This
design commit is documentation-only and shares no path with the tracking lane, so
it merges cleanly in either order.

## 8. Future validation (planned, not run, not claimed)

Dependency note: this worktree has no `node_modules`. Runs use the dependency tree
already installed in the main checkout through a gitignored local symlink (no
network), or are reported not run. `free -h` before every run; stop below 2 GiB;
cap runs at two jobs.

| Order | Command | Why |
|---|---|---|
| 1 | `node --test tests/test-cloud-extension-api.mjs` | in-memory fixture; **no Postgres, no container** |
| 2 | `node --test tests/test-standard.mjs` | identity, migration, autonomy, master flows |
| 3 | `node --test tests/test-claim-calibration.mjs tests/test-claim-line.mjs` | attribution and wording decisions |
| 4 | `node --test tests/test-bench-eval.mjs tests/test-eval-judge.mjs` | calibration consumers |
| 5 | `node --test tests/test-web-modules.mjs tests/test-css.mjs` | only if a web module or CSS changed |
| 6 | `node tests/test-plainhand-ui.mjs` | only if UI files changed; Chromium, screenshots, then stop the server |

`test:cloud`'s Postgres suites (`test-cloud-app.mjs` and neighbours) are not needed
here: the extension fixture uses `MemoryStorage` and a direct caller, so this lane
needs no database container. If a run needs one anyway, it is a separate approval
and it is stopped and confirmed gone afterwards.

Merged-tree verification, after root merges into the goal branch: root re-runs 1–4
in the merged tree, re-reads the `package.json` resolution, and — if the heading
render is included — loads the built app in real Chromium and reviews the three
layouts. Green unit tests are not evidence of user-visible behaviour, and a test
count is not a PASS. Acceptance stays `not_run`/`in_progress` in the register
until an independent reviewer, not the author, records the disposition.

## 9. Non-negotiables

1. Never submit, send, apply or contact. The extension keeps `submitted` as the
   candidate's own confirmation; no new control may finalize anything.
2. Wrong-role ambiguity fails closed (`null`), never “closest” or “approved”.
3. Approval covers exactly the consumed payload; no field drifts in or out
   silently, and the old approval hash is never grandfathered.
4. Never relax a safety assertion, tolerance or threshold to make a check pass.
   No fixture special-casing, no whitelisting a test URL or phrase.
5. Untrusted posting text stays untrusted: calibration reads the sanitized
   description; withheld or hidden text cannot exempt a claim.
6. Tests-only additions to existing files; no rewritten expectations. A test that
   fails must be diagnosed, not adjusted.
7. User data and personal files stay local; no real employer, account or site is
   touched.
8. No push, main merge, tag, release, deploy, paid service or new dependency.
9. Every claim in `RESULT.md` carries a command, SHA, output tail or path, and
   anything not run is listed as not run.
10. The author never accepts its own work and never edits the register, manifest,
    board or handoff.

## 10. Evidence, acceptance and report format

This gate's evidence: the commit containing this file, the three probe transcripts
in §4 (replica stated for the extension), the read-only merge dry run, ancestry
checks, and the cited source lines at `a46056f`.

Required at implementation: `RESULT.md` with

- base `R`, freshening commit, merge commit, and one SHA per fix;
- `git diff --stat` of the merge against the expected file list, and the resolved
  `package.json` script;
- each command from §8 with its exit status and output tail, and an explicit
  “not run” list (UI, cloud Postgres, live providers);
- the new test names and the wrong implementation each one falsifies;
- proof that existing test bodies gained lines only (`git diff -U0` on the test
  files this lane edits shows no removed assertion);
- residual limitations from §11 that remain;
- next action and what root must decide.

`REVIEW.md` is written by an independent reviewer of a different model family from
the author, reading the diff, the falsifiers and the consumer list; it records
objections and a disposition. Root decides acceptance. Rows U03, U07, U08 and U11
stay `not_run` in the register; this lane cannot move them.

## 11. Residual limitations (honest)

- **Out of packet, on purpose:** `masterCoverage` is lexical (content-word overlap
  against resume lines, contact lines skipped) and the master is capped at 150
  entries (`workflow.mjs:239`). Both are measured gaps for another packet; this
  design neither measures nor fixes them.
- Board ids are only as good as the shapes verified here (Indeed `jk`/`vjk`,
  LinkedIn path/`currentJobId`, plus query ids for other boards such as Glassdoor
  `jobListingId`). Regional or mobile hosts (`indeed.co.uk`, `m.indeed.com`) and
  path-only board URLs without an id fail closed — no match — rather than risk a
  wrong match. A saved board URL with no recognisable id matches only the exact
  address.
- `gh_jid` matching stays host-agnostic (any employer page embedding the same
  Greenhouse id matches). That is the documented employer-embed feature; a
  lookalike page could still claim a saved role, and the candidate must still
  approve and submit. Not changed here.
- The number heuristic is lexical: clause splitting on commas can miss an employer
  reference after a comma (`your team of 25, and 12 in Berlin`), which fails
  closed (a false `unsupported`, not a false pass). Numbers inside headings,
  dates and years are handled exactly as today.
- The deterministic benchmark reviewer (`plainhand/evaluation/agent.mjs`) keeps its
  own stricter number check with no employer exemption, so it can flag a number
  this fix allows. That divergence is fail-closed and is deliberately untouched so
  frozen benchmark semantics do not move in this lane.
- Claim ids stay positional (`cover:<n>`); adding a claim can re-key a stored
  candidate decision. Existing behaviour, not worsened by this design.
- The master card still does not render headings unless the optional UI item is
  approved, so informed approval of headings depends on that item.
- The three fixes are mechanism-level with unit and integration tests; none of
  them is a real-browser or real-site measurement, and none moves a product row.

## 12. Gate 1 asks of root

1. Approve this design and the three fixes, or strike any of them.
2. Confirm the order: tracking integrated first, then a fresh base `R`, then a
   pure `--no-ff` merge of `a46056f`, then the fixes.
3. Decide the `package.json` union rule (§7.3) and whether the lane may resolve it
   itself.
4. Decide the optional master-heading render and its screenshots (§3, §6.4).
5. Decide the two additions flagged as beyond the three findings: ambiguity →
   `null` (§5.1) and sanitized `jobText` (§5.3). Both are recommended and both are
   small, contained behaviour changes.
6. Approve the focused test set and confirm that no cloud Postgres run is needed.

## 13. No self-acceptance

This design is the author's proposal. The author does not approve it, does not
review its own diff, does not mark any acceptance row and does not touch
`docs/internal/GOAL-ACCEPTANCE.json`, the register, the manifest, the task board,
`GOAL-HANDOFF.md`, `EVIDENCE.json`, `REVIEW.md` or `RESULT.md`. Root reads the
diff independently, and an independent reviewer of a different model family writes
the lane's review after implementation. Work stops here at Gate 1.
