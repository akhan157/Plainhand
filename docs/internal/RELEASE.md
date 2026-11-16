# Releasing Plainhand

Internal procedure. The candidate-facing side is [docs/UPDATING.md](../UPDATING.md).
A release is one commit, tagged, whose notes are the release page, and whose
gates passed on that commit.

## 1. Decide the version

- A release that changes the workspace state shape bumps `STATE_VERSION` in
  `plainhand/migrations.mjs` and adds a migration step. See §2.
- VERSION holds the released version (`1.1.2 # x-release-please-version`). Set it
  in the release commit together with `package.json`'s `version` if it was
  bumped.
- `docs/releases/vX.Y.Z.md` is the release page; the GitHub workflow refuses to
  publish without it. It must have an **Upgrading** section that names the
  command or installer line candidates use.
- CHANGELOG.md keeps the running "Unreleased:" sections; move them under the
  release heading in the release commit.

## 2. If the workspace state changed

Every change to `data/plainhand/workspace.json`'s shape ships with a migration,
in the same commit:

1. Add `{ from: N, to: N + 1, name, up, down }` to `MIGRATIONS` in
   `plainhand/migrations.mjs`; bump `STATE_VERSION` to `N + 1`.
2. `up` is idempotent, adds only what is missing, and never rewrites what the
   candidate wrote. `down` restores what the step changed; the exact pre-migration
   file is also always available from the backup directory.
3. Add `{ release: 'X.Y.Z', state: N + 1 }` to `STATE_VERSION_BY_RELEASE`, so
   `plainhand rollback --version vX.Y.Z` knows which state that release reads.
4. Extend `tests/test-u15-update.mjs` with the real previous shape: records
   keep their values, approvals behave as designed, and `rollbackWorkspace`
   restores the exact bytes.
5. Run the proof against the real tags:
   `node scripts/update-proof.mjs --from v<previous>`. It must reach zero
   failures. Keep `output/u15-update/proof.json` and paste the timings into the
   lane result and the release notes if the candidate steps changed.

## 3. Run the gates

```sh
npm run release:check -- --tag vX.Y.Z
```

It refuses on a dirty tree, when VERSION and the tag disagree, or when the
release notes are missing, then runs in order:

| Gate | Command | Proves |
| --- | --- | --- |
| Fast suite and migrations | `npm run test:plainhand` | Unit and integration tests, including the migration chain, backup, rollback, answer-bank backfill and the release-gate preflight |
| Browser UI | `npm run test:plainhand-ui` | The real UI in Chromium, including the settings and reviewer surfaces |
| Controlled evaluation | `npm run benchmark:eval` | The fixture-agent evaluation and workflow contract, no model spend |
| Simulation | `npm run benchmark:simulation` | The offline workflow simulation benchmark |

A partial run is not a release. If a gate fails, fix it and run the whole check
again. `--dry-run` runs only the preflight (used by tests).

## 4. Tag and publish

```sh
git tag -a vX.Y.Z -m "Plainhand vX.Y.Z"
git push origin vX.Y.Z
```

The tag triggers `.github/workflows/github-release.yml`, which checks that
`docs/releases/vX.Y.Z.md` exists and publishes the release with those notes.
Tag pushes and releases are the owner's authority; this document does not grant
them.

## 5. How candidates receive it

| Install kind | How it updates | What it keeps |
| --- | --- | --- |
| Installer (`~/.plainhand/app` + `~/.plainhand/workspace`) | `plainhand update` (runs the installer without starting, then migrates) | The workspace folder, untouched |
| Git checkout | `plainhand update` / `npm run update` (fetch tag, checkout, `npm ci` when the lockfile changed, migrate) | The gitignored user files in place |
| Copies older than 1.2.0 | Re-run the installer line, or `git fetch --tags && git checkout vX.Y.Z && npm ci` | The workspace, untouched |

In every case migrations run automatically when the new version starts, and the
previous state is in `data/plainhand/backups/`.

## 6. After the release

- Verify on a populated install that the published tag updates cleanly and
  rolls back: `node scripts/update-proof.mjs --from v<previous> --to vX.Y.Z`.
- If a release is wrong, do not move the tag. Roll the candidate back with
  `plainhand rollback --version v<previous>` and ship a fix release.

## Ownership

- Release gates, tag, release page and release notes: maintainer with release
  authority.
- Migration design and inspection: implementation lane, reviewed by the root
  reviewer before merge; the author never accepts its own row.
