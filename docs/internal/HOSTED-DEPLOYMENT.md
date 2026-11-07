# Hosted test deployment preparation

Prepared from main b4edbfe on 2026-11-06. This is a reviewable preparation,
not evidence of deployment. Do not deploy production until the owner has reviewed
this branch and configured the items below. The global hosted connector plan is
unchanged. Desktop builds and signing belong to the separate desktop builder.

## Runtime and storage

`api/index.mjs` validates the canonical HTTPS `SITE_URL` and required env names
before opening a pool. Copy the **names** in `.env.hosted.example` into Vercel's
server environment settings; never commit populated env files. The origin has no
trailing slash, path, userinfo, query or fragment. Choose a stable test domain,
not an ephemeral preview hostname, and use that same origin in OAuth and Supabase
redirect configuration. Configure Node 22.x with a current patch **>=22.17.0**
(or supported Node 24). PDF.js needs >=22.13; pinned Chromium needs >=22.17.
No environment values are logged by the validator.

Cloud `Workflow` instances, including the deferred connector's final replay,
receive `renderCloudPacket` and `verifyCloudJob`. `renderPacket` adds one optional
`renderDocuments` argument; its local default, filenames, hashes, sidecar metadata,
page count and return contract are unchanged. PDFs are written through Workspace,
including PostgresStorage, never a host output folder. The cloud verifier is
explicitly **unconfirmed** and performs no fetch. A fetch cannot establish a live
posting. Candidates must inspect the employer's exact description and form.

`@sparticuz/chromium` **153.0.0** supplies the x64 Linux executable, fonts and
shared libraries; no remote Chromium pack or browser install occurs at runtime.
Its official Playwright launch pattern is used. Each render gets a new browser
and isolated context; close runs in finally, including late launch after a render
timeout. Scripts and service workers are disabled; CSP, offline mode and abort-all
routing block external/file resources from profile strings or HTML. Total render
deadline is 25 seconds, individual page operations 8 seconds, launch 10 seconds.
Bundled Open Sans supports Latin/Greek/Cyrillic; additional script coverage and
exact candidate font fidelity are not proven. Do not advertise universal font
coverage. Browser temporary profiles are managed/removed by Playwright; only the
extracted executable/libraries/fonts are reused in warm instances.

`vercel.json` uses the documented glob `includeFiles`, explicitly covering the
UI, Chromium `bin/**` (including `fonts.tar.br`, AL2023 libraries and SwiftShader)
and PDF.js worker. `maxDuration` stays 60 seconds. Vercel's ordinary uncompressed
function cap is 250 MB and request/response payload cap is 4.5 MB. Workspace quota
is separate (25 MiB/account). A large PDF response may still exceed Vercel's cap;
large-artifact external download storage is not implemented. No large-function
beta or paid-plan memory increase is assumed.

Production OAuth requires published IDs in `PLAINHAND_EXTENSION_IDS`; empty
means extension audience disabled, including access/refresh grants minted before
an ID was removed. Development factory defaults still accept fixture identity IDs.
Connectors and candidate-only extension actions retain separate audiences.
Onboarding and the MCP tool surface stay intact.

## Public information, diagnostics and daily maintenance

`/privacy`, `/terms`, `/support` and links on `/signin` require no session. They
use the existing CSP/security headers and no third-party page assets. Optional
`SUPPORT_URL` must be HTTPS without credentials; default support is the existing
GitHub issue tracker. Never put candidate data in public issues. Signed-in Get
help saves the user's message, screen, UUID error IDs and account email; no
workspace attachment or guaranteed response time. Messages themselves may contain
what a user types, so the page asks users to avoid sensitive details.

Responses have `X-Request-ID`; caught errors include `errorId`. Internal/startup
logs allow only ID, HTTP method and status, without URL, stack, message, user,
headers or body. The old debug-error dump is removed. No Sentry integration or
external tracking is active, regardless of a DSN. This does not configure Vercel's
own platform access logs: the owner must review their retention and access.

The authenticated `/api/cron/daily` is **maintenance only**: `select 1`, expired
session deletion and rate-limit cleanup. Its response explicitly says
`job: maintenance`, `dailyJobChecks: pending`. Daily discovery/evaluation/scanning
is pending; no model use or background job discovery is claimed. Review whether
the project permits cron invocation on the intended plan and set `CRON_SECRET`.

## Reproducible local checks

Use disposable Postgres only, never the production URL. Ensure TMPDIR has at
least 1 GiB free (Chromium extraction and browser profiles). These commands create
only synthetic candidates; the test harness creates/drops separate databases.

```bash
npm ci
mkdir -p tmp/hosted-runtime
export TMPDIR="$PWD/tmp/hosted-runtime"
export VERCEL=1 # exercise bundled AL2023 libraries even outside Vercel
# Use a unique unused port/name when running alongside another builder.
docker run -d --rm --name plainhand-hosted-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:54339:5432 postgres:17-alpine
export PLAINHAND_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54339/postgres
npm run test:cloud
npm run test:cloud-ui
npm run test:plainhand
npm run test:extension
npm run build:cloud:trace
docker run --rm -e VERCEL=1 -v "$PWD/tmp/hosted-trace:/app:ro" -w /app node:22-bookworm-slim node scripts/cloud/render-smoke.mjs
```

`build:cloud:trace` pins `@vercel/nft` 1.11.1, traces the production entry plus a
synthetic render entry, explicitly adds the configured assets and fails at the
250 MiB cap. It writes a local manifest and isolated bundle under ignored `tmp/`.
There are 19 trace warnings for PDF.js parser fallback, optional browser/native
modules and build-only node-pre-gyp dependencies. The isolated PDF smoke proves
the PDF runtime path despite those warnings; it does not prove every optional
path or replace Vercel's own build/tracing. Keep Chromium external if adding a
bundler; its relative binary layout must survive. Node 22 clean-container cloud
tests cover real PDF.js import and production HTTP/MCP composition as well.

CI cloud tests run against a Postgres service, then tracing, isolated Linux
render smoke, synthetic encrypted restore, onboarding/browser axe tests and
extension tests. Database skips must be reported as skips, never as passes.

## Encrypted backups and restoration

`.github/workflows/hosted-backup.yml` is **disabled** until BOTH repo variables
`PLAINHAND_BACKUPS_ENABLED=true` and
`PLAINHAND_BACKUP_DESTINATION_APPROVED=yes` exist. It runs nightly at 05:30 UTC
in protected environment `hosted-backups`. No production dump was taken.

Owner must first select/approve a private **unversioned** S3 bucket and prefix,
block all public access, enforce TLS, set server encryption, and apply the
14-day expiry rule in `scripts/cloud/backup-lifecycle.json` adjusted to the exact
approved prefix (example `plainhand/`). Disable replication/object-lock retention
that could retain copies longer. S3 expiration is asynchronous; describe copies
as scheduled to expire after 14 days, not guaranteed instant erasure. Do not use a
versioned bucket with this retention promise. No artifact-upload action is used.

Configure these metadata/secret names in the protected environment:

- secret `PLAINHAND_BACKUP_DATABASE_URL`: dedicated backup connection, TLS,
  least read privileges on `plainhand` (schema usage/select on its tables plus
  default SELECT for future tables). Because schema tables use RLS without
  policies, a dedicated backup role needs BYPASSRLS; schema/table grants must
  still limit it to Plainhand. Review that role with the database owner. Do not
  reuse Auth service credentials or an all-project admin database role.
- vars `PLAINHAND_BACKUP_AGE_RECIPIENT`, `PLAINHAND_BACKUP_S3_URI`,
  `PLAINHAND_BACKUP_AWS_ROLE`, `PLAINHAND_BACKUP_AWS_REGION` and the gates above.
  Keep the **private age identity offline**, outside GitHub and the backup bucket.
- AWS role trust bound to this repository's `hosted-backups` GitHub OIDC subject.
  Grant only PutObject on the exact prefix (and AbortMultipartUpload if needed).
  No List/Get/Delete or bucket administration for nightly CI. Separate operator
  restore identity gets GetObject only. GitHub token gets contents:read and
  id-token:write; no repository writes. Protect workflow changes and environment.

`backup.sh` streams `pg_dump -Fc --no-owner --no-acl --schema=plainhand` through
age encryption directly to private S3 with SSE. No plaintext temp file, repo file
or CI artifact. This covers workspace files, accounts, sessions and connector
OAuth rows, **not Supabase-managed Auth**, project configuration, extension
binaries or external exports. Owner must separately verify managed Auth recovery
and the provider's backup/PITR policy. This is not a full Supabase project backup.
Keep application secrets recoverable separately under owner control.

Fully exercised local encryption/decryption/restore command (synthetic data):

```bash
docker exec plainhand-hosted-test apk add --no-cache age bash
docker exec plainhand-hosted-test mkdir -p /app/scripts
docker cp scripts/cloud plainhand-hosted-test:/app/scripts/
docker exec -u postgres plainhand-hosted-test bash /app/scripts/cloud/backup-smoke.sh
```

To restore an approved encrypted copy, provision an **empty disposable** Postgres
17 database first, then supply `RESTORE_DATABASE_URL`,
`BACKUP_AGE_IDENTITY_FILE` and `RESTORE_DISPOSABLE_CONFIRMED=yes` through the
operator's secure environment and run:

```bash
aws s3 cp "$APPROVED_ENCRYPTED_BACKUP_URI" - --only-show-errors | bash scripts/cloud/restore.sh
```

Verify row/file counts, bytes, isolation and the combined cloud suite against the
restored disposable environment before any recovery cutover. Reconcile all
account deletions since the backup before making it live, purge restored
sessions/OAuth grants and require reconnect/sign-in. Rotate compromised secrets.
Never overwrite production as an exploratory restore. Delete the disposable
restore and local identity mount after the drill. Run a recovery drill after
schema or Postgres major upgrades and at least monthly. The smoke script tests
bytea restoration; managed Auth recovery remains an owner check.

## Owner review and test deployment commands (not executed here)

No Vercel tool/CLI connection, project ID, org ID or Vercel token was available.
Supabase connected metadata lists **plainhand-cloud**, us-east-1,
ACTIVE_HEALTHY, Postgres 17.11. No keys, SQL data or credential values were read.
No hosting env values are available to this checkout. Supabase Google OAuth,
email/Resend delivery, redirect URLs, Vercel project/plan/runtime, backup role,
destination and encryption recipient need owner confirmation/configuration.
Published extension IDs are missing, so production extension support stays off.
Provider account coverage/directory approvals and desktop signing are separate
launch blockers, not established by synthetic tests.

After reviewing/integrating the commit, owner selects the intended Vercel team
and project, configures the env names above, Google/email redirects and stable
test origin. Use official CLI **65.12.1** (not added to runtime dependencies):

```bash
npx --yes vercel@65.12.1 link
npx --yes vercel@65.12.1 env ls
npx --yes vercel@65.12.1 pull --environment=preview
npx --yes vercel@65.12.1 build
# Inspect .vercel/output/functions/api/index.func and the build's reported size.
# Confirm Chromium bin/fonts, PDF.js worker and UI files exist in that function.
npx --yes vercel@65.12.1 deploy --prebuilt
# Assign the approved stable test domain using the project dashboard.
SITE_URL=https://YOUR-APPROVED-TEST-ORIGIN node scripts/cloud/http-smoke.mjs
```

`vercel pull` writes local secret env files: keep `.vercel/` private/ignored and
never print or commit them. The owner must confirm CLI-supported flags via
`--help` and project-specific build output before deploying. No production flag.
If Vercel build reports missing assets or excessive size, stop and adjust tracing;
passing the separate NFT smoke alone is not approval to deploy.

For a real rendered-PDF deployment check, use a synthetic test account: sign in,
complete onboarding, connect a real permitted chat, prepare a synthetic job
packet, complete factual review, and download both files without submitting any
application. Then privately supply `PLAINHAND_SMOKE_COOKIE` (complete cookie
header), `PLAINHAND_SMOKE_CSRF` (page token) and `PLAINHAND_SMOKE_PDF_PATH`
(workspace artifact path) in environment and run:

```bash
node scripts/cloud/http-smoke.mjs --authenticated-pdf
```

It checks session-without-CSRF refusal, authenticated PDF MIME/bytes, and logs
only byte length. It does not create packets, submit applications, or log contents.
Check a second account cannot download the first account's artifact, sign-out
revokes the session, and account deletion removes the synthetic workspace and
grants. Check the authenticated cron response explicitly says maintenance. Record
Vercel cold/warm timings, function size/memory, font appearance and actual
provider results; none are proven by this preparation.

## Official references checked 2026-11-06

- https://github.com/Sparticuz/chromium — Playwright API, bundled font/library
  assets, Linux x64, external bundling and temporary-profile behavior.
- https://vercel.com/docs/functions/limitations — 250 MB, 4.5 MB, duration.
- https://vercel.com/docs/project-configuration/vercel-json — includeFiles glob,
  maxDuration and ordinary Node function configuration.
- https://vercel.com/docs/functions/runtimes/node-js — Node runtime/tracing.
- https://supabase.com/changelog.md and
  https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes — reviewed;
  this change adds no custom operators/ltree/legacy pgcrypto.
- https://supabase.com/docs/guides/platform/backups — provider backups and restore
  scope differ from the application-schema backup here.
- https://www.postgresql.org/docs/17/app-pgdump.html — consistent custom archives.
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html
  — asynchronous expiration and versioned-bucket retention caveats.
