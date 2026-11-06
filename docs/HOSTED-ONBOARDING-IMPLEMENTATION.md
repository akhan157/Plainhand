# Hosted onboarding integration

This implements the website portion of the hosted connector plan on main
7e7cc65. All UI changes depend on `state.cloud`; the local app keeps CLI
connections, EventSource, campaigns, insights, remote view and browser assistance.

## Routes and marker contract

- `POST /api/resume/import {name, content}` accepts canonical base64 PDF/txt/md,
  returns `{text, preview: true}`, and does not write candidate files. Saving
  remains an explicit `POST /api/profile {profile, revision}` operation. Limits:
  2 MiB decoded upload, 20 PDF pages, 100,000 output characters. PDF.js
  `6.5.438` is pinned and requires Node **22.13 or later**, including Node 22
  serverless. The worker module is explicitly imported for dependency tracing. Encrypted, corrupt and image-only PDFs direct the user to paste
  text. No Poppler, OCR, AI inference or generated candidate facts.
- `POST /api/onboarding {provider, plan}` stores only the user's route choice in
  `data/plainhand/onboarding.json`. It cannot set connection success.
- `GET /api/connection-check` requires the existing session and page token,
  reads only that account's `data/plainhand/connection-check.json`, and returns
  `null` or `{checkedAt, read, write, provider, clientId}`. Unknown fields are
  omitted; malformed markers are not success. There is no POST marker route.
- The MCP endpoint builder must write that file only after its actual check,
  using an ISO timestamp and boolean read/write results. `provider` may be
  `chatgpt` or `claude`, or `connector` with an authenticated `clientId`. The
  generic marker proves a connected chat can read/save without claiming a
  particular vendor or plan was verified. `clientId` identifies the
  authenticated connector. A new wizard check accepts only a matching marker
  strictly newer than the check start. A read-only result explains approvals
  and admin permissions. At two minutes it shows troubleshooting.
- The wizard polls every two seconds while visible; cloud workspace refresh
  polls every five seconds while visible. The cloud UI opens no EventSource.
- Website `/api/tasks`, `/api/conversation` and task actions through
  `/api/action` return `409 CHAT_REQUIRED` instead of enqueueing a local agent.
  MCP step-runner tasks are unaffected. UI actions open a copyable chat request.
- Help uses the existing `/api/help`: message, screen and empty error-id list,
  without workspace contents. Requests are saved for support, not live chat.
  Existing export and account deletion remain accessible. No schema or auth
  changes were made.

## Documentation and coverage

Menu steps, plan lists, per-plan unverified coverage, dates and screenshot status
live together in `plainhand/web/ui/connect-data.mjs`. Documentation checked
2026-11-05; review monthly (next due 2026-12-05) and after provider UI changes.

Official sources inspected:

- [OpenAI custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Claude connector setup](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- [Claude custom connector allowance](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [PDF.js current stable](https://mozilla.github.io/pdf.js/getting_started/)
- [PDF.js Node extraction example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)

**No actual provider accounts or per-tier availability were tested.** Free/Go
ChatGPT support remains unconfirmed. Personal ChatGPT plans lead to an honest
unreleased-desktop-installer message; no fabricated download URLs. Hosted
one-click connection remains disabled pending approval. Work/school gets an
admin fallback. Claude Free's single custom connector allowance is explained
before setup. Phone users are directed to a computer for initial custom setup
and extensions; ChatGPT mobile connector availability is unverified.

**Authentic screenshots remain pending.** None were available in this checkout.
The wizard uses text steps, not fabricated provider screenshots or UI replicas.
Capture and permission-review real setup and saving-approval screenshots before
claiming screenshot coverage or completing external account coverage.

## Verification commands

- `node --test tests/test-cloud-onboarding.mjs` (real PDF.js and in-memory HTTP
  server; no database skips)
- `/path/to/node22 --test tests/test-cloud-onboarding.mjs` (verified with the
  official Node v22.22.0 Linux binary; confirm `node --version` before running)
- `npm run test:cloud-ui` (headless Playwright runner, WCAG A/AA axe checks)
- `npm run test:plainhand-ui`, `npm run test:plainhand`, `npm run test:cloud`

Database-backed cloud tests require `PLAINHAND_TEST_DATABASE_URL`. Skips are
reported separately and do not count as passes. The synthetic browser tests do
not establish real provider, real Supabase or external account coverage.

## Implementation validation (2026-11-06)

| Run | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `npm run test:plainhand` | 314 | 0 | 0 |
| `npm run test:cloud` | 37 | 0 | 44 |
| `npm run test:cloud-ui` | 5 | 0 | 0 |
| Focused onboarding unit/server tests (included in cloud's 37) | 9 | 0 | 0 |
| Same focused tests on official Node v22.22.0 Linux binary | 9 | 0 | 0 |
| Existing `test:plainhand-ui` full workflow script | 1 script | 0 | 0 |

The browser tests check resume preview before explicit save, target roles,
personal-plan fallback, keyboard focus and Enter operation, real clipboard copy,
phone/admin guidance, help without attached files, task request dialogs, no cloud
EventSource, local streaming, fresh/old/wrong-provider/read-only markers, hidden
page polling and timeout troubleshooting. Axe WCAG A/AA checks cover the resume
wizard, personal-plan message, live-check screen and phone admin fallback. This
is that baseline only: provider screens, extension popup and packet approval have
not received a new axe audit in this change. Existing local browser workflow
coverage includes packet approval and synthetic browser form filling.

## Changed files

- `plainhand/cloud/app.mjs`
- `plainhand/cloud/resume-import.mjs`
- `plainhand/cloud/connection-check.mjs`
- `plainhand/web/app.js`
- `plainhand/web/css/app.css`
- `plainhand/web/ui/core.mjs`
- `plainhand/web/ui/home.mjs`
- `plainhand/web/ui/jobpanel.mjs`
- `plainhand/web/ui/profile.mjs`
- `plainhand/web/ui/settings.mjs`
- `plainhand/web/ui/onboarding.mjs`
- `plainhand/web/ui/connect-data.mjs`
- `tests/helpers/hosted-onboarding.mjs`
- `tests/test-cloud-onboarding.mjs`
- `tests/test-cloud-onboarding.spec.mjs`
- `tests/playwright-onboarding.config.mjs`
- `package.json`
- `package-lock.json`
- `docs/HOSTED-ONBOARDING-IMPLEMENTATION.md`

The MCP endpoint and `api/index.mjs` are untouched. No deployment, provider login,
push, merge, PR, database schema or authentication changes are part of this commit.

## Combined MCP integration verification (2026-11-06)

After merging the MCP endpoint and reconciling its authenticated generic connector
marker with the wizard, all 89 cloud tests passed against disposable Postgres
with zero skips. The five hosted browser/axe tests also passed. An SDK integration
test checks that the real connection tool record is accepted by the wizard
validator, while an old record is rejected. A successful connection check does
not assert a vendor identity or real-account plan coverage.
