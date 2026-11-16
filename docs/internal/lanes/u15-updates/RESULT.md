# U15 — updates keep the candidate's setup: result

Implementation author record. Root reviews and accepts; nothing here is
self-accepted, and no acceptance row was marked PASS.

- **Branch:** `t3/update-preserve-candidate-setup`
- **Base:** `789dcd523b` (merged U14)
- **Previous release:** `v1.1.2` = `7c60871e5daf`
- **Product tip at the checks below:** `91a06da4f5` (gates and the update proof
  ran on it). Commits after it change documentation only: `docs/SCRIPTS.md`,
  `docs/INSTALL.md`, the measured-times table in `docs/UPDATING.md` and this
  file

## 1. What exists now

### 1.1 Versioned, automatic, reversible state migrations

`plainhand/migrations.mjs`:

- `STATE_VERSION = 2`. `state.version` selects an ordered `{ from, to, name, up,
  down }` step; the chain must be contiguous or the run refuses.
- Runs on start in `createPlainhand` (`plainhand-server.mjs`), before anything
  reads the workspace, and again from `plainhand update` / `plainhand migrate`.
- Before writing, the exact state file is copied to
  `data/plainhand/backups/migrate-<from>-to-<to>-<stamp>/workspace.json` with a
  `MANIFEST.json` holding the versions, app version, step list, byte count and
  sha256. The migrated state is written through the storage layer's
  temp-file+rename, so a failed write leaves the original in place.
- A journal (`data/plainhand/migrations.json`, last 20 entries) records what ran
  and where the backup is; `rollbackWorkspace` restores the newest recorded
  backup whose `to` matches the current version and verifies its sha256 first.
- A corrupt state file or a state written by a newer Plainhand is refused with a
  clear message and nothing is written. A missing state is a new workspace.
- `down(state)` reverses what the step changed (approvals and job stages); keys it
  added are left in place because the previous code ignores them and deleting them
  would lose later data.

The 1 → 2 step, written against what `git show v1.1.2:plainhand/store.mjs`
really produced:

| Change since 1.1.2 | What the step does |
| --- | --- |
| `settings.roleOrder` did not exist | adds `roleOrder: 'recent'` and fills missing autonomy defaults; an existing value always wins |
| `conflictReview`, `inbox` did not exist | adds `{ decisions: [], questionChecks: [] }` and `[]` |
| Conversation messages had no ids | gives each the key `storyKey` already derived from role+time, so nothing that addresses a story changes |
| Master-resume approval identity now includes per-entry headings | rehashes only when the stored approval matches the old formula, recording `approvalRehashed`; a draft whose content changed keeps no approval |
| 1.1.2 sent email and phone to the provider; this version never does, so every packet context hash changed | keeps the old approval as evidence, sets the job `needs-refresh`, records `approvalReset { reason: 'profile-privacy', from }`, and adds a plain-language event. Nothing is dropped silently |
| The same privacy change makes the approved master resume's basis look stale | re-stamps `standard.contextHash` and records `contextRechecked`, because the wording the candidate approved did not change. Any later profile change still makes it stale |

The step is idempotent (a second run changes nothing) and covered by
`tests/test-u15-update.mjs`, including a heading draft that exercises the rehash
and a 1.1.2 draft without headings that needs none.

### 1.2 Reusable answers saved by 1.1.2

`data/answer-bank.yml` entries from 1.1.2 have no `sourceKind` or `verifiedAt`;
current packet reuse requires `sourceKind: 'factual'`. `AnswerBank.load` now
fills both from what the entry already holds (provenance from its evidence,
verification from `reviewedAt`). The candidate's file is not rewritten by the
update; an entry that records `verifiedAt: null` on purpose still needs
re-approval.

### 1.3 The candidate-side update

`lib/plainhand-update.mjs`, reachable as `plainhand update|rollback|update-check|
status|migrate` and `npm run update|rollback|update:check|update:status|migrate`:

- **Git checkout:** refuse on modified tracked files, fetch the release tag,
  `git checkout --detach`, `npm ci` when `package-lock.json` changed (or modules
  are missing), migrate, print the restart step. A failed install switches the
  code back and says so; the workspace is untouched.
- **Installed copy (`~/.plainhand/app` + `~/.plainhand/workspace`):** runs its own
  `install.sh`/`install.ps1` with `--no-start`, then migrates the separate
  workspace. Only the code folder is replaced.
- **Rollback:** restores the workspace state the target release understands (from
  the migration backup, checked against its manifest) and switches the code back,
  reinstalling dependencies when the lockfile differs. `STATE_VERSION_BY_RELEASE`
  maps releases to state versions so one command works across a format change.
- Every update writes `data/plainhand/backups/update-<stamp>/UPDATE.json` with
  the previous and new refs/versions and the migration it ran.
- `plainhand --check` prints the workspace state version and whether it migrates
  on the next start.

Candidate steps are in [docs/UPDATING.md](../../../UPDATING.md).

### 1.4 The release workflow

- [docs/internal/RELEASE.md](../../RELEASE.md): version bump, state-version rules,
  the gate list, tag/publish, how candidates receive it, post-release check, and
  the ownership boundary (the author does not tag or release).
- `scripts/release-check.mjs` (`npm run release:check`): refuses a dirty tree, a
  VERSION/tag mismatch or missing release notes, then runs `test:plainhand`,
  `test:plainhand-ui`, the controlled evaluation and the simulation. `--dry-run`
  runs the preflight only.
- `docs/SCRIPTS.md`, `docs/INSTALL.md` and CHANGELOG point at the new commands.

## 2. Evidence for the row

### 2.1 A real update on a populated install

`node scripts/update-proof.mjs` (no live model call, no network: the release
remote is a local bare clone of this branch, dependencies come from the npm
cache with `--offline`):

1. clones `v1.1.2` and installs it;
2. writes the workspace in the 1.1.2 schema — profile with contact fields, B.S.
   and role text, narrative, four conversation messages, two jobs with packets,
   tracker rows, a contact, an interview round and a next action, an autonomy
   setting, a reusable answer, a writing sample, a story bank — and then runs the
   **v1.1.2 code itself** to approve the master resume and the packet, so the
   hashes under test are the ones that release really writes;
3. starts 1.1.2 and reads everything back (baseline);
4. updates with the commands the v1.1.2 install documents (`git fetch --tags`,
   `git checkout <release>`, `npm ci`), starts the new release and asserts;
5. updates again with `npm run update -- --version v1.2.1-proof`, restarts and
   asserts;
6. rolls back one release (`npm run rollback`, code only) and then across the
   format change (`npm run rollback -- --version v1.1.2`), then starts 1.1.2
   again against its original data.

Result: **169 checks passed, exit 0**, on `91a06da4f5`; 15.2 s and 33.0 s
wall in the two runs. Recorded:

- `output/u15-update/proof-run.log` (full output)
- `output/u15-update/proof.json` (timings, phases, counts)

What the checks cover, in the order they ran:

| Check | Result |
| --- | --- |
| 1.1.2 starts and reads the seeded workspace; master approved; packet approval read | passed |
| The new release ships the migration runner; start logs `Workspace state migrated 1 → 2` | passed |
| Profile name, email, phone, narrative and resume mirror | present and equal |
| Both jobs, company/role, packet content, tracker status | present |
| Contact (with email), interview round, next action | present |
| Tracker file content in the API | both rows |
| Writing sample | present |
| Autonomy setting (`perDay 2`, `minScore 4`) | present |
| Master resume draft and `standardStatus: approved` | present, still approved |
| Reusable answer; provenance `factual`; `verifiedAt 2026-10-01` | present and reusable |
| Four stories with the same text, timestamps and keys (id = `storyKey`) | present |
| Packet approval kept as evidence; job `needs-refresh`; `approvalReset` reason; job marked stale | shown to the candidate, not silently lost |
| Two events explaining the master resume and the packet review | present |
| User files (`cv.md`, `config/profile.yml`, tracker, answer bank, story bank, narrative, portals) byte-identical after the update | passed |
| Migration backup equals the pre-update state file byte for byte; manifest hash and versions | passed |
| Journal entry points at that backup | passed |
| Settings can be changed through the API and read back; the reusable answer can be re-approved; the workspace exports with profile and jobs | passed (usable, not just present) |
| Fake `~/.codex` and `~/.claude` credential trees (token, config, mtime) after update and after rollback | unchanged |
| Second release via the one-command updater; update record `1.2.0 → 1.2.1`, no state migration | passed, records intact |
| Code-only rollback leaves the state at version 2; data intact | passed |
| Rollback across the migration: code is `7c60871e5daf`, state file byte-identical to the pre-update file | passed |
| 1.1.2 starts on the restored workspace: profile, both jobs, approval back on `approved`, master approved, four stories without ids, no `roleOrder` key | passed |
| Answer bank after rollback equals what the candidate's own re-approval wrote | passed |

Deliberately not asserted as unchanged: the workspace state file (that is what a
migration writes), and the answer-bank file after the candidate's own
re-approval in the usability step — the check above pins it to that action.

### 2.2 Rollback of the migration

Three independent checks:

- the proof's final rollback restores the pre-update state file **byte for byte**
  and the previous release starts and reads it;
- `tests/test-u15-update.mjs` restores a memory-backed workspace from the journal
  and compares bytes;
- `reverseState(up(state))` restores the job stage, the old approval hash and the
  old context basis while leaving the candidate's records equal.

### 2.3 Candidate-side steps and timings

From `output/u15-update/proof.json` (run B, on `91a06da4f5`) and the earlier
run A; both used the same populated install and the local npm cache.

| Step | Run A | Run B |
| --- | --- | --- |
| `git fetch --tags && git checkout v1.2.0` | 0.105 s | 0.1 s |
| `npm ci --offline` for the release | 4.177 s | 10.1 s |
| Start Plainhand (migration), which is the restart | 0.722 s | 1.5 s |
| **1.1.2 → next, including the restart** | **≈ 5.0 s** | **≈ 12 s** |
| `npm run update -- --version v1.2.1` (one command) | 0.322 s | 0.9 s |
| `npm run rollback` (code only) | 0.214 s | 0.5 s |
| `npm run rollback -- --version v1.1.2` (state + code) | 1.467 s | 5.2 s |
| Whole proof | 15.2 s | 33.0 s |

A cold `npm ci` in earlier runs of the same script took 6.6 s and 9.2 s. The
download is the only step that needs the network.

### 2.4 The release steps, run once end to end

`npm run release:check -- --tag v1.1.2` on `91a06da4f5` (clean tree, VERSION
1.1.2 matches the tag, `docs/releases/v1.1.2.md` present), run once end to end:

| Gate | Result |
| --- | --- |
| `test:plainhand` | 644 tests, 644 pass, 0 fail — 88.5 s |
| `test:plainhand-ui` | "Plainhand full browser workflow passed: themes, persistence, interview, discovery, evaluation, real PDFs/downloads, approval, real browser form filling/upload, handoff, confirmed tracking, and mobile layouts." — 58.5 s |
| `benchmark:eval` (controlled) | 64/67 scenarios, 3 expected failures, 0 unexpected — 147.5 s |
| `benchmark:simulation` | 49/49 cases, 0 false-ready, 0 submissions, p95 6.8 s — 112.8 s |

All 4 gates passed, exit 0, 407.5 s total. The script then printed the tag
commands and stopped; nothing was tagged, pushed or published. Full output:
`output/u15-update/release-check.log`.

Before that run, the same script refused a dirty tree and listed the
uncommitted files (exit 1). An earlier full run stopped at the fast suite:
`tests/test-u12-reachability.mjs` still expected `npm run update:check` to run
the career-ops updater. The contract was updated (`2fe1c41`, `2008bd6`,
`b07cd4b`, all ancestors of `91a06da4f5`) and the whole check re-run from
scratch; the recorded run is that re-run.

## 3. Gates

The four gates passed in the end-to-end run recorded in §2.4. Details that
matter to this row:

- `test:plainhand` includes `tests/test-u15-update.mjs` (11 tests): the chain,
  the 1.1.2 shape, both approval cases, idempotence, backup byte equality,
  rollback, corrupt/newer refusal, answer-bank backfill, updater status/migrate
  and the release-gate preflight.
- The UI gate is the same browser build candidates use; nothing in this lane
  changed a screen, and it passed unchanged.
- The controlled evaluation and simulation are fixture-driven and spend no
  model budget; they are in the gate list because a release runs all four.

## 3.1 What the author did not run

- No live provider call, no paid model call (`update-proof` and both benchmarks
  use fixtures).
- No push, tag, release, deploy or publish. `git tag`/`git push` lines printed by
  `release-check` were not executed.
- No installer-mode update: it needs the release tarball from GitHub.
- No Windows or hosted run.

## 4. Counts

- Update proof: 169 checks, 0 failures, in both runs (15.2 s and 33.0 s);
  populated with 2 jobs, 1 contact, 1 interview round, 4 stories, 1 writing
  sample, 1 reusable answer, 2 tracker rows, 1 autonomy setting, 1 approved
  master resume, 1 approved packet.
- Migrations: 1 step (1 → 2). `STATE_VERSION = 2`.
- Tests added: 11 in `tests/test-u15-update.mjs`, added to `test:plainhand`.
- New commands: `update`, `rollback`, `update:check`, `update:status`, `migrate`,
  `release:check`, `test:u15-update`; `update:upstream` keeps the career-ops path.

## 5. Residuals and what was deliberately not done

- **Process restart is one documented keypress, not automatic.** Plainhand runs
  as a local server in the candidate's terminal; the updater prints exactly what
  to do and the proof starts the new release itself. No setup and no re-entry.
- **Installer-mode update was not exercised end to end.** It shells out to the
  same `install.sh`/`install.ps1 --no-start` the candidate already ran and then
  migrates; running it needs the release tarball from GitHub. The checkout path
  (the other documented install) is fully proven.
- **Windows:** `install.ps1 --no-start` is wired into the updater and rollback,
  but only Linux/macOS paths ran here. The state-file stamp avoids `:` in names,
  and migrations use forward-slash workspace paths.
- **Hosted Plainhand** stores one workspace per account and has no update screen;
  the same `STATE_VERSION` and steps apply, but per-user migration at hosted
  startup is not wired or tested. It is optional, per the row.
- **No cross-process migration lock.** Two servers on one data root are already
  unsupported (one `local-api.json`, one port); the local app is single-process.
- **Theme** lives in the browser, not in the workspace, so no server-side
  carryover exists by design. The update writes nothing in the browser; the
  docs say so instead of pretending it is stored.
- **`STATE_VERSION_BY_RELEASE` names `1.2.0`** as the release that writes state 2.
  The release workflow requires adding an entry in the same commit as any future
  `STATE_VERSION` bump; if release-please picks another number, the entry moves
  with it.
- **No tag, push, release or deploy.** `release-check` only prints the tag
  commands; release authority stays with the owner.
- The proof's two "releases" are commits on top of this branch that change only
  `VERSION` (`v1.2.0-proof`, `v1.2.1-proof`), made in the temporary clone. The
  code under test is branch HEAD.

## 6. Falsifier check

| Falsifier | Result |
| --- | --- |
| A profile, story, application, setting or sign-in is lost or needs re-entry | No. All present and readable through the API after the update; no field re-entered. The only approval that resets is the packet approval under changed sharing rules, which is marked and explained |
| An update needs manual file copying or a fresh setup | No. Documented commands only; the proof never ran setup on the new release |
| There is no written release procedure | `docs/internal/RELEASE.md`, and the gate script refuses an unsafe tree |
| A migration cannot be rolled back | It can: byte-identical restore, previous release starts on its own data, and the reverse step is tested |
