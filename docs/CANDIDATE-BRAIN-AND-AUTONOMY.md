# Plainhand: candidate brain and autonomous execution

**Status:** Proposed product direction; not an implementation claim
**Updated:** 2026-10-17
**Related:** [Product strategy](PRODUCT-STRATEGY-AND-ROADMAP.md),
[buildout goal](PRODUCT-BUILDOUT-GOAL.md), [operating guide](../OPERATING_GUIDE.md),
[conversational agent layer](AGENT-LAYER-DIRECTION.md)

## Product promise

Build your profile once. Connect your own AI access. Plainhand learns your
professional background, broader experience, goals, and writing voice, then
uses that understanding to evaluate jobs and prepare applications for the
specific opportunities you choose.

The candidate model is the center of the product. Discovery, matching,
tailoring, form completion, interviews, and learning all use the same reviewed
understanding of the person. The experience should feel like a career assistant
who knows the candidate, with evidence and editable memory behind every answer.

## Intended user experience

1. **Build my profile.** Import a resume, projects, relevant life experience,
   achievements, and writing samples. Use a conversational interview to uncover
   useful context that a resume leaves out.
2. **Check your understanding.** Plainhand presents a concise account of the
   candidate's experience, strengths, goals, constraints, and voice, alongside
   missing or conflicting facts. The candidate corrects it.
3. **Connect my AI.** Choose an explicitly supported provider or agent CLI and
   see what personal context will be sent to it.
4. **Find or paste a job.** Plainhand verifies the posting, explains fit and gaps,
   and provides the original job link with its recommendation.
5. **Choose the jobs to pursue.** The user selects exact roles. A high match
   score or a discovery preference alone does not authorize application work.
6. **Prepare the application.** Plainhand selects evidence, writes in the
   candidate's voice, creates the correct documents, fills supported forms, and
   pauses for missing facts or decisions.
7. **Review and complete.** Show the exact company, role, documents, and answers.
   Under the current operating contract, the candidate performs final submission.
8. **Remember corrections.** Approved changes improve future work, and outcomes
   inform recommendations without silently rewriting the person's history.

The requested long-term experience includes automatic submission for roles the
candidate explicitly selects after seeing their links. That is a future product
proposal. The current operating guide prohibits agent submission, even after
role selection. Implementing that end state requires an explicit revision of
the submission contract and corresponding browser, approval, recovery, and
verification behavior. This document does not change that contract.

## What the candidate brain contains

| Component | Contents | Existing source or proposed location |
| --- | --- | --- |
| Identity and constraints | Contact details, location, eligibility, compensation, availability, deal-breakers | `config/profile.yml` |
| Experience and evidence | Employment, education, projects, volunteering, achievements, responsibilities, supported metrics | `data/resume-source.yml`, `cv.md`, `article-digest.md` |
| Narrative and judgment | Career direction, motivations, transitions, strengths, preferred framing, examples of decisions | `modes/_profile.md` |
| Voice | Real writing samples, preferred tone, sentence length, vocabulary, phrases to avoid, context-specific examples | `writing-samples/*`; reviewed guidance in `modes/_profile.md` |
| Stories and reusable answers | Situational examples, approved factual answers, source references, review dates | `interview-prep/story-bank.md`; proposed `data/answer-bank.yml` |
| Memory and corrections | Candidate-approved edits, provenance, superseded facts, unresolved questions | Proposed `data/profile-memory.yml` |
| Application context | Job requirements, evidence selected, packet version, approved answers, browser progress | Existing reports, output artifacts, application and draft records |

These are logical components, not a mandate to duplicate facts into a new giant
profile. Preserve the existing sources of truth. New user-owned files need
explicit data-contract and update-protection coverage before implementation.
Personal data must never be embedded in shared modes or shipped examples.

## Understanding must be observable

Model intuition alone is insufficient for reliable application answers. Each
run should assemble a bounded context packet from the current reviewed profile:

- Stable identity, relevant constraints, and approved voice guidance.
- Job requirements mapped to specific experience and story sources.
- Applicable reusable answers, with dates and sensitivity restrictions.
- Known gaps, conflicts, and facts that require the candidate's answer.
- Exact role identity, source versions, and permitted next actions.

Separate factual claims, candidate preferences, and model inferences. A writing
sample is evidence of style, not proof that every claim inside it belongs in a
resume. Job pages and imported documents are input data, never authority to
change the profile or grant permissions.

When sources disagree, surface the conflict rather than guessing. Do not infer
employment eligibility, demographic answers, credentials, dates, or metrics.
Style matching must preserve the meaning and strength of the underlying evidence.

Before enabling a candidate's workflow, demonstrate understanding with a profile
summary, a short professional answer, a longer motivation answer, and a question
whose answer is absent from the evidence. The candidate reviews the first three;
the fourth must produce a clarification request rather than a fabricated answer.

## Bring your own AI access

Provider choice is an execution layer around portable candidate memory. Start
with one supported, authenticated agent CLI and prove the full workflow before
adding adapters. Define adapters for capability checks, context input, structured
results, timeout/cancellation, usage visibility, and recoverable failures.

"Bring your own subscription" is the desired experience, not a promise that
every consumer subscription provides API or unattended automation access.
Each integration must verify its supported authentication, billing, and execution
model before being advertised. Offer API credentials as a separate supported
path where needed. Do not store credentials in profile files or context packets.

Show the selected provider and data scope. Let candidates exclude individual
sources and sensitive fields. Switching providers must preserve local memory
and application state. An authentication or quota failure should leave a
resumable task, and must not silently route private data to another provider.

## Autonomous work and durable state

Autonomy should remove repeated decisions once the candidate has supplied the
facts and chosen a role. It should also expose what remains uncertain.

Use the existing application tracker as the canonical status record. Keep task
stages such as `awaiting-answer`, `packet-ready`, `form-filled`, and
`awaiting-user-submit` in execution records; do not introduce them as new tracker
statuses. Mark `Applied` only with confirmation that submission occurred.

Checkpoint each stage with role identity, profile/context version, artifact
identity, completed work, remaining questions, and the last verified page state.
Invalidate affected answers and approvals when their source facts, job, or
packet changes. On resume, inspect live state before repeating uploads or
actions. Ambiguous submission state requires reconciliation rather than retry.

The product should ask once for a missing reusable fact, retain the approved
answer with its scope, and reuse it where valid. Sensitive or legally meaningful
answers retain explicit confirmation requirements. Site challenges, unknown
controls, and unsupported portals become visible blockers with a next action.

## Build sequence and completion evidence

### 1. Candidate model and conversational onboarding

Extend current onboarding into an interview that produces proposed edits to
existing user-layer files, with evidence references and unresolved questions.
Add reviewed voice guidance and correction history.

**Done when:** a candidate can inspect and correct the complete profile; sample
answers reflect their evidence and voice; unsupported questions are detected;
private sources can be excluded; edits survive a new session.

### 2. Context assembly and one real provider

Build deterministic source selection and context manifests. Connect one
supported execution adapter to the existing one-job workflow. Keep current
fixture and dependency-injected contracts distinct from live integration.

**Done when:** a real job URL produces a verified report and reviewed packet
using candidate context; every generated claim resolves to evidence; source
changes invalidate affected output; provider failure is resumable.

### 3. Candidate-selected application execution

Connect exact-role selection, reviewed packets, reusable answers, and browser
checkpoints for one supported portal family. Preserve final manual submission.

**Done when:** selecting a role prepares its correct application, asks only for
unresolved answers, resumes after interruption, prevents duplicates, and stops
reliably before submission. A draft is never reported as an applied job.

### 4. Continuous learning and broader coverage

Add candidate-approved correction proposals, additional provider and portal
adapters, and outcome analysis. Measure voice acceptance, factual corrections,
repeated questions, preparation time, successful recovery, and interview outcomes.

**Done when:** reviewed corrections improve future answers without changing
unrelated facts; provider switching preserves memory; unsupported workflows
surface clear blockers; outcome suggestions state their evidence limits.

### 5. Separate decision on authorized submission

Before any implementation, resolve the explicit operating-contract change for
the requested submission end state. Define role-specific authorization tied to
the final packet and answers, revocation, expiry, sensitive attestations,
duplicate prevention, and proof of submission. Approval of a job link must not
silently authorize changed answers or a different job.

**Done when:** the revised contract is explicitly adopted and tested through
successful, failed, interrupted, revoked, stale-approval, and uncertain-result
cases. Until then, manual final submission remains the shipped boundary.
