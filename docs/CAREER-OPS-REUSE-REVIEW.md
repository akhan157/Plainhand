# Career Ops reuse review — 2026-10-18

Plainhand owns the product, candidate model, agent connections, browser workflow,
and naming. Career Ops is a source of reusable modules and reference behavior,
not a second application users must configure or learn.

## Versions inspected

- Local inherited core: **1.9.0** (`VERSION` and `package.json`).
- Latest published core inspected: **1.37.0**, released October 16, 2026,
  tag `career-ops-v1.37.0`, commit `373aba4`.
- Associated upstream web package: **0.15.0**, an opt-in Next.js application.
- Upstream repository moved to `career-ops-hq/career-ops`; old links redirect.
- Inspection used a separate temporary checkout, pinned to the release tag.
  The standard updater reported offline in the restricted shell; explicit network
  access was used to fetch the public release for comparison.
- No bulk updater or schema migration was run. Local candidate data was untouched.

Sources: [release](https://github.com/career-ops-hq/career-ops/releases/tag/career-ops-v1.37.0),
[pinned web guide](https://github.com/career-ops-hq/career-ops/blob/career-ops-v1.37.0/web/README.md),
[pinned browser implementation](https://github.com/career-ops-hq/career-ops/tree/career-ops-v1.37.0/web/src/lib/apply),
[pinned TUI guide](https://github.com/career-ops-hq/career-ops/blob/career-ops-v1.37.0/dashboard/README.md).

## What changed the decision

The newer upstream is more than a search engine. It has a substantial apply
session implementation: frame selection, Greenhouse schema enrichment,
custom-widget filling, fill verification, challenge/login diagnostics, and an
observe/action browser drive loop. Its drive implementation is Claude-first;
its CLI invocation and web framework are coupled to upstream internals. Importing
that whole application would duplicate Plainhand's profile and provider logic.
Its CAPTCHA diagnostics still request human help, rather than supplying a
self-hosted automatic solver.

The larger discovery registry, scan coverage explanations, liveness checks,
listing identity work and factual-validation improvements deserve selective
reuse. They are not evidence that upstream solves 90% of application workflows.

## Keep, adapt, or retire

| Component | Decision | Plainhand boundary |
| --- | --- | --- |
| ATS discovery providers | Keep and expand selectively | Normalized job records behind discovery adapters; source-specific failures stay visible. |
| Liveness and legitimacy | Adapt | Distinguish expired postings from bot blocks, DNS failures and unconfirmed results. |
| Form extraction, guarded drive executor, dropdown/resume/submit helpers | Reused now | Pinned, attributed helpers under `plainhand/adapters/upstream/`; no upstream web runtime. |
| Browser diagnose/extract/drive | Adapt incrementally | Keep Plainhand's selected CLI, exact packet approval and browser session manager. |
| Factual gates and artifact contracts | Keep and strengthen | Preserve evidence provenance and exact resume identity. |
| Report and tracker formats | Keep as compatibility contracts | Existing reports and terminal dashboard remain usable. |
| TUI pipeline/report views | Keep, optional | Same workspace tracker, not a second profile setup or application engine. |
| Full upstream Next.js web UI | Reference, not adopted | Avoid a second website and competing job/profile state. |
| Slash commands and mode-specific onboarding | Legacy compatibility | Website onboarding is Plainhand's primary path; don't expose inherited jargon as required setup. |
| Upstream bulk updater | Do not use for product evolution | Review pinned components and migrate intentionally; retain attribution and licenses. |

## Website and TUI together

Keep both. Website: candidate conversation, document review, browser progress,
questions, session recovery and final handoff. TUI: pipeline filters, reports,
progress and manual status edits. The retained TUI already reads the same
`data/applications.md`; Plainhand reloads those status edits when loading state.

Run `npm run tui` from the code checkout, or
`go -C dashboard run . --path /absolute/path/to/workspace` for an alternate root.
The Go module path is retained for compatibility; visible branding is Plainhand.
Attribution remains in licenses and project documentation.

The current TUI is not a full terminal version of the browser workflow. It has
no candidate-chat or browser-run controls. New actions should call the shared
Plainhand backend rather than build another engine. Tracker writes currently use
separate processes without a shared transaction lock: refresh before switching
interfaces and avoid simultaneous status edits. Routing TUI mutations through the
backend is the next consistency improvement, not a capability claimed here.

## Extraction order

1. Browser helpers, session reuse, challenge state and resumable multistep filling.
2. Richer frame/widget extraction and actual fill verification, adapted from the
   newer apply modules and exercised against controlled ATS-shaped fixtures.
3. Expanded discovery, strong listing identity, liveness and coverage diagnostics.
4. TUI activity/run controls through Plainhand APIs; centralize status writes.
5. Retire redundant legacy modes only after their behavior and data have migrated.

The source review is complete; items marked adapt are not all integrated.

The browser execution follow-up is documented in [BROWSER-AUTOMATION-OPTIONS.md](BROWSER-AUTOMATION-OPTIONS.md). It includes actual extractor/executor reuse and a real CLI navigation acceptance check.
