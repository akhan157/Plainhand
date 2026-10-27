# Plainhand verification, round two — 19 October 2026

> **Follow-up:** [Owned HTTPS sandbox results](OWNED-SANDBOX-RESULTS.md) add a real
> model/backend preparation case, expose an asynchronous-navigation race and make
> the need for explicit portal draft-write adapters visible. No production changes.

## Verified scope

**Known readiness gaps are closed in an isolated candidate. Exact-page restart is
verified for the tested URL-based forms. Production remains unchanged.**

- Both former false-ready failures (radio-only form and required legal surname)
  now return explicit `needs-answers`, never an incorrect completed review.
- Twelve fresh, prespecified readiness cases passed, zero false-ready outcomes;
  eleven retained development/regression cases passed.
- Actual whole-Node SIGKILL after first or second navigation resumed the correct
  saved page without replaying earlier pages. Fill-only interruption can still
  require refilling blank DOM on that same page.
- Final candidate: **75 tests passed, zero failed, one CPU real-audio test skipped**;
  existing browser UI workflow passed.
- Public Playwright observation found **19 Greenhouse, 15 Lever, 6 Ashby fields**,
  with no candidate data, filling, uploads or submissions.
- **Zero additional real-model test calls.** Prior Codex ledger remains 22/24.

These are bounded component verifications, not proof of an overall architecture
winner, universal ATS completion, CAPTCHA acceptance or candidate voice quality.

## What changed in experiments only

### Readiness

One shared completeness check covers browser observation, no-navigation returns,
advance and unchanged-step review paths. It checks visible invalid controls in
supported frames. Sensitivity keywords no longer excuse invalid identity fields.
Required human consent/legal choices remain untouched and explicitly need attention;
a `needs-answers` human-review stop is intentional, not a completed application.

The original twelve-case evaluation was frozen before its outcomes. It compared:

| Snapshot | Correct outcomes / 12 | Eligible factual-ready / 3 | False-ready |
| --- | --- | --- | --- |
| Actual production baseline | 6 | 3 | 6 |
| Previous mechanical combination | 8 | 3 | 4 |
| New shared readiness gate | 12 | 3 | 0 |

Cases include standalone radio/checkbox, legal identity wording, hidden/disabled
inputs, consent/attestation, supported iframe, ARIA-invalid values, existing valid
choice and missing required fact. Same assistant wrote cases/code; not blinded
independent evaluation. The final privacy/canonical-URL candidate replayed all 23
cases as integration regression, **not a new unseen holdout**.

### Exact-page recovery

The existing owner-only checkpoint journal now includes a cursor tied to exact
packet, source-context and job identities. Cursor is captured after filling and
actual navigation, not merely when the HTTP request returns. Recovery validates
same-role path and original role query values before visiting saved address.

Seven guard tests cover valid descendants, cross-origin/wrong-role/traversal/
credential rejection, removed/changed/duplicate role query, stale ownership,
changed approval and monotonic journal timestamps. Public observations exposed
Greenhouse's legacy `boards.greenhouse.io` → `job-boards.greenhouse.io` redirect;
final candidate permits only that narrow alias with identical posting path/query.
No unrelated host/role was authorized by the exception.

In final three-step crash checks, readiness-only control still reopened page one
and replayed earlier work after navigation. Resume candidate restored exact page
after first and second navigation and reached review with zero submissions. These
are real Node-process terminations and real local browser/PDF/checkpoint operations,
not a browser-close-only simulation. Browser server stayed parent-owned; employer-
side state, machine failure and exactly-once upload/account actions remain untested.

### Cursor privacy

Inspection caught a new risk before promotion: a saved portal URL inside job
checkpoint could enter a later provider request or workspace export. A synthetic
marker test intentionally fails on the first resume prototype. No actual private
URL or credential was sent to a real provider.

Separate corrected candidate strips portal checkpoints at the shared reasoning
boundary, including direct form-planning calls, and omits private cursor from
export without deleting local recovery state. Privacy test passes alongside
URL/ownership and full app regressions. Prior frozen experiments were not edited.

## Public-site evidence and limits

Baseline and readiness candidate observed the same three public forms:

- Greenhouse/Figma, Compliance Engineer: 19 fields.
- Lever/Zoox, AV Safety Data Reporting Engineer: 15 fields.
- Ashby/Notion, Software Engineer, AI Connections (Developer Platform): 6 fields.

Field discovery is not proof of complete extraction, valid dropdown selection,
correct generated answers, accepted PDF transfer, successful CAPTCHA or submission.
No profile or fabricated application was sent to any employer. Blocked incidental
assets/analytics are retained in raw request diagnostics. Employer legitimacy and
fit were not evaluated. No model or application data was used for observation.

## Evidence and next boundary

[Evidence index, frozen sources, patches and reproduction](../output/verification-round2-2026-10-19/README.md).

Active app source hashes remain unchanged. Tests did not start or stop production
service; no listener on port 3210 was detected at final check. There is now stronger
support for reviewing these fixes individually, not adopting a replacement
architecture wholesale. No change was shipped by this verification.

Remaining real-workflow/voice verification needs an owned ATS sandbox or an exact
candidate-selected role, reviewed candidate data and writing samples, candidate
review of outputs, and explicit quota authorization if new inference is needed.
Current root checkout still lacks real onboarding inputs. Do not fill/upload on
real employer forms with fictional benchmark data. Never submit an application.
