# Owned HTTPS sandbox verification — 19 October 2026

## Result

**One real-Codex, end-to-end preparation case passed against an owned, disk-backed
HTTPS backend. Production code remains unchanged.**

- Real evaluation, grounded packet, factual review and actual Chromium PDFs.
- Backend accepted **21,275 bytes**, matching exact approved PDF SHA-256:
  `2ad733851af944327e149db9f1503ad037fab8c8712d3ce206841160a90213a3`.
- Actual browser requests persisted both draft pages: identity, grounded achievement,
  Bachelor of Science, Example Institute and known 2027-01-15 availability.
- Unknown optional preference stayed blank; legal attestation stayed unchecked.
- Whole app Node process was killed after first saved page/navigation. Restart
  resumed page two; **no further upload** or earlier-page replay occurred afterward.
- Source-change guard rejected another autofill before any backend write. Both DOM
  and outbound submission probes were blocked; **zero submissions**.
- Actual persisted answers passed an additional Codex factual review.
- **8 of 12 newly authorized Codex calls**, all successful. Prior 22-call ledger
  retained separately: 30 real test calls across these two authorization phases,
  not a claim about total account usage or subscription quota.

**Later follow-up:** [broader verification](VERIFICATION-MATRIX.md) used the final
four authorized calls for fictional voice checks. Current phase is now **12/12**,
34 tracked calls including prior phase. Original owned-run results below remain
historical; no additional inference is authorized by unused figures in this report.

## Important compatibility finding

**Native policy alone did not complete server-side draft persistence.** It allowed
only the exact approved upload, then correctly blocked this sandbox's unknown
`draft.save` endpoint. That negative result is retained, not hidden as success.

Positive preparation used a separately disclosed **sandbox-only draft adapter**:
exact endpoint/action, role, current packet/context/approval, CSRF, fixed ordinary
field keys/types, and no legal fields or final submission. It is not an implemented
commercial-Ashby draft adapter and does not prove real ATS APIs support this flow.
No production write guard was disabled or changed.

Therefore: this verifies the preparation pipeline **with that scoped adapter**,
not that current shipping app can autonomously save drafts on arbitrary portals.
Real portals need their own observed/documented, narrowly authorized write contracts.

## Why this is stronger than mocked pages

Browser requests passed normal submission/attachment guards, then a deny-by-default
transport relayed enumerated native-protocol URLs to an actual loopback HTTPS
server. Actual server HTTP responses were returned unchanged. Playwright did not
fabricate successful upload/draft responses. Browser-visible Ashby/S3 origins are
virtual in this isolated context; no vendor or real employer received traffic.

Backend verifies actual multipart file bytes, approved filename/length/hash,
one-use upload grant, session/CSRF, exact approval and draft field schema. It writes
actual PDF bytes and draft/audit state to disk. Unit test also stops/restarts that
backend and verifies retained data. This remains owned protocol simulation, not
commercial-ATS infrastructure, CAPTCHA acceptance or a real application.

## Newly exposed navigation bug

Real asynchronous save-then-navigation exposed a gap static page fixtures missed:
old-document locator inspection could wait 30 seconds after the backend had saved
page one, then return paused without reconciling cursor. Two synthetic development
failures remain retained, including the initial harness timeout.

Before real inference, isolated app snapshot was corrected to inspect concrete
handles, fail fast on changed snapshot/name, and boundedly retry only recognized
navigation-context errors. Unexpected errors still propagate; unchanged Next pauses
after one click instead of being declared final review. Three explicit regressions
and full backend workflow pass. This is a small experimental patch, not an actor
migration or a change to active app.

## Evidence and model quality

[Raw proof and reproduction](../output/owned-sandbox-2026-10-19/README.md).

The saved achievement was: “I built the monthly reconciliation checklist at
Fictional Ledger. Review time fell from 6 hours to 3 hours. I used Excel.” Those
facts appear in supplied fictional sources. No extra credentials or numerical
claims were needed. Original packet review and final persisted-field review passed.
Assistant inspection of the actual outputs found no obvious unsupported claim;
this is not blinded quality evaluation or human acceptance of a real candidate's
voice. Configured first-person voice belongs to the fictional profile only.

Reported consumption: **135,087 inclusive input tokens**, **1,271 output tokens**,
8/8 coverage. Cache-read counts are a subset of input; see ledger for exact values.
Codex CLI `0.163.0`; model ID, dollar charge and remaining subscription quota were
not reported and are not inferred.

Four calls were for form answers. Resume inspection and subsequent autofill both
planned second-page fields, so answer reuse remains an observed efficiency target.
No architecture-efficiency or completion-rate conclusion follows from this one run.

## Remaining limits

- Native-policy failure followed by adapter-enabled retry uploaded same PDF twice;
  owned server deduplicated it to one artifact. No upload occurred after page-two
  crash resume. This is **not exactly-once upload** proof for other services.
- Real commercial ATS persistence, SSO, CAPTCHA and non-URL SPA state remain unproven.
- Actual user's voice needs writing samples and user acceptance, not another proxy
  score or model declaring itself correct.
- Approval was simulated for fictional test material, not real candidate consent.
- Existing app/security/browser tests plus backend/navigation checks: **71 passed,
  zero failed, one CPU audio skip**. Existing UI workflow passed. Full repository,
  Go and dependency audit were not rerun.
- Owned services were stopped after verification; receipts/artifacts persist.
  Nothing was submitted and no production service/source was started, stopped or
  changed by this experiment.

**Recommendation:** retain incremental correctness/recovery improvements for review,
and treat narrow portal write adapters as concrete remaining work. No evidence here
justifies calling a universal architecture winner or replacing production wholesale.
