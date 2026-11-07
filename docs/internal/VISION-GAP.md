# From today to the envisioned product

**Status:** gap analysis, 26 October 2026
**Within:** [Product buildout goal](PRODUCT-BUILDOUT-GOAL.md) · follows the [next build plan](NEXT-BUILD-PLAN.md)

## The product, in the owner's words

Plainhand builds a **mini version of the user**, from conversations, stories
and writing samples, that knows their experience, their voice, their taste
and where they draw the line. From one **standard resume and cover letter** it
produces a version per application, either by talking it through or on its
own because it knows them well enough. It **navigates the common job sites and
fills the applications**, answering the standard questions and **tagging what
it can't answer** so the final check is quick. The user critiques, decides and
**submits every application themselves**. The result: high-quality,
accurate applications without the tedium.

## Where each part stands

| Part of the vision | Today | What stands in the way |
| --- | --- | --- |
| **1. The mini-me profile** | Strong. Conversational intake (benchmark: 13 of 13 revealed facts captured in the user's words, nothing invented); stories; reviewed understanding; profile strength; wording line learned from choices; reusable answer bank; corrections | **Writing samples**: voice is one text field, not learned from several real samples. **Taste** beyond wording (length, tone, structure, which stories lead) is not learned at all, because there is nothing to learn it from yet (see 2) |
| **2. One standard resume and cover letter, varied per application** | Each packet is drafted from scratch per job. The resume builder (`resume-tailoring-lib.mjs`) has a base resume and role-family tailoring, but only on the command line | **No standard documents** the user approves once. **No conversational revision** of a packet ("shorten the second bullet", "lead with the pump project"); the only option is regenerate. **No autonomy dial**: roles can be evaluated automatically (off by default), but never prepared |
| **3. Accuracy at the user's level** | Strong. Every claim traced to evidence; independent factual review; claim calibration (undersold ↔ stretched); the user's line | Market reference not built (three decisions pending, [market norms](RESUME-MARKET-NORMS.md)); resume builder's term policy not merged; no generic-phrasing flag; packets get a factual review but not the style audit follow-ups get |
| **4. Covering the most used job sites** | **The biggest gap.** Applying works on **Greenhouse, Lever, Ashby**. Discovery also covers Workable, SmartRecruiters, Recruitee. LinkedIn and Indeed exist only as command-line modes; Workday is explicitly unsupported | See [site coverage](#site-coverage) below |
| **5. Standard questions answered, non-standard tagged** | Form inspection; evidence-backed answers; sensitive and unknown fields left blank and listed as questions; handoff to the user for sign-in or verification | **No single pre-submit check** listing every field as filled, tagged (no information / sensitive / low confidence) or mismatched with the approved packet. Answers the user gives to tagged questions aren't automatically offered to the answer bank, so the next site may ask again |
| **6. A systematic flow for many applications** | Discover, evaluate, prepare, review, apply and track each work, one role at a time | **No batch flow**: review several packets in a row, then work through an apply queue one site after another. No measure of time per application |
| **7. The user always submits** | Enforced in code: no automatic submission, submit buttons never pressed, "Applied" only by the user's confirmation | Nothing; keep it |
| **8. Proven on real sites** | Everything is tested against local fixtures and simulated portals; one real-model sandbox run | **Never run end to end on a real employer site with a real account** (M7). This is the largest unknown |

## Site coverage

What matters, from the available data:

- **Workday** runs talent acquisition at **over 40% of the Fortune 500**;
  SAP SuccessFactors about 12%; Oracle Taleo is declining; iCIMS remains
  common ([Jobscan 2026](https://www.jobscan.co/blog/fortune-500-use-applicant-tracking-systems/)).
- **Greenhouse, Lever and Ashby** dominate startups and tech companies
  (already supported; Ashby is the most common among recruiting teams in one
  vendor's data, [Pin 2026](https://www.pin.com/blog/ats-market-share-report)).
- **LinkedIn and Indeed** are the broadest job boards; **Handshake** is the main
  early-career network ([Huntr, 600k applications](https://huntr.co/blog/best-job-search-sites-2026)).
  Boards often hand off to the employer's own ATS, so covering the ATSs
  covers much of the boards' traffic too.

Proposed order:

| Tier | Sites | Why | Hard parts |
| --- | --- | --- | --- |
| Done | Greenhouse, Lever, Ashby | Tech and startup roles | Prove on real postings |
| 1 | **Workday** | Largest share of large employers | Account creation per employer, multi-page wizard, repeated work-history entry, uploads that re-parse the resume |
| 1 | **LinkedIn and Indeed (assist mode)** | Where most people find roles; Easy Apply and Indeed Apply short forms | Both prohibit automated use in their terms; accounts can be restricted. Keep it user-driven: the user is signed in and present, Plainhand fills and tags, nothing runs unattended |
| 2 | iCIMS, SAP SuccessFactors, SmartRecruiters and Workable (apply), Handshake | Large employers; new graduates | Varied page structures; Handshake needs a student login |
| 3 | Oracle Taleo, others | Long tail | A general form adapter that inspects any page and tags what it can't map, rather than one adapter per site |

The current browser layer (inspection, evidence-backed fill, readback,
sensitive-field policy, handoff, submit guard) is the foundation each adapter
plugs into; each new site needs its own adapter, a fixture, and a real-site
check.

## What to build, in order

1. **Prove what exists on real sites (M7).** One real application per supported
   ATS, end to end, submitted by the user. Cheapest way to find what fixtures
   hide.
2. **Standard documents, revision by conversation, and the autonomy dial.**
   The user approves one standard resume and cover letter; each application
   is a tracked variant of them. A `packet.revise` task takes a request ("make
   it shorter", "lead with X") and re-runs review, calibration and rendering.
   An autonomy setting chooses between "ask me per application" and "prepare
   up to N a day on my own" (never submit). This is the heart of "it works the
   standard for you".
3. **Pre-submit check.** One list per application at final review: every field
   filled, tagged with the reason, or mismatched with the approved packet; the
   user's answers to tagged questions offered to the answer bank.
4. **Site coverage**, in the tier order above, starting with Workday, then
   LinkedIn and Indeed in assist mode.
5. **Taste learning.** Learn from revisions and edits (length, tone, structure,
   which stories lead) and from several writing samples, the way the wording
   line learns from choices.
6. **Market reference** once the three decisions are made.
7. **Batch flow.** Review queue and apply queue; time per application tracked.

## Decisions needed

1. Site priority after M7: Workday first, or LinkedIn/Indeed first?
2. LinkedIn and Indeed: accept assist mode (user present, nothing unattended)
   given their terms, or skip them and rely on employer ATS handoffs?
3. Autonomy dial default: "ask me per application" or "prepare on my own up
   to N a day"?
4. The three market-norm decisions (default line, rounding, functional titles).
