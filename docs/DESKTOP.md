# Plainhand desktop

The Electron shell uses the existing local UI and ChatGPT Sign in button. It does
not change provider OAuth. Windows x64 NSIS and Linux x64 AppImage are configured.
macOS distribution is deferred until an Apple Developer account, signing identity
and notarization are available. No macOS installer is promised.

## Build and run

Use Node 24 LTS and npm. Dependencies belong to `desktop/`; root runtime dependencies
are unchanged. Electron 45.2.3, electron-builder 26.18.0 and electron-updater 6.8.11
are exact pins, with a separate exact runtime manifest and lockfile in
`desktop/runtime/`. These were the stable versions available in npm when checked
2026-11-06 (builder/updater's release page also listed newer stable patch tags that
npm did not yet serve). Recheck security fixes before each public release.

From the project root:

```sh
npm ci --prefix desktop
npm --prefix desktop run stage
npm --prefix desktop test
npm --prefix desktop start
npm --prefix desktop run pack:linux   # unpacked Linux application
npm --prefix desktop run build:linux  # actual AppImage, no publication
npm --prefix desktop run build:win    # NSIS; build on Windows
xvfb-run -a npm --prefix desktop run smoke
PLAINHAND_SMOKE_BINARY="$PWD/desktop/dist/linux-unpacked/plainhand" xvfb-run -a npm --prefix desktop run smoke
```

`stage` copies only allowlisted, Git-tracked system source, excludes `_profile.md`,
and installs the runtime lockfile with `npm ci --omit=dev --ignore-scripts`.
It does not copy CVs, workspaces, reports, exports, credentials, `.env`, or `.git`.
Development also uses this staged runtime, so a desktop-only install does not need
root node_modules. `start` restages automatically. Build output, dependencies and
smoke artifacts are ignored. The runtime is in
`resources/runtime/` **outside** `app.asar`; the desktop shell and updater are in
ASAR. Do not move the server/Playwright into ASAR: browser executables, CLI
subprocesses, temporary PDFs and ordinary filesystem paths need real files.

The app launches its own Electron executable with `ELECTRON_RUN_AS_NODE=1` for
Chromium setup and the server. It deliberately retains Electron's `runAsNode` fuse;
disabling that fuse breaks this architecture. `NODE_OPTIONS` is stripped from
children. Readiness arrives over private process IPC, with an ephemeral loopback
port and per-run API token. The token is never exposed by a preload. The server is
the sole workspace writer. On quit, the shell requests the existing server close
routine, waits for exit, then kills a hung process tree after eight seconds.

Workspace: `app.getPath('userData')/workspace`; Chromium: `userData/browsers`.
Typical paths are `%APPDATA%/Plainhand/` and `~/.config/Plainhand/` (Electron app name
and OS settings determine the final path). Uninstall keeps user data. First run
shows download progress, then verifies headless Chromium launch and PDF creation.
Failures show a local error page with retry/help instructions. No terminal is
required. Linux still requires Chromium system libraries; these cannot be installed
without OS administrator privileges. PDF resume **text extraction** additionally
needs Poppler (`pdftotext`, not bundled); paste resume text where unavailable.

Both windows use sandboxing, context isolation, no Node integration, no webviews,
and denied permission requests. The local app has no privileged preload. The
setup page has only a one-way text status listener. New windows are denied;
navigation stays on the exact current loopback origin. Explicit HTTPS host
allowlists open provider/help links in the system browser; arbitrary protocols,
credentials, ports, host lookalikes and remote renderer navigation are refused.
The child wrapper forwards the existing `chatgpt.start()` URL over IPC because the
shared UI's initial empty popup is deliberately denied. PKCE, state, token storage
and loopback callback remain unchanged. Test actual account sign-in before launch;
no account-tier coverage claims are established by packaging tests.

## Moving a workspace and getting help

Workspace → Export saves the existing `/api/export` JSON contract using a native
save dialog. Import opens a user-selected JSON file, asks the server for its
preview, and requires a separate replacement confirmation. The existing importer
backs up replaced files and resets approvals, browser checkpoints and in-flight
tasks. Provider tokens, encryption keys, browser sessions and local MCP secrets
are not transferred. Exports contain personal information; keep them private.

The online destination is deliberately unset in `desktop/src/release-config.json`:
the owner must supply the confirmed HTTPS base URL before distribution. Open
Plainhand online then opens that destination in the system browser. Until set, the
menu explains that it is not configured. **Import from Plainhand online** guides
the candidate to download an export from their signed-in website account and
select that file locally. **Upload to Plainhand online** saves an export and
opens the configured website's Workspace page. The candidate selects the file
there, reviews a preview and confirms replacement. There is no automatic upload
or credential sharing. Website preview receipts are bound to that account, the
exact file and current workspace revision; stale or busy workspaces are refused.
Packet approvals, proposals, checkpoints and machine-specific AI connection
checks reset. The confirmed online URL and released installers remain pending.
Get help opens the repository's support form; nothing is
auto-attached or sent.

## Releases, updates and signing gates

`desktop-check.yml` builds Linux AppImage and Windows NSIS test artifacts. Windows
test artifacts are labelled **UNSIGNED-test-only** and must not be distributed as
trusted installers. An unsigned installer can show Windows warnings. Signing also
does not guarantee the absence of SmartScreen/reputation warnings.

`desktop-release.yml` is manually dispatched against an **existing version tag and
GitHub Release**. It validates the tag against the desktop version. `publish=false`
is the default. `publish=true` uploads assets and updater metadata only after the
protected `desktop-release` environment is approved; it creates no tag or release.
This manual step is needed because releases created by another workflow's
`GITHUB_TOKEN` do not trigger release workflows. No release was run during implementation.

Windows publication is skipped unless repository variable `SIGNPATH_APPROVED` is
`true`. Keep it unset until Foundation approval, maintainer two-factor sign-in,
GitHub App/trusted build configuration, signing policies and artifact configurations
are reviewed. The `desktop-windows-signing` environment must require owner approval.
The workflow uploads the unpacked app to SignPath, verifies its returned executable,
packages that signed app, then submits and verifies the final NSIS installer. It
regenerates `latest.yml` **after** signing, using the final installer bytes.
Differential NSIS packages are disabled to avoid stale pre-signing blockmaps.
The configured update publisher is `SignPath Foundation`; Windows update signature
verification stays enabled. No signing certificate or service approval is bundled.

SignPath setup must create ZIP-root artifact configurations matching the Actions
artifact layout: one signs `Plainhand.exe` in the application artifact, the other
signs the top-level `Plainhand-*-win-x64.exe` installer. Scope them to this repository
and approved tags. Embedded uninstaller signing is not integrated by this two-stage
pipeline; owner acceptance or an additional builder signing hook is required before
turning on the Windows release gate. Test install, launch, update and uninstall on
Windows after configuring SignPath. The gate must remain off until these pass.

Secret names only: `SIGNPATH_API_TOKEN`; publication uses GitHub's built-in
`GITHUB_TOKEN`. Repository/environment variables:
`SIGNPATH_APPROVED`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
`SIGNPATH_SIGNING_POLICY_SLUG`, `SIGNPATH_APP_CONFIGURATION_SLUG`,
`SIGNPATH_INSTALLER_CONFIGURATION_SLUG`. Never put credentials in JSON or source.

The updater reads electron-builder's GitHub Releases configuration. Development,
unpacked Linux and macOS builds do not check for updates. Installed Windows and
AppImage builds check once at startup and through Help. Download requires a user
choice and displays taskbar progress. Installation requires **Restart and install**;
**Later** does not install on ordinary quit (`autoInstallOnAppQuit=false`). The
local service is stopped before the chosen restart. End-to-end update verification
requires two real releases; it has not been simulated as a successful public update.

## Verification record

Verified locally on 2026-11-06, Linux x64:

- `npm --prefix desktop test`: 11 passed, no failures/skips after staging/building.
  Includes a real server subprocess and authenticated export/import with backup,
  approval reset, credential isolation and clean shutdown.
- `npm run test:plainhand`: all 314 existing tests passed, unchanged. The host's
  nearly-full `/tmp` caused an initial run to fail; rerunning with a checkout-local
  `TMPDIR` passed. Smoke tests use short, isolated home-cache paths for UNIX sockets.
- `npm --prefix desktop run pack:linux`: unpacked build passed.
- `npm --prefix desktop run build:linux`: AppImage build passed; actual artifact
  `desktop/dist/Plainhand-1.1.1-linux-x86_64.AppImage` and `latest-linux.yml` generated.
  Final artifact SHA512 was checked against metadata.
- Xvfb launches of development, packaged unpacked and actual AppImage
  (`APPIMAGE_EXTRACT_AND_RUN=1`) reached the authenticated local app and exited
  cleanly. Packaged smoke additionally checked real Chromium/PDF support and
  renderer isolation. Ordinary FUSE-mounted AppImage execution was not tested.
- Workflow YAML parsed successfully. Hosted GitHub Actions were not executed.

Windows build/install/signing was skipped (Linux host, no Wine/Windows runner).
The Windows CI configuration is **not** a verified working installer. macOS builds,
real provider-account sign-in, two-release auto-update, live website/desktop transfer and SignPath
approval/configuration remain unverified requirements. No tags, pushes, PRs,
releases or deployments were made.

Official references checked 2026-11-06:

- [Electron releases](https://releases.electronjs.org/releases/stable)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Node subprocess environment and fuse caveat](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)
- [Builder v26 contents and extraResources](https://www.electron.build/v26/docs/contents/)
- [Builder v26 updater targets and integration](https://www.electron.build/v26/docs/features/auto-update/)
- [Builder/updater stable releases](https://github.com/electron-userland/electron-builder/releases)
- [Builder v26 Windows signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)
- [SignPath GitHub trusted builds and action inputs](https://docs.signpath.io/trusted-build-systems/github)
