# Hosted Plainhand reviewer pack

Prepared 2026-11-06. This is a test and submission checklist, not a submitted
directory listing or evidence of live provider coverage.

## Deployment fields

Fill these only after the stable test deployment has passed its smoke checks:

| Field | Value |
| --- | --- |
| Website | Pending stable hosted origin |
| MCP server | `<origin>/mcp` |
| Privacy | `<origin>/privacy` |
| Terms | `<origin>/terms` |
| Support | `<origin>/support` |
| Square icon | `desktop/assets/icon.png` (512 × 512) |
| Walkthrough recording | Pending recording against the actual deployment |
| Provider setup screenshots | Pending capture and permission review |
| Reviewer sign-in | Pending dedicated synthetic account and verified access |

Do not use the existing read-only dashboard URL as the hosted application URL.

## Reviewer account

Provision a dedicated ordinary Supabase Auth account in the test project. Give
it only synthetic candidate data from `plainhand/test-fixtures.mjs`. Never use
the owner's resume, workspace, cookies or provider tokens. Keep it separate from
production users; use a second synthetic account for isolation tests.

The current website supports Google and email-link sign-in. A directory that
requires a reviewer password with no email-code step is **not ready for
submission** until that supported reviewer sign-in path is implemented and
tested. Merely setting a password on a Supabase account does not add a password
form to this website. Never add a shared cookie, static session, auth bypass or
public sample-account token as a shortcut. Supply any approved reviewer access
details through the directory's private reviewer channel, never this repository.

## Five positive cases

Use the stable test origin and synthetic accounts. Automated coverage below
uses local fixtures; repeat each case with the actual provider before submission.

| Case | Reviewer steps and expected result | Existing automated coverage |
| --- | --- | --- |
| P1: connect and check | Connect with OAuth/PKCE, send “check my connection,” approve its save. The website accepts a fresh authenticated read-and-save check. A check does not establish plan entitlement. | `test-cloud-mcp.mjs`, `test-cloud-mcp-endpoint.mjs`, `test-cloud-onboarding.spec.mjs` |
| P2: resume and targets | Upload a synthetic text PDF, review extracted text, explicitly save, then set target roles. Preview alone changes no profile facts. | `test-cloud-onboarding.mjs`, `test-cloud-onboarding.spec.mjs` |
| P3: evaluate | Save a synthetic role and ask the connected chat to evaluate it. Complete the model steps; show the result and explicit unconfirmed posting-verification status. | `test-cloud-mcp.mjs` deferred interview/evaluate loop |
| P4: prepare and review | Ask the chat to prepare the selected role, complete drafting and independent review steps, then open the packet on the website. PDFs download; approval remains the candidate's action. | `test-cloud-mcp.mjs`, `test-cloud-runtime.mjs` |
| P5: move a workspace | Export locally, upload on the website, review counts and reset warning, then explicitly confirm. Old state is backed up, approvals and machine-specific checks reset, and the second account is unchanged. | `test-cloud-workspace-transfer.mjs`, `test-cloud-workspace-transfer.spec.mjs`, desktop transfer tests |

## Three negative cases

| Case | Expected result | Existing automated coverage |
| --- | --- | --- |
| N1: AI attempts approval/submission | Ask the chat to approve a packet or mark it submitted, including forged confirmation fields. Return the candidate's website link; no approval or submitted state changes. A connector token cannot call extension submission routes. | `test-cloud-mcp.mjs`, `test-cloud-mcp-endpoint.mjs`, `test-cloud-oauth.mjs` |
| N2: wrong identity or stale replacement | Try another account's artifact/preview receipt, cross-site mutation or replacement after a newer edit. Refuse without changing the destination workspace. | `test-cloud-app.mjs`, `test-cloud-workspace-transfer.mjs` |
| N3: unsafe model/page input | Send an invalid step result or an employer instruction to bypass evidence checks. Refuse/retry within attempt limits. Filling a synthetic form never clicks Submit and preserves existing user values. | `test-cloud-mcp.mjs`, `test-cloud-steps.mjs`, `test-extension-fill.mjs`, `test-agent-injection.mjs` |

Never submit a real job application during review. Extension actions run only
on synthetic forms; the candidate performs any final submission themselves.

## Walkthrough recording script

1. Start in a clean test browser with synthetic data. Show the stable URL and
   public privacy, terms and support pages.
2. Sign in using the approved reviewer path. Show resume preview and explicit
   save, targets, and the guided connector instructions.
3. Complete the real provider connection and a fresh read-and-save check.
4. Evaluate one synthetic role, prepare its packet and show independent factual
   review, downloaded PDFs and the candidate-only approval screen.
5. Demonstrate one refused chat approval and an isolated second account.
6. On a synthetic employer form, demonstrate filling and the submit boundary.
7. Show export, confirmed import, Get help without attached workspace files,
   disconnect and account deletion.

Record only the test workspace; exclude secrets, email inboxes, password fields
and unrelated browser tabs. Publish no recording until it has been reviewed for
private data and the relevant directory's current requirements have been checked.

## Release gates

- Confirm Google/email delivery and callback URLs, stable hosting configuration,
  actual PDF rendering, isolation, backup destination and a recovery drill.
- Test every advertised provider/plan route with a real account. All coverage
  rows remain unverified until that evidence exists; Free/Go is unconfirmed.
- Configure published extension IDs before enabling its production audience.
  Complete Chrome registration and each store's review process separately.
- Complete applicable developer identity checks and provider directory approval.
  Hosted Sign in with ChatGPT stays disabled until approved.
- Keep Windows publication off until SignPath, install/update/uninstall and
  two-release update checks pass. macOS signing/notarization remains deferred.
- Review authentic setup screenshots, the actual walkthrough and the current
  directory/store forms before sending anything. No submission has been made.

See [HOSTED-DEPLOYMENT.md](HOSTED-DEPLOYMENT.md),
[DESKTOP.md](DESKTOP.md) and the coverage data in
`plainhand/web/ui/connect-data.mjs` for operational details and remaining gates.
