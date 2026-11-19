# Lane assignment: measurement-design (Gate 1 design only)

Status: **design only, awaiting root Gate 1 review.** Nothing in this file has
been implemented, run, installed, merged or accepted. This is a proposal by the
design sub-agent. The author cannot self-accept, and nothing below is a product
acceptance or a register disposition.

## 0. Decision summary

Three bounded scorer fixes, followed by a frozen baseline that root accepts:

1. **Numeric grounding by claim subject.** The packet's numbers are checked
   against the candidate's sources and, only for explicitly employer/role
   statements, the posting. A posting number may not launder a candidate claim.
   Visible headings and headlines become checked text. Ambiguous ownership is
   recorded as uncertainty and fails closed, not as broad permission.
2. **Rendered-PDF evidence.** `%PDF-` plus a byte count stops being proof. The
   evaluator extracts the real rendered PDF's text and item geometry, checks the
   packet's visible lines and order, contact details, garbling, layout anomalies
   and the existing ATS-style checks, and fails or blocks when extraction is not
   available. Magic bytes remain metadata only.
3. **A frozen baseline specification.** Root accepts and commits it *after*
   continuation integration and scorer validation, and *before* gap work. It
   names exact scenario ids, held-out fixtures, judge identity, negative controls,
   repeats, counters, access tiers, budgets, quota handling and proposed
   thresholds. Existing thresholds are not changed. Human calibration and real
   user/site acceptance remain external and are never claimed.

The only file changed by this Gate 1 is this assignment. Implementation starts
only after root review and a fresh base confirmation.

## 1. Exact base and branch

| Item | Value |
|---|---|
| Lane branch | `t3/evaluation-baseline-design` |
| Expected and confirmed base HEAD | `9ec623777e1c77157b975a1f92e07175babaa0f4` |
| Base relationship | Goal branch with the independently reviewed tracking increment integrated; continuation is **not** integrated |
| Working tree at design start | clean (`git status --porcelain=v1` empty) |
| Continuation compatibility tip (not merged, not edited) | `a46056fdc53a4159f5b30eae9b3de578efb3767d` |
| Root counterexample source | `e4da45fa2d21ce1f5945ce11662a73afda03b53f` |
| Design-time memory | `free -h`: 4.8 GiB available of 15 GiB, above the 2 GiB gate. Dispatch note recorded 5.6 GiB checked immediately before dispatch. No build, test, browser or server was started by this design. |

Routing disclosure, recorded because it affects who may review: this design was
authored by the configured Pi fallback, catalog **DeepSeek V4.1 Flash**, thinking
max, on the existing metered account, after `opencode-go` returned insufficient
balance and Claude returned 429. Root Codex `gpt-6.1-sol` is a different family
and reviews this design. No silent model switch occurred. The design author is
not the baseline judge and cannot accept the design.

If a later implementation lane starts from a different HEAD, it must stop and
have root re-pin. It must not be based on this branch while continuation is still
unmerged, because continuation touches the same evaluation files (see §9 and
Appendix B).

## 2. Scope and authority

### In scope for this Gate 1

- This document only: `docs/internal/lanes/measurement-design/ASSIGNMENT.md`.

### In scope for the implementation lane after root approval

Proposed, not authorized yet:

- `plainhand/evaluation/score.mjs`: subject-aware numeric grounding, visible
  heading/headline text, structured PDF evidence in `pdfValid`, reporting fields.
- `plainhand/evaluation/pdf-evidence.mjs` (new): pure PDF extraction and checks
  using the already-pinned `pdfjs-dist`; optional Poppler cross-check.
- `plainhand/evaluation/runner.mjs`: collect PDF and cover evidence, provider
  identity metadata, intervention/known-fact/rescue counters.
- `plainhand/evaluation/claims.mjs`: only if a shared visible-text helper is
  needed; no judge prompt change.
- `plainhand/evaluation/judge.mjs`, `benchmarks/benchmark-judge.mjs`: judge
  identity proof and prompt hashes; **no rubric or instruction change** in the
  baseline.
- `tests/test-bench-eval.mjs`, `tests/test-eval-judge.mjs`,
  `tests/test-pdf-evidence.mjs` (new), and focused ATS tests.
- `docs/internal/EVALUATION-HARNESS.md`, `docs/internal/EVALUATION-JUDGE.md`:
  document the new evidence fields after implementation, not before.
- Frozen baseline manifest and held-out fixtures **authored/committed by root**
  at freeze time, not by this lane.

### Out of scope

- Production `plainhand/claim-calibration.mjs` and the employer-vocabulary subject
  bug. That fix is owned by the continuation lane. This design does not edit,
  import from, or design an overlapping production fix. The evaluation scorer is
  a separate consumer with its own rule.
- Any product mechanism, prompt, threshold, tracker, report, register, manifest,
  board, `GOAL-*`, `REVIEW.md`, `EVIDENCE.json` or root handoff edit.
- Merging continuation or any other branch. No push, main merge, deploy, tag,
  release, install, paid service, live model call, browser run or employer
  contact.
- Real-site, commercial-site, CAPTCHA or human-voice acceptance. Those stay
  external.
- Any expansion beyond finance, tech, STEM and adjacent roles already in the
  corpus.

The final application is always manual. No packet, benchmark or judge run submits
to an employer or contacts one. The sandbox is loopback-only.

## 3. Problem statement and evidence

### 3.1 Root counterexamples (direct probes, not re-run here)

Source `e4da45fa2d21ce1f5945ce11662a73afda03b53f`; raw evidence path
`output/goal-review/scorer-counterexamples.json`, SHA-256
`ecab16d35daddf33d7048f59d9440eaea95bf7f4fd95439010a42c27a8db26c6`. The file
is a root-owned ignored artifact; this design does not assume it exists in this
worktree. The reported inputs and results are:

1. Candidate source `Built SQL reports.` plus posting
   `Our company operates in 28 countries.` plus packet resume
   `Built SQL reports. I led teams in 28 countries.` returns
   `unsupportedNumbers: []` and `pass: true` when good review, calibration and
   PDF metadata are injected. Removing the posting number returns `['28']` and
   `pass: false`. The posting number is launderable into a candidate claim.
2. A numeric claim in a resume heading, `{ title: 'Director of 28 divisions' }`,
   is skipped entirely by the numeric scan.
3. `pdfValid` accepts an arbitrary 101-byte buffer plus a caller-supplied
   `head: '%PDF-'` metadata value. No rendered document is involved.

These are harness counterexamples. They are not model outputs, real PDFs,
employer results or product-quality measurements.

### 3.2 Source-level causes at the pinned base

| Cause | Source | Effect |
|---|---|---|
| Posting numbers are pooled into one candidate source token set | `plainhand/evaluation/score.mjs:44-56` (`sourceTokens`, `numberCheckSource([...sources, job.description])`) | Any candidate sentence may use any posting number |
| Only resume entry text, answer text and the cover letter are scanned | `plainhand/evaluation/score.mjs:46-47` | `packet.headline` and every `entry.heading` are invisible to the numeric check |
| One global token set is used for every number | `plainhand/evaluation/score.mjs:56` | No subject, clause or sentence attribution; mixed and multi-sentence text cannot be distinguished |
| PDF validity is a header and size predicate | `plainhand/evaluation/score.mjs:64` | 101 arbitrary bytes plus `%PDF-` pass; no text, layout, page or content evidence |
| The runner stores only bytes, SHA and the first five bytes | `plainhand/evaluation/runner.mjs:273-278` | The scorer has no extraction result to check |
| The product ATS check already extracts real text, but the evaluator does not use it | `plainhand/ats-check.mjs:118-159` (`checkResumeText`, `extractPdfText`) | Real text/layout evidence exists for the product; the benchmark discards it |
| The judge already includes headings and headline as claims | `plainhand/evaluation/claims.mjs:85-119` (`packetText`, `extractClaims`) | Deterministic numeric scoring and the judge disagree about visible text, so a heading can be judged but not numerically checked |
| Judge identity records only a provider id and a self-judged flag | `benchmarks/benchmark-judge.mjs:60-80`; `plainhand/evaluation/runner.mjs:406-414` | Different provider IDs are not proof of a different model family; actual model/catalog evidence is missing |

### 3.3 Why this is a measurement-validity problem

The harness is the regression gate for the product rows. A scorer that cannot
fail on a planted unsupported candidate number, a numeric heading or non-PDF
bytes cannot certify packet fidelity (U07) or independent measurement (U13). The
fix is not a product-quality claim. It restores the ability of the gate to
distinguish true from false before any live baseline is run.

## 4. Design A: candidate-vs-posting numeric grounding

### 4.1 Invariants

1. **The posting is evidence about the employer and role, never about the
   candidate.** A number in the posting supports a packet number only when the
   packet states it about the employer or role with an explicit owner cue.
2. **The candidate's own sources remain the only evidence for candidate
   numbers.** Candidate, first-person, implicit-bullet and unresolved clauses use
   candidate sources only.
3. **Every visible number is checked.** Headline, headings, resume bullets,
   answers and cover-letter sentences are included. Dates in headings are
   numbers and must be supported by candidate sources.
4. **Attribution is mention-level, not token-level.** The same token can be
   legitimate in one sentence and unsupported in another; the unsupported
   mention fails the packet even if another mention passes.
5. **Ambiguity fails closed and is labelled.** A posting-only number in an
   implicit or unresolved clause becomes an unsupported number with
   `uncertain: true` and a reason. It is never silently licensed.
6. **No corpus special-casing.** Rules are generic text rules. They do not name
   personas, jobs, scenario ids or fixture strings.
7. **No threshold change.** The existing `coverage >= 0.66`, zero-absent-claim,
   zero-banned-word, review, calibration and first-person gates remain. This
   change makes `unsupportedNumbers` mean what it says; it does not add a new
   numeric threshold.

### 4.2 Visible text units

Build one ordered list from the packet. The judge already uses the same visible
surface (`claims.mjs`); the scorer must not diverge.

| Unit | Text checked | Default owner |
|---|---|---|
| `headline` | `packet.headline` | candidate (always) |
| `heading:e` | `title`, `org`, `location`, `dates` joined as the reader sees them | candidate (always) |
| `resume:e` | each entry's `text`, split into sentences | automatic attribution |
| `answer:n` | each answer's `answer`, split into sentences; the question is not a candidate claim | automatic attribution |
| `cover:i` | each cover-letter sentence after salutation/sign-off/name handling | automatic attribution |

Headings and the headline are always candidate-attributed even if they contain
`your` or `the role`. They identify the candidate's record; an employer numeric
description belongs in the body, not in a title line. This is the conservative
choice and prevents a headline from becoming a posting-number loophole.

### 4.3 Attribution rule

**Sentence split.** Use the existing deterministic `splitSentences` from
`claims.mjs`, so the judge and numeric scorer see the same sentence boundaries.
Do not add a model call. A sentence with multiple owners is split into owner
spans, not treated as one bag of numbers.

**Owner cues.** Scan each sentence for whole-word cues, case-insensitive:

- **Candidate cues:** `I`, `me`, `my`, `mine`, `we`, `us`, `our`, `ours`,
  `myself`, `ourselves`.
- **Employer/role cues:** `you`, `your`, `yours`; the role/position/posting/job
  phrases `the role`, `the position`, `the posting`, `the job`, `this role`,
  `this position`. Bare `the company`, `the employer` or `the organization` is
  not an employer cue by itself; it can be the candidate's own employer. The
  target phrasing must be explicit (`your company`, `your team`, `the role`).
- **Not owner cues by themselves:** `the team`, `the group`, `the unit`,
  `the department`, `the client`, bare definite descriptions. They are
  ambiguous in a candidate-authored packet (they can be the candidate's own
  team), so they default to candidate and any posting-only number there is
  flagged uncertain. A legitimate employer description can use `your team`,
  `your company`, `your 28-person team` or `the role` and remains allowed.
- **Implicit bullet:** a verb-initial resume line with no subject (`Led teams in
  28 countries.`) is a candidate claim.
- **Part scope:** in resume entries, `the role`, `the position`, `the job` and
  `the posting` are not employer cues by themselves; they usually describe the
  candidate's own role (`The role lasted 28 months.`). They are employer cues
  only in answer and cover-letter text, and only when followed by a
  requirement/description predicate (`requires`, `calls for`, `offers`,
  `covers`, `includes`, `involves`, `entails`, `is`, `will`). `your`, `you` and
  `yours` remain the safe target form in every part.
- **Quoted requirement:** in a cover letter, `The role requires 10+ years; I have
  12.` gives the employer span to `The role` and the candidate span to `I`.

**Spans.** Sort cue positions. Each cue starts a span that runs to the next cue
or the sentence end. A number belongs to the span containing its start index. If
no cue precedes it, it is `implicit` (verb-initial bullet) or `ambiguous` (bare
definite description), and both are candidate-only. A span whose cue is an
employer cue is `employer`; otherwise it is `candidate`.

**Mixed-sentence guard.** A mixed sentence must not turn a candidate action into
an employer number. An employer span licenses a posting number only when one of
these holds:

- the employer cue is at the sentence start or immediately after a clause
  boundary (`;`, `:`, em/en dash); or
- the number is directly attached to the employer noun phrase: a compound
  modifier right after `your`/`the role` (`your 28-country team`, `the role's 12
  sites`) or an `of` phrase right after an employer noun (`your team of 28`); or
- the employer span has an employer predicate before the number (`is`, `are`,
  `was`, `were`, `has`, `have`, `had`, `operates`, `covers`, `includes`, `serves`,
  `employs`, `spans`, `runs`) and no candidate cue between the cue and the
  number.

Otherwise, if the sentence also contains a candidate cue, the number is
`ambiguous`, candidate-only and `uncertain` when it is posting-only. This is the
conservative rule that rejects `I told your team about 28 projects.` while
preserving `I built reports for your 28-country team.` Examples:

- `I built reports for your 28-country team.` → `28` is directly attached to
  `your` and modifies the employer team: employer, posting may support it.
  `I built reports` has no number.
- `I led teams in 28 countries at your company.` → `28` is in the `I` span
  and is not attached to `your`: candidate, posting may not support it.
- `At your 28-country company, I led 12 teams.` → `28` employer; `12`
  candidate.
- `Your company operates in 28 countries. I led teams in 28 countries.` →
  first `28` employer; second `28` candidate. The second mention fails even if
  the first passes.
- `I told your team about 28 projects.` → `28` is not directly attached to
  `your` and there is no employer predicate; ambiguous/candidate, posting-only
  means unsupported and `uncertain`.
- `Your team has 28 people.` → employer predicate `has`; posting may support
  `28`.

**Source sets.**

- `candidateTokens` = the existing `sourceNumberTokens(numberCheckSource(sources))`
  over candidate sources only. The existing phone removal, percent-word and
  thousands-separator rules are retained.
- `postingTokens` = the same tokenizer over `jobSource(job).text` (company,
  title, location and description), matching the judge's job source. The posting
  is not concatenated with candidate sources.
- `employer` span: supported if `numberSupported(token, candidateTokens)` **or**
  `numberSupported(token, postingTokens)`.
- `candidate` / `implicit` / `ambiguous` span: supported only by
  `candidateTokens`.
- If an implicit or ambiguous mention is posting-only, mark `uncertain: true`
  and keep it unsupported. If the same token is also in candidate sources, it
  is supported and the ambiguity is recorded but does not fail.

**Number mentions.** Extract both digits and existing number words per sentence
with their start index, so attribution is positional. The existing canonical
rules stay: `4,000` = `4000`, `30 percent` = `30%`, a bare `70` is supported by
`70%`, a phone-like sequence is not evidence. Do not change those rules in this
packet.

### 4.4 Case table

Every row is a required test. `pass` means the packet's numeric check has no
unsupported/uncertain mention.

| Case | Packet text / source | Expected |
|---|---|---|
| Candidate number only in posting | `I led teams in 28 countries.`; posting has `28`, candidate sources do not | `unsupportedNumbers: ['28']`; `numberChecks[0].owner='candidate'`, `uncertain=false` (explicit first person is confidently unsupported); packet fails |
| Ambiguous mixed number | `I told your team about 28 projects.`; posting has `28`, sources do not | `owner='ambiguous'`, `uncertain=true`; unsupported; packet fails; reason names the unresolved owner |
| Employer predicate | `Your team has 28 people.`; posting has `28` | employer; supported by posting |
| Employer phrase attachment | `your team of 28` or `your 28-person team`; posting has `28` | employer; supported by posting |
| Candidate number removed from posting | same packet; posting has no `28` | still `['28']`; fails |
| Employer description | `Your company operates in 28 countries.`; posting has `28` | supported by posting; no unsupported; packet can pass |
| Role description (cover/answer) | `The role covers 12 countries.`; posting has `12` | supported by posting |
| Role history (resume) | `The role lasted 28 months.`; posting has `28`, sources do not | not an employer cue in a resume; candidate; unsupported; fails |
| Mixed, employer number | `I built reports for your 28-country team.`; posting has `28` | `28` employer; supported; candidate part has no number |
| Mixed, candidate number | `I led teams in 28 countries at your company.`; posting has `28`, sources do not | `28` candidate; unsupported; fails |
| Multi-sentence cross-license | `Your company operates in 28 countries. I led teams in 28 countries.` | first supported, second unsupported; packet fails |
| Header title | `{ title: 'Director of 28 divisions' }`; sources do not contain `28` | heading `28` unsupported; fails |
| Headline | `Director of 28 divisions`; sources do not contain `28` | headline `28` unsupported; fails |
| Date heading, supported | `Jun 2026 to Aug 2026`; profile resume contains the same dates | supported; no false positive |
| Date heading, unsupported | `Jan 2031 to Mar 2032`; sources do not contain those years | unsupported; fails |
| Answer, candidate | `I managed 28 people.`; sources do not contain `28` | unsupported; fails |
| Answer, employer | `Your 28-person team...`; posting has `28` | supported by posting |
| Cover, candidate | `I led the 28-country launch.`; sources do not contain `28` | unsupported; fails |
| Cover, employer | `your 28-country team`; posting has `28` | supported by posting |
| Quoted requirement | `The role requires 10+ years; I have 12.`; posting `10+`, sources `12` | `10` employer allowed; `12` candidate supported |
| Implicit bullet | `Led 28 teams.`; posting has `28`, sources do not | candidate/implicit; unsupported and `uncertain=true` |
| Bare definite team | `The team of 12...`; posting has `12`, sources do not | ambiguous defaults to candidate; unsupported and `uncertain=true`; not silently allowed |
| Number word / percent / phone | existing tests (`six years`, `70%`, own phone, other phone) | existing results unchanged |

### 4.5 Reporting and pass rule

`scorePacket` keeps its public `unsupportedNumbers` field for compatibility and
adds:

```text
numberChecks: [{
  token, canonical, part, unitId, sentence,
  owner: 'candidate' | 'employer' | 'implicit' | 'ambiguous',
  allowedSources: ['candidate'] | ['candidate','posting'],
  supportedBy: ['profile' | 'cv' | ... | 'job'],
  supported: boolean,
  uncertain: boolean,
  reason: string
}]
numericPostingOnly: numberChecks filtered to supportedBy === ['job']
numericUncertainty: numberChecks filtered to uncertain === true
```

`unsupportedNumbers` remains the unique canonical tokens with at least one
unsupported mention. The packet passes only if **every mention** is supported
(`numberChecks.every(check => check.supported)`) and `numericUncertainty` is
empty. The summary reports the counts, so a reviewer can see whether a posting
number was used legitimately or a candidate number was laundered.

No existing threshold changes. `coverage >= 0.66` and every other pass term stay
exactly as they are.

### 4.6 Falsifiers and regression tests

1. The root counterexample must fail after the fix: posting `28`, candidate
   sources without `28`, packet `I led teams in 28 countries.` →
   `unsupportedNumbers` includes `28`, `pass: false`. This test fails on the
   pre-fix source and passes after.
2. Removing the posting number must not change the failure.
3. The numeric heading and headline cases must fail; the current code skips
   them.
4. The legitimate employer cases must pass; a fix that rejects every posting
   number is too broad and fails these tests.
5. Mixed/multi-sentence cases must attribute per mention; a fix that checks only
   the sentence or the whole packet fails.
6. Existing numeric tests (number words, year ranges, percent, phone) remain
   unchanged.
7. A mutation check: temporarily pool posting tokens into candidate tokens and
   confirm tests 1–5 fail. This proves the tests can fail; it is not shipped.

## 5. Design B: visible heading and headline content

The judge already treats the headline and each distinct heading as claims
(`claims.mjs:107-119`). The numeric scorer does not. Fix by using the same
visible units:

- Add `packet.headline` and `headingText(entry.heading)` to the numeric scan.
- Headings are candidate-attributed (see §4.3). Dates, titles, employer names,
  locations and scope words are all visible to a reader and must be grounded.
- A heading repeated across entries is checked once, matching the judge's
  de-duplication.
- The controlled packets use headings for `pumps` and `ta` with persona dates;
  the seeded and minimal profile resumes contain those dates, so controlled runs
  should not regress. If a live packet drops a date from the source but keeps it
  in a heading, that is a true positive, not a false one.
- No special case for headings such as "Director of 28 divisions"; the generic
  candidate rule applies. A headline that copies a numeric job title is also
  conservative and flagged; the correct fix is to keep the title free of posting
  numbers or move the number to a body sentence, not to add a headline loophole.
- Add tests for: supported date heading; unsupported year; numeric title; numeric
  scope in a title; repeated heading counted once; headline numeric claim; no
  heading means no change.

## 6. Design C: rendered-PDF evidence

### 6.1 Current defect and boundary

`pdfValid` is `bytes.length > 100 && head === '%PDF-'`
(`score.mjs:64`). The runner passes only bytes, a hash and the first five bytes
(`runner.mjs:273-278`). The product already extracts and checks real PDF text
through `plainhand/ats-check.mjs` (`checkResumeText`, `extractPdfText`), but the
benchmark discards it. The fix is evaluator-side; it does not change the product
PDF renderer, templates or ATS advisory behavior.

### 6.2 New pure module

`plainhand/evaluation/pdf-evidence.mjs` (new; no workspace or network access;
the optional Poppler cross-check spawns the local, read-only `pdftotext`):

```text
pdfEvidence(bytes, { packet, profile, job, sources, extractor })
  -> {
       extractor: { name: 'pdfjs-dist', version: '6.5.438', mode: 'node' },
       state: 'passed' | 'issues' | 'unavailable' | 'error',
       pages, pageCount, textSha256, textLength,
       lines, checks, ats, cover, popplerCrossCheck, error
     }
```

Primary extraction uses the already-pinned `pdfjs-dist` dependency
(`package.json:121`, version `6.5.438`) with the same Node fake-worker pattern as
`plainhand/cloud/resume-import.mjs:25-29`. No new package is introduced; the
implementation environment must have the pinned dependencies installed and the
manifest records the environment. `getTextContent()` items supply `str`,
`transform`, `width`, `height` and `hasEOL`; group items into lines by page and
vertical position, and
sort by page, then descending `y`, then `x`. Preserve line breaks and normalize
whitespace the way `checkResumeText` does.

Optional Poppler cross-check reuses `extractPdfText` from `ats-check.mjs:130-141`
when `pdftotext` is available. It is a cross-check, not a new required install.

### 6.3 Checks

| Check | Rule | Failure effect |
|---|---|---|
| `parse` | `pdfjs-dist` loads the document; at least one page; no exception | `state='error'`; packet fails |
| `text-layer` | Extracted normalized text is non-empty; every rendered page has at least one non-empty text item | fail |
| `garbled` | Existing `checkResumeText` garbled rules: replacement chars, private-use glyphs, `(cid:n)`, control-char ratio | fail |
| `contact` | Existing `checkResumeText` contact check: name, email and phone (when the profile has one) are literal text | fail |
| `resume-coverage` | Every visible resume line (headline, heading, entry text) is represented in the extracted text at ≥ 0.90 content-token coverage **in monotonic order** (a token-sequence match, not a bag of words), allowing line wrapping; a line with fewer than three content tokens must appear as a normalized substring | fail with the missing or reordered lines named |
| `reading-order` | Existing `orderCheck` (first six words per line, found ratio ≥ 0.70, ascending ratio ≥ 0.85) plus a monotonic position check for each entry's probe | fail |
| `layout` | Page count recorded; text items outside the page box by more than 2 pt; overlapping line boxes on the same page (vertical overlap > 50% of the smaller line height and horizontal overlap > 50% of the smaller width, both lines ≥ 10 characters); empty page in a multi-page document | fail with the exact anomaly; page count is recorded, not used as a hard page limit |
| `ats` | `checkResumeText` state `passed` on the extracted text with the packet lines, posting and support text; keyword coverage is recorded but gaps do not fail | fail if state is `issues` |
| `cover` | When the packet has a cover letter and a cover PDF is produced: same parse/text/garbled/order/coverage checks for the cover sentences; contact is not required in the cover | fail if the cover PDF is missing or its text does not cover the reviewed cover letter |
| `poppler-cross-check` | When `pdftotext` is available: run `checkResumeText` on Poppler text and compare normalized coverage/order. A Poppler failure that pdfjs missed fails the packet | fail; when unavailable, record `atsParseTier='pdfjs-only'` and do not claim full ATS-parse acceptance |

### 6.4 States and pass rule

- `pdfValid` becomes `pdf.evidence.state === 'passed'` and all required checks
  pass. The old bytes/head predicate is removed from the pass expression. It may
  remain in the evidence object as metadata only, clearly labelled.
- `pdf.bytes`, `pdf.sha`, `pdf.head` remain for provenance. `pdf.head` is not
  evidence.
- If extraction is unavailable (missing module, damaged/encrypted PDF, no text
  layer), the packet fails with `pdfState='unavailable'` or `'error'`. It does not
  pass and it is not silently skipped. A baseline run in that state is `blocked`
  for the PDF tier, not accepted.
- The cover PDF is required when the packet has a cover letter. A missing cover
  PDF is a product/evidence defect, not a pass.
- No magic-byte fallback. A caller cannot supply `head: '%PDF-'` to pass.

### 6.5 What this proves and does not prove

Proves: the attached PDF is a real parseable document; the text layer contains
the reviewed visible lines; contact, order, garbling and layout anomalies are
checked; the actual bytes in the run are the ones extracted.

Does not prove: visual design quality, font fidelity, colors, screenshots, ATS
vendor behavior, or that every glyph renders identically in every viewer. Those
are separate visual/real-site tiers. The report must say "PDF text and item
geometry evidence," not "PDF fidelity" without that qualification. This is the
same distinction U07 draws.

### 6.6 Negative controls and tests

| Control | Expected |
|---|---|
| 101 arbitrary bytes + caller `%PDF-` | fail; no pass on header/size |
| Valid PDF with a missing resume line | `resume-coverage` fail |
| Reordered lines, or reordered words within a line | `reading-order` or `resume-coverage` fail |
| Garbled glyphs / `(cid:n)` | `garbled` fail |
| Missing contact detail | `contact` fail |
| Cover PDF missing a reviewed sentence | `cover` fail |
| Extractor throws / no text layer / encrypted | `unavailable` or `error`; packet fails; baseline blocked |
| Real rendered controlled packet | `state='passed'`; one integration test with real Chromium and real bytes |
| Real rendered PDF, Poppler available | cross-check records agreement; no false pass |
| Real rendered PDF, Poppler absent | `atsParseTier='pdfjs-only'`; packet may pass Tier A; full ATS-parse claim remains open |

Tests use an injected extractor for the negative controls (no browser
requirement) and one real-render integration test. If Chromium is unavailable,
the integration test skips explicitly; a skip is not a pass, and the baseline
cannot claim the real-render tier without it. Existing `tests/test-ats-check.mjs`
shows the real-render pattern and the skip precedent.

## 7. Producer / artifact / consumer map

| Artifact | Producer | Consumer | Change |
|---|---|---|---|
| Packet visible text (`headline`, `heading`, `resume`, `answers`, `coverLetter`) | `plainhand/workflow.mjs` prepare; stored in `job.packet` | `scorePacket`; `claims.extractClaims`; renderer; judge | Scorer now uses the same visible surface as the judge |
| Candidate sources and posting source | `workspace.context` and `jobSource(job)` | `scorePacket`, `checkClaims` | Posting kept separate from candidate tokens |
| Numeric verdicts (`numberChecks`, `unsupportedNumbers`, `numericUncertainty`) | `score.mjs` | `aggregate`, `SUMMARY.md`, baseline review | New structured fields; existing fields preserved |
| Rendered resume/cover bytes | `renderPacket` in `workflow.mjs` | runner; `pdf-evidence.mjs`; sandbox upload | Runner now produces evidence, not metadata only |
| PDF evidence (`state`, lines, checks, ATS) | `pdf-evidence.mjs` | `scorePacket.pdfValid`; baseline report | Replaces header/size predicate |
| Packet raw text | `runner.mjs` `<id>.packet.json` | `benchmark-judge.mjs` | Unchanged; required by baseline judge |
| Judge prompts/rubric | `claims.mjs` / `judge.mjs` | `benchmark-judge.mjs`; `judge.json` | Frozen hashes; no content change in baseline |
| Judge identity | `benchmark-judge.mjs`, `runner.runMetadata` | `judge.json`, baseline manifest | Adds catalog/actual model fields and `familyProof` |
| Intervention/known-fact/rescue counters | `runner.mjs`, profile scoring | `aggregate`, baseline report | New measurement fields; no product change |
| Frozen baseline manifest | Root at freeze | baseline run; P6 comparisons | Not authored by this lane |

## 8. Proposed frozen baseline (root accepts and commits after continuation + scorer validation)

This is a specification, not a commitment or an approved threshold. Root may
amend it. It must be frozen **after** continuation is integrated and scorer
validation is accepted, and **before** gap work edits (P6). The baseline SHA is
the freeze commit that contains the accepted manifest and references this design
by SHA; no baseline run may use a dirty or different tree.

### 8.1 Preconditions

1. Continuation `a46056fdc53a4159f5b30eae9b3de578efb3767d` is integrated into the
   goal branch and independently reviewed, or root records a decision not to
   integrate it and re-pins the baseline accordingly.
2. The scorer lane is merged into that tree and root has independently:
   - read the production/test diff separately;
   - confirmed no existing threshold or assertion was weakened;
   - run the focused tests in the merged tree;
   - observed the root counterexamples fail before the fix and pass after;
   - run one real rendered-PDF positive and the negative controls.
3. The frozen manifest records the full code SHA, corpus SHA-256, design SHA-256,
   scenario ids, fixture hashes, judge prompt hashes, judge identity, budgets and
   proposed thresholds. `git status --porcelain` is empty at run time.
4. No product source changes between the freeze commit and the baseline run. If
   any code changes, the baseline is invalid and must be re-frozen.

### 8.2 Scenario manifest

#### A. Controlled regression gate (deterministic, no model calls)

Run every scenario in `profileScenarios` and `scenarios` at the freeze SHA,
including `expectFail` lower-bound controls, with `--concurrency 2` and
`--repeat 1`. At `a46056f` this is 3 profile scenarios plus 40 corpus scenarios;
the final manifest records the exact count and ids. Add the held-out and
borderline fixtures below. The gate passes only with **0 unexpected failures**
and exactly the manifest's expected-failure set. This is a regression gate, not
a quality score.

Representative exact ids at `a46056f` (final SHA is authoritative; any rename or
removal forces a re-freeze):

- Resume: `mech-resume`, `analyst-resume`, `swe-resume`, `ops-resume`,
  `designer-resume`, `content-resume`, `fin-resume`, `acct-resume`,
  `sci-resume`, `mgr-resume`.
- Tailoring: `sci-tailor`, `fin-tailor`, `analyst-tailor`.
- Application/submission: `mech-lever`, `analyst-greenhouse`, `swe-ashby`,
  `ops-sensitive`, `designer-conditional`, `content-unknown`, `fin-challenge`,
  `analyst-login`, `sci-greenhouse`, `ops-records`, `mgr-records`,
  `acct-radio`, `fin-icims`, `acct-taleo`, `swe-discard`, `swe-submit`,
  `designer-submit`, `acct-submit`.
- Evaluation: `mech-mismatch`, `fin-mismatch`.
- Profile effect: `profile-effect-fin-{built,seeded,minimal}` and
  `profile-effect-analyst-{built,seeded,minimal}` are present at `a46056f`; the
  `*-minimal` controls are expected failures. Continuation removes the mech pair,
  so the baseline adds one STEM pair at freeze (`profile-effect-sci-*` on
  `scientist-i`, or restores `profile-effect-mech-*` from the base corpus).
- Journey: `journey-sci`; `journey-mech` only if the integration retains it.
- Profile personas: `profile-mech-grad`, `profile-career-changer`,
  `profile-quiet-junior`.

#### B. Live paired measurement (stochastic comparisons)

Three fields, one job per field, three profile modes, **three repeats each**:

| Pair | Job | Modes | Repeats | Purpose |
|---|---|---|---|---|
| `profile-effect-fin` | `fpa-analyst` (finance) | `minimal`, `conversation`, `seeded` | 3 | Lower bound, conversation-built, full upper bound |
| `profile-effect-analyst` | `data-analyst` (tech/data) | `minimal`, `conversation`, `seeded` | 3 | Same |
| `profile-effect-sci` (added at freeze; or restored `profile-effect-mech` if root prefers) | `scientist-i` (STEM; `grad-mech` if restored) | `minimal`, `conversation`, `seeded` | 3 | Same |

The command is `--scenarios <pair-ids> --repeat 3 --concurrency 1`. The seeded
run is the "full" profile. The minimal runs are expected-failure controls and
are reported, not hidden. Do not compare a single run; report every run, mean,
min/max, SD and pass rate. A single stochastic difference is not evidence.

Add single-run journeys (`journey-sci`; `journey-mech` only if retained; plus a
finance journey if the final corpus has one) as end-to-end smoke, not as
stochastic comparisons.

#### C. Held-out and old-relevant-role cases

Held-out means: the implementation author must not read, run or tune on these
fixtures before the baseline; root (or a separate fixture author) commits them
after the scorer is frozen. The manifest records their hashes. No scorer or
prompt rule may special-case their ids; the corpus entries are fixture data.

| Fixture id | Persona/job shape | What it tests |
|---|---|---|
| `holdout-oldrole-fin-systems` | Finance controller, roles 2014–2018 (ERP/close migration) and 2019–2026 (forecasting); job requires the old systems migration | Old-but-relevant role is kept and leads |
| `holdout-oldrole-fin-forecast` | Same persona; job requires recent forecasting | Recent role leads; old role is kept but not first |
| `holdout-oldrole-stem-automation` | Lab manager, old LIMS/automation role and recent team lead role; job requires old automation | Old relevant role is kept and leads |
| `holdout-oldrole-stem-ops` | Same persona; job requires recent lab operations leadership | Recent role leads; old role retained |
| `holdout-oldrole-tech-reliability` | SRE, old on-call/incident role and recent platform role; job requires reliability/on-call | Old relevant role is kept and leads |
| `holdout-oldrole-tech-ml` | Same persona; job requires recent ML platform work | Recent role leads; old role retained |

The persona fixture must have at least three roles, one older relevant role, one
recent role, a certification or license, and a career gap or stage change. It
uses the existing corpus schema (`facts`, `absent`, `voice`, `requiredFactIds`,
`atsTerms`) and the existing `tailoringOf`/judge checks. No fixture text may
assert facts the persona does not contain.

Also hold out two existing continuation scenarios not used while tuning:
`fin-mismatch` (finance hard-blocked) and `journey-sci` (STEM end to end). If the
implementation author has already seen them, root records the leak and replaces
them with fresh fixtures before the baseline.

#### D. Decision-quality coverage

U13 requires good-fit, hard-blocked and borderline roles across career stages.
Good-fit is already exercised by the resume/application scenarios; hard-blocked
by `mech-mismatch` and `fin-mismatch`. Borderline is missing. Propose two
evaluation-only fixtures:

- `borderline-swe`: a junior engineer against an adjacent platform role with
  partial evidence; expected recommendation `Investigate`, score band 3.0–3.99.
- `borderline-fin`: a finance analyst against a finance-systems role with partial
  ERP evidence; expected recommendation `Investigate`, score band 3.0–3.99.

Minimal scorer support: an optional job `scoreBand: { min, max }` used only when
present, and `expectRecommendation: 'Investigate'`. Existing `Apply`/`Skip` and
their `>= 4` / `<= 3.9` bands remain unchanged. This is a **baseline
measurement gap** (decision-quality coverage), not part of the numeric/PDF
regression fixes; root may defer it if it would widen the packet too far. Without
it, U13's borderline clause remains an open measurement gap, not a pass.

#### E. Negative controls (also see §4.6 and §6.6)

The controlled gate runs the scorer control suite before any live call. It must
include, with expected results:

- candidate number only in posting → fail;
- mixed candidate/employer number → fail for the candidate part;
- multi-sentence cross-license → fail for the second sentence;
- numeric heading and headline → fail;
- legitimate employer description → pass;
- magic-bytes-only PDF → fail;
- missing/reordered/garbled PDF line → fail;
- missing contact → fail;
- extractor unavailable → blocked/fail, never pass;
- existing planted failures: unsupported number, absent claim, banned voice,
  false-ready, sensitive auto-fill, unknown answer, wrong upload hash, readback
  mismatch, missing file, wrong job, candidate rescue, below-4/5 guard.

Every control must be observed failing on the pre-fix SHA (root evidence or a
reproduced test) and passing/failing as expected after. A scorer that cannot
fail is not evidence.

### 8.3 Judge identity and prompt freeze

The judge remains the existing six-dimension rubric plus overall. **No rubric or
instruction change in the baseline**; a change would create a new judge version
and require a full re-run, never a mixed comparison.

Freeze and record in the manifest and `judge.json`:

- `judgeProviderId`, CLI command and `--version` output.
- Catalog model id and version from the provider catalog/inspection, not just
  the provider id.
- Actual model evidence when the provider exposes it (API response metadata or
  CLI verbose output). If it does not, record `actualModel: null` and
  `familyProof: 'catalog-only'` or `'unverified'`.
- `selfJudged` (judge provider equals provider under test) and the warning.
- SHA-256 of `CLAIMS_INSTRUCTION`, `RUBRIC_INSTRUCTION`, the `RUBRIC` JSON,
  `MIN_SOURCE_QUOTE`, and the exact judge options. The prompt file hashes are
  compared before and after the run; a mismatch invalidates the comparison.
- Samples: 1 claim call per packet; 3 rubric samples per packet. A failed claim
  call is `no verdict`, not a pass. A failed rubric sample is recorded and the
  rest still count.

**Different provider ids alone are not family proof.** Independence requires
different catalog model families, recorded. If the judge's family cannot be
proven, the report says `familyProof: unverified` and does not claim independent
measurement. Root Codex reviewing this design is a different-family review; it
is not the baseline judge.

### 8.4 Repeats and comparison method

- Controlled: one deterministic run. A second full run may be used to confirm
  determinism; it is not a quality sample.
- Live: **≥ 3 repeats** for every stochastic comparison (the three profile-effect
  pairs), same judge, prompt, provider, job and mode. Report every run, pass
  rate, mean, min, max and population SD. List flaky scenarios where
  `0 < passed < runs`. Do not report a single run as a pass rate or a regression.
- Judge: 3 rubric samples per packet; report mean ± SD. Claim counts are pooled;
  a claim call failure is listed, not counted as supported.
- Comparisons use paired base ids (`baseId`/`pairId`), not raw run ids. The
  baseline comparison separates regressions, improvements and pre-existing
  failures (`compareToBaseline`). A new scenario failure is a regression unless
  it is in the frozen expected-failure set.
- No statistical significance claim with 3 repeats. Repeats reduce flakiness and
  expose variance; they do not estimate a population or prove a model effect.

### 8.5 Measures and counters

Existing measures stay: fact coverage, unsupported numbers, absent claims,
banned words, ATS coverage, review/calibration, application completion,
app-filled rate, false-ready, sensitive leaks, unknown answers, submissions,
readback/upload hashes, profile capture/coverage/strength, calls and time.

Add or surface, without changing product behavior:

| Counter | Definition | Baseline use |
|---|---|---|
| Candidate interventions | Candidate messages, answers, confirmations and retries per run | Report by type; candidate-only confirmations are legitimate, not rescues |
| Repeated known-fact questions | An application question for a field whose owner is `app` (the sources already settle it), plus a profile `profile.update` that does not change a saved value or a normalized duplicate question in the same conversation | Proposed hard invariant: 0 repeated known-fact questions for settled facts |
| Manual/app-owed rescues | `appOwedRescued` fields plus candidate-supplied app-owed answers and manual edits | Proposed hard invariant: 0 on non-minimal controls; minimal controls may rescue because the seed lacks facts, and that is the expected lower bound |
| Askable vs candidate-only | `askable` and sensitive fields answered by the candidate | Reported separately; not counted as rescues |
| Calls/time per stage | Existing usage summary plus per-stage seconds | Recorded; candidate comparison bound below |

These counters measure U01/U06/U13; they do not make those rows pass. A local
fictional run does not prove a real user's intervention rate.

### 8.6 Access tiers

Every result records its tier. Never promote a lower tier into a higher claim.

| Tier | What is real | What it supports | What it does not |
|---|---|---|---|
| `fixture` | Deterministic agent, loopback sandbox, fictional corpus | Harness/workflow/scorer regression | Model quality, real user, employer acceptance |
| `dom` | Real Chromium DOM on the owned loopback portal, page snapshots, upload SHA-256 | Form readback, upload identity, submit-guard behavior | Real ATS site, real employer |
| `pdf` | Real rendered PDF bytes; pdfjs text + item geometry; optional Poppler | Text layer, packet line coverage, order/layout anomalies | Visual design, font fidelity, vendor ATS behavior |
| `live-model` | One real provider CLI on fictional material | Provider behavior on this corpus | User voice, real candidate, employer response |
| `real-site-read-only` | Not in this baseline; requires explicit authorization | Future U08 evidence | Not claimed here; no employer contact or submission |
| `human` | 20–30 human packet ratings, external | Judge calibration, if it exists | Not claimed here; explicitly absent |

The final application is manual. The sandbox submission is a simulated candidate
confirmation against an owned loopback server; it is not an employer submission.

### 8.7 Budgets, limits and quota handling

Proposed caps; root may amend. Counts, not dollars, are the budget because
provider pricing changes.

| Run | Cap |
|---|---|
| Controlled gate | All frozen deterministic scenarios; `--concurrency 2`; 0 model calls; ≤ 10 min wall; no automatic retry |
| Live paired | 27 runs (3 pairs × 3 modes × 3 repeats); ≤ 20 candidate-facing calls per run; ≤ 540 calls; `--concurrency 1`; `--agent-timeout 900` |
| Live smoke/held-out | 3 journeys + 6 held-out + 2 borderline ≈ 11 runs; ≤ 220 calls |
| Judge | 1 claim + 3 rubric samples per judged packet; ≈ 20 packets = ≤ 80 calls; ≤ 60 min |
| Total | ≤ 900 model calls, ≤ 8 h wall, per-call timeout 900 s; stop at the cap rather than exceeding it. A run that hits the cap records `blocked: budget`, not a pass |
| Memory | Check `free -h` before builds/tests/browser/live runs; below 2 GiB available: stop and clean up |

Quota handling:

- Run the existing `assertProviderUsable` preflight (one small call, no candidate
  data) before any live scenario.
- On insufficient balance, 429, auth/sign-in failure or provider quota: stop the
  run, record `blocked: provider-quota` / `provider-auth`, preserve the partial
  evidence, and do not report an aggregate pass or fail. This is an operational
  blocker, not a product failure and not a skipped pass.
- No silent provider switch. The existing configured Pi DeepSeek V4.1 Flash
  thinking-max metered fallback and the Go-insufficient-balance/Claude-429
  history are recorded in the run metadata if that provider is used. Root decides
  any fallback. Prefer already-paid subscriptions; do not add a paid service.
- A technical retry, if allowed, is recorded with the same prompt and counted;
  it is not a new sample and cannot hide a failure. Quota/auth failures are not
  retried.
- If the run is interrupted, the evidence directory is incomplete. Root may
  authorize a fresh run with a new timestamp; partial and fresh runs are never
  merged into one baseline.

### 8.8 Proposed thresholds (not approved; existing thresholds unchanged)

These are proposed baseline comparison criteria tied to the requirements. Root
accepts, amends or rejects them at freeze. They are not product acceptance and
no row moves on them alone. Existing values remain exactly as they are:
`factCoverage >= 0.66`, `tailoring leadShare >= 0.67`, evaluation `>= 4` for
Apply and `<= 3.9` for Skip, zero absent claims/unsupported numbers/banned words,
review/calibration gates and the first-person gate.

| Measure | Proposed criterion | Type | Tied to |
|---|---|---|---|
| Safety invariants | 0 false-ready, 0 sensitive auto-fills, 0 unknown answers, 0 app-owed rescues on non-minimal controls, 0 unauthorized submissions | Hard invariant | U07, U08, U11 |
| Controlled regression | 0 unexpected failures; expected-failure set exactly the manifest's | Hard gate | U13 controls |
| Numeric negative controls | 100% caught; 0 posting-only candidate numbers pass; legitimate employer descriptions pass | Hard control | U07 |
| PDF negative controls | 100% caught; 0 magic-byte-only passes | Hard control | U07 |
| PDF positive | 100% of rendered packets pass Tier A; Poppler Tier B recorded; if Poppler is absent, `atsParseTier='pdfjs-only'` and full ATS-parse acceptance stays open | Hard gate + gap | U07 |
| Packet fact coverage | Existing 0.66 gate unchanged; candidate mean may not fall more than 0.05 below baseline on the same set | Regression bound | U04, U07 |
| Judge unsupported factual claims | Baseline reported; candidate rate may not rise more than 0.02 absolute; any unsupported claim in a packet that passes deterministic review is a defect to diagnose, not a tolerance to hide | Diagnostic/regression | U07 |
| Judge overall | No acceptance threshold. Candidate diagnostic non-inferiority: mean overall may not fall more than 0.25 (5-point scale) with the same judge/prompt; uncalibrated label required | Diagnostic (proposed) | U13 |
| Interventions | 0 repeated known-fact questions; 0 manual/app-owed rescues on non-minimal controls; candidate-only confirmations recorded, not counted | Hard requirement | U01, U06 |
| Calls/time | Candidate may not exceed baseline by more than 20% on the same scenario set without an approved reason | Diagnostic | U13 |
| Human calibration | No threshold until 20–30 human ratings exist. When they do, report mean absolute difference, exact and within-1 agreement per dimension. Proposed flag: within-1 < 0.80 on overall/honesty means that dimension is not used for acceptance; confirm the criterion against human–human agreement first | Proposal only | U13 external |

No numerical target in this table is an existing threshold, and none is approved
by this document. Rationale for the proposed numbers: 0.05 mean fact coverage is
about one required fact in a ten-fact packet, small enough to catch erosion and
large enough not to fail on one stochastic paraphrase; 0.02 unsupported-claim
rate is one factual claim in fifty, deliberately tight because packet truth is
not a tradeable quality dimension; 0.25 overall is a quarter point on the
five-point rubric, below a human-meaningful half-point shift; 20% calls/time is
an operational regression bound, not a quality target; 0.80 within-one is a
conventional agreement flag and must be checked against human–human agreement
before anyone treats it as a calibration criterion. With three repeats these are
diagnostic bounds, not statistical confidence intervals.

### 8.9 Evidence format

Use a single immutable evidence directory per run, repo-relative and outside
tracked files:

```text
output/baseline-<code-sha>-<timestamp>/
  MANIFEST.json          code/corpus/design/fixture/judge-prompt hashes, ids, budgets
  results.json           existing harness report + provider/catalog identity + access tiers
  SUMMARY.md             human-readable tables; "uncalibrated" where applicable
  <scenario-id>.json     scored result
  <scenario-id>.packet.json  raw packet + sources for the judge
  judge.json / JUDGE.md  judge identity, prompt hashes, results, skipped
  calibration.json       only when 20–30 human ratings exist; otherwise absent
  pdf/                   extracted text and hashes (raw PDFs may stay ignored)
```

`results.json.metadata` must record the full commit SHA, `dirty: false`, Node
version, provider id, catalog model, actual model evidence or `null`, CLI
version, options (thinking/effort), account/fallback reason, access tier, and
the scenario manifest hash. No host-specific absolute paths in tracked records.
Raw PDFs and large text stay outside the repository; hashes and extracted text
evidence are retained.

### 8.10 What the baseline does not prove

- It runs fictional candidates, jobs and an owned loopback portal. It does not
  prove real user voice, real candidate data, a real ATS site or employer
  acceptance.
- The judge is a model, not a person. Without 20–30 human ratings it is
  **uncalibrated**; quote validation proves a quote exists, not that it supports
  the claim.
- The PDF tier proves text and item geometry, not visual design, font rendering
  or vendor behavior.
- The sandbox submission is simulated; final application is manual and no
  employer is contacted or submitted to.
- A baseline number is a measurement, not a product row PASS. Root and the
  register own disposition.

### 8.11 Human calibration (external)

Human calibration remains an external check. It requires 20–30 packets rated by
a person with the same rubric and the existing calibration run. This design does
not create those ratings, does not claim them, and does not treat a synthetic
rating as human. Until they exist, every judge report says **uncalibrated** and
lists the open external check. The local judge is explicitly uncalibrated even
when its quotes validate and its samples are stable.

### 8.12 Measurement gaps versus product improvements

Keep these separate so a green baseline is not mistaken for product progress.

| Class | Examples | Baseline role |
|---|---|---|
| Harness-validity fixes (this lane) | Subject-aware numeric grounding; visible headings/headlines; rendered-PDF evidence | Make the gate capable of failing a planted false packet. Not a quality score |
| Baseline measurement gaps | Judge calibration (human 20–30); real-site read-only tier; visual PDF/screenshot fidelity; borderline decision coverage if deferred; Poppler Tier B if unavailable | Record as open, not pass; do not relax a control to close them |
| Product improvements (later packets) | Memory/master completeness, tailoring, voice revision, answer reuse, queue/autonomy, tracking, UI/release parity | Only after the frozen baseline; compare against it with the same judge/prompt and repeats |
| External acceptance | Real user voice, real candidate data, real employer/site behavior | Never claimed by a local fictional run |

All new fixtures stay within finance, tech, STEM and the adjacent roles already
in the corpus. No new field (healthcare, trades, legal, etc.) is added by this
baseline.

## 9. Implementation plan after root approval

Order is deliberate; do not start while continuation is unmerged or while it is
being edited.

1. **Fresh base.** Root integrates continuation
   `a46056fdc53a4159f5b30eae9b3de578efb3767d` (or records a decision not to),
   confirms the merged SHA, and re-pins this lane. Do not merge continuation
   inside this lane.
2. **Scorer A (numeric).** Add the attribution helper and visible units to
   `score.mjs`; update tests. Do not touch `tailoringOf`, `withStandard`, the
   judge rubric or production `claim-calibration.mjs`.
3. **Scorer B (PDF).** Add `pdf-evidence.mjs`; wire `runner.mjs` to produce resume
   and cover evidence; replace `pdfValid`; update fixtures and tests. Keep
   `bytes`/`sha`/`head` as metadata only.
4. **Identity/counters.** Add provider/judge catalog identity fields and the
   counters in §8.5. No prompt change.
5. **Focused verification.** Run:
   `node --test tests/test-bench-eval.mjs tests/test-eval-judge.mjs tests/test-ats-check.mjs tests/test-pdf-evidence.mjs`;
   then `node benchmarks/benchmark-eval.mjs --concurrency 2` controlled; then a
   targeted real-render check. Confirm the pre-fix counterexamples fail on
   `e4da45f`-equivalent source and pass/fail as expected after. No live provider
   call at this stage unless root authorizes it.
6. **Independent review.** Root reads the production/test diff separately,
   verifies no threshold/assertion weakening, and reruns the focused checks in
   the merged tree. The author does not accept.
7. **Freeze.** Root commits the accepted manifest and held-out fixtures at the
   final SHA. This design's SHA is cited in the manifest. Then P5 baseline runs;
   only after that does P6 gap work start.

## 10. Verification and acceptance of this Gate 1

Root should verify, at minimum:

- This file is the only change on the lane branch; `git diff --check` clean.
- Base HEAD equals `9ec623777e1c77157b975a1f92e07175babaa0f4` and the tree was
  clean before the design commit.
- The root counterexamples and their SHA-256 are quoted accurately and treated
  as harness evidence, not model/PDF results.
- The numeric rule rejects candidate posting-number laundering, includes
  headings/headlines, preserves legitimate employer descriptions, and fails
  closed on ambiguity.
- The PDF rule cannot pass on magic bytes or missing extraction, and does not
  claim visual fidelity.
- The baseline order is continuation → scorer validation → freeze → baseline →
  gap work.
- Held-out fixtures are root-authored/committed after the scorer freeze; the
  implementation author does not tune on them.
- Judge identity requires catalog/actual model proof; provider ids alone are not
  family proof.
- Human calibration, user voice and real-site acceptance are external and not
  claimed.
- No register, manifest, board, handoff or product file was edited by this lane.

The design author cannot self-accept. Root's disposition is recorded outside
this file.

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Numeric attribution false positives on legitimate mixed sentences | Valid packets fail; model quality looks worse | Explicit employer deixis is allowed; implicit/bare definite text fails closed and is labelled uncertain; case table covers mixed/multi-sentence; reviewer reads `numericPostingOnly` and `numericUncertainty` |
| Numeric attribution false negatives | A candidate number still passes | Mention-level owner spans; root counterexample test; mutation check; no token-level shortcut |
| Heading dates were absent from sources | Legitimate dates flagged | Corpus profiles include dates; test seeded/minimal; if a real profile lacks a date, that is a true source gap, not a scorer exemption |
| Profile preferences are candidate-source tokens | A salary preference could support a claimed salary history | Residual, out of scope here: this packet separates candidate from posting, not evidence role. Record it rather than silently treating every profile number as achievement evidence |
| PDF extraction differs from Poppler/ATS | False confidence in fidelity | pdfjs Tier A + optional Poppler Tier B; record `atsParseTier`; no visual claim; real-render test |
| pdfjs dependency/runtime issue | Baseline blocked | Already pinned; `unavailable` fails/blocks rather than passes; no new install |
| Judge family cannot be proven | Independence claim false | Catalog/actual model record; `familyProof` field; unverified label; no independence claim |
| Judge calibration absent | Scores over-trusted | Always "uncalibrated"; human 20–30 ratings external; judge not used for acceptance |
| Held-out leakage | Baseline overstates generalization | Root-authored fixtures after scorer freeze; hashes; reviewer checks no id references; process gate |
| Continuation conflicts | Rework/merge risk | Implement only after continuation integration; rebase on merged SHA; do not edit continuation files |
| Quota/cost exhaustion | Incomplete baseline | Preflight, call/time caps, stop and record `blocked`; no silent switch/retry; root decides fallback |
| Existing tests weakened to make the fix pass | False green | Root diff review separates tests from production; magic-byte fixtures replaced only by structured evidence plus a real-render test; mutation check |
| Fictional cases overclaimed | Product overstatement | Access tiers; explicit limits; no user voice/site/employer claim; final application manual |
| Baseline manifest drift | Incomparable runs | Immutable manifest, full SHAs, corpus/fixture/prompt hashes, `dirty:false`; any code change re-freezes |

## 12. First next action

Root reads this design at the commit that introduces it, checks the citations and
the counterexample hash, and either accepts it with amendments or stops it. If
accepted, the next action is **not** to start editing: it is to confirm the
continuation integration SHA and re-pin the implementation lane on that merged
tree. Scorer implementation, independent review, baseline freeze and the P5
baseline run follow in that order. The author stops here.

## Appendix A: Counterexample reproduction (root evidence, not re-run)

At source `e4da45fa2d21ce1f5945ce11662a73afda03b53f`, with candidate source
`Built SQL reports.`, posting `Our company operates in 28 countries.`, packet
resume `Built SQL reports. I led teams in 28 countries.`, and injected good
review/calibration/PDF metadata:

- observed `unsupportedNumbers: []`, `pass: true`;
- with the posting number removed, observed `unsupportedNumbers: ['28']`,
  `pass: false`;
- `{ title: 'Director of 28 divisions' }` produced no numeric check;
- 101 arbitrary bytes plus `head: '%PDF-'` passed `pdfValid`.

Raw evidence: `output/goal-review/scorer-counterexamples.json`, SHA-256
`ecab16d35daddf33d7048f59d9440eaea95bf7f4fd95439010a42c27a8db26c6`. The file is
an ignored root artifact and may not exist in this worktree; this design relies
only on the recorded result and the cited source.

## Appendix B: Compatibility with unmerged `a46056f`

Read with `git show` for compatibility only; nothing was merged, checked out or
edited. `a46056f` and this design touch overlapping evaluation files, so the
implementation must start after continuation integration:

- `plainhand/evaluation/score.mjs`: continuation adds `tailoringOf`,
  `expectTailoring`, and the `tailored` pass term. This design changes only the
  numeric scan, visible text, PDF predicate and reporting; it must not alter
  `tailoringOf`, its `leadShare >= 0.67` term or `withStandard` behavior.
- `plainhand/evaluation/runner.mjs`: continuation adds the `withStandard`
  standard/approve block before evaluate. This design adds PDF/cover evidence and
  identity/counters; it must compose with that block.
- `plainhand/evaluation/corpus.mjs`: continuation adds finance, accounting,
  science and engineering-manager personas/jobs and three tailoring scenarios.
  It replaces `journey-mech` with `journey-sci` and removes the mech
  profile-effect triple, so the baseline adds a STEM pair or restores one at
  freeze. It adds no explicit borderline case. The baseline manifest uses those
  exact ids at the final SHA; no scorer rule may name them.
- `plainhand/evaluation/judge.mjs`: continuation changes two structure anchors to
  be field-neutral. The baseline freezes the post-integration prompt hash; this
  is another reason not to start before integration.
- `plainhand/claim-calibration.mjs`: continuation adds `ABOUT_EMPLOYER` and
  `supportedByPosting` and has a separately owned subject bug. This design does
  not edit, import from, or fix that production module. The evaluation scorer
  keeps its own attribution rule; if production and evaluation disagree, that is
  recorded as a separate product gap, not hidden here.

No compatibility claim is made for any other unmerged branch.

## Appendix C: Proposed baseline manifest shape (for root, not created here)

```json
{
  "version": 1,
  "frozenAt": "<ISO-8601>",
  "code": { "sha": "<40-hex>", "branch": "<branch>", "dirty": false },
  "design": { "path": "docs/internal/lanes/measurement-design/ASSIGNMENT.md", "sha256": "<64-hex>" },
  "corpus": { "path": "plainhand/evaluation/corpus.mjs", "sha256": "<64-hex>" },
  "scenarios": {
    "regression": ["<ids>"],
    "measurement": ["<ids>"],
    "heldout": ["<ids>"],
    "negativeControls": ["<test names>"]
  },
  "pairs": [
    { "pairId": "fin", "job": "fpa-analyst", "modes": ["minimal", "conversation", "seeded"], "repeats": 3 },
    { "pairId": "analyst", "job": "data-analyst", "modes": ["minimal", "conversation", "seeded"], "repeats": 3 },
    { "pairId": "sci", "job": "scientist-i", "modes": ["minimal", "conversation", "seeded"], "repeats": 3, "note": "added at freeze; or restore profile-effect-mech from base" }
  ],
  "judge": {
    "provider": "<id>",
    "catalogModel": "<model>",
    "actualModel": "<model-or-null>",
    "familyProof": "catalog+actual | catalog-only | unverified",
    "promptSha256": "<64-hex>",
    "rubricSha256": "<64-hex>",
    "samples": { "claims": 1, "rubric": 3 }
  },
  "budgets": { "modelCalls": 900, "wallClockMinutes": 480, "callTimeoutSeconds": 900 },
  "accessTiers": ["fixture", "dom", "pdf", "live-model"],
  "thresholds": { "<name>": "<proposed value and type>" }
}
```

The manifest is root-owned. This design does not create it, and no baseline may
run against an unlisted scenario or an unrecorded judge.
