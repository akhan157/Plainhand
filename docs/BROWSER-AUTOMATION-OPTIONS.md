# Browser automation: source review and implementation choices

Reviewed 2026-10-18. Plainhand's priority is applications reaching final review
with few interruptions, using the candidate's existing AI harness and a local
browser by default. A CAPTCHA solver is one adapter in that system.

## Projects worth pulling from

These are engineering assessments of the linked source/documentation, not a
claim that every project was installed, benchmarked, or integrated.

| Project | License observed | Useful work already done | Decision for Plainhand |
| --- | --- | --- | --- |
| [Career Ops 1.37.0](https://github.com/career-ops-hq/career-ops/tree/career-ops-v1.37.0/web/src/lib/apply) | MIT | Form labels, iframe extraction, custom controls, navigation snapshots/action executor, diagnostics | Reuse directly behind Plainhand boundaries; now includes extractor and guarded action executor, beyond the earlier three small helpers. |
| [Stagehand](https://github.com/browserbase/stagehand) | MIT | Observe/act/extract separation, document/frame-aware snapshots, action recovery and reusable observation patterns | Strong candidate for a richer observation layer. Inspected its source and current Claude/Codex harness integrations; no full SDK added yet. |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | Apache-2.0 | Compact element references, session management, CDP adapters and explicit iframe-document identity tests | Strong alternative execution backend. Its stale-document tests inform our own regression cases; Rust runtime is not installed/bundled in this pass. |
| [Browser-use](https://github.com/browser-use/browser-use) | MIT library | Agent loop, browser lifecycle, local/remote browser choices and model integration | Candidate for a Python sidecar if broader navigation outgrows the lightweight driver. Its paid hosted browser is distinct from its free library. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | Structured accessibility snapshots, browser tools and CLI/MCP integration | Reference/possible standard browser transport. Do not grant a general agent unrestricted submit/navigation tools when mounting it. |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Apache-2.0 | Browser state, network/performance diagnostics and Chrome integration | Useful diagnostic backend; it does not supply Plainhand's application policy or candidate understanding. |
| [Nanobrowser](https://github.com/nanobrowser/nanobrowser) | Apache-2.0 | Automation in the user's existing logged-in browser and confirmation handling | Best extension reference for a later selected-tab connection; current product does not yet include that extension. |
| [Midscene](https://github.com/web-infra-dev/midscene) | MIT | Vision-driven interaction and natural-language UI testing across web/desktop/mobile | Candidate for screenshot/visual fallback when semantic DOM controls fail. Needs a compatible vision model and a constrained executor. |
| [Skyvern](https://github.com/Skyvern-AI/skyvern) | AGPL-3.0 core | Longer workflows, computer vision, workflow/state orchestration | Study recovery and validation; full deployment is heavier. Managed anti-bot features are excluded from the open core per its license section. |
| [BrowserOS](https://github.com/browseros-ai/BrowserOS) | AGPL-3.0 plus component licenses | Dedicated agent browser, login import, harness connections and session replay | Valuable authenticated-browser reference. Installing or distributing an entire browser is a separate product decision; no default-profile cookie copying added. |
| [Lightpanda](https://github.com/lightpanda-io/browser) | AGPL-3.0 | Lightweight JS/DOM/CDP automation | Evaluate for discovery/extraction; its lack of a graphical rendering engine makes it an unsuitable sole basis for visual form fallback. |
| [LaVague](https://github.com/lavague-ai/LaVague) | Apache-2.0 | Planner/action-engine separation and web-agent tooling | Additional reference for an engine/planner interface; not another mandatory runtime. |
| [Workflow-use](https://github.com/browser-use/workflow-use) | AGPL-3.0 | Record/replay workflows with agent healing on failures | Useful replay idea, but its own README says early development and not recommended for production. Do not treat its recorder as a finished ATS integration. |

Licenses describe the inspected repositories, not a blanket license for hosted
services, model weights, every dependency or every bundled component. Keep source
attribution when extracting code. None of these projects' marketing benchmarks
establish Plainhand's application completion rate.

## Coverage assessment and targeted additions

The original shortlist covers the main browser-agent approaches. It is enough to
choose a core architecture, but does not establish broad ATS reliability or the
90% target. These four additional candidates address operational and evaluation
gaps; they are documentation/license reviews, not installed integrations.

| Additional candidate | License observed | Gap addressed | Assessment |
| --- | --- | --- | --- |
| [Steel Browser](https://github.com/steel-dev/steel-browser) | Apache-2.0 | Isolated browser lifecycle, reusable sessions and debugging | Highest-value additional infrastructure candidate. Its repository documents local Docker/Node deployment, CDP/Playwright connections, cookie/storage state and a debugging UI. Compare its self-hosted session layer with our current manager; do not assume hosted CAPTCHA/proxy features are free or included. |
| [Magnitude](https://github.com/magnitudedev/browser-agent) | Apache-2.0 | Visual interaction when semantic controls fail | Compare with Midscene using the same difficult widgets. Provides visual actions and assertions, but requires a visually grounded model; CLI subscription compatibility is unproven. Its caching is described as in progress. |
| [Browser MCP](https://github.com/BrowserMCP/mcp) | Apache-2.0 server | Connection to an existing authenticated browser | Useful extension/transport reference alongside Nanobrowser. Its README explicitly says the server repository cannot currently build independently because of monorepo dependencies. Extension distribution/source coverage needs separate review. Existing-profile use does not guarantee CAPTCHA avoidance; do not make this a required runtime yet. |
| [BrowserGym](https://github.com/ServiceNow/BrowserGym) | Apache-2.0 repository | Repeatable agent evaluation and failure classification | Evaluation reference, not a shipping browser engine. Supports custom tasks and multiple benchmarks. Build ATS-specific tasks and compare completion, incorrect answers and interruptions; generic benchmark success is not application success. |

Primary references: each linked repository README and license; Browser MCP's
[build limitation](https://github.com/BrowserMCP/mcp#contributing), Magnitude's
[model requirements](https://github.com/magnitudedev/browser-agent#using-the-test-runner),
and BrowserGym's [custom task interface](https://github.com/ServiceNow/BrowserGym#-setup).

| Plainhand requirement | Candidate coverage | Remaining proof/work |
| --- | --- | --- |
| Dynamic forms, frames, uploads | Career Ops + Playwright; Stagehand observer | ATS schema loading, repeated records, shadow roots and server-confirmed uploads; distinguish draft/upload writes from final submission. |
| Logged-in sessions | Current local context; Nanobrowser/Browser MCP; BrowserOS | Explicit selected-tab connection or dedicated persistent profile, MFA expiry and reconnect tests. Never infer that copying cookies reproduces an entire session. |
| Background execution | Current isolated Chromium; optional Steel | Keep execution away from the user's active tabs; verify session isolation and resource cleanup. Existing-browser bridges are optional and may affect connected tabs. |
| Visual fallback | Midscene or Magnitude | Choose one via fixture comparison; verify model/harness access and preserve final-submit boundaries. |
| Recovery across process crashes | Existing checkpoints; orchestration references in Skyvern/Browser-use | Persist resumable workflow state, reconcile against the current page and avoid duplicate operations; browser lifecycle alone is not durable workflow recovery. |
| CAPTCHA and anti-bot interruptions | Existing bounded local audio adapter; manual takeover | No reviewed project proves universal free solving. Measure actual challenge outcomes separately from form completion. |
| Measured automation rate | Current fixtures; BrowserGym evaluation patterns | Representative supported-ATS corpus, per-portal results and explicit denominator. Track ready-for-review applications without human intervention, correctness and interruption causes. |

Recommended composition: keep Playwright and the Career Ops form adapter as the
base; compare Stagehand for observation; assess Steel only where session management
outgrows the current implementation; choose one visual fallback; keep an optional
browser bridge. Plainhand retains candidate evidence, workflow state and submission
policy. Do not run every framework as another mandatory agent layer.

The next bottleneck is implementation and representative testing rather than more
generic frameworks. Workday and other unsupported portals still need dedicated
coverage; adding another agent repository does not supply that automatically.

## Source inspected in detail

- Career Ops release tag `career-ops-v1.37.0`, commit `373aba4`:
  `extract.ts`, `drive.ts`, `drive-action.mjs`, `diagnose.ts`, `session.ts` and
  the previously extracted option/resume/submit helpers.
- Stagehand commit `10418f98831285b3cddca5328c8013a94f22672a`:
  snapshot capture/formatting, Claude Code and Codex integration entrypoints,
  and cache-related module/test layout. Its current integrations are a reason
  to evaluate it further for bring-your-agent use; entitlement/runtime support
  must still be checked rather than inferred from an example.
- agent-browser commit `dac13bb87468fe9d74a040d862720f6cc17a9565`:
  native Rust snapshot implementation and document/session identity regressions.
- The other entries were reviewed through their official repository docs and
  license information. They have not all been executed against Plainhand forms.

## The implemented architecture

1. **Session manager:** keep portal cookies/storage, the exact page and manual
   recovery in one local browser context.
2. **Extractor:** adapt Career Ops' richer labels, wrapper/legend lookup and
   field tagging; exclude passwords and retain supported hidden file uploads.
3. **Deterministic fill:** use canonical contact data and source-backed packet
   answers, choose actual dropdown options and verify readback. A discarded value
   or visible validation error pauses instead of being counted as filled.
4. **Navigation fallback:** observe fresh scoped control refs → ask the selected
   Codex/Claude/Antigravity CLI for one action → execute a guarded action → inspect
   again. Existing evidence-backed filling remains a separate process.
5. **Interruption handling:** login, CAPTCHA and unanswered required facts pause;
   supported local audio verification can resolve and resume in place.
6. **Independent submission boundaries:** submit controls are not offered to the
   planner; the executor rechecks the live element; a DOM interlock blocks form
   submit/requestSubmit; the application-write network guard remains active.
   Explicit human takeover releases the DOM/write guards.
7. **Evidence:** preserve navigation traces, page counts, failed fields and
   checkpoints. The UI shows completed navigation and verification failures.

The planner receives only observed navigation controls and prior action results,
not provider credentials or a second copy of the candidate profile. It cannot
execute arbitrary JavaScript, type into credentials, invent refs, choose a file
path or visit an arbitrary URL. These are concrete application boundaries around
reused code; generic agent frameworks do not supply them automatically.

## What this pass proves

Controlled Chromium tests cover an application hidden behind a button, richer
labels/contenteditable fields, password exclusion, stale refs, changed submit
labels, off-portal links, fabricated refs/actions, value readback, repeated-page
stops and a next-looking handler calling `requestSubmit()`. The website acceptance
flow now starts with a gated employer fixture and reaches the actual filled form.

A separate real Claude CLI test chose a fresh ref, opened a synthetic application,
and filled its contact fields with zero employer submissions. Evidence is under
`output/navigation-live-2026-10-18T16-10-13-084Z/`. This is live reasoning on a
controlled page, not a live employer compatibility benchmark.

## Highest-value next comparisons

Evaluate Stagehand's observer and agent-browser's local transport against the
same fixtures before swapping the execution backend. A useful comparison records:
completion to review, interruptions, wrong/unstable fields, calls/latency, quota,
frames/widgets handled, session reuse, and whether submission guards held.

Then extend the corpus: Greenhouse React selects/schema options, Ashby dynamic
questions, Lever validation/upload acknowledgements, embedded forms and repeated
education/employment sections. Test login/MFA and real CAPTCHA failures separately.
Workday and arbitrary portals remain unsupported until their behavior is tested.

Remaining limits: navigation offers a bounded English application-control
vocabulary; shadow-DOM traversal, universal visual interaction, arbitrary record
creation, broad ATS coverage and real server upload acknowledgements are not all
implemented. Strict ATS write blocking still limits some dynamic forms. The DOM
interlock is supplementary, not a security sandbox against a hostile page. No
90% completion claim is supported yet.

## Reliability implementation: embedded steps and durable evidence

The first implementation after the coverage review fixes a concrete mismatch:
`advance()` now finds unambiguous next-step controls in supported ATS frames,
validates that frame's native constraints and visible `aria-invalid` controls,
and recognizes an embedded review-only page. Multiple eligible next controls
remain ambiguous and pause. Submit-type buttons remain excluded.

Every successful fill now writes a private atomic per-job checkpoint journal
before attempting navigation. Workspace loading recovers newer checkpoint
records only when their packet hash matches the current approval. This preserves
page-level evidence during a process interruption before the enclosing request
commits. It does **not** restore the DOM, reconstruct unsaved form answers, or
blindly replay actions after restart. Resume still inspects the live/current
portal. Journals use the existing user-layer `data/plainhand/` storage boundary.

Regressions exercise embedded required fields, two-step filling, embedded final
review, portal validation errors, mid-request checkpoint visibility and stale
packet rejection. The full website acceptance workflow remains a fictional
employer, not proof of compatibility with live employer forms. Verification now
writes browser evidence into a unique suite directory so screenshots from older
runs cannot be mistaken for the current run.

Next acceptance gate: supported-ATS server-confirmed upload/schema loading without
relaxing final-submission protection; then repeated records and crash recovery
that reconciles portal state. Those gaps remain open. The 90% target remains an
unproven product goal.


## Continued implementation: attachments, conditional fields and records

- `browser-transfers.mjs` provides a short-lived, frame-bound grant for Ashby's
  documented `file.createFileUploadHandle` metadata and the returned exact S3
  destination. The file must be the approved PDF. Multipart fields must match the
  response; unrelated payloads/destinations and application submission stay blocked.
  Chromium omits disk-file bytes from intercepted multipart data: the executor
  reconstructs that part from the approved local bytes before allowing the request.
  HTTP acceptance is recorded separately from browser file selection. An HTTP
  acknowledgement is not a claim that an employer application was created.
- The UI exposes selected/server-accepted/failed/pending/unconfirmed attachment
  states. A failed or unconfirmed attempted transfer stops automation.
- Each fill checks fresh form structure, including required flags and option values,
  before subsequent answers. Conditional changes trigger a bounded replan through
  the existing autofill loop, preserving previously filled fields and checkpoints.
- Fields in labelled fieldsets/groups carry section name, record index and count.
  Repeated education/employment records bypass generic identity/packet matching
  and receive evidence-backed agent answers with explicit record context. Their
  labels are distinguished in the review UI. Automatic creation of a complete
  history from an arbitrary CV is not established by these changes.

Reference: [Ashby's documented attachment/submission separation](https://developers.ashbyhq.com/docs/creating-a-custom-careers-page).
The supported API request shape is deliberately narrower than the whole Ashby
web client. This is not a claim that every current Ashby frontend uses that shape.
POST-based schema lookup, other upload endpoints, and untested portals remain gaps.

`test-plainhand-browser-transfers.mjs` exercises delayed acceptance, exact outgoing
PDF bytes, local-only selection, wrong names/bytes, HTTP rejection, unexpected
multipart fields, unsafe destinations, and blocked submission. Network mocks sit
behind the production outbound guard, rather than bypassing it with page routes.
`test-plainhand-browser-runtime.mjs` covers conditional key shifts and repeated
record filling; API tests prove conditional replanning happens before navigation.

An opt-in real Claude CLI check mapped two fictional employers/titles to distinct
form records with exact source evidence and filled all four fields in background
Chromium, stopping before submission. Evidence:
`output/records-live-2026-10-18T18-51-19-767Z/`.
Reproduce with `node test-plainhand-records-live.mjs --provider claude` (uses quota).


## Live read-only ATS observation and resulting fixes

Public Chromium observations revealed frontend assets missing from our allowlist
and Ashby POST-based public reads blocked as writes. The guard now permits the
observed static asset paths on the ATS CDNs, with no write permission on those
hosts. Ashby public posting, organization and location-autocomplete queries are
pinned to exact SHA-256 document hashes. Matching operation names with changed
queries, arbitrary variables, batches and mutations do not pass. Posting and
organization variables must match the current browser URL; geolocation text is
bounded to 200 characters and the observed City/Country types. Upstream document
changes require review rather than silently broadening this permission.

| Public sample | Observed outcome | Evidence |
| --- | --- | --- |
| Greenhouse / Figma | 19 fields extracted with the updated static assets | `output/ats-observe-2026-10-18T18-56-03-772Z/` |
| Lever / Zoox | 15 fields extracted | same observation run |
| Ashby / Notion | Application tab opened through an observed control; 6 fields extracted after pinned-query support | `output/ats-observe-2026-10-18T18-58-16-943Z/` |

These are three public posting samples, not employer recommendations, broad ATS
compatibility, live upload acceptance or a completion-rate benchmark. No candidate
data was supplied and no application was submitted. The initial failures are
retained in earlier observation runs. Embedded promotional media remains blocked;
it is not needed for the observed application form.

Run `npm run test:ats-observe -- --live` (or add `--ats ashby`) for a read-only
public-browser check. The command returns failure if a sampled form has no fields.
It can become stale as employers change postings; it is intentionally outside the
regular deterministic fixture suite.
