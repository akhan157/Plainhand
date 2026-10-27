# Artifact Contract

Date: 2026-06-19
Scope: per-job resume, cover-letter, and answers artifacts used by `career-ops`
tailoring and apply-mode resolution.

This contract is the implementation target for the resume-tailoring,
cover-letter-tailoring, apply-mode-integration, and verification-regression
lanes. They must implement against this interface instead of inventing their
own file naming, resolver rules, or fallback behavior.

## Purpose

The `career-ops` system produces per-job artifacts during `TAILOR` and consumes
them during `APPLY`.

This contract defines:
- which artifact types exist
- how they are named
- what metadata each artifact must carry
- when an artifact is considered stale
- how apply mode resolves an exact artifact
- when the system must block instead of guessing
- what minimal verification must prove

## Non-Negotiables

1. `output/Resume-latest.pdf` is the source baseline, never the default upload
   target.
2. Same-company wrong-role artifacts do not count.
3. Apply mode must resolve an exact artifact or stop.
4. Final submission remains manual.

## Artifact Types

### 1. Per-job resume

Purpose:
- the exact resume artifact intended for one company + one role
- the default upload target for apply mode only when it resolves exactly

Canonical path:
- `output/cv-{candidate}-{company-slug}-{role-slug}-{artifact-date}.pdf`

Companion metadata path:
- `output/cv-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md`

### 2. Per-job cover letter

Purpose:
- the exact cover letter artifact intended for one company + one role
- used when a portal requests a cover letter or when the candidate wants one

Canonical paths:
- `output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.html`
- `output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.pdf`

Companion metadata path:
- `output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md`

### 3. Per-job answers file

Purpose:
- the role-specific answer bundle derived from the report, answer bank, and
  role context
- the artifact apply mode should use for long-form answer resolution before
  mutating prose in-session

Canonical path:
- `output/answers-{candidate}-{company-slug}-{role-slug}-{artifact-date}.md`

Companion metadata path:
- `output/answers-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md`

## Shared Identity Fields

Every artifact above is keyed by the same identity tuple:

- `candidate`
- `company_slug`
- `role_slug`
- `artifact_date`

Definitions:
- `candidate`: lowercase kebab-case candidate identifier derived from
  `config/profile.yml`
- `company_slug`: normalized company identifier used consistently across
  report/output/apply resolution
- `role_slug`: normalized role identifier specific enough to distinguish
  different reqs at the same company
- `artifact_date`: generation date in `YYYY-MM-DD`

Normalization rules:
- lowercase ASCII
- words separated by single `-`
- remove punctuation that does not affect identity
- normalize repeated whitespace/dashes
- preserve meaningful role distinctions such as `electrical-engineer` vs
  `field-engineer` vs `engineer-trainee`

## Exact Naming Schema

Exact filenames:

```text
Resume PDF:
output/cv-{candidate}-{company-slug}-{role-slug}-{artifact-date}.pdf

Resume metadata:
output/cv-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md

Cover letter HTML:
output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.html

Cover letter PDF:
output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.pdf

Cover letter metadata:
output/cover-letter-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md

Answers file:
output/answers-{candidate}-{company-slug}-{role-slug}-{artifact-date}.md

Answers metadata:
output/answers-{candidate}-{company-slug}-{role-slug}-{artifact-date}.meta.md
```

Notes:
- resume naming is mandatory for apply-mode resolution
- cover-letter HTML and PDF may both exist for one identity
- answers files are markdown artifacts, not tracker notes
- metadata files are system-readable contract files; they are not optional once
  the new pipeline is implemented

## Required Metadata Fields

Each `.meta.md` file must contain frontmatter with these required fields:

```yaml
artifact_type:
candidate:
company:
company_slug:
role:
role_slug:
artifact_date:
generated_at:
source_baseline:
job_source:
job_source_type:
report_path:
report_id:
jd_fingerprint:
content_fingerprint:
generator:
generator_version:
status:
```

Required field meanings:
- `artifact_type`: `resume` | `cover_letter` | `answers`
- `candidate`: normalized candidate slug
- `company`: human-readable company name
- `company_slug`: normalized company slug
- `role`: human-readable role title
- `role_slug`: normalized role slug
- `artifact_date`: `YYYY-MM-DD`
- `generated_at`: ISO timestamp of artifact generation
- `source_baseline`: for resumes, must reference `output/Resume-latest.pdf` or
  the actual canonical tailoring baseline used; this records provenance, not an
  upload fallback
- `job_source`: original job URL or JD source path
- `job_source_type`: `url` | `jd_file` | `manual`
- `report_path`: matching report path under `reports/`
- `report_id`: the report identity, typically report number or filename stem
- `jd_fingerprint`: stable fingerprint of the job description content used
- `content_fingerprint`: stable fingerprint of the artifact content or
  structured inputs used to build it
- `generator`: script or mode that produced the artifact
- `generator_version`: implementation version, commit, or equivalent build id
- `status`: `ready` | `stale` | `superseded` | `blocked`

Value validation rules:
- `artifact_date` must be a real `YYYY-MM-DD` calendar date
- `generated_at` must be a parseable ISO timestamp
- `job_source_type` must be exactly `url`, `jd_file`, or `manual`
- `status` must be exactly `ready`, `stale`, `superseded`, or `blocked`
- metadata identity values must exactly match the filename identity, not merely
  resemble it

Additional required fields by artifact type:

### Resume metadata must also include

```yaml
page_count:
template_id:
format:
```

### Cover-letter metadata must also include

```yaml
variants:
```

Where `variants` lists the emitted formats, such as `html` and `pdf`.
It must be a non-empty array.

### Answers metadata must also include

```yaml
answer_sources:
```

Where `answer_sources` records which inputs were used, such as report Section G,
`data/application-answers.md`, or `cv.md`.
It must be a non-empty array.

## Relationship To Reports, Tracker, And Output

### Reports

- A per-job artifact must point back to exactly one matching report through
  `report_path` and `report_id`.
- The report remains the evaluation source and the first role-specific prose
  source, especially Section G.
- An artifact without a matching report is incomplete unless the system
  explicitly supports a no-report path later. This contract does not define
  that later path.

### Output directory

- `output/` is the canonical storage location for all generated per-job
  artifacts.
- Apply mode resolves artifacts from `output/` plus metadata, not from ad hoc
  temp files.
- Generic files in `output/`, including `output/Resume-latest.pdf`, are not
  exact-match apply artifacts unless a future contract explicitly says so.

### Tracker

- `data/applications.md` remains the canonical one-row-per-company+role spine.
- The tracker identifies that a tailored resume exists, but does not replace
  exact artifact resolution.
- Tracker signals may narrow the search space, but they cannot authorize a
  same-company wrong-role upload.
- Apply mode should use tracker identity plus report identity plus output
  metadata together. One source alone is not sufficient when ambiguity exists.

## Freshness And Staleness Rules

An artifact is `ready` only when all of the following hold:

1. The identity tuple matches the exact target company and role.
2. The artifact has required metadata.
3. The referenced report exists.
4. The artifact is not superseded by a newer exact-match artifact for the same
   identity.
5. The job description fingerprint and report context have not drifted in a way
   that invalidates the artifact.

An artifact becomes `stale` when any of the following is true:

1. The JD changed materially and the `jd_fingerprint` no longer matches the
   current job content being used for apply.
2. The report changed materially after artifact generation.
3. A newer exact-match artifact exists for the same artifact type, candidate,
   company slug, and role slug.
4. Required metadata is missing or incomplete.
5. Required metadata values are malformed or outside the allowed enums.
6. The artifact points to a missing report or missing source path.

An artifact becomes `superseded` when:
- a newer exact-match artifact of the same type exists and the older one is
  retained only for history

Freshness precedence:

1. newest `ready` exact match wins
2. `stale` exact match does not auto-upload
3. `superseded` exact match does not auto-upload
4. ambiguous freshness means stop and report

## Exact-Match Resolution Rules For Apply Mode

Apply mode resolves artifacts in this order:

1. Resolve the exact target identity from:
   - live application page
   - tracker row
   - matching report
2. Normalize `candidate`, `company_slug`, and `role_slug`.
3. Search `output/` for artifacts whose filenames match the exact naming
   schema.
4. Read metadata for each exact filename candidate.
5. Keep only artifacts whose metadata also exactly matches:
   - `artifact_type`
   - `candidate`
   - `company_slug`
   - `role_slug`
   - `report_path` or `report_id`
6. Reject candidates whose metadata is malformed, including invalid
   `artifact_date`, invalid `generated_at`, invalid `job_source_type`, invalid
   `status`, or invalid per-type arrays.
7. Discard any same-company wrong-role artifacts.
8. Discard any artifacts marked `stale`, `superseded`, or `blocked`.
9. If exactly one `ready` artifact remains, resolve it.
10. If multiple `ready` exact matches remain, select the newest by valid
    `generated_at`.
11. If ties, conflicting metadata, or unresolved same-company multi-role
    collisions remain, stop as ambiguous.

Per artifact type:

### Resume resolution

- exact match is mandatory before upload
- if no exact ready resume exists, apply mode may trigger generation through the
  resume pipeline
- if generation is unavailable or fails, stop
- apply mode must never silently upload `output/Resume-latest.pdf`

### Cover-letter resolution

- exact match is required only when the portal or candidate requires a cover
  letter
- if no exact ready cover letter exists, the system may generate one
- if cover letter is optional and absent, apply mode may proceed without one
- a generic cover letter is not an automatic fallback

### Answers resolution

- exact match is the preferred source for role-specific long-form answers
- if no exact answers artifact exists, apply mode may synthesize answers from
  the matching report plus `data/application-answers.md` plus `cv.md`
- that synthesis must be treated as in-session generation, not resolution of an
  existing artifact
- a generic answers artifact from another role does not count

## Ambiguity And Blocker Behavior

Apply mode must stop and report a blocker when any of the following happens:

1. Company identity is unclear.
2. Role identity is unclear.
3. More than one role slug plausibly matches the same live role.
4. Same-company artifacts exist but all are for the wrong role.
5. Multiple same-company role slugs remain plausible for the live role and the
   system cannot prove which one is exact.
6. Filename and metadata disagree.
7. Metadata values are malformed even if all required fields are present.
8. The newest filename candidate is stale or superseded and no ready exact match
   remains.
9. The report and output identities disagree.
10. Required metadata is missing.
11. The tracker row points to a role identity that conflicts with the live page.

Blocker reporting must say:
- what artifact type was needed
- the exact company and role being resolved
- what candidates were found
- why each candidate was rejected
- whether generation is possible next

## Allowed And Forbidden Fallbacks

### Resume

Allowed:
- exact ready per-job resume
- generate a new exact per-job resume

Forbidden:
- silent fallback to `output/Resume-latest.pdf`
- same-company wrong-role resume
- stale or superseded resume
- generic resume from another company

### Cover letter

Allowed:
- exact ready per-job cover letter
- generate a new exact per-job cover letter
- skip only when the portal does not require one and the candidate does not want
  one

Forbidden:
- silent fallback to a generic cover letter
- same-company wrong-role cover letter
- stale or superseded cover letter when an exact current artifact is required

### Answers

Allowed:
- exact ready per-job answers artifact
- in-session synthesis from the matching report, answer bank, and CV when no
  exact answers artifact exists yet

Forbidden:
- copying another role's answers artifact as if it were exact
- using stale answers artifact without surfacing staleness

## Minimal Verifier Expectations

The verification lane must at minimum prove:

1. filenames follow the exact schema for all three artifact types
2. resume artifacts never resolve to `output/Resume-latest.pdf` by default
3. same-company wrong-role artifacts are rejected
4. metadata files exist for contract-managed artifacts
5. metadata contains required identity and provenance fields
6. metadata value validation rejects malformed dates, timestamps, enums, and
   per-type arrays
7. stale or superseded artifacts are not treated as ready
8. apply-mode resolution selects the newest ready exact match only
9. cover-letter absence is allowed only when the role does not require one
10. answers resolution distinguishes exact artifact reuse from in-session
   synthesis
11. ambiguity produces a blocker, not a guess

The verifier does not need full content-quality judgment to satisfy this
contract. It does need identity, freshness, and blocker-path coverage.

## Worker Boundary Notes

### Artifact-contract lane

- owns this document and minimal supporting doc references
- does not implement generators or verifiers

### Resume-tailoring-engine lane

- must emit resume filenames and metadata exactly as defined here

### Cover-letter-tailoring lane

- must emit cover-letter filenames and metadata exactly as defined here

### Apply-mode-integration lane

- must consume this resolver contract exactly
- must stop on ambiguity instead of inventing fallback logic

### Verification-regression lane

- must verify this contract directly
- must not redefine naming or freshness rules in code comments alone
