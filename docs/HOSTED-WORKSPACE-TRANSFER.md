# Website and desktop workspace transfer

The website accepts the existing Plainhand JSON export. This is a manual,
candidate-confirmed move, not continuous synchronization or credential sharing.
Desktop menus guide export/download and file selection; the configured online
destination is still required before distribution.

## Website API

Both routes are mounted in the website API after session authentication,
same-origin checks, page CSRF token validation and account rate limiting. They
are not MCP tools or extension bearer endpoints.

- `POST /api/workspace/import/preview {data}` validates an export, checks that
  the destination is idle, and stores a short-lived receipt. The response has
  counts, a warning, `previewId`, `digest`, `revision` and `expiresAt`.
- `POST /api/workspace/import {data, previewId, digest, revision, confirm:true}`
  requires the exact previewed parsed JSON, the same account, an unexpired
  receipt and an unchanged destination revision. Replacement and receipt use
  run under the per-account storage transaction.

Maximum serialized request size is 3 MiB. At most one preview receipt is kept
per account, for 15 minutes. A preview writes only its receipt, not the profile
or tracker. Cancellation leaves candidate state unchanged.

The existing importer backs up replaced workspace/profile files, regenerates
the profile mirrors and tracker, resets packet approvals and interrupts imported
in-flight tasks. The cloud wrapper drops pending proposals, provider selection,
connection claims, browser checkpoints and credential-like fields. It removes
destination connection checks and old connector step/checkpoint records only
after a successful import. Existing machine secrets are not exported or copied.
Imported drafts must be regenerated/reviewed before approval because PDF bytes
are not included in the JSON export.

Busy local tasks or pending deferred connector records block both preview and
replacement. A destination with a structured canonical resume is refused rather
than overwriting its source inconsistently. Storage-quota failure rolls back the
whole transaction, including backups and candidate state. Stale or reused
receipts require a fresh preview.

## Verification

`tests/test-cloud-workspace-transfer.mjs` covers explicit confirmation, backup
contents, reset boundaries, malformed/oversized data, credential stripping,
revision/digest/expiry checks, cross-account receipt rejection, pending steps,
concurrent replacement, real website session/CSRF gates and Postgres quota
rollback/isolation. Database checks require `PLAINHAND_TEST_DATABASE_URL` and
must not be counted as passing when skipped.

`npm run test:workspace-transfer-ui` checks the real website mount, file preview,
keyboard cancel/confirm, accessibility and refusal after a newer edit. The test
fixture supplies fake account/session services but does not bypass the app route.

The integrated cloud suite passed 110 tests against disposable Postgres, with
zero skips, on 2026-11-06; both transfer browser/axe tests passed. Live deployment
and an actual website-to-installed-desktop round trip remain launch checks.
