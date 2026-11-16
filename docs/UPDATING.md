# Updating Plainhand

Your workspace is yours. An update replaces Plainhand's code; it does not touch
your profile, resume, stories, applications, settings, writing samples or the
AI sign-in on your computer. You do not set Plainhand up again.

## One command

```sh
plainhand update
```

That is the whole update for every release after 1.1.2. If you run Plainhand
from a checkout instead of the installer, the same command is:

```sh
npm run update
```

What it does, in order:

1. Finds the newest release and downloads its code.
2. Installs the release's dependencies.
3. Brings your workspace data up to the release's format. It copies the exact
   previous state to `data/plainhand/backups/` first, so this step can be
   undone.
4. Asks you to restart Plainhand. Press Ctrl+C in the terminal where it is
   running, then start it again with `plainhand` and open the same address.
   Your page reloads with everything in place.

The measured times for a populated workspace are at the end of this page.

## While you are on 1.1.2

1.1.2 predates `plainhand update`, so update it once with the method you
installed it:

- **Installed with the one-line installer** (the default): run the same
  installer again. It replaces the app folder and keeps your workspace.

  ```sh
  curl -fsSL https://raw.githubusercontent.com/akhan157/Plainhand/main/install.sh | sh
  ```

  Windows PowerShell:

  ```powershell
  irm https://raw.githubusercontent.com/akhan157/Plainhand/main/install.ps1 | iex
  ```

- **Running from a git checkout**: replace the code and install the release's
  dependencies. Your data files are in the same folder and are not tracked by
  git, so they stay.

  ```sh
  git fetch --tags
  git checkout v1.2.0
  npm ci
  ```

After that, `plainhand update` handles every later release.

## What an update keeps

| What | Where it lives | After an update |
| --- | --- | --- |
| Profile, targets, compensation | `config/profile.yml`, workspace state | Unchanged |
| Master resume and base cover letter | workspace state | Unchanged, still approved |
| Stories and the assistant conversation | workspace state | Unchanged; each story keeps its edit key |
| Applications, packets, approvals | workspace state | Unchanged; see the approval note below |
| Tracker and saved job descriptions | `data/applications.md`, `jds/` | Unchanged |
| People, interview rounds, next step | workspace state per application | Unchanged |
| Settings (autonomy, role order) | workspace state | Unchanged |
| Reusable answers | `data/answer-bank.yml` | Unchanged; older answers keep working |
| Writing samples | workspace state | Unchanged |
| Your resume mirror and narrative | `cv.md`, `modes/_profile.md` | Unchanged |
| Theme choice | Your browser, not Plainhand | Untouched by any update |
| AI sign-in (Claude, ChatGPT, Antigravity) | `~/.claude`, `~/.codex`, the provider's own app | Never read or changed by an update |
| Which AI you chose, connection check | workspace state, per computer | Unchanged; check again if the provider app changed |

## The one click an update can ask for

An application packet is approved before it is sent to an employer. The review
covers the wording *and* the profile the AI was allowed to read. 1.1.2 sent
your email and phone to the AI; current releases never do.

If you have a packet approved under the old rule, Plainhand does not quietly
drop that approval. It marks the job **Review again**, records why in the
activity list, and keeps the old approval as evidence. Open the job and approve
the packet once. Nothing is re-entered; the resume and letter are the same.

Your master resume is not affected: it was written from the same sources, so it
stays approved.

## Rolling back

```sh
plainhand rollback
```

- Restores the workspace exactly as it was before that update, from
  `data/plainhand/backups/migrate-*`.
- Switches the code back to the previous release and reinstalls its
  dependencies.
- Asks you to restart.

To go back further, name the release: `plainhand rollback --version v1.2.0`.
Every rollback prints what it restored and how long it took.

## If something looks wrong

| Problem | What to do |
| --- | --- |
| The update stopped before it finished | Run `plainhand status`. Nothing is half-switched: the code is either the old release or the new one, and your workspace state is unchanged until the migration step succeeds. |
| The migration step failed | The previous state is in `data/plainhand/backups/migrate-*`. Run `plainhand migrate` to retry, or `plainhand rollback` to go back. |
| Plainhand says the workspace is newer than the app | You rolled the code back without the data. Run `plainhand rollback` (it restores both), or update again. |
| The page does not load after a restart | Check the terminal: the new release prints a clear error. Your data is still on disk. |
| You want to see versions | `plainhand --check` (Node, workspace, state version), `plainhand status` (app and workspace versions, pending migrations), `plainhand update-check` (newest release). |

## Notebook: measured times

From `node scripts/update-proof.mjs` on a populated install (a 1.1.2 workspace
with a profile, a master resume, four stories, two applications with a packet
and an approval, a contact and an interview round, tracker rows, settings, a
reusable answer and a writing sample). Times are on this development machine
and include installing dependencies from the local npm cache; the download is
the only step that needs the network.

| Step | Time |
| --- | --- |
| Switch the checkout to the new release (`git fetch --tags && git checkout`) | 0.1 s |
| Install the release's dependencies (`npm ci --offline`) | 4.2 s |
| Start Plainhand, migrating the workspace | 0.7 s |
| **Update with the commands above, plus the restart** | **about 5 s** |
| One-command update to the next release (`plainhand update`) | 0.3 s |
| Roll back one release, code only (`plainhand rollback`) | 0.2 s |
| Roll back across the data change (`plainhand rollback --version v1.1.2`) | 1.5 s |

A warm npm cache gives these numbers; a cold one adds the download time. A cold
`npm ci` run in the same proof took 6.6–9.2 s. Installed copies run the
installer, so their update also includes the release download.

The whole proof — two releases, one full update, two rollbacks and three server
starts — took 15.2 s and passed 169 checks.

## What is not covered yet

- **Hosted Plainhand** (the optional online workspace) stores one workspace per
  account in its own database. It uses the same state version and the same
  migrations, but it has no updater screen yet; its workspace migration runs on
  the server at start.
- **Windows** uses the PowerShell installer for installed copies. Rollback of
  code on Windows re-runs that installer for the previous version. The
  measured proof ran the Linux/macOS paths.
- **Old releases**: the update command ships from 1.2.0. Older copies update
  once with the installer or `git`, as described above.
