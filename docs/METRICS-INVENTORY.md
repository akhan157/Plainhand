# What Plainhand measures

**Status:** inventory as of 26 October 2026
**Related:** [Verification matrix](VERIFICATION-MATRIX.md) · [Agent layer direction](AGENT-LAYER-DIRECTION.md#how-to-tell-its-working)

Most of what Plainhand has today are **checks** (a gate that passes or fails one
item) rather than **metrics** (a number tracked over time). Checks keep a single
output honest; they don't say whether the product is getting better. This page
separates the two, lists what is recorded but never added up, and says what is
still unmeasured.

## 1. Metrics the candidate can see

| Metric | Where | Computed from | Limits |
| --- | --- | --- | --- |
| AI usage: calls, failures, retries, tokens, reported cost, time | AI usage page, `usage.summary` | Usage ledger, one record per provider call | Subscription quota can't be derived from tokens; some CLIs don't report every field |
| Profile strength: foundation, story depth, role coverage, review | Profile page card, `profile.strength` | Profile fields, the candidate's own statements, evaluations, the understanding log | Heuristic counts (words, numbers, matches vs gaps), not a judgment of quality; needs 3 evaluations for coverage |
| Claim calibration: each claim undersold, balanced, stretched or unsupported; packet band | Packet tab, `jobs.get` (packet) | The reviewer model's per-claim ratings, overridden toward inflation by rule checks (numbers in no source, raised ownership verbs, raised skill level) | Model judgment on scope, causation and titles; rules alone miss those |
| Outcome insights: interview rate by score band, observed vs assumed outcomes | Insights page | Tracker status history | Needs 5 outcomes per band and 20 overall before it says anything |
| Campaign scan health: last run, failures in a row, failing sources | Campaigns page | Scan run records | Health only; not whether surfaced roles were good |

## 2. Checks (pass/fail per item)

| Check | What it guards | Where |
| --- | --- | --- |
| Evaluation evidence | Every claimed match quotes a real source (≥ 8 characters, verbatim) | `hasEvidence` in `plainhand/store.mjs` |
| Packet factual review | Resume and cover letter claims are supported; two failed audits block the packet | `REVIEW_INSTRUCTION` in workflow |
| Follow-up rule checks and audit | Draft only uses the submitted packet and record; draft → audit → final | `plainhand/features/followups/checks.mjs` |
| Candidate's own words | Profile stories saved by the assistant must be copied from what the candidate typed | `candidateWords` in the agent engine |
| Untrusted text taint | Proposals made after reading postings, notes or emails are marked | Agent engine |
| Requirement coverage ≥ 70% | Apply recommendation needs evidence for most requirements | `requirement-evidence.mjs` (command-line lifecycle only, not the app) |
| Stale proposals, approvals cleared on context change | Nothing is approved against outdated information | Agent engine, context fingerprint |

## 3. Recorded but never added up

These are stored already; a number is one function away.

- **Proposals accepted, declined, edited** (`agent-proposals.json`): the *trust*
  metric in the agent direction doc.
- **Candidate corrections** (`Corrections`): how often the candidate fixed what
  Plainhand wrote.
- **Turn timing**: call durations are in the usage ledger; time to first streamed
  text is only measured by the live check, not stored.
- **Audit log**: every agent and MCP action with its reason.
- **Status history** per job (used by Insights).

## 4. Benchmarks (offline, run on demand)

| Benchmark | Measures | Last run |
| --- | --- | --- |
| `benchmark:architecture` | Correct outcomes and false-ready rate across 42 application cases, six designs | 18 Oct ([results](IMPLEMENTATION-BENCHMARK-RESULTS.md)) |
| `benchmark:review` | Whether the factual reviewer catches 3 planted false claims and passes 1 true one | Opt-in probe; 4 cases |
| `benchmark:simulation` | Completion, interruptions and recovery on fictional portals | Browser path |
| `benchmark:invariants` | Workflow invariants hold under repeated runs | Deterministic |
| `test:agent-live` | Three assistant turns on a real CLI: briefing, logging, injected posting | Not yet run on the candidate's machine |
| `benchmark:profile` (new) | Profile building by conversation, below | 26 Oct, Claude CLI |

All earlier benchmarks predate the assistant; none measured the conversation.

## 5. Profile-building benchmark

`node benchmark-profile.mjs --provider claude` (or `npm run benchmark:profile -- --provider claude`).

Three fictional personas (a mechanical engineering graduate, a teacher moving
into data analysis, a junior software engineer), each with 4–6 hidden facts and
one thing they have *not* done. A deterministic simulated candidate answers each
assistant message with the best-matching fact it hasn't shared yet, adds a
detail when asked a follow-up about the story it just told, says "I haven't"
when asked about what it lacks, says "yes, go ahead" once to an offered next
step, and accepts every proposal.

| Measure | Meaning | Target |
| --- | --- | --- |
| Capture rate | Revealed facts that reached the profile | High; misses mean the assistant heard something worth keeping and didn't save it |
| Not verbatim | Saved stories that aren't the candidate's words | 0 (also enforced in code) |
| Unsupported updates | Profile changes whose content isn't in anything the candidate said or entered | 0 |
| Absent claims saved | A saved line claims what the candidate said they lack | 0 |
| One-question turns | Turns that ask exactly one question | High; the prompt asks for one at a time |
| Follow-ups, details saved | The assistant asked more about a story it just heard, and saved the extra detail | Follow-ups happen; details saved |
| Calls, tokens, seconds | Cost of building a profile | Track over time |
| Story depth before → after | Profile strength's depth dimension | Up |

Without `--provider` it runs a scripted stand-in that checks the harness and the
scoring (`test-profile-bench.mjs` tests the scoring itself). The simulated
candidate is generous: it always has an answer, never goes off topic, and never
corrects the assistant. So the benchmark finds *assistant* failures (not saving,
paraphrasing, inventing, asking three things at once); it can't tell whether a
real person would find the conversation good.

### First live results (26 October, Claude CLI, 10-turn cap)

| Persona | Facts captured / revealed / total | Follow-ups, details kept | One-question turns | Calls | Input tokens | Time | Story depth after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Engineering graduate | 4 / 4 / 6 | 3, 3 | 6 of 9 | 10 | 92k | 66 s | good (141 words) |
| Teacher to analyst | 5 / 5 / 5 | 5, 4 | 10 of 10 | 10 | 99k | 48 s | strong (170 words) |
| Junior engineer | 4 / 4 / 4 | 3, 3 | 7 of 8 | 9 | 88k | 45 s | good (123 words) |

Nothing was paraphrased, invented or saved as a claim the persona said they
lacked. Each persona started at "thin". Findings:

- **Good:** every fact the candidate shared reached the profile in their words;
  the assistant asks follow-ups that draw out results and numbers; it offered
  to rebuild the understanding after five or six stories.
- **To improve:** the assistant re-explains saving ("I'd like to save it to your
  profile in your exact words…") on every turn, which costs tokens and reads as
  repetitive; it sometimes asks two questions in one turn; each turn sends about
  10k input tokens, mostly the fixed instructions and catalogue.
- **Measurement fixes the first run forced:** depth counted single long
  statements (chat stories arrive in short pieces, so it read "thin" forever);
  capture ignored facts saved as profile fields (voice, preferences); stories
  told in conversation didn't count toward the foundation's story. All three
  are fixed and tested.
- **Limits:** one run per persona, a cooperative simulated candidate, one
  provider. Run it again after any prompt change and compare.

## 6. Claim calibration benchmark

`npm run benchmark:calibration -- --provider claude`

Where an application should sit: as strong as the candidate's evidence, no
stronger (stretched, unsupported) and no weaker (undersold). 24 labelled claims
across the three personas, six of them needing judgment the rules can't make
(one lab to "all labs", weekly to "daily", "lead TA", claiming sole credit for a
team result, experience the candidate said they don't have). Then, live, one
real packet per persona is drafted and graded.

| Grader (26 Oct, Claude CLI) | Exact | Right direction | Missed inflation | False alarms | Missed undersell |
| --- | --- | --- | --- | --- | --- |
| Rule checks only | 16/24 | 67% | 7 | 0 | 1 |
| Reviewer model | 24/24 | 100% | 0 | 0 | 0 |
| Combined (shipped) | 24/24 (23/24 before the rounding fix) | 100% | 0 | 0 | 0 |

The combined miss was a rule calling "nearly 20%" (source: 18%) invented rather
than rounded; rounding within 25% of an evidence number is now "stretched". A
rule also flagged a skills list as underselling; undersell rules now apply only
when the model gives no rating, while inflation rules always apply.

**Real drafts:** 1 of 3 packets came out balanced on the first draft (the
teacher-to-analyst, 23 of 25 claims balanced). The other two each had one
unsupported and two or three stretched claims, almost all in cover-letter
sentences about motivation ("I also enjoy helping others debug", "your emphasis
on code review"), not in resume facts. In the app those fail the factual review
and get one correction pass. This is the zone where a candidate's own line
matters most: whether a reasonable inference about what they enjoy is theirs to
claim.

**The candidate's line (second run).** The same engineering application was
drafted three ways: with no line; for a strict candidate (chose the closer
wording on every flag in two earlier applications, and said "I only say I led
something if I was the one making the calls"); and for a comfortable one (kept
stronger ownership and rounded numbers, and said so).

| Draft | Stretched | Within that candidate's line | Unsupported | Same draft judged by the other line |
| --- | --- | --- | --- | --- |
| No line | 1 | 0 | 0 | — |
| Strict | 0 | 0 | 0 | 0 outside the comfortable line |
| Comfortable | 2 ("led three sophomores") | 2 of 2 | 1 | 3 outside the strict line |

The line moves wording in both directions, and a stretch is acceptable for one
candidate and flagged for the other. The unsupported claim is the drafter
inferring motivation ("I'd like to learn production practice on the job"),
the same pattern as the first run's drafts; the factual review fails it and
the app's correction pass removes it.

Limits: two runs, one provider, labels written by the same author as the
grader's rules. The resume builder's term-level policy (`resume-tailoring-lib.mjs`:
direct, adjacent-softened, out-of-scope terms) covers the same ground for
keywords and is not yet used by the app's grading. The cases should grow with real flagged claims the candidate
disagrees with.

## 7. Not measured yet

1. **Whether the profile makes applications better.** Coverage and depth vs
   interview rate; needs real outcomes (Insights can join them once both exist).
2. **Evaluation accuracy.** Whether the score agrees with a careful human read of
   the same posting. Needs a small labelled set.
3. **Packet quality beyond facts.** The reviewer checks truth, not whether the
   letter is good.
4. **Effort and reach** from the agent direction doc (time from pasted link to
   reviewed packet; share of requests done without falling back to a form).
5. **Real conversations.** Accept/decline rates and corrections from actual use
   (section 3) are the cheapest honest signal and should be added up next.
