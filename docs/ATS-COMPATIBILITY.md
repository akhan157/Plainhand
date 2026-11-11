# ATS compatibility — measured 20 October 2026

Scope: browser application assistance. No application was submitted; the
submission guard is unchanged. Probes ran headless from this workstation
(Verizon residential IP, New York). Fields were read, never typed, unless noted.

## What changed

1. **Portal scope instead of an ATS list.** `portalRoot()` reduces the job URL
   to its registrable domain; `portalFrame()` accepts the known ATS list plus
   that root and its subdomains. Navigation, extraction, next-step controls and
   validation all use it. Writes and submit controls stay blocked.
2. **Static assets may load from any HTTPS host.** Portals load bundles from
   sibling infrastructure (`wd5.myworkday.com`, `wd5.myworkdaycdn.com`).
   `script`, `stylesheet`, `font`, `image`, `media`, `manifest` and `other`
   requests are allowed; `fetch`/`xhr` remain restricted to the portal root,
   known ATS and asset paths, so page code cannot pull arbitrary endpoints.
3. **Workday asset CDN** (`<tenant>.myworkdaycdn.com/wday/asset/…`) added to the
   asset allowlist.
4. **Late-mount wait.** `open()` now re-inspects for up to 12 s before declaring
   a portal unsupported; Workday and Workable mount their Apply control after
   first paint.
5. **`Apply Manually`** added to the navigation vocabulary.
6. **SSO login walls** (`Sign in with Apple/Google/email`, `Create an account`)
   report `state: 'login'` instead of `unsupported`.
7. **Vendor detection** for hCaptcha, DataDome, Arkose and PerimeterX reports a
   truthful `challenge` state with solver `manual`.
8. **Discovery** loads the existing `workable`, `smartrecruiters` and
   `recruitee` providers.

## Measured results

| Portal | Fields | State | Finding |
| :--- | ---: | :--- | :--- |
| Greenhouse (Figma) | 19 | `ready` | unchanged |
| Lever (Zoox) | 15 | `challenge` | hCaptcha appears after repeated automated visits; fields still extracted, clear it manually |
| Ashby (Notion) | 6 | `ready` via Apply | unchanged |
| Recruitee (Grip) | 7 | `ready` via Apply | name, email, phone, CV, cover letter, compensation, LinkedIn |
| **Workable (Activ)** | **13** | `ready` via Apply | first/last name, email, headline, phone, address, city, postcode |
| SmartRecruiters (Renesas) | 0 | `challenge` | DataDome gates the apply route |
| Workday (Workday tenant) | 0 | `navigate` → sign-in | apply flow is 7 steps; **step 1 is Create Account/Sign In** |

Corrections to the earlier report: Workable is not a shadow-DOM problem (it
works); Workday is not a rendering problem (the page renders; the form is behind
the candidate's own account).

## Per-issue status

| Issue | Verdict | Remaining avenue |
| :--- | :--- | :--- |
| Shadow DOM forms | Not the cause on Workable; Playwright locators already pierce open roots | Closed root would need `attachShadow` instrumentation; none observed |
| Workday | Requires candidate sign-in (SSO/email) | Handoff flow already exists: sign in, then resume inspection |
| DataDome (SmartRecruiters) | No trusted local adapter | Camoufox/Patchright fingerprint evasion or a paid solver; both untested here |
| hCaptcha (Lever) | No local adapter | Same as DataDome; detection + manual resume now works |
| IP reputation | Lever served hCaptcha only after repeated hits | Persistent warmed profile; not yet built |

## Verification vendors

| Vendor | Automated locally | Behaviour |
| :--- | :--- | :--- |
| Cloudflare Turnstile | Yes | non-interactive pass or managed checkbox with stepped pointer |
| Google reCAPTCHA v2 | Audio + visual grid | local Whisper audio; local ONNX classifier when audio is refused |
| hCaptcha | No | detected, `challenge`, solver `manual` |
| DataDome | No | detected via `captcha-delivery.com`, solver `manual` |
| Arkose / FunCaptcha | No | detected, solver `manual` |
| PerimeterX | No | detected, solver `manual` |

## Boundary

Submission remains blocked by three independent layers: the DOM interlock
(`browser-guard.mjs`), the network write guard, and submit-control refusal.
Widening the portal surface changes none of them; the candidate still performs
the final submit.

## Resume PDF text check

An applicant tracking system reads the text layer embedded in a PDF, not the
rendered page. After Plainhand renders the tailored resume, `plainhand/ats-check.mjs`
extracts that text with Poppler `pdftotext` (default reading order, local only)
and checks it the way a parser sees it. No model is involved.

| Check | Fails when |
| :--- | :--- |
| Text layer | the PDF has no selectable text |
| Contact details | the profile's name, email or phone is not literal text (whitespace and phone punctuation are normalised; an empty phone is not required) |
| Readable characters | U+FFFD, private-use glyphs, `(cid:N)` codes, or more than 2% control characters appear |
| Reading order | fewer than 70% of the resume's lines (first six words each) are found, or fewer than 85% of those found are in order, which is what column or table interleaving looks like |

**Keywords.** Skill and tool terms come from the posting after
`providerDescription` (`plainhand/posting-integrity.mjs`), never the raw
description, so text aimed at AI tools cannot add keywords. Each term is
`covered` (in the resume text), `suggested` (in the candidate's sources or
profile but missing from the resume; offered as an optional change) or a `gap`
(in neither). Plainhand never suggests adding an unsupported keyword: gaps stay
visible and are never stuffed into the resume. Keyword results do not change the
overall state.

**Result.** Stored on the job as `job.atsCheck = { state, checks, keywords:
{ covered, suggested, gaps }, checkedAt }`, with `state` of `passed`, `issues`
(any failed check) or `unavailable` (plus a `hint`). If `pdftotext` is missing
the state is `unavailable` with an install hint; the check never throws and never
blocks preparing the packet. It is advisory.

**Where it shows.** The Packet tab has a compact "Resume PDF check" summary. Contact,
garbling and empty-text failures also appear under "Check your resume file" in the
pre-submit list (`presubmitCheck(...).documentChecks`) as things to double-check;
they do not change `ready`.
