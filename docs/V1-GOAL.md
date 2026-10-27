# Plainhand 1.0 goal

**Set:** 26 October 2026 · **Status:** V1–V8 delivered 27 October; see the [verification matrix](VERIFICATION-MATRIX.md#plainhand-10-27-october-2026) · **Gap analysis:** [VISION-GAP.md](VISION-GAP.md)

1.0 is a version the owner can send to a friend who installs it and starts
using it the same day: a mini version of themselves built by conversation,
standard documents varied per application, accurate applications at their own
line, forms filled on the common sites with everything unknown flagged, and
every submission done by them.

## Decisions (owner, 26 October)

| Question | Decision |
| --- | --- |
| Sites | Greenhouse, Lever and Ashby verified on real postings, plus an any-site mode that fills what it can (Workday, iCIMS, others) and flags the rest |
| LinkedIn and Indeed | Find and save roles there; apply on the employer's own site. No automation of LinkedIn or Indeed pages |
| Autonomy default | Ask per application; preparing on its own is an opt-in setting |
| Wording line default | Market norm: own your part of a result, rounding stated as rounding ("about 20%"), "Official Title (functional title)". Titles, employers, dates, degrees and level exact; nothing unsupported |

## Scope

| # | Workstream | Done when |
| --- | --- | --- |
| V1 | **Release** | Plainhand README and install guide (macOS, Windows, Linux); user guide; no personal data in tracked files; version 1.0.0 with changelog; a fresh clone installs and starts with `npm run setup && npm start` |
| V2 | **Writing samples** | Several samples can be added (screen or conversation, the user's own text); they shape voice in the understanding and in drafting |
| V3 | **Standard documents** | The user approves one standard resume and cover letter; each application starts from it and shows what changed; "make it shorter", "lead with X" revise a packet or the standard by conversation; an opt-in setting prepares strong matches on its own within a daily limit (never submits) |
| V4 | **Pre-submit check** | One list per application: each field filled (and from what), flagged with a reason, or different from the approved packet; answers the user gives to flagged fields can be saved for next time |
| V5 | **Sites** | Real-posting dry runs on Greenhouse, Lever, Ashby stop before submit; any-site mode opens any employer application page, fills what it can map, flags the rest, hands over for sign-in; LinkedIn and Indeed postings can be saved with the employer's apply link |
| V6 | **Accuracy defaults** | Market-norm default line; any stretch of a title, employer, date, degree or level is unsupported; generic phrasing flagged |
| V7 | **Queues** | Review packets one after another; open approved applications one after another |
| V8 | **Verification** | Full suite green; new features tested including safety; screenshots in both themes and mobile reviewed; live benchmarks re-run; fresh-clone install test; verification matrix updated |

**Not in 1.0:** full Workday account automation, learning taste beyond
wording, Handshake, spoken replies, a hosted version, merging the resume
builder's term policy (its defaults hold the owner's own resume rewrites), and
automatic submission (never).

## Rules that carry over

No automatic submission. Every claim traced to evidence. Untrusted text
(postings, pages, notes) taints the turn. Candidate-only actions stay
candidate-only. Recruiter-facing text follows draft → audit → final.
