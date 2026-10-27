# Resume market norms: what works, what's accepted, and what it means for Plainhand

**Status:** research, 26 October 2026 · proposals not yet built
**Related:** [Claim calibration](METRICS-INVENTORY.md#6-claim-calibration-benchmark) · [Competitive landscape](COMPETITIVE-LANDSCAPE.md) · resume builder policy in `modes/pdf.md` and `resume-tailoring-lib.mjs`

The question: should Plainhand write to the market's standard, including the
"appropriate embellishing" that is normal on resumes, and would that help the
product or bias it?

Short answer: **use the market as a calibration reference, not as a target.**
The conventions that improve outcomes are presentation and framing, which carry
no truth cost; the facts employers verify must stay exact; and whatever is
"standard" right now is a moving target, because AI is making it common and
employers discount whatever becomes common.

## 1. What the evidence says

Evidence quality varies a lot. Peer-reviewed or large field studies are marked
**strong**; named surveys **moderate**; vendor statistics **weak** (marketing,
unclear methods). Weak figures are listed so they aren't mistaken for facts.

| Finding | Evidence | Source |
| --- | --- | --- |
| Better-written resumes cause more hiring: jobseekers given (non-generative) writing assistance were hired 8% more often at 10% higher wages, with no drop in employer satisfaction. Fewer errors, easier to read. | **Strong** (field experiment, ~480k jobseekers) | Wiles, Munyikwa & Horton, *Management Science* 2025 |
| An AI cover-letter tool raised alignment with job posts and raised callbacks, but the link between alignment and callbacks fell 51%; employers shifted to other signals such as work history. More time spent editing the AI draft correlated with getting hired. | **Strong** (platform diff-in-diff) | Cui, Dias & Ye 2025 (Freelancer) |
| Before LLMs employers paid a premium for tailored applications; after, the premium disappeared. If written applications stop signalling, top-ability workers are hired 19% less and bottom-ability 14% more. | **Strong** (structural model on platform data) | Galdin & Silbert 2025, "Making Talk Cheap" |
| 77% of hiring managers say many resumes look AI-generated; top tells: unnatural phrasing (51%), generic or repetitive language (44%), **vague or inflated descriptions (41%)**. 67% say AI applications slow hiring; 65% struggle to verify skills. | **Moderate** (named surveys, 1,000 and 2,000+ managers) | Resume Genius 2026; Robert Half |
| 86% of US hiring managers say AI makes it too easy to exaggerate skills. 85% report catching at least one resume lie in screening. | **Moderate** | Express Employment / Harris Poll 2026; Resume Builder 2025 |
| Most commonly faked: skills, experience, responsibilities, past salary. HR estimates exaggeration in a quarter to half of CVs. | **Moderate** (self-report, definitions vary) | Monster; StandOut CV; Kickresume |
| Background checks verify **job titles and dates**, sometimes salary and duties; mismatches are flagged on the report. | **Moderate** (HireRight's own material; outcomes anecdotal) | HireRight support |
| Functional titles are widely accepted if they don't raise your level; the common safe form is "Official Title (functional title)". Upleveling (junior to senior) is the clear line. | **Moderate** (consistent recruiter guidance) | Resume Worded; Ask a Manager; forum reports |
| Quantify accomplishments: "Accomplished X as measured by Y by doing Z". | **Moderate** (widely adopted recruiter guidance, not an outcome study) | Laszlo Bock (Google) 2014 |
| Initial screen ~7 seconds; eyes go to titles and section headings; simple layouts win. | **Moderate** (single vendor study, small lab sample) | Ladders 2018 |
| ATS "auto-rejects 75%" is a myth: 92% of recruiters say their ATS doesn't auto-reject on content or formatting; ~8% set score thresholds; eligibility knockout questions are near-universal. | **Moderate** (25 recruiter interviews, corroborated by a ~100-person survey) | Enhancv 2025 |
| Tailored resumes get 31% more interviews; quantified achievements 40% more callbacks; "ATS-optimized" 11.7% vs 4.2%. | **Weak** (secondhand or unsourced vendor figures) | Various vendor blogs; do not rely on them |

## 2. Three kinds of "market standard"

The research separates cleanly into three groups, and they need different
treatment.

**A. Presentation conventions: adopt fully.** Results-first bullets,
quantified outcomes with context, strong and accurate action verbs, the
employer's vocabulary where the work genuinely involved it, clean scannable
layout, tailoring per role, error-free writing. These carry no truth cost and
have the best evidence (writing quality causes hiring).

**B. Accepted framing, the real "appropriate embellishing": this is the
candidate's line.** Owning your part of a team result ("led the test plan" when
you did lead that part), a functional title next to the official one, broader
terms that honestly cover what you did, choosing which true facts to lead
with, rounding stated as rounding ("about 20%"). Recruiters expect this and
mentally discount for it; a candidate who doesn't do it can read as less
experienced than they are. That is the case for using the market as a
reference: it defines what "underselling" means to a reader.

**C. Common but penalized: never.** Skills not held, upleveled titles,
invented or inflated metrics, degrees, employers or dates that aren't real.
Common in self-reports, but these are exactly what screening catches (85%),
what background checks verify (titles, dates) and what hiring managers name as
an AI tell ("vague or inflated descriptions").

## 3. Would it bias Plainhand or help it?

Both, depending on how it's used.

**Where it helps**

- **It fixes underselling, the bigger risk for Plainhand's users.** New
  graduates and career changers tend to undersell. Without a market reference,
  a strictly truthful system pulls everyone toward the most modest wording;
  with one, "balanced" means *what an informed recruiter would read as an
  accurate account*, so honest candidates aren't penalized for being literal.
- **A sensible default line before the candidate has made any choices.**
- **Plainhand's core bet gets stronger, not weaker.** When AI makes polished,
  aligned text cheap, its signal value collapses (−51% in one study) and
  employers move to evidence: work history, verifiable specifics. Every claim
  Plainhand writes is traced to evidence and defensible in an interview, which
  is the signal that keeps its value.

**Where it biases**

- **It would make everyone sound the same.** Writing to "the standard" is what
  produces the sameness hiring managers now screen against (77%), and generic
  or inflated wording are the top tells.
- **"What works" stops working once everyone does it.** Tailoring and polish
  raised callbacks until they were universal; then the premium disappeared.
  Optimizing for today's norm chases a target that moves as the tools spread.
- **Inflation spirals.** If tools treat a little inflation as normal, readers
  discount more, which pushes the next round of tools to inflate more. A
  product that joins this hurts the honest candidates it is meant to help.
- **Most "what works" numbers are vendor marketing** (31%, 40%, 75%
  auto-reject). Building on them would encode myths, such as keyword
  stuffing for ATS filters that mostly don't exist.
- **Norms differ by field, level and country.** One standard is wrong for many
  users.

## 4. Recommendation

**Model it as three layers, each with a different owner.**

1. **Floor: the truth (fixed, owned by the evidence).** Nothing unsupported.
   Verifiable facts (official titles, employers, dates, degrees, level) are
   exact, since background checks verify them. A functional title may sit
   beside the official one, never replace it.
2. **Reference: the market convention (sourced, versioned, owned by
   Plainhand).** What an informed recruiter reads as normal framing. Used to
   judge underselling and as the default line. Kept in a sourced conventions
   file (like the resume builder's tailoring rules), each rule tagged with its
   evidence strength, never with vendor statistics, and reviewed over time.
3. **The candidate's line (owned by the candidate).** Starts at the
   reference; moves stricter or bolder within the floor through their choices
   and their own words, as built today.

**Optimize for interview-defensibility and specificity, not keyword density.**
The resume builder's existing test is the right one: *could the candidate
answer honestly if a hiring manager pointed at this line?* That test already
matches what the market rewards and what it penalizes.

**Make sameness a flag.** Add generic phrasing (stock verbs repeated, empty
superlatives, unspecific claims) to calibration alongside undersold and
stretched, and keep the candidate's voice.

**Measure, don't assume.** Record the calibration band and the conventions
used on each application, so Insights can eventually check which choices go
with interviews for this candidate, instead of trusting market statistics.

## 5. Proposed changes (not built)

| Change | Effect |
| --- | --- |
| `config/resume-conventions.yml`: verifiable-field rules, accepted framing, never-list, generic-phrase list, each with source and evidence level | One sourced reference for drafter, reviewer and rules |
| Calibration treats any stretch on a verifiable field (title, dates, employer, degree, level) as unsupported | Matches what background checks verify |
| Undersold judged against the reference ("reads below what you did"), not only against the literal evidence | Stops penalizing honest candidates for literal wording |
| Default line = reference; candidate choices move it either way within the floor | Sensible start, still personal |
| "Generic" as a calibration flag | Counters AI sameness |
| Labelled benchmark cases for conventions (functional title in parentheses = balanced; upleveled title = unsupported; "about 20%" for 18% = per decision below) | Keeps the grader honest as rules change |
| Merge the resume builder's term policy (direct, adjacent-softened, out-of-scope) into app grading | One system instead of two |

**Decisions for the candidate/owner**

1. Default line: the market reference, or strict until the candidate chooses?
2. Rounding: allowed when stated as rounding ("about 20%" for 18%), or always
   exact?
3. Functional titles: allowed as "Official (functional)", or official only?

## Sources

- [Wiles, Munyikwa & Horton, Algorithmic Writing Assistance on Jobseekers' Resumes Increases Hires (NBER w30886; Management Science 2025)](https://www.nber.org/papers/w30886)
- [Cui, Dias & Ye, Signaling in the Age of AI: Evidence from Cover Letters (arXiv 2509.25054)](https://arxiv.org/abs/2509.25054)
- [Galdin & Silbert, Making Talk Cheap: Generative AI and Labor Market Signaling (arXiv 2511.08785)](https://arxiv.org/abs/2511.08785)
- [Why AI-written resumes are backfiring (WebProNews, citing Resume Genius and Robert Half)](https://www.webpronews.com/why-ai-written-resumes-are-backfiring-on-job-seekers-in-2026/)
- [86% of hiring managers say AI makes exaggeration too easy (Express / Harris Poll)](https://www.expresspros.com/newsroom/news-releases/news-releases/2026/02/86-percent-of-us-hiring-managers-say-ai-makes-it-too-easy-to-exaggerate-skills-on-resumes)
- [Resume exaggeration statistics (Monster)](https://www.monster.com/career-advice/research/resume-exaggeration-statistics)
- [Resume trends survey (Kickresume)](https://www.kickresume.com/en/press/resume-trends-survey/)
- [Lying on your resume: risks (Cruit, citing Resume Builder 2025)](https://www.askcruit.com/resume/mistakes/lying-resume-consequences)
- [What is in an employment verification (HireRight)](https://support.hireright.com/en-EMEA/articles/what-is-in-an-employment-verification)
- [Changing job titles on your resume (Resume Worded)](https://resumeworded.com/change-job-title-on-resume-key-advice)
- [Google recruiters on the X-Y-Z formula (Inc.)](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html)
- [Eye-tracking study: recruiters look at resumes for 7 seconds (HR Dive)](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/)
- [Study debunks claim that AI filters out most applicants (BetaNews, Enhancv study)](https://betanews.com/2025/11/10/study-debunks-viral-claim-that-ai-filters-out-most-job-applicants/)
- [The science behind tailored resumes (Resumly; secondhand ResumeGo figure, unverified)](https://resumly.ai/blog/the-science-behind-tailored-resumes)
